import type { Page, ElementHandle } from "puppeteer-core";
import type { IDataObject } from "n8n-workflow";
import { robustClick } from "./clickOperations";
import { SessionManager } from "./sessionManager";
import { getActivePage } from "./sessionUtils";

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
export async function ensureElementInViewport(
	page: Page,
	selector: string,
): Promise<boolean> {
	try {
		return await page.evaluate((sel) => {
			const element = document.querySelector(sel);
			if (!element) return false;

			// Check if element is already in viewport
			const rect = element.getBoundingClientRect();
			const isInViewport =
				rect.top >= 0 &&
				rect.left >= 0 &&
				rect.bottom <=
					(window.innerHeight || document.documentElement.clientHeight) &&
				rect.right <=
					(window.innerWidth || document.documentElement.clientWidth);

			// If already in viewport, no need to scroll
			if (isInViewport) return true;

			// Scroll the element into view with smooth behavior
			element.scrollIntoView({
				behavior: "smooth",
				block: "center",
				inline: "center",
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
export async function robustButtonClick(
	page: Page,
	selector: string,
	logger: ILogger,
): Promise<boolean> {
	// Use the more robust robustClick utility
	const result = await robustClick(page, selector, { logger });
	return result.success;
}

/**
 * Calculate simple string similarity (Levenshtein distance based)
 */
export function calculateSimilarity(str1: string, str2: string): number {
	const track = Array(str2.length + 1)
		.fill(null)
		.map(() => Array(str1.length + 1).fill(null));

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
export function findBestMatch(
	target: string,
	options: Array<{ value: string; text: string }>,
): {
	bestMatch: { value: string; text: string; rating: number };
	bestMatchIndex: number;
} {
	const targetLower = target.toLowerCase();
	const ratings = options.map((option) => ({
		value: option.value,
		text: option.text,
		rating: calculateSimilarity(targetLower, option.text.toLowerCase()),
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
		bestMatchIndex,
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
	logger: ILogger,
): Promise<boolean> {
	try {
		// Clear field if requested
		if (options.clearField) {
			logger.debug(`Clearing field contents before filling: ${selector}`);
			await page.evaluate((sel: string) => {
				const element = document.querySelector(sel);
				if (element) {
					(element as HTMLInputElement).value = "";
				}
			}, selector);
		}

		logger.info(
			`Filling text field: ${selector} with value: ${value} (human-like: ${options.humanLike})`,
		);

		// Type text with either human-like typing or direct typing
		if (options.humanLike) {
			// Character-by-character typing with variable delays
			for (const char of value) {
				await page.type(selector, char, {
					delay: Math.floor(Math.random() * 150) + 25,
				});
			}
		} else {
			// Direct input without character delays
			await page.type(selector, value, { delay: 0 });
		}

		// Press Enter if requested
		if (options.pressEnter) {
			await page.keyboard.press("Enter");
		}

		return true;
	} catch (error) {
		logger.error(`Error filling text field: ${(error as Error).message}`);

		// Try fallback method using evaluate
		try {
			logger.info(`Trying fallback method for filling: ${selector}`);
			await page.evaluate(
				(sel, val) => {
					const element = document.querySelector(sel);
					if (
						element &&
						(element instanceof HTMLInputElement ||
							element instanceof HTMLTextAreaElement)
					) {
						element.value = val;
						element.dispatchEvent(new Event("input", { bubbles: true }));
						element.dispatchEvent(new Event("change", { bubbles: true }));
					}
				},
				selector,
				value,
			);

			return true;
		} catch (fallbackError) {
			logger.error(
				`Fallback method also failed: ${(fallbackError as Error).message}`,
			);
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
		matchType: "exact" | "textContains" | "fuzzy";
		fuzzyThreshold?: number;
	},
	logger: ILogger,
): Promise<{
	success: boolean;
	selectedValue?: string;
	selectedText?: string;
	matchDetails?: string;
}> {
	try {
		if (options.matchType === "exact") {
			// Simple exact value match
			await page.select(selector, value);

			// Try to get the text for this value
			let selectedText = "";
			try {
				selectedText = await page.$eval(
					`${selector} option[value="${value}"]`,
					(el) => (el as HTMLOptionElement).textContent || "",
				);
			} catch {
				// If we can't get the text, just leave it blank
			}

			return {
				success: true,
				selectedValue: value,
				selectedText,
				matchDetails: "exact match",
			};
		}

		// Get all options from the dropdown
		const dropdownOptions = await page.$$eval(
			`${selector} option`,
			(options: Element[]) => {
				return options.map((option: Element) => ({
					value: (option as HTMLOptionElement).value,
					text: option.textContent?.trim() || "",
				}));
			},
		);

		if (dropdownOptions.length === 0) {
			throw new Error(`No options found in dropdown: ${selector}`);
		}

		if (options.matchType === "textContains") {
			// Find first option containing the text
			const matchingOption = dropdownOptions.find((option) =>
				option.text.toLowerCase().includes(value.toLowerCase()),
			);

			if (!matchingOption) {
				throw new Error(
					`No option with text containing "${value}" found in dropdown: ${selector}`,
				);
			}

			await page.select(selector, matchingOption.value);

			return {
				success: true,
				selectedValue: matchingOption.value,
				selectedText: matchingOption.text,
				matchDetails: `text contains match: "${value}" → "${matchingOption.text}"`,
			};
		}

		// Fuzzy matching
		const threshold = options.fuzzyThreshold || 0.5;
		const bestMatch = findBestMatch(value, dropdownOptions);

		if (bestMatch.bestMatch.rating < threshold) {
			throw new Error(
				`No close matches found for "${value}" in dropdown: ${selector} ` +
					`(best match: "${bestMatch.bestMatch.text}" with score: ${bestMatch.bestMatch.rating.toFixed(2)})`,
			);
		}

		await page.select(selector, bestMatch.bestMatch.value);

		return {
			success: true,
			selectedValue: bestMatch.bestMatch.value,
			selectedText: bestMatch.bestMatch.text,
			matchDetails: `fuzzy match: "${value}" → "${bestMatch.bestMatch.text}" (score: ${bestMatch.bestMatch.rating.toFixed(2)})`,
		};
	} catch (error) {
		logger.error(`Error handling select field: ${(error as Error).message}`);
		return { success: false };
	}
}

/**
 * Handle checkbox fields with direct DOM manipulation
 */
export async function handleCheckboxField(
	page: Page,
	selector: string,
	checked: boolean,
	logger: ILogger,
): Promise<boolean> {
	try {
		logger.info(`Setting checkbox ${selector} to ${checked}`);

		// Try using the click approach first for more natural interaction
		try {
			// Get current checked state
			const currentlyChecked = await page.$eval(
				selector,
				(el) => (el as HTMLInputElement).checked
			);

			// Only click if we need to change the state
			if (currentlyChecked !== checked) {
				logger.debug(`Current checkbox state: ${currentlyChecked}, desired: ${checked}, clicking to toggle`);

				// First ensure the element is visible and in viewport
				await ensureElementInViewport(page, selector);

				// Try to click the checkbox (this simulates user interaction better)
				await page.click(selector);

				// Verify the state changed as expected
				const newState = await page.$eval(
					selector,
					(el) => (el as HTMLInputElement).checked
				);

				if (newState === checked) {
					logger.info(`Successfully toggled checkbox state by clicking: ${selector}`);

					// Trigger additional events to ensure form validation runs
					await page.evaluate((sel) => {
						const element = document.querySelector(sel);
						if (element) {
							// Dispatch additional events to ensure form validation runs
							element.dispatchEvent(new Event("input", { bubbles: true }));
							element.dispatchEvent(new Event("change", { bubbles: true }));
						}
					}, selector);

					return true;
				}

				logger.warn(`Click did not change checkbox state as expected, falling back to DOM method`);
			} else {
				logger.debug(`Checkbox already in desired state (${checked}), no action needed`);

				// Even though the state is already correct, trigger events to ensure form validation runs
				await page.evaluate((sel) => {
					const element = document.querySelector(sel);
					if (element) {
						// Dispatch events to ensure form validation runs
						element.dispatchEvent(new Event("input", { bubbles: true }));
						element.dispatchEvent(new Event("change", { bubbles: true }));
					}
				}, selector);

				return true;
			}
		} catch (clickError) {
			logger.warn(`Could not use click method: ${(clickError as Error).message}, using DOM method`);
		}

		// If click method failed or wasn't appropriate, use direct DOM manipulation with comprehensive event triggering
		const result = await page.evaluate(
			(sel, shouldBeChecked) => {
				// Try to find the element first
				const element = document.querySelector(sel);
				if (!element) return { success: false, error: "Element not found" };

				try {
					// Create an event sequence that mimics real user interaction as closely as possible

					// 1. Focus the element
					element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
					element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

					// 2. Mouse interaction events
					element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
					element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
					element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

					// 3. Force the checked state directly
					(element as HTMLInputElement).checked = shouldBeChecked;

					// 4. Complete mouse interaction
					element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
					element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
					element.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
					element.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

					// 5. Input and change events (critical for form validation)
					element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
					element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));

					// 6. Blur events
					element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
					element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

					// 7. Additional framework-specific events
					if (typeof CustomEvent === 'function') {
						// For React-style synthetic events
						element.dispatchEvent(new CustomEvent('input', {
							bubbles: true,
							cancelable: true,
							detail: {
								isCheckbox: true,
								value: shouldBeChecked,
								target: element
							}
						}));

						// For Angular-style events
						document.dispatchEvent(new CustomEvent('input', { bubbles: true }));
						document.dispatchEvent(new CustomEvent('change', { bubbles: true }));

						// For Vue-style events
						element.dispatchEvent(new CustomEvent('update:modelValue', {
							bubbles: true,
							detail: { value: shouldBeChecked }
						}));
					}

					// 8. Try to find and trigger any form validation
					try {
						// Find closest form
						const form = element.closest('form');
						if (form) {
							// Dispatch form input event
							form.dispatchEvent(new Event('input', { bubbles: true }));
							// Look for form validation methods
							const formEl = form as any;
							if (typeof formEl.checkValidity === 'function') {
								formEl.checkValidity();
							}
						}
					} catch (validationErr) {
						// Just log the error but continue
						console.error('Form validation trigger error:', validationErr);
					}

					return {
						success: true,
						finalCheckedState: (element as HTMLInputElement).checked
					};
				} catch (err) {
					return {
						success: false,
						error: err instanceof Error ? err.message : String(err),
					};
				}
			},
			selector,
			checked,
		);

		if (!result || !result.success) {
			logger.error(`Failed to set checkbox state: ${JSON.stringify(result)}`);
			return false;
		}

		logger.info(`Successfully set checkbox ${selector} to ${checked} (final state: ${result.finalCheckedState})`);
		return true;
	} catch (error) {
		logger.error(`Error handling checkbox: ${(error as Error).message}`);
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
	logger: ILogger,
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
	logger: ILogger,
): Promise<boolean> {
	try {
		// Check if this is a multiple select element
		const isMultipleSelect = await page.$eval(
			selector,
			(el) => (el as HTMLSelectElement).multiple,
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
				`${selector} *:has-text("${value}") input[type="checkbox"]`, // Any element with text
			];

			let clicked = false;

			// Try each selector pattern
			for (const possibleSelector of possibleSelectors) {
				try {
					const exists = (await page.$(possibleSelector)) !== null;
					if (exists) {
						const clickResult = await robustClick(page, possibleSelector, {
							logger,
						});
						if (clickResult.success) {
							logger.info(
								`Clicked multi-select option: ${value} with selector: ${possibleSelector}`,
							);
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
				logger.warn(
					`Could not find clickable element for multi-select value: ${value}`,
				);
			}
		}

		return successCount > 0;
	} catch (error) {
		logger.error(
			`Error handling multi-select field: ${(error as Error).message}`,
		);
		return false;
	}
}

/**
 * Submit a form and wait for the result based on specified wait type
 */
export async function submitForm(
	sessionId: string,
	submitSelector: string,
	options: {
		waitAfterSubmit:
			| "noWait"
			| "fixedTime"
			| "domContentLoaded"
			| "navigationComplete"
			| "urlChanged";
		waitTime?: number;
	},
	logger: ILogger,
): Promise<{
	success: boolean;
	urlChanged?: boolean;
	titleChanged?: boolean;
	beforeUrl?: string;
	afterUrl?: string;
	beforeTitle?: string;
	afterTitle?: string;
	navigationCompleted?: boolean;
	pageReconnected?: boolean;
	reconnectedPage?: Page;
	error?: string;
}> {
	const session = SessionManager.getSession(sessionId);
	if (!session?.browser?.isConnected()) {
		logger.error(
			`submitForm: Invalid or disconnected browser session: ${sessionId}`,
		);
		return {
			success: false,
			error: `Invalid or disconnected browser session: ${sessionId}`,
		};
	}
	const browser = session.browser;

	let currentPage: Page | null = null;
	let reconnectedPage: Page | null = null;
	let contextDestroyed = false;
	let beforeUrl = "[Unknown]";
	let beforeTitle = "[Unknown]";
	let pageUsedForClick: Page | null = null;

	try {
		currentPage = await getActivePage(browser, logger);
		if (!currentPage) {
			throw new Error("Could not get active page before form submission");
		}
		pageUsedForClick = currentPage;
		beforeUrl = await currentPage.url();
		beforeTitle = await currentPage.title();
		logger.info(
			`Current page before submission - URL: ${beforeUrl}, Title: ${beforeTitle}`,
		);
	} catch (error) {
		logger.error(
			`Error getting initial page state: ${(error as Error).message}`,
		);
		return {
			success: false,
			error: `Error getting initial page state: ${(error as Error).message}`,
		};
	}

	if (!currentPage) {
		logger.error("submitForm: Logic error - currentPage is null unexpectedly.");
		return { success: false, error: "Logic error - currentPage became null." };
	}

	await ensureElementInViewport(currentPage, submitSelector);

	if (!pageUsedForClick) {
		logger.error("Cannot click submit button: page object lost before click");
		return {
			success: false,
			error: "Cannot click submit button: page object lost before click",
			beforeUrl,
			beforeTitle,
		};
	}
	const clickResult = await robustButtonClick(
		pageUsedForClick,
		submitSelector,
		logger,
	);

	if (!clickResult) {
		logger.error("Failed to click submit button");
		return {
			success: false,
			error: "Failed to click submit button",
			beforeUrl,
			afterUrl: beforeUrl,
			beforeTitle,
			afterTitle: beforeTitle,
			urlChanged: false,
			titleChanged: false,
		};
	}

	// --- Waiting Logic ---
	let navigationSucceeded = false;
	let finalUrl = beforeUrl;
	let finalTitle = beforeTitle;
	let navigationCompletedFlag = false;

	try {
		if (options.waitAfterSubmit === "domContentLoaded") {
			logger.info("Waiting for page content to load after submission");
			if (!pageUsedForClick)
				throw new Error("Original page lost before waitForNavigation");
			await pageUsedForClick.waitForNavigation({
				timeout: options.waitTime || 30000,
				waitUntil: ["domcontentloaded"],
			});
			navigationSucceeded = true;
			navigationCompletedFlag = true;
		} else if (options.waitAfterSubmit === "navigationComplete") {
			logger.info("Waiting for complete page navigation after submission");
			if (!pageUsedForClick)
				throw new Error("Original page lost before waitForNavigation");
			await pageUsedForClick.waitForNavigation({
				timeout: options.waitTime || 60000,
				waitUntil: ["load", "networkidle0"],
			});
			navigationSucceeded = true;
			navigationCompletedFlag = true;
		} else if (options.waitAfterSubmit === "urlChanged") {
			logger.info("Waiting for URL change after submission");
			await new Promise((resolve) => setTimeout(resolve, 1000));
			const pageToWaitFor = await getActivePage(browser, logger);
			if (!pageToWaitFor) {
				logger.warn("Lost active page immediately after click...");
				contextDestroyed = true;
				await new Promise((resolve) => setTimeout(resolve, 3000));
				reconnectedPage = await getActivePage(browser, logger);
			} else {
				await pageToWaitFor.waitForFunction(
					(initialUrl: string) => {
						try {
							return window.location.href !== initialUrl;
						} catch {
							return true;
						}
					},
					{ timeout: options.waitTime || 15000 },
					beforeUrl,
				);
				navigationSucceeded = true;
				reconnectedPage = await getActivePage(browser, logger);
			}
			navigationCompletedFlag = false;
		} else if (options.waitAfterSubmit === "fixedTime") {
			logger.info(`Using fixed wait time...`);
			await new Promise((resolve) =>
				setTimeout(resolve, options.waitTime || 5000),
			);
			navigationSucceeded = true;
			navigationCompletedFlag = false;
			reconnectedPage = await getActivePage(browser, logger);
		} else {
			await new Promise((resolve) => setTimeout(resolve, 500));
			navigationSucceeded = true;
			navigationCompletedFlag = false;
			reconnectedPage = await getActivePage(browser, logger);
		}
	} catch (waitError) {
		const error = waitError as Error;
		logger.warn(`Navigation/Wait error: ${error.message}`);
		if (
			error.message.includes("context was destroyed") ||
			error.message.includes("Execution context") ||
			error.message.includes("Target closed") ||
			error.message.includes("Page crashed!")
		) {
			contextDestroyed = true;
			logger.info(
				"Context destruction detected during wait - attempting reconnect",
			);
			await new Promise((resolve) => setTimeout(resolve, 5000));
			try {
				reconnectedPage = await getActivePage(browser, logger);
				if (reconnectedPage)
					logger.info("Reconnected successfully after context destruction.");
				else logger.warn("Failed to reconnect after context destruction.");
			} catch (reconnectError) {
				logger.warn(
					`Reconnection attempt failed: ${(reconnectError as Error).message}`,
				);
				reconnectedPage = null;
			}
			navigationSucceeded = true;
			navigationCompletedFlag = false;
		} else {
			navigationSucceeded = false;
			navigationCompletedFlag = false;
			logger.warn("Wait timed out or failed without context destruction.");
			try {
				reconnectedPage = await getActivePage(browser, logger);
			} catch {
				/* Ignore */
			}
		}
	}

	// --- Final State Check ---
	const finalActivePage =
		reconnectedPage || (contextDestroyed ? null : pageUsedForClick);

	try {
		if (finalActivePage) {
			finalUrl = await finalActivePage.url();
			finalTitle = await finalActivePage.title();
		} else if (contextDestroyed) {
			finalUrl = "Unknown - context destroyed";
			finalTitle = "Unknown - context destroyed";
			navigationSucceeded = true;
		} else {
			finalUrl = "Unknown - page unavailable";
			finalTitle = "Unknown - page unavailable";
			navigationSucceeded = false;
		}
	} catch (stateError) {
		logger.warn(
			`Error getting final page state: ${(stateError as Error).message}`,
		);
		if (contextDestroyed) {
			finalUrl = "Unknown - context destroyed";
			finalTitle = "Unknown - context destroyed";
			navigationSucceeded = true;
		} else {
			finalUrl = beforeUrl;
			finalTitle = beforeTitle;
			navigationSucceeded = false;
		}
	}

	return {
		success: navigationSucceeded,
		urlChanged: finalUrl !== beforeUrl && !finalUrl.startsWith("Unknown"),
		titleChanged:
			finalTitle !== beforeTitle && !finalTitle.startsWith("Unknown"),
		beforeUrl,
		afterUrl: finalUrl,
		beforeTitle,
		afterTitle: finalTitle,
		navigationCompleted: navigationCompletedFlag && navigationSucceeded,
		pageReconnected: !!reconnectedPage,
		reconnectedPage: reconnectedPage || undefined,
		error: !navigationSucceeded ? "Navigation or wait failed" : undefined,
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
	logger: ILogger,
): Promise<boolean> {
	try {
		// Clear field if requested
		if (options.clearField) {
			logger.debug(`Clearing password field: ${selector}`);
			await page.evaluate((sel: string) => {
				const element = document.querySelector(sel);
				if (element) {
					(element as HTMLInputElement).value = "";
				}
			}, selector);
		}

		// Type the password (mask in logs for security)
		logger.info(`Filling password field: ${selector} (value masked)`);
		await page.type(selector, value);

		// Handle clone field if present (for password toggle visibility)
		if (options.hasCloneField && options.cloneSelector) {
			logger.info(`Checking if clone field exists: ${options.cloneSelector}`);
			const cloneExists = (await page.$(options.cloneSelector)) !== null;

			if (cloneExists) {
				logger.info(
					`Found clone field, ensuring values match: ${options.cloneSelector}`,
				);
				await page.evaluate(
					(sel: string, val: string) => {
						const element = document.querySelector(sel);
						if (element) {
							(element as HTMLInputElement).value = val;
							// Trigger events to ensure any validation sees the change
							element.dispatchEvent(new Event("input", { bubbles: true }));
							element.dispatchEvent(new Event("change", { bubbles: true }));
						}
					},
					options.cloneSelector,
					value,
				);
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
	logger: ILogger,
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
		case "text":
		case "textarea": {
			const value = field.value as string;
			const clearField = field.clearField as boolean;
			const humanLike = (field.humanLike as boolean) || false;

			fieldSuccess = await fillTextField(
				page,
				selector,
				value,
				{
					clearField,
					humanLike,
					pressEnter: false,
				},
				logger,
			);

			fieldResult = {
				fieldType,
				selector,
				value,
				success: fieldSuccess,
			};
			break;
		}

		case "select": {
			const value = field.value as string;
			const matchType = (field.matchType as string) || "exact";
			const fuzzyThreshold = (field.fuzzyThreshold as number) || 0.5;

			const selectResult = await handleSelectField(
				page,
				selector,
				value,
				{
					matchType: matchType as "exact" | "textContains" | "fuzzy",
					fuzzyThreshold,
				},
				logger,
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

		case "checkbox": {
			const checked = field.checked as boolean;

			fieldSuccess = await handleCheckboxField(page, selector, checked, logger);

			fieldResult = {
				fieldType,
				selector,
				checked,
				success: fieldSuccess,
			};
			break;
		}

		case "radio": {
			// For radio buttons, just click to select
			try {
				await page.click(selector);
				fieldSuccess = true;
			} catch (error) {
				logger.error(
					`Error clicking radio button: ${(error as Error).message}`,
				);
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

		case "file": {
			const filePath = field.filePath as string;

			fieldSuccess = await handleFileUpload(page, selector, filePath, logger);

			fieldResult = {
				fieldType,
				selector,
				filePath,
				success: fieldSuccess,
			};
			break;
		}

		case "multiSelect": {
			const multiSelectValues = ((field.multiSelectValues as string) || "")
				.split(",")
				.map((v) => v.trim())
				.filter((v) => v);

			fieldSuccess = await handleMultiSelectField(
				page,
				selector,
				multiSelectValues,
				logger,
			);

			fieldResult = {
				fieldType,
				selector,
				values: multiSelectValues,
				success: fieldSuccess,
			};
			break;
		}

		case "password": {
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
				logger,
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
	sessionId: string,
	submitSelector: string,
	options: {
		waitAfterSubmit:
			| "noWait"
			| "fixedTime"
			| "domContentLoaded"
			| "navigationComplete"
			| "urlChanged";
		waitTime: number;
		maxRetries: number;
		retryDelay: number;
	},
	logger: ILogger,
): Promise<{
	success: boolean;
	finalResult: Awaited<ReturnType<typeof submitForm>>;
	retryResults: IDataObject[];
	reconnectedPage?: Page;
}> {
	let retryCount = 0;
	let retrySuccess = false;
	const retryResults: IDataObject[] = [];
	let finalResult: Awaited<ReturnType<typeof submitForm>> = { success: false };
	let finalReconnectedPage: Page | undefined;

	const initialResult = await submitForm(
		sessionId,
		submitSelector,
		{
			waitAfterSubmit: options.waitAfterSubmit,
			waitTime: options.waitTime,
		},
		logger,
	);
	finalReconnectedPage = initialResult.reconnectedPage;
	finalResult = initialResult;

	if (initialResult.success) {
		return {
			success: true,
			finalResult: initialResult,
			retryResults: [],
			reconnectedPage: initialResult.reconnectedPage,
		};
	}

	logger.info(`Initial submission failed or didn't navigate, retrying...`);

	// Retry loop
	while (retryCount < options.maxRetries && !retrySuccess) {
		retryCount++;
		logger.info(`Retry attempt ${retryCount}/${options.maxRetries}...`);
		await new Promise((resolve) => setTimeout(resolve, options.retryDelay));

		const retrySubmitResult = await submitForm(
			sessionId,
			submitSelector,
			{
				waitAfterSubmit: options.waitAfterSubmit,
				waitTime: options.waitTime,
			},
			logger,
		);
		finalReconnectedPage = retrySubmitResult.reconnectedPage;
		finalResult = retrySubmitResult;

		retrySuccess = retrySubmitResult.success;

		const retryResultRecord = {
			retryAttempt: retryCount,
			success: retrySuccess,
			details: retrySubmitResult,
		};
		retryResults.push(retryResultRecord);

		if (retrySuccess) {
			logger.info(`Retry ${retryCount} successful`);
			break;
		}
	}

	if (!retrySuccess) {
		logger.warn(`All ${options.maxRetries} retries failed`);
	}

	return {
		success: retrySuccess,
		finalResult,
		retryResults,
		reconnectedPage: finalReconnectedPage,
	};
}
