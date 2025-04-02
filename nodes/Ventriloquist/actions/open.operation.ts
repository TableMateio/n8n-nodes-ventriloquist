import {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { BrightDataBrowser } from '../transport/BrightDataBrowser';
import { Ventriloquist } from '../Ventriloquist.node';

/**
 * Open operation description
 */
export const description: INodeProperties[] = [
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		placeholder: 'https://example.com',
		description: 'The URL to navigate to',
		required: true,
	},
	{
		displayName: 'Incognito Mode',
		name: 'incognito',
		type: 'boolean',
		default: false,
		description: 'Whether to use incognito mode',
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
				description: 'Wait until there are no more than 2 network connections for at least 500ms',
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
	},
	{
		displayName: 'Timeout',
		name: 'timeout',
		type: 'number',
		default: 30000,
		description: 'Maximum navigation time in milliseconds',
	},
	{
		displayName: 'Continue On Fail',
		name: 'continueOnFail',
		type: 'boolean',
		default: true,
		description: 'Whether to continue execution even when browser operations fail (cannot connect or navigate)',
	},
	{
		displayName: 'Session Timeout',
		name: 'sessionTimeout',
		type: 'number',
		default: 3,
		description: 'Session timeout in minutes',
	},
	{
		displayName: 'Enable Debug',
		name: 'enableDebug',
		type: 'boolean',
		default: false,
		description: 'Whether to enable debugging',
	},
];

/**
 * Execute the open operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	websocketEndpoint: string,
	workflowId: string,
): Promise<INodeExecutionData> {
	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;
	this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Open] ========== START OPEN NODE EXECUTION ==========`);

	const url = this.getNodeParameter('url', index) as string;
	const incognito = this.getNodeParameter('incognito', index, false) as boolean;
	const waitUntil = this.getNodeParameter(
		'waitUntil',
		index,
		'networkidle0',
	) as puppeteer.PuppeteerLifeCycleEvent;
	const timeout = this.getNodeParameter('timeout', index, 30000) as number;
	const continueOnFail = this.getNodeParameter('continueOnFail', index, true) as boolean;
	const sessionTimeout = this.getNodeParameter('sessionTimeout', index, 3) as number;
	const enableDebug = this.getNodeParameter('enableDebug', index, false) as boolean;

	this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Open] Opening URL: ${url}`);

	// Get the authorized domains from the credentials
	const credentials = await this.getCredentials('brightDataApi');
	const authorizedDomains = (credentials.authorizedDomains as string) || '';
	const password = (credentials.password as string) || undefined;

	// Create the BrightDataBrowser instance with authorized domains and password
	const brightDataBrowser = new BrightDataBrowser(
		this.logger,
		websocketEndpoint,
		authorizedDomains,
		password,
	);

	let browser: puppeteer.Browser | undefined;
	let page: puppeteer.Page | undefined;
	let sessionId = '';
	let brightDataSessionId = '';

	try {
		// Always create a new session for the open operation to avoid Page.navigate limits
		// This forces a new session by passing forceNew=true
		const sessionData = await Ventriloquist.getOrCreateSession(
			workflowId,
			websocketEndpoint,
			this.logger,
			sessionTimeout,
			true, // Always force a new session for open operation
		);

		browser = sessionData.browser;
		sessionId = sessionData.sessionId;
		brightDataSessionId = sessionData.brightDataSessionId;

		this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Open] Created new browser session with ID: ${sessionId}`);

		// Create a new page
		const context = incognito
			? await browser.createBrowserContext()
			: browser.defaultBrowserContext();
		page = await context.newPage();

		// Store the page for future operations
		Ventriloquist.storePage(workflowId, sessionId, page);
		this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Open] Stored page reference with session ID: ${sessionId}`);

		// Set up response handling for better error messages
		page.on('response', (response) => {
			if (!response.ok()) {
				this.logger.warn(`[Ventriloquist][${nodeName}][${nodeId}][Open] Response error: ${response.status()} for ${response.url()}`);
			}
		});

		// Enable debugging if requested
		if (enableDebug) {
			try {
				// Note: Debug mode is enabled but we can't directly access the debug URL
				// The session will be visible in Bright Data's console
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Open] Debug mode enabled for this session`);
			} catch (debugError) {
				this.logger.warn(`[Ventriloquist][${nodeName}][${nodeId}][Open] Failed to enable debugger: ${(debugError as Error).message}`);
			}
		}

		// Navigate to the URL
		this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Open] Navigating to URL: ${url}`);
		const { response, domain } = await brightDataBrowser.navigateTo(page, url, {
			waitUntil,
			timeout,
		});

		// Get page information
		const pageInfo = await brightDataBrowser.getPageInfo(page, response);

		// Take a screenshot
		const screenshot = await brightDataBrowser.takeScreenshot(page);

		this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Open] Navigation successful: ${pageInfo.url} (${pageInfo.title})`);
		this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Open] ========== END OPEN NODE EXECUTION ==========`);

		// Prepare response data
		const responseData: IDataObject = {
			success: true,
			operation: 'open',
			...pageInfo,
			screenshot,
			incognito,
			domain,
			sessionId, // Include session ID in response for other operations to use
			brightDataSessionId, // Include Bright Data session ID for reference
			timestamp: new Date().toISOString(),
		};

		// Don't close the browser - it will be used by subsequent operations
		// The session cleanup mechanism will handle closing it after timeout

		return {
			json: responseData,
		};
	} catch (error) {
		// Extract domain if possible
		let domain = '';
		try {
			domain = new URL(url).hostname;
		} catch {}

		let errorMessage = (error as Error).message;
		this.logger.error(`[Ventriloquist][${nodeName}][${nodeId}][Open] Navigation error: ${errorMessage}`);

		// Provide more specific error message for common Bright Data errors
		if (
			errorMessage.includes('This website') &&
			errorMessage.includes('requires special permission from Bright Data')
		) {
			// Error message already properly formatted by BrightDataBrowser.navigateTo()
		} else if (
			(error as Error).message.includes('proxy_error') ||
			(error as Error).message.includes('Forbidden: target site requires special permission')
		) {
			errorMessage = `This website (${domain}) requires special permission from Bright Data. Please add "${domain}" to the 'Domains For Authorization' field in your Bright Data credentials or contact Bright Data support to get this domain authorized for your account. Error details: ${(error as Error).message}`;
		}

		this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Open] ========== END OPEN NODE EXECUTION (WITH ERROR) ==========`);

		// If continueOnFail is false, throw the error to fail the node
		if (!continueOnFail) {
			throw new Error(`Open operation failed: ${errorMessage}`);
		}

		// Otherwise, return an error response
		return {
			json: {
				success: false,
				operation: 'open',
				error: errorMessage,
				domain,
				url,
				sessionId: sessionId || 'error_session', // Include session ID even in error case
				timestamp: new Date().toISOString(),
			},
		};
	}
}
