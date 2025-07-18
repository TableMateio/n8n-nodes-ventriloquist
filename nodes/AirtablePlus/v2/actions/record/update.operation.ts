import type {
	IDataObject,
	INodeExecutionData,
	INodeProperties,
	NodeApiError,
	IExecuteFunctions,
} from 'n8n-workflow';

import { updateDisplayOptions, wrapData } from '../../../../../utils/utilities';
import type { UpdateRecord, FieldUpdateOptions, FieldUpdateRule } from '../../helpers/interfaces';
import { findMatches, processAirtableError, removeIgnored, removeEmptyFields, processOutputFieldRenaming } from '../../helpers/utils';
import { apiRequestAllItems, batchUpdate, apiRequest } from '../../transport';
import {
	insertUpdateOptions,
	linkedTargetTable,
	linkedTableColumns,
	createLinkedRecordsField,
} from '../common.descriptions';
import { processRecordFields, type ArrayHandlingOptions } from '../../helpers/arrayHandlingUtils';
import { processFieldUpdateRules } from '../../helpers/fieldHandlingUtils';

export const description: INodeProperties[] = [
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
		displayOptions: {
			show: {
				resource: ['record'],
				operation: ['update'],
			},
		},
	},
];

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

	let tableData: UpdateRecord[] = [];
	if (!columnsToMatchOn.includes('id')) {
		const response = await apiRequestAllItems.call(
			this,
			'GET',
			endpoint,
			{},
			{ fields: columnsToMatchOn },
		);
		tableData = response.records as UpdateRecord[];
	}

	for (let i = 0; i < items.length; i++) {
		let recordId = '';
		try {
			const records: UpdateRecord[] = [];
			const options = this.getNodeParameter('options', i, {});

			// Extract array handling options
			const arrayHandlingOptions: ArrayHandlingOptions = {
				arrayMergeStrategy: options.arrayMergeStrategy as 'replace' | 'append' | 'union' || 'replace',
				arrayFields: options.arrayFields as string[] || [],
			};

									// Extract field update options
			const fieldUpdateStrategy = options.fieldUpdateStrategy as 'standard' | 'custom' || 'standard';
			const fieldUpdateRules: FieldUpdateRule[] = fieldUpdateStrategy === 'custom'
				? ((options.fieldUpdateRules as any)?.rules as FieldUpdateRule[] || [])
				: [];

			console.log('🔍 Field update strategy configuration:', {
				strategy: fieldUpdateStrategy,
				rulesCount: fieldUpdateRules.length,
				rules: fieldUpdateRules
			});

			if (dataMode === 'autoMapInputData') {
				if (columnsToMatchOn.includes('id')) {
					const { id, ...fields } = items[i].json;
					recordId = id as string;

					let processedFields = removeIgnored(fields, options.ignoreFields as string);

					// Apply array handling if enabled
					let existingRecordFields: IDataObject | null = null;
					if (arrayHandlingOptions.arrayMergeStrategy !== 'replace' || fieldUpdateRules.length > 0) {
						// Fetch existing record for array merging and/or field update rules
						try {
							const existingRecord = await apiRequest.call(this, 'GET', `${endpoint}/${recordId}`);
							existingRecordFields = existingRecord.fields as IDataObject;

							// Apply array handling if enabled
							if (arrayHandlingOptions.arrayMergeStrategy !== 'replace') {
								processedFields = await processRecordFields.call(
									this,
									base,
									table,
									processedFields,
									existingRecordFields,
									arrayHandlingOptions,
								);
							}
						} catch (error) {
							// If can't fetch existing record, proceed without array handling
							console.warn(`Could not fetch existing record ${recordId} for array handling:`, error);
						}
					}

					// Apply field update rules if enabled
					if (fieldUpdateRules.length > 0 && existingRecordFields) {
						console.log('🚀 Calling processFieldUpdateRules with:', {
							fieldsToProcess: Object.keys(processedFields),
							existingFieldsKeys: Object.keys(existingRecordFields),
							rulesCount: fieldUpdateRules.length
						});
						processedFields = await processFieldUpdateRules.call(
							this,
							base,
							table,
							processedFields,
							existingRecordFields,
							fieldUpdateRules,
						);
					} else {
						console.log('🚫 NOT calling processFieldUpdateRules:', {
							hasRules: fieldUpdateRules.length > 0,
							hasExistingFields: !!existingRecordFields
						});
					}

					records.push({
						id: recordId,
						fields: processedFields,
					});
				} else {
					const matches = findMatches(
						tableData,
						columnsToMatchOn,
						items[i].json,
						options.updateAllMatches as boolean,
					);

					for (const match of matches) {
						const id = match.id as string;
						let fields = removeIgnored(items[i].json, options.ignoreFields as string);

						// Apply array handling if enabled
						let existingRecordFields: IDataObject | null = null;
						if (arrayHandlingOptions.arrayMergeStrategy !== 'replace' || fieldUpdateRules.length > 0) {
							try {
								const existingRecord = await apiRequest.call(this, 'GET', `${endpoint}/${id}`);
								existingRecordFields = existingRecord.fields as IDataObject;

								// Apply array handling if enabled
								if (arrayHandlingOptions.arrayMergeStrategy !== 'replace') {
									fields = await processRecordFields.call(
										this,
										base,
										table,
										fields,
										existingRecordFields,
										arrayHandlingOptions,
									);
								}
							} catch (error) {
								console.warn(`Could not fetch existing record ${id} for array handling:`, error);
							}
						}

						// Apply field update rules if enabled
						if (fieldUpdateRules.length > 0 && existingRecordFields) {
							fields = await processFieldUpdateRules.call(
								this,
								base,
								table,
								fields,
								existingRecordFields,
								fieldUpdateRules,
							);
						}

						records.push({ id, fields });
					}
				}
			}

			if (dataMode === 'defineBelow') {
				if (columnsToMatchOn.includes('id')) {
					const { id, ...fields } = this.getNodeParameter('columns.value', i, []) as IDataObject;
					recordId = id as string;

					let processedFields = fields;

					// Apply array handling if enabled
					let existingRecordFields: IDataObject | null = null;
					if (arrayHandlingOptions.arrayMergeStrategy !== 'replace' || fieldUpdateRules.length > 0) {
						try {
							const existingRecord = await apiRequest.call(this, 'GET', `${endpoint}/${recordId}`);
							existingRecordFields = existingRecord.fields as IDataObject;

							// Apply array handling if enabled
							if (arrayHandlingOptions.arrayMergeStrategy !== 'replace') {
								processedFields = await processRecordFields.call(
									this,
									base,
									table,
									fields,
									existingRecordFields,
									arrayHandlingOptions,
								);
							}
						} catch (error) {
							console.warn(`Could not fetch existing record ${recordId} for array handling:`, error);
						}
					}

					// Apply field update rules if enabled
					if (fieldUpdateRules.length > 0 && existingRecordFields) {
						processedFields = await processFieldUpdateRules.call(
							this,
							base,
							table,
							processedFields,
							existingRecordFields,
							fieldUpdateRules,
						);
					}

					records.push({ id: recordId, fields: processedFields });
				} else {
					const fields = this.getNodeParameter('columns.value', i, []) as IDataObject;

					const matches = findMatches(
						tableData,
						columnsToMatchOn,
						fields,
						options.updateAllMatches as boolean,
					);

					for (const match of matches) {
						const id = match.id as string;
						let processedFields = removeIgnored(fields, columnsToMatchOn);

						// Apply array handling if enabled
						let existingRecordFields: IDataObject | null = null;
						if (arrayHandlingOptions.arrayMergeStrategy !== 'replace' || fieldUpdateRules.length > 0) {
							try {
								const existingRecord = await apiRequest.call(this, 'GET', `${endpoint}/${id}`);
								existingRecordFields = existingRecord.fields as IDataObject;

								// Apply array handling if enabled
								if (arrayHandlingOptions.arrayMergeStrategy !== 'replace') {
									processedFields = await processRecordFields.call(
										this,
										base,
										table,
										processedFields,
										existingRecordFields,
										arrayHandlingOptions,
									);
								}
							} catch (error) {
								console.warn(`Could not fetch existing record ${id} for array handling:`, error);
							}
						}

						// Apply field update rules if enabled
						if (fieldUpdateRules.length > 0 && existingRecordFields) {
							processedFields = await processFieldUpdateRules.call(
								this,
								base,
								table,
								processedFields,
								existingRecordFields,
								fieldUpdateRules,
							);
						}

						records.push({ id, fields: processedFields });
					}
				}
			}

			const body: IDataObject = { typecast: options.typecast ? true : false };

			// Remove empty/null fields if requested
			if (options.skipEmptyFields) {
				records.forEach(record => {
					record.fields = removeEmptyFields(record.fields);
				});
			}

						const responseData = await batchUpdate.call(this, endpoint, body, records);

			let dataToWrap = responseData.records as IDataObject[];

			// Apply field renaming
			dataToWrap = dataToWrap.map((result) => {
				return processOutputFieldRenaming(
					result,
					options.renameIdField as string,
					options.renameOutputFields as string
				);
			});

			// Include input data if option is enabled
			if (options.includeInputData) {
				dataToWrap = dataToWrap.map((result) => ({
					...items[i].json,
					...result,
				}));
			}

			const executionData = this.helpers.constructExecutionMetaData(
				wrapData(dataToWrap),
				{ itemData: { item: i } },
			);

			returnData.push(...executionData);
		} catch (error) {
			error = processAirtableError(error as NodeApiError, recordId, i);
			if (this.continueOnFail()) {
				returnData.push({ json: { message: error.message, error } });
				continue;
			}
			throw error;
		}
	}

	return returnData;
}
