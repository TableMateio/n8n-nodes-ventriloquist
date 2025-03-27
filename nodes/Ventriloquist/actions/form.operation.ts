import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { Ventriloquist } from '../Ventriloquist.node';
import type * as puppeteer from 'puppeteer-core';

/**
 * Form operation description
 */
export const description: INodeProperties[] = [
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
							},
							{
								name: 'File',
								value: 'file',
							},
							{
								name: 'Multi-Select',
								value: 'multiSelect',
							},
							{
								name: 'Radio',
								value: 'radio',
							},
							{
								name: 'Select (Dropdown)',
								value: 'select',
							},
							{
								name: 'Text',
								value: 'text',
							},
						],
						default: 'text',
						description: 'The type of form field',
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
				name: 'DOM Content Loaded',
				value: 'domContentLoaded',
				description: 'Fast: Wait until the new page structure is ready for interaction (3-5 seconds)',
			},
			{
				name: 'Fixed Time',
				value: 'fixedTime',
				description: 'Simple: Just wait for a specific amount of time that you set below',
			},
			{
				name: 'Navigation Complete',
				value: 'navigationComplete',
				description: 'Thorough but slow: Wait until all page resources have finished loading (10-30 seconds)',
			},
			{
				name: 'No Wait',
				value: 'noWait',
				description: 'Immediate: Do not wait at all after clicking submit (may cause issues if next steps need the new page)',
			},
			{
				name: 'Page Load',
				value: 'pageLoad',
				description: 'Medium: Wait for basic page resources to load (5-10 seconds)',
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
 * Get a random human-like delay between 100-300ms (much faster than before)
 */
function getHumanDelay(): number {
	return Math.floor(Math.random() * (300 - 100 + 1) + 100);
}

/**
 * Ensure an element is visible in the viewport by scrolling to it if needed
 */
async function ensureElementInViewport(page: puppeteer.Page, selector: string): Promise<boolean> {
	try {
		// Check if element exists and is visible
		const isVisible = await page.evaluate((sel) => {
			const el = document.querySelector(sel);
			if (!el) return false;

			const style = window.getComputedStyle(el);
			const isDisplayed = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';

			if (!isDisplayed) return false;

			// Check if element is in viewport
			const rect = el.getBoundingClientRect();
			return (
				rect.top >= 0 &&
				rect.left >= 0 &&
				rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
				rect.right <= (window.innerWidth || document.documentElement.clientWidth)
			);
		}, selector);

		// If not visible in viewport, scroll to it
		if (!isVisible) {
			await page.evaluate((sel) => {
				const el = document.querySelector(sel);
				if (el) {
					el.scrollIntoView({ behavior: 'smooth', block: 'center' });
					return true;
				}
				return false;
			}, selector);

			// Wait a moment for the scroll to complete
			await new Promise(resolve => setTimeout(resolve, 500));
			return true;
		}

		return true;
	} catch (error) {
		return false;
	}
}

/**
 * Try multiple button click methods to ensure click succeeds
 */
async function robustButtonClick(page: puppeteer.Page, selector: string, logger: {
	info: (message: string) => void;
	warn: (message: string) => void;
	error: (message: string) => void;
}): Promise<boolean> {
	try {
		// Method 1: Standard click
		logger.info('Attempting standard click method');
		await page.click(selector);
		logger.info('Standard click succeeded');
		return true;
	} catch (error1) {
		logger.warn(`Standard click failed: ${(error1 as Error).message}, trying alternate methods`);

		try {
			// Method 2: JavaScript click via evaluate
			logger.info('Attempting JavaScript click method');
			const clickResult = await page.evaluate((sel) => {
				const button = document.querySelector(sel);
				if (button) {
					// Cast to HTMLElement to access click method
					(button as HTMLElement).click();
					return { success: true, elementExists: true };
				}
				return { success: false, elementExists: false };
			}, selector);

			if (clickResult.success) {
				logger.info('JavaScript click succeeded');
				return true;
			}

			if (!clickResult.elementExists) {
				logger.error('Button no longer exists in DOM');
				return false;
			}

			// Method 3: Try mousedown + mouseup events
			logger.info('Attempting mousedown/mouseup events method');
			await page.evaluate((sel) => {
				const button = document.querySelector(sel);
				if (button) {
					const events = ['mousedown', 'mouseup', 'click'];
					for (const eventType of events) {
						const event = new MouseEvent(eventType, {
							view: window,
							bubbles: true,
							cancelable: true,
							buttons: 1
						});
						button.dispatchEvent(event);
					}
				}
			}, selector);

			logger.info('Direct event dispatch attempted');
			return true;
		} catch (error2) {
			logger.error(`All click methods failed: ${(error2 as Error).message}`);
			return false;
		}
	}
}

/**
 * Calculate simple string similarity (Levenshtein distance based)
 */
function calculateSimilarity(str1: string, str2: string): number {
	const track = Array(str2.length + 1).fill(null).map(() =>
		Array(str1.length + 1).fill(null));

	for (let i = 0; i <= str1.length; i += 1) {
		track[0][i] = i;
	}

	for (let j = 0; j <= str2.length; j += 1) {
		track[j][0] = j;
	}

	for (let j = 1; j <= str2.length; j += 1) {
		for (let i = 1; i <= str1.length; i += 1) {
			const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
			track[j][i] = Math.min(
				track[j][i - 1] + 1, // deletion
				track[j - 1][i] + 1, // insertion
				track[j - 1][i - 1] + indicator, // substitution
			);
		}
	}

	const distance = track[str2.length][str1.length];
	const maxLength = Math.max(str1.length, str2.length);
	if (maxLength === 0) return 1.0; // Both strings are empty

	// Convert distance to similarity score (1 - normalized distance)
	return 1 - distance / maxLength;
}

/**
 * Find best match using similarity
 */
function findBestMatch(target: string, options: Array<{value: string, text: string}>): {
	bestMatch: {value: string, text: string, rating: number};
	bestMatchIndex: number;
} {
	const targetLower = target.toLowerCase();
	const ratings = options.map(option => ({
		value: option.value,
		text: option.text,
		rating: calculateSimilarity(targetLower, option.text.toLowerCase())
	}));

	let bestMatchIndex = 0;
	let bestRating = 0;

	for (let i = 0; i < ratings.length; i++) {
		if (ratings[i].rating > bestRating) {
			bestRating = ratings[i].rating;
			bestMatchIndex = i;
		}
	}

	return {
		bestMatch: ratings[bestMatchIndex],
		bestMatchIndex
	};
}

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
	const submitForm = this.getNodeParameter('submitForm', index, true) as boolean;
	const submitSelector = this.getNodeParameter('submitSelector', index, '') as string;
	const waitAfterSubmit = this.getNodeParameter('waitAfterSubmit', index, 'domContentLoaded') as string;
	const waitTime = this.getNodeParameter('waitTime', index, 5000) as number;
	const takeScreenshot = this.getNodeParameter('takeScreenshot', index, false) as boolean;
	const waitForSelectors = this.getNodeParameter('waitForSelectors', index, true) as boolean;
	const selectorTimeout = this.getNodeParameter('selectorTimeout', index, 10000) as number;
	const continueOnFail = this.getNodeParameter('continueOnFail', index, true) as boolean;
	const retrySubmission = this.getNodeParameter('retrySubmission', index, false) as boolean;
	const maxRetries = this.getNodeParameter('maxRetries', index, 2) as number;
	const retryDelay = this.getNodeParameter('retryDelay', index, 1000) as number;
	const advancedButtonOptions = this.getNodeParameter('advancedButtonOptions', index, false) as boolean;

	// Check if an explicit session ID was provided
	const explicitSessionId = this.getNodeParameter('explicitSessionId', index, '') as string;

	// Get or create browser session
	let page: puppeteer.Page | undefined;
	let sessionId = '';

	try {
		// Create a session or reuse an existing one
		const { browser, sessionId: newSessionId } = await Ventriloquist.getOrCreateSession(
			workflowId,
			websocketEndpoint,
			this.logger,
			undefined,
		);

		// If an explicit sessionId was provided, try to get that page first
		if (explicitSessionId) {
			this.logger.info(`Looking for explicitly provided session ID: ${explicitSessionId}`);
			page = Ventriloquist.getPage(workflowId, explicitSessionId);

			if (page) {
				sessionId = explicitSessionId;
				this.logger.info(`Found existing page with explicit session ID: ${sessionId}`);
			} else {
				this.logger.warn(`Provided session ID ${explicitSessionId} not found, will create a new session`);
			}
		}

		// If no explicit session or explicit session not found, proceed with normal flow
		if (!explicitSessionId || !page) {
			// Try to get any existing page from the browser
			const pages = await browser.pages();

			if (pages.length > 0) {
				// Use the first available page
				page = pages[0];
				sessionId = `existing_${Date.now()}`;
				this.logger.info('Using existing page from browser session');
			} else {
				// Create a new page if none exists
				page = await browser.newPage();
				sessionId = newSessionId;
				this.logger.info(`Created new page with session ID: ${sessionId}`);

				// Store the new page for future operations
				Ventriloquist.storePage(workflowId, sessionId, page);

				// Navigate to a blank page to initialize it
				await page.goto('about:blank');
			}
		}

		// At this point we must have a valid page
		if (!page) {
			throw new Error('Failed to get or create a page');
		}
	} catch (error) {
		throw new Error(`Failed to get or create a page: ${(error as Error).message}`);
	}

	try {
		this.logger.info('Starting form fill operation');
		const results: IDataObject[] = [];

		// Wait for form elements if enabled
		if (waitForSelectors) {
			this.logger.info('Waiting for form elements to appear');
			await page.waitForSelector('*', { timeout: selectorTimeout });
		}

		// Fill each form field
		for (const field of formFields) {
			const fieldType = field.fieldType as string;
			const selector = field.selector as string;

			this.logger.info(`Processing ${fieldType} field with selector: ${selector}`);

			// Wait for the element to be available
			if (waitForSelectors) {
				this.logger.info(`Waiting for selector: ${selector} (timeout: ${selectorTimeout}ms)`);
				await page.waitForSelector(selector, { timeout: selectorTimeout });
			} else {
				// Check if the element exists first
				const elementExists = await page.$(selector) !== null;
				if (!elementExists) {
					throw new Error(`Element with selector "${selector}" not found on page`);
				}
			}

			// Handle different field types
			switch (fieldType) {
				case 'text': {
					const value = field.value as string;
					const clearField = field.clearField as boolean;

					// Clear field if requested
					if (clearField) {
						await page.evaluate((sel: string) => {
							const element = document.querySelector(sel);
							if (element) {
								(element as HTMLInputElement).value = '';
							}
						}, selector);
					}

					// Type text with consistent 25ms delay
					await page.type(selector, value, { delay: 25 });

					// Record the result
					results.push({
						fieldType,
						selector,
						value,
						success: true,
					});
					break;
				}

				case 'select': {
					const value = field.value as string;
					const matchType = field.matchType as string;
					let selectedValue = value;
					let selectedText = '';
					let matchDetails = '';

					if (matchType === 'exact') {
						// Simple exact value match
						await page.select(selector, value);

						// Try to get the text for this value
						try {
							selectedText = await page.$eval(`${selector} option[value="${value}"]`,
								(el) => (el as HTMLOptionElement).textContent || '');
						} catch {
							// If we can't get the text, just leave it blank
						}

						matchDetails = 'exact match';
					} else if (matchType === 'textContains' || matchType === 'fuzzy') {
						// Get all options from the dropdown
						const options = await page.$$eval(`${selector} option`, (options: Element[]) => {
							return options.map((option: Element) => ({
								value: (option as HTMLOptionElement).value,
								text: option.textContent?.trim() || '',
							}));
						});

						if (options.length === 0) {
							throw new Error(`No options found in dropdown: ${selector}`);
						}

						if (matchType === 'textContains') {
							// Find an option that contains the text
							const matchingOption = options.find(option =>
								option.text.toLowerCase().includes(value.toLowerCase())
							);

							if (!matchingOption) {
								throw new Error(`No option with text containing "${value}" found in dropdown: ${selector}`);
							}

							selectedValue = matchingOption.value;
							selectedText = matchingOption.text;
							matchDetails = `text contains match: "${value}" → "${selectedText}"`;
							this.logger.info(`Selected option with value: ${selectedValue} (${matchDetails})`);
						} else {
							// Fuzzy matching
							const threshold = field.fuzzyThreshold as number || 0.5;
							const bestMatch = findBestMatch(value, options);

							if (bestMatch.bestMatch.rating < threshold) {
								throw new Error(`No close matches found for "${value}" in dropdown: ${selector} (best match: "${bestMatch.bestMatch.text}" with score: ${bestMatch.bestMatch.rating.toFixed(2)})`);
							}

							selectedValue = bestMatch.bestMatch.value;
							selectedText = bestMatch.bestMatch.text;
							matchDetails = `fuzzy match: "${value}" → "${selectedText}" (score: ${bestMatch.bestMatch.rating.toFixed(2)})`;
							this.logger.info(`Selected option with value: ${selectedValue} (${matchDetails})`);
						}

						// Select the option
						await page.select(selector, selectedValue);
					}

					// Record the result with enhanced information
					results.push({
						fieldType,
						selector,
						requestedValue: value,
						selectedValue,
						selectedText,
						matchType,
						matchDetails,
						success: true,
					});
					break;
				}

				case 'checkbox': {
					const checked = field.checked as boolean;
					// Get current checked state
					const currentChecked = await page.evaluate((sel: string) => {
						const element = document.querySelector(sel);
						return element ? (element as HTMLInputElement).checked : false;
					}, selector);

					// Only click if the current state doesn't match desired state
					if (currentChecked !== checked) {
						await page.click(selector);
					}

					// Record the result
					results.push({
						fieldType,
						selector,
						checked,
						success: true,
					});
					break;
				}

				case 'radio': {
					// For radio buttons, just click to select
					await page.click(selector);

					// Record the result
					results.push({
						fieldType,
						selector,
						value: field.value,
						success: true,
					});
					break;
				}

				case 'file': {
					const filePath = field.filePath as string;
					if (!filePath) {
						throw new Error(`File path is required for file input (selector: ${selector})`);
					}

					// Get the file input element
					const fileInput = await page.$(selector);
					if (!fileInput) {
						throw new Error(`File input element not found: ${selector}`);
					}

					// Upload the file
					// We need to cast to a specific type for the uploadFile method
					await (fileInput as puppeteer.ElementHandle<HTMLInputElement>).uploadFile(filePath);

					// Record the result
					results.push({
						fieldType,
						selector,
						filePath,
						success: true,
					});
					break;
				}

				case 'multiSelect': {
					const multiSelectValues = (field.multiSelectValues as string || '').split(',').map(v => v.trim()).filter(v => v);

					if (multiSelectValues.length === 0) {
						throw new Error(`No values provided for multi-select field: ${selector}`);
					}

					// Check if this is a multiple select element
					const isMultipleSelect = await page.$eval(selector, (el) =>
						(el as HTMLSelectElement).multiple
					);

					if (isMultipleSelect) {
						// For real <select multiple> elements, use the select-multiple capability
						await page.select(selector, ...multiSelectValues);

						this.logger.info(`Selected ${multiSelectValues.length} options in multiple select`);
					} else {
						// For checkbox groups or custom multi-selects, click each value's checkbox
						for (const value of multiSelectValues) {
							// Try a few common patterns for checkbox selectors
							const possibleSelectors = [
								`${selector} input[value="${value}"]`, // Direct value
								`${selector} input[data-value="${value}"]`, // Data attribute
								`${selector} label:has-text("${value}") input`, // Label text
								`${selector} *:has-text("${value}") input[type="checkbox"]` // Any element with text
							];

							let clicked = false;

							// Try each selector pattern
							for (const possibleSelector of possibleSelectors) {
								try {
									const exists = await page.$(possibleSelector) !== null;
									if (exists) {
										await page.click(possibleSelector);
										this.logger.info(`Clicked multi-select option: ${value} with selector: ${possibleSelector}`);
										clicked = true;
										break;
									}
								} catch (error) {
									// Continue to the next selector pattern
								}
							}

							if (!clicked) {
								this.logger.warn(`Could not find clickable element for value: ${value} in multi-select: ${selector}`);
							}

							// Add a tiny delay between clicks to ensure they register separately
							await new Promise(resolve => setTimeout(resolve, 50));
						}
					}

					// Record the result
					results.push({
						fieldType,
						selector,
						values: multiSelectValues,
						success: true,
					});
					break;
				}
			}

			// Add a human-like delay if enabled
			if (useHumanDelays) {
				const delay = getHumanDelay();
				this.logger.info(`Adding human-like delay: ${delay}ms`);
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}

		// Submit the form if requested
		if (submitForm && submitSelector) {
			// Capture the current URL and title before submission for comparison
			const beforeUrl = page.url();
			const beforeTitle = await page.title();
			this.logger.info(`Before submission - URL: ${beforeUrl}, Title: ${beforeTitle}`);

			// Declaration of submission result to track throughout all code paths
			let formSubmissionResult: IDataObject = {
				urlChanged: false,
				titleChanged: false,
				beforeUrl,
				afterUrl: '',
				beforeTitle,
				afterTitle: '',
			};

			this.logger.info('Preparing to submit the form');

			// Add a slight delay before submitting (feels more human)
			if (useHumanDelays) {
				const delay = getHumanDelay();
				this.logger.info(`Adding human-like delay before submission: ${delay}ms`);
				await new Promise(resolve => setTimeout(resolve, delay));
			}

			// Always add a short mandatory delay (500ms) before clicking submit
			// This helps with form validation and button state changes
			this.logger.info('Adding mandatory delay before form submission to allow for validation (500ms)');
			await new Promise(resolve => setTimeout(resolve, 500));

			// Check if the submit button exists and is clickable
			const submitButtonExists = await page.$(submitSelector) !== null;
			if (!submitButtonExists) {
				this.logger.warn(`Submit button with selector "${submitSelector}" not found on page`);
				throw new Error(`Submit button with selector "${submitSelector}" not found on page`);
			}

			// Get details about the submit button for debugging
			try {
				const buttonDetails = await page.$eval(submitSelector, (el) => ({
					tagName: el.tagName,
					id: el.id || '',
					className: el.className || '',
					disabled: el.hasAttribute('disabled'),
					type: el.getAttribute('type') || '',
					text: el.textContent?.trim() || '',
					visible: (el as HTMLElement).offsetParent !== null,
					position: {
						top: el.getBoundingClientRect().top,
						left: el.getBoundingClientRect().left,
					}
				}));
				this.logger.info(`Found submit button: ${JSON.stringify(buttonDetails)}`);

				// Check if button is disabled
				if (buttonDetails.disabled) {
					this.logger.warn('Button is currently disabled. Waiting 1000ms to see if it becomes enabled...');
					await new Promise(resolve => setTimeout(resolve, 1000));

					// Check again
					const updatedDisabled = await page.$eval(submitSelector, el => el.hasAttribute('disabled'));
					if (updatedDisabled) {
						this.logger.warn('Button remains disabled. Attempting to click anyway, but it may fail.');
					} else {
						this.logger.info('Button is now enabled, proceeding with click');
					}
				}

				// Check if button is not visible
				if (!buttonDetails.visible) {
					this.logger.warn('Button may not be visible. Will attempt to scroll it into view.');
				}
			} catch (buttonError) {
				this.logger.warn(`Error getting submit button details: ${buttonError}`);
			}

			// Get advanced button options if enabled
			let scrollIntoView = false;
			let buttonClickMethod = 'auto';
			let clickTimeout = 10000;

			if (advancedButtonOptions) {
				scrollIntoView = this.getNodeParameter('scrollIntoView', index, true) as boolean;
				buttonClickMethod = this.getNodeParameter('buttonClickMethod', index, 'auto') as string;
				clickTimeout = this.getNodeParameter('clickTimeout', index, 10000) as number;
			}

			// Scroll the button into view if requested
			if (scrollIntoView) {
				this.logger.info('Scrolling button into view...');
				const scrollResult = await ensureElementInViewport(page, submitSelector);
				this.logger.info(`Scroll into view ${scrollResult ? 'successful' : 'not needed or failed'}`);
			}

			// Now click the submit button using the appropriate method
			this.logger.info(`Clicking submit button with selector: ${submitSelector} (method: ${buttonClickMethod})`);

			let clickSuccess = false;

			// Create a timeout promise to prevent hanging
			const clickTimeoutPromise = new Promise<boolean>((resolve) => {
				setTimeout(() => resolve(false), clickTimeout);
			});

			// Use different click methods based on settings
			if (buttonClickMethod === 'auto') {
				// Use the robust click method that tries multiple approaches
				const clickPromise = robustButtonClick(page, submitSelector, this.logger);
				clickSuccess = await Promise.race([clickPromise, clickTimeoutPromise]);

				if (!clickSuccess) {
					this.logger.warn(`Button click timed out after ${clickTimeout}ms`);
				}
			} else if (buttonClickMethod === 'standard') {
				// Standard puppeteer click
				try {
					await Promise.race([
						page.click(submitSelector),
						clickTimeoutPromise
					]);
					clickSuccess = true;
					this.logger.info('Standard click completed');
				} catch (clickError) {
					this.logger.error(`Standard click failed: ${clickError}`);
					clickSuccess = false;
				}
			} else if (buttonClickMethod === 'javascript') {
				// JavaScript click
				try {
					const jsClickPromise = page.evaluate((sel) => {
						const button = document.querySelector(sel);
						if (button) {
							(button as HTMLElement).click();
							return true;
						}
						return false;
					}, submitSelector);

					clickSuccess = await Promise.race([jsClickPromise, clickTimeoutPromise]);
					this.logger.info(`JavaScript click ${clickSuccess ? 'completed' : 'timed out'}`);
				} catch (clickError) {
					this.logger.error(`JavaScript click failed: ${clickError}`);
					clickSuccess = false;
				}
			} else if (buttonClickMethod === 'events') {
				// Direct DOM events
				try {
					const eventsClickPromise = page.evaluate((sel) => {
						const button = document.querySelector(sel);
						if (button) {
							const events = ['mousedown', 'mouseup', 'click'];
							for (const eventType of events) {
								const event = new MouseEvent(eventType, {
									view: window,
									bubbles: true,
									cancelable: true,
									buttons: 1
								});
								button.dispatchEvent(event);
							}
							return true;
						}
						return false;
					}, submitSelector);

					clickSuccess = await Promise.race([eventsClickPromise, clickTimeoutPromise]);
					this.logger.info(`DOM events click ${clickSuccess ? 'completed' : 'timed out'}`);
				} catch (clickError) {
					this.logger.error(`DOM events click failed: ${clickError}`);
					clickSuccess = false;
				}
			}

			if (clickSuccess) {
				this.logger.info('Submit button click successful');
			} else {
				this.logger.warn('Submit button click may have failed - will continue anyway');
			}

			// Handle waiting after submission
			if (waitAfterSubmit === 'navigationComplete') {
				this.logger.info('Waiting for navigation to complete (all network idle)');
				try {
					await page.waitForNavigation({
						timeout: 60000,
						waitUntil: ['load', 'domcontentloaded', 'networkidle2']
					});
					this.logger.info('Navigation completed successfully - all resources loaded');

					// Immediately indicate success since DOM is ready
					formSubmissionResult = {
						urlChanged: page.url() !== beforeUrl,
						titleChanged: await page.title() !== beforeTitle,
						beforeUrl,
						afterUrl: page.url(),
						beforeTitle,
						afterTitle: await page.title(),
						navigationCompleted: true,
					};

					// Store the page reference and results
					Ventriloquist.storePage(workflowId, sessionId, page);
					results.push({
						fieldType: 'formSubmission',
						success: true,
						details: formSubmissionResult
					});

					// Wait for network to settle in the background so we don't hold up completion
					try {
						await Promise.race([
							page.waitForNavigation({ waitUntil: ['networkidle2'], timeout: 5000 }),
							new Promise(resolve => setTimeout(resolve, 5000))
						]);
						this.logger.info('Network stabilized after navigation');
					} catch (netError) {
						this.logger.info('Continuing without waiting for full network idle');
					}

					// Add a short stabilization period
					await new Promise(resolve => setTimeout(resolve, 500));

					// Re-store the page reference again
					Ventriloquist.storePage(workflowId, sessionId, page);
					this.logger.info('Updated page reference in session store');
				} catch (navError) {
					this.logger.warn(`Navigation timeout or error: ${navError}`);
					// Don't throw an error, just log and continue
					this.logger.info('Adding fallback delay of 5000ms since navigation event failed');
					await new Promise(resolve => setTimeout(resolve, 5000));

					// Check if the page actually changed despite the navigation error
					const afterUrl = page.url();
					const afterTitle = await page.title();

					if (afterUrl !== beforeUrl || afterTitle !== beforeTitle) {
						this.logger.info('Page changed despite navigation event timeout - considering successful');

						// Store successful navigation result
						formSubmissionResult = {
							urlChanged: afterUrl !== beforeUrl,
							titleChanged: afterTitle !== beforeTitle,
							beforeUrl,
							afterUrl,
							beforeTitle,
							afterTitle,
							navigationErrorRecovered: true,
						};

						// Add result to results array
						results.push({
							fieldType: 'formSubmission',
							success: true,
							details: formSubmissionResult
						});
					} else {
						// No page change, likely a real navigation failure
						this.logger.warn('No page change detected after navigation timeout - form submission may have failed');

						formSubmissionResult = {
							error: 'Navigation timeout with no page change',
							beforeUrl,
							afterUrl,
							beforeTitle,
							afterTitle,
							urlChanged: false,
							titleChanged: false,
						};

						results.push({
							fieldType: 'formSubmission',
							success: false,
							details: formSubmissionResult
						});
					}
				}
			} else if (waitAfterSubmit === 'domContentLoaded') {
				this.logger.info('Waiting for DOM content to be loaded (faster)');
				try {
					await page.waitForNavigation({
						timeout: 30000,
						waitUntil: ['domcontentloaded']
					});
					this.logger.info('DOM content loaded successfully');

					// Immediately indicate success since DOM is ready
					formSubmissionResult = {
						urlChanged: page.url() !== beforeUrl,
						titleChanged: await page.title() !== beforeTitle,
						beforeUrl,
						afterUrl: page.url(),
						beforeTitle,
						afterTitle: await page.title(),
						navigationCompleted: true,
					};

					// Store the page reference and results
					Ventriloquist.storePage(workflowId, sessionId, page);
					results.push({
						fieldType: 'formSubmission',
						success: true,
						details: formSubmissionResult
					});

					// Add a short stabilization period
					await new Promise(resolve => setTimeout(resolve, 500));
				} catch (navError) {
					this.logger.warn(`DOM content load timeout or error: ${navError}`);
					// Add fallback delay and check for page change
					await new Promise(resolve => setTimeout(resolve, 2000));

					// Check if the page actually changed despite the navigation error
					const afterUrl = page.url();
					const afterTitle = await page.title();

					if (afterUrl !== beforeUrl || afterTitle !== beforeTitle) {
						this.logger.info('Page changed despite DOM content load timeout - considering successful');

						// Store successful navigation result
						formSubmissionResult = {
							urlChanged: afterUrl !== beforeUrl,
							titleChanged: afterTitle !== beforeTitle,
							beforeUrl,
							afterUrl,
							beforeTitle,
							afterTitle,
							navigationErrorRecovered: true,
						};

						// Add result to results array
						results.push({
							fieldType: 'formSubmission',
							success: true,
							details: formSubmissionResult
						});
					} else {
						// No page change, likely a real navigation failure
						this.logger.warn('No page change detected after DOM content load timeout - form submission may have failed');

						formSubmissionResult = {
							error: 'DOM content load timeout with no page change',
							beforeUrl,
							afterUrl,
							beforeTitle,
							afterTitle,
							urlChanged: false,
							titleChanged: false,
						};

						results.push({
							fieldType: 'formSubmission',
							success: false,
							details: formSubmissionResult
						});
					}
				}
			} else if (waitAfterSubmit === 'pageLoad') {
				this.logger.info('Waiting for page load event');
				try {
					await page.waitForNavigation({
						timeout: 30000,
						waitUntil: ['load']
					});
					this.logger.info('Page load completed successfully');

					// Similar success handling as domContentLoaded
					formSubmissionResult = {
						urlChanged: page.url() !== beforeUrl,
						titleChanged: await page.title() !== beforeTitle,
						beforeUrl,
						afterUrl: page.url(),
						beforeTitle,
						afterTitle: await page.title(),
						navigationCompleted: true,
					};

					Ventriloquist.storePage(workflowId, sessionId, page);
					results.push({
						fieldType: 'formSubmission',
						success: true,
						details: formSubmissionResult
					});

					// Brief stabilization
					await new Promise(resolve => setTimeout(resolve, 500));
				} catch (navError) {
					this.logger.warn(`Page load timeout or error: ${navError}`);
					// Fallback handling
					await new Promise(resolve => setTimeout(resolve, 2000));

					// Check if the page actually changed despite the navigation error
					const afterUrl = page.url();
					const afterTitle = await page.title();

					if (afterUrl !== beforeUrl || afterTitle !== beforeTitle) {
						this.logger.info('Page changed despite page load timeout - considering successful');

						// Store successful navigation result
						formSubmissionResult = {
							urlChanged: afterUrl !== beforeUrl,
							titleChanged: afterTitle !== beforeTitle,
							beforeUrl,
							afterUrl,
							beforeTitle,
							afterTitle,
							navigationErrorRecovered: true,
						};

						// Add result to results array
						results.push({
							fieldType: 'formSubmission',
							success: true,
							details: formSubmissionResult
						});
					} else {
						// No page change, likely a real navigation failure
						this.logger.warn('No page change detected after page load timeout - form submission may have failed');

						formSubmissionResult = {
							error: 'Page load timeout with no page change',
							beforeUrl,
							afterUrl,
							beforeTitle,
							afterTitle,
							urlChanged: false,
							titleChanged: false,
						};

						results.push({
							fieldType: 'formSubmission',
							success: false,
							details: formSubmissionResult
						});
					}
				}
			} else if (waitAfterSubmit === 'fixedTime') {
				this.logger.info(`Waiting ${waitTime}ms after submission`);
				await new Promise(resolve => setTimeout(resolve, waitTime));
				this.logger.info('Fixed wait time completed');

				// Re-store the page in case the page reference changed during fixed wait
				Ventriloquist.storePage(workflowId, sessionId, page);
			} else {
				// Even with noWait, add a minimal delay to stabilize
				await new Promise(resolve => setTimeout(resolve, 500));
			}

			// After waiting (regardless of wait method), check if the page actually changed
			// but only if we haven't already recorded a submission result
			if (!results.some(r => r.fieldType === 'formSubmission')) {
				const afterUrl = page.url();
				const afterTitle = await page.title();
				this.logger.info(`After submission - URL: ${afterUrl}, Title: ${afterTitle}`);

				// Add this information to results for debugging
				formSubmissionResult = {
					urlChanged: beforeUrl !== afterUrl,
					titleChanged: beforeTitle !== afterTitle,
					beforeUrl,
					afterUrl,
					beforeTitle,
					afterTitle,
				};

				// Log the submission result
				if (formSubmissionResult.urlChanged || formSubmissionResult.titleChanged) {
					this.logger.info('Form submission detected page change - success likely');
				} else {
					this.logger.warn('No page change detected after form submission - may have failed');
				}

				// Store the submission result for the response
				results.push({
					fieldType: 'formSubmission',
					success: formSubmissionResult.urlChanged || formSubmissionResult.titleChanged,
					details: formSubmissionResult
				});
			}

			// If no change detected and retries are enabled, attempt again
			if ((!formSubmissionResult.urlChanged && !formSubmissionResult.titleChanged) && retrySubmission) {
				this.logger.info(`No page change detected, will retry submission up to ${maxRetries} times`);

				let retryCount = 0;
				let retrySuccess = false;

				while (retryCount < maxRetries && !retrySuccess) {
					retryCount++;
					this.logger.info(`Retry attempt ${retryCount}/${maxRetries} after ${retryDelay}ms delay`);

					// Wait before retrying
					await new Promise(resolve => setTimeout(resolve, retryDelay));

					// Try to click the submit button again
					try {
						// Check if button is still there and get updated info
						const retryButtonDetails = await page.$eval(submitSelector, (el) => ({
							tagName: el.tagName,
							id: el.id || '',
							disabled: el.hasAttribute('disabled'),
						}));

						this.logger.info(`Retry submit button state: ${JSON.stringify(retryButtonDetails)}`);

						// Click again
						this.logger.info(`Clicking submit button again (retry ${retryCount})`);
						await page.click(submitSelector);

						// Handle waiting based on selected method
						if (waitAfterSubmit === 'navigationComplete') {
							this.logger.info('Waiting for navigation to complete after retry');
							try {
								// Use a longer timeout and specific waitUntil options for more reliable navigation
								await page.waitForNavigation({
									timeout: 60000,  // Increased timeout to 60 seconds
									waitUntil: ['load', 'domcontentloaded', 'networkidle2']
								});
								this.logger.info('Navigation after retry completed successfully');

								// Add a stabilization period to let the page fully settle
								this.logger.info('Adding 1000ms stabilization period after retry navigation');
								await new Promise(resolve => setTimeout(resolve, 1000));

								// Re-store the page in case the page reference changed during navigation
								Ventriloquist.storePage(workflowId, sessionId, page);
							} catch (navError) {
								this.logger.warn(`Navigation timeout or error on retry: ${navError}`);
								// Don't throw an error, just log and continue
								this.logger.info('Adding fallback delay of 5000ms since retry navigation event failed');
								await new Promise(resolve => setTimeout(resolve, 5000));
							}
						} else if (waitAfterSubmit === 'fixedTime') {
							this.logger.info(`Waiting ${waitTime}ms after retry submission`);
							await new Promise(resolve => setTimeout(resolve, waitTime));

							// Re-store the page in case the page reference changed during fixed wait
							Ventriloquist.storePage(workflowId, sessionId, page);
						} else {
							// Even with noWait, add a minimal delay to stabilize
							await new Promise(resolve => setTimeout(resolve, 500));
						}

						// Check if page changed after retry
						const retryUrl = page.url();
						const retryTitle = await page.title();

						retrySuccess = (retryUrl !== beforeUrl) || (retryTitle !== beforeTitle);

						if (retrySuccess) {
							this.logger.info(`Retry ${retryCount} successful! Page changed.`);

							// Update the submission result
							formSubmissionResult.urlChanged = retryUrl !== beforeUrl;
							formSubmissionResult.titleChanged = retryTitle !== beforeTitle;
							formSubmissionResult.afterUrl = retryUrl;
							formSubmissionResult.afterTitle = retryTitle;

							// Update the results entry
							results[results.length - 1] = {
								fieldType: 'formSubmission',
								success: true,
								details: {
									...formSubmissionResult,
									retryAttempt: retryCount,
									retrySuccess: true
								}
							};
						} else {
							this.logger.warn(`Retry ${retryCount} did not result in page change`);
						}
					} catch (retryError) {
						this.logger.error(`Error during retry ${retryCount}: ${retryError}`);
					}
				}

				if (!retrySuccess) {
					this.logger.warn(`All ${maxRetries} retry attempts failed to trigger page change`);
					// Update the results entry with retry information
					results[results.length - 1] = {
						fieldType: 'formSubmission',
						success: false,
						details: {
							...formSubmissionResult,
							retriesAttempted: retryCount,
							retrySuccess: false
						}
					};
				}
			}
		}

		// Get current page info
		const currentUrl = page.url();
		const pageTitle = await page.title();

		// Ensure the page is properly stored in the session registry before continuing
		Ventriloquist.storePage(workflowId, sessionId, page);
		this.logger.info(`Final update of page reference in session store (URL: ${currentUrl})`);

		// Take a screenshot if requested
		let screenshot = '';
		if (takeScreenshot) {
			const screenshotBuffer = await page.screenshot({
				encoding: 'base64',
				type: 'jpeg',
				quality: 80,
			});

			screenshot = `data:image/jpeg;base64,${screenshotBuffer}`;
		}

		// Return the results
		return {
			json: {
				success: true,
				operation: 'form',
				sessionId: sessionId,
				url: currentUrl,
				title: pageTitle,
				formFields: results,
				submitted: submitForm,
				timestamp: new Date().toISOString(),
				screenshot,
				pageStatus: 'active', // Indicate that the page is still active
			},
		};
	} catch (error) {
		// Handle errors
		this.logger.error(`Form operation error: ${(error as Error).message}`);

		// Take error screenshot if requested
		let screenshot = '';
		if (takeScreenshot && page) {
			try {
				const screenshotBuffer = await page.screenshot({
					encoding: 'base64',
					type: 'jpeg',
					quality: 80,
				});
				screenshot = `data:image/jpeg;base64,${screenshotBuffer}`;
			} catch {
				// Ignore screenshot errors
			}
		}

		const errorResponse = {
			json: {
				success: false,
				operation: 'form',
				sessionId: sessionId,
				error: (error as Error).message,
				timestamp: new Date().toISOString(),
				screenshot,
			},
		};

		// If continueOnFail is false, throw the error to fail the node
		if (!continueOnFail) {
			throw new Error(`Form operation failed: ${(error as Error).message}`);
		}

		// Otherwise, return an error result
		return errorResponse;
	}
}
