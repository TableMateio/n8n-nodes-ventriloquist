import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeParameters,
	INodeType,
	INodeTypeBaseDescription,
	INodeTypeDescription,
	ILoadOptionsFunctions,
	INodePropertyOptions,
} from 'n8n-workflow';
import { ApplicationError, NodeOperationError } from 'n8n-workflow';

// Helper function to get type validation strictness
const getTypeValidationStrictness = (version: number) => {
	return version >= 3.1 ? 'strict' : 'loose';
};

// Configuration for dynamic outputs based on routes
const configuredOutputs = (parameters: INodeParameters) => {
	const mode = parameters.mode as string;

	if (mode === 'expression') {
		return Array.from({ length: parameters.numberOutputs as number }, (_, i) => ({
			type: 'main',
			displayName: i.toString(),
		}));
	} else {
		const routes = ((parameters.routes as IDataObject)?.values as IDataObject[]) ?? [];
		const routeOutputs = routes.map((route, index) => {
			return {
				type: 'main',
				displayName: route.routeName || `Route ${index + 1}`,
			};
		});

		// Add fallback output if enabled
		const options = parameters.options as IDataObject;
		if (options?.fallbackOutput === 'extra') {
			routeOutputs.push({
				type: 'main',
				displayName: options?.renameFallbackOutput || 'Fallback',
			});
		}

		return routeOutputs;
	}
};

export class RouterV3 implements INodeType {
	description: INodeTypeDescription;

	constructor(baseDescription: INodeTypeBaseDescription) {
		this.description = {
			...baseDescription,
			subtitle: `=mode: {{$parameter["mode"] || "rules"}}`,
			version: [3, 3.1, 3.2],
			defaults: {
				name: 'Router',
				color: '#506000',
			},
			inputs: ['main'],
			outputs: `={{(${configuredOutputs})($parameter)}}`,
			properties: [
				{
					displayName: 'Mode',
					name: 'mode',
					type: 'options',
					noDataExpression: true,
					options: [
						{
							name: 'Rules',
							value: 'rules',
							description: 'Build routing rules with conditions for each output',
						},
						{
							name: 'Expression',
							value: 'expression',
							description: 'Write an expression to return the output index',
						},
					],
					default: 'rules',
					description: 'How data should be routed',
				},
				{
					displayName: 'Number of Outputs',
					name: 'numberOutputs',
					type: 'number',
					displayOptions: {
						show: {
							mode: ['expression'],
						},
					},
					default: 4,
					description: 'How many outputs to create',
				},
				{
					displayName: 'Output Index',
					name: 'output',
					type: 'number',
					validateType: 'number',
					hint: 'The index to route the item to, starts at 0',
					displayOptions: {
						show: {
							mode: ['expression'],
						},
					},
					// eslint-disable-next-line n8n-nodes-base/node-param-default-wrong-for-number
					default: '={{}}',
					description:
						'The output index to send the input item to. Use an expression to calculate which input item should be routed to which output. The expression must return a number.',
				},
				{
					displayName: 'Routes',
					name: 'routes',
					placeholder: 'Add Route',
					type: 'fixedCollection',
					typeOptions: {
						multipleValues: true,
						sortable: true,
					},
					displayOptions: {
						show: {
							mode: ['rules'],
						},
					},
					default: {
						values: [
							{
								routeName: 'Route1',
								conditions: {
									options: {
										caseSensitive: true,
										leftValue: '',
										typeValidation: getTypeValidationStrictness(3.1),
									},
									conditions: [
										{
											leftValue: '',
											rightValue: '',
											operator: {
												type: 'string',
												operation: 'equals',
											},
										},
									],
									combinator: 'and',
								},
							},
						],
					},
					options: [
						{
							name: 'values',
							displayName: 'Route',
							values: [
								{
									displayName: 'Route Name',
									name: 'routeName',
									type: 'string',
									default: '',
									placeholder: 'e.g., EligibleForAuction',
									description: 'Name of this route for identification',
								},
								{
									displayName: 'Conditions',
									name: 'conditions',
									placeholder: 'Add Condition',
									type: 'filter',
									default: {},
									typeOptions: {
										multipleValues: false,
										filter: {
											caseSensitive: '={{!$parameter.options.ignoreCase}}',
											typeValidation: getTypeValidationStrictness(3.1),
											version: '={{ $nodeVersion >= 3.2 ? 2 : 1 }}',
										},
									},
								},
								{
									displayName: 'Rename Output',
									name: 'renameOutput',
									type: 'boolean',
									default: false,
								},
								{
									displayName: 'Output Name',
									name: 'outputKey',
									type: 'string',
									default: '',
									description: 'The label of output to send data to if route matches',
									displayOptions: {
										show: {
											renameOutput: [true],
										},
									},
								},
							],
						},
					],
				},
				{
					displayName: 'Options',
					name: 'options',
					type: 'collection',
					placeholder: 'Add option',
					default: {},
					displayOptions: {
						show: {
							mode: ['rules'],
						},
					},
					options: [
						{
							displayName: 'Fallback Output',
							name: 'fallbackOutput',
							type: 'options',
							typeOptions: {
								loadOptionsDependsOn: ['routes.values', '/routes', '/routes.values'],
								loadOptionsMethod: 'getFallbackOutputOptions',
							},
							default: 'none',
							description:
								'If no route matches the item will be sent to this output, by default they will be ignored',
						},
						{
							displayName: 'Ignore Case',
							description: 'Whether to ignore letter case when evaluating conditions',
							name: 'ignoreCase',
							type: 'boolean',
							default: true,
						},
						{
							displayName: 'Rename Fallback Output',
							name: 'renameFallbackOutput',
							type: 'string',
							placeholder: 'e.g. Fallback',
							default: '',
							displayOptions: {
								show: {
									fallbackOutput: ['extra'],
								},
							},
						},
						{
							displayName: 'Send data to all matching outputs',
							name: 'allMatchingOutputs',
							type: 'boolean',
							default: false,
							description:
								'Whether to send data to all outputs meeting conditions (and not just the first one)',
						},
						{
							displayName: 'Include Explanation',
							name: 'includeExplanation',
							type: 'boolean',
							default: false,
							description: 'Add an explanation field showing which conditions matched',
						},
						{
							displayName: 'Output Field Name',
							name: 'outputFieldName',
							type: 'string',
							default: 'route',
							description: 'Name of the field to add with the route name',
						},
					],
				},
			],
		};
	}

	methods = {
		loadOptions: {
			async getFallbackOutputOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const routes = (this.getCurrentNodeParameter('routes.values') as INodeParameters[]) ?? [];

				const outputOptions: INodePropertyOptions[] = [
					{
						name: 'None (default)',
						value: 'none',
						description: 'Items will be ignored',
					},
					{
						name: 'Extra Output',
						value: 'extra',
						description: 'Items will be sent to the extra, separate, output',
					},
				];

				for (const [index, route] of routes.entries()) {
					outputOptions.push({
						name: `Output ${route.outputKey || route.routeName || index}`,
						value: index,
						description: `Items will be sent to the same output as when matched route ${index + 1}`,
					});
				}

				return outputOptions;
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const mode = this.getNodeParameter('mode', 0) as string;

		let returnData: INodeExecutionData[][] = [];

		if (mode === 'expression') {
			// Handle expression mode like original Switch node
			const numberOutputs = this.getNodeParameter('numberOutputs', 0) as number;
			returnData = new Array(numberOutputs).fill(0).map(() => []);

			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				const item = items[itemIndex];
				const outputIndex = this.getNodeParameter('output', itemIndex) as number;

				if (outputIndex < 0 || outputIndex >= returnData.length) {
					throw new NodeOperationError(this.getNode(), `Invalid output index ${outputIndex}`, {
						itemIndex,
						description: `It has to be between 0 and ${returnData.length - 1}`,
					});
				}

				item.pairedItem = { item: itemIndex };
				returnData[outputIndex].push(item);
			}
		} else {
			// Handle rules mode with improved logic
			const routes = (this.getNodeParameter('routes.values', 0, []) as INodeParameters[]) || [];
			const options = this.getNodeParameter('options', 0, {}) as IDataObject;

			if (!routes.length) {
				return [items];
			}

			returnData = new Array(routes.length).fill(0).map(() => []);

			// Add fallback output if configured
			if (options.fallbackOutput === 'extra') {
				returnData.push([]);
			}

			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				const item = items[itemIndex];
				let matchFound = false;

				for (const [routeIndex, route] of routes.entries()) {
					let conditionPass: boolean;

					try {
						conditionPass = this.getNodeParameter(
							`routes.values[${routeIndex}].conditions`,
							itemIndex,
							false,
							{
								extractValue: true,
							},
						) as boolean;
					} catch (error) {
						if (this.continueOnFail()) {
							returnData[0].push({ json: { error: error.message } });
							continue;
						}
						throw new NodeOperationError(this.getNode(), `Error evaluating route "${route.routeName}": ${error.message}`, {
							itemIndex,
						});
					}

					if (conditionPass) {
						matchFound = true;
						const outputItem: INodeExecutionData = {
							...item,
							json: {
								...item.json,
							},
						};

						// Add route information if requested
						if (options.outputFieldName) {
							outputItem.json[options.outputFieldName as string] = route.routeName || `Route${routeIndex + 1}`;
						}

						// Add explanation if requested
						if (options.includeExplanation) {
							outputItem.json.explanation = `Matched route: ${route.routeName || `Route${routeIndex + 1}`}`;
						}

						outputItem.pairedItem = { item: itemIndex };
						returnData[routeIndex].push(outputItem);

						if (!options.allMatchingOutputs) {
							break;
						}
					}
				}

				// Handle fallback
				if (!matchFound && options.fallbackOutput !== undefined && options.fallbackOutput !== 'none') {
					const outputItem: INodeExecutionData = {
						...item,
						json: {
							...item.json,
						},
					};

					if (options.outputFieldName) {
						outputItem.json[options.outputFieldName as string] = options.renameFallbackOutput || 'Fallback';
					}

					outputItem.pairedItem = { item: itemIndex };

					if (options.fallbackOutput === 'extra') {
						returnData[returnData.length - 1].push(outputItem);
					} else {
						const fallbackIndex = options.fallbackOutput as number;
						if (fallbackIndex >= 0 && fallbackIndex < routes.length) {
							returnData[fallbackIndex].push(outputItem);
						}
					}
				}
			}
		}

		if (!returnData.length) return [[]];
		return returnData;
	}
}
