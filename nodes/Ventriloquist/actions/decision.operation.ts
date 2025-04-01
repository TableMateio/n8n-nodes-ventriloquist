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
		displayName: 'Fallback Route Name or ID',
		name: 'fallbackRoute',
		type: 'options',
		default: '',
		description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		displayOptions: {
			show: {
				'/operation': ['decision'],
				'/enableRouting': [true],
				'/fallbackAction': ['click', 'extract', 'fill', 'navigate'],
			},
		},
		typeOptions: {
			loadOptionsMethod: 'getRoutes',
		},
	},
	{
		displayName: 'Condition Groups',
		name: 'conditionGroups',
		placeholder: 'Add Condition Group',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		displayOptions: {
			show: {
				operation: ['decision'],
			},
		},
		description: 'Define conditions to check and actions to take if they match',
		default: {},
		options: [
			{
				name: 'groups',
				displayName: 'Condition Group',
				values: [
					{
						displayName: 'Group Name',
						name: 'name',
						type: 'string',
						default: '',
						description: 'Name for this condition group, used in output',
						placeholder: 'e.g., loginForm',
						required: true,
					},
					{
						displayName: 'Route Name or ID',
						name: 'route',
						type: 'options',
						default: '',
						description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
						displayOptions: {
							show: {
								'/operation': ['decision'],
								'/enableRouting': [true],
							},
						},
						typeOptions: {
							loadOptionsMethod: 'getRoutes',
						},
					},
					{
						displayName: 'Condition Type',
						name: 'conditionType',
						type: 'options',
						options: [
							{
								name: 'Element Exists',
								value: 'elementExists',
								description: 'Check if element exists on the page',
							},
							{
								name: 'Text Contains',
								value: 'textContains',
								description: 'Check if element contains specific text',
							},
							{
								name: 'Element Count',
								value: 'elementCount',
								description: 'Count the elements that match a selector',
							},
							{
								name: 'URL Contains',
								value: 'urlContains',
								description: 'Check if current URL contains string',
							},
						],
						default: 'elementExists',
						description: 'Type of condition to check',
					},
					{
						displayName: 'Selector',
						name: 'selector',
						type: 'string',
						default: '',
						placeholder: '#element, .class, div[data-test="value"]',
						description: 'CSS selector to target the element(s)',
						displayOptions: {
							show: {
								conditionType: ['elementExists', 'textContains', 'elementCount'],
							},
						},
					},
					{
						displayName: 'Text to Check',
						name: 'textToCheck',
						type: 'string',
						default: '',
						description: 'Text content to check for in the selected element',
						displayOptions: {
							show: {
								conditionType: ['textContains'],
							},
						},
					},
					{
						displayName: 'URL Substring',
						name: 'urlSubstring',
						type: 'string',
						default: '',
						description: 'String to check for in the current URL',
						displayOptions: {
							show: {
								conditionType: ['urlContains'],
							},
						},
					},
					{
						displayName: 'Expected Count',
						name: 'expectedCount',
						type: 'number',
						default: 1,
						description: 'Expected number of elements to find',
						displayOptions: {
							show: {
								conditionType: ['elementCount'],
							},
						},
					},
					{
						displayName: 'Count Comparison',
						name: 'countComparison',
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
						description: 'How to compare the actual count with the expected count',
						displayOptions: {
							show: {
								conditionType: ['elementCount'],
							},
						},
					},
					{
						displayName: 'Match Type',
						name: 'matchType',
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
						description: 'How to match the text or URL value',
						displayOptions: {
							show: {
								conditionType: ['textContains', 'urlContains'],
							},
						},
					},
					{
						displayName: 'Case Sensitive',
						name: 'caseSensitive',
						type: 'boolean',
						default: false,
						description: 'Whether the matching should be case-sensitive',
						displayOptions: {
							show: {
								conditionType: ['textContains', 'urlContains'],
							},
						},
					},
					{
						displayName: 'Invert Condition',
						name: 'invertCondition',
						type: 'boolean',
						default: false,
						description: 'Whether to invert the condition result (true becomes false, false becomes true)',
					},
					{
						displayName: 'Action If Condition Matches',
						name: 'actionType',
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
					},
					{
						displayName: 'Action Selector',
						name: 'actionSelector',
						type: 'string',
						default: '',
						placeholder: 'button.submit, input[type="text"]',
						description: 'CSS selector for the element to interact with',
						displayOptions: {
							show: {
								actionType: ['click', 'fill', 'extract'],
							},
						},
					},
					{
						displayName: 'Extraction Type',
						name: 'extractionType',
						type: 'options',
						options: [
							{
								name: 'Attribute',
								value: 'attribute',
								description: 'Extract specific attribute from an element',
							},
							{
								name: 'HTML',
								value: 'html',
								description: 'Extract HTML content from an element',
							},
							{
								name: 'Input Value',
								value: 'value',
								description: 'Extract value from input, select or textarea',
							},
							{
								name: 'Text Content',
								value: 'text',
								description: 'Extract text content from an element',
							},
						],
						default: 'text',
						description: 'What type of data to extract from the element',
						displayOptions: {
							show: {
								actionType: ['extract'],
							},
						},
					},
					{
						displayName: 'HTML Options',
						name: 'htmlOptions',
						type: 'collection',
						placeholder: 'Add Option',
						default: {},
						typeOptions: {
							multipleValues: false,
						},
						displayOptions: {
							show: {
								actionType: ['extract'],
								extractionType: ['html'],
							},
						},
						options: [
							{
								displayName: 'Output Format',
								name: 'outputFormat',
								type: 'options',
								options: [
									{
										name: 'HTML (String)',
										value: 'html',
										description: 'Return the HTML as a raw string',
									},
									{
										name: 'JSON',
										value: 'json',
										description: 'Return the HTML wrapped in a JSON object',
									},
								],
								default: 'html',
								description: 'Format of the output data',
							},
							{
								displayName: 'Include Metadata',
								name: 'includeMetadata',
								type: 'boolean',
								default: false,
								description: 'Whether to include metadata about the HTML (length, structure info)',
							},
						],
					},
					{
						displayName: 'Attribute Name',
						name: 'extractAttributeName',
						type: 'string',
						default: '',
						placeholder: 'href, src, data-ID',
						description: 'Name of the attribute to extract from the element',
						displayOptions: {
							show: {
								actionType: ['extract'],
								extractionType: ['attribute'],
							},
						},
					},
					{
						displayName: 'Text Value',
						name: 'textValue',
						type: 'string',
						default: '',
						description: 'Text to enter into the form field',
						displayOptions: {
							show: {
								actionType: ['fill'],
							},
						},
					},
					{
						displayName: 'URL',
						name: 'url',
						type: 'string',
						default: '',
						placeholder: 'https://example.com/page',
						description: 'URL to navigate to',
						displayOptions: {
							show: {
								actionType: ['navigate'],
							},
						},
					},
					{
						displayName: 'Wait After Action',
						name: 'waitAfterAction',
						type: 'options',
						options: [
							{
								name: 'DOM Content Loaded',
								value: 'domContentLoaded',
								description: 'Wait until the DOM content is loaded (faster)',
							},
							{
								name: 'Fixed Time',
								value: 'fixedTime',
								description: 'Wait for a specific amount of time',
							},
							{
								name: 'Navigation Complete',
								value: 'navigationComplete',
								description: 'Wait until navigation is complete (slower but more thorough)',
							},
							{
								name: 'No Wait',
								value: 'noWait',
								description: 'Do not wait after the action',
							},
						],
						default: 'domContentLoaded',
						description: 'What to wait for after performing the action',
						displayOptions: {
							show: {
								actionType: ['click', 'navigate'],
							},
						},
					},
					{
						displayName: 'Wait Time (MS)',
						name: 'waitTime',
						type: 'number',
						default: 2000,
						description: 'Time to wait in milliseconds (for fixed time wait)',
						displayOptions: {
							show: {
								waitAfterAction: ['fixedTime'],
								actionType: ['click', 'navigate'],
							},
						},
					},
				],
			},
		],
		required: true,
	},
	{
		displayName: 'Fallback Action',
		name: 'fallbackAction',
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
				name: 'None',
				value: 'none',
				description: 'Do not perform any fallback action',
			},
		],
		default: 'none',
		description: 'Action to take if none of the conditions match',
		displayOptions: {
			show: {
				operation: ['decision'],
			},
		},
	},
	{
		displayName: 'Fallback Selector',
		name: 'fallbackSelector',
		type: 'string',
		default: '',
		placeholder: 'button.cancel, input[type="text"]',
		description: 'CSS selector for the element to interact with in the fallback action',
		displayOptions: {
			show: {
				operation: ['decision'],
				fallbackAction: ['click', 'fill', 'extract'],
			},
		},
	},
	{
		displayName: 'Fallback Extraction Type',
		name: 'fallbackExtractionType',
		type: 'options',
		options: [
			{
				name: 'Attribute',
				value: 'attribute',
				description: 'Extract specific attribute from an element',
			},
			{
				name: 'HTML',
				value: 'html',
				description: 'Extract HTML content from an element',
			},
			{
				name: 'Input Value',
				value: 'value',
				description: 'Extract value from input, select or textarea',
			},
			{
				name: 'Text Content',
				value: 'text',
				description: 'Extract text content from an element',
			},
		],
		default: 'text',
		description: 'What type of data to extract from the element',
		displayOptions: {
			show: {
				operation: ['decision'],
				fallbackAction: ['extract'],
			},
		},
	},
	{
		displayName: 'Fallback HTML Options',
		name: 'fallbackHtmlOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		typeOptions: {
			multipleValues: false,
		},
		displayOptions: {
			show: {
				operation: ['decision'],
				fallbackAction: ['extract'],
				fallbackExtractionType: ['html'],
			},
		},
		options: [
			{
				displayName: 'Output Format',
				name: 'outputFormat',
				type: 'options',
				options: [
					{
						name: 'HTML (String)',
						value: 'html',
						description: 'Return the HTML as a raw string',
					},
					{
						name: 'JSON',
						value: 'json',
						description: 'Return the HTML wrapped in a JSON object',
					},
				],
				default: 'html',
				description: 'Format of the output data',
			},
			{
				displayName: 'Include Metadata',
				name: 'includeMetadata',
				type: 'boolean',
				default: false,
				description: 'Whether to include metadata about the HTML (length, structure info)',
			},
		],
	},
	{
		displayName: 'Fallback Attribute Name',
		name: 'fallbackAttributeName',
		type: 'string',
		default: '',
		placeholder: 'href, src, data-ID',
		description: 'Name of the attribute to extract from the element',
		displayOptions: {
			show: {
				operation: ['decision'],
				fallbackAction: ['extract'],
				fallbackExtractionType: ['attribute'],
			},
		},
	},
	{
		displayName: 'Fallback Text',
		name: 'fallbackText',
		type: 'string',
		default: '',
		description: 'Text to enter into the form field in the fallback action',
		displayOptions: {
			show: {
				operation: ['decision'],
				fallbackAction: ['fill'],
			},
		},
	},
	{
		displayName: 'Fallback URL',
		name: 'fallbackUrl',
		type: 'string',
		default: '',
		placeholder: 'https://example.com/fallback',
		description: 'URL to navigate to in the fallback action',
		displayOptions: {
			show: {
				operation: ['decision'],
				fallbackAction: ['navigate'],
			},
		},
	},
	{
		displayName: 'Wait After Fallback',
		name: 'waitAfterFallback',
		type: 'options',
		options: [
			{
				name: 'DOM Content Loaded',
				value: 'domContentLoaded',
				description: 'Wait until the DOM content is loaded (faster)',
			},
			{
				name: 'Fixed Time',
				value: 'fixedTime',
				description: 'Wait for a specific amount of time',
			},
			{
				name: 'Navigation Complete',
				value: 'navigationComplete',
				description: 'Wait until navigation is complete (slower but more thorough)',
			},
			{
				name: 'No Wait',
				value: 'noWait',
				description: 'Do not wait after the action',
			},
		],
		default: 'domContentLoaded',
		description: 'What to wait for after performing the fallback action',
		displayOptions: {
			show: {
				operation: ['decision'],
				fallbackAction: ['click', 'navigate'],
			},
		},
	},
	{
		displayName: 'Fallback Wait Time (MS)',
		name: 'fallbackWaitTime',
		type: 'number',
		default: 2000,
		description: 'Time to wait in milliseconds for fallback action (for fixed time wait)',
		displayOptions: {
			show: {
				operation: ['decision'],
				fallbackAction: ['click', 'navigate'],
				waitAfterFallback: ['fixedTime'],
			},
		},
	},
	{
		displayName: 'Wait for Selectors',
		name: 'waitForSelectors',
		type: 'boolean',
		default: true,
		description: 'Whether to wait for selectors to appear before checking conditions',
		displayOptions: {
			show: {
				operation: ['decision'],
			},
		},
	},
	{
		displayName: 'Detection Method',
		name: 'detectionMethod',
		type: 'options',
		options: [
			{
				name: 'Smart Detection (DOM-Aware)',
				value: 'smart',
				description: 'Intelligently detects when the page is fully loaded before checking for elements (faster for elements that don\'t exist)',
			},
			{
				name: 'Fixed Timeout',
				value: 'fixed',
				description: 'Simply waits for the specified timeout (may be slower but more thorough)',
			},
		],
		default: 'smart',
		description: 'Method to use when checking for elements',
		displayOptions: {
			show: {
				operation: ['decision'],
				waitForSelectors: [true],
			},
		},
	},
	{
		displayName: 'Timeout',
		name: 'selectorTimeout',
		type: 'number',
		default: 5000,
		description: 'Maximum time in milliseconds to wait for selectors to appear',
		displayOptions: {
			show: {
				operation: ['decision'],
				waitForSelectors: [true],
			},
		},
	},
	{
		displayName: 'Early Exit Delay (MS)',
		name: 'earlyExitDelay',
		type: 'number',
		default: 500,
		description: 'Time in milliseconds to wait after DOM is loaded before checking for elements (for Smart Detection only)',
		displayOptions: {
			show: {
				operation: ['decision'],
				waitForSelectors: [true],
				detectionMethod: ['smart'],
			},
		},
	},
	{
		displayName: 'Use Human-Like Delays',
		name: 'useHumanDelays',
		type: 'boolean',
		default: true,
		description: 'Whether to use random delays between actions to simulate human behavior (100-300ms)',
		displayOptions: {
			show: {
				operation: ['decision'],
			},
		},
	},
	{
		displayName: 'Take Screenshot',
		name: 'takeScreenshot',
		type: 'boolean',
		default: false,
		description: 'Whether to take a screenshot after the decision operation completes',
		displayOptions: {
			show: {
				operation: ['decision'],
			},
		},
	},
	{
		displayName: 'Continue On Fail',
		name: 'continueOnFail',
		type: 'boolean',
		default: true,
		description: 'Whether to continue execution even when the operation fails',
		displayOptions: {
			show: {
				operation: ['decision'],
			},
		},
	},
];

/**
 * Get a random human-like delay between 100-300ms
 */
function getHumanDelay(): number {
	return Math.floor(Math.random() * (300 - 100 + 1) + 100);
}

/**
 * Safely matches strings according to the specified match type
 */
function matchStrings(value: string, targetValue: string, matchType: string, caseSensitive: boolean): boolean {
	// Apply case sensitivity
	let compareValue = value;
	let compareTarget = targetValue;

	if (!caseSensitive) {
		compareValue = value.toLowerCase();
		compareTarget = targetValue.toLowerCase();
	}

	// Apply match type
	switch (matchType) {
		case 'exact':
			return compareValue === compareTarget;
		case 'contains':
			return compareValue.includes(compareTarget);
		case 'startsWith':
			return compareValue.startsWith(compareTarget);
		case 'endsWith':
			return compareValue.endsWith(compareTarget);
		case 'regex':
			try {
				const regex = new RegExp(targetValue, caseSensitive ? '' : 'i');
				return regex.test(value);
			} catch (error) {
				return false;
			}
		default:
			return compareValue.includes(compareTarget);
	}
}

/**
 * Compare element counts based on the comparison operator
 */
function compareCount(actualCount: number, expectedCount: number, operator: string): boolean {
	switch (operator) {
		case 'equal':
			return actualCount === expectedCount;
		case 'greater':
			return actualCount > expectedCount;
		case 'less':
			return actualCount < expectedCount;
		case 'greaterEqual':
			return actualCount >= expectedCount;
		case 'lessEqual':
			return actualCount <= expectedCount;
		default:
			return actualCount === expectedCount;
	}
}

/**
 * Wait for navigation based on waitUntil parameter
 */
async function waitForNavigation(page: puppeteer.Page, waitUntil: string, timeout: number): Promise<void> {
	if (waitUntil === 'noWait') return;

	let waitUntilOption: puppeteer.PuppeteerLifeCycleEvent | puppeteer.PuppeteerLifeCycleEvent[] = 'domcontentloaded';

	switch (waitUntil) {
		case 'domContentLoaded':
			waitUntilOption = 'domcontentloaded';
			break;
		case 'navigationComplete':
			waitUntilOption = 'networkidle0';
			break;
		case 'fixedTime':
			await new Promise((resolve) => setTimeout(resolve, timeout));
			return;
		default:
			waitUntilOption = 'domcontentloaded';
	}

	if (waitUntil !== 'noWait' && waitUntil !== 'fixedTime') {
		await page.waitForNavigation({ waitUntil: waitUntilOption, timeout });
	}
}

/**
 * Smart wait for element with DOM-aware early exit strategy
 */
async function smartWaitForSelector(
	page: puppeteer.Page,
	selector: string,
	timeout: number,
	earlyExitDelay: number,
	logger: IExecuteFunctions['logger'],
): Promise<boolean> {
	// Create a promise that resolves when the element is found
	const elementPromise = page.waitForSelector(selector, { timeout })
		.then(() => {
			logger.debug(`Element found: ${selector}`);
			return true;
		})
		.catch(() => {
			logger.debug(`Element not found within timeout: ${selector}`);
			return false;
		});

	// Check if the DOM is already loaded
	const domState = await page.evaluate(() => {
		return {
			readyState: document.readyState,
			bodyExists: !!document.body,
		};
	});

	logger.debug(`DOM state: readyState=${domState.readyState}, bodyExists=${domState.bodyExists}`);

	// If DOM is not loaded yet, wait for it
	if (domState.readyState !== 'complete' && domState.readyState !== 'interactive') {
		logger.debug('DOM not ready, waiting for it to load...');
		await page.waitForFunction(
			() => document.readyState === 'complete' || document.readyState === 'interactive',
			{ timeout: Math.min(timeout, 10000) }, // Cap at 10 seconds max for DOM loading
		);
	}

	// If there's no body yet (rare case), wait for it
	if (!domState.bodyExists) {
		logger.debug('Document body not found, waiting for it...');
		await page.waitForFunction(() => !!document.body, {
			timeout: Math.min(timeout, 5000), // Cap at 5 seconds max for body
		});
	}

	// Wait a small delay to allow dynamic content to load
	if (earlyExitDelay > 0) {
		logger.debug(`Waiting ${earlyExitDelay}ms early exit delay...`);
		await new Promise(resolve => setTimeout(resolve, earlyExitDelay));
	}

	// Check if element exists without waiting (quick check)
	const elementExistsNow = await page.evaluate((sel) => {
		return document.querySelector(sel) !== null;
	}, selector);

	if (elementExistsNow) {
		logger.debug(`Element found immediately after DOM ready: ${selector}`);
		return true;
	}

	logger.debug(`Element not found in initial check, waiting up to timeout: ${selector}`);
	// If not found immediately, wait for the original promise with timeout
	return elementPromise;
}

/**
 * Execute the decision operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	puppeteerPage: puppeteer.Page,
): Promise<INodeExecutionData[]> {
	const startTime = Date.now();

	// Store this parameter at the top level so it's available in the catch block
	const continueOnFail = this.getNodeParameter('continueOnFail', index, true) as boolean;

	try {
		// Get operation parameters
		const conditionGroups = this.getNodeParameter('conditionGroups.groups', index, []) as IDataObject[];
		const fallbackAction = this.getNodeParameter('fallbackAction', index) as string;
		const waitForSelectors = this.getNodeParameter('waitForSelectors', index, true) as boolean;
		const selectorTimeout = this.getNodeParameter('selectorTimeout', index, 5000) as number;
		const detectionMethod = this.getNodeParameter('detectionMethod', index, 'smart') as string;
		const earlyExitDelay = this.getNodeParameter('earlyExitDelay', index, 500) as number;
		const useHumanDelays = this.getNodeParameter('useHumanDelays', index, true) as boolean;
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

		// Check each condition group
		for (const group of conditionGroups) {
			const conditionType = group.conditionType as string;
			const groupName = group.name as string;
			const invertCondition = group.invertCondition as boolean || false;

			// Get route if routing is enabled
			if (enableRouting) {
				const groupRoute = group.route as number;
				if (groupRoute) {
					// Route numbers are 1-based, but indexes are 0-based
					routeIndex = groupRoute - 1;
				}
			}

			this.logger.debug(`Checking condition group: ${groupName}`);

			// Evaluate the condition
			let conditionMet = false;

			try {
				switch (conditionType) {
					case 'elementExists': {
						const selector = group.selector as string;

						if (waitForSelectors) {
							if (detectionMethod === 'smart') {
								// Use smart DOM-aware detection
								conditionMet = await smartWaitForSelector(
									puppeteerPage,
									selector,
									selectorTimeout,
									earlyExitDelay,
									this.logger,
								);
							} else {
								// Use traditional fixed timeout waiting
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

					case 'textContains': {
						const selector = group.selector as string;
						const textToCheck = group.textToCheck as string;
						const matchType = group.matchType as string;
						const caseSensitive = group.caseSensitive as boolean;

						if (waitForSelectors) {
							let elementExists = false;
							if (detectionMethod === 'smart') {
								// Use smart DOM-aware detection
								elementExists = await smartWaitForSelector(
									puppeteerPage,
									selector,
									selectorTimeout,
									earlyExitDelay,
									this.logger,
								);
							} else {
								// Use traditional fixed timeout waiting
								try {
									await puppeteerPage.waitForSelector(selector, { timeout: selectorTimeout });
									elementExists = true;
								} catch (error) {
									elementExists = false;
								}
							}

							if (!elementExists) {
								conditionMet = false;
								break;
							}
						}

						try {
							const elementText = await puppeteerPage.$eval(selector, (el) => el.textContent || '');
							conditionMet = matchStrings(elementText, textToCheck, matchType, caseSensitive);
						} catch (error) {
							// Element might not exist
							conditionMet = false;
						}
						break;
					}

					case 'elementCount': {
						const selector = group.selector as string;
						const expectedCount = group.expectedCount as number;
						const countComparison = group.countComparison as string;

						// For element count, we just check without waiting as we expect some elements might not exist
						const elements = await puppeteerPage.$$(selector);
						const actualCount = elements.length;

						conditionMet = compareCount(actualCount, expectedCount, countComparison);
						break;
					}

					case 'urlContains': {
						const urlSubstring = group.urlSubstring as string;
						const matchType = group.matchType as string;
						const caseSensitive = group.caseSensitive as boolean;

						conditionMet = matchStrings(currentUrl, urlSubstring, matchType, caseSensitive);
						break;
					}
				}

				// Apply inversion if specified
				if (invertCondition) {
					conditionMet = !conditionMet;
				}

				this.logger.debug(`Condition result for ${groupName}: ${conditionMet}`);

				// If condition is met
				if (conditionMet) {
					routeTaken = groupName;
					const actionType = group.actionType as string;

					// For routing capability, store route information
					if (enableRouting) {
						const groupRoute = group.route as number;
						if (groupRoute) {
							// Route numbers are 1-based, but indexes are 0-based
							routeIndex = groupRoute - 1;
						}
					}

					if (actionType !== 'none') {
						actionPerformed = actionType;

						// Add human-like delay if enabled
						if (useHumanDelays) {
							await new Promise(resolve => setTimeout(resolve, getHumanDelay()));
						}

						switch (actionType) {
							case 'click': {
								const actionSelector = group.actionSelector as string;
								const waitAfterAction = group.waitAfterAction as string;
								const waitTime = group.waitTime as number;

								if (waitForSelectors) {
									// For actions, we always need to ensure the element exists
									if (detectionMethod === 'smart') {
										const elementExists = await smartWaitForSelector(
											puppeteerPage,
											actionSelector,
											selectorTimeout,
											earlyExitDelay,
											this.logger,
										);

										if (!elementExists) {
											throw new Error(`Action element with selector "${actionSelector}" not found`);
										}
									} else {
										await puppeteerPage.waitForSelector(actionSelector, { timeout: selectorTimeout });
									}
								}

								this.logger.debug(`Clicking element: ${actionSelector}`);
								await puppeteerPage.click(actionSelector);

								// Wait according to specified wait type
								await waitForNavigation(puppeteerPage, waitAfterAction, waitTime);
								break;
							}

							case 'fill': {
								const actionSelector = group.actionSelector as string;
								const textValue = group.textValue as string;

								if (waitForSelectors) {
									// For actions, we always need to ensure the element exists
									if (detectionMethod === 'smart') {
										const elementExists = await smartWaitForSelector(
											puppeteerPage,
											actionSelector,
											selectorTimeout,
											earlyExitDelay,
											this.logger,
										);

										if (!elementExists) {
											throw new Error(`Action element with selector "${actionSelector}" not found`);
										}
									} else {
										await puppeteerPage.waitForSelector(actionSelector, { timeout: selectorTimeout });
									}
								}

								this.logger.debug(`Filling form field: ${actionSelector} with value: ${textValue}`);
								await puppeteerPage.type(actionSelector, textValue);
								break;
							}

							case 'extract': {
								const actionSelector = group.actionSelector as string;
								const extractionType = group.extractionType as string;

								if (waitForSelectors) {
									// For actions, we always need to ensure the element exists
									if (detectionMethod === 'smart') {
										const elementExists = await smartWaitForSelector(
											puppeteerPage,
											actionSelector,
											selectorTimeout,
											earlyExitDelay,
											this.logger,
										);

										if (!elementExists) {
											throw new Error(`Element with selector "${actionSelector}" not found for extraction`);
										}
									} else {
										await puppeteerPage.waitForSelector(actionSelector, { timeout: selectorTimeout });
									}
								}

								// Extract data based on extraction type
								let extractedData: string | null | IDataObject = null;
								switch (extractionType) {
									case 'text':
										extractedData = await puppeteerPage.$eval(actionSelector, (el) => el.textContent?.trim() || '');
										break;
									case 'html': {
										// Get HTML options
										const htmlOptions = group.htmlOptions as IDataObject || {};
										const outputFormat = (htmlOptions.outputFormat as string) || 'html';
										const includeMetadata = htmlOptions.includeMetadata as boolean || false;

										// Extract HTML content
										const htmlContent = await puppeteerPage.$eval(actionSelector, (el) => el.innerHTML);

										if (outputFormat === 'html') {
											// Return as raw HTML string
											extractedData = htmlContent;
										} else {
											// Return as JSON object
											extractedData = { html: htmlContent };
										}

										// Add metadata if requested
										if (includeMetadata) {
											// Calculate basic metadata about the HTML
											const elementCount = await puppeteerPage.$eval(actionSelector, (el) => el.querySelectorAll('*').length);
											const imageCount = await puppeteerPage.$eval(actionSelector, (el) => el.querySelectorAll('img').length);
											const linkCount = await puppeteerPage.$eval(actionSelector, (el) => el.querySelectorAll('a').length);

											if (typeof extractedData === 'object') {
												extractedData.metadata = {
													htmlLength: htmlContent.length,
													elementCount,
													imageCount,
													linkCount,
												};
											} else {
												// For string output, add metadata as a separate property
												extractedData = {
													html: htmlContent,
													metadata: {
														htmlLength: htmlContent.length,
														elementCount,
														imageCount,
														linkCount,
													}
												};
											}
										}
										break;
									}
									case 'value':
										extractedData = await puppeteerPage.$eval(actionSelector, (el) => {
											if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
												return el.value;
											}
											return '';
										});
										break;
									case 'attribute': {
										const attributeName = group.extractAttributeName as string;
										extractedData = await puppeteerPage.$eval(
											actionSelector,
											(el, attr) => el.getAttribute(attr) || '',
											attributeName
										);
										break;
									}
									default:
										extractedData = await puppeteerPage.$eval(actionSelector, (el) => el.textContent?.trim() || '');
								}

								// Store the extracted data in the result
								if (!resultData.extractedData) {
									resultData.extractedData = {};
								}
								resultData.extractedData[groupName] = extractedData;

								this.logger.debug(`Extracted data (${extractionType}) from: ${actionSelector}`);
								break;
							}

							case 'navigate': {
								const url = group.url as string;
								const waitAfterAction = group.waitAfterAction as string;
								const waitTime = group.waitTime as number;

								this.logger.debug(`Navigating to URL: ${url}`);
								await puppeteerPage.goto(url);

								// Wait according to specified wait type
								await waitForNavigation(puppeteerPage, waitAfterAction, waitTime);
								break;
							}
						}
					}

					// Exit after the first match - we don't continue checking conditions
					break;
				}
			} catch (error) {
				this.logger.error(`Error in condition group ${groupName}: ${(error as Error).message}`);

				if (!continueOnFail) {
					throw error;
				}
			}
		}

		// If no condition was met, perform fallback action and use fallback route
		if (routeTaken === 'none' && fallbackAction !== 'none') {
			routeTaken = 'fallback';
			actionPerformed = fallbackAction;

			// Set fallback route if routing is enabled
			if (enableRouting) {
				const fallbackRoute = this.getNodeParameter('fallbackRoute', index, 1) as number;
				routeIndex = fallbackRoute - 1;
			}

			try {
				// Add human-like delay if enabled
				if (useHumanDelays) {
					await new Promise(resolve => setTimeout(resolve, getHumanDelay()));
				}

				switch (fallbackAction) {
					case 'click': {
						const fallbackSelector = this.getNodeParameter('fallbackSelector', index) as string;
						const waitAfterFallback = this.getNodeParameter('waitAfterFallback', index) as string;
						const fallbackWaitTime = this.getNodeParameter('fallbackWaitTime', index) as number;

						if (waitForSelectors) {
							// For actions, we always need to ensure the element exists
							if (detectionMethod === 'smart') {
								const elementExists = await smartWaitForSelector(
									puppeteerPage,
									fallbackSelector,
									selectorTimeout,
									earlyExitDelay,
									this.logger,
								);

								if (!elementExists) {
									throw new Error(`Fallback element with selector "${fallbackSelector}" not found`);
								}
							} else {
								await puppeteerPage.waitForSelector(fallbackSelector, { timeout: selectorTimeout });
							}
						}

						this.logger.debug(`Fallback action: Clicking element: ${fallbackSelector}`);
						await puppeteerPage.click(fallbackSelector);

						// Wait according to specified wait type
						await waitForNavigation(puppeteerPage, waitAfterFallback, fallbackWaitTime);
						break;
					}

					case 'extract': {
						const fallbackSelector = this.getNodeParameter('fallbackSelector', index) as string;
						const fallbackExtractionType = this.getNodeParameter('fallbackExtractionType', index) as string;

						if (waitForSelectors) {
							// For actions, we always need to ensure the element exists
							if (detectionMethod === 'smart') {
								const elementExists = await smartWaitForSelector(
									puppeteerPage,
									fallbackSelector,
									selectorTimeout,
									earlyExitDelay,
									this.logger,
								);

								if (!elementExists) {
									throw new Error(`Element with selector "${fallbackSelector}" not found for fallback extraction`);
								}
							} else {
								await puppeteerPage.waitForSelector(fallbackSelector, { timeout: selectorTimeout });
							}
						}

						// Extract data based on extraction type
						let extractedData: string | null | IDataObject = null;
						switch (fallbackExtractionType) {
							case 'text':
								extractedData = await puppeteerPage.$eval(fallbackSelector, (el) => el.textContent?.trim() || '');
								break;
							case 'html': {
								// Get HTML options
								const fallbackHtmlOptions = this.getNodeParameter('fallbackHtmlOptions', index, {}) as IDataObject;
								const outputFormat = (fallbackHtmlOptions.outputFormat as string) || 'html';
								const includeMetadata = fallbackHtmlOptions.includeMetadata as boolean || false;

								// Extract HTML content
								const htmlContent = await puppeteerPage.$eval(fallbackSelector, (el) => el.innerHTML);

								if (outputFormat === 'html') {
									// Return as raw HTML string
									extractedData = htmlContent;
								} else {
									// Return as JSON object
									extractedData = { html: htmlContent };
								}

								// Add metadata if requested
								if (includeMetadata) {
									// Calculate basic metadata about the HTML
									const elementCount = await puppeteerPage.$eval(fallbackSelector, (el) => el.querySelectorAll('*').length);
									const imageCount = await puppeteerPage.$eval(fallbackSelector, (el) => el.querySelectorAll('img').length);
									const linkCount = await puppeteerPage.$eval(fallbackSelector, (el) => el.querySelectorAll('a').length);

									if (typeof extractedData === 'object') {
										extractedData.metadata = {
											htmlLength: htmlContent.length,
											elementCount,
											imageCount,
											linkCount,
										};
									} else {
										// For string output, add metadata as a separate property
										extractedData = {
											html: htmlContent,
											metadata: {
												htmlLength: htmlContent.length,
												elementCount,
												imageCount,
												linkCount,
											}
										};
									}
								}
								break;
							}
							case 'value':
								extractedData = await puppeteerPage.$eval(fallbackSelector, (el) => {
									if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
										return el.value;
									}
									return '';
								});
								break;
							case 'attribute': {
								const attributeName = this.getNodeParameter('fallbackAttributeName', index) as string;
								extractedData = await puppeteerPage.$eval(
									fallbackSelector,
									(el, attr) => el.getAttribute(attr) || '',
									attributeName
								);
								break;
							}
							default:
								extractedData = await puppeteerPage.$eval(fallbackSelector, (el) => el.textContent?.trim() || '');
						}

						// Store the extracted data in the result
						if (!resultData.extractedData) {
							resultData.extractedData = {};
						}
						resultData.extractedData.fallback = extractedData;

						this.logger.debug(`Fallback: Extracted data (${fallbackExtractionType}) from: ${fallbackSelector}`);
						break;
					}

					case 'fill': {
						const fallbackSelector = this.getNodeParameter('fallbackSelector', index) as string;
						const fallbackText = this.getNodeParameter('fallbackText', index) as string;

						if (waitForSelectors) {
							// For actions, we always need to ensure the element exists
							if (detectionMethod === 'smart') {
								const elementExists = await smartWaitForSelector(
									puppeteerPage,
									fallbackSelector,
									selectorTimeout,
									earlyExitDelay,
									this.logger,
								);

								if (!elementExists) {
									throw new Error(`Fallback element with selector "${fallbackSelector}" not found`);
								}
							} else {
								await puppeteerPage.waitForSelector(fallbackSelector, { timeout: selectorTimeout });
							}
						}

						this.logger.debug(`Fallback action: Filling form field: ${fallbackSelector} with value: ${fallbackText}`);
						await puppeteerPage.type(fallbackSelector, fallbackText);
						break;
					}

					case 'navigate': {
						const fallbackUrl = this.getNodeParameter('fallbackUrl', index) as string;
						const waitAfterFallback = this.getNodeParameter('waitAfterFallback', index) as string;
						const fallbackWaitTime = this.getNodeParameter('fallbackWaitTime', index) as number;

						this.logger.debug(`Fallback action: Navigating to URL: ${fallbackUrl}`);
						await puppeteerPage.goto(fallbackUrl);

						// Wait according to specified wait type
						await waitForNavigation(puppeteerPage, waitAfterFallback, fallbackWaitTime);
						break;
					}
				}
			} catch (error) {
				this.logger.error(`Error in fallback action: ${(error as Error).message}`);

				if (!continueOnFail) {
					throw error;
				}
			}
		}

		// Take screenshot if requested
		if (takeScreenshot) {
			screenshot = await puppeteerPage.screenshot({ encoding: 'base64' }) as string;
		}

		const executionDuration = Date.now() - startTime;

		// Update the execution duration in the result data
		resultData.executionDuration = executionDuration;
		resultData.currentUrl = await puppeteerPage.url();
		resultData.pageTitle = await puppeteerPage.title();
		resultData.screenshot = screenshot;
		resultData.routeTaken = routeTaken;
		resultData.actionPerformed = actionPerformed;

		// If using routing
		if (enableRouting) {
			// Set the route name for output (1-based for display)
			const routeName = `Route ${routeIndex + 1}`;
			resultData.routeName = routeName;

			return [{
				json: resultData,
				pairedItem: { item: index },
				// This special property lets n8n know which output to route the data to
				__metadata: {
					outputIndex: routeIndex,
				},
			}];
		}

		// Default case - single output
		return [{
			json: resultData,
			pairedItem: { item: index },
		}];
	} catch (error) {
		const executionDuration = Date.now() - startTime;

		if (continueOnFail) {
			return [
				{
					json: {
						success: false,
						error: (error as Error).message,
						currentUrl: await puppeteerPage.url(),
						pageTitle: await puppeteerPage.title(),
						executionDuration,
					},
					pairedItem: { item: index },
				},
			];
		}

		throw error;
	}
}

