import type {
	IDataObject,
	INodeExecutionData,
	INodeProperties,
	IExecuteFunctions,
	NodeApiError,
} from 'n8n-workflow';

import { updateDisplayOptions, wrapData } from '../../../../../utils/utilities';
import type { UpdateRecord } from '../../helpers/interfaces';
import { processAirtableError, removeIgnored, removeEmptyFields } from '../../helpers/utils';
import { apiRequest, apiRequestAllItems, batchUpdate } from '../../transport';
import { insertUpdateOptions } from '../common.descriptions';

const properties: INodeProperties[] = [
	{
		displayName: 'Columns',
		name: 'columns',
		type: 'resourceMapper',
		noDataExpression: true,
		default: {
			mappingMode: 'defineBelow',
			value: null,
		},
		required: true,
		typeOptions: {
			loadOptionsDependsOn: ['table.value', 'base.value'],
			resourceMapper: {
				resourceMapperMethod: 'getColumnsWithRecordId',
				mode: 'update',
				fieldWords: {
					singular: 'column',
					plural: 'columns',
				},
				addAllFields: true,
				multiKeyMatch: true,
			},
		},
	},
	...insertUpdateOptions,
];

const displayOptions = {
	show: {
		resource: ['record'],
		operation: ['upsert'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

export async function execute(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
	base: string,
	table: string,
): Promise<INodeExecutionData[]> {
	const returnData: INodeExecutionData[] = [];

	const endpoint = `${base}/${table}`;

	const dataMode = this.getNodeParameter('columns.mappingMode', 0) as string;

	const columnsToMatchOn = this.getNodeParameter('columns.matchingColumns', 0) as string[];

	for (let i = 0; i < items.length; i++) {
		try {
			const records: UpdateRecord[] = [];
			const options = this.getNodeParameter('options', i, {});

			if (dataMode === 'autoMapInputData') {
				if (columnsToMatchOn.includes('id')) {
					const { id, ...fields } = items[i].json;

					records.push({
						id: id as string,
						fields: removeIgnored(fields, options.ignoreFields as string),
					});
				} else {
					records.push({ fields: removeIgnored(items[i].json, options.ignoreFields as string) });
				}
			}

			if (dataMode === 'defineBelow') {
				const fields = this.getNodeParameter('columns.value', i, []) as IDataObject;

				if (columnsToMatchOn.includes('id')) {
					const id = fields.id as string;
					delete fields.id;
					records.push({ id, fields });
				} else {
					records.push({ fields });
				}
			}

			const body: IDataObject = {
				typecast: options.typecast ? true : false,
			};

			if (!columnsToMatchOn.includes('id')) {
				body.performUpsert = { fieldsToMergeOn: columnsToMatchOn };
			}

			// Remove empty/null fields if requested
			if (options.skipEmptyFields) {
				records.forEach(record => {
					record.fields = removeEmptyFields(record.fields);
				});
			}

			let responseData;
			try {
				responseData = await batchUpdate.call(this, endpoint, body, records);
			} catch (error) {
				if (error.httpCode === '422' && columnsToMatchOn.includes('id')) {
					const createBody = {
						...body,
						records: records.map(({ fields }) => ({ fields })),
					};
					responseData = await apiRequest.call(this, 'POST', endpoint, createBody);
				} else if (error?.description?.includes('Cannot update more than one record')) {
					// Enhanced matching logic that handles null values more flexibly
					const inputFields = records[0].fields;

					// Check if all matching fields are null/undefined - if so, skip this record
					const nonNullMatchFields = columnsToMatchOn.filter(column => {
						const value = inputFields[column];
						return value !== null && value !== undefined && value !== '';
					});

					if (nonNullMatchFields.length === 0) {
						// All match fields are null/empty - skip without error
						console.log('DEBUG: All match fields are null/empty - skipping record');
						const executionData = this.helpers.constructExecutionMetaData(
							[{ json: { skipped: true, reason: 'All match fields are null/empty', input: inputFields } }],
							{ itemData: { item: i } },
						);
						returnData.push(...executionData);
						continue;
					}

					// Build flexible filter conditions - only include non-null fields
					const conditions = nonNullMatchFields.map((column) => {
						const value = inputFields[column];
						// Escape single quotes in values for Airtable formula
						const escapedValue = String(value).replace(/'/g, "\\'");
						return `{${column}} = '${escapedValue}'`;
					});

					// Get all records to check for matches (including null handling)
					const response = await apiRequestAllItems.call(
						this,
						'GET',
						endpoint,
						{},
						{
							fields: columnsToMatchOn,
							filterByFormula: conditions.length > 1 ? `AND(${conditions.join(',')})` : conditions[0],
						},
					);

					let matches = response.records as UpdateRecord[];

					// Additional client-side filtering to handle null-to-null matching
					// This covers cases where Airtable's filterByFormula doesn't handle nulls well
					matches = matches.filter(record => {
						return columnsToMatchOn.every(column => {
							const inputValue = inputFields[column];
							const recordValue = record.fields[column];

							// Both null/undefined/empty - consider a match
							if ((inputValue === null || inputValue === undefined || inputValue === '') &&
								(recordValue === null || recordValue === undefined || recordValue === '')) {
								return true;
							}

							// Both have values - must be equal
							if (inputValue !== null && inputValue !== undefined && inputValue !== '' &&
								recordValue !== null && recordValue !== undefined && recordValue !== '') {
								return String(inputValue) === String(recordValue);
							}

							// One null, one has value - not a match
							return false;
						});
					});

					const updateRecords: UpdateRecord[] = [];

					if (matches.length === 0) {
						// No matches found - this will trigger creation via the original upsert mechanism
						throw error;
					} else if (options.updateAllMatches) {
						updateRecords.push(...matches.map(({ id }) => ({ id, fields: records[0].fields })));
					} else {
						updateRecords.push({ id: matches[0].id, fields: records[0].fields });
					}

					responseData = await batchUpdate.call(this, endpoint, body, updateRecords);
				} else {
					throw error;
				}
			}

			const executionData = this.helpers.constructExecutionMetaData(
				wrapData(responseData.records as IDataObject[]),
				{ itemData: { item: i } },
			);

			returnData.push(...executionData);
		} catch (error) {
			error = processAirtableError(error as NodeApiError, undefined, i);
			if (this.continueOnFail()) {
				returnData.push({ json: { message: error.message, error } });
				continue;
			}
			throw error;
		}
	}

	return returnData;
}
