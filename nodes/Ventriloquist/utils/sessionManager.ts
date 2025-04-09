import * as puppeteerRuntime from "puppeteer-core";
import type { Browser, Page, ConnectOptions } from "puppeteer-core";

/**
 * Interface for logger
 */
export interface ILogger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

/**
 * Interface for browser session
 */
export interface IBrowserSession {
	browser: Browser;
	// pages: Map<string, Page>; // Removed pages map
	lastUsed: Date;
	workflowId?: string; // Optional for backwards compatibility
	credentialType?: string;
}

/**
 * Options for creating a session
 */
export interface CreateSessionOptions {
	apiToken?: string;
	forceNew?: boolean;
	credentialType?: string;
	workflowId?: string; // Optional for backwards compatibility
}

/**
 * Options for closing sessions
 */
export interface CloseSessionOptions {
	sessionId?: string; // Close a specific session
	olderThan?: number; // Close sessions older than X milliseconds
	workflowId?: string; // Close sessions for a specific workflow
	all?: boolean; // Close all sessions
}

/**
 * Result of close sessions operation
 */
export interface CloseSessionResult {
	total: number;
	closed: number;
}

/**
 * Options for getting or creating a page session
 */
export interface GetOrCreatePageSessionOptions {
	explicitSessionId?: string; // A specific session ID to use
	websocketEndpoint: string; // WebSocket endpoint for creating new sessions if needed
	workflowId?: string; // Workflow ID for tracking
	operationName?: string; // Name of the operation (e.g., 'click', 'form')
	nodeId?: string; // ID of the node for logging
	nodeName?: string; // Name of the node for logging
	index?: number; // Index of the node execution for logging
}

/**
 * Result of get or create page session operation
 */
export interface GetOrCreatePageSessionResult {
	page: Page | null;
	sessionId: string;
	isNewSession: boolean;
}

/**
 * Namespace to manage browser sessions
 */
export namespace SessionManager {
	// Store sessions by sessionId
	const sessions = new Map<string, IBrowserSession>();

	// Helper for logging connection operations
	const logConnection = (logger: ILogger, message: string, wsUrl: string) => {
		// Mask any tokens in the URL for security
		const maskedUrl = wsUrl.replace(/token=([^&]+)/, "token=***");
		logger.info(`${message}: ${maskedUrl}`);
	};

	/**
	 * Get WebSocket URL from credentials
	 * Centralizes WebSocket URL construction logic
	 */
	export function getWebSocketUrlFromCredentials(
		logger: ILogger,
		credentialType: string,
		credentials: { [key: string]: unknown },
	): string {
		let websocketEndpoint = "";

		if (credentialType === "brightDataApi") {
			websocketEndpoint = (credentials as { websocketEndpoint: string })
				.websocketEndpoint;
		} else if (credentialType === "browserlessApi") {
			const connectionType =
				(credentials as { connectionType?: string }).connectionType || "direct";
			if (connectionType === "direct") {
				websocketEndpoint = (credentials as { wsEndpoint: string }).wsEndpoint;
			} else {
				const baseUrl =
					(credentials as { baseUrl?: string }).baseUrl ||
					"https://browserless.io";
				const apiKey = (credentials as { apiKey?: string }).apiKey;
				if (!apiKey) {
					throw new Error(
						"API token is required for Browserless standard connection",
					);
				}
				const wsBaseUrl = baseUrl.replace(/^https?:\/\//, "");
				websocketEndpoint = `wss://${wsBaseUrl}?token=${apiKey}`;
				logger.info(
					`Creating WebSocket URL from credentials: ${wsBaseUrl}?token=***`,
				);
			}
		}

		if (
			!websocketEndpoint ||
			typeof websocketEndpoint !== "string" ||
			websocketEndpoint.trim() === ""
		) {
			throw new Error(
				`WebSocket endpoint is required but not configured or invalid for ${credentialType}. Please check your credentials configuration.`,
			);
		}

		return websocketEndpoint;
	}

	/**
	 * Format websocket URL for browser connection
	 */
	function formatWebsocketUrl(
		websocketEndpoint: string,
		options?: {
			apiToken?: string;
			sessionId?: string;
		},
		logger?: ILogger,
	): string {
		const localLogger = logger || {
			info: () => {},
			warn: () => {},
			error: () => {},
		};

		// Validate the endpoint - it should not be empty
		if (!websocketEndpoint || websocketEndpoint.trim() === "") {
			throw new Error("WebSocket endpoint cannot be empty");
		}

		let wsUrl = websocketEndpoint.trim();

		// Check if the URL has a host component
		let hasHost = false;
		try {
			// Test if it's already a valid URL
			new URL(wsUrl);
			hasHost = true;
		} catch (e) {
			// If it's not a valid URL yet, we need to check if it has a hostname
			hasHost = wsUrl.includes(".") || wsUrl.includes("localhost");
		}

		// If there's no host, throw an error as we can't create a valid WebSocket connection
		if (!hasHost) {
			throw new Error(
				`Invalid WebSocket endpoint: ${wsUrl}. Endpoint must include a hostname.`,
			);
		}

		// Add protocol if missing
		if (
			!wsUrl.startsWith("ws://") &&
			!wsUrl.startsWith("wss://") &&
			!wsUrl.startsWith("http://") &&
			!wsUrl.startsWith("https://")
		) {
			wsUrl = `wss://${wsUrl}`;
		}

		// Convert http protocols to ws if needed
		if (wsUrl.startsWith("http://")) {
			wsUrl = wsUrl.replace("http://", "ws://");
		} else if (wsUrl.startsWith("https://")) {
			wsUrl = wsUrl.replace("https://", "wss://");
		}

		// Append timeout explicitly to override potential defaults
		try {
			const wsUrlObj = new URL(wsUrl);
			// Add API token if provided
			if (options?.apiToken) {
				wsUrlObj.searchParams.set("token", options.apiToken);
			}
			// Add session ID if provided
			if (options?.sessionId) {
				wsUrlObj.searchParams.set("sessionId", options.sessionId);
				wsUrlObj.searchParams.set("session", options.sessionId);
			}
			// Add explicit timeout
			wsUrlObj.searchParams.set("timeout", "300000"); // 5 minutes

			wsUrl = wsUrlObj.toString();
			localLogger.info(
				`[SessionManager] Formatted WS URL (with timeout): ${wsUrl.replace(/token=([^&]+)/, "token=***").replace(/timeout=([^&]+)/, "timeout=300000")}`,
			);
		} catch (urlError) {
			localLogger.warn(
				`[SessionManager] Failed to parse WS URL with URL object: ${(urlError as Error).message}. Falling back to string append.`,
			);
			// Fallback string appending (less robust)
			if (options?.apiToken && !wsUrl.includes("token=")) {
				wsUrl += `${wsUrl.includes("?") ? "&" : "?"}token=${options.apiToken}`;
			}
			if (options?.sessionId) {
				wsUrl += `${wsUrl.includes("?") ? "&" : "?"}sessionId=${options.sessionId}&session=${options.sessionId}`;
			}
			// Add explicit timeout (Fallback)
			if (!wsUrl.includes("timeout=")) {
				wsUrl += `${wsUrl.includes("?") ? "&" : "?"}timeout=300000`;
			}
			localLogger.info(
				`[SessionManager] Formatted WS URL (fallback string append): ${wsUrl.replace(/token=([^&]+)/, "token=***").replace(/timeout=([^&]+)/, "timeout=300000")}`,
			);
		}

		// Final validation
		try {
			new URL(wsUrl);
		} catch (e) {
			throw new Error(`Resulting WebSocket URL is invalid: ${wsUrl}`);
		}

		return wsUrl;
	}

	/**
	 * Get or create a page session
	 * This function centralizes the common session management logic that was previously
	 * duplicated across multiple operation files. It handles checking for explicit
	 * session IDs, finding existing sessions, and creating new sessions as needed.
	 */
	export async function getOrCreatePageSession(
		logger: ILogger,
		options: GetOrCreatePageSessionOptions,
	): Promise<GetOrCreatePageSessionResult> {
		const {
			explicitSessionId,
			websocketEndpoint,
			workflowId,
			operationName = "operation",
			nodeId = "unknown",
			nodeName = "unknown",
			index = 0,
		} = options;

		const logPrefix = `[Ventriloquist][${nodeName}#${index}][${operationName}][${nodeId}]`;

		// Initialize result
		let browser: Browser | null = null; // Focus on getting the browser
		let page: Page | null = null; // Page is secondary, might be created by caller
		let sessionId = explicitSessionId || "";
		let isNewSession = false;

		logger.info("============ STARTING SESSION MANAGEMENT ============");
		logger.info(`${logPrefix} Starting session management`);

		// Log session state for debugging
		const sessionsInfo = getAllSessions();
		logger.info(
			`${logPrefix} Available sessions: ${JSON.stringify(sessionsInfo)}`,
		);

		if (explicitSessionId) {
			logger.info(
				`${logPrefix} Looking for explicitly provided session ID: ${explicitSessionId}`,
			);
			const existingSession = getSession(explicitSessionId);

			// Use optional chaining for browser check
			if (existingSession?.browser.isConnected()) {
				logger.info(
					`${logPrefix} Found active existing session with ID: ${sessionId}`,
				);
				browser = existingSession.browser;
				// Don't try to get/create page here, caller will handle it
			} else {
				logger.info(
					`${logPrefix} Session ${explicitSessionId} not found locally or not connected, attempting to connect...`,
				);
				try {
					const result = await connectToSession(
						logger,
						explicitSessionId,
						websocketEndpoint,
					);
					if (result.browser) {
						browser = result.browser;
						logger.info(
							`${logPrefix} Successfully reconnected to session: ${sessionId}`,
						);
						// Caller will handle getting/creating page
					}
				} catch (connectError) {
					logger.warn(
						`${logPrefix} Could not connect to session ${explicitSessionId}: ${(connectError as Error).message}`,
					);
					// Proceed to potentially create a new session if no browser obtained
				}
			}
		}

		// If we don't have a browser yet (no explicit ID or connection failed), check existing or create new
		if (!browser) {
			sessionId = ""; // Clear sessionId if we couldn't use the explicit one
			const allSessions = getAllSessions();
			if (allSessions.length > 0) {
				logger.info(
					`${logPrefix} Found ${allSessions.length} existing sessions. Attempting to use the most recent.`,
				);
				// Try the most recently used session first
				const sortedSessions = allSessions.sort(
					(a, b) => b.info.lastUsed.getTime() - a.info.lastUsed.getTime(),
				);
				for (const sessionInfo of sortedSessions) {
					const session = getSession(sessionInfo.sessionId);
					// Use optional chaining for browser check
					if (session?.browser.isConnected()) {
						logger.info(
							`${logPrefix} Using existing session: ${sessionInfo.sessionId}`,
						);
						browser = session.browser;
						sessionId = sessionInfo.sessionId;
						break; // Found a usable session
					}
				}
			}

			// If still no browser, create a new session
			if (!browser && websocketEndpoint) {
				logger.info(`${logPrefix} Creating new browser session`);
				try {
					const result = await createSession(logger, websocketEndpoint, {
						workflowId,
					});
					isNewSession = true;
					sessionId = result.sessionId;
					browser = result.browser;
					logger.info(`${logPrefix} Created new session with ID: ${sessionId}`);
					// // Navigate to a blank page to initialize it? - Let caller handle initial page creation
					// page = await browser.newPage();
					// await page.goto('about:blank');
				} catch (sessionError) {
					logger.error(
						`${logPrefix} Failed to create browser session: ${(sessionError as Error).message}`,
					);
					throw new Error(
						`Failed to create browser session: ${(sessionError as Error).message}`,
					);
				}
			} else if (!browser) {
				// No existing session and no websocket endpoint
				logger.error(
					`${logPrefix} Cannot find/create a session without a valid websocket endpoint`,
				);
				throw new Error(
					"Cannot find/create a session. Please connect this node to an Open node or provide an explicit session ID.",
				);
			}
		}

		// At this point we MUST have a valid browser and sessionId or have thrown an error
		if (!browser || !sessionId) {
			logger.error(
				`${logPrefix} Failed to get or create a browser session/sessionId`,
			);
			throw new Error("Failed to get or create a browser session/sessionId");
		}

		// --- Crucially, we no longer guarantee returning a page object ---
		// The caller must now use the browser object to get the page(s) it needs.
		// We can try to get the 'last' page as a convenience, but it might be null.
		try {
			const pages = await browser.pages();
			if (pages.length > 0) {
				page = pages[pages.length - 1]; // Provide the last page if available
				logger.info(`${logPrefix} Found last page: ${await page.url()}`);
			} else {
				logger.info(`${logPrefix} No pages currently open in the browser.`);
			}
		} catch (pageError) {
			logger.warn(
				`${logPrefix} Error getting pages from browser: ${(pageError as Error).message}`,
			);
			page = null; // Ensure page is null if error occurs
		}

		logger.info(
			`${logPrefix} Session management complete. Returning session ID: ${sessionId}`,
		);

		// Adjust return type as Page might be null initially
		return {
			page, // This might be null, caller must check/create
			sessionId,
			isNewSession,
		};
	}

	/**
	 * Create a new browser session
	 */
	export async function createSession(
		logger: ILogger,
		websocketEndpoint: string,
		options: CreateSessionOptions = {},
	): Promise<{ sessionId: string; browser: Browser }> {
		// Removed page from return type
		const { apiToken, credentialType = "browserlessApi", workflowId } = options;

		// Generate a unique session ID
		const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

		logger.info(
			`Creating new browser session with endpoint: ${websocketEndpoint}`,
		);

		try {
			// Format the WebSocket URL (PASSING LOGGER)
			const wsUrl = formatWebsocketUrl(websocketEndpoint, { apiToken }, logger);
			logConnection(logger, "Connecting with formatted WebSocket URL", wsUrl);

			// Create connection options (REMOVED INCORRECT TIMEOUT)
			const connectionOptions: ConnectOptions = {
				browserWSEndpoint: wsUrl,
				defaultViewport: {
					width: 1280,
					height: 720,
				},
				// timeout: 300000, // INCORRECT: Removed from here
			};

			// Connect to browser
			logger.info(
				`Attempting puppeteer.connect with options: ${JSON.stringify({ ...connectionOptions, browserWSEndpoint: "ws://...masked..." })}`,
			);
			const browser = await puppeteerRuntime.connect(connectionOptions);
			logger.info("Successfully connected to browser service");

			// Store the session (without pages map)
			const session: IBrowserSession = {
				browser,
				lastUsed: new Date(),
				// pages: new Map<string, Page>(), // Removed
				credentialType,
				workflowId, // Store workflowId for backwards compatibility
			};

			sessions.set(sessionId, session);
			logger.info(`Session created and stored with ID: ${sessionId}`);

			return { browser, sessionId };
		} catch (error) {
			logger.error(
				`Error creating browser session: ${(error as Error).message}`,
			);
			throw new Error(
				`Could not create browser session: ${(error as Error).message}`,
			);
		}
	}

	/**
	 * Get a session by its ID
	 */
	export function getSession(sessionId: string): IBrowserSession | undefined {
		const session = sessions.get(sessionId);
		if (session) {
			// Add a check for browser connection before updating lastUsed?
			if (!session.browser.isConnected()) {
				// Optional: Log warning, remove session?
				// sessions.delete(sessionId);
				// return undefined;
			}
			session.lastUsed = new Date();
		}
		return session;
	}

	/**
	 * Connect to an existing session by its ID
	 */
	export async function connectToSession(
		logger: ILogger,
		sessionId: string,
		websocketEndpoint: string,
		options: { apiToken?: string; credentialType?: string } = {},
	): Promise<{ browser: Browser }> {
		// Removed page from return type
		logger.info(`Connecting to existing browser session: ${sessionId}`);

		// Check if session exists locally first
		const existingSession = sessions.get(sessionId);
		if (existingSession) {
			logger.info(`Session ${sessionId} found in local cache`);
			existingSession.lastUsed = new Date();

			try {
				// Verify the browser connection is still active
				await existingSession.browser.version(); // Or use isConnected()
				logger.info(`Connection to session ${sessionId} is active`);
				return {
					browser: existingSession.browser,
					// page: existingSession.pages.size > 0 ? existingSession.pages.values().next().value : undefined // Removed
				};
			} catch (error) {
				logger.warn(
					`Connection to session ${sessionId} is no longer active: ${(error as Error).message}`,
				);
				// We'll try to reconnect below
			}
		}

		// Session not found locally or not active - try to reconnect remotely
		try {
			// Format the WebSocket URL with session ID (PASSING LOGGER)
			const wsUrl = formatWebsocketUrl(
				websocketEndpoint,
				{
					apiToken: options.apiToken,
					sessionId,
				},
				logger,
			);

			logConnection(logger, "Reconnecting with formatted WebSocket URL", wsUrl);

			// Create connection options (REMOVED INCORRECT TIMEOUT)
			const connectionOptions: ConnectOptions = {
				browserWSEndpoint: wsUrl,
				defaultViewport: {
					width: 1280,
					height: 720,
				},
				// timeout: 300000, // INCORRECT: Removed from here
			};

			// Connect to browser
			logger.info(
				`Attempting puppeteer.connect (reconnect) with options: ${JSON.stringify({ ...connectionOptions, browserWSEndpoint: "ws://...masked..." })}`,
			);
			const browser = await puppeteerRuntime.connect(connectionOptions);
			logger.info(`Successfully reconnected to browser session: ${sessionId}`);

			// Update or create session (without pages map)
			const updatedSession: IBrowserSession = {
				browser,
				lastUsed: new Date(),
				// pages: new Map<string, Page>(), // Removed
				credentialType:
					options.credentialType ||
					existingSession?.credentialType ||
					"browserlessApi",
				workflowId: existingSession?.workflowId, // Using optional chaining here
			};

			// Store the updated session
			sessions.set(sessionId, updatedSession);

			return { browser };
		} catch (error) {
			logger.error(
				`Error connecting to session ${sessionId}: ${(error as Error).message}`,
			);
			throw new Error(
				`Could not connect to session ${sessionId}: ${(error as Error).message}`,
			);
		}
	}

	/**
	 * Close one or more sessions
	 */
	export async function closeSessions(
		logger: ILogger,
		options: CloseSessionOptions = {},
	): Promise<CloseSessionResult> {
		const { sessionId, olderThan, workflowId, all } = options;
		let closedCount = 0;
		const totalSessions = sessions.size;

		// Helper function to close a single session
		const closeSessionById = async (id: string): Promise<boolean> => {
			const session = sessions.get(id);
			if (!session) return false;

			try {
				logger.info(`Closing browser session ${id}`);
				await session.browser.close();
				sessions.delete(id);
				return true;
			} catch (error) {
				logger.error(
					`Error closing session ${id}: ${(error as Error).message}`,
				);
				// Still remove from our tracking as we can't use it
				sessions.delete(id);
				return false;
			}
		};

		// Close a specific session if sessionId provided
		if (sessionId) {
			const success = await closeSessionById(sessionId);
			if (success) closedCount++;
			return { closed: closedCount, total: totalSessions };
		}

		// Close sessions for a specific workflow
		if (workflowId) {
			for (const [id, session] of sessions.entries()) {
				if (session.workflowId === workflowId) {
					const success = await closeSessionById(id);
					if (success) closedCount++;
				}
			}
			return { closed: closedCount, total: totalSessions };
		}

		// Close sessions older than specified age
		if (olderThan) {
			const now = new Date().getTime();
			for (const [id, session] of sessions.entries()) {
				const sessionAge = now - session.lastUsed.getTime();
				if (sessionAge > olderThan) {
					const success = await closeSessionById(id);
					if (success) closedCount++;
				}
			}
			return { closed: closedCount, total: totalSessions };
		}

		// Close all sessions if specified
		if (all) {
			for (const id of sessions.keys()) {
				const success = await closeSessionById(id);
				if (success) closedCount++;
			}
		}

		return { closed: closedCount, total: totalSessions };
	}

	/**
	 * Get all active sessions (for debugging/monitoring)
	 */
	export function getAllSessions(): {
		sessionId: string;
		info: { lastUsed: Date; workflowId?: string };
	}[] {
		// Removed pages count
		const result = [];

		for (const [sessionId, session] of sessions.entries()) {
			result.push({
				sessionId,
				info: {
					// pages: session.pages.size, // Removed
					lastUsed: session.lastUsed,
					workflowId: session.workflowId, // Already correct, no chaining needed here
				},
			});
		}

		return result;
	}

	/**
	 * Check if a session is still connected and valid
	 */
	export async function isSessionActive(sessionId: string): Promise<boolean> {
		const session = sessions.get(sessionId);
		if (!session) return false;

		try {
			// Try to execute a simple command to check if the connection is still active
			await session.browser.version();
			return true; // Connection is active
		} catch (error) {
			return false; // Connection is lost
		}
	}
}
