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
import { processRecordFields, type ArrayHandlingOptions } from '../../helpers/arrayHandlingUtils';

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

			// Extract array handling options
			const arrayHandlingOptions: ArrayHandlingOptions = {
				arrayMergeStrategy: options.arrayMergeStrategy as 'replace' | 'append' | 'union' || 'replace',
				arrayFields: options.arrayFields as string[] || [],
			};

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

			// Check if any matching fields contain null/empty values - if so, use enhanced matching logic immediately
			const inputFields = records[0].fields;
			const hasNullMatchFields = columnsToMatchOn.some(column => {
				const value = inputFields[column];
				return value === null || value === undefined || value === '';
			});

			// Use enhanced matching logic when we have null/empty fields OR try native upsert first
			if (hasNullMatchFields && !columnsToMatchOn.includes('id')) {
				// Enhanced matching logic that handles null values more flexibly

				// Check if all matching fields are null/undefined - if so, create new record
				const nonNullMatchFields = columnsToMatchOn.filter(column => {
					const value = inputFields[column];
					return value !== null && value !== undefined && value !== '';
				});

				if (nonNullMatchFields.length === 0) {
					// All match fields are null/empty - create new record
					const createBody = {
						...body,
						records: records.map(({ fields }) => ({ fields: removeEmptyFields(fields) })),
					};
					responseData = await apiRequest.call(this, 'POST', endpoint, createBody);
				} else {
					// Some fields have values - search for matching records
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

					// Use flexible matching logic - consider it a match if non-null fields match
					// and null fields in input can match null fields in existing records
					matches = matches.filter(record => {
						// Check if at least one non-null field matches exactly
						const hasNonNullMatch = nonNullMatchFields.some(column => {
							const inputValue = inputFields[column];
							const recordValue = record.fields[column];
							return String(inputValue) === String(recordValue);
						});

						if (!hasNonNullMatch) return false;

						// For fields that are null in input, they can match null fields in record
						// For fields that have values in input, they must match exactly
						return columnsToMatchOn.every(column => {
							const inputValue = inputFields[column];
							const recordValue = record.fields[column];

							// If input field is null/empty, it can match anything (including null)
							if (inputValue === null || inputValue === undefined || inputValue === '') {
								return true;
							}

							// If input field has a value, it must match exactly
							return String(inputValue) === String(recordValue);
						});
					});

					const updateRecords: UpdateRecord[] = [];

					if (matches.length === 0) {
						// No matches found - create new record
						const createBody = {
							...body,
							records: records.map(({ fields }) => ({ fields: removeEmptyFields(fields) })),
						};
						responseData = await apiRequest.call(this, 'POST', endpoint, createBody);
					} else if (options.updateAllMatches) {
						for (const match of matches) {
							let fieldsToUpdate = records[0].fields;

							// Apply array handling if enabled for existing records
							if (arrayHandlingOptions.arrayMergeStrategy !== 'replace') {
								try {
									fieldsToUpdate = await processRecordFields.call(
										this,
										base,
										table,
										records[0].fields,
										match.fields as IDataObject,
										arrayHandlingOptions,
									);
								} catch (error) {
									console.warn(`Could not apply array handling for record ${match.id}:`, error);
								}
							}

							updateRecords.push({ id: match.id, fields: fieldsToUpdate });
						}
					} else {
						let fieldsToUpdate = records[0].fields;

						// Apply array handling if enabled for existing record
						if (arrayHandlingOptions.arrayMergeStrategy !== 'replace') {
							try {
								fieldsToUpdate = await processRecordFields.call(
									this,
									base,
									table,
									records[0].fields,
									matches[0].fields as IDataObject,
									arrayHandlingOptions,
								);
							} catch (error) {
								console.warn(`Could not apply array handling for record ${matches[0].id}:`, error);
							}
						}

						updateRecords.push({ id: matches[0].id, fields: fieldsToUpdate });
					}

					if (updateRecords.length > 0) {
						responseData = await batchUpdate.call(this, endpoint, body, updateRecords);
					}
				}
			} else {
				// No null/empty fields in matching columns OR using ID-based matching - use standard upsert logic
				try {
					responseData = await batchUpdate.call(this, endpoint, body, records);
				} catch (error) {
					if (error.httpCode === '422' && columnsToMatchOn.includes('id')) {
						const createBody = {
							...body,
							records: records.map(({ fields }) => ({ fields: removeEmptyFields(fields) })),
						};
						responseData = await apiRequest.call(this, 'POST', endpoint, createBody);
					} else if (error?.description?.includes('Cannot update more than one record')) {
						// Fall back to the enhanced matching logic for multiple matches
						const inputFields = records[0].fields;
						const nonNullMatchFields = columnsToMatchOn.filter(column => {
							const value = inputFields[column];
							return value !== null && value !== undefined && value !== '';
						});

						const conditions = nonNullMatchFields.map((column) => {
							const value = inputFields[column];
							const escapedValue = String(value).replace(/'/g, "\\'");
							return `{${column}} = '${escapedValue}'`;
						});

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

						const matches = response.records as UpdateRecord[];
						const updateRecords: UpdateRecord[] = [];

						if (matches.length === 0) {
							// No matches found - create new record
							const createBody = {
								...body,
								records: records.map(({ fields }) => ({ fields: removeEmptyFields(fields) })),
							};
							responseData = await apiRequest.call(this, 'POST', endpoint, createBody);
						} else if (options.updateAllMatches) {
							for (const match of matches) {
								let fieldsToUpdate = records[0].fields;
								if (arrayHandlingOptions.arrayMergeStrategy !== 'replace') {
									try {
										fieldsToUpdate = await processRecordFields.call(
											this,
											base,
											table,
											records[0].fields,
											match.fields as IDataObject,
											arrayHandlingOptions,
										);
									} catch (error) {
										console.warn(`Could not apply array handling for record ${match.id}:`, error);
									}
								}
								updateRecords.push({ id: match.id, fields: fieldsToUpdate });
							}
							responseData = await batchUpdate.call(this, endpoint, body, updateRecords);
						} else {
							let fieldsToUpdate = records[0].fields;
							if (arrayHandlingOptions.arrayMergeStrategy !== 'replace') {
								try {
									fieldsToUpdate = await processRecordFields.call(
										this,
										base,
										table,
										records[0].fields,
										matches[0].fields as IDataObject,
										arrayHandlingOptions,
									);
								} catch (error) {
									console.warn(`Could not apply array handling for record ${matches[0].id}:`, error);
								}
							}
							updateRecords.push({ id: matches[0].id, fields: fieldsToUpdate });
							responseData = await batchUpdate.call(this, endpoint, body, updateRecords);
						}
					} else {
						throw error;
					}
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
