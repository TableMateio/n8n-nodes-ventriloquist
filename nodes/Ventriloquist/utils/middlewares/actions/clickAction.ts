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
						logger.warn(`${logPrefix} Element ${selector} not found.`);
						return {
							success: false,
							details: {
								error: `Element not found: ${selector}`,
								selector,
							},
							error: new Error(`Element not found: ${selector}`),
						};
					}

					// Click the element and wait for the promise
					logger.info(`${logPrefix} Clicking element: ${selector}...`);
					await element.click(); // Reverted: Await the click promise
					logger.info(`${logPrefix} Click promise for ${selector} resolved.`);

					// Now explicitly wait for URL change
					logger.info(`${logPrefix} Getting current URL after click...`);
					const currentUrl = await page.url();
					logger.info(
						`${logPrefix} Got current URL: ${currentUrl}. Now calling waitForUrlChange.`,
					);

					logger.info(
						formatOperationLog(
							"ClickAction",
							nodeName,
							nodeId,
							index,
							`${logPrefix} Waiting for URL to change from: ${currentUrl}`,
						),
					);

					// Wait for the URL change
					const urlChanged = await waitForUrlChange(
						options.sessionId,
						currentUrl,
						waitTime || 30000,
						logger,
					);
					logger.info(`${logPrefix} waitForUrlChange returned: ${urlChanged}`);

					if (urlChanged) {
						logger.info(
							`${logPrefix} urlChanged is true. Proceeding to get final page state.`,
						);
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
								`${logPrefix} URL did not change after click within timeout: ${waitTime}ms. Returning result.`,
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
							`${logPrefix} Error during URL change detection catch block: ${errorMessage}. Returning result.`,
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
								`${logPrefix} Context destruction detected (in catch). Attempting to reconnect...`,
							),
						);

						// Add a stabilization delay before attempting to reconnect
						await new Promise((resolve) => setTimeout(resolve, 2000));

						try {
							// Get the browser from the SessionManager
							const session = await SessionManager.getSession(sessionId);
							if (!session || !session.browser) {
								logger.error(
									formatOperationLog(
										"ClickAction",
										nodeName,
										nodeId,
										index,
										`${logPrefix} Failed to get browser from SessionManager after context destruction`,
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
										reconnectionAttempted: true,
										reconnectionSuccessful: false,
										error: "Failed to get browser from SessionManager",
									},
								};
							}

							// Try to get a fresh page reference
							logger.info(
								formatOperationLog(
									"ClickAction",
									nodeName,
									nodeId,
									index,
									`${logPrefix} Getting fresh page reference after navigation`,
								),
							);

							const freshPage = await getActivePage(session.browser, logger);

							if (!freshPage) {
								logger.warn(
									formatOperationLog(
										"ClickAction",
										nodeName,
										nodeId,
										index,
										`${logPrefix} Session or browser disconnected after navigation, cannot get fresh page.`,
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
										reconnectionAttempted: true,
										reconnectionSuccessful: false,
									},
								};
							}

							logger.info(
								formatOperationLog(
									"ClickAction",
									nodeName,
									nodeId,
									index,
									`${logPrefix} Using fresh page reference after navigation`,
								),
							);

							// Get the new URL
							let finalUrl: string;
							let finalTitle: string;

							try {
								finalUrl = await freshPage.url();
								finalTitle = await freshPage.title();

								logger.info(
									formatOperationLog(
										"ClickAction",
										nodeName,
										nodeId,
										index,
										`${logPrefix} Reconnected successfully. New URL: ${finalUrl}, Title: ${finalTitle}`,
									),
								);

								// Update SessionManager with reconnected page - locally only
								logger.info(
									formatOperationLog(
										"ClickAction",
										nodeName,
										nodeId,
										index,
										"Reconnected page reference updated locally. Session Manager state not modified.",
									),
								);

								return {
									success: true,
									urlChanged: beforeUrl !== finalUrl,
									navigationSuccessful: true,
									contextDestroyed: true,
									details: {
										selector,
										waitAfterAction,
										waitTime,
										beforeUrl,
										finalUrl,
										beforeTitle,
										finalTitle,
										contextDestroyed: true,
										urlChanged: beforeUrl !== finalUrl,
										navigationSuccessful: true,
										reconnectionAttempted: true,
										reconnectionSuccessful: true,
									},
								};
							} catch (pageError) {
								logger.warn(
									formatOperationLog(
										"ClickAction",
										nodeName,
										nodeId,
										index,
										`${logPrefix} Could not get fresh page reference after navigation, but click was successful`,
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
										reconnectionError: (pageError as Error).message,
										reconnectionAttempted: true,
										reconnectionSuccessful: false,
									},
								};
							}
						} catch (reconnectError) {
							logger.warn(
								formatOperationLog(
									"ClickAction",
									nodeName,
									nodeId,
									index,
									`${logPrefix} Returning success with context destruction noted`,
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
									reconnectionError: (reconnectError as Error).message,
									reconnectionAttempted: true,
									reconnectionSuccessful: false,
								},
							};
						}
					}

					logger.warn(
						`${logPrefix} Unhandled error in URL change detection catch block. Returning error result.`,
					);
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
			} else if (waitAfterAction === "anyUrlChange") {
				// Special handling for anyUrlChange detection
				logger.info(
					formatOperationLog(
						"ClickAction",
						nodeName,
						nodeId,
						index,
						`${logPrefix} Using anyUrlChange detection for click on selector: "${selector}", timeout: ${waitTime}ms`,
					),
				);

				// Find element and safely click it
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
					// CRUCIAL CHANGE: Initiate click without awaiting it, to avoid getting stuck if page navigation destroys context
					logger.info(
						formatOperationLog(
							"ClickAction",
							nodeName,
							nodeId,
							index,
							`${logPrefix} Initiating click without awaiting completion (anyUrlChange strategy)`,
						),
					);

					// Start click but don't await its completion
					element.click().catch((err) => {
						logger.warn(
							formatOperationLog(
								"ClickAction",
								nodeName,
								nodeId,
								index,
								`${logPrefix} Non-blocking click error during anyUrlChange: ${err.message}`,
							),
						);
					});

					// Immediately start monitoring for URL changes without waiting for click to complete
					logger.info(
						formatOperationLog(
							"ClickAction",
							nodeName,
							nodeId,
							index,
							`${logPrefix} Starting URL change detection immediately`,
						),
					);

					const urlChangeDetected = await waitForUrlChange(
						options.sessionId,
						beforeUrl,
						waitTime || 30000, // Use provided timeout or reasonable default
						logger,
					);

					if (urlChangeDetected) {
						logger.info(
							formatOperationLog(
								"ClickAction",
								nodeName,
								nodeId,
								index,
								`${logPrefix} URL change detected during anyUrlChange monitoring.`,
							),
						);

						// Get final state after change
						try {
							const session = SessionManager.getSession(options.sessionId);
							if (!session?.browser) {
								logger.warn(
									formatOperationLog(
										"ClickAction",
										nodeName,
										nodeId,
										index,
										`${logPrefix} Cannot get browser from session`,
									),
								);
								// Still return success
								return {
									success: true,
									urlChanged: true,
									navigationSuccessful: true,
									details: {
										selector,
										waitAfterAction,
										waitTime,
										beforeUrl,
										urlChanged: true,
										navigationSuccessful: true,
									},
								};
							}
							const finalPage = await getActivePage(session.browser, logger);
							if (finalPage) {
								const finalUrl = await finalPage.url();
								const finalTitle = await finalPage.title();

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
							}
						} catch (finalError) {
							// If we can't get final state, still return success
							logger.warn(
								formatOperationLog(
									"ClickAction",
									nodeName,
									nodeId,
									index,
									`${logPrefix} URL change detected but could not get final state: ${(finalError as Error).message}`,
								),
							);
						}

						// Return success even if we couldn't get final state
						return {
							success: true,
							urlChanged: true,
							navigationSuccessful: true,
							details: {
								selector,
								waitAfterAction,
								waitTime,
								beforeUrl,
								urlChanged: true,
								navigationSuccessful: true,
							},
						};
					} else {
						// No URL change detected within timeout
						logger.warn(
							formatOperationLog(
								"ClickAction",
								nodeName,
								nodeId,
								index,
								`${logPrefix} No URL change detected within timeout period of ${waitTime}ms`,
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
								message: "No URL change detected within timeout",
							},
						};
					}
				} catch (error) {
					// Handle errors during the anyUrlChange process
					const errorMessage = (error as Error).message;
					logger.warn(
						formatOperationLog(
							"ClickAction",
							nodeName,
							nodeId,
							index,
							`${logPrefix} Error during anyUrlChange detection: ${errorMessage}`,
						),
					);
					// Treat context destroyed as success
					const isContextDestroyed =
						errorMessage.includes("context was destroyed") ||
						errorMessage.includes("Execution context") ||
						errorMessage.includes("Target closed");
					if (isContextDestroyed) {
						logger.info(
							formatOperationLog(
								"ClickAction",
								nodeName,
								nodeId,
								index,
								`${logPrefix} Context destruction detected (anyUrlChange catch). Returning success.`,
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
					// Return other errors as failure
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
				// For regular navigation (waitAfterAction === 'navigationComplete')
				const waitUntil: puppeteer.PuppeteerLifeCycleEvent = "networkidle0"; // Default to networkidle0 for this path
				logger.info(
					formatOperationLog(
						"ClickAction",
						nodeName,
						nodeId,
						index,
						`${logPrefix} Handling click with navigationComplete on selector: "${selector}", timeout: ${waitTime}ms, waitUntil: ${waitUntil}`,
					),
				);

				// Find element
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
			// Simple click with no waiting
			logger.info(
				formatOperationLog(
					"ClickAction",
					nodeName,
					nodeId,
					index,
					`${logPrefix} Performing simple click logic (shouldWaitForNav was false) on selector: "${selector}"`,
				),
			);

			// For 'noWait', await the click normally first
			try {
				logger.info(
					formatOperationLog(
						"ClickAction",
						nodeName,
						nodeId,
						index,
						`${logPrefix} Awaiting click on selector: "${selector}" (noWait)`,
					),
				);

				// Find the element first
				const element = await page.$(selector);
				if (!element) {
					return {
						success: false,
						details: {
							error: `Element not found: ${selector}`,
							selector,
							selectorFound: false
						},
						error: new Error(`Element not found: ${selector}`),
					};
				}

				// Just click - no timeout manipulation needed for noWait
				await element.click(); // Await click here for noWait case

				// We've clicked, now return success without waiting for anything
				return {
					success: true,
					details: {
						selector,
						waitAfterAction,
						waitTime,
						selectorFound: true
					},
				};
			} catch (clickError) {
				logger.error(
					formatOperationLog(
						"ClickAction",
						nodeName,
						nodeId,
						index,
						`${logPrefix} Click action error: ${(clickError as Error).message}`,
					),
				);

				return {
					success: false,
					details: {
						selector,
						waitAfterAction,
						waitTime,
						error: (clickError as Error).message,
						selectorFound: false
					},
					error: clickError as Error,
				};
			}
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
