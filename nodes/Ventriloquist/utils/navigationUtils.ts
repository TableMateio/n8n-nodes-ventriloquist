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
 * Wait for a URL change with improved detection of both hard and soft URL changes
 * Refactored to use getActivePage utility.
 */
export async function waitForUrlChange(
	sessionId: string,
	currentUrl: string,
	timeout: number,
	logger: ILogger,
): Promise<boolean> {
	const logPrefix = "[NavigationUtils][waitForUrlChange]";
	logger.info(
		`${logPrefix} Called. Waiting for URL to change from: ${currentUrl} (Timeout: ${timeout}ms)`,
	);

	try {
		const session = SessionManager.getSession(sessionId);
		if (!session?.browser?.isConnected()) {
			logger.error(`${logPrefix} Invalid browser session: ${sessionId}`);
			return false;
		}
		const browser = session.browser;

		const initialPage = await getActivePage(browser, logger);
		if (!initialPage) {
			logger.error(`${logPrefix} No active page found initially: ${sessionId}`);
			return false;
		}
		logger.info(`${logPrefix} Initial active page obtained.`);

		const startTime = Date.now();
		let contextDestroyed = false;

		// --- Polling Function --- //
		const pollForUrlChanges = async (pollInterval = 500): Promise<boolean> => {
			const startPollTime = Date.now();
			let currentPolledUrl = currentUrl;
			let iteration = 0;
			logger.info(`${logPrefix}[Polling] Starting polling.`);
			while (Date.now() - startPollTime < timeout) {
				iteration++;
				try {
					const page = await getActivePage(browser, logger);
					if (!page) {
						logger.warn(
							`${logPrefix}[Polling][Iter ${iteration}] getActivePage returned null. Stopping poll.`,
						);
						return false; // Stop polling if page lost
					}
					await new Promise((resolve) => setTimeout(resolve, pollInterval));
					const newUrl = await page.url();
					// logger.info(`${logPrefix}[Polling][Iter ${iteration}] Current URL: ${newUrl}`); // Verbose
					if (newUrl !== currentUrl) {
						logger.info(
							`${logPrefix}[Polling][Iter ${iteration}] URL change DETECTED: ${currentUrl} -> ${newUrl}`,
						);
						return true; // Change detected
					}
					currentPolledUrl = newUrl;
				} catch (error) {
					const err = error as Error;
					if (
						err.message.includes("context was destroyed") ||
						err.message.includes("Target closed")
					) {
						logger.info(
							`${logPrefix}[Polling][Iter ${iteration}] Context destroyed during poll. Assuming URL changed.`,
						);
						contextDestroyed = true;
						return true; // Context destroyed implies navigation
					}
					logger.warn(
						`${logPrefix}[Polling][Iter ${iteration}] Error polling: ${err.message}`,
					);
				}
			}
			logger.warn(
				`${logPrefix}[Polling] Polling timed out after ${timeout}ms.`,
			);
			return false; // Timeout
		};

		// --- Listener Setup --- //
		const pageForListeners = await getActivePage(browser, logger);
		if (!pageForListeners) {
			logger.warn(
				`${logPrefix} No active page for listeners. Returning contextDestroyed: ${contextDestroyed}`,
			);
			return contextDestroyed;
		}
		logger.info(`${logPrefix} Setting up listeners on page.`);

		logger.info(`${logPrefix} Creating waitForFunction promise.`);
		const waitFunctionPromise = pageForListeners
			.waitForFunction(
				(url: string) => window.location.href !== url,
				{ timeout },
				currentUrl,
			)
			.then(() => {
				logger.info(
					`${logPrefix} waitForFunction promise RESOLVED: URL change detected.`,
				);
				return true;
			})
			.catch((error: Error) => {
				if (
					error.message.includes("context was destroyed") ||
					error.message.includes("Execution context") ||
					error.message.includes("Target closed")
				) {
					contextDestroyed = true;
					logger.info(
						`${logPrefix} waitForFunction promise REJECTED (Context Destroyed): Navigation indicated. ${error.message}`,
					);
					return true; // Treat as success in race
				}
				logger.warn(
					`${logPrefix} waitForFunction promise REJECTED (Error): ${error.message}`,
				);
				return false;
			});

		logger.info(`${logPrefix} Creating polling promise.`);
		const pollingPromise = pollForUrlChanges().then((result) => {
			logger.info(
				`${logPrefix} Polling promise RESOLVED with result: ${result}`,
			);
			return result;
		});

		logger.info(`${logPrefix} Creating context destruction listener promise.`);
		const contextPromise = new Promise<boolean>((resolve) => {
			const listener = (error: Error) => {
				if (
					error.message.includes("context was destroyed") ||
					error.message.includes("Execution context") ||
					error.message.includes("Target closed")
				) {
					contextDestroyed = true;
					logger.info(
						`${logPrefix} Context listener promise RESOLVED (Event): Context destruction detected. ${error.message}`,
					);
					resolve(true);
				}
			};
			pageForListeners?.once("error", listener);

			// Timeout for the listener itself
			const listenerTimeoutId = setTimeout(() => {
				pageForListeners?.off("error", listener); // Clean up listener
				if (!contextDestroyed) {
					logger.info(
						`${logPrefix} Context listener promise RESOLVED (Timeout): No context destruction detected.`,
					);
					resolve(false);
				}
			}, timeout);
			// Ensure timeout doesn't keep process alive if resolved early
			pageForListeners?.on("close", () => clearTimeout(listenerTimeoutId));
		});

		logger.info(`${logPrefix} Creating navigation listener promise.`);
		const navigationPromise = new Promise<boolean>((resolve) => {
			const listener = () => {
				logger.info(
					`${logPrefix} Navigation listener promise RESOLVED (Event): 'navigation' detected.`,
				);
				resolve(true);
			};
			pageForListeners?.once("navigation", listener);

			// Timeout for the listener itself
			const listenerTimeoutId = setTimeout(() => {
				pageForListeners?.off("navigation", listener); // Clean up listener
				logger.info(
					`${logPrefix} Navigation listener promise RESOLVED (Timeout): No 'navigation' event detected.`,
				);
				resolve(false);
			}, timeout);
			// Ensure timeout doesn't keep process alive if resolved early
			pageForListeners?.on("close", () => clearTimeout(listenerTimeoutId));
		});

		// --- Race Detection --- //
		logger.info(`${logPrefix} Starting Promise.race...`);
		const raceResult = await Promise.race([
			waitFunctionPromise,
			pollingPromise,
			contextPromise,
			navigationPromise,
		]);
		logger.info(
			`${logPrefix} Promise.race finished with result: ${raceResult}`,
		);
		const changeDetected = raceResult || contextDestroyed;
		logger.info(
			`${logPrefix} Change detected (raceResult || contextDestroyed): ${changeDetected}`,
		);

		if (changeDetected) {
			logger.info(
				`${logPrefix} Change was detected. Performing final verification after delay.`,
			);
			// ... (Stabilization Delay Logic) ...
			await new Promise((resolve) => setTimeout(resolve, 1000)); // Short delay
			try {
				const finalPage = await getActivePage(browser, logger);
				if (!finalPage) {
					logger.warn(
						`${logPrefix} Final verification: getActivePage returned null. Returning contextDestroyed: ${contextDestroyed}`,
					);
					return contextDestroyed;
				}
				const finalUrl = await finalPage.url();
				const finalUrlChanged = finalUrl !== currentUrl;
				logger.info(
					`${logPrefix} Final verification: Final URL: ${finalUrl}. Changed from initial: ${finalUrlChanged}. Overall result: ${changeDetected || finalUrlChanged}`,
				);
				return changeDetected || finalUrlChanged;
			} catch (finalError) {
				logger.warn(
					`${logPrefix} Error during final URL verification: ${(finalError as Error).message}. Returning contextDestroyed: ${contextDestroyed}`,
				);
				return contextDestroyed; // Assume change if error occurred here, relying on initial detection
			}
		}

		// --- Final Check if No Change Detected by Race --- //
		logger.warn(
			`${logPrefix} No change detected by race/context destruction. Performing final check.`,
		);
		try {
			const finalPage = await getActivePage(browser, logger);
			if (!finalPage) {
				logger.warn(
					`${logPrefix} Final check: getActivePage returned null. Returning contextDestroyed: ${contextDestroyed}`,
				);
				return contextDestroyed;
			}
			const finalUrl = await finalPage.url();
			const finalChanged = finalUrl !== currentUrl;
			logger.info(
				`${logPrefix} Final check: Final URL: ${finalUrl}. Changed from initial: ${finalChanged}.`,
			);
			return finalChanged;
		} catch (finalError) {
			const err = finalError as Error;
			if (
				err.message.includes("context was destroyed") ||
				err.message.includes("Target closed")
			) {
				logger.info(
					`${logPrefix} Final check: Context destruction detected during check. Assuming success. ${err.message}`,
				);
				return true; // Treat as success
			}
			logger.error(
				`${logPrefix} Final check: Error getting final URL: ${err.message}`,
			);
			return false;
		}
	} catch (error) {
		const err = error as Error;
		logger.error(
			`${logPrefix} Top-level error in waitForUrlChange: ${err.message}`,
		);
		if (
			err.message.includes("context was destroyed") ||
			err.message.includes("Target closed")
		) {
			logger.info(
				`${logPrefix} Top-level error indicates context destroyed. Assuming success. ${err.message}`,
			);
			return true; // Still implies navigation happened
		}
		return false;
	}
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
		logger.warn("Cannot take screenshot: page is null");
		return null;
	}

	try {
		const screenshot = await page.screenshot({
			encoding: "base64",
			fullPage: true,
			type: "jpeg",
			quality: 70,
		});
		return `data:image/jpeg;base64,${screenshot}`;
	} catch (error) {
		logger.warn(`Error taking screenshot: ${(error as Error).message}`);
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
