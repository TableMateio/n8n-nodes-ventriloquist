import * as puppeteer from 'puppeteer-core';
import {
	NodeConnectionType,
} from 'n8n-workflow';
import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeParameters,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	ICredentialDataDecryptedObject,
} from 'n8n-workflow';
import { BrowserTransportFactory } from './transport/BrowserTransportFactory';

// Import actions
import * as formOperation from './actions/form.operation';
import * as extractOperation from './actions/extract.operation';
import * as detectOperation from './actions/detect.operation';
import * as decisionOperation from './actions/decision.operation';
import * as openOperation from './actions/open.operation';
import * as authenticateOperation from './actions/authenticate.operation';
import * as closeOperation from './actions/close.operation';
import * as clickOperation from './actions/click.operation';

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
		{
			browser: puppeteer.Browser;
			lastUsed: Date;
			pages: Map<string, puppeteer.Page>;
			timeout?: number;
			credentialType?: string;
		}
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
		credentialType: string = 'brightDataApi',
		credentials?: ICredentialDataDecryptedObject,
	): Promise<{ browser: puppeteer.Browser; sessionId: string; brightDataSessionId: string }> {
		// Clean up old sessions
		this.cleanupSessions();

		logger.info(`Looking for session with workflow ID: ${workflowId}`);

		// Check if we already have a session for this workflowId (ignoring forceNew for lookup)
		let session = this.browserSessions.get(workflowId);
		let brightDataSessionId = '';

		// This is the key change: We always use the basic workflowId as the sessionId
		// Generate a session ID for tracking
		const sessionId = forceNew ? `${workflowId}_${Date.now()}` : workflowId;

		if (credentialType === 'brightDataApi' && websocketEndpoint) {
			// For Bright Data, try to extract sessionId from the WebSocket URL
			try {
				// Check if the WebSocket URL contains a session ID
				// Bright Data WebSocket URLs typically contain the session ID in a format like:
				// wss://brd-customer-XXX.bright.com/browser/XXX/sessionID/...
				// or wss://brd.superproxy.io:9223/XXXX/XXXX-XXXX-XXXX-XXXX

				// First try to extract from standard format with io:port
				if (websocketEndpoint.includes('superproxy.io:')) {
					const matches = websocketEndpoint.match(/\/([a-f0-9-]{36})/i);
					if (matches?.[1]) {
						brightDataSessionId = matches[1];
						logger.info(`Extracted Bright Data session ID: ${brightDataSessionId}`);
					}
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
		}

		// If we want to force a new session, close any existing one
		if (forceNew && session) {
			try {
				// Close the existing browser
				await session.browser.close();
			} catch (error) {
				logger.warn(`Error closing existing session: ${(error as Error).message}`);
			}
			this.browserSessions.delete(workflowId);
			session = undefined; // Reset session to undefined to create a new one
		}

		// If no session exists or we closed it, create a new one
		if (!session) {
			// Create browser transport based on credential type
			const transportFactory = new BrowserTransportFactory();

			// Handle case where credentials might be undefined
			let finalCredentials: ICredentialDataDecryptedObject;
			if (credentials) {
				finalCredentials = credentials;
			} else if (credentialType === 'brightDataApi' && websocketEndpoint) {
				// Create a basic BrightDataBrowser with just the endpoint if credentials aren't provided
				// This is for backward compatibility
				finalCredentials = {
					websocketEndpoint,
					authorizedDomains: '',
				} as ICredentialDataDecryptedObject;
			} else {
				throw new Error(`Cannot create browser transport: missing credentials for type ${credentialType}`);
			}

			let transport = transportFactory.createTransport(credentialType, logger, finalCredentials);

			// Create a new browser session
			logger.info(forceNew
				? 'Forcing creation of new browser session (required for Page.navigate)'
				: 'Creating new browser session');

			// Connect to the browser using the transport
			let browser: puppeteer.Browser;

			// For Browserless, we need to handle session management differently
			if (credentialType === 'browserlessApi') {
				try {
					// Check if we're creating a completely new session or reconnecting to an existing one
					if (forceNew) {
						// Connect to new session
						logger.info('Creating new Browserless session');
						browser = await transport.connect();
					} else {
						// Try to reconnect to existing session if possible
						logger.info(`Attempting to reconnect to Browserless session: ${sessionId}`);

						// Use the reconnect method if available
						if (transport.reconnect) {
							browser = await transport.reconnect(sessionId);
							logger.info(`Successfully reconnected to Browserless session: ${sessionId}`);
						} else {
							// Fallback to regular connect if reconnect isn't implemented
							logger.warn('Reconnect method not available, using standard connect');
							browser = await transport.connect();
						}
					}
				} catch (error) {
					logger.warn(`Failed to connect/reconnect to Browserless: ${(error as Error).message}`);
					logger.info('Creating new connection as fallback');
					browser = await transport.connect();
				}
			} else {
				// Standard connect for other providers (like Bright Data)
				browser = await transport.connect();
			}

			// Convert minutes to milliseconds for timeout if provided
			const timeoutMs = sessionTimeout ? sessionTimeout * 60 * 1000 : 3 * 60 * 1000; // Default to 3 minutes

			// Store the browser session for future use
			session = {
				browser,
				lastUsed: new Date(),
				pages: new Map<string, puppeteer.Page>(),
				timeout: timeoutMs,
				credentialType,
			};

			// Store using base workflowId (without timestamp) to ensure operations can find it later
			this.browserSessions.set(workflowId, session);
			logger.info(`New browser session created with ${timeoutMs}ms timeout (${sessionTimeout || 3} minutes)`);
			logger.info(`Session ID for this session: ${sessionId}`);
			logger.info(`Session will be stored with workflow ID: ${workflowId}`);
		} else {
			// Check if the existing browser is still connected
			let needReconnect = false;

			try {
				// Simple check to see if we can still get pages
				await session.browser.pages();
				logger.info('Existing browser session is still connected');
			} catch (error) {
				logger.warn(`Existing browser session appears disconnected: ${(error as Error).message}`);
				needReconnect = true;
			}

			// For Browserless, reconnect if necessary
			if (needReconnect && credentialType === 'browserlessApi' && credentials) {
				try {
					logger.info(`Attempting to reconnect disconnected Browserless session: ${sessionId}`);
					const transportFactory = new BrowserTransportFactory();
					const transport = transportFactory.createTransport(credentialType, logger, credentials);

					// Use the reconnect method if available
					if (transport.reconnect) {
						const browser = await transport.reconnect(sessionId);

						// Update the session with the new browser
						session.browser = browser;
						session.lastUsed = new Date();
						logger.info('Successfully reconnected to existing Browserless session');
					} else {
						// Fallback to regular connect
						logger.warn('Reconnect method not available, using standard connect');
						session.browser = await transport.connect();
						session.lastUsed = new Date();
					}
				} catch (reconnectError) {
					logger.error(`Failed to reconnect to Browserless session: ${(reconnectError as Error).message}`);
					logger.info('Creating completely new session');

					// Close the existing session and create a new one
					try {
						await session.browser.close();
					} catch (closeError) {
						logger.warn(`Error closing disconnected session: ${(closeError as Error).message}`);
					}

					// Create a new session
					const transportFactory = new BrowserTransportFactory();
					const transport = transportFactory.createTransport(credentialType, logger, credentials);
					const browser = await transport.connect();

					// Update the session
					session.browser = browser;
					session.lastUsed = new Date();
					session.pages = new Map();
					logger.info('Created new Browserless session to replace disconnected one');
				}
			} else {
				// Just update the timestamp for connected sessions
				session.lastUsed = new Date();
			}

			// Update timeout if provided and different from current
			if (sessionTimeout !== undefined) {
				const timeoutMs = sessionTimeout * 60 * 1000;
				if (session.timeout !== timeoutMs) {
					session.timeout = timeoutMs;
					logger.info(`Updated session timeout to ${timeoutMs}ms (${sessionTimeout} minutes)`);
				}
			}

			logger.info(`Reusing existing browser session with ID: ${sessionId}`);
			logger.info(`Session is stored with workflow ID: ${workflowId}`);
		}

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

	// Get the browserSessions map for other operations
	public static getSessions(): Map<
		string,
		{
			browser: puppeteer.Browser;
			lastUsed: Date;
			pages: Map<string, puppeteer.Page>;
			timeout?: number;
			credentialType?: string;
		}
	> {
		return this.browserSessions;
	}

	// Methods to handle loading options for dynamic fields like routes
	description: INodeTypeDescription = {
		displayName: 'Ventriloquist',
		name: 'ventriloquist',
		icon: 'file:ventriloquist.svg',
		group: ['browser'],
		version: 1,
		subtitle: '={{ $parameter["operation"] }}',
		description: 'Automate browser interactions using Bright Data or Browserless',
		defaults: {
			name: 'Ventriloquist',
		},
		inputs: [NodeConnectionType.Main],
		outputs: `={{(${configureDecisionOutputs})($parameter)}}`,
		credentials: [
			{
				name: 'brightDataApi',
				required: true,
				displayOptions: {
					show: {
						browserService: ['brightData'],
					},
				},
			},
			{
				name: 'browserlessApi',
				required: true,
				displayOptions: {
					show: {
						browserService: ['browserless'],
					},
				},
			},
		],
		properties: [
			{
				displayName: 'Browser Service',
				name: 'browserService',
				type: 'options',
				options: [
					{
						name: 'Bright Data',
						value: 'brightData',
						description: 'Use Bright Data browser automation service',
					},
					{
						name: 'Browserless',
						value: 'browserless',
						description: 'Use Browserless browser automation service',
					},
				],
				default: 'brightData',
				description: 'The browser service to use for automation',
				required: true,
			},
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
					{
						name: 'Authenticate',
						value: 'authenticate',
						description: 'Handle authentication (TOTP, etc.)',
						action: 'Authenticate with credentials',
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

			// Properties for 'authenticate' operation
			...authenticateOperation.description,

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

		// Get the browser service selected by the user
		let credentials;
		let credentialType;
		let websocketEndpoint = '';

		// Get the browser service selected by the user
		const browserService = this.getNodeParameter('browserService', 0) as string;

		// Set credential type based on browser service
		if (browserService === 'brightData') {
			credentialType = 'brightDataApi';
			credentials = await this.getCredentials('brightDataApi');
			websocketEndpoint = credentials.websocketEndpoint as string || '';

			// Validate Bright Data credentials
			if (!websocketEndpoint) {
				throw new Error('WebSocket Endpoint is required for Bright Data API');
			}
		} else if (browserService === 'browserless') {
			credentialType = 'browserlessApi';
			credentials = await this.getCredentials('browserlessApi');

			// Validate Browserless credentials
			if (!credentials.apiKey) {
				throw new Error('API Key is required for Browserless API');
			}

			// For Browserless, we'll build the websocket endpoint dynamically using the baseUrl
			websocketEndpoint = ''; // Will be built in the transport
		} else {
			throw new Error(`Unsupported browser service: ${browserService}`);
		}

		if (!credentials) {
			throw new Error(`No credentials provided for ${browserService}`);
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
						credentialType,
					);

					// Add execution duration to the result if not already added
					if (result.json && !result.json.executionDuration) {
						result.json.executionDuration = Date.now() - startTime;
					}

					returnData[0].push(result);
				} else if (operation === 'click') {
					// Execute click operation using the new implementation
					const result = await clickOperation.execute.call(
						this,
						i,
						websocketEndpoint,
						workflowId,
					);

					// Add execution duration to the result
					if (result.json && !result.json.executionDuration) {
						result.json.executionDuration = Date.now() - startTime;
					}

					returnData[0].push(result);
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
					// Get session ID if provided
					let sessionId = this.getNodeParameter('sessionId', i, '') as string;

					// Check inputs for session ID
					if (!sessionId) {
						// Try to get from the current item or previous items
						for (const [key, value] of Object.entries(items[i].json)) {
							if (key === 'sessionId' && typeof value === 'string') {
								sessionId = value;
								this.logger.info(`Using sessionId from input data: ${sessionId}`);
								break;
							}
							// For backward compatibility
							else if (key === 'pageId' && typeof value === 'string') {
								sessionId = value;
								this.logger.info('Using legacy pageId as sessionId for compatibility');
								break;
							}
						}
					}

					try {
						// Get the existing session page
						const workflowId = this.getWorkflow().id || '';
						let page: puppeteer.Page | undefined;
						let browser: puppeteer.Browser | undefined;

						if (sessionId) {
							// First check if we can directly get the page
							page = Ventriloquist.getPage(workflowId, sessionId);

							// If page isn't found or seems disconnected, try to reconnect
							if (!page) {
								this.logger.warn(`Session ID ${sessionId} page not found directly. Will attempt to reconnect.`);
							} else {
								// Verify the page is still connected
								try {
									// Simple test to see if page is connected
									await page.evaluate(() => document.readyState);
									this.logger.info(`Page with session ID ${sessionId} is still connected.`);
								} catch (connectionError) {
									this.logger.warn(`Page with session ID ${sessionId} appears disconnected: ${(connectionError as Error).message}`);
									this.logger.info(`Will attempt to reconnect to session: ${sessionId}`);
									page = undefined; // Reset so we try reconnection
								}
							}

							// If page is still not available, try to reconnect via browser transport
							if (!page) {
								// Get the session info
								const existingSession = Ventriloquist.browserSessions.get(workflowId);
								if (!existingSession) {
									throw new Error(`No browser session found for workflow ID: ${workflowId}`);
								}

								// Get credentials based on the session type
								const credentialType = existingSession.credentialType || 'browserlessApi';
								const credentials = await this.getCredentials(credentialType);

								// Create transport for reconnection
								const transportFactory = new BrowserTransportFactory();
								const browserTransport = transportFactory.createTransport(
									credentialType,
									this.logger,
									credentials
								);

								// Check if the transport has reconnect capability
								if (browserTransport.reconnect) {
									this.logger.info(`Attempting to reconnect to ${credentialType} session: ${sessionId}`);
									try {
										// Reconnect to the browser with the session ID
										browser = await browserTransport.reconnect(sessionId);

										// Get a page from the reconnected browser
										const pages = await browser.pages();
										if (pages.length > 0) {
											page = pages[0];
										} else {
											page = await browser.newPage();
										}

										// Store the page with the session ID
										Ventriloquist.storePage(workflowId, sessionId, page);
										this.logger.info(`Successfully reconnected to session: ${sessionId} and retrieved page`);

										// Update the session with the new browser
										existingSession.browser = browser;
										existingSession.lastUsed = new Date();
									} catch (reconnectError) {
										this.logger.error(`Failed to reconnect to session ${sessionId}: ${(reconnectError as Error).message}`);
										throw new Error(`Could not reconnect to session ${sessionId}: ${(reconnectError as Error).message}`);
									}
								} else {
									throw new Error(`Transport doesn't support reconnection for session type: ${credentialType}`);
								}
							}
						} else {
							// No session ID provided, try to use an existing session
							this.logger.info(`No session ID provided, trying to use the existing session for workflow ID: ${workflowId}`);

							// Get the existing session without creating a new one
							const existingSession = Ventriloquist.browserSessions.get(workflowId);

							if (!existingSession) {
								throw new Error(`No existing browser session found for this workflow. Please run the Open operation first.`);
							}

							this.logger.info(`Found existing browser session for workflow: ${workflowId}`);
							browser = existingSession.browser;

							// Check if browser is connected
							try {
								const pages = await browser.pages();

								if (pages.length > 0) {
									page = pages[pages.length - 1]; // Use the most recently created page
									this.logger.info(`Using the most recent page from the existing session`);
								} else {
									// Create a new page in the existing session
									page = await browser.newPage();
									this.logger.info(`Created new page in existing browser session`);
								}

								// Generate a session ID if we don't have one yet
								if (!sessionId) {
									sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
								}

								// Store this page with its session ID
								Ventriloquist.storePage(workflowId, sessionId, page);
							} catch (browserError) {
								this.logger.error(`Error accessing browser: ${(browserError as Error).message}`);
								throw new Error(`Error accessing browser session: ${(browserError as Error).message}`);
							}
						}

						if (!page) {
							throw new Error('No browser page found or could be created after multiple attempts');
						}

						// Execute the decision operation with the verified connected page
						const result = await decisionOperation.execute.call(
							this,
							i,
							page,
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
					// Get session ID if provided
					const explicitSessionId = this.getNodeParameter('explicitSessionId', i, '') as string;

					// Execute extract operation
					const result = await extractOperation.execute.call(
						this,
						i,
						websocketEndpoint,
						workflowId,
						explicitSessionId,
					);

					// Add execution duration to the result
					if (result.json) {
						result.json.executionDuration = Date.now() - startTime;
					}

					returnData[0].push(result);
				} else if (operation === 'authenticate') {
					// Execute authenticate operation
					const result = await authenticateOperation.execute.call(
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
					// Execute close operation using our new implementation
					const result = await closeOperation.execute.call(
						this,
						i,
						websocketEndpoint,
						workflowId,
					);

					// Add execution duration to the result
					if (result.json && !result.json.executionDuration) {
						result.json.executionDuration = Date.now() - startTime;
					}

					returnData[0].push(result);
				} else {
					throw new Error(`The operation "${operation}" is not supported!`);
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
