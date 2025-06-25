import type {
	FieldType,
	IDataObject,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	ResourceMapperField,
	ResourceMapperFields,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { apiRequest } from '../transport';

type AirtableSchema = {
	id: string;
	name: string;
	type: string;
	options?: IDataObject;
};

type TypesMap = Partial<Record<FieldType, string[]>>;

const airtableReadOnlyFields = [
	'autoNumber',
	'button',
	'count',
	'createdBy',
	'createdTime',
	'formula',
	'lastModifiedBy',
	'lastModifiedTime',
	'lookup',
	'rollup',
	'externalSyncSource',
	'multipleLookupValues',
];

const airtableTypesMap: TypesMap = {
	string: ['singleLineText', 'multilineText', 'richText', 'email', 'phoneNumber', 'url'],
	number: ['rating', 'percent', 'number', 'duration', 'currency'],
	boolean: ['checkbox'],
	dateTime: ['dateTime', 'date'],
	time: [],
	object: [],
	options: ['singleSelect'],
	array: ['multipleSelects', 'multipleRecordLinks', 'multipleAttachments'],
};

function mapForeignType(foreignType: string, typesMap: TypesMap): FieldType {
	let type: FieldType = 'string';

	for (const nativeType of Object.keys(typesMap)) {
		const mappedForeignTypes = typesMap[nativeType as FieldType];

		if (mappedForeignTypes?.includes(foreignType)) {
			type = nativeType as FieldType;
			break;
		}
	}

	return type;
}

export async function getColumns(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
	const base = this.getNodeParameter('base', undefined, {
		extractValue: true,
	}) as string;

	const tableId = encodeURI(
		this.getNodeParameter('table', undefined, {
			extractValue: true,
		}) as string,
	);

	const response = await apiRequest.call(this, 'GET', `meta/bases/${base}/tables`);

	const tableData = ((response.tables as IDataObject[]) || []).find((table: IDataObject) => {
		return table.id === tableId;
	});

	if (!tableData) {
		throw new NodeOperationError(this.getNode(), 'Table information could not be found!', {
			level: 'warning',
		});
	}

	const fields: ResourceMapperField[] = [];

	const constructOptions = (field: AirtableSchema) => {
		if (field?.options?.choices) {
			return (field.options.choices as IDataObject[]).map((choice) => ({
				name: choice.name,
				value: choice.name,
			})) as INodePropertyOptions[];
		}

		return undefined;
	};

	for (const field of tableData.fields as AirtableSchema[]) {
		const type = mapForeignType(field.type, airtableTypesMap);
		const isReadOnly = airtableReadOnlyFields.includes(field.type);
		const options = constructOptions(field);
		fields.push({
			id: field.name,
			displayName: field.name,
			required: false,
			defaultMatch: false,
			canBeUsedToMatch: true,
			display: true,
			type,
			options,
			readOnly: isReadOnly,
			removed: isReadOnly,
		});
	}

	return { fields };
}

export async function getColumnsWithRecordId(
	this: ILoadOptionsFunctions,
): Promise<ResourceMapperFields> {
	const returnData = await getColumns.call(this);
	return {
		fields: [
			{
				id: 'id',
				displayName: 'id',
				required: false,
				defaultMatch: true,
				display: true,
				type: 'string',
				readOnly: true,
			},
			...returnData.fields,
		],
	};
}

export async function getColumnsForTargetTable(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
	try {
		// FIRST: Check if we already have a preserved schema with actual fields
		// Look through all linked table entries to find a preserved schema
		try {
			const linkedTablesConfig = this.getNodeParameter('linkedTablesConfig', undefined, {}) as any;
			if (linkedTablesConfig?.linkedTables && Array.isArray(linkedTablesConfig.linkedTables)) {
				for (const entry of linkedTablesConfig.linkedTables) {
					const preservedSchema = entry?.columns?.schema;
					if (preservedSchema && Array.isArray(preservedSchema) && preservedSchema.length > 0) {
						console.log(`✅ [Airtable Plus] Using preserved schema with ${preservedSchema.length} fields`);
						return { fields: preservedSchema };
					}
				}
			}
		} catch (e) {
			// Expected when no config exists yet
		}

		// Get the base from the node context - this should always be accessible
		const base = this.getNodeParameter('base', undefined, {
			extractValue: true,
		}) as string;

		// Try multiple approaches to find the target table parameter
		let targetTableParam: string | null = null;

		// Try direct and relative access approaches (usually fail in fixedCollection context)
		const directPaths = ['targetTable', '../targetTable', './targetTable'];
		for (const path of directPaths) {
			if (!targetTableParam) {
				try {
					targetTableParam = this.getNodeParameter(path, undefined, { extractValue: true }) as string;
					break;
				} catch (e) {
					// Expected to fail in most cases for fixedCollection context
				}
			}
		}

		// Try collection path - check all linked table entries
		if (!targetTableParam) {
			try {
				const linkedTablesConfig = this.getNodeParameter('linkedTablesConfig', undefined, {}) as any;
				if (linkedTablesConfig?.linkedTables && Array.isArray(linkedTablesConfig.linkedTables)) {
					for (let i = 0; i < linkedTablesConfig.linkedTables.length; i++) {
						const entry = linkedTablesConfig.linkedTables[i];
						if (entry?.targetTable) {
							if (typeof entry.targetTable === 'object' && entry.targetTable.value) {
								targetTableParam = entry.targetTable.value;
								break;
							} else if (typeof entry.targetTable === 'string') {
								targetTableParam = entry.targetTable;
								break;
							}
						}
					}
				}
			} catch (e) {
				// Failed to access linkedTablesConfig
			}
		}

		// Try legacy approach for backwards compatibility
		if (!targetTableParam) {
			try {
				const rawTargetTableParam = this.getNodeParameter('linkedTablesConfig.linkedTables.0.targetTable', undefined) as any;
				if (rawTargetTableParam && rawTargetTableParam.value) {
					targetTableParam = rawTargetTableParam.value;
				} else if (typeof rawTargetTableParam === 'string') {
					targetTableParam = rawTargetTableParam;
				}
			} catch (e) {
				// Legacy path failed
			}
		}

		if (!targetTableParam) {
			// Return empty fields if no target table is selected yet
			return { fields: [] };
		}

		const targetTableId = encodeURI(targetTableParam);

		const response = await apiRequest.call(this, 'GET', `meta/bases/${base}/tables`);

		const tableData = ((response.tables as IDataObject[]) || []).find((table: IDataObject) => {
			return table.id === targetTableId;
		});

		if (!tableData) {
			throw new NodeOperationError(this.getNode(), 'Target table information could not be found!', {
				level: 'warning',
			});
		}

		const fields: ResourceMapperField[] = [];

		const constructOptions = (field: AirtableSchema) => {
			if (field?.options?.choices) {
				return (field.options.choices as IDataObject[]).map((choice) => ({
					name: choice.name,
					value: choice.name,
				})) as INodePropertyOptions[];
			}

			return undefined;
		};

		for (const field of tableData.fields as AirtableSchema[]) {
			const type = mapForeignType(field.type, airtableTypesMap);
			const isReadOnly = airtableReadOnlyFields.includes(field.type);
			const options = constructOptions(field);
			fields.push({
				id: field.name,
				displayName: field.name,
				required: false,
				defaultMatch: false,
				canBeUsedToMatch: true,
				display: true,
				type,
				options,
				readOnly: isReadOnly,
				removed: isReadOnly,
			});
		}

		return { fields };
	} catch (error) {
		console.error('[Airtable Plus] ERROR in getColumnsForTargetTable:', error);
		// Return empty fields instead of throwing to avoid breaking the UI
		return { fields: [] };
	}
}
