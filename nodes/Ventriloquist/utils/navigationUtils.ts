// import type * as puppeteer from 'puppeteer-core';
import type { Page, Browser } from "puppeteer-core";
import type { Logger as ILogger } from "n8n-workflow";
// import { reconnectAfterNavigation } from './sessionUtils';
import { SessionManager } from "./sessionManager";
import { getActivePage } from "./sessionUtils"; // Import the new utility

/**
 * Wait for an element to be visible/active on page with smart detection
 * This is more reliable than the standard waitForSelector when elements might
 * be in the DOM but not yet visible/interactive
 */
export async function smartWaitForSelector(
	page: Page,
	selector: string,
	timeout: number,
	logger: ILogger,
	earlyExitDelay = 500,
): Promise<boolean> {
	const startTime = Date.now();
	logger.info(
		`Smart waiting for selector: ${selector} (timeout: ${timeout}ms)`,
	);

	// Check if already present immediately
	const elementExistsNow = (await page.$(selector)) !== null;
	if (elementExistsNow) {
		// Quick validate if it's also visible
		const isVisible = await page.evaluate((sel) => {
			const element = document.querySelector(sel);
			if (!element) return false;

			const style = window.getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			return (
				style.display !== "none" &&
				style.visibility !== "hidden" &&
				style.opacity !== "0" &&
				rect.width > 0 &&
				rect.height > 0
			);
		}, selector);

		if (isVisible) {
			logger.info(`Element found immediately: ${selector}`);
			return true;
		}
	}

	try {
		// Wait for the element to be present in DOM first
		await page.waitForSelector(selector, { timeout });
		logger.info(`Element exists in DOM: ${selector}`);

		// Then check if it's visible
		const isVisibleAfterWait = await page.evaluate((sel) => {
			const element = document.querySelector(sel);
			if (!element) return false;

			const style = window.getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			return (
				style.display !== "none" &&
				style.visibility !== "hidden" &&
				style.opacity !== "0" &&
				rect.width > 0 &&
				rect.height > 0
			);
		}, selector);

		if (isVisibleAfterWait) {
			logger.info(`Element is visible: ${selector}`);
			return true;
		}

		logger.warn(`Element exists but is not visible: ${selector}`);

		// Add a small delay to see if it becomes visible
		if (earlyExitDelay > 0) {
			logger.info(
				`Waiting ${earlyExitDelay}ms to see if element becomes visible`,
			);
			await new Promise((resolve) => setTimeout(resolve, earlyExitDelay));

			// Check visibility one last time
			const becameVisible = await page.evaluate((sel) => {
				const element = document.querySelector(sel);
				if (!element) return false;

				const style = window.getComputedStyle(element);
				const rect = element.getBoundingClientRect();
				return (
					style.display !== "none" &&
					style.visibility !== "hidden" &&
					style.opacity !== "0" &&
					rect.width > 0 &&
					rect.height > 0
				);
			}, selector);

			if (becameVisible) {
				logger.info(`Element became visible after delay: ${selector}`);
				return true;
			}
		}

		logger.warn(`Element exists but never became visible: ${selector}`);
		return false;
	} catch (error) {
		const timeElapsed = Date.now() - startTime;
		logger.warn(
			`Smart wait failed after ${timeElapsed}ms: ${(error as Error).message}`,
		);
		return false;
	}
}

/**
 * Wait for navigation with advanced options and fallback mechanism
 */
export async function enhancedNavigationWait(
	page: Page,
	waitUntil: "load" | "domcontentloaded" | "networkidle0" | "networkidle2",
	timeout: number,
	logger: ILogger,
	logPrefix = "",
): Promise<boolean> {
	try {
		logger.info(
			`${logPrefix}Waiting for navigation event: ${waitUntil} (timeout: ${timeout}ms)`,
		);

		await page.waitForNavigation({
			waitUntil: [waitUntil],
			timeout,
		});

		logger.info(`${logPrefix}Navigation completed successfully: ${waitUntil}`);
		return true;
	} catch (error) {
		logger.warn(
			`${logPrefix}Navigation wait failed: ${(error as Error).message}`,
		);

		// Fallback: Try to detect if the page changed anyway
		try {
			// Check document readiness
			const documentState = await page.evaluate(() => ({
				readyState: document.readyState,
				url: window.location.href,
				title: document.title,
			}));

			logger.info(
				`${logPrefix}Document state after failed navigation wait: ${JSON.stringify(documentState)}`,
			);

			// If readyState is at least interactive, we consider it a partial success
			if (
				documentState.readyState === "interactive" ||
				documentState.readyState === "complete"
			) {
				logger.info(
					`${logPrefix}Navigation may have completed despite timeout (readyState: ${documentState.readyState})`,
				);
				return true;
			}

			return false;
		} catch (fallbackError) {
			logger.error(
				`${logPrefix}Fallback check also failed: ${(fallbackError as Error).message}`,
			);
			return false;
		}
	}
}

/**
 * Navigate to a URL with retry mechanism
 */
export async function navigateWithRetry(
	page: Page,
	url: string,
	options: {
		waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
		timeout?: number;
		maxRetries?: number;
		retryDelay?: number;
	},
	logger: ILogger,
): Promise<boolean> {
	const waitUntil = options.waitUntil || "domcontentloaded";
	const timeout = options.timeout || 30000;
	const maxRetries = options.maxRetries || 2;
	const retryDelay = options.retryDelay || 1000;

	let retryCount = 0;
	let success = false;

	while (retryCount <= maxRetries && !success) {
		try {
			if (retryCount > 0) {
				logger.info(`Retry ${retryCount}/${maxRetries} navigating to: ${url}`);
				await new Promise((resolve) => setTimeout(resolve, retryDelay));
			} else {
				logger.info(
					`Navigating to: ${url} (waitUntil: ${waitUntil}, timeout: ${timeout}ms)`,
				);
			}

			await page.goto(url, {
				waitUntil: [waitUntil],
				timeout,
			});

			success = true;
			logger.info(`Successfully navigated to: ${url}`);
		} catch (error) {
			retryCount++;

			if (retryCount <= maxRetries) {
				logger.warn(
					`Navigation failed: ${(error as Error).message} - will retry`,
				);
			} else {
				logger.error(
					`Navigation failed after ${maxRetries} retries: ${(error as Error).message}`,
				);
			}
		}
	}

	return success;
}

/**
 * Check if an element exists in the page
 */
export async function elementExists(
	page: Page,
	selector: string,
): Promise<boolean> {
	return (await page.$(selector)) !== null;
}

/**
 * Check if an element is visible on the page
 */
export async function isElementVisible(
	page: Page,
	selector: string,
): Promise<boolean> {
	const element = await page.$(selector);

	if (!element) {
		return false;
	}

	return page.evaluate((sel) => {
		const el = document.querySelector(sel);
		if (!el) return false;

		const style = window.getComputedStyle(el);
		const rect = el.getBoundingClientRect();

		return (
			style.display !== "none" &&
			style.visibility !== "hidden" &&
			style.opacity !== "0" &&
			rect.width > 0 &&
			rect.height > 0
		);
	}, selector);
}

/**
 * Waits for the URL of the active page in a session to change from a given URL.
 * Handles potential page context destruction during navigation.
 *
 * @param sessionId The ID of the browser session.
 * @param initialUrl The URL to detect changes from.
 * @param timeout The maximum time to wait in milliseconds.
 * @param logger The logger instance.
 * @returns A promise that resolves to true if the URL changed, false otherwise.
 */
export async function waitForUrlChange(
	sessionId: string,
	initialUrl: string,
	timeout: number,
	logger: ILogger,
): Promise<boolean> {
	const logPrefix = `[NavigationUtils][waitForUrlChange]`;
	logger.info(`${logPrefix} Called. Waiting for URL to change from: ${initialUrl} (Timeout: ${timeout}ms)`);

	const startTime = Date.now();
	let contextDestroyed = false;
	let pollingDetectedChange = false;
	let raceWinner = 'timeout'; // Default winner

	// Get the browser instance for the session
	const session = SessionManager.getSession(sessionId);
	if (!session || !session.browser || !session.browser.isConnected()) {
		logger.error(`${logPrefix} Invalid session or disconnected browser for session ID: ${sessionId}`);
		return false; // Cannot proceed without a valid browser
	}
	const browser = session.browser;

	// Get the initial active page (might be null if none exists yet)
	let initialPage: Page | null = null;
	try {
		initialPage = await getActivePage(browser, logger);
		if (initialPage) {
			logger.info(`${logPrefix} Initial active page obtained successfully. URL: ${await initialPage.url()}`);
		} else {
			logger.warn(`${logPrefix} No initial active page found for session: ${sessionId}. Will rely on polling.`);
			// If no initial page, we can't rely on context destruction listener for that specific page
		}
	} catch (err) {
		logger.warn(`${logPrefix} Error getting initial active page: ${(err as Error).message}. Proceeding with polling.`);
	}

	// --- Promise Setup ---

	// 1. Timeout Promise
	const timeoutPromise = new Promise<string>((resolve) => {
		setTimeout(() => resolve('timeout'), timeout);
	});

	// 2. Context Destruction Promise (only if initial page exists)
	let contextListenerPromise = new Promise<string>(() => { }); // Non-resolving if no initial page
	if (initialPage) {
		// Ensure initialPage is not null before adding listener
		const pageForListener = initialPage;
		contextListenerPromise = new Promise<string>((resolve) => {
			const listener = () => {
				logger.info(`${logPrefix} Initial page context destroyed.`);
				contextDestroyed = true;
				resolve('context_destroyed');
			};
			// Use the safe reference
			pageForListener.once('close', listener);

			// Cleanup listener if timeout wins
			timeoutPromise.then(() => {
				// Use the safe reference
				pageForListener.off('close', listener);
				logger.debug(`${logPrefix} Context listener removed due to timeout.`);
			});
		});
		logger.info(`${logPrefix} Context destruction listener attached to initial page.`);
	} else {
		logger.info(`${logPrefix} Skipping context destruction listener as no initial page was found.`);
	}


	// 3. Polling Promise
	const pollForUrlChanges = async (pollInterval = 500): Promise<string> => {
		logger.info(`${logPrefix}[Polling] Starting polling.`);
		let elapsed = Date.now() - startTime;
		let iter = 1;

		while (elapsed < timeout) {
			try {
				// IMPORTANT: Always get the *current* active page from the *browser*
				const currentPage = await getActivePage(browser, logger);

				if (!currentPage) {
					logger.warn(`${logPrefix}[Polling][Iter ${iter}] getActivePage returned null. Possible transient state or closed session.`);
					// Optional: If consistently null, maybe stop polling early? For now, continue.
				} else {
					const currentUrlCheck = await currentPage.url();
					logger.debug(`${logPrefix}[Polling][Iter ${iter}] Current active page URL: ${currentUrlCheck}`);

					if (currentUrlCheck !== initialUrl) {
						logger.info(`${logPrefix}[Polling][Iter ${iter}] URL change DETECTED: ${initialUrl} -> ${currentUrlCheck}`);
						pollingDetectedChange = true;
						return 'polling_detected_change'; // Resolve the promise
					}
				}
			} catch (error) {
				// Ignore errors during polling (e.g., page closed transiently), log and continue
				logger.warn(`${logPrefix}[Polling][Iter ${iter}] Error during poll check: ${(error as Error).message}`);
			}

			await new Promise(resolve => setTimeout(resolve, pollInterval));
			elapsed = Date.now() - startTime;
			iter++;
		}

		logger.info(`${logPrefix}[Polling] Polling timed out after ${elapsed}ms without detecting change.`);
		return 'polling_timeout'; // Indicate polling finished without success
	};
	const pollingPromise = pollForUrlChanges();

	// --- Wait for Race ---
	logger.info(`${logPrefix} Starting Promise.race...`);
	try {
		raceWinner = await Promise.race([
			timeoutPromise,
			contextListenerPromise,
			pollingPromise,
		]);
		logger.info(`${logPrefix} Promise.race finished with winner: ${raceWinner}`);
	} catch (raceError) {
		// This shouldn't typically happen if promises resolve with strings, but handle defensively
		logger.error(`${logPrefix} Unexpected error during Promise.race: ${(raceError as Error).message}`);
		raceWinner = 'race_error';
	}


	// --- Final Verification ---
	const navigationSuspected = contextDestroyed || pollingDetectedChange;
	logger.info(`${logPrefix} Navigation suspected based on race result: ${navigationSuspected} (ContextDestroyed: ${contextDestroyed}, PollingDetected: ${pollingDetectedChange})`);

	if (navigationSuspected) {
		const stabilizationDelay = 1000; // Delay to allow the new page state to settle
		logger.info(`${logPrefix} Waiting ${stabilizationDelay}ms for stabilization after suspected navigation...`);
		await new Promise(resolve => setTimeout(resolve, stabilizationDelay));

		logger.info(`${logPrefix} Performing final verification check by iterating through all pages.`);
		let finalUrlVerified = false;
		try {
			const allPages = await browser.pages();
			logger.info(`${logPrefix} Final Check - Found ${allPages.length} pages.`);

			for (const page of allPages) {
				const pageUrl = page.url(); // Get URL for logging early

				// Skip blank pages unless it's the only one (less critical here, focus on changed URL)
				if (pageUrl === 'about:blank' && allPages.length > 1) {
					logger.debug(`${logPrefix} Final Check - Skipping 'about:blank' page.`);
					continue;
				}

				// Check if closed first
				if (page.isClosed()) {
					logger.debug(`${logPrefix} Final Check - Skipping closed page with initial URL: ${pageUrl}`);
					continue;
				}

				// Check responsiveness and get final URL
				try {
					// Use a short timeout for responsiveness check
					await page.evaluate(() => true, { timeout: 500 });
					const currentFinalUrl = await page.url(); // Re-fetch URL after ensuring responsiveness

					logger.info(`${logPrefix} Final Check - Checking Page URL: ${currentFinalUrl}`);
					if (currentFinalUrl !== initialUrl) {
						logger.info(`${logPrefix} Final Check Result: URL CHANGED! (Initial: ${initialUrl}, Final: ${currentFinalUrl})`);
						finalUrlVerified = true;
						break; // Found a changed page, no need to check others
					}
				} catch (pageCheckError) {
					logger.warn(`${logPrefix} Final Check - Page with initial URL ${pageUrl} failed check: ${(pageCheckError as Error).message}. Skipping.`);
					// Continue to the next page implicitly
				}
			} // End of page loop

			if (!finalUrlVerified) {
				logger.warn(`${logPrefix} Final Check - Iterated through all pages, but could not confirm a valid URL change from initial: ${initialUrl}`);
				return false;
			}

			logger.info(`${logPrefix} Confirmed URL change based on iterating pages.`);
			return true;
		} catch (error) {
			logger.error(`${logPrefix} Final Check - Error getting/iterating pages: ${(error as Error).message}`);
			// Error during final check, assume no change confirmed
			return false;
		}
	}

	// If navigation was NOT suspected (e.g., timeout won without other signals, or race error)
	logger.info(`${logPrefix} No navigation suspected or final check failed. Race winner was '${raceWinner}'. Returning false.`);
	return false;
}

/**
 * Take a screenshot of the page
 * @param page - Puppeteer Page
 * @param logger - Logger instance
 */
export async function takeScreenshot(
	page: Page | null,
	logger: ILogger,
): Promise<string | null> {
	if (!page) {
		logger.warn("[takeScreenshot] Cannot take screenshot: page is null");
		return null;
	}

	try {
		const pageUrl = await page.url();
		logger.info(`[takeScreenshot] Attempting to capture screenshot of page: ${pageUrl}`);

		const screenshot = await page.screenshot({
			encoding: "base64",
			fullPage: true,
			type: "jpeg",
			quality: 70,
		});

		if (screenshot && screenshot.length > 0) {
			const result = `data:image/jpeg;base64,${screenshot}`;
			logger.info(`[takeScreenshot] Screenshot captured successfully (${result.length} chars)`);
			return result;
		} else {
			logger.warn(`[takeScreenshot] Screenshot capture failed - this may be due to anti-scraping protection on ${pageUrl}`);
			return null;
		}
	} catch (error) {
		logger.error(`[takeScreenshot] Error taking screenshot: ${(error as Error).message}`);
		logger.error(`[takeScreenshot] Error stack: ${(error as Error).stack}`);
		return null;
	}
}

/**
 * Get page details (title, URL, etc.)
 */
export async function getPageDetails(page: Page): Promise<{
	url: string;
	title: string;
	readyState: string;
	bodyText: string;
}> {
	return page.evaluate(() => ({
		url: window.location.href,
		title: document.title,
		readyState: document.readyState,
		bodyText: document.body?.innerText.slice(0, 500) || "",
	}));
}

/**
 * Format a URL to mask sensitive information (like API tokens)
 */
export function formatUrl(url: string): string {
	if (!url) return "";

	try {
		const urlObj = new URL(url);

		// Mask tokens and API keys in query parameters
		for (const [key, value] of urlObj.searchParams.entries()) {
			if (
				key.toLowerCase().includes("token") ||
				key.toLowerCase().includes("key") ||
				key.toLowerCase().includes("api") ||
				key.toLowerCase().includes("auth") ||
				key.toLowerCase().includes("secret") ||
				key.toLowerCase().includes("password")
			) {
				if (value.length > 4) {
					urlObj.searchParams.set(key, `${value.substring(0, 4)}***`);
				}
			}
		}

		return urlObj.toString();
	} catch (error) {
		// If URL parsing fails, do simple regex-based masking
		return url.replace(
			/([?&](token|key|api|auth|secret|password)=)([^&]+)/gi,
			"$1***",
		);
	}
}

// Ensure INavigationWaitResult interface includes optional newPage
export interface INavigationWaitResult {
	success: boolean;
	finalUrl?: string;
	finalTitle?: string;
	newPage?: Page;
	contextDestroyed?: boolean;
	urlChanged?: boolean;
	error?: string;
}

/**
 * Refactored clickAndWaitForNavigation
 */
export async function clickAndWaitForNavigation(
	sessionId: string,
	selector: string,
	options: {
		timeout?: number;
		waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
		logger?: ILogger;
	} = {},
): Promise<INavigationWaitResult> {
	const { timeout = 30000, waitUntil = "load", logger } = options;

	const log = logger || {
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: () => {},
	};
	const logPrefix = "[NavigationUtils][clickAndWaitForNavigation]";
	// log.info(`${logPrefix} Called...`); // Reduced logging

	let initialUrl = "[Unknown]";
	let browser: Browser | null = null;

	try {
		const session = SessionManager.getSession(sessionId);
		if (!session?.browser?.isConnected()) {
			log.error(
				`${logPrefix} Could not get active browser session for ID: ${sessionId}`,
			);
			return {
				success: false,
				error: `Could not get active browser session for ID: ${sessionId}`,
			};
		}
		browser = session.browser;

		const initialPage = await getActivePage(browser, log);
		if (!initialPage) {
			log.warn(`${logPrefix} No initial active page found`);
			return { success: false, error: "No initial active page found" };
		}
		try {
			initialUrl = await initialPage.url();
		} catch {
			/* ignore */
		}
		// log.info(`${logPrefix} Initial URL: ${initialUrl}`); // Reduced logging

		const element = await initialPage.$(selector);
		if (!element) {
			log.warn(`${logPrefix} Element not found: "${selector}"`);
			return { success: false, error: `Element not found: ${selector}` };
		}

		// Event listeners removed for simplicity unless needed for specific debugging

		try {
			// log.info(`${logPrefix} Setting up wait...`); // Reduced logging
			const navigationPromise = initialPage.waitForNavigation({
				waitUntil,
				timeout,
			});
			// log.info(`${logPrefix} Clicking...`); // Reduced logging
			const clickPromise = element.click();
			// log.info(`${logPrefix} Waiting for race...`); // Reduced logging
			await Promise.all([navigationPromise, clickPromise]);
			// log.info(`${logPrefix} Race resolved successfully`); // Reduced logging

			// Aggressive Simplification: Assume success
			log.info(`${logPrefix} Navigation assumed successful after wait.`);
			return {
				success: true,
				finalUrl: "[Unknown - Not Fetched Post-Success]",
				finalTitle: "[Unknown - Not Fetched Post-Success]",
				urlChanged: true,
			};
		} catch (promiseAllError) {
			const err = promiseAllError as Error;
			// log.warn(`${logPrefix} Error caught from race: ${err?.message}`); // Reduced logging
			throw err; // Rethrow to outer catch
		}
	} catch (navigationError) {
		const navErr = navigationError as Error;
		// log.warn(`${logPrefix} Outer catch error: ${navErr.message}`); // Reduced logging

		const isNavRelatedError =
			navErr.message.includes("context was destroyed") ||
			navErr.message.includes("Execution context") ||
			navErr.message.includes("Target closed") ||
			navErr.message.includes("Page crashed!");

		if (isNavRelatedError) {
			// log.info(`${logPrefix} Navigation error detected, attempting reconnection...`); // Reduced logging
			if (!browser?.isConnected()) {
				log.error(`${logPrefix} Cannot reconnect: Browser disconnected`);
				return {
					success: false,
					contextDestroyed: true,
					error: "Cannot reconnect: Browser disconnected",
				};
			}

			try {
				// log.info(`${logPrefix} Finding new active page...`); // Reduced logging
				await new Promise((resolve) => setTimeout(resolve, 1000)); // Shorter delay
				const newPage = await getActivePage(browser, log);
				if (newPage) {
					let finalUrl = "[Unknown]";
					let finalTitle = "[Unknown]";
					try {
						finalUrl = await newPage.url();
					} catch {
						/* ignore */
					}
					try {
						finalTitle = await newPage.title();
					} catch {
						/* ignore */
					}
					// log.info(`${logPrefix} Reconnection success. New URL: ${finalUrl}`); // Reduced logging
					return {
						success: true,
						contextDestroyed: true,
						finalUrl,
						finalTitle,
						urlChanged:
							finalUrl !== initialUrl && !finalUrl.startsWith("[Unknown"),
						newPage: newPage,
					};
				}
				// log.warn(`${logPrefix} Reconnect failed: No active page found.`); // Reduced logging
				return {
					success: true,
					contextDestroyed: true,
					error: "Reconnection failed: No active page found",
					urlChanged: true,
				};
			} catch (reconnectError) {
				// Catch errors specifically from the getActivePage call during reconnect
				log.error(
					`${logPrefix} Error during page retrieval in reconnection: ${(reconnectError as Error).message}`,
				);
				return {
					success: false,
					contextDestroyed: true,
					error: `Reconnection page retrieval failed: ${(reconnectError as Error).message}`,
				};
			}
		} else {
			// Handle errors that are not navigation-related (e.g., initial element finding failed)
			log.error(
				`${logPrefix} Unhandled non-navigation error: ${navErr.message}`,
			);
			return {
				success: false,
				error: navErr.message,
				urlChanged: false,
			};
		}
	}
}

/**
 * Submit a form and wait for navigation
 */
export async function submitFormAndWaitForNavigation(
	sessionId: string,
	options: {
		selector?: string;
		timeout?: number;
		waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
		pressEnter?: boolean;
		logger?: ILogger;
	} = {},
): Promise<INavigationWaitResult> {
	const {
		selector,
		timeout = 30000,
		waitUntil = "load",
		pressEnter = false,
		logger,
	} = options;

	const log = logger || {
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: () => {},
	};
	const logPrefix = "[NavigationUtils][submitFormAndWaitForNavigation]";

	let initialUrl = "[Unknown]";
	let browser: Browser | null = null;

	try {
		const session = SessionManager.getSession(sessionId);
		if (!session?.browser?.isConnected()) {
			log.error(
				`${logPrefix} Could not get active browser session for ID: ${sessionId}`,
			);
			return {
				success: false,
				error: `Could not get active browser session for ID: ${sessionId}`,
			};
		}
		browser = session.browser;

		const initialPage = await getActivePage(browser, log);
		if (!initialPage) {
			log.warn(`${logPrefix} No initial active page found`);
			return { success: false, error: "No initial active page found" };
		}

		try {
			initialUrl = await initialPage.url();
		} catch {
			/* ignore */
		}

		// Form submission method
		if (pressEnter) {
			// Using keyboard Enter key to submit
			try {
				if (selector) {
					// Focus the element first
					await initialPage.focus(selector);
				}

				// Set up navigation promise
				const navigationPromise = initialPage.waitForNavigation({
					waitUntil,
					timeout,
				});

				// Press Enter
				await initialPage.keyboard.press("Enter");

				// Wait for navigation
				await navigationPromise;

				log.info(
					`${logPrefix} Form submitted via Enter key and navigation completed`,
				);
			} catch (error) {
				log.warn(
					`${logPrefix} Error during form submission with Enter: ${(error as Error).message}`,
				);
				throw error;
			}
		} else {
			// Using form submit method
			try {
				// Set up navigation promise
				const navigationPromise = initialPage.waitForNavigation({
					waitUntil,
					timeout,
				});

				// Submit the form
				if (selector) {
					await initialPage.evaluate((sel) => {
						const form = document.querySelector(sel) as HTMLFormElement;
						if (form) {
							form.submit();
						} else {
							throw new Error(`Form element not found with selector: ${sel}`);
						}
					}, selector);
				} else {
					// Submit the active form
					await initialPage.evaluate(() => {
						const activeElement = document.activeElement as HTMLFormElement;
						const form = activeElement.closest("form");
						if (form) {
							form.submit();
						} else {
							throw new Error("No active form found");
						}
					});
				}

				// Wait for navigation
				await navigationPromise;

				log.info(
					`${logPrefix} Form submitted via form.submit() and navigation completed`,
				);
			} catch (error) {
				log.warn(
					`${logPrefix} Error during form submission: ${(error as Error).message}`,
				);
				throw error;
			}
		}

		// Similar reconnection logic to clickAndWaitForNavigation
		log.info(`${logPrefix} Navigation succeeded`);

		try {
			const newPage = await getActivePage(browser, log);
			if (newPage) {
				let finalUrl = "[Unknown]";
				let finalTitle = "[Unknown]";
				try {
					finalUrl = await newPage.url();
				} catch {
					/* ignore */
				}
				try {
					finalTitle = await newPage.title();
				} catch {
					/* ignore */
				}
				return {
					success: true,
					finalUrl,
					finalTitle,
					urlChanged:
						finalUrl !== initialUrl && !finalUrl.startsWith("[Unknown"),
					newPage: newPage,
				};
			}

			log.warn(`${logPrefix} No active page found after navigation.`);
			return {
				success: true,
				contextDestroyed: true,
				error: "No active page found after navigation",
				urlChanged: true,
			};
		} catch (reconnectError) {
			log.error(
				`${logPrefix} Error during page retrieval after navigation: ${(reconnectError as Error).message}`,
			);
			return {
				success: false,
				contextDestroyed: true,
				error: `Reconnection page retrieval failed: ${(reconnectError as Error).message}`,
			};
		}
	} catch (navigationError) {
		const navErr = navigationError as Error;
		log.warn(`${logPrefix} Navigation error: ${navErr.message}`);

		const isNavRelatedError =
			navErr.message.includes("context was destroyed") ||
			navErr.message.includes("Execution context") ||
			navErr.message.includes("Target closed") ||
			navErr.message.includes("Page crashed!");

		if (isNavRelatedError) {
			log.info(
				`${logPrefix} Navigation-related error detected, attempting reconnection...`,
			);
			if (!browser?.isConnected()) {
				log.error(`${logPrefix} Cannot reconnect: Browser disconnected`);
				return {
					success: false,
					contextDestroyed: true,
					error: "Cannot reconnect: Browser disconnected",
				};
			}

			try {
				await new Promise((resolve) => setTimeout(resolve, 1000));
				const newPage = await getActivePage(browser, log);
				if (newPage) {
					let finalUrl = "[Unknown]";
					let finalTitle = "[Unknown]";
					try {
						finalUrl = await newPage.url();
					} catch {
						/* ignore */
					}
					try {
						finalTitle = await newPage.title();
					} catch {
						/* ignore */
					}

					return {
						success: true,
						contextDestroyed: true,
						finalUrl,
						finalTitle,
						urlChanged:
							finalUrl !== initialUrl && !finalUrl.startsWith("[Unknown"),
						newPage: newPage,
					};
				}

				return {
					success: true,
					contextDestroyed: true,
					error: "Reconnection failed: No active page found",
					urlChanged: true,
				};
			} catch (reconnectError) {
				log.error(
					`${logPrefix} Error during page retrieval in reconnection: ${(reconnectError as Error).message}`,
				);
				return {
					success: false,
					contextDestroyed: true,
					error: `Reconnection page retrieval failed: ${(reconnectError as Error).message}`,
				};
			}
		} else {
			log.error(
				`${logPrefix} Unhandled non-navigation error: ${navErr.message}`,
			);
			return {
				success: false,
				error: navErr.message,
				urlChanged: false,
			};
		}
	}
}

/**
 * Transform URL based on transformation type and current page context
 */
export function transformUrl(
	url: string,
	transformationType: string,
	currentPageUrl: string,
	options?: {
		replaceFrom?: string;
		replaceTo?: string;
	}
): string {
	if (!url) return '';

	switch (transformationType) {
		case 'absolute':
			return getAbsoluteUrl(url, currentPageUrl);
		case 'addDomain':
			return addDomainToUrl(url, currentPageUrl);
		case 'replace':
			return replaceInUrl(url, options?.replaceFrom || '', options?.replaceTo || '');
		default:
			return url;
	}
}

/**
 * Convert relative URL to absolute URL using current page context
 */
export function getAbsoluteUrl(url: string, currentPageUrl: string): string {
	try {
		return new URL(url, currentPageUrl).href;
	} catch {
		return url;
	}
}

/**
 * Add domain to URLs that start with '/'
 */
export function addDomainToUrl(url: string, currentPageUrl: string): string {
	if (url.startsWith('/')) {
		try {
			const baseUrl = new URL(currentPageUrl);
			return `${baseUrl.origin}${url}`;
		} catch {
			return url;
		}
	}
	return url;
}

/**
 * Replace part of URL with another string
 */
export function replaceInUrl(url: string, replaceFrom: string, replaceTo: string): string {
	if (!replaceFrom) return url;
	return url.replace(new RegExp(replaceFrom, 'g'), replaceTo);
}

/**
 * Check if URL has a supported file format
 */
export function isSupportedImageFormat(url: string, supportedFormats: string[]): boolean {
	if (!url || !supportedFormats?.length) return false;

	const extension = getFileExtensionFromUrl(url);

	// If we found a file extension, check it against supported formats
	if (extension) {
		return supportedFormats.some(format =>
			format.toLowerCase() === extension.toLowerCase() ||
			(format === 'jpg' && extension.toLowerCase() === 'jpeg')
		);
	}

	// If no extension found, check for common image handler patterns
	// These are dynamic URLs that serve images but don't have file extensions
	const imageHandlerPatterns = [
		/imageviewer/i,
		/image\.aspx/i,
		/image\.ashx/i,
		/viewerhandler/i,
		/solutionviewer/i,
		/documentviewer/i,
		/getimage/i,
		/showimage/i,
		/renderimage/i,
		/thumbnail/i,
		/preview/i,
		/download.*image/i,
		/image.*handler/i,
		/viewer.*handler/i
	];

	// Check if URL matches any known image handler patterns
	const isImageHandler = imageHandlerPatterns.some(pattern => pattern.test(url));

	if (isImageHandler) {
		// For image handlers, we assume they can serve common formats
		// Return true if any of the basic image formats are supported
		const basicFormats = ['jpg', 'png', 'gif', 'pdf'];
		return basicFormats.some(format => supportedFormats.includes(format));
	}

	// If no extension and no handler pattern, reject
	return false;
}

/**
 * Extract file extension from URL
 */
export function getFileExtensionFromUrl(url: string): string | null {
	try {
		const urlObj = new URL(url);
		const pathname = urlObj.pathname;
		const lastDot = pathname.lastIndexOf('.');

		if (lastDot === -1) return null;

		const extension = pathname.slice(lastDot + 1);
		// Remove query parameters and fragments if they exist
		return extension.split('?')[0].split('#')[0];
	} catch {
		// Fallback for malformed URLs
		const lastDot = url.lastIndexOf('.');
		if (lastDot === -1) return null;

		const extension = url.slice(lastDot + 1);
		return extension.split('?')[0].split('#')[0];
	}
}
