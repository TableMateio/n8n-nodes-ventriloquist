import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import type { Page } from 'puppeteer-core';
import { SessionManager } from '../utils/sessionManager';
import {
	processFormField,
	retryFormSubmission,
	getHumanDelay,
	submitForm
} from '../utils/formOperations';
import {
	takeScreenshot
} from '../utils/navigationUtils';

/**
 * Form operation description
 */
export const description: INodeProperties[] = [
	{
		displayName: 'Session ID',
		name: 'explicitSessionId',
		type: 'string',
		default: '',
		description: 'Session ID to use (leave empty to use ID from input or create new)',
		displayOptions: {
			show: {
				operation: ['form'],
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
				operation: ['form'],
			},
		},
	},
	{
		displayName: 'Wait for Form Elements',
		name: 'waitForSelectors',
		type: 'boolean',
		default: true,
		description: 'Whether to wait for form elements to appear before interacting with them',
		displayOptions: {
			show: {
				operation: ['form'],
			},
		},
	},
	{
		displayName: 'Timeout',
		name: 'selectorTimeout',
		type: 'number',
		default: 10000,
		description: 'Maximum time in milliseconds to wait for form elements to appear',
		displayOptions: {
			show: {
				operation: ['form'],
				waitForSelectors: [true],
			},
		},
	},
	{
		displayName: 'Form Fields',
		name: 'formFields',
		placeholder: 'Add Form Field',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		default: {},
		options: [
			{
				name: 'fields',
				displayName: 'Fields',
				values: [
					{
						displayName: 'Field Type',
						name: 'fieldType',
						type: 'options',
						options: [
							{
								name: 'Checkbox',
								value: 'checkbox',
								description: 'Checkbox toggle',
							},
							{
								name: 'File Upload',
								value: 'file',
								description: 'File input field',
							},
							{
								name: 'Multi-Select',
								value: 'multiSelect',
								description: 'Multi-select dropdown (allows multiple selections)',
							},
							{
								name: 'Password',
								value: 'password',
								description: 'Password field with secure input',
							},
							{
								name: 'Radio Button',
								value: 'radio',
								description: 'Radio button selection',
							},
							{
								name: 'Select/Dropdown',
								value: 'select',
								description: 'Dropdown menu selection',
							},
							{
								name: 'Text Input',
								value: 'text',
								description: 'Single-line text input',
							},
							{
								name: 'Textarea',
								value: 'textarea',
								description: 'Multi-line text area',
							},
						],
						default: 'text',
						description: 'Type of form field to fill',
					},
					{
						displayName: 'Selector',
						name: 'selector',
						type: 'string',
						default: '',
						placeholder: '#input-field, .form-control, input[name="email"]',
						description: 'CSS selector to target the form field. Use "#ID" for IDs, ".class" for classes, "tag" for HTML elements, or "tag[attr=value]" for attributes.',
						required: true,
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						description: 'Value to set for the form field',
						displayOptions: {
							show: {
								fieldType: ['text', 'radio'],
							},
						},
					},
					{
						displayName: 'Check',
						name: 'checked',
						type: 'boolean',
						default: true,
						description: 'Whether to check or uncheck the checkbox',
						displayOptions: {
							show: {
								fieldType: ['checkbox'],
							},
						},
					},
					{
						displayName: 'File Path',
						name: 'filePath',
						type: 'string',
						default: '',
						description: 'Full path to the file to upload',
						displayOptions: {
							show: {
								fieldType: ['file'],
							},
						},
					},
					{
						displayName: 'Clear Field First',
						name: 'clearField',
						type: 'boolean',
						default: true,
						description: 'Whether to clear the field before setting the value (for text fields)',
						displayOptions: {
							show: {
								fieldType: ['text'],
							},
						},
					},
					{
						displayName: 'Human-Like Typing',
						name: 'humanLike',
						type: 'boolean',
						default: false,
						description: 'Whether to type with human-like random delays between keystrokes',
						displayOptions: {
							show: {
								fieldType: ['text'],
							},
						},
					},
					{
						displayName: 'Dropdown Value',
						name: 'value',
						type: 'string',
						default: '',
						description: 'Value or text to select from the dropdown',
						displayOptions: {
							show: {
								fieldType: ['select'],
							},
						},
					},
					{
						displayName: 'Match Type',
						name: 'matchType',
						type: 'options',
						options: [
							{
								name: 'Exact (Value)',
								value: 'exact',
								description: 'Match exactly by option value',
							},
							{
								name: 'Text Contains',
								value: 'textContains',
								description: 'Match if option text contains this string',
							},
							{
								name: 'Fuzzy Match',
								value: 'fuzzy',
								description: 'Use fuzzy matching to find the closest option text',
							},
						],
						default: 'exact',
						description: 'How to match the dropdown option',
						displayOptions: {
							show: {
								fieldType: ['select'],
							},
						},
					},
					{
						displayName: 'Fuzzy Match Threshold',
						name: 'fuzzyThreshold',
						type: 'number',
						typeOptions: {
							minValue: 0,
							maxValue: 1,
						},
						default: 0.5,
						description: 'Minimum similarity score (0-1) to consider a match',
						displayOptions: {
							show: {
								fieldType: ['select'],
								matchType: ['fuzzy'],
							},
						},
					},
					{
						displayName: 'Multi-Select Values',
						name: 'multiSelectValues',
						type: 'string',
						default: '',
						placeholder: 'value1,value2,value3',
						description: 'Comma-separated list of values to select (for multi-select dropdowns)',
						displayOptions: {
							show: {
								fieldType: ['multiSelect'],
							},
						},
					},
					{
						displayName: 'Password Value',
						name: 'value',
						type: 'string',
						default: '',
						description: 'Password to enter in the field (masked in logs for security)',
						typeOptions: {
							password: true,
						},
						displayOptions: {
							show: {
								fieldType: ['password'],
							},
						},
					},
					{
						displayName: 'Clear Field First',
						name: 'clearField',
						type: 'boolean',
						default: true,
						description: 'Whether to clear any existing value in the field before typing',
						displayOptions: {
							show: {
								fieldType: ['password'],
							},
						},
					},
					{
						displayName: 'Has Clone Field',
						name: 'hasCloneField',
						type: 'boolean',
						default: false,
						description: 'Whether this password field has a clone/duplicate field (common with show/hide password toggles)',
						displayOptions: {
							show: {
								fieldType: ['password'],
							},
						},
					},
					{
						displayName: 'Clone Field Selector',
						name: 'cloneSelector',
						type: 'string',
						default: '',
						placeholder: '#password-clone, .password-visible',
						description: 'CSS selector for the clone field (often shown when password is toggled to visible)',
						displayOptions: {
							show: {
								fieldType: ['password'],
								hasCloneField: [true],
							},
						},
					},
				],
			},
		],
		displayOptions: {
			show: {
				operation: ['form'],
			},
		},
	},
	{
		displayName: 'Submit Form',
		name: 'submitForm',
		type: 'boolean',
		default: true,
		description: 'Whether to submit the form after filling the fields',
		displayOptions: {
			show: {
				operation: ['form'],
			},
		},
	},
	{
		displayName: 'Submit Button Selector',
		name: 'submitSelector',
		type: 'string',
		default: '',
		placeholder: 'button[type="submit"], input[type="submit"], .submit-button',
		description: 'CSS selector of the submit button',
		displayOptions: {
			show: {
				operation: ['form'],
				submitForm: [true],
			},
		},
	},
	{
		displayName: 'Wait After Submit',
		name: 'waitAfterSubmit',
		type: 'options',
		options: [
			{
				name: 'Fixed Time',
				value: 'fixedTime',
				description: 'Simple: Just wait for a specific amount of time that you set below',
			},
			{
				name: 'New Page DOM Loaded',
				value: 'domContentLoaded',
				description: 'Medium: Wait until the new page\'s DOM is parsed and ready for interaction',
			},
			{
				name: 'No Wait',
				value: 'noWait',
				description: 'Immediate: Do not wait at all after clicking submit (may cause issues if next steps need the new page)',
			},
			{
				name: 'Page Resources Loaded',
				value: 'navigationComplete',
				description: 'Slowest: Wait until all page resources (images, scripts, etc.) have finished loading',
			},
			{
				name: 'URL Changed',
				value: 'urlChanged',
				description: 'Fastest: Wait only until the URL changes to confirm navigation started',
			},
		],
		default: 'domContentLoaded',
		description: 'What to wait for after clicking the submit button - needed to ensure the form submission completes properly',
		displayOptions: {
			show: {
				operation: ['form'],
				submitForm: [true],
			},
		},
	},
	{
		displayName: 'Wait Time',
		name: 'waitTime',
		type: 'number',
		default: 5000,
		description: 'Time to wait in milliseconds (for fixed time wait)',
		displayOptions: {
			show: {
				operation: ['form'],
				submitForm: [true],
				waitAfterSubmit: ['fixedTime'],
			},
		},
	},
	{
		displayName: 'Take Screenshot After Submission',
		name: 'takeScreenshot',
		type: 'boolean',
		default: false,
		description: 'Whether to take a screenshot after form submission',
		displayOptions: {
			show: {
				operation: ['form'],
				submitForm: [true],
			},
		},
	},
	{
		displayName: 'Continue On Fail',
		name: 'continueOnFail',
		type: 'boolean',
		default: true,
		description: 'Whether to continue execution even when form operations fail (selector not found or timeout)',
		displayOptions: {
			show: {
				operation: ['form'],
			},
		},
	},
	{
		displayName: 'Retry Form Submission',
		name: 'retrySubmission',
		type: 'boolean',
		default: false,
		description: 'Whether to retry form submission if no page change is detected after first attempt',
		displayOptions: {
			show: {
				operation: ['form'],
				submitForm: [true],
			},
		},
	},
	{
		displayName: 'Max Retries',
		name: 'maxRetries',
		type: 'number',
		default: 2,
		description: 'Maximum number of submission attempts if no page change is detected',
		displayOptions: {
			show: {
				operation: ['form'],
				submitForm: [true],
				retrySubmission: [true],
			},
		},
	},
	{
		displayName: 'Retry Delay (MS)',
		name: 'retryDelay',
		type: 'number',
		default: 1000,
		description: 'Delay in milliseconds between submission attempts',
		displayOptions: {
			show: {
				operation: ['form'],
				submitForm: [true],
				retrySubmission: [true],
			},
		},
	},
	{
		displayName: 'Advanced Button Options',
		name: 'advancedButtonOptions',
		type: 'boolean',
		default: false,
		description: 'Whether to enable advanced button clicking options for problematic forms',
		displayOptions: {
			show: {
				operation: ['form'],
				submitForm: [true],
			},
		},
	},
	{
		displayName: 'Scroll Button Into View',
		name: 'scrollIntoView',
		type: 'boolean',
		default: true,
		description: 'Whether to automatically scroll to ensure the button is visible before clicking',
		displayOptions: {
			show: {
				operation: ['form'],
				submitForm: [true],
				advancedButtonOptions: [true],
			},
		},
	},
	{
		displayName: 'Button Click Method',
		name: 'buttonClickMethod',
		type: 'options',
		options: [
			{
				name: 'Auto (Try All Methods)',
				value: 'auto',
			},
			{
				name: 'Standard Click',
				value: 'standard',
			},
			{
				name: 'JavaScript Click',
				value: 'javascript',
			},
			{
				name: 'Direct DOM Events',
				value: 'events',
			},
		],
		default: 'auto',
		description: 'Method to use for clicking the submit button',
		displayOptions: {
			show: {
				operation: ['form'],
				submitForm: [true],
				advancedButtonOptions: [true],
			},
		},
	},
	{
		displayName: 'Click Timeout (MS)',
		name: 'clickTimeout',
		type: 'number',
		default: 10000,
		description: 'Maximum time in milliseconds to wait for button click to complete',
		displayOptions: {
			show: {
				operation: ['form'],
				submitForm: [true],
				advancedButtonOptions: [true],
			},
		},
	},
];

/**
 * Execute the form operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	websocketEndpoint: string,
	workflowId: string,
): Promise<INodeExecutionData> {
	// Get parameters
	const formFields = this.getNodeParameter('formFields.fields', index, []) as IDataObject[];
	const useHumanDelays = this.getNodeParameter('useHumanDelays', index, true) as boolean;
	const submitFormAfterFill = this.getNodeParameter('submitForm', index, true) as boolean;
	const submitSelector = this.getNodeParameter('submitSelector', index, '') as string;
	const waitAfterSubmit = this.getNodeParameter('waitAfterSubmit', index, 'domContentLoaded') as string;
	const waitTime = this.getNodeParameter('waitTime', index, 5000) as number;
	const takeScreenshotAfterSubmit = this.getNodeParameter('takeScreenshot', index, false) as boolean;
	const waitForSelectors = this.getNodeParameter('waitForSelectors', index, true) as boolean;
	const selectorTimeout = this.getNodeParameter('selectorTimeout', index, 10000) as number;
	const continueOnFail = this.getNodeParameter('continueOnFail', index, true) as boolean;
	const retrySubmission = this.getNodeParameter('retrySubmission', index, false) as boolean;
	const maxRetries = this.getNodeParameter('maxRetries', index, 2) as number;
	const retryDelay = this.getNodeParameter('retryDelay', index, 1000) as number;

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;

	// Visual marker to clearly indicate a new node is starting
	this.logger.info("============ STARTING NODE EXECUTION ============");
	this.logger.info(`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Starting execution`);

	// Check if an explicit session ID was provided
	const explicitSessionId = this.getNodeParameter('explicitSessionId', index, '') as string;

	// Get or create browser session
	let page: Page | null = null;
	let sessionId = '';

	try {
		// Use the centralized session management instead of duplicating code
		const sessionResult = await SessionManager.getOrCreatePageSession(this.logger, {
			explicitSessionId,
			websocketEndpoint,
			workflowId,
			operationName: 'Form',
			nodeId,
			nodeName,
			index,
		});

		page = sessionResult.page;
		sessionId = sessionResult.sessionId;

		if (!page) {
			throw new Error('Failed to get or create a page');
		}

		this.logger.info(`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Starting form fill operation`);
		const results: IDataObject[] = [];

		// Wait for form elements if enabled, but don't use smart waiting - just check basic page readiness
		if (waitForSelectors) {
			this.logger.info(`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Basic page readiness check`);

			// Check if the page is ready first
			const pageReady = await page.evaluate(() => {
				return {
					readyState: document.readyState,
					bodyExists: !!document.body,
					contentLoaded: document.readyState === 'interactive' || document.readyState === 'complete',
				};
			});

			this.logger.info(`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Page readiness state: ${JSON.stringify(pageReady)}`);

			if (!pageReady.bodyExists) {
				this.logger.warn(`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Page body not yet available - waiting for page to initialize`);
				try {
					// Wait for the body element specifically
					await page.waitForSelector('body', { timeout: selectorTimeout });
				} catch (bodyError) {
					throw new Error(`Page did not initialize properly: ${(bodyError as Error).message}`);
				}
			}

			// Simple wait for page to be fully loaded
			if (!pageReady.contentLoaded) {
				this.logger.info(`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Waiting for page content to load`);
				try {
					await page.waitForFunction(
						() => document.readyState === 'complete',
						{ timeout: selectorTimeout }
					);
				} catch (loadError) {
					this.logger.warn(`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Page load timeout: ${(loadError as Error).message}`);
					// Continue anyway - page might be usable
				}
			}
		}

		// Fill each form field
		for (const field of formFields) {
			const fieldType = field.fieldType as string;
			const selector = field.selector as string;

			this.logger.info(`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Processing ${fieldType} field with selector: ${selector}`);

			// Wait for the element to be available
			if (waitForSelectors) {
				this.logger.info(`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Waiting for selector: ${selector} (timeout: ${selectorTimeout}ms)`);
				await page.waitForSelector(selector, { timeout: selectorTimeout })
					.catch(error => {
						this.logger.warn(`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Selector not found: ${selector}, but will try to interact anyway`);
					});
			} else {
				// Check if the element exists first
				const elementExists = await page.evaluate((sel) => {
					return document.querySelector(sel) !== null;
				}, selector);

				if (!elementExists) {
					this.logger.warn(`Element not found without waiting: ${selector}`);
				}
			}

			// Add human-like delay between form field interactions if enabled
			if (useHumanDelays) {
				const delay = getHumanDelay();
				this.logger.info(`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Adding human-like delay of ${delay}ms`);
				await new Promise(resolve => setTimeout(resolve, delay));
			}

			// Process the form field using the utility function
			const { success, fieldResult } = await processFormField(page, field, this.logger);

			// Add context to the field result
			fieldResult.nodeId = nodeId;
			fieldResult.nodeName = nodeName;

			// Add the field result to our results collection
			results.push(fieldResult);

			// If the field failed and we're not continuing on failure, throw an error
			if (!success && !continueOnFail) {
				throw new Error(`Failed to fill form field: ${selector} (type: ${fieldType})`);
			}
		}

		// Submit the form if requested
		let formSubmissionResult: IDataObject = {};
		let retryResults: IDataObject[] = [];

		if (submitFormAfterFill && submitSelector) {
			this.logger.info(`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Submitting form using selector: ${submitSelector}`);

			if (retrySubmission) {
				// Use the retry utility
				const retrySubmissionResult = await retryFormSubmission(
					page,
					submitSelector,
					{
						waitAfterSubmit: waitAfterSubmit as 'noWait' | 'fixedTime' | 'domContentLoaded' | 'navigationComplete' | 'urlChanged',
						waitTime,
						maxRetries,
						retryDelay,
					},
					this.logger
				);

				formSubmissionResult = retrySubmissionResult.finalResult;
				retryResults = retrySubmissionResult.retryResults;

				// Add the initial submission result
				results.push({
					fieldType: 'formSubmission',
					success: formSubmissionResult.success,
					details: formSubmissionResult
				});

				// Add retry results to the results array
				for (const retryResult of retryResults) {
					results.push({
						fieldType: 'formSubmissionRetry',
						...retryResult
					});
				}
			} else {
				// Simple submission without retry
				formSubmissionResult = await submitForm(
					page,
					submitSelector,
					{
						waitAfterSubmit: waitAfterSubmit as 'noWait' | 'fixedTime' | 'domContentLoaded' | 'navigationComplete' | 'urlChanged',
						waitTime,
					},
					this.logger
				);

				// Add to results array
				results.push({
					fieldType: 'formSubmission',
					success: formSubmissionResult.success,
					details: formSubmissionResult
				});
			}

			// Store the page reference for future operations
			SessionManager.storePage(workflowId, sessionId, page);
		}

		// Take a screenshot if requested
		let screenshot: string | null = null;
		if (takeScreenshotAfterSubmit) {
			screenshot = await takeScreenshot(page, this.logger);
		}

		// Return the result data
		const resultData: IDataObject = {
			sessionId,
			formFields: results,
			currentUrl: await page.url(),
			pageTitle: await page.title(),
		};

		if (submitFormAfterFill) {
			resultData.formSubmission = formSubmissionResult;
		}

		if (screenshot) {
			resultData.screenshot = screenshot;
		}

		return this.helpers.returnJsonArray([resultData]) as unknown as INodeExecutionData;
	} catch (error) {
		// Handle any errors
		this.logger.error(`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Error: ${(error as Error).message}`);

		// Take a screenshot for diagnostics if possible
		let errorScreenshot = null;
		try {
			errorScreenshot = await takeScreenshot(page, this.logger);
		} catch {}

		// Throw the error with additional context
		const errorData: IDataObject = {
			message: (error as Error).message,
			sessionId,
		};

		if (errorScreenshot) {
			errorData.screenshot = errorScreenshot;
		}

		if (continueOnFail) {
			// Return partial results if continue on fail is enabled
			return this.helpers.returnJsonArray([
				{
					success: false,
					error: errorData,
					sessionId,
				}
			]) as unknown as INodeExecutionData;
		}

		throw new Error(`Form operation failed: ${(error as Error).message}`);
	}
}
