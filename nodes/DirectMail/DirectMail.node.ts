import type {
	INodeType,
	INodeTypeDescription,
	IExecuteFunctions,
	INodeExecutionData,
	IDataObject,
	IRequestOptions,
} from 'n8n-workflow';
import { NodeOperationError, NodeConnectionType } from 'n8n-workflow';

export class DirectMail implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Direct Mail',
		name: 'directMail',
		icon: 'file:stannp.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Send letters and postcards via Lob or Stannp',
		defaults: {
			name: 'Direct Mail',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [
			{
				name: 'lobApi',
				required: true,
				displayOptions: {
					show: {
						service: ['lob'],
					},
				},
			},
			{
				name: 'stannpApi',
				required: true,
				displayOptions: {
					show: {
						service: ['stannp'],
					},
				},
			},
		],
		properties: [
			{
				displayName: 'Service',
				name: 'service',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Lob',
						value: 'lob',
						description: 'Use Lob API for direct mail',
					},
					{
						name: 'Stannp',
						value: 'stannp',
						description: 'Use Stannp API for direct mail',
					},
				],
				default: 'lob',
				description: 'Choose the direct mail service provider',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Create Letter',
						value: 'createLetter',
						description: 'Create a letter using the selected service',
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

		for (let i = 0; i < items.length; i++) {
			try {
				const service = this.getNodeParameter('service', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (operation === 'createLetter') {
					// Get common parameters
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

					let responseData;

					if (service === 'stannp') {
						// Stannp API implementation
						const credentials = await this.getCredentials('stannpApi');
						const apiKey = credentials.apiKey as string;
						const server = credentials.server as string || 'us1';

						// Prepare body parameters for Stannp
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

						// Make the Stannp API request
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

						responseData = await this.helpers.request(options);

					} else if (service === 'lob') {
						// Lob API implementation
						const credentials = await this.getCredentials('lobApi');
						const apiKey = credentials.apiKey as string;
						const lobEnvironment = credentials.environment as string || 'test';

						// Prepare body parameters for Lob
						const body: IDataObject = {
							description: `Letter created via N8N - Template: ${template}`,
							to: {
								name: `${firstName} ${lastName}`,
								address_line1: address1,
								...(address2 && { address_line2: address2 }),
								address_city: town,
								address_state: region,
								address_zip: zipcode,
								address_country: country,
							},
							from: template, // In Lob, this would be your return address ID or object
							color: environment === 'test',
						};

						// Add template variables as metadata
						if (templateVariables?.templateVariablesValues?.length) {
							const metadata: IDataObject = {};
							for (const variable of templateVariables.templateVariablesValues) {
								metadata[variable.name] = variable.value;
							}
							body.metadata = metadata;
						}

						// Make the Lob API request
						const options: IRequestOptions = {
							method: 'POST',
							url: 'https://api.lob.com/v1/letters',
							body,
							headers: {
								'Content-Type': 'application/json',
								'Accept': 'application/json',
							},
							auth: {
								username: apiKey,
								password: '',
							},
							json: true,
							resolveWithFullResponse: true,
						};

						responseData = await this.helpers.request(options);
					}

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
