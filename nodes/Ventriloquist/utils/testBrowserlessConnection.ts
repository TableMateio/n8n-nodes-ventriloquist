import WebSocket from 'ws';
import type { Logger } from 'n8n-workflow';

/**
 * Test a Browserless WebSocket connection directly
 * @param wsUrl Complete WebSocket URL with token
 * @param logger Logger instance
 * @returns Promise that resolves to true if connection successful, false otherwise
 */
export async function testBrowserlessConnection(wsUrl: string, logger: Logger): Promise<boolean> {
  return new Promise((resolve) => {
    logger.info(`Testing direct WebSocket connection to: ${wsUrl.replace(/token=([^&]+)/, 'token=***TOKEN***')}`);

    let ws: WebSocket | null = null;

    // Set timeout for the test
    const timeout = setTimeout(() => {
      logger.error('WebSocket connection test timed out after 10 seconds');
      if (ws) ws.terminate();
      resolve(false);
    }, 10000);

    try {
      // Create WebSocket connection
      ws = new WebSocket(wsUrl);

      // Connection opened
      ws.on('open', () => {
        logger.info('✅ WebSocket connection test SUCCESSFUL');
        clearTimeout(timeout);
        if (ws) ws.close();
        resolve(true);
      });

      // Connection error
      ws.on('error', (err: Error) => {
        logger.error(`❌ WebSocket connection test FAILED: ${err.message}`);
        clearTimeout(timeout);
        if (ws) ws.terminate();
        resolve(false);
      });

      // Connection closed
      ws.on('close', (code: number, reason: string) => {
        if (code !== 1000) { // 1000 is normal closure
          logger.warn(`WebSocket closed with code ${code}: ${reason}`);
        }
      });
    } catch (error) {
      logger.error(`Failed to create WebSocket: ${(error as Error).message}`);
      clearTimeout(timeout);
      resolve(false);
    }
  });
}
