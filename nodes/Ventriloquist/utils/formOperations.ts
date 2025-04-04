import type { Page, ElementHandle } from 'puppeteer-core';
import type { IDataObject } from 'n8n-workflow';
import { robustClick } from './clickOperations';

/**
 * Interface for logger that both IExecuteFunctions and custom loggers can implement
 */
export interface ILogger {
	debug: (message: string) => void;
	info: (message: string) => void;
	warn: (message: string) => void;
	error: (message: string) => void;
}

/**
 * Ensure an element is visible in the viewport by scrolling to it if necessary
 */
export async function ensureElementInViewport(page: Page, selector: string): Promise<boolean> {
	try {
		return await page.evaluate((sel) => {
			const element = document.querySelector(sel);
			if (!element) return false;

			// Check if element is already in viewport
			const rect = element.getBoundingClientRect();
			const isInViewport = (
				rect.top >= 0 &&
				rect.left >= 0 &&
				rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
				rect.right <= (window.innerWidth || document.documentElement.clientWidth)
			);

			// If already in viewport, no need to scroll
			if (isInViewport) return true;

			// Scroll the element into view with smooth behavior
			element.scrollIntoView({
				behavior: 'smooth',
				block: 'center',
				inline: 'center'
			});

			return true;
		}, selector);
	} catch (error) {
		return false;
	}
}

/**
 * Click a button robustly with multiple fallback methods
 */
export async function robustButtonClick(page: Page, selector: string, logger: ILogger): Promise<boolean> {
	// Use the more robust robustClick utility
	const result = await robustClick(page, selector, { logger });
	return result.success;
}

/**
 * Calculate simple string similarity (Levenshtein distance based)
 */
export function calculateSimilarity(str1: string, str2: string): number {
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
export function findBestMatch(target: string, options: Array<{value: string, text: string}>): {
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
 * Return a random delay between min and max milliseconds for human-like behavior
 */
export function getHumanDelay(min = 100, max = 300): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Fill a text input field with optional human-like typing
 */
export async function fillTextField(
	page: Page,
	selector: string,
	value: string,
	options: {
		clearField?: boolean;
		humanLike?: boolean;
		pressEnter?: boolean;
	},
	logger: ILogger
): Promise<boolean> {
	try {
		// Clear field if requested
		if (options.clearField) {
			logger.debug(`Clearing field contents before filling: ${selector}`);
			await page.evaluate((sel: string) => {
				const element = document.querySelector(sel);
				if (element) {
					(element as HTMLInputElement).value = '';
				}
			}, selector);
		}

		logger.info(`Filling text field: ${selector} with value: ${value} (human-like: ${options.humanLike})`);

		// Type text with either human-like typing or direct typing
		if (options.humanLike) {
			// Character-by-character typing with variable delays
			for (const char of value) {
				await page.type(selector, char, { delay: Math.floor(Math.random() * 150) + 25 });
			}
		} else {
			// Direct input without character delays
			await page.type(selector, value, { delay: 0 });
		}

		// Press Enter if requested
		if (options.pressEnter) {
			await page.keyboard.press('Enter');
		}

		return true;
	} catch (error) {
		logger.error(`Error filling text field: ${(error as Error).message}`);

		// Try fallback method using evaluate
		try {
			logger.info(`Trying fallback method for filling: ${selector}`);
			await page.evaluate((sel, val) => {
				const element = document.querySelector(sel);
				if (element && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
					element.value = val;
					element.dispatchEvent(new Event('input', { bubbles: true }));
					element.dispatchEvent(new Event('change', { bubbles: true }));
				}
			}, selector, value);

			return true;
		} catch (fallbackError) {
			logger.error(`Fallback method also failed: ${(fallbackError as Error).message}`);
			return false;
		}
	}
}

/**
 * Handle dropdown/select field
 */
export async function handleSelectField(
	page: Page,
	selector: string,
	value: string,
	options: {
		matchType: 'exact' | 'textContains' | 'fuzzy';
		fuzzyThreshold?: number;
	},
	logger: ILogger
): Promise<{ success: boolean; selectedValue?: string; selectedText?: string; matchDetails?: string }> {
	try {
		if (options.matchType === 'exact') {
			// Simple exact value match
			await page.select(selector, value);

			// Try to get the text for this value
			let selectedText = '';
			try {
				selectedText = await page.$eval(
					`${selector} option[value="${value}"]`,
					(el) => (el as HTMLOptionElement).textContent || ''
				);
			} catch {
				// If we can't get the text, just leave it blank
			}

			return {
				success: true,
				selectedValue: value,
				selectedText,
				matchDetails: 'exact match'
			};
		}

		// Get all options from the dropdown
		const dropdownOptions = await page.$$eval(`${selector} option`, (options: Element[]) => {
			return options.map((option: Element) => ({
				value: (option as HTMLOptionElement).value,
				text: option.textContent?.trim() || '',
			}));
		});

		if (dropdownOptions.length === 0) {
			throw new Error(`No options found in dropdown: ${selector}`);
		}

		if (options.matchType === 'textContains') {
			// Find first option containing the text
			const matchingOption = dropdownOptions.find(option =>
				option.text.toLowerCase().includes(value.toLowerCase())
			);

			if (!matchingOption) {
				throw new Error(`No option with text containing "${value}" found in dropdown: ${selector}`);
			}

			await page.select(selector, matchingOption.value);

			return {
				success: true,
				selectedValue: matchingOption.value,
				selectedText: matchingOption.text,
				matchDetails: `text contains match: "${value}" → "${matchingOption.text}"`
			};
		}

		// Fuzzy matching
		const threshold = options.fuzzyThreshold || 0.5;
		const bestMatch = findBestMatch(value, dropdownOptions);

		if (bestMatch.bestMatch.rating < threshold) {
			throw new Error(
				`No close matches found for "${value}" in dropdown: ${selector} ` +
				`(best match: "${bestMatch.bestMatch.text}" with score: ${bestMatch.bestMatch.rating.toFixed(2)})`
			);
		}

		await page.select(selector, bestMatch.bestMatch.value);

		return {
			success: true,
			selectedValue: bestMatch.bestMatch.value,
			selectedText: bestMatch.bestMatch.text,
			matchDetails: `fuzzy match: "${value}" → "${bestMatch.bestMatch.text}" (score: ${bestMatch.bestMatch.rating.toFixed(2)})`
		};
	} catch (error) {
		logger.error(`Error handling select field: ${(error as Error).message}`);
		return { success: false };
	}
}

/**
 * Handle checkbox fields
 */
export async function handleCheckboxField(
	page: Page,
	selector: string,
	checked: boolean,
	logger: ILogger
): Promise<boolean> {
	try {
		// Get current checked state
		const currentChecked = await page.evaluate((sel: string) => {
			const element = document.querySelector(sel);
			return element ? (element as HTMLInputElement).checked : false;
		}, selector);

		// Only click if the current state doesn't match desired state
		if (currentChecked !== checked) {
			logger.info('Changing checkbox state for ' + selector + ' from ' + currentChecked + ' to ' + checked);

			try {
				// First try native click - this most closely matches the original implementation
				await page.click(selector);
				logger.info('Standard click was successful');
				return true;
			} catch (clickErr) {
				logger.warn(`Native click failed: ${(clickErr as Error).message}, trying alternative method...`);

				// If that fails, try JavaScript click execution - exactly like the original implementation
				const jsClickSuccess = await page.evaluate((sel) => {
					const element = document.querySelector(sel);
					if (!element) return false;

					// Try different approaches
					try {
						// 1. Use click() method
						(element as HTMLElement).click();
						return true;
					} catch (e) {
						try {
							// 2. Create and dispatch mouse events
							const event = new MouseEvent('click', {
								view: window,
								bubbles: true,
								cancelable: true,
								buttons: 1
							});
							element.dispatchEvent(event);
							return true;
						} catch (e2) {
							return false;
						}
					}
				}, selector);

				if (jsClickSuccess) {
					logger.info('JavaScript click was successful');
					return true;
				} else {
					// Third fallback - try to find a related label that might be more clickable
					logger.warn(`JavaScript click failed, trying to find associated label...`);

					const labelClickSuccess = await page.evaluate((sel) => {
						const input = document.querySelector(sel) as HTMLInputElement;
						if (!input) return false;

						// Try to click the label if it exists
						if (input.id) {
							const label = document.querySelector(`label[for="${input.id}"]`);
							if (label) {
								(label as HTMLElement).click();
								return true;
							}
						}

						// Try searching up the parent chain
						let element = input.parentElement;
						while (element && element.tagName !== 'BODY') {
							// Look for potential label in parents or siblings
							const potentialLabel = element.querySelector('label') ||
												   element.closest('label');
							if (potentialLabel) {
								(potentialLabel as HTMLElement).click();
								return true;
							}
							element = element.parentElement;
						}

						return false;
					}, selector);

					if (labelClickSuccess) {
						logger.info('Label click was successful');
						return true;
					}

					// Final fallback - force the checked property directly
					logger.warn('All click attempts failed, forcing checked state directly...');
					const forcedSuccess = await page.evaluate((sel, shouldBeChecked) => {
						const element = document.querySelector(sel) as HTMLInputElement;
						if (!element) return false;

						// Force the checked state
						element.checked = shouldBeChecked;

						// Dispatch change and input events
						element.dispatchEvent(new Event('change', { bubbles: true }));
						element.dispatchEvent(new Event('input', { bubbles: true }));

						return true;
					}, selector, checked);

					if (forcedSuccess) {
						logger.info('Successfully forced checked state directly');
						return true;
					}

					logger.error('All checkbox interaction methods failed');
					return false;
				}
			}
		} else {
			logger.info(`Checkbox ${selector} already in desired state (${checked})`);
			return true;
		}
	} catch (error) {
		logger.error(`Error handling checkbox field: ${(error as Error).message}`);
		return false;
	}
}

/**
 * Handle file upload fields
 */
export async function handleFileUpload(
	page: Page,
	selector: string,
	filePath: string,
	logger: ILogger
): Promise<boolean> {
	try {
		// Get the file input element
		const fileInput = await page.$(selector);
		if (!fileInput) {
			throw new Error(`File input element not found: ${selector}`);
		}

		// Upload the file
		await (fileInput as ElementHandle<HTMLInputElement>).uploadFile(filePath);
		return true;
	} catch (error) {
		logger.error(`Error handling file upload: ${(error as Error).message}`);
		return false;
	}
}

/**
 * Handle multi-select fields
 */
export async function handleMultiSelectField(
	page: Page,
	selector: string,
	values: string[],
	logger: ILogger
): Promise<boolean> {
	try {
		// Check if this is a multiple select element
		const isMultipleSelect = await page.$eval(selector, (el) =>
			(el as HTMLSelectElement).multiple
		);

		if (isMultipleSelect) {
			// For real <select multiple> elements, use the select-multiple capability
			await page.select(selector, ...values);
			logger.info(`Selected ${values.length} options in multiple select`);
			return true;
		}

		// For checkbox groups or custom multi-selects, click each value's checkbox
		let successCount = 0;

		for (const value of values) {
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
						const clickResult = await robustClick(page, possibleSelector, { logger });
						if (clickResult.success) {
							logger.info(`Clicked multi-select option: ${value} with selector: ${possibleSelector}`);
							clicked = true;
							successCount++;
							break;
						}
					}
				} catch {
					// Try next selector
				}
			}

			if (!clicked) {
				logger.warn(`Could not find clickable element for multi-select value: ${value}`);
			}
		}

		return successCount > 0;
	} catch (error) {
		logger.error(`Error handling multi-select field: ${(error as Error).message}`);
		return false;
	}
}

/**
 * Submit a form and wait for the result based on specified wait type
 */
export async function submitForm(
	page: Page,
	submitSelector: string,
	options: {
		waitAfterSubmit: 'noWait' | 'fixedTime' | 'domContentLoaded' | 'navigationComplete' | 'urlChanged';
		waitTime?: number;
	},
	logger: ILogger
): Promise<{
	success: boolean;
	urlChanged?: boolean;
	titleChanged?: boolean;
	beforeUrl?: string;
	afterUrl?: string;
	beforeTitle?: string;
	afterTitle?: string;
	navigationCompleted?: boolean;
}> {
	// Capture current URL and title before submission
	const beforeUrl = page.url();
	const beforeTitle = await page.title();
	logger.info(`Current page before submission - URL: ${beforeUrl}, Title: ${beforeTitle}`);

	// Ensure submit button is in view
	await ensureElementInViewport(page, submitSelector);

	// Click the submit button with robust method
	const clickResult = await robustButtonClick(page, submitSelector, logger);

	if (!clickResult) {
		logger.error('Failed to click submit button');
		return {
			success: false,
			beforeUrl,
			afterUrl: beforeUrl,
			beforeTitle,
			afterTitle: beforeTitle,
			urlChanged: false,
			titleChanged: false
		};
	}

	// Handle waiting after submission
	if (options.waitAfterSubmit === 'domContentLoaded') {
		try {
			logger.info('Waiting for page content to load after submission');
			await page.waitForNavigation({
				timeout: options.waitTime || 30000,
				waitUntil: ['domcontentloaded']
			});
			logger.info('Page content loaded successfully');

			const afterUrl = page.url();
			const afterTitle = await page.title();

			return {
				success: true,
				urlChanged: afterUrl !== beforeUrl,
				titleChanged: afterTitle !== beforeTitle,
				beforeUrl,
				afterUrl,
				beforeTitle,
				afterTitle,
				navigationCompleted: true
			};
		} catch (error) {
			logger.warn(`Navigation timeout: ${(error as Error).message} - checking page state directly`);

			// Check if page changed despite the timeout
			const afterUrl = page.url();
			const afterTitle = await page.title();

			if (afterUrl !== beforeUrl || afterTitle !== beforeTitle) {
				logger.info(`Page changed despite navigation timeout: ${beforeUrl} → ${afterUrl}`);

				return {
					success: true,
					urlChanged: afterUrl !== beforeUrl,
					titleChanged: afterTitle !== beforeTitle,
					beforeUrl,
					afterUrl,
					beforeTitle,
					afterTitle,
					navigationCompleted: false
				};
			}

			logger.warn('No page change detected - form submission may have failed');

			return {
				success: false,
				urlChanged: false,
				titleChanged: false,
				beforeUrl,
				afterUrl,
				beforeTitle,
				afterTitle
			};
		}
	}

	if (options.waitAfterSubmit === 'navigationComplete') {
		try {
			logger.info('Waiting for complete page navigation after submission');
			await page.waitForNavigation({
				timeout: options.waitTime || 60000,
				waitUntil: ['load', 'networkidle0']
			});

			const afterUrl = page.url();
			const afterTitle = await page.title();

			return {
				success: true,
				urlChanged: afterUrl !== beforeUrl,
				titleChanged: afterTitle !== beforeTitle,
				beforeUrl,
				afterUrl,
				beforeTitle,
				afterTitle,
				navigationCompleted: true
			};
		} catch (error) {
			logger.warn(`Navigation timeout: ${(error as Error).message} - checking page state directly`);

			// Check if page changed despite the timeout
			const afterUrl = page.url();
			const afterTitle = await page.title();

			return {
				success: afterUrl !== beforeUrl || afterTitle !== beforeTitle,
				urlChanged: afterUrl !== beforeUrl,
				titleChanged: afterTitle !== beforeTitle,
				beforeUrl,
				afterUrl,
				beforeTitle,
				afterTitle,
				navigationCompleted: false
			};
		}
	}

	if (options.waitAfterSubmit === 'urlChanged') {
		try {
			logger.info('Waiting for URL change after submission');
			await page.waitForFunction(
				() => window.location.href !== beforeUrl,
				{ timeout: options.waitTime || 15000 }
			);

			const afterUrl = page.url();
			const afterTitle = await page.title();

			return {
				success: true,
				urlChanged: true,
				titleChanged: afterTitle !== beforeTitle,
				beforeUrl,
				afterUrl,
				beforeTitle,
				afterTitle
			};
		} catch (error) {
			logger.warn(`URL change timeout: ${(error as Error).message}`);

			const afterUrl = page.url();
			const afterTitle = await page.title();

			return {
				success: false,
				urlChanged: afterUrl !== beforeUrl,
				titleChanged: afterTitle !== beforeTitle,
				beforeUrl,
				afterUrl,
				beforeTitle,
				afterTitle
			};
		}
	}

	if (options.waitAfterSubmit === 'fixedTime') {
		logger.info(`Using fixed wait time after form submission (${options.waitTime || 5000}ms)`);
		await new Promise(resolve => setTimeout(resolve, options.waitTime || 5000));

		const afterUrl = page.url();
		const afterTitle = await page.title();

		return {
			success: true,
			urlChanged: afterUrl !== beforeUrl,
			titleChanged: afterTitle !== beforeTitle,
			beforeUrl,
			afterUrl,
			beforeTitle,
			afterTitle
		};
	}

	// For noWait, just do a minimal stabilization
	await new Promise(resolve => setTimeout(resolve, 500));

	const afterUrl = page.url();
	const afterTitle = await page.title();

	return {
		success: true,
		urlChanged: afterUrl !== beforeUrl,
		titleChanged: afterTitle !== beforeTitle,
		beforeUrl,
		afterUrl,
		beforeTitle,
		afterTitle
	};
}

/**
 * Handle a password field (with special handling for visibility toggles and clone fields)
 */
export async function handlePasswordField(
	page: Page,
	selector: string,
	value: string,
	options: {
		clearField?: boolean;
		hasCloneField?: boolean;
		cloneSelector?: string;
	},
	logger: ILogger
): Promise<boolean> {
	try {
		// Clear field if requested
		if (options.clearField) {
			logger.debug(`Clearing password field: ${selector}`);
			await page.evaluate((sel: string) => {
				const element = document.querySelector(sel);
				if (element) {
					(element as HTMLInputElement).value = '';
				}
			}, selector);
		}

		// Type the password (mask in logs for security)
		logger.info(`Filling password field: ${selector} (value masked)`);
		await page.type(selector, value);

		// Handle clone field if present (for password toggle visibility)
		if (options.hasCloneField && options.cloneSelector) {
			logger.info(`Checking if clone field exists: ${options.cloneSelector}`);
			const cloneExists = await page.$(options.cloneSelector) !== null;

			if (cloneExists) {
				logger.info(`Found clone field, ensuring values match: ${options.cloneSelector}`);
				await page.evaluate((sel: string, val: string) => {
					const element = document.querySelector(sel);
					if (element) {
						(element as HTMLInputElement).value = val;
						// Trigger events to ensure any validation sees the change
						element.dispatchEvent(new Event('input', { bubbles: true }));
						element.dispatchEvent(new Event('change', { bubbles: true }));
					}
				}, options.cloneSelector, value);
			} else {
				logger.warn(`Clone field not found: ${options.cloneSelector}`);
			}
		}

		return true;
	} catch (error) {
		logger.error(`Error handling password field: ${(error as Error).message}`);
		return false;
	}
}

/**
 * Process a form field based on its type
 */
export async function processFormField(
	page: Page,
	field: IDataObject,
	logger: ILogger
): Promise<{
	success: boolean;
	fieldResult: IDataObject;
}> {
	const fieldType = field.fieldType as string;
	const selector = field.selector as string;

	let fieldSuccess = false;
	let fieldResult: IDataObject = {
		fieldType,
		selector,
		success: false,
	};

	switch (fieldType) {
		case 'text':
		case 'textarea': {
			const value = field.value as string;
			const clearField = field.clearField as boolean;
			const humanLike = field.humanLike as boolean || false;

			fieldSuccess = await fillTextField(
				page,
				selector,
				value,
				{
					clearField,
					humanLike,
					pressEnter: false,
				},
				logger
			);

			fieldResult = {
				fieldType,
				selector,
				value,
				success: fieldSuccess,
			};
			break;
		}

		case 'select': {
			const value = field.value as string;
			const matchType = field.matchType as string || 'exact';
			const fuzzyThreshold = field.fuzzyThreshold as number || 0.5;

			const selectResult = await handleSelectField(
				page,
				selector,
				value,
				{
					matchType: matchType as 'exact' | 'textContains' | 'fuzzy',
					fuzzyThreshold,
				},
				logger
			);

			fieldSuccess = selectResult.success;
			fieldResult = {
				fieldType,
				selector,
				requestedValue: value,
				selectedValue: selectResult.selectedValue,
				selectedText: selectResult.selectedText,
				matchType,
				matchDetails: selectResult.matchDetails,
				success: fieldSuccess,
			};
			break;
		}

		case 'checkbox': {
			const checked = field.checked as boolean;

			fieldSuccess = await handleCheckboxField(
				page,
				selector,
				checked,
				logger
			);

			fieldResult = {
				fieldType,
				selector,
				checked,
				success: fieldSuccess,
			};
			break;
		}

		case 'radio': {
			// For radio buttons, just click to select
			try {
				await page.click(selector);
				fieldSuccess = true;
			} catch (error) {
				logger.error(`Error clicking radio button: ${(error as Error).message}`);
				fieldSuccess = false;
			}

			fieldResult = {
				fieldType,
				selector,
				value: field.value,
				success: fieldSuccess,
			};
			break;
		}

		case 'file': {
			const filePath = field.filePath as string;

			fieldSuccess = await handleFileUpload(
				page,
				selector,
				filePath,
				logger
			);

			fieldResult = {
				fieldType,
				selector,
				filePath,
				success: fieldSuccess,
			};
			break;
		}

		case 'multiSelect': {
			const multiSelectValues = ((field.multiSelectValues as string) || '').split(',').map(v => v.trim()).filter(v => v);

			fieldSuccess = await handleMultiSelectField(
				page,
				selector,
				multiSelectValues,
				logger
			);

			fieldResult = {
				fieldType,
				selector,
				values: multiSelectValues,
				success: fieldSuccess,
			};
			break;
		}

		case 'password': {
			const value = field.value as string;
			const clearField = field.clearField as boolean;
			const hasCloneField = field.hasCloneField as boolean;
			const cloneSelector = field.cloneSelector as string;

			fieldSuccess = await handlePasswordField(
				page,
				selector,
				value,
				{
					clearField,
					hasCloneField,
					cloneSelector,
				},
				logger
			);

			fieldResult = {
				fieldType,
				selector,
				success: fieldSuccess,
			};
			break;
		}

		default:
			logger.warn(`Unsupported field type: ${fieldType}`);
			fieldResult = {
				fieldType,
				selector,
				success: false,
				error: `Unsupported field type: ${fieldType}`,
			};
	}

	return {
		success: fieldSuccess,
		fieldResult,
	};
}

/**
 * Retry form submission if the initial submission doesn't cause a page change
 */
export async function retryFormSubmission(
	page: Page,
	submitSelector: string,
	options: {
		waitAfterSubmit: 'noWait' | 'fixedTime' | 'domContentLoaded' | 'navigationComplete' | 'urlChanged';
		waitTime: number;
		maxRetries: number;
		retryDelay: number;
	},
	logger: ILogger
): Promise<{
	success: boolean;
	finalResult: IDataObject;
	retryResults: IDataObject[];
}> {
	let retryCount = 0;
	let retrySuccess = false;
	const retryResults: IDataObject[] = [];
	let finalResult: IDataObject = {};

	// First attempt
	const initialResult = await submitForm(
		page,
		submitSelector,
		{
			waitAfterSubmit: options.waitAfterSubmit,
			waitTime: options.waitTime,
		},
		logger
	);

	// If first attempt succeeded with a page change, return immediately
	if (initialResult.urlChanged || initialResult.titleChanged) {
		return {
			success: true,
			finalResult: initialResult,
			retryResults: []
		};
	}

	logger.info(`No page change detected, will retry submission up to ${options.maxRetries} times`);

	// Store the initial attempt as our starting point
	finalResult = initialResult;

	// Retry loop
	while (retryCount < options.maxRetries && !retrySuccess) {
		retryCount++;
		logger.info(`Retry attempt ${retryCount}/${options.maxRetries} after ${options.retryDelay}ms delay`);

		// Wait before retrying
		await new Promise(resolve => setTimeout(resolve, options.retryDelay));

		// Try submitting again
		const retrySubmitResult = await submitForm(
			page,
			submitSelector,
			{
				waitAfterSubmit: options.waitAfterSubmit,
				waitTime: options.waitTime,
			},
			logger
		);

		retrySuccess = !!(retrySubmitResult.urlChanged || retrySubmitResult.titleChanged);

		// Create retry result record
		const retryResultRecord = {
			retryAttempt: retryCount,
			success: retrySuccess,
			details: retrySubmitResult
		};

		// Add to retry results collection
		retryResults.push(retryResultRecord);

		if (retrySuccess) {
			logger.info(`Retry ${retryCount} successful`);
			finalResult = retrySubmitResult;
			break;
		}
	}

	if (!retrySuccess) {
		logger.warn(`All ${options.maxRetries} retries failed`);
	}

	return {
		success: retrySuccess,
		finalResult,
		retryResults
	};
}
