import type { Logger as ILogger } from 'n8n-workflow';

/**
 * Middleware context with essential information
 */
export interface IMiddlewareContext {
  logger: ILogger;
  nodeName: string;
  nodeId: string;
  sessionId: string;
  index?: number;
}

/**
 * Base middleware interface for creating middleware components
 */
export interface IMiddleware<TInput, TOutput> {
  /**
   * Execute the middleware with the given input
   */
  execute(input: TInput, context: IMiddlewareContext): Promise<TOutput>;
}

/**
 * Create a middleware context from common parameters
 */
export function createMiddlewareContext(
  logger: ILogger,
  nodeName: string,
  nodeId: string,
  sessionId: string,
  index?: number
): IMiddlewareContext {
  return {
    logger,
    nodeName,
    nodeId,
    sessionId,
    index,
  };
}
