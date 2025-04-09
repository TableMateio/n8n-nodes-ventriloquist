import type { Browser, Page } from "puppeteer-core";
import type { IDataObject, Logger as ILogger } from "n8n-workflow";
import { formatOperationLog } from "./resultUtils";
// import { SessionManager } from './sessionManager';

/**
 * Interface for reconnection result
 */
export interface ISessionReconnectionResult {
	success: boolean;
	reconnected: boolean;
	pageReconnected: boolean;
	contextDestroyed: boolean;
	activePage?: Page;
	details: IDataObject;
}

/**
 * Centralized utility to handle page reconnection after navigation or context destruction
 * This should be used by all middleware actions to ensure consistent reconnection behavior
 */
export async function reconnectAfterNavigation(
	browser: Browser,
	originalPage: Page,
	beforeUrl: string,
	options: {
		logger: ILogger;
		nodeName: string;
		nodeId: string;
		index: number;
		sessionId?: string;
		waitTime?: number;
		recoveryDelay?: number;
	},
): Promise<ISessionReconnectionResult> {
	const {
		logger,
		nodeName,
		nodeId,
		index,
		sessionId,
		// waitTime = 20000,
		recoveryDelay = 5000,
	} = options;

	// let reconnected = false;
	// let pageReconnected = false;
	let newPage: Page | undefined;
	let contextDestroyed = false;

	// Log that we're attempting reconnection
	logger.info(
		formatOperationLog(
			"SessionUtils",
			nodeName,
			nodeId,
			index,
			"Attempting to reconnect after possible navigation or context destruction",
		),
	);

	// Add a recovery delay to allow navigation to complete
	logger.info(
		formatOperationLog(
			"SessionUtils",
			nodeName,
			nodeId,
			index,
			`Adding recovery delay (${recoveryDelay}ms)`,
		),
	);
	await new Promise((resolve) => setTimeout(resolve, recoveryDelay));

	try {
		// First, check if the browser is still connected
		try {
			await browser.version();
			// reconnected = true;
			logger.info(
				formatOperationLog(
					"SessionUtils",
					nodeName,
					nodeId,
					index,
					"Browser connection is still active",
				),
			);
		} catch (error) {
			logger.warn(
				formatOperationLog(
					"SessionUtils",
					nodeName,
					nodeId,
					index,
					`Browser connection lost: ${(error as Error).message}`,
				),
			);

			// If we have a session ID, try to reconnect via SessionManager
			if (sessionId) {
				try {
					logger.info(
						formatOperationLog(
							"SessionUtils",
							nodeName,
							nodeId,
							index,
							`Attempting to reconnect using session ID: ${sessionId}`,
						),
					);

					// This will be implemented by the caller who has access to the SessionManager
					return {
						success: false,
						reconnected: false,
						pageReconnected: false,
						contextDestroyed: true,
						details: {
							error:
								"Browser connection lost and requires full session reconnection",
							sessionId,
							requiresSessionManagerReconnect: true,
						},
					};
				} catch (reconnectError) {
					logger.error(
						formatOperationLog(
							"SessionUtils",
							nodeName,
							nodeId,
							index,
							`Failed to reconnect session: ${(reconnectError as Error).message}`,
						),
					);

					return {
						success: false,
						reconnected: false,
						pageReconnected: false,
						contextDestroyed: true,
						details: {
							error: `Failed to reconnect session: ${(reconnectError as Error).message}`,
							sessionId,
						},
					};
				}
			}

			// If we don't have a session ID, we can't reconnect
			return {
				success: false,
				reconnected: false,
				pageReconnected: false,
				contextDestroyed: true,
				details: {
					error:
						"Browser connection lost and no session ID provided for reconnection",
				},
			};
		}

		// Check if the original page context is still valid
		try {
			// Try a simple operation on the original page
			await originalPage.url();

			logger.info(
				formatOperationLog(
					"SessionUtils",
					nodeName,
					nodeId,
					index,
					"Original page context is still valid",
				),
			);

			// Page is still valid, no need to reconnect
			return {
				success: true,
				reconnected: true,
				pageReconnected: false,
				contextDestroyed: false,
				activePage: originalPage,
				details: {
					info: "Page context is still valid, no reconnection needed",
				},
			};
		} catch (pageError) {
			// Check if this is a context destruction error
			const errorMessage = (pageError as Error).message;
			contextDestroyed =
				errorMessage.includes("context was destroyed") ||
				errorMessage.includes("Execution context") ||
				errorMessage.includes("detached") ||
				errorMessage.includes("Target closed");

			if (contextDestroyed) {
				logger.info(
					formatOperationLog(
						"SessionUtils",
						nodeName,
						nodeId,
						index,
						"Original page context was destroyed - this indicates navigation occurred",
					),
				);
			} else {
				logger.warn(
					formatOperationLog(
						"SessionUtils",
						nodeName,
						nodeId,
						index,
						`Page error but not context destruction: ${errorMessage}`,
					),
				);
			}
		}

		// If we reach here, we need to get a new page instance
		try {
			// Get all pages from the browser
			const pages = await browser.pages();

			if (pages.length === 0) {
				logger.warn(
					formatOperationLog(
						"SessionUtils",
						nodeName,
						nodeId,
						index,
						"No pages found in browser after context destruction",
					),
				);

				return {
					success: false,
					reconnected: true,
					pageReconnected: false,
					contextDestroyed,
					details: {
						error: "No pages found in browser after context destruction",
					},
				};
			}

			// Use the last page as it's likely the active one after navigation
			newPage = pages[pages.length - 1];
			// pageReconnected = true;

			logger.info(
				formatOperationLog(
					"SessionUtils",
					nodeName,
					nodeId,
					index,
					`Successfully reconnected to page (${pages.length} pages found)`,
				),
			);

			// Try to get the current URL for validation
			try {
				const currentUrl = await newPage.url();
				const currentTitle = await newPage.title();
				const urlChanged = currentUrl !== beforeUrl;

				logger.info(
					formatOperationLog(
						"SessionUtils",
						nodeName,
						nodeId,
						index,
						`Reconnected page state - URL: ${currentUrl}, Title: ${currentTitle}, URL changed: ${urlChanged}`,
					),
				);

				// If we have a session ID, register this new page with the session manager
				if (sessionId) {
					try {
						// This is a hint for the caller to register this page
						logger.info(
							formatOperationLog(
								"SessionUtils",
								nodeName,
								nodeId,
								index,
								`Page reconnected successfully - session ID: ${sessionId}`,
							),
						);
					} catch (storageError) {
						logger.warn(
							formatOperationLog(
								"SessionUtils",
								nodeName,
								nodeId,
								index,
								`Failed to store reconnected page: ${(storageError as Error).message}`,
							),
						);
						// Continue anyway as we have a valid page
					}
				}

				return {
					success: true,
					reconnected: true,
					pageReconnected: true,
					contextDestroyed,
					activePage: newPage,
					details: {
						beforeUrl,
						currentUrl,
						currentTitle,
						urlChanged,
						pageCount: pages.length,
					},
				};
			} catch (urlError) {
				logger.warn(
					formatOperationLog(
						"SessionUtils",
						nodeName,
						nodeId,
						index,
						`Could not get URL of reconnected page: ${(urlError as Error).message}`,
					),
				);

				// Still return success since we have a page object
				return {
					success: true,
					reconnected: true,
					pageReconnected: true,
					contextDestroyed,
					activePage: newPage,
					details: {
						warning: `Could not get URL of reconnected page: ${(urlError as Error).message}`,
						pageCount: pages.length,
					},
				};
			}
		} catch (reconnectError) {
			logger.error(
				formatOperationLog(
					"SessionUtils",
					nodeName,
					nodeId,
					index,
					`Failed to reconnect to page: ${(reconnectError as Error).message}`,
				),
			);

			return {
				success: false,
				reconnected: true,
				pageReconnected: false,
				contextDestroyed,
				details: {
					error: `Failed to reconnect to page: ${(reconnectError as Error).message}`,
				},
			};
		}
	} catch (overallError) {
		// Handle any errors in the overall reconnection process
		logger.error(
			formatOperationLog(
				"SessionUtils",
				nodeName,
				nodeId,
				index,
				`Error during reconnection process: ${(overallError as Error).message}`,
			),
		);

		return {
			success: false,
			reconnected: false,
			pageReconnected: false,
			contextDestroyed: false,
			details: {
				error: `Error during reconnection process: ${(overallError as Error).message}`,
			},
		};
	}
}

/**
 * Check if a URL change has occurred
 * This compares complete URLs as well as individual components
 */
export function detectUrlChange(
	beforeUrl: string,
	afterUrl: string,
	options: {
		checkComponents?: boolean; // Whether to also check individual URL components
	},
): {
	changed: boolean;
	pathChanged?: boolean;
	queryChanged?: boolean;
	hashChanged?: boolean;
	details: IDataObject;
} {
	const { checkComponents = true } = options;

	// Quick check for exact match
	if (beforeUrl === afterUrl) {
		return {
			changed: false,
			details: {
				beforeUrl,
				afterUrl,
				exact: true,
			},
		};
	}

	// URLs are different, so there's a change
	const result = {
		changed: true,
		details: {
			beforeUrl,
			afterUrl,
			exact: false,
		},
	};

	// If we don't need component analysis, return early
	if (!checkComponents) {
		return result;
	}

	try {
		// Parse URLs to check individual components
		const beforeParsed = new URL(beforeUrl);
		const afterParsed = new URL(afterUrl);

		// Check individual components
		const pathChanged = beforeParsed.pathname !== afterParsed.pathname;
		const queryChanged = beforeParsed.search !== afterParsed.search;
		const hashChanged = beforeParsed.hash !== afterParsed.hash;
		const hostChanged = beforeParsed.host !== afterParsed.host;

		return {
			changed: true,
			pathChanged,
			queryChanged,
			hashChanged,
			details: {
				beforeUrl,
				afterUrl,
				pathChanged,
				queryChanged,
				hashChanged,
				hostChanged,
				beforePath: beforeParsed.pathname,
				afterPath: afterParsed.pathname,
				beforeQuery: beforeParsed.search,
				afterQuery: afterParsed.search,
				beforeHash: beforeParsed.hash,
				afterHash: afterParsed.hash,
				beforeHost: beforeParsed.host,
				afterHost: afterParsed.host,
			},
		};
	} catch (error) {
		// If URL parsing fails, just return the basic result
		return {
			changed: true,
			details: {
				beforeUrl,
				afterUrl,
				parseError: (error as Error).message,
			},
		};
	}
}

/**
 * Attempts to find the currently active page within a browser session.
 * Assumes the last page in the list is the active one.
 * Performs basic validation (exists, not closed, responsive).
 *
 * @param browser - The Puppeteer Browser instance.
 * @param logger - Logger instance.
 * @returns The validated Page object or null if no active page found.
 */
export async function getActivePage(
	browser: Browser,
	logger: ILogger,
): Promise<Page | null> {
	const logPrefix = "[sessionUtils][getActivePage]";
	if (!browser || !browser.isConnected()) {
		logger.warn(`${logPrefix} Browser provided is null or not connected.`);
		return null;
	}

	try {
		let pages = await browser.pages();
		logger.info(`${logPrefix} Found ${pages.length} pages initially.`);

		// Filter out about:blank pages unless it's the ONLY page
		const nonBlankPages = pages.filter((p) => p.url() !== "about:blank");
		if (nonBlankPages.length > 0) {
			pages = nonBlankPages;
			logger.info(`${logPrefix} Filtered to ${pages.length} non-blank pages.`);
		} else if (pages.length > 1) {
			// If only blank pages remain, but there was more than one, it's ambiguous
			logger.warn(
				`${logPrefix} Multiple about:blank pages found. Cannot reliably determine active page.`,
			);
			return null;
		} // else: if only one page exists and it's about:blank, we'll use it.

		if (pages.length === 0) {
			logger.warn(`${logPrefix} No suitable pages found after filtering.`);
			return null;
		}

		const page = pages[pages.length - 1]; // Assume last page in the filtered list is active
		const selectedUrl = page.url(); // Get URL for logging
		logger.info(`${logPrefix} Selected page with URL: ${selectedUrl}`);

		if (page.isClosed()) {
			// Check if the selected page is closed
			logger.warn(`${logPrefix} Selected page (${selectedUrl}) is closed.`);
			return null;
		}

		// Quick responsiveness check
		try {
			// Use a slightly longer timeout for responsiveness check
			await page.evaluate(() => true, { timeout: 2000 });
			logger.info(`${logPrefix} Selected page (${selectedUrl}) is responsive.`);
			return page;
		} catch (evalError) {
			const errorMsg = (evalError as Error).message;
			// Specifically check for context destruction errors
			if (
				errorMsg.includes("context was destroyed") ||
				errorMsg.includes("Target closed")
			) {
				logger.warn(
					`${logPrefix} Selected page (${selectedUrl}) context was destroyed: ${errorMsg}`,
				);
			} else {
				logger.warn(
					`${logPrefix} Selected page (${selectedUrl}) failed responsiveness check: ${errorMsg}`,
				);
			}
			return null;
		}
	} catch (error) {
		logger.error(
			`${logPrefix} Error getting pages from browser: ${(error as Error).message}`,
		);
		return null;
	}
}
