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
 * Pipeline of middleware components
 */
export interface MiddlewarePipeline<TInput, TOutput> {
  /**
   * Add a middleware to the pipeline
   */
  use(middleware: IMiddleware<any, any>): MiddlewarePipeline<TInput, TOutput>;

  /**
   * Execute the pipeline with the given input
   */
  execute(input: TInput, context: IMiddlewareContext): Promise<TOutput>;

  /**
   * Add a hook to run before execution
   */
  before(hook: (input: TInput, context: IMiddlewareContext) => Promise<void>): MiddlewarePipeline<TInput, TOutput>;

  /**
   * Add a hook to run after execution
   */
  after(hook: (result: TOutput, context: IMiddlewareContext) => Promise<void>): MiddlewarePipeline<TInput, TOutput>;

  /**
   * Add an error handler
   */
  catch(handler: (error: Error, context: IMiddlewareContext) => Promise<TOutput>): MiddlewarePipeline<TInput, TOutput>;
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

/**
 * Create a new middleware pipeline
 */
export function createPipeline<TInput, TOutput>(): MiddlewarePipeline<TInput, TOutput> {
  const middlewares: IMiddleware<any, any>[] = [];
  const beforeHooks: Array<(input: TInput, context: IMiddlewareContext) => Promise<void>> = [];
  const afterHooks: Array<(result: TOutput, context: IMiddlewareContext) => Promise<void>> = [];
  const errorHandlers: Array<(error: Error, context: IMiddlewareContext) => Promise<TOutput>> = [];

  return {
    use(middleware: IMiddleware<any, any>): MiddlewarePipeline<TInput, TOutput> {
      middlewares.push(middleware);
      return this;
    },

    async execute(input: TInput, context: IMiddlewareContext): Promise<TOutput> {
      try {
        // Run before hooks
        for (const hook of beforeHooks) {
          await hook(input, context);
        }

        if (middlewares.length === 0) {
          throw new Error('No middleware in pipeline');
        }

        // Chain the middleware execution
        let result: any = input;
        for (const middleware of middlewares) {
          result = await middleware.execute(result, context);
        }

        const typedResult = result as TOutput;

        // Run after hooks
        for (const hook of afterHooks) {
          await hook(typedResult, context);
        }

        return typedResult;
      } catch (error) {
        // Handle errors
        if (errorHandlers.length > 0) {
          for (const handler of errorHandlers) {
            try {
              return await handler(error as Error, context);
            } catch (handlerError) {
              context.logger.error(`Error handler failed: ${(handlerError as Error).message}`);
              // Continue to the next handler
            }
          }
        }

        // If no handler succeeded, rethrow the error
        throw error;
      }
    },

    before(hook: (input: TInput, context: IMiddlewareContext) => Promise<void>): MiddlewarePipeline<TInput, TOutput> {
      beforeHooks.push(hook);
      return this;
    },

    after(hook: (result: TOutput, context: IMiddlewareContext) => Promise<void>): MiddlewarePipeline<TInput, TOutput> {
      afterHooks.push(hook);
      return this;
    },

    catch(handler: (error: Error, context: IMiddlewareContext) => Promise<TOutput>): MiddlewarePipeline<TInput, TOutput> {
      errorHandlers.push(handler);
      return this;
    },
  };
}
