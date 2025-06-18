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
			{
				name: 'googleApi',
				required: false,
				displayOptions: {
					show: {
						'options.useGoogleFallback': [true],
					},
				},
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
						displayName: 'Use Google Fallback',
						name: 'useGoogleFallback',
						type: 'boolean',
						default: false,
						description: 'Try Google Geocoding API if SmartyStreets fails. Great for rural addresses and properties that exist but don\'t receive mail delivery. Requires Google API credential with Geocoding API enabled.',
					},
					{
						displayName: 'Always Return Data',
						name: 'alwaysReturnData',
						type: 'boolean',
						default: true,
						description: 'Whether to always return data even when address cannot be verified (prevents empty output)',
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
					const useGoogleFallback = options.useGoogleFallback as boolean || false;
					const alwaysReturnData = options.alwaysReturnData as boolean || true;

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

										// Handle response - SmartyStreets returns empty array for unverifiable addresses
					let resultData = responseData.body || [];

					// If no results and Google fallback is enabled, try Google Places API
					if (Array.isArray(resultData) && resultData.length === 0 && useGoogleFallback) {
						try {
							const googleCredentials = await this.getCredentials('googleApi');
							const googleApiKey = googleCredentials.apiKey as string;

							// Build full address string for Google
							const fullAddress = [street, street2, city, state, zipcode].filter(Boolean).join(', ');

							// Make Google Places API request
							const googleOptions: IRequestOptions = {
								method: 'GET',
								url: 'https://maps.googleapis.com/maps/api/geocode/json',
								qs: {
									address: fullAddress,
									key: googleApiKey,
								},
								headers: {
									'Accept': 'application/json',
								},
								json: true,
								resolveWithFullResponse: true,
							};

							const googleResponse = await this.helpers.request(googleOptions);

														if (googleResponse.body?.results?.length > 0) {
								// Transform Google response to SmartyStreets format
								resultData = googleResponse.body.results.map((result: any) => {
									const addressComponents = result.address_components || [];
									const geometry = result.geometry || {};
									const location = geometry.location || {};

									// Parse address components
									const streetNumber = addressComponents.find((comp: any) => comp.types.includes('street_number'))?.long_name || '';
									const route = addressComponents.find((comp: any) => comp.types.includes('route'))?.long_name || '';
									const city = addressComponents.find((comp: any) => comp.types.includes('locality'))?.long_name || '';
									const state = addressComponents.find((comp: any) => comp.types.includes('administrative_area_level_1'))?.short_name || '';
									const zipcode = addressComponents.find((comp: any) => comp.types.includes('postal_code'))?.long_name || '';
									const county = addressComponents.find((comp: any) => comp.types.includes('administrative_area_level_2'))?.long_name || '';

									// Build delivery line
									const deliveryLine = [streetNumber, route].filter(Boolean).join(' ');
									const lastLine = [city, state, zipcode].filter(Boolean).join(' ');

									// Determine precision based on Google's location_type
									const locationType = geometry.location_type || 'APPROXIMATE';
									let precision = 'Unknown';
									switch (locationType) {
										case 'ROOFTOP': precision = 'Zip9'; break;
										case 'RANGE_INTERPOLATED': precision = 'Zip7'; break;
										case 'GEOMETRIC_CENTER': precision = 'Zip5'; break;
										case 'APPROXIMATE': precision = 'Zip5'; break;
									}

									return {
										input_index: 0,
										candidate_index: 0,
										delivery_line_1: deliveryLine,
										last_line: lastLine,
										delivery_point_barcode: '',
										components: {
											primary_number: streetNumber,
											street_name: route.replace(/\s+(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Ln|Lane|Ct|Court|Pl|Place|Way|Blvd|Boulevard)$/i, ''),
											street_suffix: route.match(/\s+(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Ln|Lane|Ct|Court|Pl|Place|Way|Blvd|Boulevard)$/i)?.[1] || '',
											city_name: city,
											default_city_name: city,
											state_abbreviation: state,
											zipcode: zipcode.split('-')[0] || '',
											plus4_code: zipcode.split('-')[1] || '',
										},
										metadata: {
											record_type: 'G', // 'G' for Google
											zip_type: 'Standard',
											county_fips: '',
											county_name: county.replace(/\s+County$/i, ''),
											carrier_route: '',
											congressional_district: '',
											rdi: 'Unknown',
											elot_sequence: '',
											elot_sort: '',
											latitude: location.lat || 0,
											longitude: location.lng || 0,
											precision: precision,
											time_zone: 'Unknown',
											utc_offset: 0,
											dst: false
										},
										analysis: {
											dpv_match_code: 'G', // 'G' for Google verification
											dpv_footnotes: 'GOOGLE',
											dpv_cmra: 'N',
											dpv_vacant: 'Unknown',
											dpv_no_stat: 'N',
											active: 'Y'
										},
										verification_status: 'google_verified',
										api_status_code: 200,
										api_provider: 'google_places',
										place_id: result.place_id,
										formatted_address: result.formatted_address,
										location_type: locationType
									};
								});
							}
						} catch (googleError) {
							// Google fallback failed, add error details to the response
							console.log('Google fallback failed:', googleError.message);

							// If alwaysReturnData is true, include Google error details
							if (alwaysReturnData) {
								resultData = [{
									verification_status: 'unverified',
									input_street: street,
									input_street2: street2,
									input_city: city,
									input_state: state,
									input_zipcode: zipcode,
									message: 'SmartyStreets failed, Google fallback also failed',
									api_response: 'google_fallback_error',
									api_status_code: responseData.statusCode,
									query_sent: queryParams,
									google_error: googleError.message,
									google_error_type: googleError.name || 'Unknown'
								}];
							}
						}
					}

					// If still no results and alwaysReturnData is true, return input data with verification status
					if (Array.isArray(resultData) && resultData.length === 0 && alwaysReturnData) {
						resultData = [{
							verification_status: 'unverified',
							input_street: street,
							input_street2: street2,
							input_city: city,
							input_state: state,
							input_zipcode: zipcode,
							message: useGoogleFallback ?
								'Address could not be verified by SmartyStreets or Google APIs' :
								'Address could not be verified by SmartyStreets API',
							api_response: 'empty_result',
							api_status_code: responseData.statusCode,
							query_sent: queryParams
						}];
					} else if (Array.isArray(resultData) && resultData.length > 0) {
						// Add verification status to successful results
						resultData = resultData.map((result: any) => ({
							...result,
							verification_status: result.verification_status || 'verified',
							api_status_code: result.api_status_code || responseData.statusCode
						}));
					}

					const executionData = this.helpers.constructExecutionMetaData(
						this.helpers.returnJsonArray(resultData),
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
