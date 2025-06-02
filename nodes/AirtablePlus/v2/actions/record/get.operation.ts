import type {
	IDataObject,
	INodeExecutionData,
	INodeProperties,
	NodeApiError,
	IExecuteFunctions,
} from 'n8n-workflow';

import { updateDisplayOptions, wrapData } from '../../../../../utils/utilities';
import type { IRecord } from '../../helpers/interfaces';
import { flattenOutput, processAirtableError } from '../../helpers/utils';
import { apiRequest, downloadRecordAttachments } from '../../transport';
import { getTableSchema, expandLinkedRecords } from '../../helpers/linkedRecordUtils';

const properties: INodeProperties[] = [
	{
		displayName: 'Record ID',
		name: 'id',
		type: 'string',
		default: '',
		placeholder: 'e.g. recf7EaZp707CEc8g',
		required: true,
		// eslint-disable-next-line n8n-nodes-base/node-param-description-miscased-id
		description:
			'ID of the record to get. <a href="https://support.airtable.com/docs/record-id" target="_blank">More info</a>.',
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
				description: 'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
		operation: ['get'],
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

	for (let i = 0; i < items.length; i++) {
		let id;
		try {
			id = this.getNodeParameter('id', i) as string;
			const linkedRecordExpansion = this.getNodeParameter('linkedRecordExpansion', i, {}) as IDataObject;

			console.log('DEBUG: Get operation - linkedRecordExpansion parameter:', JSON.stringify(linkedRecordExpansion, null, 2));

			const responseData = await apiRequest.call(this, 'GET', `${base}/${table}/${id}`);

			const options = this.getNodeParameter('options', 0, {});

			if (options.downloadFields) {
				const itemWithAttachments = await downloadRecordAttachments.call(
					this,
					[responseData] as IRecord[],
					options.downloadFields as string[],
				);
				returnData.push(...itemWithAttachments);
				continue;
			}

			let record = responseData as IDataObject;

			// Check if linked record expansion is requested
			if (linkedRecordExpansion.fieldsToExpand &&
			    Array.isArray(linkedRecordExpansion.fieldsToExpand) &&
			    linkedRecordExpansion.fieldsToExpand.length > 0) {

				console.log('DEBUG: Get operation - Linked record expansion is enabled');
				console.log('DEBUG: Get operation - Fields to expand:', linkedRecordExpansion.fieldsToExpand);

				try {
					// Get table schema to identify linked fields
					const { linkedFields } = await getTableSchema.call(this, base, table);

					console.log('DEBUG: Get operation - Found linked fields:', linkedFields);

					// Set up expansion options
					const expansionOptions = {
						fieldsToExpand: linkedRecordExpansion.fieldsToExpand as string[],
						maxDepth: (linkedRecordExpansion.maxDepth as number) || 1,
						includeOriginalIds: (linkedRecordExpansion.includeOriginalIds as boolean) || false,
					};

					console.log('DEBUG: Get operation - Expansion options:', expansionOptions);

					// Expand linked records - pass single record as array, then extract
					const expandedRecords = await expandLinkedRecords.call(
						this,
						base,
						[record], // Single record as array
						linkedFields,
						expansionOptions
					);

					// Extract the single expanded record
					record = expandedRecords[0] || record;

					console.log('DEBUG: Get operation - Record after expansion:', JSON.stringify(record, null, 2));
				} catch (expansionError) {
					// Log the error but don't fail the entire operation
					console.error('Error expanding linked records in Get operation:', expansionError);
					// Continue with non-expanded record
				}
			} else {
				console.log('DEBUG: Get operation - Linked record expansion is NOT enabled or no fields selected');
			}

			const executionData = this.helpers.constructExecutionMetaData(
				wrapData([flattenOutput(record)]),
				{ itemData: { item: i } },
			);

			returnData.push(...executionData);
		} catch (error) {
			error = processAirtableError(error as NodeApiError, id, i);
			if (this.continueOnFail()) {
				returnData.push({ json: { error: error.message } });
				continue;
			}
			throw error;
		}
	}

	return returnData;
}
