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

/**
 * Ventriloquist is a custom node for N8N that connects to Bright Data's Browser Scraping Browser
 * via WebSocket and performs systematic Puppeteer functions.
 */
export class Ventriloquist implements INodeType {
	// Static map to store browser sessions
	private static browserSessions: Map<
		string,
		{ browser: puppeteer.Browser; lastUsed: Date; pages: Map<string, puppeteer.Page> }
	> = new Map();

	// Clean up old sessions (called periodically)
	private static cleanupSessions() {
		const now = new Date();
		const maxAge = 10 * 60 * 1000; // 10 minutes inactivity timeout

		for (const [sessionId, session] of this.browserSessions.entries()) {
			if (now.getTime() - session.lastUsed.getTime() > maxAge) {
				// Close browser for sessions inactive for more than 10 minutes
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
	private static async getOrCreateSession(
		workflowId: string,
		websocketEndpoint: string,
		logger: any,
	): Promise<{ browser: puppeteer.Browser; pageId: string }> {
		// Clean up old sessions
		this.cleanupSessions();

		// Check if we have an existing session for this workflow
		let session = this.browserSessions.get(workflowId);

		if (!session) {
			// Create a new browser session
			logger.info('Creating new browser session');
			const browser = await puppeteer.connect({
				browserWSEndpoint: websocketEndpoint,
			});

			session = {
				browser,
				lastUsed: new Date(),
				pages: new Map(),
			};

			this.browserSessions.set(workflowId, session);
		} else {
			// Update last used timestamp
			session.lastUsed = new Date();
			logger.info('Reusing existing browser session');
		}

		// Create a unique ID for the page
		const pageId = `page_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

		return { browser: session.browser, pageId };
	}

	// Store a page in the session
	private static storePage(workflowId: string, pageId: string, page: puppeteer.Page) {
		const session = this.browserSessions.get(workflowId);
		if (session) {
			session.pages.set(pageId, page);
		}
	}

	// Get a page from the session
	private static getPage(workflowId: string, pageId: string): puppeteer.Page | undefined {
		const session = this.browserSessions.get(workflowId);
		if (session) {
			return session.pages.get(pageId);
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

	// Enable the debugger for a Bright Data session
	private static async enableDebugger(page: puppeteer.Page, logger: any): Promise<string | null> {
		try {
			// Create a CDP session to interact with Chrome DevTools Protocol
			const client = await page.target().createCDPSession();

			// Get the current frame ID
			const frameId = (page.mainFrame() as any)._id;

			// Get the debug URL from Bright Data
			// Using any type to handle Bright Data's custom CDP commands
			const response = await (client as any).send('Page.inspect', { frameId });
			const inspectUrl = response?.url;

			if (inspectUrl) {
				logger.info(`Debug URL available: ${inspectUrl}`);
				return inspectUrl;
			} else {
				logger.warn('Could not get debug URL from Bright Data');
				return null;
			}
		} catch (error) {
			logger.warn(`Failed to enable debugger: ${error}`);
			return null;
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

			// Properties for 'click' operation
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

					// Double the timeout for Bright Data as recommended in their docs
					const brightDataTimeout = timeout * 2;

					// Get or create a browser session
					const { browser, pageId } = await Ventriloquist.getOrCreateSession(
						workflowId,
						websocketEndpoint,
						this.logger,
					);

					// Create a new page
					const context = incognito
						? (await browser.browserContexts()[0]) || browser.defaultBrowserContext()
						: browser.defaultBrowserContext();
					const page = await context.newPage();

					// Store the page in the session
					Ventriloquist.storePage(workflowId, pageId, page);

					// Enable debugging if requested
					let debugUrl = null;
					if (enableDebug) {
						debugUrl = await Ventriloquist.enableDebugger(page, this.logger);
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

					// Take a screenshot (base64 encoded)
					const screenshot = await page.screenshot({
						encoding: 'base64',
						type: 'jpeg',
						quality: 80,
					});

					// Return page data
					const responseData: IDataObject = {
						success: true,
						operation,
						url: currentUrl,
						title,
						status,
						pageId, // Include the pageId in the output for subsequent operations
						screenshot: `data:image/jpeg;base64,${screenshot}`,
						incognito,
						timestamp: new Date().toISOString(),
					};

					// Include debug URL if available
					if (debugUrl) {
						responseData.debugUrl = debugUrl;
					}

					returnData.push({
						json: responseData,
					});
				} else if (operation === 'click') {
					// Try to get pageId from previous operations
					let pageId = '';

					// First, try to get pageId from the current item if it was set by a previous operation
					if (items[i].json && items[i].json.pageId) {
						pageId = items[i].json.pageId as string;
					}

					// If no pageId in current item, look at the input items for a pageId
					if (!pageId) {
						for (const item of items) {
							if (item.json && item.json.pageId) {
								pageId = item.json.pageId as string;
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
					const { browser } = await Ventriloquist.getOrCreateSession(
						workflowId,
						websocketEndpoint,
						this.logger,
					);

					// Try to get existing page from session
					let page: puppeteer.Page | undefined;

					if (pageId) {
						page = Ventriloquist.getPage(workflowId, pageId);
						this.logger.info(`Found existing page with ID: ${pageId}`);
					}

					// If no existing page, get the first available page or create a new one
					if (!page) {
						const pages = await browser.pages();
						page = pages.length > 0 ? pages[0] : await browser.newPage();
						pageId = `page_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
						Ventriloquist.storePage(workflowId, pageId, page);
						this.logger.info(`Created new page with ID: ${pageId}`);
					}

					// Get page info for debugging
					const pageTitle = await page.title();
					const pageUrl = page.url();

					this.logger.info(`Current page URL: ${pageUrl}, title: ${pageTitle}`);

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

					this.logger.info(`Selector "${selector}" exists on page: ${selectorExists}`);
					this.logger.info(`Available IDs on page: ${JSON.stringify(allElementsWithIds)}`);

					// Try to click with retries
					while (!success && attempt <= retries) {
						try {
							// Wait for the selector to be available
							this.logger.info(
								`Waiting for selector "${selector}" (attempt ${attempt + 1}/${retries + 1})`,
							);
							await page.waitForSelector(selector, { timeout: brightDataTimeout });

							// Click the element
							this.logger.info(`Clicking on selector "${selector}"`);
							await page.click(selector);
							success = true;
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

					// Take a screenshot after the click (or attempt)
					const screenshot = await page.screenshot({
						encoding: 'base64',
						type: 'jpeg',
						quality: 80,
					});

					// Get updated page info after click
					const updatedPageTitle = await page.title();
					const updatedPageUrl = page.url();

					if (success) {
						// Return successful response
						const responseData: IDataObject = {
							success: true,
							operation,
							selector,
							attempts: attempt + 1,
							url: updatedPageUrl,
							title: updatedPageTitle,
							pageId, // Include the pageId for subsequent operations
							foundInPage: selectorExists,
							availableIds: allElementsWithIds,
							pageHtmlPreview: pageHtml.substring(0, 500) + '...',
							screenshot: `data:image/jpeg;base64,${screenshot}`,
							timestamp: new Date().toISOString(),
						};

						returnData.push({
							json: responseData,
						});
					} else {
						// Return error response
						returnData.push({
							json: {
								success: false,
								operation,
								selector,
								attempts: attempt,
								url: pageUrl,
								title: pageTitle,
								pageId, // Include the pageId for subsequent operations
								foundInPage: selectorExists,
								availableIds: allElementsWithIds,
								pageHtmlPreview: pageHtml.substring(0, 500) + '...',
								error: error ? error.message : 'Click operation failed after all retries',
								screenshot: `data:image/jpeg;base64,${screenshot}`,
								timestamp: new Date().toISOString(),
							},
						});
					}
				} else if (operation === 'close') {
					// Close the browser session
					await Ventriloquist.closeSession(workflowId);

					// Return success response
					returnData.push({
						json: {
							success: true,
							operation,
							message: 'Browser session closed successfully',
							timestamp: new Date().toISOString(),
						},
					});
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
