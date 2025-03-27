import {
	NodeConnectionType,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IDataObject,
	type ICredentialDataDecryptedObject,
} from 'n8n-workflow';

// Import puppeteer-core for browser automation
import * as puppeteer from 'puppeteer-core';

// Import actions
import * as formOperation from './actions/form.operation';
import * as extractOperation from './actions/extract.operation';
import * as detectOperation from './actions/detect.operation';

/**
 * Ventriloquist is a custom node for N8N that connects to Bright Data's Browser Scraping Browser
 * via WebSocket and performs systematic Puppeteer functions.
 */
export class Ventriloquist implements INodeType {
	// Static map to store browser sessions
	private static browserSessions: Map<
		string,
		{ browser: puppeteer.Browser; lastUsed: Date; pages: Map<string, puppeteer.Page>; timeout?: number }
	> = new Map();

	// Clean up old sessions (called periodically)
	private static cleanupSessions() {
		const now = new Date();

		for (const [sessionId, session] of this.browserSessions.entries()) {
			// Get the custom timeout or use default (3 minutes)
			const maxAge = session.timeout || 3 * 60 * 1000; // Default to 3 minutes if not specified

			if (now.getTime() - session.lastUsed.getTime() > maxAge) {
				// Close browser for sessions inactive for the specified timeout
				try {
					session.browser.close().catch(() => {
						// Ignore errors during cleanup
					});
				} catch (error) {
					// Ignore errors during cleanup
				} finally {
					this.browserSessions.delete(sessionId);
				}
			}
		}
	}

	// Get or create a browser session
	public static async getOrCreateSession(
		workflowId: string,
		websocketEndpoint: string,
		logger: any,
		sessionTimeout?: number,
	): Promise<{ browser: puppeteer.Browser; sessionId: string; brightDataSessionId: string }> {
		// Clean up old sessions
		this.cleanupSessions();

		// Check if we have an existing session for this workflow
		let session = this.browserSessions.get(workflowId);
		let brightDataSessionId = '';

		// Extract the Bright Data session ID from the WebSocket URL if possible
		try {
			// Bright Data WebSocket URLs typically contain the session ID in a format like:
			// wss://brd-customer-XXX.bright.com/browser/XXX/sessionID/...
			// or wss://brd.superproxy.io:9223/XXXX/XXXX-XXXX-XXXX-XXXX

			// First try to extract from standard format with io:port
			let matches = websocketEndpoint.match(/io:\d+\/([^\/]+\/[^\/\s]+)/);

			// If that doesn't work, try alternative format
			if (!matches || !matches[1]) {
				matches = websocketEndpoint.match(/io\/([^\/]+\/[^\/\s]+)/);
			}

			// If that doesn't work, try the older format
			if (!matches || !matches[1]) {
				matches = websocketEndpoint.match(/browser\/[^\/]+\/([^\/]+)/);
			}

			if (matches && matches[1]) {
				brightDataSessionId = matches[1];
				logger.info(`Detected Bright Data session ID from WebSocket URL: ${brightDataSessionId}`);
			} else {
				// Fallback for other URL formats
				const fallbackMatches = websocketEndpoint.match(/\/([a-f0-9-]{36}|[a-f0-9-]{7,8}\/[a-f0-9-]{36})/i);
				if (fallbackMatches && fallbackMatches[1]) {
					brightDataSessionId = fallbackMatches[1];
					logger.info(`Extracted Bright Data session ID (fallback): ${brightDataSessionId}`);
				} else {
					logger.debug('Could not extract Bright Data session ID from WebSocket URL');
				}
			}
		} catch (error) {
			// Ignore errors in extraction, not critical
			logger.debug('Failed to extract Bright Data session ID from WebSocket URL');
		}

		if (!session) {
			// Create a new browser session
			logger.info('Creating new browser session');
			const browser = await puppeteer.connect({
				browserWSEndpoint: websocketEndpoint,
			});

			// Convert minutes to milliseconds for timeout if provided
			const timeoutMs = sessionTimeout ? sessionTimeout * 60 * 1000 : 3 * 60 * 1000; // Default to 3 minutes

			session = {
				browser,
				lastUsed: new Date(),
				pages: new Map(),
				timeout: timeoutMs, // Store timeout in milliseconds
			};

			this.browserSessions.set(workflowId, session);
			logger.info(`New browser session created with ${timeoutMs}ms timeout (${sessionTimeout || 3} minutes)`);
		} else {
			// Update last used timestamp
			session.lastUsed = new Date();

			// Update timeout if provided and different from current
			if (sessionTimeout !== undefined) {
				const timeoutMs = sessionTimeout * 60 * 1000;
				if (session.timeout !== timeoutMs) {
					session.timeout = timeoutMs;
					logger.info(`Updated session timeout to ${timeoutMs}ms (${sessionTimeout} minutes)`);
				}
			}

			logger.info('Reusing existing browser session');
		}

		// Create a unique ID for the session
		const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

		return { browser: session.browser, sessionId, brightDataSessionId };
	}

	// Store a page in the session
	public static storePage(workflowId: string, sessionId: string, page: puppeteer.Page) {
		const session = this.browserSessions.get(workflowId);
		if (session) {
			session.pages.set(sessionId, page);
		}
	}

	// Get a page from the session
	public static getPage(workflowId: string, sessionId: string): puppeteer.Page | undefined {
		const session = this.browserSessions.get(workflowId);
		if (session) {
			return session.pages.get(sessionId);
		}
		return undefined;
	}

	// Close session and browser
	private static async closeSession(workflowId: string) {
		const session = this.browserSessions.get(workflowId);
		if (session) {
			try {
				await session.browser.close();
			} catch (error) {
				// Ignore errors during cleanup
			} finally {
				this.browserSessions.delete(workflowId);
			}
		}
	}

	// Close all locally tracked browser sessions
	private static async closeAllSessions(logger: any) {
		let closedCount = 0;
		let totalSessions = 0;

		// Create an array of session entries to avoid modification during iteration
		const sessionEntries = Array.from(this.browserSessions.entries());

		logger.info(`Closing locally tracked browser sessions (${sessionEntries.length} sessions found)`);
		logger.info(`Note: This only closes sessions tracked by this N8N instance. Check Bright Data console for orphaned sessions.`);

		// Close each locally tracked session
		for (const [workflowId, session] of sessionEntries) {
			try {
				logger.info(`Closing browser session for workflow ID: ${workflowId}`);

				// First try to close all pages in this browser
				try {
					// Get all pages in this browser
					const pages = await session.browser.pages();
					logger.info(`Found ${pages.length} pages in browser session ${workflowId}`);

					// Close each page
					for (const page of pages) {
						try {
							await page.close();
							logger.info('Successfully closed a page');
						} catch (pageError) {
							logger.warn(`Error closing page: ${pageError}`);
						}
					}

					// Try to close all contexts
					const contexts = await session.browser.browserContexts();
					logger.info(`Found ${contexts.length} browser contexts in session ${workflowId}`);

					// Close each context (except default)
					for (const context of contexts) {
						try {
							// Skip default context as it can't be closed
							if (context !== session.browser.defaultBrowserContext()) {
								await context.close();
								logger.info('Successfully closed a browser context');
							}
						} catch (contextError) {
							logger.warn(`Error closing browser context: ${contextError}`);
						}
					}
				} catch (innerError) {
					logger.warn(`Error during detailed cleanup: ${innerError}`);
				}

				// Finally close the browser itself
				await session.browser.close();
				closedCount++;
				logger.info(`Successfully closed browser for workflow ${workflowId}`);
			} catch (error) {
				logger.warn(`Error closing session for workflow ${workflowId}: ${error}`);
			} finally {
				this.browserSessions.delete(workflowId);
			}
		}

		totalSessions = sessionEntries.length;

		logger.info(`Successfully closed ${closedCount} of ${totalSessions} locally tracked browser sessions`);
		logger.info(`For any remaining sessions in Bright Data, please visit their console: https://brightdata.com/cp/zones/YOUR_ZONE/stats`);

		return { totalSessions, closedSessions: closedCount };
	}

	// Enable the debugger for a Bright Data session
	private static async enableDebugger(page: puppeteer.Page, logger: any): Promise<{ debugUrl: string | null; brightDataDebugInfo: string | null }> {
		try {
			// Create a CDP session to interact with Chrome DevTools Protocol
			const client = await page.target().createCDPSession();

			// Get the current frame ID
			const frameId = (page.mainFrame() as any)._id;

			// Get the debug URL from Bright Data
			// Using any type to handle Bright Data's custom CDP commands
			const response = await (client as any).send('Page.inspect', { frameId });
			const inspectUrl = response?.url;

			let brightDataDebugInfo = null;
			if (inspectUrl) {
				logger.info(`Debug URL available: ${inspectUrl}`);

				// Extract the Bright Data session ID from the URL
				// Need to handle URLs in the format:
				// https://cdn.brightdata.com/static/devtools/129/inspector.html?wss=brd.superproxy.io:9223/c8d53695/5f046fe22-8a0b-477a...
				// We need to extract parts like "c8d53695/5f046fe22-8a0b-477a-ab11-13a741c0b54f"

				// First try to extract from standard format
				let matches = inspectUrl.match(/io:\d+\/([^\/]+\/[^\/&?]+)/);

				// If that doesn't work, try alternative format
				if (!matches || !matches[1]) {
					matches = inspectUrl.match(/io\/([^\/]+\/[^\/&?]+)/);
				}

				if (matches && matches[1]) {
					brightDataDebugInfo = matches[1];
					logger.info(`Bright Data dashboard session ID detected: ${brightDataDebugInfo}`);
				} else {
					// Fallback for other URL formats - at least extract something useful from the URL
					logger.warn(`Could not extract Bright Data session ID from URL format: ${inspectUrl}`);

					// Extract any part that might be a session ID
					const fallbackMatches = inspectUrl.match(/\/([a-f0-9-]{36}|[a-f0-9-]{7,8}\/[a-f0-9-]{36})/i);
					if (fallbackMatches && fallbackMatches[1]) {
						brightDataDebugInfo = fallbackMatches[1];
						logger.info(`Extracted potential Bright Data session ID (fallback): ${brightDataDebugInfo}`);
					}
				}

				return { debugUrl: inspectUrl, brightDataDebugInfo };
			}

			logger.warn('Could not get debug URL from Bright Data');
			return { debugUrl: null, brightDataDebugInfo: null };
		} catch (error) {
			logger.warn(`Failed to enable debugger: ${error}`);
			return { debugUrl: null, brightDataDebugInfo: null };
		}
	}

	description: INodeTypeDescription = {
		displayName: 'Ventriloquist',
		name: 'ventriloquist',
		icon: 'file:ventriloquist.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Automate browser actions with Puppeteer',
		defaults: {
			name: 'Ventriloquist',
			color: '#2244BB',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [
			{
				name: 'brightDataApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Open Browser',
						value: 'open',
						description: 'Open a browser instance',
						action: 'Open a browser instance',
					},
					{
						name: 'Click',
						value: 'click',
						description: 'Click on an element',
						action: 'Click on an element',
					},
					{
						name: 'Detect',
						value: 'detect',
						description: 'Detect if elements exist or match conditions',
						action: 'Detect if elements exist or match conditions',
					},
					{
						name: 'Extract',
						value: 'extract',
						description: 'Extract data from a webpage',
						action: 'Extract data from a webpage',
					},
					{
						name: 'Form',
						value: 'form',
						description: 'Fill out a form',
						action: 'Fill out a form',
					},
					{
						name: 'Close Browser',
						value: 'close',
						description: 'Close the browser session',
						action: 'Close the browser session',
					},
				],
				default: 'open',
			},

			// Properties for 'open' operation
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				placeholder: 'https://example.com',
				description: 'The URL to navigate to',
				displayOptions: {
					show: {
						operation: ['open'],
					},
				},
			},
			{
				displayName: 'Incognito Mode',
				name: 'incognito',
				type: 'boolean',
				default: false,
				description: 'Whether to use incognito mode',
				displayOptions: {
					show: {
						operation: ['open'],
					},
				},
			},
			{
				displayName: 'Capture Screenshot',
				name: 'captureScreenshot',
				type: 'boolean',
				default: true,
				description: 'Whether to capture and return a screenshot in the response',
				displayOptions: {
					show: {
						operation: ['open', 'click', 'form', 'detect', 'extract'],
					},
				},
			},
			{
				displayName: 'Wait Until',
				name: 'waitUntil',
				type: 'options',
				options: [
					{
						name: 'Navigation Complete',
						value: 'networkidle0',
						description: 'Wait until there are no network connections for at least 500ms',
					},
					{
						name: 'Almost Complete',
						value: 'networkidle2',
						description:
							'Wait until there are no more than 2 network connections for at least 500ms',
					},
					{
						name: 'DOM Content Loaded',
						value: 'domcontentloaded',
						description: 'Wait until DOMContentLoaded event is fired',
					},
					{
						name: 'Page Load',
						value: 'load',
						description: 'Wait until load event is fired',
					},
				],
				default: 'networkidle0',
				description: 'When to consider navigation completed',
				displayOptions: {
					show: {
						operation: ['open'],
					},
				},
			},
			{
				displayName: 'Timeout',
				name: 'timeout',
				type: 'number',
				default: 30000,
				description: 'Maximum navigation time in milliseconds',
				displayOptions: {
					show: {
						operation: ['open'],
					},
				},
			},
			{
				displayName: 'Enable Debug Mode',
				name: 'enableDebug',
				type: 'boolean',
				default: false,
				description: 'Enable a debuggable session visible in Bright Data console',
				displayOptions: {
					show: {
						operation: ['open'],
					},
				},
			},
			{
				displayName: 'Session Timeout (Minutes)',
				name: 'sessionTimeout',
				type: 'number',
				default: 3,
				description: 'Close the browser session automatically after this many minutes of inactivity. Lower values help prevent orphaned sessions in Bright Data.',
				hint: 'The session will close automatically after this period of inactivity to prevent orphaned sessions',
				displayOptions: {
					show: {
						operation: ['open'],
					},
				},
			},
			{
				displayName: 'Continue On Fail',
				name: 'continueOnFail',
				type: 'boolean',
				default: true,
				description: 'Whether to continue execution even when browser operations fail (cannot connect or navigate)',
				displayOptions: {
					show: {
						operation: ['open'],
					},
				},
			},

			// Properties for 'click' operation
			{
				displayName: 'Session ID',
				name: 'explicitSessionId',
				type: 'string',
				default: '',
				description: 'Session ID to use (if not provided, will try to use session from previous operations)',
				displayOptions: {
					show: {
						operation: ['click', 'detect', 'extract', 'form'],
					},
				},
			},
			{
				displayName: 'Selector',
				name: 'selector',
				type: 'string',
				default: '',
				placeholder: '#button, .link, div[data-id="123"]',
				description: 'CSS selector of the element to click',
				displayOptions: {
					show: {
						operation: ['click'],
					},
				},
				required: true,
			},
			{
				displayName: 'Wait Before Click Selector',
				name: 'waitBeforeClickSelector',
				type: 'string',
				default: '',
				placeholder: '#element-to-wait-for',
				description:
					'Wait for this element to appear before clicking the target element (optional)',
				displayOptions: {
					show: {
						operation: ['click'],
					},
				},
			},
			{
				displayName: 'Timeout',
				name: 'timeout',
				type: 'number',
				default: 30000,
				description: 'Maximum wait time in milliseconds',
				displayOptions: {
					show: {
						operation: ['click'],
					},
				},
			},
			{
				displayName: 'Retries',
				name: 'retries',
				type: 'number',
				default: 0,
				description: 'Number of retries if click fails',
				displayOptions: {
					show: {
						operation: ['click'],
					},
				},
			},

			// Properties for 'form' operation
			...formOperation.description,

			// Properties for 'detect' operation
			...detectOperation.description,

			// Properties for 'extract' operation
			...extractOperation.description,

			// Properties for 'close' operation
			{
				displayName: 'Close Mode',
				name: 'closeMode',
				type: 'options',
				options: [
					{
						name: 'Close Session',
						value: 'session',
						description: 'Close a specific browser session',
					},
					{
						name: 'Close All Sessions',
						value: 'all',
						description: 'Close all browser sessions',
					},
					{
						name: 'Close Multiple Sessions',
						value: 'multiple',
						description: 'Close a list of specific browser sessions',
					},
				],
				default: 'session',
				description: 'How to close browser sessions',
				displayOptions: {
					show: {
						operation: ['close'],
					},
				},
			},
			{
				displayName: 'Session ID',
				name: 'explicitSessionId',
				type: 'string',
				default: '',
				description: 'Session ID to close',
				displayOptions: {
					show: {
						operation: ['close'],
						closeMode: ['session'],
					},
				},
			},
			{
				displayName: 'Session IDs',
				name: 'sessionIds',
				type: 'string',
				typeOptions: {
					multipleValues: true,
				},
				default: [],
				description: 'List of session IDs to close',
				displayOptions: {
					show: {
						operation: ['close'],
						closeMode: ['multiple'],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Get credentials
		const credentials = (await this.getCredentials(
			'brightDataApi',
		)) as ICredentialDataDecryptedObject;

		if (!credentials) {
			throw new Error('No credentials provided for Bright Data API');
		}

		const websocketEndpoint = credentials.websocketEndpoint as string;

		if (!websocketEndpoint) {
			throw new Error('WebSocket Endpoint is required');
		}

		// Process all items
		for (let i = 0; i < items.length; i++) {
			const operation = this.getNodeParameter('operation', i) as string;
			const workflowId = this.getWorkflow()?.id?.toString() || `default_${Date.now()}`;

			try {
				if (operation === 'open') {
					const url = this.getNodeParameter('url', i) as string;
					const incognito = this.getNodeParameter('incognito', i, false) as boolean;
					const waitUntil = this.getNodeParameter(
						'waitUntil',
						i,
						'networkidle0',
					) as puppeteer.PuppeteerLifeCycleEvent;
					const timeout = this.getNodeParameter('timeout', i, 30000) as number;
					const enableDebug = this.getNodeParameter('enableDebug', i, false) as boolean;
					const captureScreenshot = this.getNodeParameter('captureScreenshot', i, true) as boolean;
					const sessionTimeout = this.getNodeParameter('sessionTimeout', i, 3) as number;
					const continueOnFail = this.getNodeParameter('continueOnFail', i, true) as boolean;

					// Double the timeout for Bright Data as recommended in their docs
					const brightDataTimeout = timeout * 2;

					try {
						// Get or create a browser session
						const { browser, sessionId, brightDataSessionId } = await Ventriloquist.getOrCreateSession(
							workflowId,
							websocketEndpoint,
							this.logger,
							sessionTimeout,
						);

						// Create a new page
						const context = incognito
							? (await browser.browserContexts()[0]) || browser.defaultBrowserContext()
							: browser.defaultBrowserContext();
						const page = await context.newPage();

						// Store the page in the session
						Ventriloquist.storePage(workflowId, sessionId, page);

						// Enable debugging if requested
						let debugUrl = null;
						let brightDataDebugInfo = null;
						if (enableDebug) {
							const debugInfo = await Ventriloquist.enableDebugger(page, this.logger);
							debugUrl = debugInfo.debugUrl;
							brightDataDebugInfo = debugInfo.brightDataDebugInfo;
						}

						// Navigate to URL with increased timeout for Bright Data
						this.logger.info(`Navigating to ${url} with timeout ${brightDataTimeout}ms`);
						const response = await page.goto(url, {
							waitUntil,
							timeout: brightDataTimeout,
						});

						// Extract some basic page information
						const title = await page.title();
						const currentUrl = page.url();
						const status = response ? response.status() : null;

						// Return page data
						const responseData: IDataObject = {
							success: true,
							operation,
							url: currentUrl,
							title,
							status,
							sessionId, // Include the sessionId in the output for subsequent operations
							incognito,
							timestamp: new Date().toISOString(),
							brightDataSessionId,
						};

						// Capture screenshot if requested
						if (captureScreenshot) {
							// Take a screenshot (base64 encoded)
							const screenshot = await page.screenshot({
								encoding: 'base64',
								type: 'jpeg',
								quality: 80,
							});
							responseData.screenshot = `data:image/jpeg;base64,${screenshot}`;
						}

						// Include debug URL if available
						if (debugUrl) {
							responseData.debugUrl = debugUrl;
						}

						// Include Bright Data dashboard session ID if available
						if (brightDataDebugInfo) {
							responseData.brightDataDebugInfo = brightDataDebugInfo;
						}

						returnData.push({
							json: responseData,
						});
					} catch (error) {
						// Handle the error based on continueOnFail setting
						if (!continueOnFail) {
							// If we shouldn't continue on fail, rethrow the error
							throw new Error(`Open browser operation failed: ${(error as Error).message}`);
						}

						// Otherwise, return an error response and continue
						returnData.push({
							json: {
								success: false,
								operation,
								error: (error as Error).message,
								url,
								timestamp: new Date().toISOString(),
							},
						});
					}
				} else if (operation === 'click') {
					// Try to get sessionId from previous operations
					let sessionId = '';
					const captureScreenshot = this.getNodeParameter('captureScreenshot', i, true) as boolean;

					// First, check if an explicit session ID was provided
					const explicitSessionId = this.getNodeParameter('explicitSessionId', i, '') as string;
					if (explicitSessionId) {
						sessionId = explicitSessionId;
						this.logger.info(`Using explicitly provided session ID: ${sessionId}`);
					}
					// If not explicit ID provided, try to get sessionId from the current item
					else if (items[i].json && items[i].json.sessionId) {
						sessionId = items[i].json.sessionId as string;
					}
					// For backward compatibility, also check for pageId
					else if (items[i].json && items[i].json.pageId) {
						sessionId = items[i].json.pageId as string;
						this.logger.info('Using legacy pageId as sessionId for compatibility');
					}

					// If no sessionId in current item, look at the input items for a sessionId
					if (!sessionId) {
						for (const item of items) {
							if (item.json && item.json.sessionId) {
								sessionId = item.json.sessionId as string;
								break;
							}
							// For backward compatibility
							else if (item.json && item.json.pageId) {
								sessionId = item.json.pageId as string;
								this.logger.info('Using legacy pageId as sessionId for compatibility');
								break;
							}
						}
					}

					// Get the parameters for the click operation
					const selector = this.getNodeParameter('selector', i) as string;
					const waitBeforeClickSelector = this.getNodeParameter(
						'waitBeforeClickSelector',
						i,
						'',
					) as string;
					const timeout = this.getNodeParameter('timeout', i, 30000) as number;
					const retries = this.getNodeParameter('retries', i, 0) as number;

					// Double the timeout for Bright Data as recommended in their docs
					const brightDataTimeout = timeout * 2;

					// Get or create a browser session
					const { browser, brightDataSessionId } = await Ventriloquist.getOrCreateSession(
						workflowId,
						websocketEndpoint,
						this.logger,
						undefined, // Use the existing timeout set during open
					);

					// Try to get existing page from session
					let page: puppeteer.Page | undefined;

					if (sessionId) {
						page = Ventriloquist.getPage(workflowId, sessionId);
						this.logger.info(`Found existing page with session ID: ${sessionId}`);
					}

					// If no existing page, get the first available page or create a new one
					if (!page) {
						const pages = await browser.pages();
						page = pages.length > 0 ? pages[0] : await browser.newPage();
						sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
						Ventriloquist.storePage(workflowId, sessionId, page);
						this.logger.info(`Created new page with session ID: ${sessionId}`);
					}

					// Get page info for debugging
					const pageTitle = await page.title();
					const pageUrl = page.url();

					this.logger.info(`Current page URL: ${pageUrl}, title: ${pageTitle}`);

					// Ensure the page is active before clicking
					try {
						// Bring page to front
						await page.bringToFront();

						// Force page activation by performing a trivial interaction
						await page.evaluate(() => {
							// Small scroll to trigger activity
							window.scrollBy(0, 1);
							return document.title; // Just to ensure execution
						});

						this.logger.info('Activated page before clicking');
					} catch (activationErr) {
						this.logger.warn(`Failed to activate page: ${activationErr}`);
					}

					// If waitBeforeClickSelector is provided, wait for it first
					if (waitBeforeClickSelector) {
						this.logger.info(`Waiting for selector "${waitBeforeClickSelector}" before clicking`);
						await page.waitForSelector(waitBeforeClickSelector, { timeout: brightDataTimeout });
					}

					let success = false;
					let attempt = 0;
					let error: Error | null = null;

					// Find all available elements with IDs for debugging purposes
					const allElementsWithIds = await page.evaluate(() => {
						const elements = document.querySelectorAll('[id]');
						return Array.from(elements).map((el) => ({
							id: el.id,
							tagName: (el as HTMLElement).tagName.toLowerCase(),
							type: (el as HTMLElement).getAttribute('type'),
							text: (el as HTMLElement).innerText.slice(0, 50),
						}));
					});

					// Check if the selector exists on the page
					const selectorExists = await page.evaluate((sel) => {
						const element = document.querySelector(sel);
						return element !== null;
					}, selector);

					// Get more detailed information about the element for debugging
					const elementDetails = await page.evaluate((sel) => {
						const element = document.querySelector(sel);
						if (!element) return null;

						return {
							tagName: element.tagName?.toLowerCase(),
							id: element.id || null,
							className: element.className || null,
							text: element.textContent?.trim().substring(0, 100) || null,
							isVisible: !!(
								(element as HTMLElement).offsetWidth ||
								(element as HTMLElement).offsetHeight ||
								element.getClientRects().length
							),
							disabled: (element as HTMLElement).hasAttribute('disabled') ||
								(element as HTMLElement).getAttribute('aria-disabled') === 'true',
							attributes: Array.from(element.attributes || [])
								.map(attr => ({ name: attr.name, value: attr.value }))
								.filter(attr => !['style', 'class'].includes(attr.name))
								.slice(0, 10), // Limit to 10 attributes
							boundingRect: element.getBoundingClientRect && {
								top: element.getBoundingClientRect().top,
								left: element.getBoundingClientRect().left,
								width: element.getBoundingClientRect().width,
								height: element.getBoundingClientRect().height,
							}
						};
					}, selector);

					this.logger.info(`Selector "${selector}" exists on page: ${selectorExists}`);
					if (elementDetails) {
						this.logger.info(`Element details: ${JSON.stringify(elementDetails)}`);
					}
					this.logger.info(`Available IDs on page: ${JSON.stringify(allElementsWithIds)}`);

					// Try to click with retries
					while (!success && attempt <= retries) {
						try {
							// Wait for the selector to be available
							this.logger.info(
								`Waiting for selector "${selector}" (attempt ${attempt + 1}/${retries + 1})`,
							);
							await page.waitForSelector(selector, { timeout: brightDataTimeout });

							// Try different click methods for better reliability
							try {
								// First try Puppeteer's native click
								this.logger.info(`Clicking on selector "${selector}" using Puppeteer's click()`);
								await page.click(selector);
								success = true;
							} catch (clickErr) {
								this.logger.warn(`Native click failed: ${clickErr.message}, trying alternative method...`);

								// If that fails, try JavaScript click execution
								this.logger.info(`Clicking on selector "${selector}" using JavaScript execution`);
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
									this.logger.info('JavaScript click was successful');
									success = true;
								} else {
									throw new Error('All click methods failed');
								}
							}
						} catch (err: any) {
							error = err as Error;
							this.logger.warn(`Click attempt ${attempt + 1} failed: ${err.message}`);
							attempt++;

							// If there are more retries, wait a bit before retrying
							if (attempt <= retries) {
								await new Promise((resolve) => setTimeout(resolve, 1000));
							}
						}
					}

					// Try to get information about the page HTML for debugging
					const pageHtml = await page.evaluate(() => {
						return document.documentElement.outerHTML.slice(0, 1000) + '...'; // First 1000 characters
					});

					// Get updated page info after click
					const updatedPageTitle = await page.title();
					const updatedPageUrl = page.url();

					// Prepare base response data
					const baseResponseData: IDataObject = {
						success: success,
						operation,
						selector,
						attempts: success ? attempt + 1 : attempt,
						url: success ? updatedPageUrl : pageUrl,
						title: success ? updatedPageTitle : pageTitle,
						sessionId, // Include the sessionId for subsequent operations
						foundInPage: selectorExists,
						availableIds: allElementsWithIds,
						pageHtmlPreview: pageHtml.substring(0, 500) + '...',
						timestamp: new Date().toISOString(),
						brightDataSessionId,
					};

					// Add screenshot if requested
					if (captureScreenshot) {
						// Take a screenshot after the click (or attempt)
						const screenshot = await page.screenshot({
							encoding: 'base64',
							type: 'jpeg',
							quality: 80,
						});
						baseResponseData.screenshot = `data:image/jpeg;base64,${screenshot}`;
					}

					// Add error information if not successful
					if (!success) {
						baseResponseData.error = error ? error.message : 'Click operation failed after all retries';
					}

					// Return response
					returnData.push({
						json: baseResponseData,
					});
				} else if (operation === 'form') {
					// Execute form operation
					const result = await formOperation.execute.call(
						this,
						i,
						websocketEndpoint,
						workflowId,
					);
					returnData.push(result);
				} else if (operation === 'detect') {
					// Execute detect operation
					const result = await detectOperation.execute.call(
						this,
						i,
						websocketEndpoint,
						workflowId,
					);
					returnData.push(result);
				} else if (operation === 'extract') {
					// Execute extract operation
					const result = await extractOperation.execute.call(
						this,
						i,
						websocketEndpoint,
						workflowId,
					);
					returnData.push(result);
				} else if (operation === 'close') {
					// Close browser sessions based on the selected mode
					const closeMode = this.getNodeParameter('closeMode', i, 'session') as string;

					if (closeMode === 'session') {
						// Close a specific session
						let sessionId = '';

						// First, check if an explicit session ID was provided
						const explicitSessionId = this.getNodeParameter('explicitSessionId', i, '') as string;
						if (explicitSessionId) {
							sessionId = explicitSessionId;
							this.logger.info(`Using explicitly provided session ID: ${sessionId}`);
						}
						// If not, try to get sessionId from the current item
						else if (items[i].json?.sessionId) {
							sessionId = items[i].json.sessionId as string;
						}
						// For backward compatibility, also check for pageId
						else if (items[i].json?.pageId) {
							sessionId = items[i].json.pageId as string;
							this.logger.info('Using legacy pageId as sessionId for compatibility');
						}

						// If we found a sessionId, close it
						if (sessionId) {
							// Get existing page from session
							const page = Ventriloquist.getPage(workflowId, sessionId);
							if (page) {
								await page.close();
								this.logger.info(`Closed page with session ID: ${sessionId}`);
							} else {
								this.logger.warn(`No page found with session ID: ${sessionId}`);
							}

							// Return success
							returnData.push({
								json: {
									success: true,
									operation,
									closeMode,
									sessionId,
									message: `Browser session ${sessionId} closed successfully`,
									timestamp: new Date().toISOString(),
								},
							});
						} else {
							// No session ID found
							returnData.push({
								json: {
									success: false,
									operation,
									closeMode,
									error: 'No session ID provided or found in input',
									timestamp: new Date().toISOString(),
								},
							});
						}
					} else if (closeMode === 'all') {
						// Close all browser sessions
						const closeResult = await Ventriloquist.closeAllSessions(this.logger);

						// Return success with details
						returnData.push({
							json: {
								success: true,
								operation,
								closeMode,
								totalSessions: closeResult.totalSessions,
								closedSessions: closeResult.closedSessions,
								message: `Closed ${closeResult.closedSessions} of ${closeResult.totalSessions} locally tracked browser sessions`,
								note: "This operation only closes sessions tracked by this N8N instance. To close orphaned sessions, please visit the Bright Data console.",
								brightDataConsoleUrl: "https://brightdata.com/cp/zones",
								timestamp: new Date().toISOString(),
							},
						});
					} else if (closeMode === 'multiple') {
						// Close a list of specific sessions
						const sessionIds = this.getNodeParameter('sessionIds', i, []) as string[];
						const closedSessions: string[] = [];
						const failedSessions: string[] = [];

						// Process each session ID
						for (const sessionId of sessionIds) {
							try {
								// Get existing page from session
								const page = Ventriloquist.getPage(workflowId, sessionId);
								if (page) {
									await page.close();
									closedSessions.push(sessionId);
									this.logger.info(`Closed page with session ID: ${sessionId}`);
								} else {
									failedSessions.push(sessionId);
									this.logger.warn(`No page found with session ID: ${sessionId}`);
								}
							} catch (error) {
								failedSessions.push(sessionId);
								this.logger.error(`Error closing session ${sessionId}: ${error}`);
							}
						}

						// Return result
						returnData.push({
							json: {
								success: true,
								operation,
								closeMode,
								closedSessions,
								failedSessions,
								message: `Closed ${closedSessions.length} of ${sessionIds.length} sessions successfully`,
								timestamp: new Date().toISOString(),
							},
						});
					}
				}
			} catch (error: any) {
				// Clean up the session if there's an error
				try {
					await Ventriloquist.closeSession(workflowId);
				} catch (cleanupError) {
					// Ignore cleanup errors
				}

				if (this.continueOnFail()) {
					returnData.push({
						json: {
							success: false,
							error: error.message || 'An unknown error occurred',
							stack: error.stack || '',
						},
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
