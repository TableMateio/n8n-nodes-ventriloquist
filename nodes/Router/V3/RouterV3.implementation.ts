import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeParameters,
	INodeType,
	INodeTypeBaseDescription,
	INodeTypeDescription,
} from 'n8n-workflow';
import { ApplicationError, NodeConnectionType, NodeOperationError } from 'n8n-workflow';

interface IRouteCondition {
	field: string;
	operator: string;
	value: string;
	caseSensitive: boolean;
	typeValidation: string;
}

interface IRoute {
	routeName: string;
	logic: string;
	conditions: {
		values: IRouteCondition[];
	};
}

interface IOutputConfig {
	defaultRoute: string;
	outputFieldName: string;
	includeExplanation: boolean;
	stopAtFirstMatch: boolean;
}

// Helper functions for condition evaluation
function evaluateCondition(
	condition: IRouteCondition,
	item: INodeExecutionData,
	context: IExecuteFunctions,
	itemIndex: number,
): boolean {
	try {
		// Get the field value using n8n's expression evaluation
		const fieldValue = context.evaluateExpression(condition.field, itemIndex);
		const compareValue = condition.value;

		// Handle empty checks first
		if (condition.operator === 'isEmpty') {
			return fieldValue === null || fieldValue === undefined || fieldValue === '';
		}
		if (condition.operator === 'isNotEmpty') {
			return fieldValue !== null && fieldValue !== undefined && fieldValue !== '';
		}

		// Handle null/undefined field values
		if (fieldValue === null || fieldValue === undefined) {
			return false;
		}

		// Type coercion based on validation setting
		let leftValue = fieldValue;
		let rightValue: any = compareValue;

		if (condition.typeValidation === 'loose') {
			// Try to coerce types
			if (typeof fieldValue === 'string' && !isNaN(Number(compareValue))) {
				rightValue = Number(compareValue);
			} else if (typeof fieldValue === 'number') {
				rightValue = Number(compareValue) || compareValue;
			}
		}

		// Handle case sensitivity for strings
		if (typeof leftValue === 'string' && typeof rightValue === 'string' && !condition.caseSensitive) {
			leftValue = leftValue.toLowerCase();
			rightValue = rightValue.toLowerCase();
		}

		// Evaluate based on operator
		switch (condition.operator) {
			case 'equals':
				return leftValue === rightValue;
			case 'notEquals':
				return leftValue !== rightValue;
			case 'contains':
				return typeof leftValue === 'string' && leftValue.includes(rightValue);
			case 'notContains':
				return typeof leftValue === 'string' && !leftValue.includes(rightValue);
			case 'greaterThan':
				return Number(leftValue) > Number(rightValue);
			case 'lessThan':
				return Number(leftValue) < Number(rightValue);
			case 'hasProperty':
				return typeof leftValue === 'object' && leftValue !== null && rightValue in leftValue;
			default:
				return false;
		}
	} catch (error) {
		// If evaluation fails, return false
		return false;
	}
}

function evaluateRoute(
	route: IRoute,
	item: INodeExecutionData,
	context: IExecuteFunctions,
	itemIndex: number,
): { matches: boolean; explanation: string } {
	const conditions = route.conditions?.values || [];

	if (conditions.length === 0) {
		return { matches: false, explanation: 'No conditions defined' };
	}

	const results: boolean[] = [];
	const explanations: string[] = [];

	for (const condition of conditions) {
		const result = evaluateCondition(condition, item, context, itemIndex);
		results.push(result);

		const fieldName = condition.field.replace('={{$json.', '').replace('}}', '');
		explanations.push(
			`${fieldName} ${condition.operator} ${condition.value}: ${result ? 'true' : 'false'}`
		);
	}

	let matches = false;
	let explanation = '';

	switch (route.logic) {
		case 'and':
			matches = results.every(r => r === true);
			explanation = `${route.routeName}: ALL(${explanations.join(', ')}) = ${matches}`;
			break;
		case 'or':
			matches = results.some(r => r === true);
			explanation = `${route.routeName}: ANY(${explanations.join(', ')}) = ${matches}`;
			break;
		case 'not':
			matches = !results.every(r => r === true);
			explanation = `${route.routeName}: NOT(${explanations.join(', ')}) = ${matches}`;
			break;
		default:
			matches = false;
			explanation = `${route.routeName}: Unknown logic type`;
	}

	return { matches, explanation };
}

export class RouterV3 implements INodeType {
	description: INodeTypeDescription;

	constructor(baseDescription: INodeTypeBaseDescription) {
		this.description = {
			...baseDescription,
			subtitle: 'Router: {{$parameter["routes"].length || 0}} routes',
			version: [3, 3.1, 3.2],
			defaults: {
				name: 'Router',
				color: '#506000',
			},
			inputs: [NodeConnectionType.Main],
			outputs: [NodeConnectionType.Main],
			properties: [
				{
					displayName: 'Routes',
					name: 'routes',
					placeholder: 'Add Route',
					type: 'fixedCollection',
					typeOptions: {
						multipleValues: true,
						sortable: true,
					},
					default: {
						values: [
							{
								routeName: 'Route1',
								logic: 'and',
								conditions: [],
								groups: [],
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
									displayName: 'Logic',
									name: 'logic',
									type: 'options',
									options: [
										{
											name: 'AND',
											value: 'and',
											description: 'All conditions must be true',
										},
										{
											name: 'OR',
											value: 'or',
											description: 'At least one condition must be true',
										},
										{
											name: 'NOT',
											value: 'not',
											description: 'Conditions must be false',
										},
									],
									default: 'and',
									description: 'Logic operator for this route',
								},
								{
									displayName: 'Conditions',
									name: 'conditions',
									placeholder: 'Add Condition',
									type: 'fixedCollection',
									typeOptions: {
										multipleValues: true,
										sortable: true,
									},
									default: {
										values: [],
									},
									options: [
										{
											name: 'values',
											displayName: 'Condition',
											values: [
												{
													displayName: 'Field',
													name: 'field',
													type: 'string',
													default: '={{$json.}}',
													placeholder: '={{$json.status}}',
													description: 'Field to evaluate',
												},
												{
													displayName: 'Operator',
													name: 'operator',
													type: 'options',
													options: [
														{
															name: 'Equals',
															value: 'equals',
														},
														{
															name: 'Not Equals',
															value: 'notEquals',
														},
														{
															name: 'Contains',
															value: 'contains',
														},
														{
															name: 'Does Not Contain',
															value: 'notContains',
														},
														{
															name: 'Greater Than',
															value: 'greaterThan',
														},
														{
															name: 'Less Than',
															value: 'lessThan',
														},
														{
															name: 'Is Empty',
															value: 'isEmpty',
														},
														{
															name: 'Is Not Empty',
															value: 'isNotEmpty',
														},
														{
															name: 'Has Property',
															value: 'hasProperty',
														},
													],
													default: 'equals',
													description: 'Comparison operator',
												},
												{
													displayName: 'Value',
													name: 'value',
													type: 'string',
													default: '',
													placeholder: 'Active',
													description: 'Value to compare against',
													displayOptions: {
														hide: {
															operator: ['isEmpty', 'isNotEmpty'],
														},
													},
												},
												{
													displayName: 'Case Sensitive',
													name: 'caseSensitive',
													type: 'boolean',
													default: false,
													description: 'Whether string comparison should be case sensitive',
													displayOptions: {
														show: {
															operator: ['equals', 'notEquals', 'contains', 'notContains'],
														},
													},
												},
												{
													displayName: 'Type Validation',
													name: 'typeValidation',
													type: 'options',
													options: [
														{
															name: 'Strict',
															value: 'strict',
															description: 'Values must match exactly',
														},
														{
															name: 'Loose',
															value: 'loose',
															description: 'Allow type coercion',
														},
													],
													default: 'strict',
													description: 'How to handle type mismatches',
												},
											],
										},
									],
								},
							],
						},
					],
				},
				{
					displayName: 'Output Configuration',
					name: 'outputConfig',
					type: 'collection',
					placeholder: 'Add Configuration',
					default: {
						defaultRoute: 'Unmatched',
						outputFieldName: 'route',
						includeExplanation: false,
						stopAtFirstMatch: true,
					},
					options: [
						{
							displayName: 'Default Route',
							name: 'defaultRoute',
							type: 'string',
							default: 'Unmatched',
							description: 'Route name for items that don\'t match any conditions',
						},
						{
							displayName: 'Output Field Name',
							name: 'outputFieldName',
							type: 'string',
							default: 'route',
							description: 'Name of the field to add with the route name',
						},
						{
							displayName: 'Include Explanation',
							name: 'includeExplanation',
							type: 'boolean',
							default: false,
							description: 'Add an explanation field showing which conditions matched',
						},
						{
							displayName: 'Stop at First Match',
							name: 'stopAtFirstMatch',
							type: 'boolean',
							default: true,
							description: 'Stop after first matching route or continue to all matches',
						},
					],
				},
			],
		};
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const routes = (this.getNodeParameter('routes.values', 0, []) as IRoute[]) || [];
		const outputConfig = this.getNodeParameter('outputConfig', 0, {
			defaultRoute: 'Unmatched',
			outputFieldName: 'route',
			includeExplanation: false,
			stopAtFirstMatch: true,
		}) as IOutputConfig;

		const returnData: INodeExecutionData[][] = [[]];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const item = items[itemIndex];
			let matchedRoute: string | null = null;
			const allExplanations: string[] = [];

			// Evaluate each route
			for (const route of routes) {
				try {
					const evaluation = evaluateRoute(route, item, this, itemIndex);

					if (outputConfig.includeExplanation) {
						allExplanations.push(evaluation.explanation);
					}

					if (evaluation.matches) {
						matchedRoute = route.routeName;

						if (outputConfig.stopAtFirstMatch) {
							break;
						}
					}
				} catch (error) {
					if (this.continueOnFail()) {
						// Log error but continue
						continue;
					}
					throw new NodeOperationError(this.getNode(), `Error evaluating route "${route.routeName}": ${error.message}`, {
						itemIndex,
					});
				}
			}

			// Create output item
			const outputItem: INodeExecutionData = {
				...item,
				json: {
					...item.json,
					[outputConfig.outputFieldName]: matchedRoute || outputConfig.defaultRoute,
				},
			};

			// Add explanation if requested
			if (outputConfig.includeExplanation) {
				outputItem.json.explanation = allExplanations.join(' | ');
			}

			outputItem.pairedItem = { item: itemIndex };
			returnData[0].push(outputItem);
		}

		return returnData;
	}
}
