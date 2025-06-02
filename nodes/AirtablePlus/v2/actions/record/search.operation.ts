import type {
	IDataObject,
	INodeExecutionData,
	INodeProperties,
	IExecuteFunctions,
} from 'n8n-workflow';

import { generatePairedItemData, updateDisplayOptions } from '../../../../../utils/utilities';
import type { IRecord } from '../../helpers/interfaces';
import { flattenOutput } from '../../helpers/utils';
import { apiRequest, apiRequestAllItems, downloadRecordAttachments } from '../../transport';
import { viewRLC } from '../common.descriptions';
import { getTableSchema, expandLinkedRecords } from '../../helpers/linkedRecordUtils';

const properties: INodeProperties[] = [
	{
		displayName: 'Filter By Formula',
		name: 'filterByFormula',
		type: 'string',
		default: '',
		placeholder: "e.g. NOT({Name} = 'Admin')",
		hint: 'If empty, all the records will be returned',
		description:
			'The formula will be evaluated for each record, and if the result is not 0, false, "", NaN, [], or #Error! the record will be included in the response. <a href="https://support.airtable.com/docs/formula-field-reference" target="_blank">More info</a>.',
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: true,
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		displayOptions: {
			show: {
				returnAll: [false],
			},
		},
		typeOptions: {
			minValue: 1,
			maxValue: 100,
		},
		default: 100,
		description: 'Max number of results to return',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		default: {},
		description: 'Additional options which decide which records should be returned',
		placeholder: 'Add option',
		options: [
			{
				// eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-multi-options
				displayName: 'Download Attachments',
				name: 'downloadFields',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getAttachmentColumns',
					loadOptionsDependsOn: ['base.value', 'table.value'],
				},
				default: [],
				// eslint-disable-next-line n8n-nodes-base/node-param-description-wrong-for-dynamic-multi-options
				description: "The fields of type 'attachment' that should be downloaded",
			},
			{
				// eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-multi-options
				displayName: 'Output Fields',
				name: 'fields',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getColumns',
					loadOptionsDependsOn: ['base.value', 'table.value'],
				},
				default: [],
				// eslint-disable-next-line n8n-nodes-base/node-param-description-wrong-for-dynamic-multi-options
				description: 'The fields you want to include in the output',
			},
			viewRLC,
		],
	},
	{
		displayName: 'Sort',
		name: 'sort',
		placeholder: 'Add Sort Rule',
		description: 'Defines how the returned records should be ordered',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
		},
		default: {},
		options: [
			{
				name: 'property',
				displayName: 'Property',
				values: [
					{
						// eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options
						displayName: 'Field',
						name: 'field',
						type: 'options',
						typeOptions: {
							loadOptionsMethod: 'getColumns',
							loadOptionsDependsOn: ['base.value', 'table.value'],
						},
						default: '',
						description:
							'Name of the field to sort on. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					{
						displayName: 'Direction',
						name: 'direction',
						type: 'options',
						options: [
							{
								name: 'ASC',
								value: 'asc',
								description: 'Sort in ascending order (small -> large)',
							},
							{
								name: 'DESC',
								value: 'desc',
								description: 'Sort in descending order (large -> small)',
							},
						],
						default: 'asc',
						description: 'The sort direction',
					},
				],
			},
		],
	},
	{
		displayName: 'Linked Record Expansion',
		name: 'linkedRecordExpansion',
		type: 'collection',
		default: {},
		description: 'Options for expanding linked records within the results',
		placeholder: 'Add linked record options',
		options: [
			{
				displayName: 'Expand Linked Fields',
				name: 'fieldsToExpand',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getLinkedRecordFields',
					loadOptionsDependsOn: ['base.value', 'table.value'],
				},
				default: [],
				description: 'Select which linked record fields to expand with full record data',
			},
			{
				displayName: 'Max Expansion Depth',
				name: 'maxDepth',
				type: 'number',
				typeOptions: {
					minValue: 1,
					maxValue: 3,
				},
				default: 1,
				description: 'Maximum depth to expand nested linked records (1-3 levels)',
			},
			{
				displayName: 'Include Original IDs',
				name: 'includeOriginalIds',
				type: 'boolean',
				default: false,
				description: 'Whether to preserve the original linked record IDs alongside expanded data',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['record'],
		operation: ['search'],
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
	const nodeVersion = this.getNode().typeVersion;

	const endpoint = `${base}/${table}`;

	let itemsLength = items.length ? 1 : 0;
	let fallbackPairedItems;

	if (nodeVersion >= 2.1) {
		itemsLength = items.length;
	} else {
		fallbackPairedItems = generatePairedItemData(items.length);
	}

	for (let i = 0; i < itemsLength; i++) {
		try {
			const returnAll = this.getNodeParameter('returnAll', i);
			const options = this.getNodeParameter('options', i, {});
			const sort = this.getNodeParameter('sort', i, {}) as IDataObject;
			const filterByFormula = this.getNodeParameter('filterByFormula', i) as string;
			const linkedRecordExpansion = this.getNodeParameter('linkedRecordExpansion', i, {}) as IDataObject;

			const body: IDataObject = {};
			const qs: IDataObject = {};

			if (filterByFormula) {
				qs.filterByFormula = filterByFormula;
			}

			if (options.fields) {
				if (typeof options.fields === 'string') {
					qs.fields = options.fields.split(',').map((field) => field.trim());
				} else {
					qs.fields = options.fields as string[];
				}
			}

			if (sort.property) {
				qs.sort = sort.property;
			}

			if (options.view) {
				qs.view = (options.view as IDataObject).value as string;
			}

			let responseData;

			if (returnAll) {
				responseData = await apiRequestAllItems.call(this, 'GET', endpoint, body, qs);
			} else {
				qs.maxRecords = this.getNodeParameter('limit', i);
				responseData = await apiRequest.call(this, 'GET', endpoint, body, qs);
			}

			if (options.downloadFields) {
				const itemWithAttachments = await downloadRecordAttachments.call(
					this,
					responseData.records as IRecord[],
					options.downloadFields as string[],
					fallbackPairedItems || [{ item: i }],
				);
				returnData.push(...itemWithAttachments);
				continue;
			}

			let records = responseData.records as IDataObject[];

			// Check if linked record expansion is requested
			console.log('DEBUG: linkedRecordExpansion parameter:', JSON.stringify(linkedRecordExpansion, null, 2));

			if (linkedRecordExpansion.fieldsToExpand &&
			    Array.isArray(linkedRecordExpansion.fieldsToExpand) &&
			    linkedRecordExpansion.fieldsToExpand.length > 0) {

				console.log('DEBUG: Linked record expansion is enabled');
				console.log('DEBUG: Fields to expand:', linkedRecordExpansion.fieldsToExpand);

				try {
					// Get table schema to identify linked fields
					const { linkedFields } = await getTableSchema.call(this, base, table);

					console.log('DEBUG: Found linked fields:', linkedFields);

					// Set up expansion options
					const expansionOptions = {
						fieldsToExpand: linkedRecordExpansion.fieldsToExpand as string[],
						maxDepth: (linkedRecordExpansion.maxDepth as number) || 1,
						includeOriginalIds: (linkedRecordExpansion.includeOriginalIds as boolean) || false,
					};

					console.log('DEBUG: Expansion options:', expansionOptions);

					// Expand linked records
					records = await expandLinkedRecords.call(
						this,
						base,
						records,
						linkedFields,
						expansionOptions
					);

					console.log('DEBUG: Records after expansion:', JSON.stringify(records.slice(0, 1), null, 2));
				} catch (expansionError) {
					// Log the error but don't fail the entire operation
					console.error('Error expanding linked records:', expansionError);
					// Continue with non-expanded records
				}
			} else {
				console.log('DEBUG: Linked record expansion is NOT enabled or no fields selected');
			}

			const convertedRecords = records.map((record) => ({
				json: flattenOutput(record),
			})) as INodeExecutionData[];

			const itemData = fallbackPairedItems || [{ item: i }];

			const executionData = this.helpers.constructExecutionMetaData(convertedRecords, {
				itemData,
			});

			returnData.push(...executionData);
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({ json: { message: error.message, error }, pairedItem: { item: i } });
				continue;
			} else {
				throw error;
			}
		}
	}

	return returnData;
}
