import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { apiRequest, apiRequestAllItems } from '../transport';

interface LinkedFieldInfo {
	fieldName: string;
	linkedTableId: string;
	linkedTableName?: string;
}

interface LinkedRecordExpansionOptions {
	fieldsToExpand: string[];
	maxDepth: number;
	includeOriginalIds: boolean;
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

	console.log('DEBUG: All fields from Airtable:', JSON.stringify(allFields, null, 2));

	for (const field of allFields) {
		console.log(`DEBUG: Field "${field.name}" has type: "${field.type}"`);

		// Check if this is a linked record field - try multiple possible type names
		const fieldType = (field.type as string)?.toLowerCase();
		if (fieldType?.includes('multiplerecordlinks') ||
		    fieldType?.includes('linkedrecord') ||
		    fieldType?.includes('foreignkey') ||
		    fieldType?.includes('link') ||
		    fieldType === 'multipleRecordLinks') {

			console.log(`DEBUG: Found linked field "${field.name}" with type "${field.type}"`);

			const fieldOptions = field.options as IDataObject;
			const linkedTableId = fieldOptions?.linkedTableId as string;

			console.log(`DEBUG: Field options for "${field.name}":`, JSON.stringify(fieldOptions, null, 2));

			if (linkedTableId) {
				// Find the linked table name for better debugging
				const linkedTable = ((response.tables as IDataObject[]) || []).find((table: IDataObject) => {
					return table.id === linkedTableId;
				});

				console.log(`DEBUG: Found linked table for "${field.name}": ${linkedTable?.name || 'UNKNOWN'}`);

				linkedFields.push({
					fieldName: field.name as string,
					linkedTableId,
					linkedTableName: linkedTable?.name as string,
				});
			}
		}
	}

	console.log('DEBUG: Final linkedFields array:', JSON.stringify(linkedFields, null, 2));

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
 * Expands linked record fields in the main records with full record data
 */
export async function expandLinkedRecords(
	this: IExecuteFunctions,
	base: string,
	records: IDataObject[],
	linkedFields: LinkedFieldInfo[],
	options: LinkedRecordExpansionOptions,
	currentDepth: number = 1,
): Promise<IDataObject[]> {
	if (currentDepth > options.maxDepth || options.fieldsToExpand.length === 0) {
		return records;
	}

	// Filter to only fields that are both linked and requested for expansion
	const fieldsToProcess = linkedFields.filter(field =>
		options.fieldsToExpand.includes(field.fieldName)
	);

	if (fieldsToProcess.length === 0) {
		return records;
	}

	// Collect all linked record IDs by field
	const linkedRecordIdsByField = collectLinkedRecordIds(records, options.fieldsToExpand);

	// Fetch linked records for each table
	const linkedRecordMaps = new Map<string, Map<string, IDataObject>>();

	for (const field of fieldsToProcess) {
		const recordIds = Array.from(linkedRecordIdsByField.get(field.fieldName) || []);

		if (recordIds.length > 0) {
			const recordMap = await fetchLinkedRecords.call(
				this,
				base,
				field.linkedTableId,
				recordIds
			);
			linkedRecordMaps.set(field.fieldName, recordMap);
		}
	}

	// Expand the records
	const expandedRecords = records.map(record => {
		const recordFields = record.fields as IDataObject;
		const fields = { ...recordFields };

		for (const field of fieldsToProcess) {
			const originalLinkedIds = fields[field.fieldName];

			if (Array.isArray(originalLinkedIds)) {
				const recordMap = linkedRecordMaps.get(field.fieldName);
				const expandedRecords: IDataObject[] = [];

				for (const linkedId of originalLinkedIds) {
					if (typeof linkedId === 'string' && recordMap?.has(linkedId)) {
						const linkedRecord = recordMap.get(linkedId)!;

						// Flatten the linked record to avoid nested 'fields' structure
						const flattenedLinkedRecord = {
							id: linkedRecord.id,
							createdTime: linkedRecord.createdTime,
							...(linkedRecord.fields as IDataObject)
						};

						expandedRecords.push(flattenedLinkedRecord);
					}
				}

				// Replace or augment the field based on options
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

	// If we haven't reached max depth, recursively expand nested linked records
	if (currentDepth < options.maxDepth) {
		// This would require additional logic to handle nested expansion
		// For now, we'll stick to single-level expansion
	}

	return expandedRecords;
}
