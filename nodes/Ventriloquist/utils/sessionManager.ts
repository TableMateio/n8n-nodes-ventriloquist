import { URL } from 'node:url';
import * as puppeteerRuntime from 'puppeteer-core';
import type { Browser, Page, ConnectOptions } from 'puppeteer-core';

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
  pages: Map<string, Page>;
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
 * Namespace to manage browser sessions
 */
export namespace SessionManager {
  // Store sessions by sessionId
  const sessions = new Map<string, IBrowserSession>();

  // Helper for logging connection operations
  const logConnection = (logger: ILogger, message: string, wsUrl: string) => {
    // Mask any tokens in the URL for security
    const maskedUrl = wsUrl.replace(/token=([^&]+)/, 'token=***');
    logger.info(`${message}: ${maskedUrl}`);
  };

  /**
   * Format websocket URL for browser connection
   */
  function formatWebsocketUrl(
    websocketEndpoint: string,
    options?: {
      apiToken?: string,
      sessionId?: string
    }
  ): string {
    // Validate the endpoint - it should not be empty
    if (!websocketEndpoint || websocketEndpoint.trim() === '') {
      throw new Error('WebSocket endpoint cannot be empty');
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
      hasHost = wsUrl.includes('.') || wsUrl.includes('localhost');
    }

    // If there's no host, throw an error as we can't create a valid WebSocket connection
    if (!hasHost) {
      throw new Error(`Invalid WebSocket endpoint: ${wsUrl}. Endpoint must include a hostname.`);
    }

    // Add protocol if missing
    if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://') &&
        !wsUrl.startsWith('http://') && !wsUrl.startsWith('https://')) {
      wsUrl = `wss://${wsUrl}`;
    }

    // Convert http protocols to ws if needed
    if (wsUrl.startsWith('http://')) {
      wsUrl = wsUrl.replace('http://', 'ws://');
    } else if (wsUrl.startsWith('https://')) {
      wsUrl = wsUrl.replace('https://', 'wss://');
    }

    // Add token if provided and not already present
    if (options?.apiToken && !wsUrl.includes('token=')) {
      try {
        const wsUrlObj = new URL(wsUrl);
        wsUrlObj.searchParams.set('token', options.apiToken);
        wsUrl = wsUrlObj.toString();
      } catch (urlError) {
        // Check if the URL is valid before appending anything
        if (!hasHost) {
          throw new Error(`Cannot add token to invalid URL: ${wsUrl}`);
        }
        // Fall back to direct string concatenation
        wsUrl += `${wsUrl.includes('?') ? '&' : '?'}token=${options.apiToken}`;
      }
    }

    // Add sessionId if provided
    if (options?.sessionId) {
      try {
        const wsUrlObj = new URL(wsUrl);
        // Set both sessionId and session parameters for compatibility with different implementations
        wsUrlObj.searchParams.set('sessionId', options.sessionId);
        wsUrlObj.searchParams.set('session', options.sessionId);
        wsUrl = wsUrlObj.toString();
      } catch (urlError) {
        // Check if the URL is valid before appending anything
        if (!hasHost) {
          throw new Error(`Cannot add session ID to invalid URL: ${wsUrl}`);
        }
        // Fall back to direct string concatenation
        wsUrl += `${wsUrl.includes('?') ? '&' : '?'}sessionId=${options.sessionId}&session=${options.sessionId}`;
      }
    }

    // Final validation - make sure we have a valid URL
    try {
      new URL(wsUrl);
    } catch (e) {
      throw new Error(`Resulting WebSocket URL is invalid: ${wsUrl}`);
    }

    return wsUrl;
  }

  /**
   * Create a new browser session
   */
  export async function createSession(
    logger: ILogger,
    websocketEndpoint: string,
    options: CreateSessionOptions = {}
  ): Promise<{ sessionId: string; browser: Browser; page?: Page }> {
    const {
      apiToken,
      credentialType = 'browserlessApi',
      workflowId
    } = options;

    // Generate a unique session ID
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    logger.info(`Creating new browser session with endpoint: ${websocketEndpoint}`);

    try {
      // Format the WebSocket URL
      const wsUrl = formatWebsocketUrl(websocketEndpoint, { apiToken });
      logConnection(logger, "Connecting with formatted WebSocket URL", wsUrl);

      // Create connection options
      const connectionOptions: ConnectOptions = {
        browserWSEndpoint: wsUrl,
        defaultViewport: {
          width: 1280,
          height: 720,
        },
      };

      // Connect to browser
      const browser = await puppeteerRuntime.connect(connectionOptions);
      logger.info('Successfully connected to browser service');

      // Store the session
      const session: IBrowserSession = {
        browser,
        lastUsed: new Date(),
        pages: new Map<string, Page>(),
        credentialType,
        workflowId // Store workflowId for backwards compatibility
      };

      sessions.set(sessionId, session);
      logger.info(`Session created and stored with ID: ${sessionId}`);

      return { browser, sessionId };
    } catch (error) {
      logger.error(`Error creating browser session: ${(error as Error).message}`);
      throw new Error(`Could not create browser session: ${(error as Error).message}`);
    }
  }

  /**
   * Get a session by its ID
   */
  export function getSession(sessionId: string): IBrowserSession | undefined {
    const session = sessions.get(sessionId);
    if (session) {
      // Update last used timestamp
      session.lastUsed = new Date();
    }
    return session;
  }

  /**
   * Get a page from a session
   */
  export function getPage(sessionId: string, pageId?: string): Page | undefined {
    const session = getSession(sessionId);
    if (!session) return undefined;

    // If pageId is provided, try to get that specific page
    if (pageId && session.pages.has(pageId)) {
      return session.pages.get(pageId);
    }

    // Otherwise, return the first available page if any exist
    if (session.pages.size > 0) {
      return session.pages.values().next().value;
    }

    return undefined;
  }

  /**
   * Store a page in a session
   */
  export function storePage(sessionId: string, pageId: string, page: Page): void {
    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error(`Cannot store page: session ${sessionId} not found`);
    }

    session.pages.set(pageId, page);
    session.lastUsed = new Date();
  }

  /**
   * Connect to an existing session by its ID
   */
  export async function connectToSession(
    logger: ILogger,
    sessionId: string,
    websocketEndpoint: string,
    options: { apiToken?: string, credentialType?: string } = {}
  ): Promise<{ browser: Browser; page?: Page }> {
    logger.info(`Connecting to existing browser session: ${sessionId}`);

    // Check if session exists locally first
    const existingSession = sessions.get(sessionId);
    if (existingSession) {
      logger.info(`Session ${sessionId} found in local cache`);
      existingSession.lastUsed = new Date();

      try {
        // Verify the browser connection is still active
        await existingSession.browser.version();
        logger.info(`Connection to session ${sessionId} is active`);
        return {
          browser: existingSession.browser,
          page: existingSession.pages.size > 0 ? existingSession.pages.values().next().value : undefined
        };
      } catch (error) {
        logger.warn(`Connection to session ${sessionId} is no longer active: ${(error as Error).message}`);
        // We'll try to reconnect below
      }
    }

    // Session not found locally or not active - try to reconnect remotely
    try {
      // Format the WebSocket URL with session ID
      const wsUrl = formatWebsocketUrl(websocketEndpoint, {
        apiToken: options.apiToken,
        sessionId
      });

      logConnection(logger, "Reconnecting with formatted WebSocket URL", wsUrl);

      // Create connection options
      const connectionOptions: ConnectOptions = {
        browserWSEndpoint: wsUrl,
        defaultViewport: {
          width: 1280,
          height: 720,
        },
      };

      // Connect to browser
      const browser = await puppeteerRuntime.connect(connectionOptions);
      logger.info(`Successfully reconnected to browser session: ${sessionId}`);

      // Update or create session
      const updatedSession: IBrowserSession = {
        browser,
        lastUsed: new Date(),
        pages: new Map<string, Page>(),
        credentialType: options.credentialType || existingSession?.credentialType || 'browserlessApi',
        workflowId: existingSession?.workflowId
      };

      // Store the updated session
      sessions.set(sessionId, updatedSession);

      return { browser };
    } catch (error) {
      logger.error(`Error connecting to session ${sessionId}: ${(error as Error).message}`);
      throw new Error(`Could not connect to session ${sessionId}: ${(error as Error).message}`);
    }
  }

  /**
   * Close one or more sessions
   */
  export async function closeSessions(
    logger: ILogger,
    options: CloseSessionOptions = {}
  ): Promise<{ closed: number; total: number }> {
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
        logger.error(`Error closing session ${id}: ${(error as Error).message}`);
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
  export function getAllSessions(): { sessionId: string, info: { pages: number, lastUsed: Date, workflowId?: string } }[] {
    const result = [];

    for (const [sessionId, session] of sessions.entries()) {
      result.push({
        sessionId,
        info: {
          pages: session.pages.size,
          lastUsed: session.lastUsed,
          workflowId: session.workflowId
        }
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
