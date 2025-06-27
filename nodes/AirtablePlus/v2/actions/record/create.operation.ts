import type {
	IDataObject,
	INodeExecutionData,
	INodeProperties,
	IExecuteFunctions,
	NodeApiError,
} from 'n8n-workflow';

import { updateDisplayOptions, wrapData } from '../../../../../utils/utilities';
import { processAirtableError, removeIgnored, removeEmptyFields } from '../../helpers/utils';
import { apiRequest } from '../../transport';
import {
	insertUpdateOptions,
	linkedTargetTable,
	linkedTableColumns,
	createLinkedRecordsField,
} from '../common.descriptions';

export const description: INodeProperties[] = [
	{
		displayName: 'Columns',
		name: 'columns',
		type: 'resourceMapper',
		default: {
			mappingMode: 'defineBelow',
			value: null,
		},
		noDataExpression: true,
		required: true,
		typeOptions: {
			loadOptionsDependsOn: ['table.value', 'base.value'],
			resourceMapper: {
				resourceMapperMethod: 'getColumns',
				mode: 'add',
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
				operation: ['create'],
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

	for (let i = 0; i < items.length; i++) {
		try {
			const options = this.getNodeParameter('options', i, {});

			const body: IDataObject = {
				typecast: options.typecast ? true : false,
			};

			if (dataMode === 'autoMapInputData') {
				body.fields = removeIgnored(items[i].json, options.ignoreFields as string);
			}

			if (dataMode === 'defineBelow') {
				const fields = this.getNodeParameter('columns.value', i, []) as IDataObject;

				body.fields = fields;
			}

			// Remove empty/null fields if requested
			if (options.skipEmptyFields) {
				body.fields = removeEmptyFields(body.fields as IDataObject);
			}

						const responseData = await apiRequest.call(this, 'POST', endpoint, body);

			let dataToWrap: IDataObject;

			// Handle both single record and array responses
			if (Array.isArray(responseData)) {
				// If it's an array, take the first item for single record creation
				dataToWrap = responseData[0] || responseData;
			} else {
				dataToWrap = responseData as IDataObject;
			}

			// Include input data if option is enabled
			if (options.includeInputData) {
				dataToWrap = {
					...dataToWrap,
					inputData: items[i].json,
				};
			}

			const executionData = this.helpers.constructExecutionMetaData(
				wrapData([dataToWrap]),
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
