import type { IDataObject, Logger as ILogger } from "n8n-workflow";
import type * as puppeteer from "puppeteer-core";
import { formatOperationLog } from "../../resultUtils";
import {
	clickAndWaitForNavigation,
	waitForUrlChange,
} from "../../navigationUtils";
import { SessionManager } from "../../sessionManager";
import type { Page } from "puppeteer-core";

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
			// Use the simple navigation approach with Promise.all
			logger.info(
				formatOperationLog(
					"ClickAction",
					nodeName,
					nodeId,
					index,
					`${logPrefix} Using navigation handling for click with waitAfterAction: ${waitAfterAction}`,
				),
			);

			// Map the waitAfterAction to appropriate waitUntil option
			let waitUntil: puppeteer.PuppeteerLifeCycleEvent = "domcontentloaded";
			if (waitAfterAction === "navigationComplete") {
				waitUntil = "networkidle0";
			}

			// Special handling for URL change detection which should be different from normal navigation
			if (waitAfterAction === "urlChanged") {
				logger.info(
					formatOperationLog(
						"ClickAction",
						nodeName,
						nodeId,
						index,
						`${logPrefix} Using URL change detection for navigation with timeout: ${waitTime}ms`,
					),
				);

				try {
					// Find the element first
					const element = await page.$(selector);
					if (!element) {
						return {
							success: false,
							details: {
								error: `Element not found: ${selector}`,
								selector,
							},
							error: new Error(`Element not found: ${selector}`),
						};
					}

					// Click the element without waiting
					await element.click();

					// Now explicitly wait for URL change
					const currentUrl = await page.url();

					logger.info(
						formatOperationLog(
							"ClickAction",
							nodeName,
							nodeId,
							index,
							`${logPrefix} Waiting for URL to change from: ${currentUrl}`,
						),
					);

					// Import waitForUrlChange from navigationUtils at the top of the file if not already imported
					const urlChanged = await waitForUrlChange(
						options.sessionId,
						currentUrl,
						waitTime || 30000,
						logger,
					);

					if (urlChanged) {
						// URL changed, get the new URL
						let finalUrl: string;
						let finalTitle: string;

						try {
							finalUrl = await page.url();
							finalTitle = await page.title();

							logger.info(
								formatOperationLog(
									"ClickAction",
									nodeName,
									nodeId,
									index,
									`${logPrefix} URL change detected: ${currentUrl} -> ${finalUrl}`,
								),
							);
						} catch (pageError) {
							// Context may have been destroyed during navigation
							logger.warn(
								formatOperationLog(
									"ClickAction",
									nodeName,
									nodeId,
									index,
									`${logPrefix} Page context destroyed during navigation: ${(pageError as Error).message}`,
								),
							);

							// This is actually expected during hard navigation
							return {
								success: true,
								urlChanged: true,
								navigationSuccessful: true,
								contextDestroyed: true,
								details: {
									selector,
									waitAfterAction,
									waitTime,
									beforeUrl,
									contextDestroyed: true,
									urlChanged: true,
									navigationSuccessful: true,
								},
							};
						}

						return {
							success: true,
							urlChanged: true,
							navigationSuccessful: true,
							details: {
								selector,
								waitAfterAction,
								waitTime,
								beforeUrl,
								finalUrl,
								beforeTitle,
								finalTitle,
								urlChanged: true,
								navigationSuccessful: true,
							},
						};
					} else {
						// URL did not change
						logger.warn(
							formatOperationLog(
								"ClickAction",
								nodeName,
								nodeId,
								index,
								`${logPrefix} URL did not change after click within timeout: ${waitTime}ms`,
							),
						);

						return {
							success: true,
							urlChanged: false,
							navigationSuccessful: false,
							details: {
								selector,
								waitAfterAction,
								waitTime,
								beforeUrl,
								urlChanged: false,
								navigationSuccessful: false,
								message: "URL did not change after click within timeout",
							},
						};
					}
				} catch (error) {
					// Handle errors during the URL change wait process
					const errorMessage = (error as Error).message;
					const isContextDestroyed =
						errorMessage.includes("context was destroyed") ||
						errorMessage.includes("Execution context") ||
						errorMessage.includes("Target closed");

					logger.warn(
						formatOperationLog(
							"ClickAction",
							nodeName,
							nodeId,
							index,
							`${logPrefix} Error during URL change detection: ${errorMessage}`,
						),
					);

					// If context was destroyed, this likely means navigation happened
					if (isContextDestroyed) {
						logger.info(
							formatOperationLog(
								"ClickAction",
								nodeName,
								nodeId,
								index,
								`${logPrefix} Context destruction detected which likely indicates successful navigation`,
							),
						);

						return {
							success: true,
							urlChanged: true,
							navigationSuccessful: true,
							contextDestroyed: true,
							details: {
								selector,
								waitAfterAction,
								waitTime,
								beforeUrl,
								contextDestroyed: true,
								urlChanged: true,
								navigationSuccessful: true,
							},
						};
					}

					return {
						success: false,
						details: {
							error: errorMessage,
							selector,
							waitAfterAction,
							waitTime,
						},
						error: error as Error,
					};
				}
			} else {
				// For regular navigation (not URL change detection)
				logger.info(
					formatOperationLog(
						"ClickAction",
						nodeName,
						nodeId,
						index,
						`${logPrefix} Directly handling click and navigation on selector: "${selector}", timeout: ${waitTime}ms, waitUntil: ${waitUntil}`,
					),
				);

				// Use our simplified navigation utility with proper timeout
				logger.info(
					formatOperationLog(
						"ClickAction",
						nodeName,
						nodeId,
						index,
						`${logPrefix} Directly handling click and navigation on selector: "${selector}", timeout: ${waitTime}ms, waitUntil: ${waitUntil}`,
					),
				);

				// Instead of calling clickAndWaitForNavigation, implement directly
				const element = await page.$(selector);
				if (!element) {
					return {
						success: false,
						details: {
							error: `Element not found: ${selector}`,
							selector,
						},
						error: new Error(`Element not found: ${selector}`),
					};
				}

				try {
					// Set up navigation promise
					const navigationPromise = page.waitForNavigation({
						waitUntil: [waitUntil],
						timeout: waitTime,
					});

					// Click the element
					await element.click();

					// Wait for navigation to complete
					await navigationPromise;

					// Navigation was successful
					const finalUrl = await page.url();
					const finalTitle = await page.title();

					logger.info(
						formatOperationLog(
							"ClickAction",
							nodeName,
							nodeId,
							index,
							`${logPrefix} Click with navigation successful - Final URL: ${finalUrl}`,
						),
					);

					return {
						success: true,
						urlChanged: beforeUrl !== finalUrl,
						navigationSuccessful: true,
						details: {
							selector,
							waitAfterAction,
							waitTime,
							beforeUrl,
							finalUrl,
							beforeTitle,
							finalTitle,
							urlChanged: beforeUrl !== finalUrl,
							navigationSuccessful: true,
						},
					};
				} catch (navigationError) {
					// Handle navigation errors
					const errorMessage = (navigationError as Error).message;
					const isContextDestroyed =
						errorMessage.includes("context was destroyed") ||
						errorMessage.includes("Execution context") ||
						errorMessage.includes("Target closed");

					logger.warn(
						formatOperationLog(
							"ClickAction",
							nodeName,
							nodeId,
							index,
							`${logPrefix} Navigation error: ${errorMessage}`,
						),
					);

					// Return with context destroyed flag if applicable
					return {
						success: true, // The click itself may have succeeded
						urlChanged: false,
						navigationSuccessful: false,
						contextDestroyed: isContextDestroyed,
						details: {
							selector,
							waitAfterAction,
							waitTime,
							beforeUrl,
							beforeTitle,
							error: errorMessage,
							navigationSuccessful: false,
							contextDestroyed: isContextDestroyed,
						},
						error: navigationError as Error,
					};
				}
			}
		} else {
			// Simple click without waiting for navigation
			logger.info(
				formatOperationLog(
					"ClickAction",
					nodeName,
					nodeId,
					index,
					`${logPrefix} Performing simple click without navigation wait on selector: "${selector}"`,
				),
			);

			// Find the element
			const element = await page.$(selector);
			if (!element) {
				return {
					success: false,
					details: {
						error: `Element not found: ${selector}`,
						selector,
					},
					error: new Error(`Element not found: ${selector}`),
				};
			}

			// Click the element
			await element.click();

			// Wait if specified
			if (waitAfterAction === "fixedTime" && waitTime) {
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
			} else if (waitAfterAction === "selector" && waitSelector) {
				logger.info(
					formatOperationLog(
						"ClickAction",
						nodeName,
						nodeId,
						index,
						`${logPrefix} Waiting for selector: "${waitSelector}"`,
					),
				);
				await page.waitForSelector(waitSelector, { timeout: waitTime });
			}

			// Get current URL for comparison
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
