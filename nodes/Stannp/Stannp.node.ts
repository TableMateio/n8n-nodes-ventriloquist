import type {
	INodeType,
	INodeTypeDescription,
	IExecuteFunctions,
	INodeExecutionData,
	IDataObject,
	IRequestOptions,
} from 'n8n-workflow';
import { NodeOperationError, NodeConnectionType } from 'n8n-workflow';

export class Stannp implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Stannp',
		name: 'stannp',
		icon: 'file:stannp.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Interact with Stannp API to send letters and postcards',
		defaults: {
			name: 'Stannp',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [
			{
				name: 'stannpApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Create Letter',
						value: 'createLetter',
						description: 'Create a letter using Stannp API',
						action: 'Create a letter',
					},
				],
				default: 'createLetter',
			},
			{
				displayName: 'Environment',
				name: 'environment',
				type: 'options',
				options: [
					{
						name: 'Test',
						value: 'test',
						description: 'Test mode - generates PDF only, nothing is printed or billed',
					},
					{
						name: 'Production',
						value: 'production',
						description: 'Production mode - letter will be printed and billed',
					},
				],
				default: 'test',
				description: 'Whether to run in test or production mode',
			},
			{
				displayName: 'Template ID',
				name: 'template',
				type: 'string',
				default: '',
				description: 'Your template ID',
				required: true,
			},
			// Recipient information
			{
				displayName: 'Recipient First Name',
				name: 'recipientFirstName',
				type: 'string',
				default: '',
				description: 'First name of the recipient',
				required: true,
			},
			{
				displayName: 'Recipient Last Name',
				name: 'recipientLastName',
				type: 'string',
				default: '',
				description: 'Last name of the recipient',
				required: true,
			},
			{
				displayName: 'Address Line 1',
				name: 'address1',
				type: 'string',
				default: '',
				description: 'First line of the address',
				required: true,
			},
			{
				displayName: 'Address Line 2 (Optional)',
				name: 'address2',
				type: 'string',
				default: '',
				description: 'Second line of the address',
			},
			{
				displayName: 'Address Line 3 (Optional)',
				name: 'address3',
				type: 'string',
				default: '',
				description: 'Third line of the address',
			},
			{
				displayName: 'City/Town',
				name: 'town',
				type: 'string',
				default: '',
				description: 'City or town',
				required: true,
			},
			{
				displayName: 'State/Region',
				name: 'region',
				type: 'string',
				default: '',
				description: 'State or region',
				required: true,
			},
			{
				displayName: 'ZIP/Postal Code',
				name: 'zipcode',
				type: 'string',
				default: '',
				description: 'ZIP or postal code',
				required: true,
			},
			{
				displayName: 'Country',
				name: 'country',
				type: 'string',
				default: 'US',
				description: 'Country code (e.g. US)',
				required: true,
			},
			// Template variables section
			{
				displayName: 'Template Variables',
				name: 'templateVariablesUi',
				placeholder: 'Add Template Variable',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
					sortable: true,
				},
				default: {},
				options: [
					{
						name: 'templateVariablesValues',
						displayName: 'Variables',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
								description: 'Name of the variable as it appears in your template (without brackets)',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								description: 'Value to set for this variable',
							},
						],
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Continue On Fail',
						name: 'continueOnFail',
						type: 'boolean',
						default: false,
						description: 'Whether to continue workflow execution when the API request fails',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('stannpApi');
		const apiKey = credentials.apiKey as string;
		const server = credentials.server as string || 'us1';

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;

				if (operation === 'createLetter') {
					// Build the request parameters
					const environment = this.getNodeParameter('environment', i) as string;
					const template = this.getNodeParameter('template', i) as string;
					const firstName = this.getNodeParameter('recipientFirstName', i) as string;
					const lastName = this.getNodeParameter('recipientLastName', i) as string;
					const address1 = this.getNodeParameter('address1', i) as string;
					const town = this.getNodeParameter('town', i) as string;
					const region = this.getNodeParameter('region', i) as string;
					const zipcode = this.getNodeParameter('zipcode', i) as string;
					const country = this.getNodeParameter('country', i) as string;

					// Optional fields
					const address2 = this.getNodeParameter('address2', i, '') as string;
					const address3 = this.getNodeParameter('address3', i, '') as string;

					// Template variables
					const templateVariables = this.getNodeParameter('templateVariablesUi', i) as {
						templateVariablesValues: Array<{ name: string; value: string }>;
					};

					// Prepare body parameters
					const body: IDataObject = {
						test: environment === 'test' ? '1' : '0',
						template,
						'recipient[firstname]': firstName,
						'recipient[lastname]': lastName,
						'recipient[address1]': address1,
						'recipient[town]': town,
						'recipient[region]': region,
						'recipient[zipcode]': zipcode,
						'recipient[country]': country,
					};

					// Add optional address fields if provided
					if (address2) {
						body['recipient[address2]'] = address2;
					}

					if (address3) {
						body['recipient[address3]'] = address3;
					}

					// Add template variables
					if (templateVariables?.templateVariablesValues?.length) {
						for (const variable of templateVariables.templateVariablesValues) {
							body[`recipient[${variable.name}]`] = variable.value;
						}
					}

					// Make the API request
					const options: IRequestOptions = {
						method: 'POST',
						url: `https://api-${server}.stannp.com/v1/letters/create`,
						body,
						headers: {
							'Content-Type': 'application/x-www-form-urlencoded',
							'Accept': 'application/json',
						},
						auth: {
							username: apiKey,
							password: '',
						},
						json: true,
						resolveWithFullResponse: true,
					};

					// Using the request method directly with Basic Auth
					const responseData = await this.helpers.request(options);

					const executionData = this.helpers.constructExecutionMetaData(
						this.helpers.returnJsonArray(responseData.body || responseData),
						{ itemData: { item: i } },
					);
					returnData.push(...executionData);
				}
			} catch (error) {
				const continueOnFail = this.getNodeParameter('options.continueOnFail', i, false) as boolean;
				if (continueOnFail) {
					const executionErrorData = this.helpers.constructExecutionMetaData(
						this.helpers.returnJsonArray({ error: error.message }),
						{ itemData: { item: i } },
					);
					returnData.push(...executionErrorData);
					continue;
				}
				throw new NodeOperationError(this.getNode(), error, {
					itemIndex: i,
				});
			}
		}

		return [returnData];
	}
}
