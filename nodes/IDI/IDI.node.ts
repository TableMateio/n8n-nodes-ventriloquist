import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionType,
} from 'n8n-workflow';

import * as formatOperation from './actions/format.operation';

export class IDI implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'IDI',
		name: 'IDI',
		icon: 'file:idi.svg',
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"]}}',
		description: 'Transform IDI skip trace CSV data into normalized contact records',
		defaults: {
			name: 'IDI',
		},
		inputs: ['main' as NodeConnectionType],
		outputs: ['main' as NodeConnectionType],
		credentials: [],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Format',
						value: 'format',
						description: 'Transform IDI CSV data into normalized contact and address records',
						action: 'Transform IDI CSV data',
					},
				],
				default: 'format',
			},
			{
				displayName: 'Input Type',
				name: 'inputType',
				type: 'options',
				options: [
					{
						name: 'CSV File (Binary)',
						value: 'csvFile',
						description: 'Process CSV file from previous node (e.g., from Dropbox)',
					},
					{
						name: 'JSON Data',
						value: 'jsonData',
						description: 'Process JSON data directly from previous node',
					},
				],
				default: 'csvFile',
				displayOptions: {
					show: {
						operation: ['format'],
					},
				},
			},
			{
				displayName: 'Binary Property Name',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property containing the CSV file',
				displayOptions: {
					show: {
						operation: ['format'],
						inputType: ['csvFile'],
					},
				},
			},
			...formatOperation.description,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const operation = this.getNodeParameter('operation', 0);
		const returnData: INodeExecutionData[][] = [[]];

		switch (operation) {
			case 'format':
				for (let i = 0; i < items.length; i++) {
					const result = await formatOperation.execute.call(this, i);
					returnData[0].push(...result);
				}
				break;
			default:
				throw new Error(`The operation "${operation}" is not supported!`);
		}

		return returnData;
	}
}
