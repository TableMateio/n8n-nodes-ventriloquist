import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { formatOperationLog } from './resultUtils';
import type {
	IDetectionOptions,
	IDetectionResult
} from './detectionUtils';
import {
	detectElement,
	detectText,
	detectCount,
	detectUrl,
	detectExpression,
	detectExecutionCount,
	detectInputSource,
	processDetection,
} from './detectionUtils';

/**
 * Safely evaluate a JavaScript expression in a given context
 */
function evaluateInContext(expression: string, context: any): any {
	try {
		// Create a function with the context variables as parameters
		const contextKeys = Object.keys(context);
		const contextValues = contextKeys.map(key => context[key]);

		// Create a function that evaluates the expression with the context
		const func = new Function(...contextKeys, `return ${expression}`);

		// Call the function with the context values
		return func(...contextValues);
	} catch (error) {
		throw new Error(`Expression evaluation failed: ${(error as Error).message}`);
	}
}

/**
 * Interface for condition result
 */
export interface IConditionResult {
	success: boolean;
	details?: {
		conditionType: string;
		reason?: string;
	};
}

/**
 * Interface for condition group
 */
export interface IConditionGroup {
	name: string;
	conditionType: string;
	conditions?: IDataObject[];
	singleConditionType?: string;
	singleSelector?: string;
	singleAttributeName?: string;
	singleAttributeValue?: string;
	singleTextToCheck?: string;
	singleUrlSubstring?: string;
	singleCountComparison?: string;
	singleExpectedCount?: number;
	singleJsExpression?: string;
	singleSourceNodeName?: string;
	singleExecutionCountComparison?: string;
	singleExecutionCountValue?: number;
	singleMatchType?: string;
	singleCaseSensitive?: boolean;
	singleInvertCondition?: boolean;
	// Additional properties from conditions collection
	invertCondition?: boolean;
}

/**
 * Evaluate a single condition
 */
export async function evaluateCondition(
	page: puppeteer.Page | null,
	condition: IDataObject,
	conditionType: string,
	waitForSelectors: boolean,
	selectorTimeout: number,
	detectionMethod: string,
	earlyExitDelay: number,
	currentUrl: string,
	index: number,
	thisNode: IExecuteFunctions
): Promise<boolean> {
	try {
		// Create detection options once
		const detectionOptions: IDetectionOptions = {
			waitForSelectors,
			selectorTimeout,
			detectionMethod,
			earlyExitDelay,
			nodeName: thisNode.getNode().name,
			nodeId: thisNode.getNode().id,
			index,
		};

		let result: IDetectionResult;

		// Check if condition requires a page and page is null
		const pageRequiredConditions = ['attributeValue', 'elementExists', 'textContains', 'elementCount', 'urlContains'];
		if (pageRequiredConditions.includes(conditionType) && !page) {
			thisNode.logger.warn(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
				`Condition type '${conditionType}' requires a session but no session is available - condition will evaluate to false`));

			result = {
				success: false,
				actualValue: 'no session available',
				details: {
					conditionType,
					error: 'No session available for page-based condition'
				}
			};
		} else {
			switch (conditionType) {
				case 'elementExists': {
					const selector = condition.selector as string;
					result = await detectElement(page!, selector, detectionOptions, thisNode.logger);
					break;
				}

				case 'attributeValue': {
					const detection = {
						detectionType: 'attributeValue',
						selector: condition.selector as string,
						attributeName: condition.attributeName as string,
						attributeValue: condition.attributeValue as string,
						matchType: condition.matchType as string || 'contains',
						caseSensitive: condition.caseSensitive as boolean || false,
					};

					result = await processDetection(
						page!,
						detection,
						'', // currentUrl not needed for attribute detection
						detectionOptions.waitForSelectors,
						detectionOptions.selectorTimeout,
						detectionOptions.detectionMethod,
						detectionOptions.earlyExitDelay,
						thisNode.logger,
						detectionOptions.nodeName,
						detectionOptions.nodeId
					);
					break;
				}

				case 'textContains': {
					const selector = condition.selector as string;
					const textToCheck = condition.textToCheck as string;
					const matchType = condition.matchType as string;
					const caseSensitive = condition.caseSensitive as boolean;

					result = await detectText(
						page!,
						selector,
						textToCheck,
						matchType,
						caseSensitive,
						detectionOptions,
						thisNode.logger
					);
					break;
				}

				case 'elementCount': {
					const selector = condition.selector as string;
					const expectedCount = condition.expectedCount as number;
					const countComparison = condition.countComparison as string;

					result = await detectCount(
						page!,
						selector,
						expectedCount,
						countComparison,
						detectionOptions,
						thisNode.logger
					);
					break;
				}

				case 'urlContains': {
					const urlSubstring = condition.urlSubstring as string;
					const matchType = condition.matchType as string || 'contains';
					const caseSensitive = condition.caseSensitive as boolean || false;

					result = await detectUrl(
						page!,
						urlSubstring,
						matchType,
						caseSensitive,
						detectionOptions,
						thisNode.logger
					);
					break;
				}

								case 'expression': {
					const rawJsExpression = condition.jsExpression;

					thisNode.logger.info(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
						`[DEBUG] Evaluating expression condition: "${rawJsExpression}" (type: ${typeof rawJsExpression})`));

					// CRITICAL: n8n resolves {{ }} expressions BEFORE the node code runs.
					// For type:"string" fields inside collections, n8n may return the resolved
					// value as its native type (boolean, number) rather than coercing to string.
					// e.g. {{ true }} becomes boolean true, not string "true".
					// We must handle non-string resolved values as direct truthiness results.
					if (typeof rawJsExpression !== 'string') {
						// n8n already resolved the expression to a non-string value (boolean, number, etc.)
						// Use it directly as a truthiness check
						const success = !!rawJsExpression;

						thisNode.logger.info(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
							`[DEBUG] Expression was pre-resolved by n8n to ${typeof rawJsExpression}: ${rawJsExpression}, success: ${success}`));

						result = {
							success,
							actualValue: String(rawJsExpression),
							details: {
								conditionType,
								expression: String(rawJsExpression),
								isN8nExpression: true,
								preResolved: true
							}
						};
						break;
					}

					const jsExpression = rawJsExpression as string;

					// Check if this is an n8n expression (wrapped in {{ }}) or raw JavaScript
					const isN8nExpression = jsExpression.trim().startsWith('{{') && jsExpression.trim().endsWith('}}');

					thisNode.logger.info(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
						`[DEBUG] Expression type: ${isN8nExpression ? 'n8n' : 'raw'}`));

					if (isN8nExpression) {
						// n8n expressions can be evaluated without a page using n8n's expression system
						try {
							thisNode.logger.debug(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
								`Evaluating n8n expression: ${jsExpression}`));

							// For n8n expressions, we need to evaluate them in the Node.js context
							// Extract the expression content (remove {{ and }})
							const expressionContent = jsExpression.trim().slice(2, -2).trim();

							// Get the input data for evaluation
							const inputData = thisNode.getInputData();
							const currentItem = inputData[index] || {};

							// Create evaluation context
							const context = {
								$json: currentItem.json || {},
								$input: currentItem,
								$item: currentItem,
								$items: inputData
							};

							thisNode.logger.info(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
								`[DEBUG] Expression content: "${expressionContent}"`));
							thisNode.logger.info(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
								`[DEBUG] Context $json: ${JSON.stringify(context.$json)}`));

							// Evaluate the expression
							const expressionResult = evaluateInContext(expressionContent, context);
							const success = !!expressionResult;

							thisNode.logger.info(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
								`[DEBUG] Expression result: ${expressionResult}, success: ${success}`));

							result = {
								success,
								actualValue: String(expressionResult),
								details: {
									conditionType,
									expression: jsExpression,
									isN8nExpression: true
								}
							};

							thisNode.logger.debug(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
								`n8n expression result: ${expressionResult} (success: ${success})`));
						} catch (error) {
							thisNode.logger.warn(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
								`Error evaluating n8n expression: ${(error as Error).message}`));
							result = {
								success: false,
								actualValue: `Error: ${(error as Error).message}`,
								details: {
									conditionType,
									expression: jsExpression,
									isN8nExpression: true,
									error: (error as Error).message
								}
							};
						}
					} else {
						// Raw JavaScript expressions require a page to evaluate in browser context
						if (!page) {
							thisNode.logger.warn(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
								`Raw JavaScript expression requires a session but no session is available - condition will evaluate to false`));
							result = {
								success: false,
								actualValue: 'no session available',
								details: {
									conditionType,
									expression: jsExpression,
									isN8nExpression: false,
									error: 'No session available for raw JavaScript expression'
								}
							};
						} else {
							result = await detectExpression(page, jsExpression, detectionOptions, thisNode.logger);
						}
					}
					break;
				}

				case 'executionCount': {
					// Get the current execution count from the context
					// This is typically tracked elsewhere in the system
					// For now we'll use a dummy value of 1 - this should be replaced with actual tracking
					const executionCountValue = 1; // This should be retrieved from an execution tracker
					const expectedCount = condition.executionCountValue as number;
					const countComparison = condition.executionCountComparison as string;

					result = await detectExecutionCount(
						executionCountValue,
						expectedCount,
						countComparison,
						detectionOptions,
						thisNode.logger
					);
					break;
				}

				case 'inputSource': {
					// Get the source node name from context
					// This would typically come from the workflow execution context
					// For now we'll use a dummy placeholder approach
					const actualSourceNodeName = 'unknown'; // This should be retrieved from workflow context
					const expectedSourceNodeName = condition.sourceNodeName as string;

					result = await detectInputSource(
						actualSourceNodeName,
						expectedSourceNodeName,
						detectionOptions,
						thisNode.logger
					);
					break;
				}

				default:
					// Unrecognized condition type
					thisNode.logger.warn(`Unrecognized condition type: ${conditionType}`);
					return false;
			}
		}

		return result.success;
	} catch (error) {
		// Log the error but don't stop execution
		thisNode.logger.error(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
			`Error evaluating condition type ${conditionType}: ${(error as Error).message}`));

		// Return false on any error in condition evaluation
		return false;
	}
}

/**
 * Evaluate a condition group with multiple conditions
 */
export async function evaluateConditionGroup(
	page: puppeteer.Page | null,
	conditionGroup: IConditionGroup,
	waitForSelectors: boolean,
	selectorTimeout: number,
	detectionMethod: string,
	earlyExitDelay: number,
	currentUrl: string,
	index: number,
	thisNode: IExecuteFunctions
): Promise<IConditionResult> {
	const groupName = conditionGroup.name;
	const conditionType = conditionGroup.conditionType;
	const invertGroupCondition = conditionGroup.invertCondition || false;
	let groupConditionMet = false;
	let failureReason = '';

	thisNode.logger.info(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
		`Evaluating condition group "${groupName}" (type: ${conditionType}, invert: ${invertGroupCondition})`));

	try {
		// Handle the different condition types
		if (conditionType === 'one') {
			// Handle single condition case with direct parameters (not in a collection)
			const singleConditionType = conditionGroup.singleConditionType || 'elementExists';
			const invertSingleCondition = conditionGroup.singleInvertCondition || false;

			// Create a condition object from the single condition parameters
			const singleCondition: IDataObject = {
				conditionType: singleConditionType,
				invertCondition: invertSingleCondition,
			};

			// Add specific fields based on condition type
			switch (singleConditionType) {
				case 'attributeValue':
				case 'elementExists':
				case 'textContains':
				case 'elementCount':
					singleCondition.selector = conditionGroup.singleSelector;
					break;
				case 'expression':
					singleCondition.jsExpression = conditionGroup.singleJsExpression;
					break;
				case 'inputSource':
					singleCondition.sourceNodeName = conditionGroup.singleSourceNodeName;
					break;
				case 'executionCount':
					singleCondition.executionCountComparison = conditionGroup.singleExecutionCountComparison;
					singleCondition.executionCountValue = conditionGroup.singleExecutionCountValue;
					break;
				case 'urlContains':
					singleCondition.urlSubstring = conditionGroup.singleUrlSubstring;
					break;
			}

			// Add additional fields for specific condition types
			if (singleConditionType === 'attributeValue') {
				singleCondition.attributeName = conditionGroup.singleAttributeName;
				singleCondition.attributeValue = conditionGroup.singleAttributeValue;
				singleCondition.matchType = conditionGroup.singleMatchType;
				singleCondition.caseSensitive = conditionGroup.singleCaseSensitive;
			}

			if (singleConditionType === 'textContains') {
				singleCondition.textToCheck = conditionGroup.singleTextToCheck;
				singleCondition.matchType = conditionGroup.singleMatchType;
				singleCondition.caseSensitive = conditionGroup.singleCaseSensitive;
			}

			if (singleConditionType === 'urlContains') {
				singleCondition.matchType = conditionGroup.singleMatchType;
				singleCondition.caseSensitive = conditionGroup.singleCaseSensitive;
			}

			if (singleConditionType === 'elementCount') {
				singleCondition.countComparison = conditionGroup.singleCountComparison;
				singleCondition.expectedCount = conditionGroup.singleExpectedCount;
			}

			thisNode.logger.info(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
				`[DEBUG] About to evaluate single condition: ${singleConditionType}, condition object: ${JSON.stringify(singleCondition)}`));

			// Evaluate the single condition
			groupConditionMet = await evaluateCondition(
				page,
				singleCondition,
				singleConditionType,
				waitForSelectors,
				selectorTimeout,
				detectionMethod,
				earlyExitDelay,
				currentUrl,
				index,
				thisNode
			);

			thisNode.logger.info(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
				`[DEBUG] Single condition (${singleConditionType}) raw result: ${groupConditionMet}`));

			// Apply inversion if needed
			if (invertSingleCondition) {
				groupConditionMet = !groupConditionMet;
				thisNode.logger.info(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
					`[DEBUG] Applied inversion: ${!groupConditionMet} -> ${groupConditionMet}`));
			}

			thisNode.logger.info(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
				`[DEBUG] Single condition (${singleConditionType}) final result: ${groupConditionMet}`));

			if (!groupConditionMet) {
				failureReason = `Single condition of type '${singleConditionType}' was not met`;
			}
		} else {
			// Handle multiple conditions with AND/OR logic
			// Get conditions and ensure type safety
			let conditions: IDataObject[] = [];
			if (conditionGroup.conditions && Array.isArray(conditionGroup.conditions)) {
				conditions = conditionGroup.conditions;
			}

			thisNode.logger.debug(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
				`Checking ${conditions.length} conditions with ${conditionType} logic`));

			// Handle the case of no conditions - default to false
			if (conditions.length === 0) {
				thisNode.logger.debug(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
					`No conditions in group ${groupName}, skipping`));
				groupConditionMet = false;
				failureReason = 'No conditions defined in condition group';
			} else if (conditions.length === 1) {
				// Single condition in multiple conditions case
				const condition = conditions[0];
				const singleConditionType = condition.conditionType as string;
				const invertSingleCondition = condition.invertCondition as boolean || false;

				// Evaluate the single condition
				groupConditionMet = await evaluateCondition(
					page,
					condition,
					singleConditionType,
					waitForSelectors,
					selectorTimeout,
					detectionMethod,
					earlyExitDelay,
					currentUrl,
					index,
					thisNode
				);

				// Apply inversion if needed
				if (invertSingleCondition) {
					groupConditionMet = !groupConditionMet;
				}

				thisNode.logger.debug(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
					`Single condition in collection (${singleConditionType}) result: ${groupConditionMet}`));

				if (!groupConditionMet) {
					failureReason = `Single condition of type '${singleConditionType}' in collection was not met`;
				}
			} else {
				// Multiple conditions case - apply logical operator based on conditionType
				if (conditionType === 'and') {
					// AND logic - start with true, any false makes it false
					groupConditionMet = true;
					const failedConditions: string[] = [];

					for (const condition of conditions) {
						const singleConditionType = condition.conditionType as string;
						const invertSingleCondition = condition.invertCondition as boolean || false;

						// Evaluate the condition
						let conditionMet = await evaluateCondition(
							page,
							condition,
							singleConditionType,
							waitForSelectors,
							selectorTimeout,
							detectionMethod,
							earlyExitDelay,
							currentUrl,
							index,
							thisNode
						);

						// Apply inversion if needed
						if (invertSingleCondition) {
							conditionMet = !conditionMet;
						}

						// Short circuit if any condition is false
						if (!conditionMet) {
							groupConditionMet = false;
							failedConditions.push(singleConditionType);
							thisNode.logger.debug(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
								`Condition (${singleConditionType}) is false, short-circuiting AND logic`));
							break;
						}
					}

					if (!groupConditionMet && failedConditions.length > 0) {
						failureReason = `AND condition failed at: ${failedConditions.join(', ')}`;
					}
				} else if (conditionType === 'or') {
					// OR logic - start with false, any true makes it true
					groupConditionMet = false;
					const allFailedConditions: string[] = [];

					for (const condition of conditions) {
						const singleConditionType = condition.conditionType as string;
						const invertSingleCondition = condition.invertCondition as boolean || false;

						// Evaluate the condition
						let conditionMet = await evaluateCondition(
							page,
							condition,
							singleConditionType,
							waitForSelectors,
							selectorTimeout,
							detectionMethod,
							earlyExitDelay,
							currentUrl,
							index,
							thisNode
						);

						// Apply inversion if needed
						if (invertSingleCondition) {
							conditionMet = !conditionMet;
						}

						// Short circuit if any condition is true
						if (conditionMet) {
							groupConditionMet = true;
							thisNode.logger.debug(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
								`Condition (${singleConditionType}) is true, short-circuiting OR logic`));
							break;
						}

						allFailedConditions.push(singleConditionType);
					}

					if (!groupConditionMet && allFailedConditions.length > 0) {
						failureReason = `OR condition failed: all conditions failed (${allFailedConditions.join(', ')})`;
					}
				}

				thisNode.logger.debug(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
					`Multiple conditions with ${conditionType} logic result: ${groupConditionMet}`));
			}
		}

		// Apply group inversion if needed
		if (invertGroupCondition) {
			const originalResult = groupConditionMet;
			groupConditionMet = !groupConditionMet;

			thisNode.logger.debug(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
				`Applied group inversion: ${originalResult} -> ${groupConditionMet}`));

			// Update failure reason for inverted conditions
			if (!groupConditionMet && failureReason === '') {
				failureReason = 'Inverted condition failed (original condition was met)';
			}
		}

		thisNode.logger.debug(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
			`Decision group ${groupName} final result: ${groupConditionMet}`));

		return {
			success: groupConditionMet,
			details: {
				conditionType,
				reason: failureReason || undefined,
			}
		};
	} catch (error) {
		thisNode.logger.error(formatOperationLog('ConditionUtils', thisNode.getNode().name, thisNode.getNode().id, index,
			`Error evaluating condition group: ${(error as Error).message}`));

		return {
			success: false,
			details: {
				conditionType,
				reason: `Error: ${(error as Error).message}`,
			}
		};
	}
}
