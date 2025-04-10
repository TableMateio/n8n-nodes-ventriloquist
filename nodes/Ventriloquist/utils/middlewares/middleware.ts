import type { Logger as ILogger } from 'n8n-workflow';

/**
 * Interface for middleware function
 */
export interface IMiddleware<T, R> {
  execute(input: T, context: IMiddlewareContext): Promise<R>;
}

/**
 * Interface for middleware context
 */
export interface IMiddlewareContext {
  logger: ILogger;
  nodeName: string;
  nodeId: string;
  sessionId: string;
  index?: number;
  data?: Record<string, unknown>;
}

/**
 * Middleware pipeline for executing multiple middlewares in sequence
 */
export class MiddlewarePipeline<T, R> {
  private middlewares: Array<IMiddleware<any, any>> = [];
  private beforeHooks: Array<(input: any, context: IMiddlewareContext) => Promise<void>> = [];
  private afterHooks: Array<(result: any, context: IMiddlewareContext) => Promise<void>> = [];
  private errorHandlers: Array<(error: Error, context: IMiddlewareContext) => Promise<any>> = [];

  /**
   * Add a middleware to the pipeline
   */
  public use<U>(middleware: IMiddleware<T, U>): MiddlewarePipeline<T, U> {
    this.middlewares.push(middleware);
    return this as unknown as MiddlewarePipeline<T, U>;
  }

  /**
   * Add a before hook that runs before every middleware
   */
  public before(hook: (input: T, context: IMiddlewareContext) => Promise<void>): this {
    this.beforeHooks.push(hook);
    return this;
  }

  /**
   * Add an after hook that runs after every middleware
   */
  public after(hook: (result: R, context: IMiddlewareContext) => Promise<void>): this {
    this.afterHooks.push(hook);
    return this;
  }

  /**
   * Add an error handler to the pipeline
   */
  public catch(handler: (error: Error, context: IMiddlewareContext) => Promise<R>): this {
    this.errorHandlers.push(handler);
    return this;
  }

  /**
   * Execute the middleware pipeline
   */
  public async execute(input: T, context: IMiddlewareContext): Promise<R> {
    try {
      // Execute before hooks
      for (const hook of this.beforeHooks) {
        await hook(input, context);
      }

      // Execute middleware chain
      let result: any = input;
      for (const middleware of this.middlewares) {
        result = await middleware.execute(result, context);
      }

      // Execute after hooks
      for (const hook of this.afterHooks) {
        await hook(result, context);
      }

      return result as R;
    } catch (error) {
      // Handle errors with registered error handlers
      if (this.errorHandlers.length > 0) {
        for (const handler of this.errorHandlers) {
          try {
            return await handler(error as Error, context);
          } catch (handlerError) {
            // Continue to next error handler if this one fails
            context.logger.error(
              `[Middleware][${context.nodeName}] Error handler failed: ${(handlerError as Error).message}`
            );
          }
        }
      }

      // If no error handler succeeded, rethrow the error
      throw error;
    }
  }
}

/**
 * Create a new middleware pipeline
 */
export function createPipeline<T, R>(): MiddlewarePipeline<T, R> {
  return new MiddlewarePipeline<T, R>();
}

/**
 * Create a simple middleware from a function
 */
export function createMiddleware<T, R>(
  fn: (input: T, context: IMiddlewareContext) => Promise<R>
): IMiddleware<T, R> {
  return {
    execute: fn,
  };
}
