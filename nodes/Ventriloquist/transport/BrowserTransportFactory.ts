import type { ICredentialDataDecryptedObject } from 'n8n-workflow';
import { BrowserTransport } from './BrowserTransport';
import { BrightDataBrowser } from './BrightDataBrowser';
import { BrowserlessTransport } from './BrowserlessTransport';

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
      const connectionType = credentials.connectionType as string || 'standard';
      logger.info(`Using Browserless connection type: ${connectionType}`);

      if (connectionType === 'direct') {
        // Direct WebSocket connection mode (recommended for Railway)
        const wsEndpoint = credentials.wsEndpoint as string;
        if (!wsEndpoint) {
          throw new Error('Direct WebSocket URL is required when using direct connection mode');
        }

        // For direct connections, we only need the WebSocket URL
        // We'll pass empty string as the API key because the token is already in the WebSocket URL
        const stealthMode = credentials.stealthMode !== undefined ? credentials.stealthMode as boolean : true;
        const requestTimeout = credentials.connectionTimeout ? credentials.connectionTimeout as number : 120000;

        logger.info(`Creating Browserless transport with direct WebSocket URL: ${wsEndpoint.replace(/token=([^&]+)/, 'token=***TOKEN***')}`);

        return new BrowserlessTransport(
          logger,
          '', // Empty API key - it's already in the WebSocket URL
          '', // Empty base URL - we're using direct WebSocket
          stealthMode,
          requestTimeout,
          wsEndpoint,
        );
      } else {
        // Standard connection mode (domain + token)
        if (!credentials.apiKey) {
          throw new Error('Token is required for Browserless standard connection');
        }

        // Get credential values with defaults
        const apiKey = credentials.apiKey as string;
        const baseUrl = (credentials.baseUrl as string) || 'https://chrome.browserless.io';
        const stealthMode = credentials.stealthMode !== undefined ? credentials.stealthMode as boolean : true;
        const requestTimeout = credentials.connectionTimeout ? credentials.connectionTimeout as number : 120000;

        logger.info(`Creating Browserless transport with base URL: ${baseUrl}`);

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

    // Default case - unsupported credential type
    throw new Error(`Unsupported credential type: ${credentialType}`);
  }
}
