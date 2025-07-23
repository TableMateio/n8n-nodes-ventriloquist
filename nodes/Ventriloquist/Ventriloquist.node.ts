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
import { SessionManager } from './utils/sessionManager';
import { getActivePage } from './utils/sessionUtils';

// Import actions
import * as formOperation from './actions/form.operation';
import * as extractOperation from './actions/extract.operation';
import * as detectOperation from './actions/detect.operation';
import * as decisionOperation from './actions/decision.operation';
import * as openOperation from './actions/open.operation';
import * as authenticateOperation from './actions/authenticate.operation';
import * as clickOperation from './actions/click.operation';
import * as closeOperation from './actions/close.operation';
import * as matcherOperation from './actions/matcher.operation';
import * as collectorOperation from './actions/collector.operation';
import * as checkOperation from './actions/check.operation';
import * as manipulateOperation from './actions/manipulate.operation';

/**
 * Configure outputs for decision and check operations based on operation type and routing parameters
 */
const configureDecisionOutputs = (parameters: INodeParameters) => {
	const operation = parameters.operation as string;

	// Check operation always has exactly 2 outputs: success (0) and failure (1)
	if (operation === 'check') {
		return [NodeConnectionType.Main, NodeConnectionType.Main];
	}

	// Decision operation routing logic
	if (operation === 'decision') {
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
	}

	// Default to single output for all other operations
	return [NodeConnectionType.Main];
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
		// This ensures consistent IDs even when forceNew is used
		const sessionId = `session_${workflowId}`;

		// Create a new session only if we don't have one yet or if forceNew is true
		if (!session || forceNew) {
			// If forceNew is true but we have an existing session, close it first
			if (forceNew && session) {
				logger.info(`Forcing new session, closing existing session for workflow: ${workflowId}`);
				try {
					await session.browser.close();
				} catch (error) {
					logger.warn(`Error closing existing session: ${(error as Error).message}`);
				}
				this.browserSessions.delete(workflowId);
				session = undefined; // Reset session to undefined to create a new one
			}

			// If using Bright Data, try to extract the session ID from the WebSocket URL
			if (credentialType === 'brightDataApi' && websocketEndpoint) {
				try {
					// Bright Data WebSocket URLs typically contain the session ID in a format like:
					// wss://brd-customer-XXX.bright.com/browser/XXX/sessionID/...
					// or wss://brd.superproxy.io:9223/XXXX/XXXX-XXXX-XXXX

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
			}

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

			session = {
				browser,
				lastUsed: new Date(),
				pages: new Map(),
				timeout: timeoutMs, // Store timeout in milliseconds
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
				// Ignore close errors
			}
			this.browserSessions.delete(workflowId);
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
		{ browser: puppeteer.Browser; lastUsed: Date; pages: Map<string, puppeteer.Page>; timeout?: number }
	> {
		return this.browserSessions;
	}

	// Methods to handle loading options for dynamic fields like routes
	description: INodeTypeDescription = {
		displayName: 'Ventriloquist',
		name: 'ventriloquist',
		icon: 'file:ventriloquist.svg',
		group: ['browser'],
		version: [1],
		subtitle: '={{ $parameter.operation }}',
		description: 'Automate browser interactions using Bright Data, Browserless, or local Chrome',
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
			{
				name: 'localChromeApi',
				required: true,
				displayOptions: {
					show: {
						browserService: ['localChrome'],
					},
				},
			},
			{
				name: 'openAIApi',
				required: false,
				displayOptions: {
					show: {
						operation: ['extract'],
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
					{
						name: 'Local Chrome',
						value: 'localChrome',
						description: 'Use locally installed Chrome/Chromium browser',
					},
				],
				default: 'brightData',
				description: 'The browser service to use for automation',
				required: true,
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Browser',
						value: 'browserControl',
						description: 'Operations for controlling the browser instance',
					},
					{
						name: 'Navigation',
						value: 'navigation',
						description: 'Operations for navigating and interacting with web pages',
					},
					{
						name: 'Data',
						value: 'dataOperations',
						description: 'Operations for extracting and processing data from web pages',
					},
				],
				default: 'browserControl',
				description: 'Resource to use',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['browserControl'],
					},
				},
				options: [
					{
						name: 'Open',
						value: 'open',
						description: 'Open a browser instance',
						action: 'Open',
					},
					{
						name: 'Check',
						value: 'check',
						description: 'Check if a session is operational',
						action: 'Check',
					},
					{
						name: 'Close',
						value: 'close',
						description: 'Close a browser session',
						action: 'Close',
					},
				],
				default: 'open',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['navigation'],
					},
				},
				options: [
					{
						name: 'Authenticate',
						value: 'authenticate',
						description: 'Handle authentication (TOTP, etc.)',
						action: 'Authenticate',
					},
					{
						name: 'Click',
						value: 'click',
						description: 'Click on a specific element on the page',
						action: 'Click',
					},
					{
						name: 'Form',
						value: 'form',
						description: 'Fill out a form',
						action: 'Form',
					},
					{
						name: 'Manipulate',
						value: 'manipulate',
						description: 'Remove elements or block events on the page',
						action: 'Manipulate',
					},
				],
				default: 'click',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['dataOperations'],
					},
				},
				options: [
					{
						name: 'Collector',
						value: 'collector',
						description: 'Collect data from a webpage',
						action: 'Collect',
					},
					{
						name: 'Decision',
						value: 'decision',
						description: 'Make conditional decisions based on page state and take action',
						action: 'Decide',
					},
					{
						name: 'Detect',
						value: 'detect',
						description: 'Detect elements, text, URL paths, or page state',
						action: 'Detect',
					},
					{
						name: 'Extract',
						value: 'extract',
						description: 'Extract data from a webpage',
						action: 'Extract',
					},
					{
						name: 'Matcher',
						value: 'matcher',
						description: 'Match entities across data sources',
						action: 'Match',
					},
				],
				default: 'extract',
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
						resource: ['browserControl'],
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
						resource: ['browserControl'],
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
						operation: ['open', 'form', 'detect', 'extract'],
						resource: [
							'browserControl',
							'navigation',
							'dataOperations',
						],
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
						resource: ['browserControl'],
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
						resource: ['browserControl'],
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
						resource: ['browserControl'],
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
						resource: ['browserControl'],
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
						resource: ['browserControl'],
						operation: ['open'],
					},
				},
			},
			{
				displayName: 'Output Input Data',
				name: 'outputInputData',
				type: 'boolean',
				default: false,
				description: 'Whether to include input data from previous nodes in the response',
				displayOptions: {
					show: {
						resource: ['browserControl'],
						operation: ['open'],
					},
				},
			},

			// Properties for 'click' operation
			...clickOperation.description.map(property => ({
				...property,
				displayOptions: {
					...(property.displayOptions || {}),
					show: {
						...(property.displayOptions?.show || {}),
						resource: ['navigation'],
						operation: ['click'],
					},
				},
			})),

			// Properties for 'form' operation
			...formOperation.description.map(property => ({
				...property,
				displayOptions: {
					...(property.displayOptions || {}),
					show: {
						...(property.displayOptions?.show || {}),
						resource: ['navigation'],
						operation: ['form'],
					},
				},
			})),

			// Properties for 'detect' operation
			...detectOperation.description.map(property => ({
				...property,
				displayOptions: {
					...(property.displayOptions || {}),
					show: {
						...(property.displayOptions?.show || {}),
						resource: ['dataOperations'],
						operation: ['detect'],
					},
				},
			})),

			// Properties for 'decision' operation
			...decisionOperation.description.map(property => ({
				...property,
				displayOptions: {
					...(property.displayOptions || {}),
					show: {
						...(property.displayOptions?.show || {}),
						resource: ['dataOperations'],
						operation: ['decision'],
					},
				},
			})),

			// Properties for 'extract' operation
			...extractOperation.description.map(property => ({
				...property,
				displayOptions: {
					...(property.displayOptions || {}),
					show: {
						...(property.displayOptions?.show || {}),
						resource: ['dataOperations'],
						operation: ['extract'],
					},
				},
			})),

			// Properties for 'authenticate' operation
			...authenticateOperation.description.map(property => ({
				...property,
				displayOptions: {
					...(property.displayOptions || {}),
					show: {
						...(property.displayOptions?.show || {}),
						resource: ['navigation'],
						operation: ['authenticate'],
					},
				},
			})),

			// Properties for 'matcher' operation
			...matcherOperation.description.map(property => ({
				...property,
				displayOptions: {
					...(property.displayOptions || {}),
					show: {
						...(property.displayOptions?.show || {}),
						resource: ['dataOperations'],
						operation: ['matcher'],
					},
				},
			})),

			// Properties for 'check' operation
			...checkOperation.description.map(property => ({
				...property,
				displayOptions: {
					...(property.displayOptions || {}),
					show: {
						...(property.displayOptions?.show || {}),
						resource: ['browserControl'],
						operation: ['check'],
					},
				},
			})),

			// Properties for 'close' operation
			...closeOperation.description.map(property => ({
				...property,
				displayOptions: {
					...(property.displayOptions || {}),
					show: {
						...(property.displayOptions?.show || {}),
						resource: ['browserControl'],
						operation: ['close'],
					},
				},
			})),

			// Properties for 'collector' operation
			...collectorOperation.description.map(property => ({
				...property,
				displayOptions: {
					...(property.displayOptions || {}),
					show: {
						...(property.displayOptions?.show || {}),
						resource: ['dataOperations'],
						operation: ['collector'],
					},
				},
			})),

			// Properties for 'manipulate' operation
			...manipulateOperation.description.map(property => ({
				...property,
				displayOptions: {
					...(property.displayOptions || {}),
					show: {
						...(property.displayOptions?.show || {}),
						resource: ['navigation'],
						operation: ['manipulate'],
					},
				},
			})),

			// Add additionalOptions to hide custom operations
			{
				displayName: 'Additional Options',
				name: 'additionalOptions',
				type: 'hidden',
				default: {
					showCustomApi: false
				},
			}
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		// Get input items
		const items = this.getInputData();
		const returnData: INodeExecutionData[][] = [];

		// Always initialize with at least one output
		returnData.push([]);

				// Check if we have input data for operations that typically require it
		// Some operations like 'open' can start without input, others like 'extract' need input
		if (items.length === 0) {
			// Try to get the operation parameter even without input items
			try {
				const operation = this.getNodeParameter('operation', 0) as string;
				const operationsRequiringInput = ['extract', 'click', 'form', 'detect', 'authenticate', 'decision', 'manipulate'];

				if (operationsRequiringInput.includes(operation)) {
					this.logger.info(`No input data received for operation '${operation}' - this might indicate unnecessary re-execution`);
					// Return empty result to prevent upstream re-execution for operations that need input
					return returnData;
				} else {
					this.logger.info(`Operation '${operation}' can start without input data - proceeding`);
				}
			} catch (error) {
				this.logger.info('No input data and cannot determine operation - assuming this is intentional');
			}
		}

		// Get static data for caching results between executions
		const staticData = this.getWorkflowStaticData('node');
		const executionMode = this.getMode();

		this.logger.info(`Execution mode: ${executionMode}, Input items: ${items.length}`);

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
		} else if (browserService === 'localChrome') {
			credentialType = 'localChromeApi';
			credentials = await this.getCredentials('localChromeApi');

			// For Local Chrome, we don't need a WebSocket endpoint as we're controlling the browser directly
			websocketEndpoint = '';
		} else {
			throw new Error(`Unsupported browser service: ${browserService}`);
		}

		if (!credentials) {
			throw new Error(`No credentials provided for ${browserService}`);
		}

		// After getting browser credentials
		// Get OpenAI credentials if needed for smart extraction
		let openAiApiKey = "";
		const operation = this.getNodeParameter('operation', 0) as string;

		// Only get OpenAI credentials if we're doing an extract operation
		if (operation === 'extract') {
			// Get the extraction items to check if any use AI formatting
			const extractionItems = this.getNodeParameter('extractionItems.items', 0, []) as IDataObject[];

			// Check if any extraction item has schema set to 'manual' or 'auto' which indicates AI is needed
			const needsOpenAI = extractionItems.some(item => {
				const schema = item.schema as string;
				return schema === 'manual' || schema === 'auto';
			});

			this.logger.info(`Checking if OpenAI is needed for extraction: ${needsOpenAI}`);

			if (needsOpenAI) {
				try {
					const openAiCredentials = await this.getCredentials('openAIApi');

					if (openAiCredentials && openAiCredentials.apiKey) {
						openAiApiKey = openAiCredentials.apiKey as string;
						this.logger.info(`OpenAI credentials loaded successfully (key length: ${openAiApiKey.length})`);
					} else {
						this.logger.warn('AI formatting is being used, but OpenAI API key was not found in credentials');
					}
				} catch (error) {
					// Don't fail the node if credentials aren't found - we'll handle this in the extract operation
					this.logger.warn(`Failed to get OpenAI credentials: ${(error as Error).message}`);
				}
			}
		}

		// Process all items
		for (let i = 0; i < items.length; i++) {
			const operation = this.getNodeParameter('operation', i) as string;
			const workflowId = this.getWorkflow()?.id?.toString() || `default_${Date.now()}`;

			// Record start time for operation execution
			const startTime = Date.now();

						// Create a cache key based on operation, input data, parameters, and current browser state
			const inputDataString = JSON.stringify(items[i]);
			const operationParams = this.getNodeParameter('operation', i);

			// For remaining cacheable browser-dependent operations, include current URL in cache key
			// to prevent cached results from wrong page states
			let browserStateKey = '';
			if (['extract', 'detect'].includes(operation)) {
				try {
					// Try to get current URL from session if available
					const sessionId = this.getNodeParameter('sessionId', i, '') as string;
					if (sessionId) {
						const session = SessionManager.getSession(sessionId);
						if (session && session.browser) {
							try {
								const activePage = await getActivePage(session.browser, this.logger);
								if (activePage) {
									const currentUrl = await activePage.url();
									browserStateKey = `_url:${currentUrl}`;
								} else {
									browserStateKey = '_url:no-active-page';
								}
							} catch (urlError) {
								// If we can't get URL, don't include it in cache key
								browserStateKey = '_url:unknown';
							}
						} else {
							browserStateKey = '_url:no-browser';
						}
					} else {
						browserStateKey = '_url:no-session-id';
					}
				} catch (sessionError) {
					// If we can't access session, don't include URL in cache key
					browserStateKey = '_url:session-error';
				}
			}

			const cacheKey = `${operation}_${Buffer.from(inputDataString + JSON.stringify(operationParams) + browserStateKey).toString('base64').slice(0, 32)}`;

			// Check if we have cached results for expensive operations (in manual mode only to avoid production issues)
			// NOTE: Decision operations are excluded from caching because they check dynamic content that can change
			// even on the same page (e.g., search results, form states, etc.)
			const shouldCache = executionMode === 'manual' && ['extract', 'detect', 'form'].includes(operation);

			// Initialize cache as an object if it doesn't exist
			if (!staticData.cache) {
				staticData.cache = {} as { [key: string]: INodeExecutionData };
			}
			const cache = staticData.cache as { [key: string]: INodeExecutionData };

			if (shouldCache && cache[cacheKey]) {
				this.logger.info(`Using cached result for operation: ${operation}`);
				const cachedResult = cache[cacheKey];

				// Add execution duration to cached result
				if (cachedResult.json) {
					cachedResult.json.executionDuration = Date.now() - startTime;
					cachedResult.json.fromCache = true;
				}

				returnData[0].push(cachedResult);
				continue;
			}

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
					// Execute click operation using the implementation from click.operation.ts
					const result = await clickOperation.execute.call(
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
					// Execute the decision operation
					const result = await decisionOperation.execute.call(
						this,
						i,
						websocketEndpoint,
						workflowId
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
				} else if (operation === 'extract') {
					// Log that we're going to use the OpenAI API key (if available)
					if (openAiApiKey) {
						this.logger.info(`OpenAI API key is available for extract operation (key length: ${openAiApiKey.length})`);
					} else {
						this.logger.warn(`No OpenAI API key available for extract operation`);
					}

					// Make sure to pass openAiApiKey to the extract operation
					const result = await extractOperation.execute.call(
						this,
						i,
						websocketEndpoint,
						workflowId,
						openAiApiKey // Ensure this is being passed correctly
					);

					returnData[0].push(result);
					continue;
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
				} else if (operation === 'check') {
					// Execute check operation
					const result = await checkOperation.execute.call(
						this,
						i,
						websocketEndpoint,
						workflowId,
					);

					// Check operation returns arrays for routing, so we need to handle multiple outputs
					if (Array.isArray(result)) {
						// Multi-output routing: create arrays for each output
						while (returnData.length < 2) {
							returnData.push([]);
						}

						// Add results to each output route
						for (let routeIndex = 0; routeIndex < result.length && routeIndex < 2; routeIndex++) {
							const routeData = result[routeIndex];
							if (Array.isArray(routeData) && routeData.length > 0) {
								// Add execution duration to each result
								routeData.forEach(item => {
									if (item.json && !item.json.executionDuration) {
										item.json.executionDuration = Date.now() - startTime;
									}
								});
								returnData[routeIndex].push(...routeData);
							}
						}
					} else {
						// Single output (shouldn't happen with check operation, but handle it)
						const singleResult = result as INodeExecutionData;
						if (singleResult.json && !singleResult.json.executionDuration) {
							singleResult.json.executionDuration = Date.now() - startTime;
						}
						returnData[0].push(singleResult);
					}
				} else if (operation === 'close') {
					// Execute close operation using the implementation from close.operation.ts
					const result = await closeOperation.execute.call(
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
				} else if (operation === 'matcher') {
					// Execute matcher operation
					const result = await matcherOperation.execute.call(
						this,
						i,
						workflowId,
						websocketEndpoint,
					);

					// Add execution duration to the result
					if (result.json) {
						result.json.executionDuration = Date.now() - startTime;
					}

					returnData[0].push(result);
				} else if (operation === 'collector') {
					// Execute collector operation
					const results = await collectorOperation.execute.call(
						this,
						i,
						workflowId,
						websocketEndpoint,
					);

					// Add execution duration to the results if not already added
					for (const result of results) {
						if (result.json && !result.json.executionDuration) {
							result.json.executionDuration = Date.now() - startTime;
						}
					}

					// Add all items to the return data
					returnData[0].push(...results);
				} else if (operation === 'manipulate') {
					// Execute manipulate operation
					const results = await manipulateOperation.execute.call(
						this,
						i,
					);

					// Add execution duration to the results if not already added
					for (const result of results) {
						if (result.json && !result.json.executionDuration) {
							result.json.executionDuration = Date.now() - startTime;
						}
					}

					// Add all items to the return data
					returnData[0].push(...results);
				} else {
					throw new Error(`The operation "${operation}" is not supported!`);
				}

								// Cache the result for expensive operations (only in manual mode)
				if (shouldCache && returnData[0].length > 0) {
					const resultToCache = returnData[0][returnData[0].length - 1];

					// Store result in cache with a shallow copy to avoid references
					cache[cacheKey] = JSON.parse(JSON.stringify(resultToCache));
					this.logger.info(`Cached result for operation: ${operation}`);

					// Clean up old cache entries to prevent memory issues (keep only last 10 entries)
					const cacheKeys = Object.keys(cache);
					if (cacheKeys.length > 10) {
						const oldestKey = cacheKeys[0];
						delete cache[oldestKey];
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
