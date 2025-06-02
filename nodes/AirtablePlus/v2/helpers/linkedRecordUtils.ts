import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { apiRequest, apiRequestAllItems } from '../transport';

interface LinkedFieldInfo {
	fieldName: string;
	linkedTableId: string;
	linkedTableName?: string;
}

interface LinkedRecordExpansionOptions {
	tablesToInclude: string[];
	maxDepth: number;
	includeOriginalIds: boolean;
}

interface ExpansionPath {
	fullPath: string;
	currentStep: string;
	remainingPath: string;
	maxDepth: number;
}

/**
 * Determines which linked fields should be expanded based on table inclusion list
 */
export function getExpandableFields(
	linkedFields: LinkedFieldInfo[],
	options: LinkedRecordExpansionOptions,
	usedTables: Set<string>
): LinkedFieldInfo[] {
	// At any level: Expand any linked field that points to an included table (and hasn't been used)
	return linkedFields.filter(field =>
		options.tablesToInclude.includes(field.linkedTableId) &&
		!usedTables.has(field.linkedTableId)
	);
}

/**
 * Gets schema information for a table and identifies linked record fields
 */
export async function getTableSchema(
	this: IExecuteFunctions,
	base: string,
	tableId: string,
): Promise<{ linkedFields: LinkedFieldInfo[]; allFields: IDataObject[] }> {
	const response = await apiRequest.call(this, 'GET', `meta/bases/${base}/tables`);

	const tableData = ((response.tables as IDataObject[]) || []).find((table: IDataObject) => {
		return table.id === tableId;
	});

	if (!tableData) {
		throw new Error(`Table ${tableId} not found in base ${base}`);
	}

	const linkedFields: LinkedFieldInfo[] = [];
	const allFields = tableData.fields as IDataObject[];

	// Removed excessive debugging to prevent console overflow

	for (const field of allFields) {
		// Check if this is a linked record field - try multiple possible type names
		const fieldType = (field.type as string)?.toLowerCase();
		if (fieldType?.includes('multiplerecordlinks') ||
		    fieldType?.includes('linkedrecord') ||
		    fieldType?.includes('foreignkey') ||
		    fieldType?.includes('link') ||
		    fieldType === 'multipleRecordLinks') {

			const fieldOptions = field.options as IDataObject;
			const linkedTableId = fieldOptions?.linkedTableId as string;

			if (linkedTableId) {
				// Find the linked table name for better debugging
				const linkedTable = ((response.tables as IDataObject[]) || []).find((table: IDataObject) => {
					return table.id === linkedTableId;
				});

				linkedFields.push({
					fieldName: field.name as string,
					linkedTableId,
					linkedTableName: linkedTable?.name as string,
				});
			}
		}
	}

	console.log(`DEBUG: Found ${linkedFields.length} linked fields:`, linkedFields.map(f => f.fieldName));

	return { linkedFields, allFields };
}

/**
 * Collects all unique linked record IDs from the main records for efficient batching
 */
export function collectLinkedRecordIds(
	records: IDataObject[],
	fieldsToExpand: string[],
): Map<string, Set<string>> {
	const linkedRecordIds = new Map<string, Set<string>>();

	for (const fieldName of fieldsToExpand) {
		linkedRecordIds.set(fieldName, new Set<string>());
	}

	for (const record of records) {
		const fields = record.fields as IDataObject;

		for (const fieldName of fieldsToExpand) {
			const linkedIds = fields[fieldName];

			if (Array.isArray(linkedIds)) {
				for (const id of linkedIds) {
					if (typeof id === 'string' && id.startsWith('rec')) {
						linkedRecordIds.get(fieldName)?.add(id);
					}
				}
			}
		}
	}

	return linkedRecordIds;
}

/**
 * Fetches linked records in batches to minimize API calls
 */
export async function fetchLinkedRecords(
	this: IExecuteFunctions,
	base: string,
	linkedTableId: string,
	recordIds: string[],
): Promise<Map<string, IDataObject>> {
	const recordMap = new Map<string, IDataObject>();

	if (recordIds.length === 0) {
		return recordMap;
	}

	// Airtable allows up to 100 records per request via filterByFormula
	const batchSize = 100;

	for (let i = 0; i < recordIds.length; i += batchSize) {
		const batch = recordIds.slice(i, i + batchSize);

		// Create a formula to get specific records by ID
		const recordIdsList = batch.map(id => `"${id}"`).join(',');
		const filterFormula = `OR(${batch.map(id => `RECORD_ID() = "${id}"`).join(',')})`;

		const qs = {
			filterByFormula: filterFormula,
		};

		try {
			const response = await apiRequestAllItems.call(
				this,
				'GET',
				`${base}/${linkedTableId}`,
				{},
				qs
			);

			// Store records by their ID for quick lookup
			for (const record of response.records || []) {
				recordMap.set(record.id as string, record as IDataObject);
			}
		} catch (error) {
			console.error(`Error fetching linked records from table ${linkedTableId}:`, error);
			// Continue with other batches even if one fails
		}
	}

	return recordMap;
}

/**
 * Efficient level-by-level expansion with batching within each level
 */
export async function expandLinkedRecords(
	this: IExecuteFunctions,
	base: string,
	records: IDataObject[],
	linkedFields: LinkedFieldInfo[],
	options: LinkedRecordExpansionOptions,
	currentDepth: number = 1,
	usedTables: Set<string> = new Set()
): Promise<IDataObject[]> {
	console.log(`DEBUG: Level ${currentDepth} expansion with ${records.length} records (max depth ${options.maxDepth})`);

	if (currentDepth > options.maxDepth) {
		console.log(`DEBUG: Reached max depth ${options.maxDepth}`);
		return records;
	}

	// Get expandable fields at this level
	const fieldsToProcess = getExpandableFields(linkedFields, options, usedTables);

	if (fieldsToProcess.length === 0) {
		console.log(`DEBUG: No expandable fields at level ${currentDepth}`);
		return records;
	}

	console.log(`DEBUG: Level ${currentDepth} - expanding fields:`,
		fieldsToProcess.map(f => `${f.fieldName} -> ${f.linkedTableName || f.linkedTableId}`));

	// Mark these tables as used for this branch
	const newUsedTables = new Set(usedTables);
	fieldsToProcess.forEach(field => newUsedTables.add(field.linkedTableId));

	// Collect unique record IDs needed for this level only
	const tableRecordIds = new Map<string, Set<string>>();

	for (const field of fieldsToProcess) {
		const tableId = field.linkedTableId;
		if (!tableRecordIds.has(tableId)) {
			tableRecordIds.set(tableId, new Set());
		}

		const recordIdSet = tableRecordIds.get(tableId)!;

		// Collect linked record IDs from all records
		for (const record of records) {
			const fields = record.fields as IDataObject;
			const linkedIds = fields[field.fieldName];

			if (Array.isArray(linkedIds)) {
				for (const id of linkedIds) {
					if (typeof id === 'string' && id.startsWith('rec')) {
						recordIdSet.add(id);
					}
				}
			}
		}
	}

	// Batch fetch records for this level (one API call per table)
	const fetchedRecordsMap = new Map<string, Map<string, IDataObject>>();

	for (const [tableId, recordIds] of tableRecordIds.entries()) {
		if (recordIds.size > 0) {
			console.log(`DEBUG: Level ${currentDepth} - fetching ${recordIds.size} records from table ${tableId}`);
			const recordMap = await fetchLinkedRecords.call(
				this,
				base,
				tableId,
				Array.from(recordIds)
			);
			fetchedRecordsMap.set(tableId, recordMap);
		}
	}

	// Expand records with fetched data
	const expandedRecords = records.map(record => {
		const recordFields = record.fields as IDataObject;
		const fields = { ...recordFields };

		for (const field of fieldsToProcess) {
			const originalLinkedIds = fields[field.fieldName];

			if (Array.isArray(originalLinkedIds)) {
				const tableRecordMap = fetchedRecordsMap.get(field.linkedTableId);
				const expandedRecords: IDataObject[] = [];

				for (const linkedId of originalLinkedIds) {
					if (typeof linkedId === 'string' && tableRecordMap?.has(linkedId)) {
						const linkedRecord = tableRecordMap.get(linkedId)!;

						// Flatten the linked record
						const flattenedRecord = {
							id: linkedRecord.id,
							createdTime: linkedRecord.createdTime,
							...(linkedRecord.fields as IDataObject)
						};

						expandedRecords.push(flattenedRecord);
					}
				}

				// Replace or augment the field
				if (options.includeOriginalIds) {
					fields[`${field.fieldName}_expanded`] = expandedRecords;
				} else {
					fields[field.fieldName] = expandedRecords;
				}
			}
		}

		return {
			...record,
			fields,
		};
	});

	console.log(`DEBUG: Level ${currentDepth} expansion complete`);

	// Recursively expand the next level if we haven't reached max depth
	if (currentDepth < options.maxDepth) {
		console.log(`DEBUG: Preparing level ${currentDepth + 1} expansion`);

		// Collect all records that need further expansion, grouped by table
		const recordsForNextLevel = new Map<string, { records: IDataObject[], linkedFields: LinkedFieldInfo[] }>();

		for (const field of fieldsToProcess) {
			const tableId = field.linkedTableId;

			// Get schema for this table only once
			if (!recordsForNextLevel.has(tableId)) {
				try {
					const { linkedFields: schemaFields } = await getTableSchema.call(this, base, tableId);
					recordsForNextLevel.set(tableId, { records: [], linkedFields: schemaFields });
				} catch (error) {
					console.error(`Error getting schema for table ${tableId}:`, error);
					continue;
				}
			}

			const tableInfo = recordsForNextLevel.get(tableId)!;

			// Collect all expanded records from all main records for this table
			for (const record of expandedRecords) {
				const recordFields = record.fields as IDataObject;
				const expandedFieldData = recordFields[field.fieldName];

				if (Array.isArray(expandedFieldData) && expandedFieldData.length > 0) {
					// Convert expanded records to the format expected by expandLinkedRecords
					const recordsForRecursion = expandedFieldData.map(item => ({
						id: item.id,
						fields: item,
						createdTime: item.createdTime
					}));

					tableInfo.records.push(...recordsForRecursion);
				}
			}
		}

		// Process each table's records together in one recursive call
		const recursiveResults = new Map<string, Map<string, IDataObject>>();

		for (const [tableId, { records: tableRecords, linkedFields: tableLinkedFields }] of recordsForNextLevel.entries()) {
			if (tableRecords.length > 0) {
				console.log(`DEBUG: Recursively expanding ${tableRecords.length} records from table ${tableId}`);

				// Deduplicate records by ID to avoid processing the same record multiple times
				const uniqueRecords = new Map<string, IDataObject>();
				for (const record of tableRecords) {
					uniqueRecords.set(record.id as string, record);
				}

				const recursivelyExpanded = await expandLinkedRecords.call(
					this,
					base,
					Array.from(uniqueRecords.values()),
					tableLinkedFields,
					options,
					currentDepth + 1,
					newUsedTables
				);

				// Store results by record ID for easy lookup
				const resultMap = new Map<string, IDataObject>();
				for (const expandedRecord of recursivelyExpanded) {
					resultMap.set(expandedRecord.id as string, expandedRecord);
				}
				recursiveResults.set(tableId, resultMap);
			}
		}

		// Update original records with recursively expanded data
		const fullyExpandedRecords = expandedRecords.map(record => {
			const recordFields = record.fields as IDataObject;
			const updatedFields = { ...recordFields };

			for (const field of fieldsToProcess) {
				const tableId = field.linkedTableId;
				const expandedFieldData = updatedFields[field.fieldName];
				const recursiveResultMap = recursiveResults.get(tableId);

				if (Array.isArray(expandedFieldData) && recursiveResultMap) {
					const updatedExpandedRecords = expandedFieldData.map(item => {
						const recursiveResult = recursiveResultMap.get(item.id as string);
						if (recursiveResult) {
							// Flatten the recursively expanded record
							return {
								id: recursiveResult.id,
								createdTime: recursiveResult.createdTime,
								...(recursiveResult.fields as IDataObject)
							};
						}
						return item; // Return original if no recursive expansion found
					});

					updatedFields[field.fieldName] = updatedExpandedRecords;
				}
			}

			return {
				...record,
				fields: updatedFields,
			};
		});

		return fullyExpandedRecords;
	}

	return expandedRecords;
}
