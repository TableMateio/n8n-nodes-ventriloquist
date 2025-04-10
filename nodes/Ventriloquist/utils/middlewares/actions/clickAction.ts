import type { IDataObject, Logger as ILogger } from "n8n-workflow";
import type * as puppeteer from "puppeteer-core";
import { formatOperationLog } from "../../resultUtils";
import {
	clickAndWaitForNavigation,
	waitForUrlChange,
} from "../../navigationUtils";
import { SessionManager } from "../../sessionManager";
import type { Page } from "puppeteer-core";
import { getActivePage } from "../../sessionUtils";

/**
 * Interface for click action parameters
 */
export interface IClickActionParameters {
	selector: string;
	waitAfterAction?: string;
	waitTime?: number;
	waitSelector?: string;
}

/**
 * Interface for click action options
 */
export interface IClickActionOptions {
	sessionId: string;
	nodeName: string;
	nodeId: string;
	index: number;
	selectorTimeout?: number;
}

/**
 * Interface for click action result
 */
export interface IClickActionResult {
	success: boolean;
	details: IDataObject;
	error?: Error;
	contextDestroyed?: boolean;
	urlChanged?: boolean;
	navigationSuccessful?: boolean;
}

/**
 * Execute a click action using provided page
 * This version accepts page directly and doesn't use SessionManager for page management
 */
export async function executeClickAction(
	page: Page,
	parameters: IClickActionParameters,
	options: IClickActionOptions,
	logger: ILogger,
): Promise<IClickActionResult> {
	const {
		selector,
		waitAfterAction = "noWait",
		waitTime = 5000,
		waitSelector,
	} = parameters;
	const { sessionId, nodeName, nodeId, index } = options;

	// Add logging prefix to clearly identify source
	const logPrefix = "[ClickAction][executeClickAction]";

	// Log action start
	logger.info(
		formatOperationLog(
			"ClickAction",
			nodeName,
			nodeId,
			index,
			`${logPrefix} Executing click action on selector: "${selector}"`,
		),
	);

	// Skip session verification - page is now passed directly
	try {
		// Store the initial URL and title before clicking
		const beforeUrl = await page.url();
		const beforeTitle = await page.title();

		logger.info(
			formatOperationLog(
				"ClickAction",
				nodeName,
				nodeId,
				index,
				`${logPrefix} Current page before click - URL: ${beforeUrl}, Title: ${beforeTitle}`,
			),
		);

		// Determine if we need to wait for navigation
		const shouldWaitForNav =
			waitAfterAction === "urlChanged" ||
			waitAfterAction === "anyUrlChange" ||
			waitAfterAction === "navigationComplete";

		if (shouldWaitForNav) {
			logger.info(
				formatOperationLog(
					"ClickAction",
					nodeName,
					nodeId,
					index,
					`${logPrefix} Using Click-Then-Wait-For-Selector strategy for: ${waitAfterAction}`,
				),
			);

			// Use a sensible default timeout if not provided, ensure it's reasonable
			const waitTimeout = Math.max(waitTime || 30000, 10000); // Min 10s

			// Define the target selector we expect after navigation (Hardcoded for testing)
			const targetSelectorAfterNav = "#co_clientIDContinueButton";

			logger.info(
				formatOperationLog(
					"ClickAction",
					nodeName,
					nodeId,
					index,
					`${logPrefix} Handling click on selector: "${selector}", then waiting for "${targetSelectorAfterNav}" (timeout: ${waitTimeout}ms)`,
				),
			);

			try {
				// Find element first
				const element = await page.$(selector);
				if (!element) {
					// Add debug info for complex selectors
					if (selector.includes(':nth-') || selector.includes('nth-of-type') || selector.includes('nth-child')) {
						logger.info(`${logPrefix} [Debug] Attempting to evaluate complex selector: "${selector}"`);
						// Try to debug the selector by counting matching elements
						const debugInfo = await page.evaluate((sel) => {
							const elements = document.querySelectorAll(sel.split(':')[0]); // Get base selector without pseudo
							const allMatches = document.querySelectorAll(sel);
							return {
								baseCount: elements.length,
								matchCount: allMatches.length,
								baseSelText: Array.from(elements).map(el => el.outerHTML.slice(0, 100)).join('\n'),
								matchSelText: Array.from(allMatches).map(el => el.outerHTML.slice(0, 100)).join('\n')
							};
						}, selector);
						logger.info(`${logPrefix} [Debug] Selector "${selector}": Base elements: ${debugInfo.baseCount}, Matches: ${debugInfo.matchCount}`);
						logger.info(`${logPrefix} [Debug] Base elements sample: ${debugInfo.baseSelText.substring(0, 500)}`);
						logger.info(`${logPrefix} [Debug] Matching elements sample: ${debugInfo.matchSelText.substring(0, 500)}`);
					}

					throw new Error(`Element not found: ${selector}`);
				}

				// --- Initiate Click Non-Blockingly --- //
				logger.info(`${logPrefix} Initiating click on ${selector} (non-blocking)...`);
				element.click().catch((err) => {
					// Log potential errors during click initiation, but don't block the wait
					logger.warn(
						`${logPrefix} Non-blocking click initiation error: ${(err as Error).message}`,
					);
				});

				// --- Then Wait for Target Selector --- //
				logger.info(`${logPrefix} Waiting for target selector "${targetSelectorAfterNav}"...`);
				await page.waitForSelector(targetSelectorAfterNav, { timeout: waitTimeout });

				// --- Success: Target Selector Found --- //
				logger.info(
					`${logPrefix} Target selector "${targetSelectorAfterNav}" found. Navigation presumed successful and stable.`,
				);

				let finalPage = page;
				try {
					// Attempt to get the potentially new page reference
					const session = SessionManager.getSession(sessionId);
					if (session?.browser?.isConnected()) {
						const activePage = await getActivePage(session.browser, logger);
						if (activePage) {
							finalPage = activePage;
							logger.info(`${logPrefix} Got potentially new active page reference.`);
						} else {
							logger.warn(
								`${logPrefix} Could not get active page after wait, using original page reference.`,
							);
						}
					} else {
						logger.warn(
							`${logPrefix} Session/Browser disconnected after wait, using original page reference.`,
						);
					}
				} catch (getPageError) {
					logger.warn(
						`${logPrefix} Error getting active page after wait: ${(getPageError as Error).message}, using original page reference.`,
					);
				}

				const finalUrl = await finalPage.url();
				const finalTitle = await finalPage.title();

				return {
					success: true,
					urlChanged: beforeUrl !== finalUrl,
					navigationSuccessful: true,
					contextDestroyed: page.isClosed(),
					details: {
						selector,
						waitAfterAction,
						waitTime: waitTimeout,
						waitedForSelector: targetSelectorAfterNav,
						beforeUrl,
						finalUrl,
						beforeTitle,
						finalTitle,
						urlChanged: beforeUrl !== finalUrl,
						navigationSuccessful: true,
						contextDestroyed: page.isClosed(),
					},
				};
			} catch (error) {
				// --- Handle Non-Blocking Click + waitForSelector Failure --- //
				const errorMessage = (error as Error).message;
				logger.warn(
					`${logPrefix} Error during non-blocking click + waitForSelector: ${errorMessage}`,
				);

				const isContextDestroyedError =
					errorMessage.includes("context was destroyed") ||
					errorMessage.includes("Execution context") ||
					errorMessage.includes("Target closed");

				// If target selector wasn't found (timeout error)
				// Puppeteer throws TimeoutError for waitForSelector timeouts
				if (error.constructor.name === 'TimeoutError' || errorMessage.includes("waiting for selector")) {
					logger.warn(
						`${logPrefix} Target selector "${targetSelectorAfterNav}" not found after click within timeout. Navigation failed or page did not load correctly.`,
					);
					return {
						success: true, // Click initiation succeeded
						urlChanged: false, // Assume URL didn't change if target element didn't appear
						navigationSuccessful: false,
						contextDestroyed: isContextDestroyedError || page.isClosed(),
						details: {
							selector,
							waitAfterAction,
							waitTime: waitTimeout,
							waitedForSelector: targetSelectorAfterNav,
							beforeUrl,
							beforeTitle,
							error: `Navigation failed: Target element "${targetSelectorAfterNav}" not found after click within ${waitTimeout}ms.`,
							navigationSuccessful: false,
							contextDestroyed: isContextDestroyedError || page.isClosed(),
						},
						error: error as Error,
					};
				}

				// For other errors (e.g. element not found initially, context destroyed during wait),
				// re-throw to indicate a more fundamental action failure.
				logger.error(
					`${logPrefix} Unhandled error during click/wait: ${errorMessage}. Re-throwing.`,
				);
				throw error;
			}
		} else {
			// Simple click without waiting for navigation
			logger.info(
				formatOperationLog(
					"ClickAction",
					nodeName,
					nodeId,
					index,
					`${logPrefix} Performing simple click logic (shouldWaitForNav was false) on selector: "${selector}"`,
				),
			);

			// Find the element
			const element = await page.$(selector);
			if (!element) {
				// Add debug info for complex selectors
				if (selector.includes(':nth-') || selector.includes('nth-of-type') || selector.includes('nth-child')) {
					logger.info(`${logPrefix} [Debug] Attempting to evaluate complex selector: "${selector}"`);
					// Try to debug the selector by counting matching elements
					const debugInfo = await page.evaluate((sel) => {
						const elements = document.querySelectorAll(sel.split(':')[0]); // Get base selector without pseudo
						const allMatches = document.querySelectorAll(sel);
						return {
							baseCount: elements.length,
							matchCount: allMatches.length,
							baseSelText: Array.from(elements).map(el => el.outerHTML.slice(0, 100)).join('\n'),
							matchSelText: Array.from(allMatches).map(el => el.outerHTML.slice(0, 100)).join('\n')
						};
					}, selector);
					logger.info(`${logPrefix} [Debug] Selector "${selector}": Base elements: ${debugInfo.baseCount}, Matches: ${debugInfo.matchCount}`);
					logger.info(`${logPrefix} [Debug] Base elements sample: ${debugInfo.baseSelText.substring(0, 500)}`);
					logger.info(`${logPrefix} [Debug] Matching elements sample: ${debugInfo.matchSelText.substring(0, 500)}`);
				}

				return {
					success: false,
					details: {
						error: `Element not found: ${selector}`,
						selector,
					},
					error: new Error(`Element not found: ${selector}`),
				};
			}

			// Click the element and wait if needed based on the strategy
			if (waitAfterAction === "fixedTime" && waitTime) {
				// CRUCIAL CHANGE: Initiate click without await, then start timer immediately
				logger.info(
					formatOperationLog(
						"ClickAction",
						nodeName,
						nodeId,
						index,
						`${logPrefix} Initiating click on selector: "${selector}" (fixedTime wait)`,
					),
				);
				element.click().catch((err) => {
					// Log potential click errors occurring after the wait started, but don't block
					logger.warn(
						formatOperationLog(
							"ClickAction",
							nodeName,
							nodeId,
							index,
							`${logPrefix} Non-blocking error during fixedTime click: ${(err as Error).message}`,
						),
					);
				});

				logger.info(
					formatOperationLog(
						"ClickAction",
						nodeName,
						nodeId,
						index,
						`${logPrefix} Waiting for fixed time: ${waitTime}ms`,
					),
				);
				await new Promise((resolve) => setTimeout(resolve, waitTime));
			} else if (waitAfterAction === "selector") {
				// New logic for selector wait
				logger.info(
					formatOperationLog(
						"ClickAction",
						nodeName,
						nodeId,
						index,
						`${logPrefix} Awaiting click on selector: "${selector}" (selector wait)`,
					),
				);
				await element.click(); // Await the click first for this simple case

				if (waitSelector) {
					const effectiveWaitTime = waitTime || 10000; // Use waitTime if provided, else default
					logger.info(
						formatOperationLog(
							"ClickAction",
							nodeName,
							nodeId,
							index,
							`${logPrefix} Waiting for selector: "${waitSelector}" (timeout: ${effectiveWaitTime}ms)`,
						),
					);
					try {
						await page.waitForSelector(waitSelector, {
							timeout: effectiveWaitTime,
						});
						logger.info(
							formatOperationLog(
								"ClickAction",
								nodeName,
								nodeId,
								index,
								`${logPrefix} Selector "${waitSelector}" found.`,
							),
						);
					} catch (selectorError) {
						logger.warn(
							formatOperationLog(
								"ClickAction",
								nodeName,
								nodeId,
								index,
								`${logPrefix} Wait for selector "${waitSelector}" failed or timed out: ${(selectorError as Error).message}`,
							),
						);
						// Don't fail the overall action, just log the warning
					}
				} else {
					logger.warn(
						formatOperationLog(
							"ClickAction",
							nodeName,
							nodeId,
							index,
							`${logPrefix} waitAfterAction is 'selector' but no waitSelector parameter provided. Skipping wait.`,
						),
					);
				}
			} else {
				// For 'noWait', await the click normally first
				logger.info(
					formatOperationLog(
						"ClickAction",
						nodeName,
						nodeId,
						index,
						`${logPrefix} Awaiting click on selector: "${selector}" (noWait)`,
					),
				);
				await element.click(); // Await click here for noWait case
			}

			// Get final state and return success (common for all simple click paths)
			const currentUrl = await page.url();
			const currentTitle = await page.title();

			return {
				success: true,
				urlChanged: beforeUrl !== currentUrl,
				details: {
					selector,
					waitAfterAction,
					waitTime,
					beforeUrl,
					currentUrl,
					beforeTitle,
					currentTitle,
					urlChanged: beforeUrl !== currentUrl,
				},
			};
		}
	} catch (error) {
		// Log and return error
		const errorMessage = (error as Error).message;
		logger.error(
			formatOperationLog(
				"ClickAction",
				nodeName,
				nodeId,
				index,
				`${logPrefix} Click action error: ${errorMessage}`,
			),
		);

		return {
			success: false,
			details: {
				error: errorMessage,
				selector,
			},
			error: error as Error,
		};
	}
}
