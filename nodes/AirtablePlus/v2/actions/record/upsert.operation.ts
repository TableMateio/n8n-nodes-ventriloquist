import type {
	IDataObject,
	INodeExecutionData,
	INodeProperties,
	IExecuteFunctions,
	NodeApiError,
} from 'n8n-workflow';

import { updateDisplayOptions, wrapData } from '../../../../../utils/utilities';
import type { UpdateRecord } from '../../helpers/interfaces';
import { processAirtableError, removeIgnored, removeEmptyFields, validateLinkedRecordFields } from '../../helpers/utils';
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
	{
		displayName: 'Matching Strategy',
		name: 'matchingStrategy',
		type: 'options',
		default: 'standard',
		options: [
			{
				name: 'Standard (require all selected columns)',
				value: 'standard',
				description: 'All selected matching columns must have values and match exactly',
			},
			{
				name: 'Flexible (minimum required combinations)',
				value: 'flexible',
				description: 'Ignore null/empty fields and use minimum required field combinations for matching',
			},
		],
		displayOptions: {
			show: {
				'/columns.mappingMode': ['defineBelow', 'autoMapInputData'],
			},
			hide: {
				'/columns.matchingColumns': ['id'],
			},
		},
	},
	{
		displayName: 'Field Combination Rules',
		name: 'requiredCombinations',
		type: 'fixedCollection',
		default: { combinations: [{ fields: [''] }] },
		typeOptions: {
			multipleValues: true,
		},
		description: 'Define which field combinations are acceptable for matching records. If a record has values for all fields in any combination, it will be used for matching. If no combination has complete data, a new record will be created.',
		displayOptions: {
			show: {
				matchingStrategy: ['flexible'],
				'/columns.mappingMode': ['defineBelow', 'autoMapInputData'],
			},
			hide: {
				'/columns.matchingColumns': ['id'],
			},
		},
		options: [
			{
				name: 'combinations',
				displayName: 'Field Combo',
				values: [
					{
								displayName: 'Required Fields',
		name: 'fields',
		type: 'multiOptions',
		typeOptions: {
			loadOptionsDependsOn: ['table.value', 'base.value'],
			loadOptionsMethod: 'getColumns',
		},
						default: [],
						description: 'All selected fields must have non-empty values for this combination to be used for matching',
					},
				],
			},
		],
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
	const matchingStrategy = this.getNodeParameter('matchingStrategy', 0, 'standard') as 'standard' | 'flexible';
	const requiredCombinations = this.getNodeParameter('requiredCombinations', 0, { combinations: [] }) as { combinations: Array<{ fields: string[] }> };

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

			// Only add performUpsert for standard strategy or when using ID matching
			if (!columnsToMatchOn.includes('id') && matchingStrategy === 'standard') {
				body.performUpsert = { fieldsToMergeOn: columnsToMatchOn };
			}

			// Remove empty/null fields if requested
			if (options.skipEmptyFields) {
				records.forEach(record => {
					record.fields = removeEmptyFields(record.fields);
				});
			}

						// Validate linked record fields before attempting upsert
			for (const record of records) {
				const validationResult = await validateLinkedRecordFields.call(
					this,
					base,
					table,
					record.fields,
				);

				if (!validationResult.isValid) {
					const errorMessage = `Linked record validation failed for item ${i}:\n${validationResult.errors.join('\n')}`;
					console.error('🚨 LINKED_RECORD_VALIDATION_ERROR:', errorMessage);

					// Create a detailed error that explains the issue
					const detailedError = new Error(errorMessage);
					(detailedError as any).description = 'One or more linked record fields contain record IDs that belong to the wrong table. Please check that the record IDs you are trying to link match the table that the field is configured to link to.';
					throw detailedError;
				}
			}

			// Validate matching columns for standard strategy
			if (matchingStrategy === 'standard' && !columnsToMatchOn.includes('id') && columnsToMatchOn.length > 0) {
				for (const record of records) {
					const missingColumns: string[] = [];

					for (const column of columnsToMatchOn) {
						const value = record.fields[column];
						if (value === null || value === undefined || value === '') {
							missingColumns.push(column);
						}
					}

					if (missingColumns.length > 0) {
						const errorMessage = `Record for item ${i} is missing values for required matching columns: [${missingColumns.join(', ')}]. ` +
							`When using Standard matching strategy, ALL matching columns must have non-empty values. ` +
							`Consider using Flexible matching strategy if you want to handle records with missing matching field values.`;
						console.error('🚨 MATCHING_COLUMNS_VALIDATION_ERROR:', errorMessage);

						const detailedError = new Error(errorMessage);
						(detailedError as any).description = 'Standard matching strategy requires all matching columns to have values. Switch to Flexible matching strategy or ensure all matching fields have values in your input data.';
						throw detailedError;
					}
				}
			}

			let responseData;

			// Use flexible matching strategy if enabled, otherwise use standard Airtable upsert
			if (matchingStrategy === 'flexible' && !columnsToMatchOn.includes('id')) {
				// Flexible matching logic with minimum required combinations
				const inputFields = records[0].fields;

				console.log('🔧 FLEXIBLE_DEBUG: Input fields:', JSON.stringify(inputFields, null, 2));
				console.log('🔧 FLEXIBLE_DEBUG: Required combinations:', JSON.stringify(requiredCombinations, null, 2));

				// Check which combinations are satisfied (all fields in combination have values)
				const satisfiedCombinations = requiredCombinations.combinations.filter(combination => {
					const isValid = combination.fields.every(field => {
						const value = inputFields[field];
						const hasValue = value !== null && value !== undefined && value !== '';
						console.log(`🔧 FLEXIBLE_DEBUG: Field "${field}" = "${value}" (hasValue: ${hasValue})`);
						return hasValue;
					});
					console.log(`🔧 FLEXIBLE_DEBUG: Combination [${combination.fields.join(', ')}] is valid: ${isValid}`);
					return isValid;
				});

				console.log('🔧 FLEXIBLE_DEBUG: Satisfied combinations:', JSON.stringify(satisfiedCombinations, null, 2));

				if (satisfiedCombinations.length === 0) {
					// No combinations satisfied - create new record
					console.log('🔧 FLEXIBLE_DEBUG: No combinations satisfied - creating new record');
					const createBody = {
						...body,
						records: records.map(({ fields }) => ({ fields: removeEmptyFields(fields) })),
					};
					console.log('🔧 FLEXIBLE_DEBUG: Create body:', JSON.stringify(createBody, null, 2));
					responseData = await apiRequest.call(this, 'POST', endpoint, createBody);
				} else {
					// Use the first satisfied combination for matching
					const fieldsToMatch = satisfiedCombinations[0].fields;
					console.log('🔧 FLEXIBLE_DEBUG: Using fields for matching:', fieldsToMatch);

					// Get all records to check for matches
					const searchParams = {
						fields: fieldsToMatch,
					};
					console.log('🔧 FLEXIBLE_DEBUG: Search params:', JSON.stringify(searchParams, null, 2));

					const response = await apiRequestAllItems.call(
						this,
						'GET',
						endpoint,
						{},
						searchParams,
					);

					let matches = response.records as UpdateRecord[];

					// Client-side filtering - match records where all fields in the combination match exactly
					matches = matches.filter(record => {
						return fieldsToMatch.every(field => {
							const inputValue = inputFields[field];
							const recordValue = record.fields[field];
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
				// Standard matching strategy - use Airtable's native upsert functionality
				try {
					responseData = await batchUpdate.call(this, endpoint, body, records);
				} catch (error) {
					if (error.httpCode === '422' && columnsToMatchOn.includes('id')) {
						const createBody = {
							...body,
							records: records.map(({ fields }) => ({ fields: removeEmptyFields(fields) })),
						};
						responseData = await apiRequest.call(this, 'POST', endpoint, createBody);
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
