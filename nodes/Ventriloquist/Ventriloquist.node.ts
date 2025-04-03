import {
	NodeConnectionType,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IDataObject,
	type ICredentialDataDecryptedObject,
	type INodeParameters,
	type INodePropertyOptions,
	type ILoadOptionsFunctions,
} from 'n8n-workflow';

// Import puppeteer-core for browser automation
import * as puppeteer from 'puppeteer-core';

// Import actions
import * as formOperation from './actions/form.operation';
import * as extractOperation from './actions/extract.operation';
import * as detectOperation from './actions/detect.operation';
import * as decisionOperation from './actions/decision.operation';
import * as openOperation from './actions/open.operation';

/**
 * Configure outputs for decision operation based on routing parameters
 */
const configureDecisionOutputs = (parameters: INodeParameters) => {
	// Default to single output if not using routing
	if (parameters.enableRouting !== true) {
		return [NodeConnectionType.Main];
	}

	// Get route count, default to 2 if not specified
	const routeCount = (parameters.routeCount ?? 2) as number;
	if (routeCount < 1) {
		return [NodeConnectionType.Main];
	}

	// Create specific number of outputs
	const outputs = [];
	for (let i = 0; i < routeCount; i++) {
		outputs.push(NodeConnectionType.Main);
	}

	return outputs;
};

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
		forceNew: boolean = false,
	): Promise<{ browser: puppeteer.Browser; sessionId: string; brightDataSessionId: string }> {
		// Clean up old sessions
		this.cleanupSessions();

		// Create unique workflowId if forceNew is true to force a new session
		const sessionWorkflowId = forceNew ? `${workflowId}_${Date.now()}` : workflowId;

		// Check if we have an existing session for this workflow
		let session = this.browserSessions.get(sessionWorkflowId);
		let brightDataSessionId = '';

		// Extract the Bright Data session ID from the WebSocket URL if possible
		try {
			// Bright Data WebSocket URLs typically contain the session ID in a format like:
			// wss://brd-customer-XXX.bright.com/browser/XXX/sessionID/...
			// or wss://brd.superproxy.io:9223/XXXX/XXXX-XXXX-XXXX-XXXX

			// First try to extract from standard format with io:port
			let matches = websocketEndpoint.match(/io:\d+\/([^\/]+\/[^\/\s]+)/);

			// If that doesn't work, try alternative format
			if (!matches?.length) {
				matches = websocketEndpoint.match(/io\/([^\/]+\/[^\/\s]+)/);
			}

			// If that doesn't work, try the older format
			if (!matches?.length) {
				matches = websocketEndpoint.match(/browser\/[^\/]+\/([^\/]+)/);
			}

			if (matches?.[1]) {
				brightDataSessionId = matches[1];
				logger.info(`Detected Bright Data session ID from WebSocket URL: ${brightDataSessionId}`);
			} else {
				// Fallback for other URL formats
				const fallbackMatches = websocketEndpoint.match(/\/([a-f0-9-]{36}|[a-f0-9-]{7,8}\/[a-f0-9-]{36})/i);
				if (fallbackMatches?.[1]) {
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
			logger.info(forceNew
				? 'Forcing creation of new browser session (required for Page.navigate)'
				: 'Creating new browser session');
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

			this.browserSessions.set(sessionWorkflowId, session);
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

	// Enable debugger for a Bright Data session
	public static async enableDebugger(
		page: puppeteer.Page,
		logger: any
	): Promise<{ debugUrl: string | null; brightDataDebugInfo: string | null }> {
		// Initialize debug information
		let debugUrl: string | null = null;
		let brightDataDebugInfo: string | null = null;

		try {
			// Note: Currently not possible to directly get debug URL from Bright Data via Puppeteer
			// This is mostly a placeholder for future enhancement
			logger.info('Debug mode enabled for this session');

			// Try to get session info from browser
			try {
				const client = await page.target().createCDPSession();
				const info = await client.send('Browser.getVersion');
				if (info && info.product) {
					brightDataDebugInfo = info.product;
					logger.info(`Browser debug info: ${brightDataDebugInfo}`);
				}
			} catch (debugError) {
				logger.warn(`Could not get detailed debug info: ${(debugError as Error).message}`);
			}

			return { debugUrl, brightDataDebugInfo };
		} catch (error) {
			logger.warn(`Failed to enable debugger: ${(error as Error).message}`);
			return { debugUrl: null, brightDataDebugInfo: null };
		}
	}

	// Check if there are multiple conditions defined
	public static hasMultipleConditions(nodeParameters: IDataObject): boolean {
		try {
			// Get the decision groups from node parameters
			const conditionGroups = nodeParameters.conditionGroups as IDataObject;
			if (!conditionGroups || !conditionGroups.groups || !Array.isArray(conditionGroups.groups)) {
				return false;
			}

			// For each group, check if it has multiple conditions
			for (const group of conditionGroups.groups as IDataObject[]) {
				if (group.conditions && typeof group.conditions === 'object') {
					const conditions = group.conditions as IDataObject;
					if (conditions.condition && Array.isArray(conditions.condition) && conditions.condition.length > 1) {
						return true;
					}
				}
			}

			return false;
		} catch (error) {
			// In case of error, show the logical operator
			return true;
		}
	}

	// Methods to handle loading options for dynamic fields like routes
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
		outputs: `={{(${configureDecisionOutputs})($parameter)}}`,
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
						description: 'Click on a specific element on the page',
						action: 'Click an element on the page',
					},
					{
						name: 'Close',
						value: 'close',
						description: 'Close a browser session',
						action: 'Close a browser session',
					},
					{
						name: 'Decision',
						value: 'decision',
						description: 'Make conditional decisions based on page state and take action',
						action: 'Make a decision and take action',
					},
					{
						name: 'Detect',
						value: 'detect',
						description: 'Detect elements, text, URL paths, or page state',
						action: 'Detect page state',
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
			{
				displayName: 'Continue On Fail',
				name: 'continueOnFail',
				type: 'boolean',
				default: true,
				description: 'Whether to continue execution even when click operations fail (cannot find element or timeout)',
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

			// Properties for 'decision' operation
			...decisionOperation.description,

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
			{
				displayName: 'Continue On Fail',
				name: 'continueOnFail',
				type: 'boolean',
				default: true,
				description: 'Whether to continue execution even when close operations fail',
				displayOptions: {
					show: {
						operation: ['close'],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		// Get input items
		const items = this.getInputData();
		const returnData: INodeExecutionData[][] = [];

		// Always initialize with at least one output
		returnData.push([]);

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

			// Record start time for operation execution
			const startTime = Date.now();

			try {
				if (operation === 'open') {
					// Execute open operation using the implementation from open.operation.ts
					const result = await openOperation.execute.call(
						this,
						i,
						websocketEndpoint,
						workflowId,
					);

					// Add execution duration to the result if not already added
					if (result.json && !result.json.executionDuration) {
						result.json.executionDuration = Date.now() - startTime;
					}

					returnData[0].push(result);
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
					else if (items[i].json?.sessionId) {
						sessionId = items[i].json.sessionId as string;
					}
					// For backward compatibility, also check for pageId
					else if (items[i].json?.pageId) {
						sessionId = items[i].json.pageId as string;
						this.logger.info('Using legacy pageId as sessionId for compatibility');
					}

					// If no sessionId in current item, look at the input items for a sessionId
					if (!sessionId) {
						for (const item of items) {
							if (item.json?.sessionId) {
								sessionId = item.json.sessionId as string;
								break;
							}
							// For backward compatibility
							else if (item.json?.pageId) {
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
					const continueOnFail = this.getNodeParameter('continueOnFail', i, true) as boolean;

					// Double the timeout for Bright Data as recommended in their docs
					const brightDataTimeout = timeout * 2;

					// Get or create browser session
					let page: puppeteer.Page | undefined;
					let browser: puppeteer.Browser | undefined;
					let pageTitle = '';
					let pageUrl = '';
					let error: Error | undefined;
					let success = false;
					let attempt = 0;

					try {
						// Create a session or reuse an existing one
						const { browser: newBrowser } = await Ventriloquist.getOrCreateSession(
							workflowId,
							websocketEndpoint,
							this.logger,
							brightDataTimeout,
						);
						browser = newBrowser;

						// Try to get existing page from session
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
						pageTitle = await page.title();
						pageUrl = page.url();

						this.logger.info(`Current page URL: ${pageUrl}, title: ${pageTitle}`);

						// If waiting for a specific element before clicking, wait for it first
						if (waitBeforeClickSelector) {
							this.logger.info(`Waiting for selector "${waitBeforeClickSelector}" before clicking`);
							await page.waitForSelector(waitBeforeClickSelector, { timeout: brightDataTimeout });
						}

						// Check if the selector exists on the page
						const selectorExists = await page.evaluate((sel) => {
							const element = document.querySelector(sel);
							return element !== null;
						}, selector);

						if (!selectorExists) {
							throw new Error(`Element with selector "${selector}" not found on page`);
						}

						// Try clicking the element with retries
						this.logger.info(`Clicking on selector "${selector}" (attempt ${attempt + 1})`);

						while (!success && attempt <= retries) {
							try {
								// Try standard click first
								await page.click(selector);
								this.logger.info('Standard click was successful');
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
									error = new Error('All click methods failed');
									this.logger.warn(`Click attempt ${attempt + 1} failed: All methods failed`);
									attempt++;

									// If there are more retries, wait a bit before retrying
									if (attempt <= retries) {
										await new Promise((resolve) => setTimeout(resolve, 1000));
									}
								}
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
							// Calculate execution duration
							const executionDuration = Date.now() - startTime;

							returnData[0].push({
								json: {
									success: false,
									error: error.message || 'An unknown error occurred',
									stack: error.stack || '',
									executionDuration,
								},
							});
							continue;
						}
						throw error;
					}

					// Get updated page info after click
					const updatedPageTitle = await page.title();
					const updatedPageUrl = page.url();

					// Take screenshot if requested
					let screenshot = '';
					if (captureScreenshot && page) {
						try {
							const buffer = await page.screenshot({
								encoding: 'base64',
								type: 'jpeg',
								quality: 80,
							});
							screenshot = `data:image/jpeg;base64,${buffer}`;
						} catch (screenshotError) {
							this.logger.warn(`Failed to take screenshot: ${(screenshotError as Error).message}`);
						}
					}

					if (success) {
						// Click operation successful

						// Calculate execution duration
						const executionDuration = Date.now() - startTime;

						returnData[0].push({
							json: {
								...items[i].json, // Pass through input data
								success: true,
								operation: 'click',
								selector,
								sessionId,
								attempt: attempt,
								url: updatedPageUrl,
								title: updatedPageTitle,
								timestamp: new Date().toISOString(),
								executionDuration,
								...(screenshot ? { screenshot } : {}),
							},
						});
					} else {
						// Click operation failed
						const errorMessage = error?.message || 'Click operation failed for an unknown reason';

						// Calculate execution duration
						const executionDuration = Date.now() - startTime;

						if (!continueOnFail) {
							// If continueOnFail is false, throw the error to fail the node
							throw new Error(`Click operation failed: ${errorMessage}`);
						}

						// Otherwise, return an error response but continue execution
						returnData[0].push({
							json: {
								...items[i].json, // Pass through input data
								success: false,
								operation: 'click',
								error: errorMessage,
								selector,
								sessionId,
								attempt: attempt,
								url: updatedPageUrl,
								title: updatedPageTitle,
								timestamp: new Date().toISOString(),
								executionDuration,
								...(screenshot ? { screenshot } : {}),
							},
						});
					}
				} else if (operation === 'form') {
					// Execute form operation
					const result = await formOperation.execute.call(
						this,
						i,
						websocketEndpoint,
						workflowId,
					);

					// Add execution duration to the result
					if (result.json) {
						result.json.executionDuration = Date.now() - startTime;
					}

					returnData[0].push(result);
				} else if (operation === 'detect') {
					// Execute detect operation
					const result = await detectOperation.execute.call(
						this,
						i,
						websocketEndpoint,
						workflowId,
					);

					// Add execution duration to the result
					if (result.json) {
						result.json.executionDuration = Date.now() - startTime;
					}

					returnData[0].push(result);
				} else if (operation === 'decision') {
					// Find the session we need to use
					let page: puppeteer.Page | undefined;

					// Get session ID if provided
					try {
						// Get existing session ID if provided
						const existingSessionId = this.getNodeParameter('sessionId', i, '') as string;

						// Get the page to use
						if (existingSessionId) {
							// Try to get an existing page from the session
							const existingPage = Ventriloquist.getPage(workflowId, existingSessionId);
							if (!existingPage) {
								throw new Error(`Session ID ${existingSessionId} not found. The session may have expired or been closed.`);
							}
							page = existingPage;
						} else {
							// Use latest page from the browser (fall back to creating a new one if needed)
							const browser = await Ventriloquist.getOrCreateSession(
								workflowId,
								websocketEndpoint,
								this.logger,
							);
							const pages = await browser.browser.pages();

							if (pages.length > 0) {
								page = pages[pages.length - 1]; // Use the most recently created page
							} else {
								// Create a new page if none exists
								page = await browser.browser.newPage();
							}
						}

						if (!page) {
							throw new Error('No browser page found or could be created');
						}

						// Execute the decision operation
						const result = await decisionOperation.execute.call(
							this,
							i,
							page
						);

						// Check if we need to route to different outputs
						const enableRouting = this.getNodeParameter('enableRouting', i, false) as boolean;

						if (enableRouting) {
							// Handle different return types from decision operation
							if (Array.isArray(result)) {
								// Check if result is already a multi-dimensional array (INodeExecutionData[][])
								if (result.length > 0 && Array.isArray(result[0])) {
									// Result is already in the format INodeExecutionData[][]
									// Multi-route format: create arrays for each output
									const routeCount = this.getNodeParameter('routeCount', i, 2) as number;

									// Initialize arrays for each output if they don't exist
									while (returnData.length < routeCount) {
										returnData.push([]);
									}

									// Add results to each output route
									for (let routeIndex = 0; routeIndex < result.length && routeIndex < routeCount; routeIndex++) {
										const routeData = result[routeIndex];
										if (Array.isArray(routeData) && routeData.length > 0) {
											returnData[routeIndex].push(...routeData);
										}
									}
								} else {
									// Result is in the format INodeExecutionData[]
									// Create arrays for each output if they don't exist
									const routeCount = this.getNodeParameter('routeCount', i, 2) as number;

									// Initialize arrays for each output if they don't exist
									while (returnData.length < routeCount) {
										returnData.push([]);
									}

									// Default to first output
									if (returnData.length === 0) {
										returnData.push([]);
									}

									// Add all items to first output
									const items = result as INodeExecutionData[];
									if (items.length > 0) {
										returnData[0].push(...items);
									}
								}
							} else {
								// Empty result or invalid format, create empty first output if needed
								if (returnData.length === 0) {
									returnData.push([]);
								}
							}
						} else {
							// If routing not enabled, simply add to first output
							if (returnData.length === 0) {
								returnData.push([]);
							}

							// Check if result is INodeExecutionData[] or INodeExecutionData[][]
							if (Array.isArray(result)) {
								if (result.length > 0 && Array.isArray(result[0])) {
									// It's INodeExecutionData[][], take the first array
									const firstRoute = result[0] as INodeExecutionData[];
									if (firstRoute.length > 0) {
										returnData[0].push(...firstRoute);
									}
								} else {
									// It's INodeExecutionData[]
									const items = result as INodeExecutionData[];
									if (items.length > 0) {
										returnData[0].push(...items);
									}
								}
							}
						}
					} catch (error) {
						// ... existing error handling ...
						// Handle error and add to first output
						if (returnData.length === 0) {
							returnData.push([]);
						}

						returnData[0].push({
							json: {
								...items[i].json, // Pass through input data
								success: false,
								error: (error as Error).message,
								executionDuration: Date.now() - startTime,
							},
							pairedItem: { item: i },
						});
					}
				} else if (operation === 'extract') {
					// Execute extract operation
					const result = await extractOperation.execute.call(
						this,
						i,
						websocketEndpoint,
						workflowId,
					);

					// Add execution duration to the result
					if (result.json) {
						result.json.executionDuration = Date.now() - startTime;
					}

					returnData[0].push(result);
				} else if (operation === 'close') {
					// Close browser sessions based on the selected mode
					const closeMode = this.getNodeParameter('closeMode', i, 'session') as string;
					const continueOnFail = this.getNodeParameter('continueOnFail', i, true) as boolean;

					try {
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
								returnData[0].push({
									json: {
										...items[i].json, // Pass through input data
										success: true,
										operation,
										closeMode,
										sessionId,
										message: `Browser session ${sessionId} closed successfully`,
										timestamp: new Date().toISOString(),
										executionDuration: Date.now() - startTime,
									},
								});
							} else {
								// No session ID found
								throw new Error('No session ID provided or found in input');
							}
						} else if (closeMode === 'all') {
							// Close all browser sessions
							const closeResult = await Ventriloquist.closeAllSessions(this.logger);

							// Return success with details
							returnData[0].push({
								json: {
									...items[i].json, // Pass through input data
									success: true,
									operation,
									closeMode,
									totalSessions: closeResult.totalSessions,
									closedSessions: closeResult.closedSessions,
									message: `Closed ${closeResult.closedSessions} of ${closeResult.totalSessions} locally tracked browser sessions`,
									note: "This operation only closes sessions tracked by this N8N instance. To close orphaned sessions, please visit the Bright Data console.",
									brightDataConsoleUrl: "https://brightdata.com/cp/zones",
									timestamp: new Date().toISOString(),
									executionDuration: Date.now() - startTime,
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
							returnData[0].push({
								json: {
									...items[i].json, // Pass through input data
									success: true,
									operation,
									closeMode,
									closedSessions,
									failedSessions,
									message: `Closed ${closedSessions.length} of ${sessionIds.length} sessions successfully`,
									timestamp: new Date().toISOString(),
									executionDuration: Date.now() - startTime,
								},
							});
						}
					} catch (error) {
						// Handle errors based on continueOnFail setting
						if (!continueOnFail) {
							// If continueOnFail is false, throw the error to fail the node
							throw new Error(`Close operation failed: ${(error as Error).message}`);
						}

						// Otherwise, return an error response and continue
						returnData[0].push({
							json: {
								...items[i].json, // Pass through input data
								success: false,
								operation,
								closeMode,
								error: (error as Error).message,
								timestamp: new Date().toISOString(),
								executionDuration: Date.now() - startTime,
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
					// Calculate execution duration
					const executionDuration = Date.now() - startTime;

					returnData[0].push({
						json: {
							success: false,
							error: error.message || 'An unknown error occurred',
							stack: error.stack || '',
							executionDuration,
						},
					});
					continue;
				}
				throw error;
			}
		}

		return returnData;
	}

	// Method to load options for dropdowns
	methods = {
		loadOptions: {
			// Get route options for the Decision operation
			async getRoutes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					// Get the maximum number of routes
					const routeCount = parseInt(this.getNodeParameter('routeCount', 2) as string, 10);

					// Create numeric route options
					const routeOptions: INodePropertyOptions[] = [];
					for (let i = 1; i <= routeCount; i++) {
						routeOptions.push({
							name: `${i}`,
							value: i
						});
					}

					// Always ensure we have at least routes 1 and 2
					if (routeOptions.length === 0) {
						routeOptions.push(
							{ name: '1', value: 1 },
							{ name: '2', value: 2 }
						);
					}

					return routeOptions;
				} catch (error) {
					// If any error occurs, use defaults
					return [
						{ name: '1', value: 1 },
						{ name: '2', value: 2 },
					];
				}
			},
		},
	};
}
