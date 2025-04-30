import type { Logger as ILogger } from 'n8n-workflow';

/**
 * Standard format for logging - enforces [Nodename][Operation][Component][Function] pattern
 */
export function formatStandardLog(
  nodeName: string,
  operation: string,
  component: string,
  functionName: string | undefined,
  message: string
): string {
  // Ensure all required components are present
  const safeNodeName = nodeName || 'Unknown';
  const safeOperation = operation || 'Unknown';
  const safeComponent = component || 'Core';

  // Add function name part only if provided
  const functionPart = functionName ? `[${functionName}]` : '';

  return `[${safeNodeName}][${safeOperation}][${safeComponent}]${functionPart} ${message}`;
}

/**
 * Log at debug level using standard format
 */
export function logDebug(
  logger: ILogger,
  nodeName: string,
  operation: string,
  component: string,
  functionName: string | undefined,
  message: string
): void {
  logger.debug(formatStandardLog(nodeName, operation, component, functionName, message));
}

/**
 * Log at info level using standard format
 */
export function logInfo(
  logger: ILogger,
  nodeName: string,
  operation: string,
  component: string,
  functionName: string | undefined,
  message: string
): void {
  logger.info(formatStandardLog(nodeName, operation, component, functionName, message));
}

/**
 * Log at warning level using standard format
 */
export function logWarn(
  logger: ILogger,
  nodeName: string,
  operation: string,
  component: string,
  functionName: string | undefined,
  message: string
): void {
  logger.warn(formatStandardLog(nodeName, operation, component, functionName, message));
}

/**
 * Log at error level using standard format
 */
export function logError(
  logger: ILogger,
  nodeName: string,
  operation: string,
  component: string,
  functionName: string | undefined,
  message: string
): void {
  logger.error(formatStandardLog(nodeName, operation, component, functionName, message));
}

/**
 * Handle debug logging with consistent format for normal and debug mode
 *
 * In debug mode:
 * - Logs through the normal logger interface
 * - May also output to console.error for greater visibility
 *
 * @param logger The N8n logger instance
 * @param debugMode Whether debug mode is enabled
 * @param nodeName The name of the node
 * @param operation The current operation being performed
 * @param component The component/file generating the log
 * @param functionName The function generating the log (optional)
 * @param message The message to log
 * @param level The logging level to use
 */
export function logWithDebug(
  logger: ILogger | undefined,
  debugMode: boolean,
  nodeName: string,
  operation: string,
  component: string,
  functionName: string | undefined,
  message: string,
  level: 'debug' | 'info' | 'warn' | 'error' = 'debug'
): void {
  // Format the message with our standard format
  const formattedMessage = formatStandardLog(nodeName, operation, component, functionName, message);

  // Always log through the normal logger interface if logger is available
  if (logger) {
    logger[level](formattedMessage);
  }

  // If debug mode is enabled, also output to console.error for greater visibility
  // This should only be used during development and troubleshooting
  if (debugMode) {
    // For critical debug messages, we output directly to console.error
    // This is because N8n's logger may have throttling or filtering
    console.error(formattedMessage);
  }
}
