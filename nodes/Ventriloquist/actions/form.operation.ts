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
		description: 'Whether to use random delays between actions to simulate human behavior (0.7-2.5 seconds)',
		displayOptions: {
			show: {
				operation: ['form'],
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
								name: 'Radio',
								value: 'radio',
							},
							{
								name: 'Select',
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
				name: 'Navigation Complete',
				value: 'navigationComplete',
			},
			{
				name: 'Fixed Time',
				value: 'fixedTime',
			},
			{
				name: 'No Wait',
				value: 'noWait',
			},
		],
		default: 'navigationComplete',
		description: 'What to wait for after submitting the form',
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
];

/**
 * Get a random human-like delay between 700-2500ms
 */
function getHumanDelay(): number {
	return Math.floor(Math.random() * (2500 - 700 + 1) + 700);
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
	const waitAfterSubmit = this.getNodeParameter('waitAfterSubmit', index, 'navigationComplete') as string;
	const waitTime = this.getNodeParameter('waitTime', index, 5000) as number;
	const takeScreenshot = this.getNodeParameter('takeScreenshot', index, false) as boolean;

	// Get or create browser session
	let page: puppeteer.Page;
	let pageId: string;

	try {
		// Create a session or reuse an existing one
		const { browser, pageId: newPageId } = await Ventriloquist.getOrCreateSession(
			workflowId,
			websocketEndpoint,
			this.logger
		);

		// Try to get any existing page from the browser
		const pages = await browser.pages();

		if (pages.length > 0) {
			// Use the first available page
			page = pages[0];
			pageId = `existing_${Date.now()}`;
			this.logger.info('Using existing page from browser session');
		} else {
			// Create a new page if none exists
			page = await browser.newPage();
			pageId = newPageId;
			this.logger.info(`Created new page with ID: ${pageId}`);

			// Store the new page for future operations
			Ventriloquist.storePage(workflowId, pageId, page);

			// Navigate to a blank page to initialize it
			await page.goto('about:blank');
		}
	} catch (error) {
		throw new Error(`Failed to get or create a page: ${(error as Error).message}`);
	}

	try {
		this.logger.info('Starting form fill operation');
		const results: IDataObject[] = [];

		// Fill each form field
		for (const field of formFields) {
			const fieldType = field.fieldType as string;
			const selector = field.selector as string;

			this.logger.info(`Processing ${fieldType} field with selector: ${selector}`);

			// Wait for the element to be available
			await page.waitForSelector(selector);

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

					// Type text into the field
					await page.type(selector, value);

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
			this.logger.info('Submitting the form');

			// Add a slight delay before submitting (feels more human)
			if (useHumanDelays) {
				await new Promise(resolve => setTimeout(resolve, getHumanDelay()));
			}

			await page.click(submitSelector);

			// Handle waiting after submission
			if (waitAfterSubmit === 'navigationComplete') {
				this.logger.info('Waiting for navigation to complete');
				await page.waitForNavigation();
			} else if (waitAfterSubmit === 'fixedTime') {
				this.logger.info(`Waiting ${waitTime}ms after submission`);
				await new Promise(resolve => setTimeout(resolve, waitTime));
			}
			// If 'noWait', we don't wait at all
		}

		// Get current page info
		const currentUrl = page.url();
		const pageTitle = await page.title();

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
				pageId: pageId,
				url: currentUrl,
				title: pageTitle,
				formFields: results,
				submitted: submitForm,
				timestamp: new Date().toISOString(),
				screenshot,
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

		return {
			json: {
				success: false,
				operation: 'form',
				pageId: pageId,
				error: (error as Error).message,
				timestamp: new Date().toISOString(),
				screenshot,
			},
		};
	}
}
