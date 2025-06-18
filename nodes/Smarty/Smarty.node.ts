import type {
	INodeType,
	INodeTypeDescription,
	IExecuteFunctions,
	INodeExecutionData,
	IDataObject,
	IRequestOptions,
} from 'n8n-workflow';
import { NodeOperationError, NodeConnectionType } from 'n8n-workflow';

export class Smarty implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Smarty',
		name: 'smarty',
		icon: 'file:smarty.svg',
		group: ['utility'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Verify and validate addresses using SmartyStreets API',
		defaults: {
			name: 'Smarty',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [
			{
				name: 'smartyApi',
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
						name: 'Verify US Address',
						value: 'verifyUSAddress',
						description: 'Verify a US address using SmartyStreets API',
						action: 'Verify a US address',
					},
				],
				default: 'verifyUSAddress',
			},
			// Address input fields
			{
				displayName: 'Street Address',
				name: 'street',
				type: 'string',
				default: '',
				description: 'Street address (e.g., "1 E Main St")',
				required: true,
			},
			{
				displayName: 'Street 2 (Optional)',
				name: 'street2',
				type: 'string',
				default: '',
				description: 'Secondary address line (e.g., "Apt 2", "Suite 100")',
			},
			{
				displayName: 'City',
				name: 'city',
				type: 'string',
				default: '',
				description: 'City name',
			},
			{
				displayName: 'State',
				name: 'state',
				type: 'string',
				default: '',
				description: 'State abbreviation (e.g., "CA", "NY")',
			},
			{
				displayName: 'ZIP Code',
				name: 'zipcode',
				type: 'string',
				default: '',
				description: 'ZIP or ZIP+4 code',
			},
			// Options
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Include Invalid',
						name: 'includeInvalid',
						type: 'boolean',
						default: false,
						description: 'Whether to include invalid addresses in the results',
					},
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

		const credentials = await this.getCredentials('smartyApi');
		const authId = credentials.authId as string;
		const authToken = credentials.authToken as string;
		const license = credentials.license as string || 'us-core-cloud';

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;

				if (operation === 'verifyUSAddress') {
					// Build the request parameters
					const street = this.getNodeParameter('street', i) as string;
					const street2 = this.getNodeParameter('street2', i, '') as string;
					const city = this.getNodeParameter('city', i, '') as string;
					const state = this.getNodeParameter('state', i, '') as string;
					const zipcode = this.getNodeParameter('zipcode', i, '') as string;

					const options = this.getNodeParameter('options', i, {}) as IDataObject;
					const includeInvalid = options.includeInvalid as boolean || false;

					// Build query parameters
					const queryParams: IDataObject = {
						'auth-id': authId,
						'auth-token': authToken,
						'street': street,
					};

					// Add optional parameters if provided
					if (street2) queryParams['street2'] = street2;
					if (city) queryParams['city'] = city;
					if (state) queryParams['state'] = state;
					if (zipcode) queryParams['zipcode'] = zipcode;
					if (includeInvalid) queryParams['include_invalid'] = 'true';

					// Make the API request
					const options_req: IRequestOptions = {
						method: 'GET',
						url: 'https://us-street.api.smartystreets.com/street-address',
						qs: queryParams,
						headers: {
							'Accept': 'application/json',
						},
						json: true,
						resolveWithFullResponse: true,
					};

					const responseData = await this.helpers.request(options_req);

					const executionData = this.helpers.constructExecutionMetaData(
						this.helpers.returnJsonArray(responseData.body || []),
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
