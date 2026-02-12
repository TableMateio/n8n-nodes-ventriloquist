import type { ICredentialDataDecryptedObject } from 'n8n-workflow';
import { BrowserTransport } from './BrowserTransport';
import { BrightDataBrowser } from './BrightDataBrowser';
import { BrowserlessTransport } from './BrowserlessTransport';
import { LocalChromeTransport } from './LocalChromeTransport';

/**
 * Factory for creating browser transports based on credential type
 */
export type AntiDetectionLevel = 'off' | 'standard' | 'maximum';

/**
 * Parse antiDetectionLevel from credentials with backward compatibility for old stealthMode boolean.
 * New credentials have antiDetectionLevel (off/standard/maximum).
 * Old credentials only have stealthMode (boolean) — map true→standard, false→off.
 */
function parseAntiDetectionLevel(credentials: ICredentialDataDecryptedObject): AntiDetectionLevel {
  if (credentials.antiDetectionLevel) {
    return credentials.antiDetectionLevel as AntiDetectionLevel;
  }
  // Backward compat: old credentials only have stealthMode boolean
  if (credentials.stealthMode !== undefined) {
    return credentials.stealthMode ? 'standard' : 'off';
  }
  return 'standard'; // Default
}

export class BrowserTransportFactory {
  /**
   * Create a browser transport based on credential type
   * @param credentialType - Type of credential
   * @param logger - Logger instance
   * @param credentials - Credential data
   */
  createTransport(
    credentialType: string,
    logger: any,
    credentials: ICredentialDataDecryptedObject
  ): BrowserTransport {
    logger.info(`Creating transport for credential type: ${credentialType}`);

    if (credentialType === 'browserlessApi') {
      const connectionType = credentials.connectionType as string || 'direct';
      logger.info(`Using Browserless connection type: ${connectionType}`);

      if (connectionType === 'direct') {
        // Direct WebSocket connection mode (recommended for Railway)
        const wsEndpoint = credentials.wsEndpoint as string;
        if (!wsEndpoint) {
          throw new Error('Direct WebSocket URL is required when using direct connection mode');
        }

        // Prepare the WebSocket URL - add protocol if missing
        let processedEndpoint = wsEndpoint.trim();

        // Check if the endpoint has a protocol, add one if missing
        if (!processedEndpoint.startsWith('ws://') && !processedEndpoint.startsWith('wss://') &&
            !processedEndpoint.startsWith('http://') && !processedEndpoint.startsWith('https://')) {
          logger.info('WebSocket URL missing protocol - adding wss:// prefix');
          processedEndpoint = `wss://${processedEndpoint}`;
        }

        // For direct connections, check if the URL already contains a session ID
        const hasSessionId = processedEndpoint.includes('sessionId=') ||
                            processedEndpoint.includes('session=') ||
                            processedEndpoint.includes('id=');

        if (hasSessionId) {
          logger.info('WebSocket URL already contains a session ID parameter - preserving for reconnection');
        }

        // Log the WebSocket URL with masked token for debugging
        const logSafeUrl = processedEndpoint.replace(/token=([^&]+)/, 'token=***TOKEN***');
        logger.info(`Creating Browserless transport with direct WebSocket URL: ${logSafeUrl}`);
        logger.info(`Session parameters present: ${hasSessionId ? 'YES' : 'NO'}`);

        const antiDetectionLevel = parseAntiDetectionLevel(credentials);
        const requestTimeout = credentials.connectionTimeout ? credentials.connectionTimeout as number : 120000;
        logger.info(`Anti-detection level: ${antiDetectionLevel}`);

        return new BrowserlessTransport(
          logger,
          '', // Empty API key - it's already in the WebSocket URL
          '', // Empty base URL - we're using direct WebSocket
          antiDetectionLevel,
          requestTimeout,
          processedEndpoint, // Use the processed endpoint
        );
      } else {
        // Standard connection mode (domain + token)
        if (!credentials.apiKey) {
          throw new Error('Token is required for Browserless standard connection');
        }

        // Get credential values with defaults
        const apiKey = credentials.apiKey as string;
        let baseUrl = (credentials.baseUrl as string) || 'https://browserless.io';

        // Add protocol to base URL if missing
        if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
          logger.info('Base URL missing protocol - adding https:// prefix');
          baseUrl = `https://${baseUrl}`;
        }

        // Check if this is a Railway deployment or custom deployment
        const isRailwayDeployment = baseUrl.includes('railway.app') ||
                                   baseUrl.includes('up.railway') ||
                                   baseUrl.includes('railway.internal');

        logger.info(`Detected deployment type: ${isRailwayDeployment ? 'Railway' : 'Standard Browserless'}`);
        logger.info(`Using Browserless base URL: ${baseUrl}`);

        const antiDetectionLevel = parseAntiDetectionLevel(credentials);
        const requestTimeout = credentials.connectionTimeout ? credentials.connectionTimeout as number : 120000;

        logger.info(`Creating Browserless transport with base URL: ${baseUrl}`);
        logger.info(`Anti-detection level: ${antiDetectionLevel}`);

        // Keep transport creation simpler - don't prefix URL if not needed
        return new BrowserlessTransport(
          logger,
          apiKey,
          baseUrl,
          antiDetectionLevel,
          requestTimeout,
        );
      }
    }

    if (credentialType === 'brightDataApi') {
      // Validate required Bright Data credentials
      if (!credentials.websocketEndpoint) {
        throw new Error('WebSocket Endpoint is required for Bright Data');
      }

      // Get credential values with defaults
      const websocketEndpoint = credentials.websocketEndpoint as string;
      const authorizedDomains = (credentials.authorizedDomains as string) || '';
      const password = credentials.password as string;

      logger.info(`Creating Bright Data transport with authorized domains: ${authorizedDomains || 'none'}`);

      return new BrightDataBrowser(
        logger,
        websocketEndpoint,
        authorizedDomains,
        password,
      );
    }

    if (credentialType === 'localChromeApi') {
      // Get credential values with defaults
      const executablePath = credentials.executablePath as string || ''; // Will be auto-detected if empty
      const userDataDir = credentials.userDataDir as string || '';
      const headless = credentials.headless !== false; // Default to true
      const connectionTimeout = credentials.connectionTimeout ? credentials.connectionTimeout as number : 120000;
      const antiDetectionLevel = parseAntiDetectionLevel(credentials);

      // Parse launch arguments
      const launchArgsStr = credentials.launchArgs as string || '--no-sandbox,--disable-setuid-sandbox';
      const launchArgs = launchArgsStr.split(',').map(arg => arg.trim()).filter(arg => arg.length > 0);

      // Get window positioning parameters
      const windowPositioning = credentials.windowPositioning === true;
      const windowWidth = credentials.windowWidth as number || 1280;
      const windowHeight = credentials.windowHeight as number || 800;
      const windowX = credentials.windowX as number || 100;
      const windowY = credentials.windowY as number || 100;

      // Get existing Chrome connection parameters
      const connectToExisting = credentials.connectToExisting === true;
      const debuggingHost = credentials.debuggingHost as string || 'localhost';
      const debuggingPort = credentials.debuggingPort as number || 9222;
      const maximizeWindow = credentials.maximizeWindow === true;

      logger.info(`Creating Local Chrome transport with headless: ${headless}`);
      if (maximizeWindow) {
        logger.info('Window will be maximized');
      } else if (windowPositioning) {
        logger.info(`Window positioning: enabled (${windowX},${windowY} ${windowWidth}x${windowHeight})`);
      } else {
        logger.info('Window positioning: disabled (using default position and size)');
      }
      logger.info(`Connection to existing Chrome: ${connectToExisting ? `enabled (${debuggingHost}:${debuggingPort})` : 'disabled'}`);
      logger.info(`Anti-detection level: ${antiDetectionLevel}`);
      logger.info(`Launch arguments: ${launchArgs.join(' ')}`);

      return new LocalChromeTransport(
        logger,
        executablePath,
        userDataDir,
        headless,
        launchArgs,
        antiDetectionLevel,
        connectionTimeout,
        connectToExisting,
        debuggingHost,
        debuggingPort,
        windowPositioning,
        windowWidth,
        windowHeight,
        windowX,
        windowY,
        maximizeWindow
      );
    }

    // Default case - unsupported credential type
    throw new Error(`Unsupported credential type: ${credentialType}`);
  }
}
