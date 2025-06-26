import type {
	INodeType,
	INodeTypeDescription,
	IExecuteFunctions,
	INodeExecutionData,
	IDataObject,
	IRequestOptions,
} from 'n8n-workflow';
import { NodeOperationError, NodeConnectionType } from 'n8n-workflow';

// Country code normalization utility
interface CountryCodeMapping {
	[key: string]: string;
}

const COUNTRY_CODE_MAPPINGS: CountryCodeMapping = {
	// Common variations for United States
	'USA': 'US',
	'UNITED STATES': 'US',
	'UNITED STATES OF AMERICA': 'US',
	'US': 'US',
	'AMERICA': 'US',

	// Common variations for Canada
	'CAN': 'CA',
	'CANADA': 'CA',
	'CA': 'CA',

	// Common variations for United Kingdom
	'UK': 'GB',
	'UNITED KINGDOM': 'GB',
	'GREAT BRITAIN': 'GB',
	'BRITAIN': 'GB',
	'ENGLAND': 'GB',
	'SCOTLAND': 'GB',
	'WALES': 'GB',
	'GBR': 'GB',
	'GB': 'GB',

	// Common variations for Germany
	'GERMANY': 'DE',
	'DEUTSCHLAND': 'DE',
	'DEU': 'DE',
	'DE': 'DE',

	// Common variations for France
	'FRANCE': 'FR',
	'FRA': 'FR',
	'FR': 'FR',

	// Common variations for Australia
	'AUSTRALIA': 'AU',
	'AUS': 'AU',
	'AU': 'AU',

	// Common variations for Japan
	'JAPAN': 'JP',
	'JPN': 'JP',
	'JP': 'JP',

	// Add more as needed...
};

function normalizeCountryCode(countryInput: string): string {
	// Handle null, undefined, or empty string
	if (!countryInput || typeof countryInput !== 'string') {
		return 'US'; // Default to US if no country provided
	}

	// Clean up the input: trim whitespace and convert to uppercase
	const normalizedInput = countryInput.trim().toUpperCase();

	// If still empty after trimming, default to US
	if (!normalizedInput) {
		return 'US';
	}

	// Check if it's already a valid 2-letter code (basic validation)
	if (normalizedInput.length === 2 && /^[A-Z]{2}$/.test(normalizedInput)) {
		return normalizedInput;
	}

	// Look up in our mapping
	const mappedCode = COUNTRY_CODE_MAPPINGS[normalizedInput];
	if (mappedCode) {
		return mappedCode;
	}

	// If no mapping found, try to extract just the first 2 letters if it looks like a country code
	if (normalizedInput.length >= 2 && /^[A-Z]+$/.test(normalizedInput)) {
		const firstTwoLetters = normalizedInput.substring(0, 2);
		// Check if first two letters are a valid mapping
		if (COUNTRY_CODE_MAPPINGS[firstTwoLetters]) {
			return COUNTRY_CODE_MAPPINGS[firstTwoLetters];
		}
		// If it's exactly 2 letters, assume it's a country code
		if (normalizedInput.length === 2) {
			return normalizedInput;
		}
	}

	// Last resort: default to US for common US variations
	if (normalizedInput.includes('US') || normalizedInput.includes('AMERICA') || normalizedInput.includes('UNITED')) {
		return 'US';
	}

	// If no mapping found, return US as default (safer than potentially invalid code)
	return 'US';
}

export class Stannp implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Direct Mail',
		name: 'stannp',
		icon: 'file:stannp.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["service"] + " - " + $parameter["operation"]}}',
		description: 'Send letters and postcards via multiple direct mail services (Lob, Stannp)',
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
				description: 'Select the direct mail service provider to use',
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
				displayOptions: {
					show: {
						service: ['stannp'],
					},
				},
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
				description: 'Whether to run in test or production mode (Stannp only - Lob uses credential environment)',
			},
			{
				displayName: 'Template Type',
				name: 'templateType',
				type: 'options',
				displayOptions: {
					show: {
						service: ['lob'],
					},
				},
				options: [
					{
						name: 'Lob Template ID',
						value: 'template_id',
						description: 'Use a template created in Lob Dashboard',
					},
					{
						name: 'HTML Content',
						value: 'html',
						description: 'Provide HTML content directly',
					},
				],
				default: 'template_id',
				description: 'How to specify the letter content for Lob',
			},
			{
				displayName: 'Template ID',
				name: 'template',
				type: 'string',
				displayOptions: {
					show: {
						service: ['stannp'],
					},
				},
				default: '',
				description: 'Your Stannp template ID',
				required: true,
			},
			{
				displayName: 'Lob Template ID',
				name: 'lobTemplateId',
				type: 'string',
				displayOptions: {
					show: {
						service: ['lob'],
						templateType: ['template_id'],
					},
				},
				default: '',
				description: 'Template ID from Lob Dashboard (e.g., tmpl_xxxxxxxxxxxx)',
				required: true,
			},
			{
				displayName: 'HTML Content',
				name: 'htmlContent',
				type: 'string',
				typeOptions: {
					rows: 10,
				},
				displayOptions: {
					show: {
						service: ['lob'],
						templateType: ['html'],
					},
				},
				default: '',
				description: 'HTML content for the letter with merge variables like {{variable_name}}',
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
				description: 'ISO-3166 alpha-2 country code (e.g., "US" for United States, "CA" for Canada, "GB" for United Kingdom). Common variations like "USA" will be automatically converted to "US".',
				required: true,
			},
			// Sender information (Lob only)
			{
				displayName: 'Sender Name',
				name: 'senderName',
				type: 'string',
				displayOptions: {
					show: {
						service: ['lob'],
					},
				},
				default: 'Your Company Name',
				description: 'Name of the sender (required for Lob)',
				required: true,
			},
			{
				displayName: 'Sender Address Line 1',
				name: 'senderAddress1',
				type: 'string',
				displayOptions: {
					show: {
						service: ['lob'],
					},
				},
				default: '',
				description: 'Sender address line 1 (required for Lob)',
				required: true,
			},
			{
				displayName: 'Sender City',
				name: 'senderCity',
				type: 'string',
				displayOptions: {
					show: {
						service: ['lob'],
					},
				},
				default: '',
				description: 'Sender city (required for Lob)',
				required: true,
			},
			{
				displayName: 'Sender State',
				name: 'senderState',
				type: 'string',
				displayOptions: {
					show: {
						service: ['lob'],
					},
				},
				default: '',
				description: 'Sender state (required for Lob)',
				required: true,
			},
			{
				displayName: 'Sender ZIP Code',
				name: 'senderZip',
				type: 'string',
				displayOptions: {
					show: {
						service: ['lob'],
					},
				},
				default: '',
				description: 'Sender ZIP code (required for Lob)',
				required: true,
			},
			{
				displayName: 'Mail Use Type',
				name: 'mailUseType',
				type: 'options',
				displayOptions: {
					show: {
						service: ['lob'],
					},
				},
				options: [
					{
						name: 'Marketing',
						value: 'marketing',
						description: 'Marketing mail (promotional content)',
					},
					{
						name: 'Operational',
						value: 'operational',
						description: 'Operational mail (transactional/account notifications)',
					},
				],
				default: 'operational',
				description: 'Type of mail being sent (required for Lob compliance)',
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
					if (service === 'lob') {
						// Lob API implementation
						const credentials = await this.getCredentials('lobApi');
						const apiKey = credentials.apiKey as string;

						const templateType = this.getNodeParameter('templateType', i) as string;
						let fileContent: string;

						if (templateType === 'template_id') {
							// Use Lob template ID
							fileContent = this.getNodeParameter('lobTemplateId', i) as string;
						} else {
							// Use HTML content
							fileContent = this.getNodeParameter('htmlContent', i) as string;
						}

						const firstName = this.getNodeParameter('recipientFirstName', i) as string;
						const lastName = this.getNodeParameter('recipientLastName', i) as string;
						const address1 = this.getNodeParameter('address1', i) as string;
						const town = this.getNodeParameter('town', i) as string;
						const region = this.getNodeParameter('region', i) as string;
						const zipcode = this.getNodeParameter('zipcode', i) as string;
												const countryRaw = this.getNodeParameter('country', i) as string;
						const country = normalizeCountryCode(countryRaw);

						// Debug logging for country code normalization
						console.log(`🔍 COUNTRY_DEBUG [${this.getNode().name}]: Raw country input: "${countryRaw}"`);
						console.log(`🔍 COUNTRY_DEBUG [${this.getNode().name}]: Normalized country: "${country}"`);
						console.log(`🔍 COUNTRY_DEBUG [${this.getNode().name}]: Country length: ${countryRaw?.length || 'undefined'}`);
						console.log(`🔍 COUNTRY_DEBUG [${this.getNode().name}]: Has trailing space: ${countryRaw?.endsWith(' ') || false}`);

						// Sender information (required for Lob)
						const senderName = this.getNodeParameter('senderName', i) as string;
						const senderAddress1 = this.getNodeParameter('senderAddress1', i) as string;
						const senderCity = this.getNodeParameter('senderCity', i) as string;
						const senderState = this.getNodeParameter('senderState', i) as string;
						const senderZip = this.getNodeParameter('senderZip', i) as string;
						const mailUseType = this.getNodeParameter('mailUseType', i) as string;

						// Optional fields
						const address2 = this.getNodeParameter('address2', i, '') as string;

						// Template variables
						const templateVariables = this.getNodeParameter('templateVariablesUi', i) as {
							templateVariablesValues: Array<{ name: string; value: string }>;
						};

						// Build merge variables for Lob
						const mergeVariables: IDataObject = {};
						if (templateVariables?.templateVariablesValues?.length) {
							for (const variable of templateVariables.templateVariablesValues) {
								mergeVariables[variable.name] = variable.value;
							}
						}

												// Prepare Lob API request body
						const body: IDataObject = {
							description: `Letter for ${firstName} ${lastName}`,
							to: {
								name: `${firstName} ${lastName}`,
								address_line1: address1,
								address_city: town,
								address_state: region,
								address_zip: zipcode,
								address_country: country,
							},
							from: {
								name: senderName,
								address_line1: senderAddress1,
								address_city: senderCity,
								address_state: senderState,
								address_zip: senderZip,
								address_country: "US", // Sender assumed to be US-based for now
							},
							file: fileContent, // Template ID or HTML content
							color: false, // Default to black and white
							double_sided: false, // Default to single sided
							use_type: mailUseType, // Required for Lob compliance
						};

						// Add optional address line 2
						if (address2) {
							(body.to as IDataObject).address_line2 = address2;
						}

						// Add merge variables if provided
						if (Object.keys(mergeVariables).length > 0) {
							body.merge_variables = mergeVariables;
						}

						// Make the Lob API request
						const options: IRequestOptions = {
							method: 'POST',
							url: 'https://api.lob.com/v1/letters',
							body,
							headers: {
								'Content-Type': 'application/json',
								'Accept': 'application/json',
								'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
							},
							json: true,
							resolveWithFullResponse: true,
						};

						const responseData = await this.helpers.request(options);

						const executionData = this.helpers.constructExecutionMetaData(
							this.helpers.returnJsonArray(responseData.body || responseData),
							{ itemData: { item: i } },
						);
						returnData.push(...executionData);

					} else if (service === 'stannp') {
						// Stannp API implementation (existing code)
						const credentials = await this.getCredentials('stannpApi');
						const apiKey = credentials.apiKey as string;
						const server = credentials.server as string || 'us1';

						const environment = this.getNodeParameter('environment', i) as string;
						const template = this.getNodeParameter('template', i) as string;
						const firstName = this.getNodeParameter('recipientFirstName', i) as string;
						const lastName = this.getNodeParameter('recipientLastName', i) as string;
						const address1 = this.getNodeParameter('address1', i) as string;
						const town = this.getNodeParameter('town', i) as string;
						const region = this.getNodeParameter('region', i) as string;
						const zipcode = this.getNodeParameter('zipcode', i) as string;
						const countryRaw = this.getNodeParameter('country', i) as string;
						const country = normalizeCountryCode(countryRaw);

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

						const responseData = await this.helpers.request(options);

						const executionData = this.helpers.constructExecutionMetaData(
							this.helpers.returnJsonArray(responseData.body || responseData),
							{ itemData: { item: i } },
						);
						returnData.push(...executionData);
					}
				}
			} catch (error) {
				const continueOnFail = this.getNodeParameter('options.continueOnFail', i, false) as boolean;

				// Enhanced error handling for country code issues
				let enhancedError = error;
				if (error.message && (
					error.message.includes('ISO-3166') ||
					error.message.includes('country code') ||
					error.message.includes('invalid country')
				)) {
					const countryRaw = this.getNodeParameter('country', i, '') as string;
					const normalizedCountry = normalizeCountryCode(countryRaw);

					enhancedError = new Error(
						`Country code error: "${countryRaw}" was normalized to "${normalizedCountry}" but still failed. ` +
						`Please use a valid ISO-3166 alpha-2 country code (e.g., "US" for United States, "CA" for Canada, "GB" for United Kingdom). ` +
						`Original error: ${error.message}`
					);
					enhancedError.statusCode = error.statusCode;
				}

				if (continueOnFail) {
					const executionErrorData = this.helpers.constructExecutionMetaData(
						this.helpers.returnJsonArray({ error: enhancedError.message }),
						{ itemData: { item: i } },
					);
					returnData.push(...executionErrorData);
					continue;
				}
				throw new NodeOperationError(this.getNode(), enhancedError, {
					itemIndex: i,
				});
			}
		}

		return [returnData];
	}
}
