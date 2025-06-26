import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { apiRequest } from '../transport';

export async function getColumns(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
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

	const result: INodePropertyOptions[] = [];

	for (const field of tableData.fields as IDataObject[]) {
		result.push({
			name: field.name as string,
			value: field.name as string,
			description: `Type: ${field.type}`,
		});
	}

	return result;
}

export async function getColumnsWithRecordId(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const returnData = await getColumns.call(this);
	return [
		{
			// eslint-disable-next-line n8n-nodes-base/node-param-display-name-miscased-id, n8n-nodes-base/node-param-display-name-miscased
			name: 'id',
			value: 'id' as string,
			description: 'Type: primaryFieldId',
		},
		...returnData,
	];
}

export async function getColumnsWithoutColumnToMatchOn(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const columnToMatchOn = this.getNodeParameter('columnToMatchOn') as string;
	const returnData = await getColumns.call(this);
	return returnData.filter((column) => column.value !== columnToMatchOn);
}

export async function getAttachmentColumns(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
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

	const result: INodePropertyOptions[] = [];

	for (const field of tableData.fields as IDataObject[]) {
		if (!(field.type as string)?.toLowerCase()?.includes('attachment')) {
			continue;
		}
		result.push({
			name: field.name as string,
			value: field.name as string,
			description: `Type: ${field.type}`,
		});
	}

	return result;
}

export async function getLinkedRecordFields(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
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

	const result: INodePropertyOptions[] = [];

	for (const field of tableData.fields as IDataObject[]) {
		// Check if field type is a linked record (could be 'multipleRecordLinks' or similar)
		if ((field.type as string)?.toLowerCase()?.includes('multiplerecordlinks') ||
		    (field.type as string)?.toLowerCase()?.includes('foreignkey') ||
		    (field.type as string)?.toLowerCase()?.includes('linkedrecord')) {

			// Extract linked table info if available
			const fieldOptions = field.options as IDataObject;
			const linkedTableId = fieldOptions?.linkedTableId as string;
			let description = `Type: ${field.type}`;
			if (linkedTableId) {
				// Find the linked table name for better UX
				const linkedTable = ((response.tables as IDataObject[]) || []).find((table: IDataObject) => {
					return table.id === linkedTableId;
				});
				if (linkedTable) {
					description = `Links to: ${linkedTable.name} (${field.type})`;
				}
			}

			result.push({
				name: field.name as string,
				value: field.name as string,
				description,
			});
		}
	}

	return result;
}

export async function getTableColumns(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	try {
		// Get base from parent context
		const base = this.getNodeParameter('/base', undefined, {
			extractValue: true,
		}) as string;

		// Get target table from current context - should work better in nested collections
		let targetTableId: string;
		try {
			targetTableId = this.getNodeParameter('targetTable', undefined, {
				extractValue: true,
			}) as string;
		} catch (error) {
			console.log('🔍 getTableColumns - Could not access targetTable:', error.message);
			return [];
		}

		if (!targetTableId) {
			return [];
		}

		const response = await apiRequest.call(this, 'GET', `meta/bases/${base}/tables`);

		const tableData = ((response.tables as IDataObject[]) || []).find((table: IDataObject) => {
			return table.id === targetTableId;
		});

		if (!tableData) {
			throw new NodeOperationError(this.getNode(), 'Target table information could not be found!', {
				level: 'warning',
			});
		}

		const result: INodePropertyOptions[] = [];

		for (const field of tableData.fields as IDataObject[]) {
			result.push({
				name: field.name as string,
				value: field.name as string,
				description: `Type: ${field.type}`,
			});
		}

		return result;
	} catch (error) {
		console.error('🔍 ERROR in getTableColumns:', error);
		return [];
	}
}

export async function getTables(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const base = this.getNodeParameter('base', undefined, {
		extractValue: true,
	}) as string;

	const response = await apiRequest.call(this, 'GET', `meta/bases/${base}/tables`);

	const result: INodePropertyOptions[] = [];

	for (const table of (response.tables as IDataObject[]) || []) {
		result.push({
			name: table.name as string,
			value: table.id as string,
			description: `Table ID: ${table.id}`,
		});
	}

	return result;
}

export async function getArrayFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
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

	const result: INodePropertyOptions[] = [];

	for (const field of tableData.fields as IDataObject[]) {
		const fieldType = (field.type as string)?.toLowerCase();

		// Check for linked record fields
		if (fieldType?.includes('multiplerecordlinks') ||
		    fieldType?.includes('foreignkey') ||
		    fieldType?.includes('linkedrecord') ||
		    fieldType === 'multipleRecordLinks') {

			const fieldOptions = field.options as IDataObject;
			const linkedTableId = fieldOptions?.linkedTableId as string;
			let description = 'Linked Records';

			if (linkedTableId) {
				const linkedTable = ((response.tables as IDataObject[]) || []).find((table: IDataObject) => {
					return table.id === linkedTableId;
				});
				if (linkedTable) {
					description = `Linked Records → ${linkedTable.name}`;
				}
			}

			result.push({
				name: field.name as string,
				value: field.name as string,
				description,
			});
		}

		// Check for multi-select fields
		else if (fieldType?.includes('multipleselects') ||
		         fieldType?.includes('multiselect') ||
		         fieldType === 'multipleSelects') {

			result.push({
				name: field.name as string,
				value: field.name as string,
				description: 'Multi-Select Field',
			});
		}
	}

	return result;
}
