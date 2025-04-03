import type {
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
	// Track execution time
	const startTime = Date.now();

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;

	// Visual marker to clearly indicate a new node is starting
	this.logger.info("============ STARTING NODE EXECUTION ============");
	this.logger.info(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Starting execution`);

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

	this.logger.info(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Opening URL: ${url}`);

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

		this.logger.info(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Created new browser session with ID: ${sessionId}`);
		this.logger.info(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] IMPORTANT: This session ID must be passed to subsequent operations.`);

		// Create a new page
		const context = incognito
			? await browser.createBrowserContext()
			: browser.defaultBrowserContext();
		page = await context.newPage();

		// Store the page for future operations
		Ventriloquist.storePage(workflowId, sessionId, page);
		this.logger.info(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Stored page reference with session ID: ${sessionId}`);

		// Set up response handling for better error messages
		page.on('response', (response) => {
			if (!response.ok()) {
				this.logger.warn(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Response error: ${response.status()} for ${response.url()}`);
			}
		});

		// Enable debugging if requested
		if (enableDebug) {
			try {
				// Note: Debug mode is enabled but we can't directly access the debug URL
				// The session will be visible in Bright Data's console
				this.logger.info(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Debug mode enabled for this session`);
			} catch (debugError) {
				this.logger.warn(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Failed to enable debugger: ${(debugError as Error).message}`);
			}
		}

		// Navigate to the URL
		this.logger.info(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Navigating to URL: ${url}`);
		const { response, domain } = await brightDataBrowser.navigateTo(page, url, {
			waitUntil,
			timeout,
		});

		// Separate try/catch block for post-navigation operations
		// This ensures that if the execution context is destroyed during navigation,
		// we can still return a useful response with the session ID
		try {
			// Get page information
			const pageInfo = await brightDataBrowser.getPageInfo(page, response);

			// Take a screenshot
			const screenshot = await brightDataBrowser.takeScreenshot(page);

			this.logger.info(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Navigation successful: ${pageInfo.url} (${pageInfo.title})`);
			this.logger.info(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] OPEN OPERATION SUCCESSFUL: Node has finished processing and is ready for the next node`);
			this.logger.info(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] To use this browser session in the next node, you MUST copy this session ID: ${sessionId}`);

			// Add a visual end marker
			this.logger.info("============ NODE EXECUTION COMPLETE ============");

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
				executionDuration: Date.now() - startTime,
				note: "IMPORTANT: Copy this sessionId value to the 'Session ID' field in your Decision, Form or other subsequent operations."
			};

			// Don't close the browser - it will be used by subsequent operations
			// The session cleanup mechanism will handle closing it after timeout

			return {
				json: responseData,
			};
		} catch (postNavError) {
			// Handle errors that occur after successful navigation (like execution context destroyed)
			const errorMessage = (postNavError as Error).message;
			this.logger.warn(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Post-navigation error: ${errorMessage}`);

			// List of error messages related to execution context being destroyed
			const contextDestroyedErrors = [
				'Execution context was destroyed',
				'most likely because of a navigation',
				'Cannot find context with specified id',
				'Cannot find execution context'
			];

			// Check if the error is related to execution context destruction
			const isContextDestroyed = contextDestroyedErrors.some(errorText =>
				errorMessage.includes(errorText)
			);

			if (isContextDestroyed) {
				this.logger.info(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Context destroyed due to navigation - this is expected behavior`);
				this.logger.info(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] This usually happens with redirects or page refreshes during navigation`);
				this.logger.info(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] The browser session was SUCCESSFULLY created with ID: ${sessionId}`);
				this.logger.info(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] The session can be used by downstream nodes even though initial navigation triggered redirects`);

				// Add a visual end marker
				this.logger.info("============ NODE EXECUTION COMPLETE (WITH RECOVERED ERROR) ============");

				// Even with context destroyed, we can return success with the session ID
				// This allows following nodes to use the session
				return {
					json: {
						success: true, // Mark as success since the session was created
						operation: 'open',
						url: url, // Use the original URL since we can't access the current one
						sessionId, // This is the critical piece of information for subsequent nodes
						brightDataSessionId,
						contextDestroyed: true, // Flag to indicate context was destroyed
						contextDestroyedInfo: "This typically happens with redirects. The browser session was successfully created and can be used by following nodes.",
						timestamp: new Date().toISOString(),
						executionDuration: Date.now() - startTime,
						note: "IMPORTANT: Copy this sessionId value to the 'Session ID' field in your Decision, Form or other subsequent operations."
					},
				};
			}

			// For other post-navigation errors, rethrow to be handled by the outer catch block
			throw postNavError;
		}
	} catch (error) {
		// Extract domain if possible
		let domain = '';
		try {
			domain = new URL(url).hostname;
		} catch {}

		let errorMessage = (error as Error).message;
		this.logger.error(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Navigation error: ${errorMessage}`);

		// List of error messages related to execution context being destroyed
		const contextDestroyedErrors = [
			'Execution context was destroyed',
			'most likely because of a navigation',
			'Cannot find context with specified id',
			'Cannot find execution context'
		];

		// Check if the error is related to execution context destruction
		const isContextDestroyed = contextDestroyedErrors.some(errorText =>
			errorMessage.includes(errorText)
		);

		// If it's a context destroyed error and we have a session ID, we can still proceed
		if (isContextDestroyed && sessionId) {
			this.logger.info(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Context destroyed in main try/catch - this is expected behavior`);
			this.logger.info(`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] The browser session was SUCCESSFULLY created with ID: ${sessionId}`);

			// Add a visual end marker
			this.logger.info("============ NODE EXECUTION COMPLETE (WITH RECOVERED ERROR) ============");

			return {
				json: {
					success: true, // Mark as success since the session was created
					operation: 'open',
					url: url, // Use the original URL since we can't access the current one
					sessionId, // This is the critical piece of information for subsequent nodes
					brightDataSessionId,
					contextDestroyed: true, // Flag to indicate context was destroyed
					contextDestroyedInfo: "This typically happens with redirects. The browser session was successfully created and can be used by following nodes.",
					timestamp: new Date().toISOString(),
					executionDuration: Date.now() - startTime,
					note: "IMPORTANT: Copy this sessionId value to the 'Session ID' field in your Decision, Form or other subsequent operations."
				},
			};
		}

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

		// Add a visual end marker
		this.logger.info("============ NODE EXECUTION COMPLETE (WITH ERROR) ============");

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
				executionDuration: Date.now() - startTime,
				note: "IMPORTANT: Copy this sessionId value to the 'Session ID' field in your Decision, Form or other subsequent operations."
			},
		};
	}
}
