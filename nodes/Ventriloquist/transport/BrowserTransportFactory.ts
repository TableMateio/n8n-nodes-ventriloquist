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
      // Validate required Browserless credentials
      if (!credentials.apiKey) {
        throw new Error('API Key is required for Browserless');
      }

      // Get credential values with defaults
      const apiKey = credentials.apiKey as string;
      const baseUrl = (credentials.baseUrl as string) || 'https://chrome.browserless.io';
      const stealthMode = credentials.stealthMode !== undefined ? credentials.stealthMode as boolean : true;
      const requestTimeout = credentials.connectionTimeout ? credentials.connectionTimeout as number : 120000;
      const wsEndpoint = credentials.wsEndpoint as string || undefined;

      logger.info(`Creating Browserless transport with base URL: ${baseUrl}, direct WebSocket endpoint: ${wsEndpoint || 'none'}`);

      return new BrowserlessTransport(
        logger,
        apiKey,
        baseUrl,
        stealthMode,
        requestTimeout,
        wsEndpoint,
      );
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
