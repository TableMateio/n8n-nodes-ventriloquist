import type {
	INodeType,
	INodeTypeDescription,
	IExecuteFunctions,
	INodeExecutionData,
	IDataObject,
	IRequestOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export class Smarty implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Smarty',
		name: 'smarty',
		icon: 'file:smarty.svg',
		group: ['utility'],
		version: [1],
		subtitle: '={{$parameter["operation"]}}',
		description: 'Verify a US address using Google Geocoding API with FREE USPS mail safety validation',
		defaults: {
			name: 'Smarty',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'googleApi',
				required: true,
			},
			{
				name: 'uspsApi',
				required: false,
				displayOptions: {
					show: {
						'options.useUspsMailSafety': [true],
					},
				},
			},
			{
				name: 'smartyApi',
				required: false,
				displayOptions: {
					show: {
						'options.useSmartyFallback': [true],
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
						description: 'Verify a US address using Google Geocoding API with FREE USPS mail safety validation',
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
						displayName: 'Use USPS Mail Safety Check',
						name: 'useUspsMailSafety',
						type: 'boolean',
						default: true,
						description: 'Validate addresses without house numbers using FREE USPS API for mail deliverability. Ensures addresses can actually receive mail. No monthly fees!',
					},
					{
						displayName: 'Attempt Abbreviation Expansion',
						name: 'attemptAbbreviationExpansion',
						type: 'boolean',
						default: true,
						description: 'Automatically expand common street abbreviations (CR→County Road, SH→State Highway) when Google finds no results. Only expands addresses with house numbers for safety.',
					},
					{
						displayName: 'Use SmartyStreets Fallback',
						name: 'useSmartyFallback',
						type: 'boolean',
						default: false,
						description: 'Try SmartyStreets if Google fails. Provides CASS certification and postal delivery validation for bulk mail campaigns. Requires active SmartyStreets subscription.',
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
					{
						displayName: 'Include Input Data',
						name: 'includeInputData',
						type: 'boolean',
						default: false,
						description: 'Whether to include the original input data at the top level of the output along with the verification results',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const googleCredentials = await this.getCredentials('googleApi');
		const googleApiKey = googleCredentials.apiKey as string;

		// Helper function to validate address with USPS API for mail deliverability
		const validateWithUSPS = async (address: string, useUspsMailSafety: boolean): Promise<{isDeliverable: boolean, uspsData?: any, error?: string}> => {
			if (!useUspsMailSafety) {
				return { isDeliverable: true }; // Skip validation if not enabled
			}

			try {
				const uspsCredentials = await this.getCredentials('uspsApi');
				const consumerKey = uspsCredentials.consumerKey as string;
				const consumerSecret = uspsCredentials.consumerSecret as string;

				// Parse address components for USPS API
				const addressParts = address.split(',').map(part => part.trim());
				const streetAddress = addressParts[0] || '';
				const cityStateZip = addressParts.slice(1).join(', ');

				// Try to extract city, state, and zip from the remaining parts
				const cityStateZipMatch = cityStateZip.match(/^(.+?),?\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/);
				const city = cityStateZipMatch?.[1] || '';
				const state = cityStateZipMatch?.[2] || '';
				const zip = cityStateZipMatch?.[3] || '';

				// Get OAuth token first (simplified for now - in production, should cache this)
				const tokenOptions: IRequestOptions = {
					method: 'POST',
					url: 'https://api.usps.com/oauth2/v3/token',
					headers: {
						'Content-Type': 'application/json',
						'Accept': 'application/json',
					},
					body: {
						client_id: consumerKey,
						client_secret: consumerSecret,
						grant_type: 'client_credentials'
					},
					json: true,
					resolveWithFullResponse: true,
				};

				const tokenResponse = await this.helpers.request(tokenOptions);
				const accessToken = tokenResponse.body?.access_token;

				if (!accessToken) {
					return { isDeliverable: false, error: 'USPS OAuth token error' };
				}

				// Build address validation request
				const requestBody = {
					streetAddress: streetAddress,
					city: city,
					state: state,
					ZIPCode: zip.split('-')[0] || '',
					ZIPPlus4: zip.split('-')[1] || ''
				};

				const uspsOptions: IRequestOptions = {
					method: 'POST',
					url: 'https://api.usps.com/addresses/v3/address',
					headers: {
						'Authorization': `Bearer ${accessToken}`,
						'Content-Type': 'application/json',
						'Accept': 'application/json',
					},
					body: requestBody,
					json: true,
					resolveWithFullResponse: true,
				};

				const uspsResponse = await this.helpers.request(uspsOptions);
				const responseData = uspsResponse.body;

				// Check if the response indicates a valid address
				if (responseData && responseData.streetAddress && responseData.city && responseData.state) {
					const uspsData = {
						streetAddress: responseData.streetAddress,
						city: responseData.city,
						state: responseData.state,
						zipCode: responseData.ZIPCode,
						zipPlus4: responseData.ZIPPlus4,
						deliveryPoint: responseData.deliveryPoint,
						checkDigit: responseData.checkDigit,
						raw_response: responseData
					};

					return { isDeliverable: true, uspsData };
				}

				return { isDeliverable: false, error: 'USPS could not verify address' };

			} catch (error) {
				// Log the full error for debugging
				console.log('USPS API Error Details:', error.response?.body || error.message);
				return { isDeliverable: false, error: `USPS API error: ${error.message}` };
			}
		};

		// Helper function to determine if Google result represents a deliverable address
		const isDeliverableAddress = (result: any) => {
			const types = result.types || [];
			const geometry = result.geometry || {};
			const locationType = geometry.location_type || 'APPROXIMATE';

			// Good types - indicate specific deliverable locations
			const goodTypes = ['street_address', 'premise', 'establishment', 'point_of_interest'];
			// Bad types - indicate vague geographic areas
			const vagueTypes = ['route', 'political', 'administrative_area_level_1', 'administrative_area_level_2', 'locality', 'neighborhood'];

			// If it has any good types, it's probably deliverable
			if (types.some((type: string) => goodTypes.includes(type))) {
				return true;
			}

			// If it only has vague types, it's NOT deliverable
			if (types.every((type: string) => vagueTypes.includes(type))) {
				return false;
			}

			// For mixed results, check location precision
			// ROOFTOP and RANGE_INTERPOLATED are more likely to be deliverable
			const isPrecise = ['ROOFTOP', 'RANGE_INTERPOLATED'].includes(locationType);

			// If it has street components AND is precise, likely deliverable
			const hasStreetNumber = result.address_components?.some((comp: any) => comp.types.includes('street_number'));
			const hasRoute = result.address_components?.some((comp: any) => comp.types.includes('route'));

			// For rural addresses without street numbers, if it's precise it might still be deliverable
					return isPrecise && hasRoute;
	};

	// Helper function to call SmartyStreets with the best available street name
	const callSmartyStreetsFallback = async (streetName: string, street2: string, city: string, state: string, zipcode: string, includeInvalid: boolean, abbreviationExpansionInfo: any, provider: string, verificationFlow: any): Promise<any[]> => {
		try {
			const smartyCredentials = await this.getCredentials('smartyApi');
			const authId = smartyCredentials.authId as string;
			const authToken = smartyCredentials.authToken as string;

			console.log(`🔍 SMARTY DEBUG: Calling SmartyStreets with street: "${streetName}" (${provider})`);
			verificationFlow.steps_attempted.push(provider);
			verificationFlow.smarty_attempted = true;

			// Build SmartyStreets query parameters
			const queryParams: IDataObject = {
				'auth-id': authId,
				'auth-token': authToken,
				'street': streetName,
			};

			// Add optional parameters if provided
			if (street2) queryParams['street2'] = street2;
			if (city) queryParams['city'] = city;
			if (state) queryParams['state'] = state;
			if (zipcode) queryParams['zipcode'] = zipcode;
			if (includeInvalid) queryParams['include_invalid'] = 'true';

			// Make the SmartyStreets API request
			const smartyOptions: IRequestOptions = {
				method: 'GET',
				url: 'https://us-street.api.smartystreets.com/street-address',
				qs: queryParams,
				headers: {
					'Accept': 'application/json',
				},
				json: true,
				resolveWithFullResponse: true,
			};

			const smartyResponse = await this.helpers.request(smartyOptions);

						if (smartyResponse.body?.length > 0) {
				console.log(`🔍 SMARTY DEBUG: SmartyStreets found ${smartyResponse.body.length} results`);
				verificationFlow.steps_successful.push(provider);
				verificationFlow.smarty_successful = true;
				verificationFlow.final_provider = 'smartystreets';

				// Use SmartyStreets result and add abbreviation expansion info if available
				return smartyResponse.body.map((result: any) => ({
					...result,
					verification_status: 'smarty_verified',
					api_status_code: smartyResponse.statusCode,
					api_provider: provider,
					verification_flow: { ...verificationFlow },
					...(abbreviationExpansionInfo && {
						abbreviation_expansion: {
							...abbreviationExpansionInfo,
							expansion_successful: true
						}
					})
				}));
			} else {
				console.log('🔍 SMARTY DEBUG: SmartyStreets returned no results');
				return [];
			}
		} catch (smartyError) {
			console.log(`🔍 SMARTY DEBUG: SmartyStreets ${provider} failed:`, smartyError.message);
			return [];
		}
	};

	// Helper function to expand common street abbreviations (NY-focused)
	const expandStreetAbbreviations = (streetName: string): {expanded: string, wasExpanded: boolean, expansions: string[]} => {
		if (!streetName || streetName.trim() === '') {
			return { expanded: streetName, wasExpanded: false, expansions: [] };
		}

		const expansions: string[] = [];
		let expanded = streetName;

		// Common NY abbreviations (case-insensitive)
		const abbreviationMap = [
			{ pattern: /\bCR\s+(\d+[A-Z]?)\b/gi, replacement: 'County Road $1', description: 'CR → County Road' },
			{ pattern: /\bCr\s+(\d+[A-Z]?)\b/g, replacement: 'County Road $1', description: 'Cr → County Road' },
			{ pattern: /\bCo\s+Rte\.?\s+(\d+[A-Z]?)\b/gi, replacement: 'County Route $1', description: 'Co Rte → County Route' },
			{ pattern: /\bCo\s+Route\s+(\d+[A-Z]?)\b/gi, replacement: 'County Route $1', description: 'Co Route → County Route' },
			{ pattern: /\bCo\s+(\d+[A-Z]?)\b/gi, replacement: 'County $1', description: 'Co → County' },
			{ pattern: /\bSH\s+(\d+[A-Z]?)\b/gi, replacement: 'State Highway $1', description: 'SH → State Highway' },
			{ pattern: /\bSh\s+(\d+[A-Z]?)\b/g, replacement: 'State Highway $1', description: 'Sh → State Highway' },
			{ pattern: /\bNYS\s+Rte\.?\s+(\d+[A-Z]?)\b/gi, replacement: 'New York State Route $1', description: 'NYS Rte → New York State Route' },
			{ pattern: /\bNYS\s+Route\s+(\d+[A-Z]?)\b/gi, replacement: 'New York State Route $1', description: 'NYS Route → New York State Route' },
			{ pattern: /\bRte\.?\s+(\d+[A-Z]?)\b/gi, replacement: 'Route $1', description: 'Rte → Route' },
		];

		for (const abbrev of abbreviationMap) {
			if (abbrev.pattern.test(expanded)) {
				const beforeExpansion = expanded;
				expanded = expanded.replace(abbrev.pattern, abbrev.replacement);
				if (beforeExpansion !== expanded) {
					expansions.push(abbrev.description);
				}
			}
		}

		return {
			expanded: expanded.trim(),
			wasExpanded: expansions.length > 0,
			expansions
		};
	};

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
					const useUspsMailSafety = options.useUspsMailSafety as boolean || true;
					const attemptAbbreviationExpansion = options.attemptAbbreviationExpansion as boolean ?? true;
					const useSmartyFallback = options.useSmartyFallback as boolean || false;
					const alwaysReturnData = options.alwaysReturnData as boolean || true;
					const includeInputData = options.includeInputData as boolean || false;

					// Track verification flow for better reporting
					let verificationFlow: any = {
						steps_attempted: [],
						steps_successful: [],
						final_provider: null,
						abbreviation_expansion_attempted: false,
						abbreviation_expansion_successful: false,
						smarty_attempted: false,
						smarty_successful: false
					};

					// Check if this is an intersection format - if so, skip special processing and go straight to Google
					const isIntersection = street && (street.includes('/') || street.includes(' & ') || street.includes(' and '));
					let resultData: any[] = [];

					if (isIntersection) {
						// Skip detailed validation for intersections, go directly to Google
						try {
							// Build full address string for Google
							const fullAddress = [street, street2, city, state, zipcode].filter(Boolean).join(', ');

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
								// Transform Google response to SmartyStreets format for intersections
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
									const deliveryLine = [streetNumber, route].filter(Boolean).join(' ') || street;
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
											street_name: route.replace(/\s+(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Ln|Lane|Ct|Court|Pl|Place|Way|Blvd|Boulevard)$/i, '') || street,
											street_suffix: route.match(/\s+(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Ln|Lane|Ct|Court|Pl|Place|Way|Blvd|Boulevard)$/i)?.[1] || '',
											city_name: city,
											default_city_name: city,
											state_abbreviation: state,
											zipcode: zipcode.split('-')[0] || '',
											plus4_code: zipcode.split('-')[1] || '',
										},
										metadata: {
											record_type: 'I', // 'I' for Intersection
											zip_type: 'Standard',
											county_fips: '',
											county_name: county.replace(/\s+County$/i, ''),
											carrier_route: '',
											congressional_district: '',
											rdi: 'Intersection',
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
											dpv_match_code: 'I', // 'I' for Intersection
											dpv_footnotes: 'INTERSECTION',
											dpv_cmra: 'N',
											dpv_vacant: 'N',
											dpv_no_stat: 'N',
											active: 'Y'
										},
										verification_status: 'intersection_verified',
										api_status_code: 200,
										api_provider: 'google_intersection',
										place_id: result.place_id,
										formatted_address: result.formatted_address,
										location_type: locationType,
										intersection_detected: true
									};
								});
							}
						} catch (googleError) {
							// Google failed for intersection
							if (alwaysReturnData) {
								resultData = [{
									verification_status: 'unverified',
									input_street: street,
									input_street2: street2,
									input_city: city,
									input_state: state,
									input_zipcode: zipcode,
									message: 'Intersection detected - Google geocoding failed',
									api_response: 'intersection_google_error',
									api_status_code: 0,
									google_error: "Google API failed",
									intersection_detected: true
								}];
							}
						}
					} else if (!street || street.trim() === '') {
						// Handle empty/null street addresses
						if (alwaysReturnData) {
							resultData = [{
								verification_status: 'unverified',
								input_street: street,
								input_street2: street2,
								input_city: city,
								input_state: state,
								input_zipcode: zipcode,
								message: 'Street address is empty or null',
								api_response: 'empty_street',
								api_status_code: 0
							}];
						}
					} else {
											// Normal flow: Google first with USPS mail safety validation
					const fullAddress = [street, street2, city, state, zipcode].filter(Boolean).join(', ');
					let googleApiResponse: any = null;
					let googleFilteringDetails: any = null;

					// Track the best street name for SmartyStreets fallback (will be updated if abbreviation expansion is successful)
					let bestStreetForSmarty = street;
					let abbreviationExpansionInfo: any = null;

					console.log(`🔍 SMARTY DEBUG: Starting address verification for: "${fullAddress}"`);
					console.log(`🔍 SMARTY DEBUG: Options - abbreviation expansion: ${attemptAbbreviationExpansion}, USPS: ${useUspsMailSafety}, Smarty fallback: ${useSmartyFallback}`);

						try {
							// Try Google first
							console.log(`🔍 SMARTY DEBUG: Making Google API call...`);
							verificationFlow.steps_attempted.push('google_primary');
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
							googleApiResponse = googleResponse.body;

							console.log(`🔍 SMARTY DEBUG: Google API response - status: ${googleResponse.body?.status}, results count: ${googleResponse.body?.results?.length || 0}`);

							if (googleResponse.body?.results?.length > 0) {
								// Capture detailed filtering information
								googleFilteringDetails = {
									total_results: googleResponse.body.results.length,
									google_status: googleResponse.body.status,
									results_analysis: googleResponse.body.results.map((result: any, index: number) => {
										const isDeliverable = isDeliverableAddress(result);
										const types = result.types || [];
										const locationType = result.geometry?.location_type || 'UNKNOWN';

										return {
											result_index: index,
											formatted_address: result.formatted_address,
											place_id: result.place_id,
											types: types,
											location_type: locationType,
											is_deliverable: isDeliverable,
											deliverable_reason: isDeliverable ? 'Passed deliverable address filter' : 'Failed: Contains only vague geographic types like route, political, administrative areas',
											has_street_number: result.address_components?.some((comp: any) => comp.types.includes('street_number')) || false,
											has_route: result.address_components?.some((comp: any) => comp.types.includes('route')) || false
										};
									})
								};

								// Filter to only deliverable addresses
								const deliverableResults = googleResponse.body.results.filter(isDeliverableAddress);

								console.log(`🔍 SMARTY DEBUG: Google returned ${googleResponse.body.results.length} results, ${deliverableResults.length} are deliverable`);
								googleResponse.body.results.forEach((result: any, index: number) => {
									const isDeliverable = isDeliverableAddress(result);
									const types = result.types || [];
									const locationType = result.geometry?.location_type || 'UNKNOWN';
									console.log(`🔍 SMARTY DEBUG: Result ${index}: "${result.formatted_address}" - Types: [${types.join(', ')}] - Location: ${locationType} - Deliverable: ${isDeliverable}`);
								});

								if (deliverableResults.length > 0) {
									verificationFlow.steps_successful.push('google_primary');
									verificationFlow.final_provider = 'google_primary';

									// Check if any results need USPS mail safety validation (no house number)
									const validatedResults = [];

									for (const result of deliverableResults) {
										const addressComponents = result.address_components || [];
										const streetNumber = addressComponents.find((comp: any) => comp.types.includes('street_number'))?.long_name || '';

										// If no house number and USPS validation is enabled, check mail deliverability
										if (!streetNumber && useUspsMailSafety) {
											const uspsValidation = await validateWithUSPS(fullAddress, useUspsMailSafety);

											if (uspsValidation.isDeliverable) {
												// USPS says it's deliverable, keep this result
												validatedResults.push({ result, uspsValidation });
											}
											// If not deliverable according to USPS, skip this result
										} else {
											// Has house number or USPS validation disabled, keep result
											validatedResults.push({ result, uspsValidation: null });
										}
									}

									if (validatedResults.length > 0) {
										// Transform validated Google results to SmartyStreets format
										resultData = await Promise.all(validatedResults.map(async ({ result, uspsValidation }) => {
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

											// Final USPS validation on Google's cleaned address (if enabled and we have good address components)
											let finalUspsValidation = null;
											let finalVerificationStatus = uspsValidation ? 'google_usps_verified' : 'google_verified';

											if (useUspsMailSafety && streetNumber && route && city && state) {
												const cleanedAddress = [deliveryLine, city, state, zipcode].filter(Boolean).join(', ');
												finalUspsValidation = await validateWithUSPS(cleanedAddress, true);

												if (!finalUspsValidation.isDeliverable && finalUspsValidation.error && !finalUspsValidation.error.includes('API error')) {
													// USPS definitively rejects this address - mark as rejected
													finalVerificationStatus = 'usps_rejected';
												} else if (finalUspsValidation.isDeliverable) {
													// USPS confirms it's deliverable
													finalVerificationStatus = 'google_usps_verified';
												}
												// If USPS has API errors or inconclusive results, proceed with Google's result
											}

											return {
												input_index: 0,
												candidate_index: 0,
												delivery_line_1: deliveryLine,
												last_line: lastLine,
												delivery_point_barcode: '',
												components: {
													primary_number: streetNumber,
													street_name: route.replace(/\s+(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Ln|Lane|Ct|Court|Pl|Place|Way|Blvd|Boulevard)$/i, '') || street,
													street_suffix: route.match(/\s+(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Ln|Lane|Ct|Court|Pl|Place|Way|Blvd|Boulevard)$/i)?.[1] || '',
													city_name: city,
													default_city_name: city,
													state_abbreviation: state,
													zipcode: zipcode.split('-')[0] || '',
													plus4_code: zipcode.split('-')[1] || '',
												},
												metadata: {
													record_type: 'S',
													zip_type: 'Standard',
													county_fips: '',
													county_name: county.replace(/\s+County$/i, ''),
													carrier_route: '',
													congressional_district: '',
													rdi: 'Commercial',
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
													dpv_match_code: 'Y',
													dpv_footnotes: 'AABB',
													dpv_cmra: 'N',
													dpv_vacant: 'N',
													dpv_no_stat: 'N',
													active: 'Y'
												},
												verification_status: finalVerificationStatus,
												api_status_code: 200,
												api_provider: finalUspsValidation?.isDeliverable ? 'google_usps_final_validated' : (uspsValidation ? 'google_usps_validated' : 'google_primary'),
												place_id: result.place_id,
												formatted_address: result.formatted_address,
												location_type: locationType,
												verification_flow: { ...verificationFlow },
												usps_mail_safe: finalUspsValidation?.isDeliverable || (uspsValidation ? true : undefined),
												usps_validation_used: finalUspsValidation ? true : (uspsValidation ? true : false),
												usps_data: finalUspsValidation?.uspsData || uspsValidation?.uspsData,
												google_cleaned_address: deliveryLine ? `${deliveryLine}, ${lastLine}` : null,
												usps_final_validation: finalUspsValidation ? {
													validation_attempted: true,
													is_deliverable: finalUspsValidation.isDeliverable,
													error: finalUspsValidation.error,
													recommendation: finalVerificationStatus === 'usps_rejected' ? 'DO_NOT_MAIL' : 'PROCEED_WITH_CAUTION'
												} : null
											};
										}));
									} else if (useSmartyFallback) {
										// No results passed USPS validation, try SmartyStreets fallback
										const smartyResults = await callSmartyStreetsFallback(bestStreetForSmarty, street2, city, state, zipcode, includeInvalid, abbreviationExpansionInfo, 'smarty_usps_fallback', verificationFlow);
										if (smartyResults.length > 0) {
											resultData = smartyResults;
										}
									} else {
										// No deliverable Google results and no SmartyStreets fallback
										if (alwaysReturnData) {
											resultData = [{
												verification_status: 'unverified',
												input_street: street,
												input_street2: street2,
												input_city: city,
												input_state: state,
												input_zipcode: zipcode,
												message: 'Google found results but none were deliverable addresses',
												api_response: 'google_non_deliverable',
												api_status_code: 200,
												api_provider: 'google_primary',
												google_response: googleFilteringDetails,
												explanation: 'Google returned results but they were filtered out as non-deliverable (vague geographic areas like routes, political boundaries, etc.)'
											}];
										}
									}
								} else {
									// No deliverable Google results - try abbreviation expansion if enabled
									console.log('🔍 SMARTY DEBUG: Google found results but none were deliverable - checking abbreviation expansion');

									const hasHouseNumber = /^\d+/.test(street.trim());
									const abbreviationAnalysis = expandStreetAbbreviations(street);

																		if (attemptAbbreviationExpansion && hasHouseNumber && abbreviationAnalysis.wasExpanded) {
										console.log('🔍 SMARTY DEBUG: Attempting abbreviation expansion for non-deliverable results:', {
											original: street,
											expanded: abbreviationAnalysis.expanded,
											expansions: abbreviationAnalysis.expansions
										});

										verificationFlow.abbreviation_expansion_attempted = true;
										verificationFlow.steps_attempted.push('abbreviation_expansion');

										// Update the best street for SmartyStreets and track expansion info
										bestStreetForSmarty = abbreviationAnalysis.expanded;
										abbreviationExpansionInfo = {
											original_street: street,
											expanded_street: abbreviationAnalysis.expanded,
											expansions_applied: abbreviationAnalysis.expansions,
											triggered_by: 'non_deliverable_results'
										};

										try {
											const expandedAddress = [abbreviationAnalysis.expanded, street2, city, state, zipcode].filter(Boolean).join(', ');

											const expandedGoogleOptions: IRequestOptions = {
												method: 'GET',
												url: 'https://maps.googleapis.com/maps/api/geocode/json',
												qs: {
													address: expandedAddress,
													key: googleApiKey,
												},
												headers: {
													'Accept': 'application/json',
												},
												json: true,
												resolveWithFullResponse: true,
											};

											const expandedGoogleResponse = await this.helpers.request(expandedGoogleOptions);
											console.log(`🔍 SMARTY DEBUG: Abbreviation expansion API response - status: ${expandedGoogleResponse.body?.status}, results count: ${expandedGoogleResponse.body?.results?.length || 0}`);

											if (expandedGoogleResponse.body?.results?.length > 0) {
												const expandedDeliverableResults = expandedGoogleResponse.body.results.filter(isDeliverableAddress);
												console.log(`🔍 SMARTY DEBUG: Abbreviation expansion - ${expandedGoogleResponse.body.results.length} results, ${expandedDeliverableResults.length} deliverable`);

																							if (expandedDeliverableResults.length > 0) {
												console.log('🔍 SMARTY DEBUG: Abbreviation expansion successful!');
												verificationFlow.abbreviation_expansion_successful = true;
												verificationFlow.steps_successful.push('abbreviation_expansion');
												verificationFlow.final_provider = 'google_abbreviation_expanded';

													// Transform results and mark as abbreviation-expanded
													resultData = await Promise.all(expandedDeliverableResults.map(async (result: any) => {
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

														// Final USPS validation on Google's cleaned address from abbreviation expansion
														let finalUspsValidation = null;
														let finalVerificationStatus = 'abbreviation_expanded';

														if (useUspsMailSafety && streetNumber && route && city && state) {
															const cleanedAddress = [deliveryLine, city, state, zipcode].filter(Boolean).join(', ');
															finalUspsValidation = await validateWithUSPS(cleanedAddress, true);

															if (!finalUspsValidation.isDeliverable && finalUspsValidation.error && !finalUspsValidation.error.includes('API error')) {
																// USPS definitively rejects this address - mark as rejected
																finalVerificationStatus = 'abbreviation_expanded_usps_rejected';
															} else if (finalUspsValidation.isDeliverable) {
																// USPS confirms it's deliverable
																finalVerificationStatus = 'abbreviation_expanded_usps_verified';
															}
															// If USPS has API errors or inconclusive results, proceed with Google's result
														}

														return {
															input_index: 0,
															candidate_index: 0,
															delivery_line_1: deliveryLine,
															last_line: lastLine,
															delivery_point_barcode: '',
															components: {
																primary_number: streetNumber,
																street_name: route.replace(/\s+(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Ln|Lane|Ct|Court|Pl|Place|Way|Blvd|Boulevard)$/i, '') || abbreviationAnalysis.expanded,
																street_suffix: route.match(/\s+(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Ln|Lane|Ct|Court|Pl|Place|Way|Blvd|Boulevard)$/i)?.[1] || '',
																city_name: city,
																default_city_name: city,
																state_abbreviation: state,
																zipcode: zipcode.split('-')[0] || '',
																plus4_code: zipcode.split('-')[1] || '',
															},
															metadata: {
																record_type: 'A', // 'A' for Abbreviation-expanded
																zip_type: 'Standard',
																county_fips: '',
																county_name: county.replace(/\s+County$/i, ''),
																carrier_route: '',
																congressional_district: '',
																rdi: 'Commercial',
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
																dpv_match_code: 'A', // 'A' for Abbreviation-expanded
																dpv_footnotes: 'ABBREV',
																dpv_cmra: 'N',
																dpv_vacant: 'N',
																dpv_no_stat: 'N',
																active: 'Y'
															},
																																												verification_status: finalVerificationStatus,
															api_status_code: 200,
															api_provider: finalUspsValidation?.isDeliverable ? 'google_abbreviation_usps_verified' : 'google_abbreviation_expanded',
															place_id: result.place_id,
															formatted_address: result.formatted_address,
															location_type: locationType,
															verification_flow: { ...verificationFlow },
															google_cleaned_address: deliveryLine ? `${deliveryLine}, ${lastLine}` : null,
															usps_final_validation: finalUspsValidation ? {
																validation_attempted: true,
																is_deliverable: finalUspsValidation.isDeliverable,
																error: finalUspsValidation.error,
																recommendation: finalVerificationStatus.includes('usps_rejected') ? 'DO_NOT_MAIL' : 'PROCEED_WITH_CAUTION'
															} : null,
															abbreviation_expansion: {
																original_street: street,
																expanded_street: abbreviationAnalysis.expanded,
																expansions_applied: abbreviationAnalysis.expansions,
																expansion_successful: true,
																triggered_by: 'non_deliverable_results'
															},
															original_google_results: {
																count: googleResponse.body.results.length,
																non_deliverable_results: googleResponse.body.results.map((r: any) => ({
																	formatted_address: r.formatted_address,
																	types: r.types,
																	reason_filtered: 'Non-deliverable address type'
																}))
															}
														};
													}));
												} else {
													console.log('🔍 SMARTY DEBUG: Abbreviation expansion found results but none deliverable - trying SmartyStreets fallback');
													// Try SmartyStreets fallback if enabled
													if (useSmartyFallback) {
														const smartyResults = await callSmartyStreetsFallback(bestStreetForSmarty, street2, city, state, zipcode, includeInvalid, abbreviationExpansionInfo, 'smarty_expansion_non_deliverable', verificationFlow);
														if (smartyResults.length > 0) {
															resultData = smartyResults;
														}
													}

													if (!resultData.length) {
														if (alwaysReturnData) {
															resultData = [{
																verification_status: 'unverified',
																input_street: street,
																input_street2: street2,
																input_city: city,
																input_state: state,
																input_zipcode: zipcode,
																message: 'Google API responded but only found city/zip level results, not the specific street address. SmartyStreets was ' + (useSmartyFallback ? 'attempted' : 'not enabled') + '.',
																api_response: 'abbreviation_expansion_non_deliverable',
																api_status_code: 200,
																api_provider: 'google_abbreviation_attempted',
																verification_flow: { ...verificationFlow },
																abbreviation_expansion: {
																	original_street: street,
																	expanded_street: abbreviationAnalysis.expanded,
																	expansions_applied: abbreviationAnalysis.expansions,
																	expansion_successful: false,
																	failure_reason: 'Google found general area results but no specific deliverable street address',
																	triggered_by: 'non_deliverable_results'
																},
																google_response: googleFilteringDetails
															}];
														}
													}
												}
											} else {
												console.log('🔍 SMARTY DEBUG: Abbreviation expansion returned no results - trying SmartyStreets fallback');
												// Try SmartyStreets fallback if enabled
												if (useSmartyFallback) {
													const smartyResults = await callSmartyStreetsFallback(bestStreetForSmarty, street2, city, state, zipcode, includeInvalid, abbreviationExpansionInfo, 'smarty_expansion_no_results', verificationFlow);
													if (smartyResults.length > 0) {
														resultData = smartyResults;
													}
												}

												if (!resultData.length) {
													if (alwaysReturnData) {
														resultData = [{
															verification_status: 'unverified',
															input_street: street,
															input_street2: street2,
															input_city: city,
															input_state: state,
															input_zipcode: zipcode,
															message: 'Abbreviation expansion found no results',
															api_response: 'abbreviation_expansion_failed',
															api_status_code: 200,
															api_provider: 'google_abbreviation_attempted',
															abbreviation_expansion: {
																original_street: street,
																expanded_street: abbreviationAnalysis.expanded,
																expansions_applied: abbreviationAnalysis.expansions,
																expansion_successful: false,
																failure_reason: 'No results found even with expanded abbreviations',
																triggered_by: 'non_deliverable_results'
															},
															google_response: googleFilteringDetails
														}];
													}
												}
											}
										} catch (expandedGoogleError) {
											console.log('🔍 SMARTY DEBUG: Abbreviation expansion API call failed:', expandedGoogleError.message);
											// Try SmartyStreets fallback if enabled
											if (useSmartyFallback) {
												const smartyResults = await callSmartyStreetsFallback(bestStreetForSmarty, street2, city, state, zipcode, includeInvalid, abbreviationExpansionInfo, 'smarty_expansion_error', verificationFlow);
												if (smartyResults.length > 0) {
													resultData = smartyResults;
												}
											}

											if (!resultData.length) {
												if (alwaysReturnData) {
													resultData = [{
														verification_status: 'unverified',
														input_street: street,
														input_street2: street2,
														input_city: city,
														input_state: state,
														input_zipcode: zipcode,
														message: 'Abbreviation expansion attempt failed',
														api_response: 'abbreviation_expansion_error',
														api_status_code: 0,
														api_provider: 'google_abbreviation_attempted',
														abbreviation_expansion: {
															original_street: street,
															expanded_street: abbreviationAnalysis.expanded,
															expansions_applied: abbreviationAnalysis.expansions,
															expansion_successful: false,
															failure_reason: `Google API error: ${expandedGoogleError.message}`,
															triggered_by: 'non_deliverable_results'
														},
														google_response: googleFilteringDetails
													}];
												}
											}
										}
									} else {
										console.log(`🔍 SMARTY DEBUG: Abbreviation expansion not attempted - hasHouseNumber: ${hasHouseNumber}, abbreviationsDetected: ${abbreviationAnalysis.wasExpanded}, expansionEnabled: ${attemptAbbreviationExpansion}`);
									}

									// If we haven't set resultData yet and SmartyStreets fallback is enabled, try it
									if (!resultData.length && useSmartyFallback) {
										const smartyResults = await callSmartyStreetsFallback(bestStreetForSmarty, street2, city, state, zipcode, includeInvalid, abbreviationExpansionInfo, 'smarty_non_deliverable_fallback', verificationFlow);
										if (smartyResults.length > 0) {
											resultData = smartyResults;
										}
									}
								}
							} else {
								// Google returned no results at all - try abbreviation expansion if safe
								console.log('Google returned no results for address:', fullAddress);

								// Check if we can safely try abbreviation expansion
								const hasHouseNumber = /^\d+/.test(street.trim()); // Address starts with a number
								const abbreviationAnalysis = expandStreetAbbreviations(street);

																if (attemptAbbreviationExpansion && hasHouseNumber && abbreviationAnalysis.wasExpanded) {
									console.log('Trying abbreviation expansion:', {
										original: street,
										expanded: abbreviationAnalysis.expanded,
										expansions: abbreviationAnalysis.expansions
									});

									verificationFlow.abbreviation_expansion_attempted = true;
									verificationFlow.steps_attempted.push('abbreviation_expansion');

									// Update the best street for SmartyStreets and track expansion info
									bestStreetForSmarty = abbreviationAnalysis.expanded;
									abbreviationExpansionInfo = {
										original_street: street,
										expanded_street: abbreviationAnalysis.expanded,
										expansions_applied: abbreviationAnalysis.expansions,
										triggered_by: 'no_results'
									};

									// Try Google again with expanded street name
									try {
										const expandedAddress = [abbreviationAnalysis.expanded, street2, city, state, zipcode].filter(Boolean).join(', ');

										const expandedGoogleOptions: IRequestOptions = {
											method: 'GET',
											url: 'https://maps.googleapis.com/maps/api/geocode/json',
											qs: {
												address: expandedAddress,
												key: googleApiKey,
											},
											headers: {
												'Accept': 'application/json',
											},
											json: true,
											resolveWithFullResponse: true,
										};

										const expandedGoogleResponse = await this.helpers.request(expandedGoogleOptions);

										if (expandedGoogleResponse.body?.results?.length > 0) {
											// Filter to only deliverable addresses
											const expandedDeliverableResults = expandedGoogleResponse.body.results.filter(isDeliverableAddress);

											if (expandedDeliverableResults.length > 0) {
												// Success with abbreviation expansion!
												console.log('Abbreviation expansion successful!');
												verificationFlow.abbreviation_expansion_successful = true;
												verificationFlow.steps_successful.push('abbreviation_expansion');
												verificationFlow.final_provider = 'google_abbreviation_expanded';

												// Transform results and mark as abbreviation-expanded
												resultData = await Promise.all(expandedDeliverableResults.map(async (result: any) => {
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

													// Final USPS validation on Google's cleaned address from abbreviation expansion (no results case)
													let finalUspsValidation = null;
													let finalVerificationStatus = 'abbreviation_expanded';

													if (useUspsMailSafety && streetNumber && route && city && state) {
														const cleanedAddress = [deliveryLine, city, state, zipcode].filter(Boolean).join(', ');
														finalUspsValidation = await validateWithUSPS(cleanedAddress, true);

														if (!finalUspsValidation.isDeliverable && finalUspsValidation.error && !finalUspsValidation.error.includes('API error')) {
															// USPS definitively rejects this address - mark as rejected
															finalVerificationStatus = 'abbreviation_expanded_usps_rejected';
														} else if (finalUspsValidation.isDeliverable) {
															// USPS confirms it's deliverable
															finalVerificationStatus = 'abbreviation_expanded_usps_verified';
														}
														// If USPS has API errors or inconclusive results, proceed with Google's result
													}

													return {
														input_index: 0,
														candidate_index: 0,
														delivery_line_1: deliveryLine,
														last_line: lastLine,
														delivery_point_barcode: '',
														components: {
															primary_number: streetNumber,
															street_name: route.replace(/\s+(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Ln|Lane|Ct|Court|Pl|Place|Way|Blvd|Boulevard)$/i, '') || abbreviationAnalysis.expanded,
															street_suffix: route.match(/\s+(St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Ln|Lane|Ct|Court|Pl|Place|Way|Blvd|Boulevard)$/i)?.[1] || '',
															city_name: city,
															default_city_name: city,
															state_abbreviation: state,
															zipcode: zipcode.split('-')[0] || '',
															plus4_code: zipcode.split('-')[1] || '',
														},
														metadata: {
															record_type: 'A', // 'A' for Abbreviation-expanded
															zip_type: 'Standard',
															county_fips: '',
															county_name: county.replace(/\s+County$/i, ''),
															carrier_route: '',
															congressional_district: '',
															rdi: 'Commercial',
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
															dpv_match_code: 'A', // 'A' for Abbreviation-expanded
															dpv_footnotes: 'ABBREV',
															dpv_cmra: 'N',
															dpv_vacant: 'N',
															dpv_no_stat: 'N',
															active: 'Y'
														},
																																									verification_status: finalVerificationStatus,
														api_status_code: 200,
														api_provider: finalUspsValidation?.isDeliverable ? 'google_abbreviation_usps_verified' : 'google_abbreviation_expanded',
														place_id: result.place_id,
														formatted_address: result.formatted_address,
														location_type: locationType,
														verification_flow: { ...verificationFlow },
														google_cleaned_address: deliveryLine ? `${deliveryLine}, ${lastLine}` : null,
														usps_final_validation: finalUspsValidation ? {
															validation_attempted: true,
															is_deliverable: finalUspsValidation.isDeliverable,
															error: finalUspsValidation.error,
															recommendation: finalVerificationStatus.includes('usps_rejected') ? 'DO_NOT_MAIL' : 'PROCEED_WITH_CAUTION'
														} : null,
														abbreviation_expansion: {
															original_street: street,
															expanded_street: abbreviationAnalysis.expanded,
															expansions_applied: abbreviationAnalysis.expansions,
															expansion_successful: true
														}
													};
												}));
											} else {
												// Abbreviation expansion found results but none deliverable
												if (alwaysReturnData) {
													resultData = [{
														verification_status: 'unverified',
														input_street: street,
														input_street2: street2,
														input_city: city,
														input_state: state,
														input_zipcode: zipcode,
														message: 'Google API responded but only found city/zip level results, not the specific street address. SmartyStreets was ' + (useSmartyFallback ? 'attempted' : 'not enabled') + '.',
														api_response: 'abbreviation_expansion_non_deliverable',
														api_status_code: 200,
														api_provider: 'google_abbreviation_attempted',
														verification_flow: { ...verificationFlow },
														abbreviation_expansion: {
															original_street: street,
															expanded_street: abbreviationAnalysis.expanded,
															expansions_applied: abbreviationAnalysis.expansions,
															expansion_successful: false,
															failure_reason: 'Google found general area results but no specific deliverable street address'
														}
													}];
												}
											}
										} else {
											// Abbreviation expansion also returned no results
											if (alwaysReturnData) {
												resultData = [{
													verification_status: 'unverified',
													input_street: street,
													input_street2: street2,
													input_city: city,
													input_state: state,
													input_zipcode: zipcode,
													message: 'Google found no results even after abbreviation expansion',
													api_response: 'abbreviation_expansion_failed',
													api_status_code: 200,
													api_provider: 'google_abbreviation_attempted',
													abbreviation_expansion: {
														original_street: street,
														expanded_street: abbreviationAnalysis.expanded,
														expansions_applied: abbreviationAnalysis.expansions,
														expansion_successful: false,
														failure_reason: 'No results found even with expanded abbreviations'
													}
												}];
											}
										}
									} catch (expandedGoogleError) {
										console.log('Abbreviation expansion Google call failed:', expandedGoogleError.message);
										if (alwaysReturnData) {
											resultData = [{
												verification_status: 'unverified',
												input_street: street,
												input_street2: street2,
												input_city: city,
												input_state: state,
												input_zipcode: zipcode,
												message: 'Abbreviation expansion attempt failed',
												api_response: 'abbreviation_expansion_error',
												api_status_code: 0,
												api_provider: 'google_abbreviation_attempted',
												abbreviation_expansion: {
													original_street: street,
													expanded_street: abbreviationAnalysis.expanded,
													expansions_applied: abbreviationAnalysis.expansions,
													expansion_successful: false,
													failure_reason: `Google API error: ${expandedGoogleError.message}`
												}
											}];
										}
									}
								} else {
									// No house number or no abbreviations to expand - original no results response
									if (alwaysReturnData) {
										resultData = [{
											verification_status: 'unverified',
											input_street: street,
											input_street2: street2,
											input_city: city,
											input_state: state,
											input_zipcode: zipcode,
											message: hasHouseNumber ?
												'Google API returned no results (no abbreviations detected to expand)' :
												'Google API returned no results (no house number - abbreviation expansion not safe)',
											api_response: 'google_no_results',
											api_status_code: 200,
											api_provider: 'google_primary',
											google_response: {
												total_results: 0,
												google_status: googleApiResponse?.status || 'UNKNOWN',
												explanation: 'Google Geocoding API found no matching locations for this address'
											},
											abbreviation_analysis: {
												has_house_number: hasHouseNumber,
												abbreviations_detected: abbreviationAnalysis.wasExpanded,
												potential_expansions: abbreviationAnalysis.expansions
											},
											explanation: hasHouseNumber ?
												'Google found no results and no common abbreviations were detected to expand' :
												'Google found no results and abbreviation expansion was not attempted (no house number for safety)'
										}];
									}
								}
							}
						} catch (googleError) {
							console.log('Google primary failed:', googleError.message);

							// Google completely failed, try SmartyStreets fallback if enabled
							if (useSmartyFallback) {
								const smartyResults = await callSmartyStreetsFallback(bestStreetForSmarty, street2, city, state, zipcode, includeInvalid, abbreviationExpansionInfo, 'smarty_error_fallback', verificationFlow);
								if (smartyResults.length > 0) {
									resultData = smartyResults;
								} else {
									// SmartyStreets also failed
									if (alwaysReturnData) {
										resultData = [{
											verification_status: 'unverified',
											input_street: street,
											input_street2: street2,
											input_city: city,
											input_state: state,
											input_zipcode: zipcode,
											message: 'Both Google and SmartyStreets failed',
											api_response: 'both_failed',
											api_status_code: 0,
											google_error: "Google API failed",
											smarty_error: "SmartyStreets returned no results"
										}];
									}
								}
							} else if (alwaysReturnData) {
								resultData = [{
									verification_status: 'unverified',
									input_street: street,
									input_street2: street2,
									input_city: city,
									input_state: state,
									input_zipcode: zipcode,
									message: 'Google failed, SmartyStreets fallback disabled',
									api_response: 'google_failed',
									api_status_code: 0,
									google_error: "Google API failed"
								}];
							}
						}
					}

					// If still no results and alwaysReturnData is true, return input data
					if (Array.isArray(resultData) && resultData.length === 0 && alwaysReturnData) {
						const stepsAttempted = verificationFlow.steps_attempted.join(' → ');
						const smartyMessage = verificationFlow.smarty_attempted ?
							(verificationFlow.smarty_successful ? 'SmartyStreets succeeded but was overridden' : 'SmartyStreets attempted but found no results') :
							(useSmartyFallback ? 'SmartyStreets was enabled but not reached in flow' : 'SmartyStreets not enabled');

						resultData = [{
							verification_status: 'unverified',
							input_street: street,
							input_street2: street2,
							input_city: city,
							input_state: state,
							input_zipcode: zipcode,
							message: `Address verification failed. Steps attempted: ${stepsAttempted}. ${smartyMessage}.`,
							api_response: 'verification_failed',
							api_status_code: 200,
							verification_flow: { ...verificationFlow },
							// Debug information
							debug_info: {
								api_provider: 'google_primary',
								processing_flow: isIntersection ? 'intersection_detected' : (!street || street.trim() === '') ? 'empty_street' : 'normal_address',
								options_enabled: {
									smarty_fallback: useSmartyFallback,
									usps_mail_safety: useUspsMailSafety,
									always_return_data: alwaysReturnData,
									abbreviation_expansion: attemptAbbreviationExpansion
								},
								intersection_detected: isIntersection,
								steps_attempted: stepsAttempted,
								explanation: 'Complete verification flow attempted but no valid deliverable address found.'
							}
						}];
					}

					// Always process results regardless of whether we used Google or went to SmartyStreets fallback
					if (Array.isArray(resultData) && resultData.length > 0) {
						// Add verification status to successful results if not already present
						resultData = resultData.map((result: any) => ({
							...result,
							verification_status: result.verification_status || 'verified',
							api_status_code: result.api_status_code || 200
						}));

						// If includeInputData is enabled, merge the original input data at the top level
						if (includeInputData) {
							const originalInputData = items[i].json;
							resultData = resultData.map((result: any) => ({
								...originalInputData,
								...result
							}));
						}
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
					let errorResult = { error: error.message };

					// If includeInputData is enabled, merge the original input data at the top level
					const includeInputData = this.getNodeParameter('options.includeInputData', i, false) as boolean;
					if (includeInputData) {
						const originalInputData = items[i].json;
						errorResult = {
							...originalInputData,
							...errorResult
						};
					}

					const executionErrorData = this.helpers.constructExecutionMetaData(
						this.helpers.returnJsonArray([errorResult]),
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
