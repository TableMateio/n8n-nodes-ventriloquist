import type {
	IDataObject,
	INodeExecutionData,
	INodeProperties,
	NodeApiError,
	IExecuteFunctions,
} from 'n8n-workflow';

import { updateDisplayOptions, wrapData } from '../../../../../utils/utilities';
import { processAirtableError } from '../../helpers/utils';
import { apiRequest } from '../../transport';

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
			'ID of the record to delete. <a href="https://support.airtable.com/docs/record-id" target="_blank">More info</a>.',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		default: {},
		description: 'Additional options',
		placeholder: 'Add option',
		options: [
			{
				displayName: 'Include Input Data',
				name: 'includeInputData',
				type: 'boolean',
				default: false,
				description: 'Whether to include the original input data alongside the Airtable response data',
			},
		],
	},
];

const displayOptions = {
	show: {
		resource: ['record'],
		operation: ['deleteRecord'],
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
			const options = this.getNodeParameter('options', i, {});

						const responseData = await apiRequest.call(this, 'DELETE', `${base}/${table}/${id}`);

			let dataToWrap = responseData as IDataObject[];

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
