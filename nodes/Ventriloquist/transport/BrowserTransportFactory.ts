import type { ICredentialDataDecryptedObject } from 'n8n-workflow';
import { BrowserTransport } from './BrowserTransport';
import { BrightDataBrowser } from './BrightDataBrowser';
import { BrowserlessTransport } from './BrowserlessTransport';
import { LocalChromeTransport } from './LocalChromeTransport';

/**
 * Factory for creating browser transports based on credential type
 */
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

        // Added stealth mode handling - users often want this for Browserless
        const stealthMode = credentials.stealthMode !== undefined ? credentials.stealthMode as boolean : true;
        const requestTimeout = credentials.connectionTimeout ? credentials.connectionTimeout as number : 120000;

        return new BrowserlessTransport(
          logger,
          '', // Empty API key - it's already in the WebSocket URL
          '', // Empty base URL - we're using direct WebSocket
          stealthMode,
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

        const stealthMode = credentials.stealthMode !== undefined ? credentials.stealthMode as boolean : true;
        const requestTimeout = credentials.connectionTimeout ? credentials.connectionTimeout as number : 120000;

        logger.info(`Creating Browserless transport with base URL: ${baseUrl}`);

        // Keep transport creation simpler - don't prefix URL if not needed
        return new BrowserlessTransport(
          logger,
          apiKey,
          baseUrl,
          stealthMode,
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
      const stealthMode = credentials.stealthMode !== undefined ? credentials.stealthMode as boolean : true;

      // Parse launch arguments
      const launchArgsStr = credentials.launchArgs as string || '--no-sandbox,--disable-setuid-sandbox';
      const launchArgs = launchArgsStr.split(',').map(arg => arg.trim()).filter(arg => arg.length > 0);

      logger.info(`Creating Local Chrome transport with headless: ${headless}`);
      logger.info(`Launch arguments: ${launchArgs.join(' ')}`);

      return new LocalChromeTransport(
        logger,
        executablePath,
        userDataDir,
        headless,
        launchArgs,
        stealthMode,
        connectionTimeout
      );
    }

    // Default case - unsupported credential type
    throw new Error(`Unsupported credential type: ${credentialType}`);
  }
}
