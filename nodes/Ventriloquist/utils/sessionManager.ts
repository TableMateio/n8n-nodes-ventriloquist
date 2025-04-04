import { URL } from 'node:url';
import * as puppeteerRuntime from 'puppeteer-core';
import type { Browser, Page, ConnectOptions } from 'puppeteer-core';
import type { ILogger } from './formOperations';

/**
 * Interface for browser session storage
 */
export interface IBrowserSession {
  browser: Browser;
  lastUsed: Date;
  pages: Map<string, Page>;
  timeout?: number;
  credentialType?: string;
}

/**
 * Namespace to manage browser sessions
 */
export namespace SessionManager {
  // Private storage for sessions
  const sessions = new Map<string, IBrowserSession>();

  /**
   * Get all active sessions
   */
  export function getSessions(): Map<string, IBrowserSession> {
    return sessions;
  }

  /**
   * Get a specific session by ID
   */
  export function getSession(workflowId: string): IBrowserSession | undefined {
    return sessions.get(workflowId);
  }

  /**
   * Get a page by session ID and page ID
   */
  export function getPage(workflowId: string, sessionId: string): Page | undefined {
    const session = sessions.get(workflowId);
    if (session) {
      return session.pages.get(sessionId);
    }
    return undefined;
  }

  /**
   * Store a page reference
   */
  export function storePage(workflowId: string, sessionId: string, page: Page): void {
    let session = sessions.get(workflowId);

    if (!session) {
      // Create a new session if it doesn't exist
      session = {
        browser: page.browser(),
        lastUsed: new Date(),
        pages: new Map<string, Page>(),
      };
      sessions.set(workflowId, session);
    }

    // Store the page in the session
    session.pages.set(sessionId, page);
    session.lastUsed = new Date();
  }

  /**
   * Create or reconnect to a WebSocket session
   * This is a generic method that works with both Browserless and BrightData
   */
  export async function getOrCreateSession(
    workflowId: string,
    websocketEndpoint: string,
    logger: ILogger,
    apiToken?: string,
    forceNewSession = false,
    credentialType = 'browserlessApi'
  ): Promise<{ browser: Browser; sessionId: string }> {
    // Check if we already have a session for this workflow
    let session = sessions.get(workflowId);
    let browser: Browser;

    // Generate a unique session ID
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    if (session && !forceNewSession) {
      logger.info(`Using existing browser session for workflow ${workflowId}`);
      session.lastUsed = new Date();
      browser = session.browser;

      try {
        // Verify the browser connection is still active
        await browser.version();
        logger.info('Browser connection is active.');
      } catch (error) {
        logger.warn(`Browser connection is no longer active: ${(error as Error).message}`);
        logger.info('Creating a new browser session...');

        // Remove the old session
        sessions.delete(workflowId);
        session = undefined;
      }
    }

    if (!session || forceNewSession) {
      // Create a new browser connection
      logger.info(`Creating new browser session with endpoint: ${websocketEndpoint}`);

      try {
        // Process the WebSocket endpoint URL
        let wsUrl = websocketEndpoint;

        // Add protocol if missing
        if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://') &&
            !wsUrl.startsWith('http://') && !wsUrl.startsWith('https://')) {
          wsUrl = `wss://${wsUrl}`;
          logger.info(`Added WSS protocol to WebSocket URL: ${wsUrl}`);
        }

        // Convert http protocols to ws if needed
        if (wsUrl.startsWith('http://')) {
          wsUrl = wsUrl.replace('http://', 'ws://');
        } else if (wsUrl.startsWith('https://')) {
          wsUrl = wsUrl.replace('https://', 'wss://');
        }

        // Add token if provided and not already present
        if (apiToken && !wsUrl.includes('token=')) {
          try {
            const wsUrlObj = new URL(wsUrl);
            wsUrlObj.searchParams.set('token', apiToken);
            wsUrl = wsUrlObj.toString();
          } catch (urlError) {
            logger.warn(`Could not parse WebSocket URL: ${wsUrl}. Adding token directly.`);
            wsUrl += `${wsUrl.includes('?') ? '&' : '?'}token=${apiToken}`;
          }
        }

        // Create connection options
        const connectionOptions: ConnectOptions = {
          browserWSEndpoint: wsUrl,
          defaultViewport: {
            width: 1280,
            height: 720,
          },
        };

        // Connect to browser
        browser = await puppeteerRuntime.connect(connectionOptions);
        logger.info('Successfully connected to browser service');

        // Create new session object
        session = {
          browser,
          lastUsed: new Date(),
          pages: new Map<string, Page>(),
          credentialType,
        };

        // Store the session
        sessions.set(workflowId, session);
      } catch (error) {
        logger.error(`Error connecting to browser: ${(error as Error).message}`);
        throw new Error(`Could not connect to browser: ${(error as Error).message}`);
      }
    } else {
      browser = session.browser;
    }

    return { browser, sessionId };
  }

  /**
   * Reconnect to an existing browser session
   */
  export async function reconnectSession(
    workflowId: string,
    sessionId: string,
    websocketEndpoint: string,
    logger: ILogger,
    apiToken?: string,
    credentialType = 'browserlessApi'
  ): Promise<Browser> {
    logger.info(`Attempting to reconnect to browser session: ${sessionId}`);

    try {
      // Process the WebSocket endpoint URL
      let wsUrl = websocketEndpoint;

      // Add protocol if missing
      if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://') &&
          !wsUrl.startsWith('http://') && !wsUrl.startsWith('https://')) {
        wsUrl = `wss://${wsUrl}`;
        logger.info(`Added WSS protocol to WebSocket URL: ${wsUrl}`);
      }

      // Convert http protocols to ws if needed
      if (wsUrl.startsWith('http://')) {
        wsUrl = wsUrl.replace('http://', 'ws://');
      } else if (wsUrl.startsWith('https://')) {
        wsUrl = wsUrl.replace('https://', 'wss://');
      }

      // Add token if provided and not already present
      if (apiToken && !wsUrl.includes('token=')) {
        try {
          const wsUrlObj = new URL(wsUrl);
          wsUrlObj.searchParams.set('token', apiToken);
          wsUrl = wsUrlObj.toString();
        } catch (urlError) {
          logger.warn(`Could not parse WebSocket URL: ${wsUrl}. Adding token directly.`);
          wsUrl += `${wsUrl.includes('?') ? '&' : '?'}token=${apiToken}`;
        }
      }

      // Add session ID to URL
      try {
        const wsUrlObj = new URL(wsUrl);

        // Set both sessionId and session parameters for compatibility with different implementations
        wsUrlObj.searchParams.set('sessionId', sessionId);
        wsUrlObj.searchParams.set('session', sessionId);

        // Get final URL with session parameters
        wsUrl = wsUrlObj.toString();

        // Mask token for security in logs
        const maskedUrl = wsUrl.replace(/token=([^&]+)/, 'token=***');
        logger.info(`Added session parameters to WebSocket URL: ${maskedUrl}`);
      } catch (urlError) {
        logger.warn(`Could not parse WebSocket URL: ${wsUrl}. Adding session ID directly.`);
        wsUrl += `${wsUrl.includes('?') ? '&' : '?'}sessionId=${sessionId}&session=${sessionId}`;
      }

      // Create connection options
      const connectOptions: ConnectOptions = {
        browserWSEndpoint: wsUrl,
        defaultViewport: {
          width: 1280,
          height: 720,
        },
      };

      // Connect to browser
      const browser = await puppeteerRuntime.connect(connectOptions);
      logger.info(`Successfully reconnected to browser session: ${sessionId}`);

      // Update session
      const session = sessions.get(workflowId);
      if (session) {
        session.browser = browser;
        session.lastUsed = new Date();
        session.credentialType = credentialType;
      } else {
        // Create a new session if it doesn't exist
        sessions.set(workflowId, {
          browser,
          lastUsed: new Date(),
          pages: new Map<string, Page>(),
          credentialType,
        });
      }

      return browser;
    } catch (error) {
      logger.error(`Error reconnecting to browser session: ${(error as Error).message}`);
      throw new Error(`Could not reconnect to browser session: ${(error as Error).message}`);
    }
  }

  /**
   * Close a specific browser session
   */
  export async function closeSession(workflowId: string, logger: ILogger): Promise<boolean> {
    const session = sessions.get(workflowId);

    if (session) {
      try {
        logger.info(`Closing browser session for workflow ${workflowId}`);
        await session.browser.close();
        sessions.delete(workflowId);
        return true;
      } catch (error) {
        logger.error(`Error closing browser session: ${(error as Error).message}`);
        // Still remove the session from tracking since we can't use it
        sessions.delete(workflowId);
        return false;
      }
    }

    return false;
  }

  /**
   * Clean up old sessions that haven't been used for a while
   */
  export async function cleanupSessions(maxAgeMs: number, logger: ILogger): Promise<void> {
    const now = new Date();

    for (const [workflowId, session] of sessions.entries()) {
      const sessionAge = now.getTime() - session.lastUsed.getTime();

      if (sessionAge > maxAgeMs) {
        logger.info(`Cleaning up stale session for workflow ${workflowId} (age: ${sessionAge}ms)`);
        await closeSession(workflowId, logger);
      }
    }
  }

  /**
   * Detect if a session is disconnected
   */
  export async function isSessionDisconnected(workflowId: string, sessionId: string, logger: ILogger): Promise<boolean> {
    const session = sessions.get(workflowId);

    if (!session) {
      return true;
    }

    const page = session.pages.get(sessionId);

    if (!page) {
      return true;
    }

    try {
      // Try to execute a simple command to check if the connection is still active
      await page.evaluate(() => document.title);
      return false; // Connection is active
    } catch (error) {
      logger.warn(`Session appears to be disconnected: ${(error as Error).message}`);
      return true; // Connection is lost
    }
  }
}
