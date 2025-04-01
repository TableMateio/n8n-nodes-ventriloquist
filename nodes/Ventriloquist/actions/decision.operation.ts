import type {
	IExecuteFunctions,
	INodeExecutionData,
	IDataObject,
	INodeProperties,
} from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';

/**
 * Decision operation description
 */
export const description: INodeProperties[] = [
	{
		displayName: 'Operation Mode',
		name: 'mode',
		type: 'options',
		options: [
			{
				name: 'Basic - Single Condition',
				value: 'basic',
				description: 'Check a single condition and take an action',
			},
			{
				name: 'Advanced - Multiple Conditions',
				value: 'advanced',
				description: 'Define multiple conditions and actions',
			},
		],
		default: 'basic',
		description: 'How to configure conditions for the decision node',
		displayOptions: {
			show: {
				operation: ['decision'],
			},
		},
	},

	// ====================
	// BASIC MODE PARAMETERS
	// ====================

	{
		displayName: 'Condition Type',
		name: 'basicConditionType',
		type: 'options',
		options: [
			{
				name: 'Element Exists',
				value: 'elementExists',
				description: 'Check if an element exists on the page',
			},
			{
				name: 'Element Count',
				value: 'elementCount',
				description: 'Count elements matching a selector',
			},
			{
				name: 'Text Contains',
				value: 'textContains',
				description: 'Check text content of an element',
			},
			{
				name: 'URL Contains',
				value: 'urlContains',
				description: 'Check the current URL',
			},
			{
				name: 'Expression',
				value: 'expression',
				description: 'Use JavaScript expression',
			},
			{
				name: 'Input Source',
				value: 'inputSource',
				description: 'Check which node sent data',
			},
			{
				name: 'Execution Count',
				value: 'executionCount',
				description: 'Check how many times node has executed',
			},
		],
		default: 'elementExists',
		description: 'Type of condition to check',
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
			},
		},
	},

	// Element Exists - Basic
	{
		displayName: 'Selector',
		name: 'basicElementExistsSelector',
		type: 'string',
		default: '',
		placeholder: '#element, .class, div[data-test="value"]',
		description: 'CSS selector to target the element(s)',
		required: true,
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				basicConditionType: ['elementExists'],
			},
		},
	},

	// Element Count - Basic
	{
		displayName: 'Selector',
		name: 'basicElementCountSelector',
		type: 'string',
		default: '',
		placeholder: '#element, .class, div[data-test="value"]',
		description: 'CSS selector to target the element(s)',
		required: true,
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				basicConditionType: ['elementCount'],
			},
		},
	},
	{
		displayName: 'Count Comparison',
		name: 'basicElementCountComparison',
		type: 'options',
		options: [
			{
				name: 'Equal To',
				value: 'equal',
			},
			{
				name: 'Greater Than',
				value: 'greater',
			},
			{
				name: 'Greater Than or Equal To',
				value: 'greaterEqual',
			},
			{
				name: 'Less Than',
				value: 'less',
			},
			{
				name: 'Less Than or Equal To',
				value: 'lessEqual',
			},
		],
		default: 'equal',
		description: 'How to compare the actual element count with the expected count',
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				basicConditionType: ['elementCount'],
			},
		},
	},
	{
		displayName: 'Expected Count',
		name: 'basicElementCountExpected',
		type: 'number',
		default: 1,
		description: 'The value to compare the element count against',
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				basicConditionType: ['elementCount'],
			},
		},
	},

	// Text Contains - Basic
	{
		displayName: 'Selector',
		name: 'basicTextContainsSelector',
		type: 'string',
		default: '',
		placeholder: '#element, .class, div[data-test="value"]',
		description: 'CSS selector to target the element(s)',
		required: true,
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				basicConditionType: ['textContains'],
			},
		},
	},
	{
		displayName: 'Text to Check',
		name: 'basicTextToCheck',
		type: 'string',
		default: '',
		description: 'Text content to check for in the selected element',
		required: true,
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				basicConditionType: ['textContains'],
			},
		},
	},
	{
		displayName: 'Match Type',
		name: 'basicTextMatchType',
		type: 'options',
		options: [
			{
				name: 'Contains',
				value: 'contains',
				description: 'Value must contain the specified string',
			},
			{
				name: 'Ends With',
				value: 'endsWith',
				description: 'Value must end with the specified string',
			},
			{
				name: 'Exact Match',
				value: 'exact',
				description: 'Value must match exactly',
			},
			{
				name: 'RegEx',
				value: 'regex',
				description: 'Match using a regular expression',
			},
			{
				name: 'Starts With',
				value: 'startsWith',
				description: 'Value must start with the specified string',
			},
		],
		default: 'contains',
		description: 'How to match the text value',
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				basicConditionType: ['textContains'],
			},
		},
	},
	{
		displayName: 'Case Sensitive',
		name: 'basicTextCaseSensitive',
		type: 'boolean',
		default: false,
		description: 'Whether the matching should be case-sensitive',
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				basicConditionType: ['textContains'],
			},
		},
	},

	// URL Contains - Basic
	{
		displayName: 'URL Substring',
		name: 'basicUrlSubstring',
		type: 'string',
		default: '',
		description: 'Text to look for in the current URL',
		required: true,
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				basicConditionType: ['urlContains'],
			},
		},
	},
	{
		displayName: 'Match Type',
		name: 'basicUrlMatchType',
		type: 'options',
		options: [
			{
				name: 'Contains',
				value: 'contains',
				description: 'Value must contain the specified string',
			},
			{
				name: 'Ends With',
				value: 'endsWith',
				description: 'Value must end with the specified string',
			},
			{
				name: 'Exact Match',
				value: 'exact',
				description: 'Value must match exactly',
			},
			{
				name: 'RegEx',
				value: 'regex',
				description: 'Match using a regular expression',
			},
			{
				name: 'Starts With',
				value: 'startsWith',
				description: 'Value must start with the specified string',
			},
		],
		default: 'contains',
		description: 'How to match the URL value',
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				basicConditionType: ['urlContains'],
			},
		},
	},
	{
		displayName: 'Case Sensitive',
		name: 'basicUrlCaseSensitive',
		type: 'boolean',
		default: false,
		description: 'Whether the matching should be case-sensitive',
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				basicConditionType: ['urlContains'],
			},
		},
	},

	// Expression - Basic
	{
		displayName: 'JavaScript Expression',
		name: 'basicJsExpression',
		type: 'string',
		typeOptions: {
			rows: 4,
		},
		default: '$input.item.json.someProperty === true',
		description: 'JavaScript expression that should evaluate to true or false. You can use $input to access the input data.',
		placeholder: '$input.item.json.status === "success" || $input.item.json.count > 5',
		required: true,
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				basicConditionType: ['expression'],
			},
		},
	},

	// Input Source - Basic
	{
		displayName: 'Source Node Name',
		name: 'basicSourceNodeName',
		type: 'string',
		default: '',
		placeholder: 'e.g., HTTP Request, Function, Switch',
		description: 'Enter the exact name of the node that should trigger this condition. This is the name shown in the node\'s title bar.',
		required: true,
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				basicConditionType: ['inputSource'],
			},
		},
	},

	// Execution Count - Basic
	{
		displayName: 'Count Comparison',
		name: 'basicExecutionCountComparison',
		type: 'options',
		options: [
			{
				name: 'Equal To',
				value: 'equal',
			},
			{
				name: 'Greater Than',
				value: 'greater',
			},
			{
				name: 'Greater Than or Equal To',
				value: 'greaterEqual',
			},
			{
				name: 'Less Than',
				value: 'less',
			},
			{
				name: 'Less Than or Equal To',
				value: 'lessEqual',
			},
		],
		default: 'equal',
		description: 'How to compare the execution count',
		required: true,
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				basicConditionType: ['executionCount'],
			},
		},
	},
	{
		displayName: 'Execution Count',
		name: 'basicExecutionCountValue',
		type: 'number',
		default: 1,
		description: 'The value to compare the execution count against',
		required: true,
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				basicConditionType: ['executionCount'],
			},
		},
	},

	// Invert Result (common for all basic conditions)
	{
		displayName: 'Invert Condition Result',
		name: 'basicInvertCondition',
		type: 'boolean',
		default: false,
		description: 'Whether to invert the condition result (true becomes false, false becomes true)',
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
			},
		},
	},

	// Basic Action
	{
		displayName: 'Action If Condition Matches',
		name: 'basicActionType',
		type: 'options',
		options: [
			{
				name: 'Click Element',
				value: 'click',
				description: 'Click on an element',
			},
			{
				name: 'Extract Data',
				value: 'extract',
				description: 'Extract data from an element on the page',
			},
			{
				name: 'Fill Form Field',
				value: 'fill',
				description: 'Enter text into a form field',
			},
			{
				name: 'Navigate to URL',
				value: 'navigate',
				description: 'Navigate to a specific URL',
			},
			{
				name: 'No Action (Just Detect)',
				value: 'none',
				description: 'Only detect the condition, do not take any action',
			},
		],
		default: 'click',
		description: 'Action to take if the condition is met',
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
			},
		},
	},

	// Action Parameters - Basic
	{
		displayName: 'Action Selector',
		name: 'basicActionSelector',
		type: 'string',
		default: '',
		placeholder: 'button.submit, input[type="text"]',
		description: 'CSS selector for the element to interact with',
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				basicActionType: ['click', 'extract', 'fill'],
			},
		},
	},

	// Fill form options - Basic
	{
		displayName: 'Field Value',
		name: 'basicFieldValue',
		type: 'string',
		default: '',
		description: 'Value to enter into the form field',
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				basicActionType: ['fill'],
			},
		},
	},
	{
		displayName: 'Field Type',
		name: 'basicFieldType',
		type: 'options',
		options: [
			{
				name: 'Text / Textarea',
				value: 'text',
				description: 'Standard text input or textarea',
			},
			{
				name: 'Checkbox',
				value: 'checkbox',
				description: 'Checkbox input element',
			},
			{
				name: 'Radio Button',
				value: 'radio',
				description: 'Radio button input element',
			},
			{
				name: 'Select / Dropdown',
				value: 'select',
				description: 'Dropdown select element',
			},
			{
				name: 'File Upload',
				value: 'file',
				description: 'File input element',
			},
		],
		default: 'text',
		description: 'Type of form input to interact with',
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				basicActionType: ['fill'],
			},
		},
	},

	// Navigate URL - Basic
	{
		displayName: 'URL',
		name: 'basicNavigateUrl',
		type: 'string',
		default: '',
		placeholder: 'https://example.com',
		description: 'URL to navigate to',
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				basicActionType: ['navigate'],
			},
		},
	},

	// ====================
	// COMMON PARAMETERS
	// ====================

	{
		displayName: 'Enable Routing',
		name: 'enableRouting',
		type: 'boolean',
		default: false,
		description: 'Whether to route data to different outputs based on conditions',
		displayOptions: {
			show: {
				operation: ['decision'],
			},
		},
	},
	{
		displayName: 'Number of Routes',
		name: 'routeCount',
		type: 'number',
		default: 2,
		description: 'Maximum number of routes to create',
		displayOptions: {
			show: {
				operation: ['decision'],
				enableRouting: [true],
			},
		},
	},
	{
		displayName: 'Route If Condition Met',
		name: 'basicRoute',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'getRoutes',
		},
		default: '',
		description: 'Choose the route to take when the condition is met',
		displayOptions: {
			show: {
				operation: ['decision'],
				mode: ['basic'],
				enableRouting: [true],
			},
		},
	},
	// Add other common parameters like wait times, fallback actions, etc.

	// ... (rest of your parameters)
];

/**
 * Execute the decision operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	puppeteerPage: puppeteer.Page,
): Promise<INodeExecutionData[]> {
	const startTime = Date.now();
	const continueOnFail = this.getNodeParameter('continueOnFail', index, true) as boolean;

	try {
		// Get common operation parameters
		const mode = this.getNodeParameter('mode', index, 'basic') as string;
		const waitForSelectors = this.getNodeParameter('waitForSelectors', index, true) as boolean;
		const selectorTimeout = this.getNodeParameter('selectorTimeout', index, 5000) as number;
		const detectionMethod = this.getNodeParameter('detectionMethod', index, 'smart') as string;
		const earlyExitDelay = this.getNodeParameter('earlyExitDelay', index, 500) as number;
		const takeScreenshot = this.getNodeParameter('takeScreenshot', index, false) as boolean;

		// Get routing parameters
		const enableRouting = this.getNodeParameter('enableRouting', index, false) as boolean;

		// Initialize routing variables
		let routeTaken = 'none';
		let actionPerformed = 'none';
		let routeIndex = 0;
		const currentUrl = await puppeteerPage.url();
		let screenshot: string | undefined;

		// Prepare the result data structure
		const resultData: {
			success: boolean;
			routeTaken: string;
			actionPerformed: string;
			currentUrl: string;
			pageTitle: string;
			screenshot: string | undefined;
			executionDuration: number;
			routeName?: string;
			extractedData?: Record<string, unknown>;
		} = {
			success: true,
			routeTaken,
			actionPerformed,
			currentUrl,
			pageTitle: await puppeteerPage.title(),
			screenshot,
			executionDuration: 0, // Will be updated at the end
		};

		// Basic mode - single condition
		if (mode === 'basic') {
			const conditionType = this.getNodeParameter('basicConditionType', index) as string;
			const invertCondition = this.getNodeParameter('basicInvertCondition', index, false) as boolean;
			let conditionMet = false;

			// Check condition based on type
			switch (conditionType) {
				case 'elementExists': {
					const selector = this.getNodeParameter('basicElementExistsSelector', index) as string;

					if (waitForSelectors) {
						if (detectionMethod === 'smart') {
							conditionMet = await smartWaitForSelector(
								puppeteerPage,
								selector,
								selectorTimeout,
								earlyExitDelay,
								this.logger,
							);
						} else {
							try {
								await puppeteerPage.waitForSelector(selector, { timeout: selectorTimeout });
								conditionMet = true;
							} catch (error) {
								conditionMet = false;
							}
						}
					} else {
						// Just check without waiting
						const elementExists = await puppeteerPage.$(selector) !== null;
						conditionMet = elementExists;
					}
					break;
				}

				case 'elementCount': {
					const selector = this.getNodeParameter('basicElementCountSelector', index) as string;
					const expectedCount = this.getNodeParameter('basicElementCountExpected', index) as number;
					const countComparison = this.getNodeParameter('basicElementCountComparison', index) as string;

					// For element count, we just check without waiting as we expect some elements might not exist
					const elements = await puppeteerPage.$$(selector);
					const actualCount = elements.length;

					conditionMet = compareCount(actualCount, expectedCount, countComparison);
					break;
				}

				case 'textContains': {
					const selector = this.getNodeParameter('basicTextContainsSelector', index) as string;
					const textToCheck = this.getNodeParameter('basicTextToCheck', index) as string;
					const matchType = this.getNodeParameter('basicTextMatchType', index) as string;
					const caseSensitive = this.getNodeParameter('basicTextCaseSensitive', index) as boolean;

					if (waitForSelectors) {
						let elementExists = false;
						if (detectionMethod === 'smart') {
							elementExists = await smartWaitForSelector(
								puppeteerPage,
								selector,
								selectorTimeout,
								earlyExitDelay,
								this.logger,
							);
						} else {
							try {
								await puppeteerPage.waitForSelector(selector, { timeout: selectorTimeout });
								elementExists = true;
							} catch (error) {
								elementExists = false;
							}
						}

						if (!elementExists) {
							conditionMet = false;
						} else {
							try {
								const elementText = await puppeteerPage.$eval(selector, (el) => el.textContent || '');
								conditionMet = matchStrings(elementText, textToCheck, matchType, caseSensitive);
							} catch (error) {
								conditionMet = false;
							}
						}
					} else {
						try {
							const elementText = await puppeteerPage.$eval(selector, (el) => el.textContent || '');
							conditionMet = matchStrings(elementText, textToCheck, matchType, caseSensitive);
						} catch (error) {
							conditionMet = false;
						}
					}
					break;
				}

				case 'urlContains': {
					const urlSubstring = this.getNodeParameter('basicUrlSubstring', index) as string;
					const matchType = this.getNodeParameter('basicUrlMatchType', index) as string;
					const caseSensitive = this.getNodeParameter('basicUrlCaseSensitive', index) as boolean;

					conditionMet = matchStrings(currentUrl, urlSubstring, matchType, caseSensitive);
					break;
				}

				case 'expression': {
					const jsExpression = this.getNodeParameter('basicJsExpression', index) as string;

					try {
						// Create a safe context for expression evaluation
						const sandbox = {
							$input: this.getInputData()[index],
							$node: this.getNode(),
						};

						// Evaluate the expression in a safe manner
						const evalFunction = new Function(
							'$input',
							'$node',
							`"use strict"; return (${jsExpression});`,
						);

						// Execute the function with our safe context
						conditionMet = Boolean(evalFunction(sandbox.$input, sandbox.$node));
						this.logger.debug(`Expression evaluation result: ${conditionMet} for: ${jsExpression}`);
					} catch (error) {
						this.logger.error(`Error evaluating expression: ${(error as Error).message}`);
						conditionMet = false;
					}
					break;
				}

				case 'inputSource': {
					const sourceNodeName = this.getNodeParameter('basicSourceNodeName', index) as string;

					try {
						// Get the node that sent the data
						const inputData = this.getInputData()[index];

						// Only access source property if it's a data object with the right structure
						let inputNodeName: string | undefined;

						if (typeof inputData === 'object' &&
							inputData !== null &&
							'source' in inputData &&
							inputData.source !== null &&
							typeof inputData.source === 'object') {

							const source = inputData.source as IDataObject;
							if ('node' in source &&
								source.node !== null &&
								typeof source.node === 'object') {

								const node = source.node as IDataObject;
								if ('name' in node && typeof node.name === 'string') {
									inputNodeName = node.name;
								}
							}
						}

						// Compare with the expected source node name
						conditionMet = inputNodeName === sourceNodeName;
						this.logger.debug(`Input source check: ${inputNodeName} === ${sourceNodeName}: ${conditionMet}`);
					} catch (error) {
						this.logger.error(`Error checking input source: ${(error as Error).message}`);
						conditionMet = false;
					}
					break;
				}

				case 'executionCount': {
					const comparison = this.getNodeParameter('basicExecutionCountComparison', index) as string;
					const value = this.getNodeParameter('basicExecutionCountValue', index) as number;

					try {
						// Get static data for this node to track execution count
						const nodeContext = this.getWorkflowStaticData('node');

						// Initialize or increment the execution counter
						if (typeof nodeContext.executionCount !== 'number') {
							nodeContext.executionCount = 0;
						}

						nodeContext.executionCount = (nodeContext.executionCount as number) + 1;
						const currentCount = nodeContext.executionCount as number;

						// Compare using the same helper function we use for element count
						conditionMet = compareCount(currentCount, value, comparison);
						this.logger.debug(`Execution count check: ${currentCount} ${comparison} ${value}: ${conditionMet}`);
					} catch (error) {
						this.logger.error(`Error checking execution count: ${(error as Error).message}`);
						conditionMet = false;
					}
					break;
				}

				default:
					throw new Error(`Unknown condition type: ${conditionType}`);
			}

			// Apply inversion if needed
			if (invertCondition) {
				conditionMet = !conditionMet;
			}

			this.logger.debug(`Basic condition result: ${conditionMet}`);

			// If condition is met, perform the action
			if (conditionMet) {
				routeTaken = 'basic';
				const actionType = this.getNodeParameter('basicActionType', index) as string;

				// For routing capability, get the route
				if (enableRouting) {
					try {
						const route = this.getNodeParameter('basicRoute', index, '') as string;
						if (route) {
							// Route numbers are 1-based, but indexes are 0-based
							routeIndex = parseInt(route, 10) - 1;
						}
					} catch (error) {
						// If parameter doesn't exist, keep default route (0)
					}
				}

				// Perform action based on type
				if (actionType !== 'none') {
					actionPerformed = actionType;

					switch (actionType) {
						case 'click': {
							const selector = this.getNodeParameter('basicActionSelector', index) as string;

							// Add your click logic here
							// This is placeholder logic - implement the actual click functionality
							try {
								await puppeteerPage.click(selector);
							} catch (error) {
								this.logger.error(`Error clicking element: ${(error as Error).message}`);
								throw error;
							}

							break;
						}

						case 'fill': {
							const selector = this.getNodeParameter('basicActionSelector', index) as string;
							const value = this.getNodeParameter('basicFieldValue', index, '') as string;
							const fieldType = this.getNodeParameter('basicFieldType', index, 'text') as string;

							// Add your form fill logic here
							// This is placeholder logic - implement the actual form fill functionality
							try {
								if (fieldType === 'text') {
									await puppeteerPage.type(selector, value);
								} else if (fieldType === 'checkbox' || fieldType === 'radio') {
									await puppeteerPage.click(selector);
								} else if (fieldType === 'select') {
									await puppeteerPage.select(selector, value);
								}
							} catch (error) {
								this.logger.error(`Error filling form: ${(error as Error).message}`);
								throw error;
							}

							break;
						}

						case 'navigate': {
							const url = this.getNodeParameter('basicNavigateUrl', index) as string;

							// Add your navigation logic here
							// This is placeholder logic - implement the actual navigation functionality
							try {
								await puppeteerPage.goto(url);
							} catch (error) {
								this.logger.error(`Error navigating to URL: ${(error as Error).message}`);
								throw error;
							}

							break;
						}

						case 'extract': {
							const selector = this.getNodeParameter('basicActionSelector', index) as string;

							// Add your data extraction logic here
							// This is placeholder logic - implement the actual extraction functionality
							try {
								const extractedText = await puppeteerPage.$eval(selector, (el) => el.textContent || '');
								resultData.extractedData = { text: extractedText };
							} catch (error) {
								this.logger.error(`Error extracting data: ${(error as Error).message}`);
								throw error;
							}

							break;
						}

						default:
							throw new Error(`Unknown action type: ${actionType}`);
					}
				}
			}
			// If the condition was not met in basic mode, no action is taken
		}
		// Advanced mode handling would go here

		// Take a screenshot if requested
		if (takeScreenshot) {
			try {
				screenshot = await puppeteerPage.screenshot({ encoding: 'base64' }) as string;
				resultData.screenshot = `data:image/png;base64,${screenshot}`;
			} catch (error) {
				this.logger.warn(`Failed to take screenshot: ${(error as Error).message}`);
			}
		}

		// Update final results
		resultData.routeTaken = routeTaken;
		resultData.actionPerformed = actionPerformed;
		resultData.currentUrl = await puppeteerPage.url();
		resultData.pageTitle = await puppeteerPage.title();
		resultData.executionDuration = Date.now() - startTime;

		// Return the appropriate output based on routing configuration
		const outputItems: INodeExecutionData[] = [];

		if (enableRouting) {
			// Create an array for the number of outputs requested
			const routeCount = this.getNodeParameter('routeCount', index, 2) as number;
			for (let i = 0; i < routeCount; i++) {
				if (i === routeIndex) {
					// This is the matching route, add the result
					outputItems.push({
						json: {
							...resultData,
						},
					});
				} else {
					// Empty outputs for other routes
					outputItems.push({ json: {} });
				}
			}
		} else {
			// No routing, just return the result
			outputItems.push({
				json: {
					...resultData,
				},
			});
		}

		return outputItems;
	} catch (error) {
		this.logger.error(`Decision node error: ${(error as Error).message}`);

		// Handle errors based on continueOnFail
		if (continueOnFail) {
			return [
				{
					json: {
						success: false,
						error: (error as Error).message,
						executionDuration: Date.now() - startTime,
					},
				},
			];
		} else {
			throw error;
		}
	}
}

// Helper functions

// Utility function for smart DOM-ready detection
async function smartWaitForSelector(
	page: puppeteer.Page,
	selector: string,
	timeout: number,
	earlyExitDelay: number,
	logger: any,
): Promise<boolean> {
	let elementFound = false;
	const startTime = Date.now();
	const deadlineTime = startTime + timeout;

	// First quick check
	elementFound = await page.$(selector) !== null;
	if (elementFound) {
		logger.debug(`Element found immediately: ${selector}`);
		return true;
	}

	// Check if we can wait for a while to give the page time to load
	if (Date.now() + earlyExitDelay < deadlineTime) {
		// Wait for a reasonable delay
		await new Promise(resolve => setTimeout(resolve, earlyExitDelay));

		// Check again after delay
		elementFound = await page.$(selector) !== null;
		if (elementFound) {
			logger.debug(`Element found after short delay: ${selector}`);
			return true;
		}
	}

	// If we still have time, try to use waitForSelector
	if (Date.now() < deadlineTime) {
		try {
			const remainingTime = deadlineTime - Date.now();
			await page.waitForSelector(selector, { timeout: remainingTime });
			logger.debug(`Element found with waitForSelector: ${selector}`);
			return true;
		} catch (error) {
			// Element not found within the time
			logger.debug(`Element not found with waitForSelector: ${selector}`);
			return false;
		}
	}

	return false;
}

// Utility function to compare counts
function compareCount(actual: number, expected: number, comparison: string): boolean {
	switch (comparison) {
		case 'equal':
			return actual === expected;
		case 'greater':
			return actual > expected;
		case 'greaterEqual':
			return actual >= expected;
		case 'less':
			return actual < expected;
		case 'lessEqual':
			return actual <= expected;
		default:
			return false;
	}
}

// Utility function to match strings
function matchStrings(value: string, matchValue: string, matchType: string, caseSensitive: boolean): boolean {
	// Prepare values for comparison based on case sensitivity
	const prepValue = caseSensitive ? value : value.toLowerCase();
	const prepMatchValue = caseSensitive ? matchValue : matchValue.toLowerCase();

	switch (matchType) {
		case 'contains':
			return prepValue.includes(prepMatchValue);
		case 'exact':
			return prepValue === prepMatchValue;
		case 'startsWith':
			return prepValue.startsWith(prepMatchValue);
		case 'endsWith':
			return prepValue.endsWith(prepMatchValue);
		case 'regex': {
			try {
				const flags = caseSensitive ? '' : 'i';
				const regex = new RegExp(matchValue, flags);
				return regex.test(value);
			} catch (error) {
				// Invalid regex
				return false;
			}
		}
		default:
			return false;
	}
}


