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
			// Special handling for URL change detection
			if (
				waitAfterAction === "urlChanged" ||
				waitAfterAction === "anyUrlChange"
			) {
				// Also apply to anyUrlChange for consistency
				logger.info(
					formatOperationLog(
						"ClickAction",
						nodeName,
						nodeId,
						index,
						`${logPrefix} Using Promise.all with networkidle2 wait for navigation. Timeout: ${waitTime || 30000}ms`,
					),
				);

				try {
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

					// Set up navigation detection BEFORE initiating the click - critical for reliability
					logger.info(
						`${logPrefix} Setting up navigation detection BEFORE initiating click...`,
					);

					// Different strategy based on specific waitAfterAction type
					if (waitAfterAction === "anyUrlChange") {
						// For anyUrlChange, we set up the navigation monitor first, then perform the click
						// without awaiting it first, to avoid blocking when context gets destroyed
						logger.info(
							`${logPrefix} Using anyUrlChange strategy - setting up navigation monitor first`,
						);

						// Store initial URL
						const initialUrl = await page.url();

						// Set up navigation promise but don't await yet
						const navigationPromise = page
							.waitForNavigation({
								waitUntil: "networkidle2",
								timeout: waitTime || 30000,
							})
							.catch((err) => {
								logger.warn(
									`${logPrefix} Navigation promise rejected (expected for context destruction): ${err.message}`,
								);
								// Intentionally not rejecting to allow Promise.race to continue
								return { navigationError: true };
							});

						// Set up URL change detection
						const urlChangePromise = waitForUrlChange(
							sessionId,
							initialUrl,
							waitTime || 30000,
							logger,
						).catch((err) => {
							logger.warn(
								`${logPrefix} URL change monitoring error: ${err.message}`,
							);
							return false;
						});

						// Set up timeout promise
						const timeoutPromise = new Promise((resolve) =>
							setTimeout(() => resolve({ timeout: true }), waitTime || 30000),
						);

						// Initiate click but do NOT await it
						logger.info(
							`${logPrefix} Initiating click without awaiting completion...`,
						);
						page
							.evaluate((el) => {
								(el as HTMLElement).click();
							}, element)
							.catch((err) => {
								logger.warn(
									`${logPrefix} Click error (non-blocking): ${err.message}`,
								);
							});

						// Now race the promises to see which resolves first
						logger.info(
							`${logPrefix} Click initiated, now waiting for navigation or timeout...`,
						);
						const raceResult = await Promise.race([
							navigationPromise,
							urlChangePromise,
							timeoutPromise,
						]);

						// Determine what happened
						interface NavigationResult {
							navigationError?: boolean;
							timeout?: boolean;
						}
						const isNavError = !!(raceResult as NavigationResult)
							?.navigationError;
						const isTimeout = !!(raceResult as NavigationResult)?.timeout;
						const isUrlChanged = raceResult === true; // Direct result from urlChangePromise

						logger.info(
							`${logPrefix} Navigation race completed - URL changed: ${isUrlChanged}, Timeout: ${isTimeout}, Nav Error: ${isNavError}`,
						);

						// Get final state if possible
						let finalUrl = "[Unknown]";
						let finalTitle = "[Unknown]";
						try {
							finalUrl = await page.url();
							finalTitle = await page.title();
							logger.info(
								`${logPrefix} Final state - URL: ${finalUrl}, Title: ${finalTitle}`,
							);
						} catch (pageError) {
							logger.warn(
								`${logPrefix} Could not get final page state: ${(pageError as Error).message}`,
							);
							// Assume context destroyed, which is often a sign of successful navigation
							return {
								success: true,
								urlChanged: true,
								navigationSuccessful: true,
								contextDestroyed: true,
								details: {
									selector,
									waitAfterAction,
									waitTime,
									beforeUrl: initialUrl,
									contextDestroyed: true,
									urlChanged: true,
									navigationSuccessful: true,
								},
							};
						}

						return {
							success: true,
							urlChanged: initialUrl !== finalUrl || isUrlChanged,
							navigationSuccessful:
								initialUrl !== finalUrl || isUrlChanged || isNavError,
							contextDestroyed: isNavError,
							details: {
								selector,
								waitAfterAction,
								waitTime,
								beforeUrl: initialUrl,
								finalUrl,
								beforeTitle,
								finalTitle,
								urlChanged: initialUrl !== finalUrl || isUrlChanged,
								navigationSuccessful:
									initialUrl !== finalUrl || isUrlChanged || isNavError,
								contextDestroyed: isNavError,
							},
						};
					} else {
						// For regular urlChanged, we use Promise.all approach - this is NOT in an else block
						logger.info(
							`${logPrefix} Setting up Promise.all for click and networkidle2 wait...`,
						);
						const navigationPromise = page.waitForNavigation({
							waitUntil: "networkidle2", // Try networkidle2
							timeout: waitTime || 30000,
						});
						const clickPromise = page.evaluate((el) => {
							(el as HTMLElement).click();
						}, element);

						await Promise.all([navigationPromise, clickPromise]);
						logger.info(
							`${logPrefix} Promise.all for click/networkidle2 wait resolved successfully.`,
						);

						// Navigation likely successful
						let finalUrl = "[Unknown]";
						let finalTitle = "[Unknown]";
						try {
							finalUrl = await page.url();
							finalTitle = await page.title();
							logger.info(
								`${logPrefix} Navigation successful. Final URL: ${finalUrl}`,
							);
						} catch (pageError) {
							logger.warn(
								`${logPrefix} Could not get final page state after navigation: ${(pageError as Error).message}`,
							);
							// Assume success based on Promise.all resolving
							return {
								success: true,
								urlChanged: true, // Assume changed
								navigationSuccessful: true,
								contextDestroyed: true, // Likely if we error here
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
					}
				} catch (error) {
					// Handle errors from Promise.all (e.g., timeout, context destruction)
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
							`${logPrefix} Error during click/networkidle2 wait: ${errorMessage}. Context destroyed: ${isContextDestroyed}`,
						),
					);

					// If context was destroyed, consider it potentially successful navigation
					if (isContextDestroyed) {
						return {
							success: true, // Click likely initiated nav
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

					// Otherwise, return error
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
				// Restore waitUntil definition for other cases
				let waitUntil: puppeteer.PuppeteerLifeCycleEvent = "domcontentloaded";
				if (waitAfterAction === "navigationComplete") {
					waitUntil = "networkidle0";
				}
				// For regular navigation (e.g., navigationComplete)
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
					await page.evaluate((el) => {
						(el as HTMLElement).click();
					}, element);

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

			// Click the element using page.evaluate with HTMLElement cast
			logger.info(
				`${logPrefix} Performing simple click via page.evaluate on selector: "${selector}"`,
			);
			await page.evaluate((el) => {
				(el as HTMLElement).click();
			}, element);

			// Wait if specified
			if (waitAfterAction === "fixedTime" && waitTime) {
				logger.info(
					formatOperationLog(
						"ClickAction",
						nodeName,
						nodeId,
						index,
						`${logPrefix} Performing simple click with ${waitTime}ms fixed wait`,
					),
				);

				// CRUCIAL CHANGE: Initiate click without await, then start timer immediately
				logger.info(
					formatOperationLog(
						"ClickAction",
						nodeName,
						nodeId,
						index,
						`${logPrefix} Initiating click on selector: "${selector}" and starting fixed time wait without awaiting click completion`,
					),
				);

				// Start click but don't await its completion
				element.click().catch((err) => {
					// Log errors but don't block execution
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

				// Immediately start the timer without waiting for click to complete
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

				// Get current state after wait
				let finalUrl = beforeUrl;
				let finalTitle = beforeTitle;
				try {
					finalUrl = await page.url();
					finalTitle = await page.title();
				} catch (pageError) {
					logger.warn(
						formatOperationLog(
							"ClickAction",
							nodeName,
							nodeId,
							index,
							`${logPrefix} Could not get page state after fixed time wait: ${(pageError as Error).message}`,
						),
					);
					// Return with success but note the context destruction
					return {
						success: true,
						contextDestroyed: true,
						urlChanged: true, // Assume changed if context destroyed
						details: {
							selector,
							waitAfterAction,
							waitTime,
							beforeUrl,
							contextDestroyed: true,
						},
					};
				}

				return {
					success: true,
					urlChanged: finalUrl !== beforeUrl,
					details: {
						selector,
						waitAfterAction,
						waitTime,
						beforeUrl,
						finalUrl,
						beforeTitle,
						finalTitle,
						urlChanged: finalUrl !== beforeUrl,
					},
				};
			}

			if (waitAfterAction === "selector" && waitSelector) {
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
