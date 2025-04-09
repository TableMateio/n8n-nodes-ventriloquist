import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeProperties,
} from "n8n-workflow";
import type * as puppeteer from "puppeteer-core";
import { BrowserTransportFactory } from "../transport/BrowserTransportFactory";
import { SessionManager } from "../utils/sessionManager";
import { takeScreenshot } from "../utils/navigationUtils";

/**
 * Open operation description
 */
export const description: INodeProperties[] = [
	{
		displayName: "URL",
		name: "url",
		type: "string",
		default: "",
		placeholder: "https://example.com",
		description: "The URL to navigate to",
		required: true,
	},
	{
		displayName: "Incognito Mode",
		name: "incognito",
		type: "boolean",
		default: false,
		description: "Whether to use incognito mode",
	},
	{
		displayName: "Wait Until",
		name: "waitUntil",
		type: "options",
		options: [
			{
				name: "Navigation Complete",
				value: "networkidle0",
				description:
					"Wait until there are no network connections for at least 500ms",
			},
			{
				name: "Almost Complete",
				value: "networkidle2",
				description:
					"Wait until there are no more than 2 network connections for at least 500ms",
			},
			{
				name: "DOM Content Loaded",
				value: "domcontentloaded",
				description: "Wait until DOMContentLoaded event is fired",
			},
			{
				name: "Page Load",
				value: "load",
				description: "Wait until load event is fired",
			},
		],
		default: "networkidle0",
		description: "When to consider navigation completed",
	},
	{
		displayName: "Timeout",
		name: "timeout",
		type: "number",
		default: 30000,
		description: "Maximum navigation time in milliseconds",
	},
	{
		displayName: "Session Timeout",
		name: "sessionTimeout",
		type: "number",
		default: 8,
		description:
			"How long (in minutes) to keep the browser session alive after no activity. A higher value (8-10 minutes) is recommended for testing. This is different from Request Timeout in the credentials which controls individual operations.",
	},
	{
		displayName: "Enable Debug",
		name: "enableDebug",
		type: "boolean",
		default: false,
		description: "Whether to enable debugging",
	},
	{
		displayName: "Continue On Fail",
		name: "continueOnFail",
		type: "boolean",
		default: true,
		description:
			"Whether to continue execution even when browser operations fail (cannot connect or navigate)",
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
	credentialType = "brightDataApi",
): Promise<INodeExecutionData> {
	// Track execution time
	const startTime = Date.now();

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;

	// Visual marker to clearly indicate a new node is starting
	this.logger.info("============ STARTING NODE EXECUTION ============");
	this.logger.info(
		`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Starting execution`,
	);

	const url = this.getNodeParameter("url", index) as string;
	const incognito = this.getNodeParameter("incognito", index, false) as boolean;
	const waitUntil = this.getNodeParameter(
		"waitUntil",
		index,
		"networkidle0",
	) as puppeteer.PuppeteerLifeCycleEvent;
	const timeout = this.getNodeParameter("timeout", index, 30000) as number;
	const continueOnFail = this.getNodeParameter(
		"continueOnFail",
		index,
		true,
	) as boolean;
	const enableDebug = this.getNodeParameter(
		"enableDebug",
		index,
		false,
	) as boolean;

	this.logger.info(
		`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Opening URL: ${url}`,
	);

	// Get credentials based on type
	const credentials = await this.getCredentials(credentialType);

	// Extract WebSocket endpoint from credentials using central utility
	const actualWebsocketEndpoint = SessionManager.getWebSocketUrlFromCredentials(
		this.logger,
		credentialType,
		credentials,
	);

	// Create browser transport factory
	const transportFactory = new BrowserTransportFactory();

	// Create appropriate transport based on credential type
	const browserTransport = transportFactory.createTransport(
		credentialType,
		this.logger,
		credentials,
	);

	let browser: puppeteer.Browser;
	let page: puppeteer.Page | undefined;
	let sessionId = "";
	let brightDataSessionId = "";

	try {
		// Create a new session - Open always creates a new session
		try {
			const sessionResult = await SessionManager.createSession(
				this.logger,
				actualWebsocketEndpoint,
				{
					apiToken: credentials.apiKey as string,
					workflowId, // For backwards compatibility
					credentialType,
				},
			);

			// Store session details
			browser = sessionResult.browser;
			sessionId = sessionResult.sessionId;
			brightDataSessionId = ""; // To be populated if needed

			this.logger.info(
				`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Created new browser session with ID: ${sessionId}`,
			);
			this.logger.info(
				`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] IMPORTANT: This session ID must be passed to subsequent operations.`,
			);

			// Create a new page
			const context = incognito
				? await browser.createBrowserContext()
				: browser.defaultBrowserContext();
			page = await context.newPage();

			// Enable debugging if requested
			if (enableDebug) {
				try {
					// Note: Debug mode is enabled but we can't directly access the debug URL
					// The session will be visible in Bright Data's console
					this.logger.info(
						`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Debug mode enabled for this session`,
					);
				} catch (debugError) {
					this.logger.warn(
						`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Failed to enable debugger: ${(debugError as Error).message}`,
					);
				}
			}

			// Navigate to the URL
			this.logger.info(
				`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Navigating to URL: ${url}`,
			);

			// Use the transport to navigate
			const { response, domain } = await browserTransport.navigateTo(
				page,
				url,
				{
					waitUntil,
					timeout,
				},
			);

			// Separate try/catch block for post-navigation operations
			// This ensures that if the execution context is destroyed during navigation,
			// we can still return a useful response with the session ID
			try {
				// Get page information
				const pageInfo = await browserTransport.getPageInfo(page, response);

				// Take a screenshot
				const screenshot = await takeScreenshot(page, this.logger);

				this.logger.info(
					`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Navigation successful: ${pageInfo.url} (${pageInfo.title})`,
				);
				this.logger.info(
					`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] OPEN OPERATION SUCCESSFUL: Node has finished processing and is ready for the next node`,
				);
				this.logger.info(
					`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] To use this browser session in the next node, you MUST copy this session ID: ${sessionId}`,
				);

				// Add a visual end marker
				this.logger.info("============ NODE EXECUTION COMPLETE ============");

				// Prepare response data
				const responseData: IDataObject = {
					success: true,
					operation: "open",
					...pageInfo,
					screenshot,
					incognito,
					domain,
					sessionId, // Include session ID in response for other operations to use
					brightDataSessionId, // Include Bright Data session ID for reference
					credentialType, // Include the type of credential used
					timestamp: new Date().toISOString(),
					executionDuration: Date.now() - startTime,
					note: "IMPORTANT: Copy this sessionId value to the 'Session ID' field in your Decision, Form or other subsequent operations.",
				};

				// Don't close the browser - it will be used by subsequent operations
				// The session cleanup mechanism will handle closing it after timeout

				return {
					json: responseData,
				};
			} catch (postNavError) {
				// Handle errors that occur after successful navigation (like execution context destroyed)
				const errorMessage = (postNavError as Error).message;
				this.logger.warn(
					`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Post-navigation error: ${errorMessage}`,
				);

				// List of error messages related to execution context being destroyed
				const contextDestroyedErrors = [
					"Execution context was destroyed",
					"most likely because of a navigation",
					"Cannot find context with specified id",
					"Cannot find execution context",
				];

				// Check if the error is related to execution context destruction
				const isContextDestroyed = contextDestroyedErrors.some((errorText) =>
					errorMessage.includes(errorText),
				);

				if (isContextDestroyed) {
					this.logger.info(
						`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Context destroyed due to navigation - this is expected behavior`,
					);
					this.logger.info(
						`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] This usually happens with redirects or page refreshes during navigation`,
					);
					this.logger.info(
						`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] The browser session was SUCCESSFULLY created with ID: ${sessionId}`,
					);
					this.logger.info(
						`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] The session can be used by downstream nodes even though initial navigation triggered redirects`,
					);

					// Add a visual end marker
					this.logger.info(
						"============ NODE EXECUTION COMPLETE (WITH RECOVERED ERROR) ============",
					);

					// Even with context destroyed, we can return success with the session ID
					// This allows following nodes to use the session
					return {
						json: {
							success: true, // Mark as success since the session was created
							operation: "open",
							url: url, // Use the original URL since we can't access the current one
							sessionId, // This is the critical piece of information for subsequent nodes
							brightDataSessionId,
							contextDestroyed: true, // Flag to indicate context was destroyed
							contextDestroyedInfo:
								"This typically happens with redirects. The browser session was successfully created and can be used by following nodes.",
							timestamp: new Date().toISOString(),
							executionDuration: Date.now() - startTime,
							note: "IMPORTANT: Copy this sessionId value to the 'Session ID' field in your Decision, Form or other subsequent operations.",
						},
					};
				}

				// For other post-navigation errors, rethrow to be handled by the outer catch block
				throw postNavError;
			}
		} catch (sessionError) {
			// More specific error handling for session creation
			this.logger.error(
				`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Session creation error: ${(sessionError as Error).message}`,
			);

			// Verify credentials and connection settings for better error reporting
			if ((sessionError as Error).message.includes("WebSocket endpoint")) {
				throw new Error(
					`Invalid WebSocket endpoint configuration: ${(sessionError as Error).message}. Please check your Browserless credentials configuration.`,
				);
			}
			if ((sessionError as Error).message.includes("token")) {
				throw new Error(
					`Authentication error: ${(sessionError as Error).message}. Please check your API token in credentials.`,
				);
			}
			throw sessionError;
		}
	} catch (error) {
		// Handle navigation and general errors
		this.logger.error(
			`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Error: ${(error as Error).message}`,
		);

		// Create an error object
		const errorData: IDataObject = {
			error: (error as Error).message,
			url,
			timestamp: new Date().toISOString(),
		};

		// Try to take a screenshot if we have a page
		if (page) {
			try {
				const errorScreenshot = await takeScreenshot(page, this.logger);
				if (errorScreenshot) {
					errorData.screenshot = errorScreenshot;
				}
			} catch (screenshotError) {
				this.logger.warn(
					`Could not take error screenshot: ${(screenshotError as Error).message}`,
				);
			}
		}

		// Clean up resources if continueOnFail is not enabled
		if (!continueOnFail && sessionId) {
			try {
				await SessionManager.closeSessions(this.logger, { sessionId });
				this.logger.info(
					`[Ventriloquist][${nodeName}#${index}][Open][${nodeId}] Closed browser session due to error`,
				);
			} catch (closeError) {
				this.logger.warn(
					`Failed to close browser session: ${(closeError as Error).message}`,
				);
			}
		}

		if (continueOnFail) {
			// Return a partial result with error information
			return {
				json: {
					success: false,
					operation: "open",
					url,
					sessionId,
					brightDataSessionId,
					error: (error as Error).message,
					errorDetails: errorData,
					timestamp: new Date().toISOString(),
					executionDuration: Date.now() - startTime,
				},
			};
		}

		// If continueOnFail is false, actually throw the error
		throw error;
	}
}
