import type { IMiddleware, IMiddlewareContext } from './middleware';
import type { Logger as ILogger } from 'n8n-workflow';

/**
 * Middleware type enum for categorization
 */
export enum MiddlewareType {
  EXTRACTION = 'extraction',
  MATCHING = 'matching',
  ACTION = 'action',
  FALLBACK = 'fallback',
}

/**
 * Interface for registering a middleware with metadata
 */
export interface IMiddlewareRegistration<TInput, TOutput> {
  /**
   * Unique identifier for the middleware
   */
  id: string;

  /**
   * Display name for the middleware
   */
  name: string;

  /**
   * Description of what the middleware does
   */
  description?: string;

  /**
   * The actual middleware implementation
   */
  middleware: IMiddleware<TInput, TOutput>;

  /**
   * Version of the middleware
   */
  version?: string;

  /**
   * Tags for categorizing this middleware
   */
  tags?: string[];

  /**
   * Optional function to validate the input
   */
  validateInput?: (input: TInput) => boolean | Promise<boolean>;

  /**
   * Optional function to determine if this middleware can handle the given input
   */
  canHandle?: (input: TInput) => boolean | Promise<boolean>;
}

/**
 * Interface for the middleware registry
 */
export interface IMiddlewareRegistry {
  register<TInput, TOutput>(
    id: string,
    type: MiddlewareType,
    middleware: IMiddleware<TInput, TOutput>,
    description?: string
  ): void;

  get<TInput, TOutput>(id: string): IMiddleware<TInput, TOutput> | undefined;

  getAll(): IMiddlewareRegistration[];

  getByType(type: MiddlewareType): IMiddlewareRegistration[];
}

/**
 * Registry for middleware components
 */
class MiddlewareRegistry implements IMiddlewareRegistry {
  private middlewares: Map<string, IMiddlewareRegistration<any, any>> = new Map();
  private logger?: ILogger;

  /**
   * Set the logger for the registry
   */
  public setLogger(logger: ILogger): void {
    this.logger = logger;
  }

  /**
   * Register a middleware
   */
  public register<TInput, TOutput>(registration: IMiddlewareRegistration<TInput, TOutput>): void {
    if (this.middlewares.has(registration.id)) {
      const errorMessage = `Middleware with ID '${registration.id}' is already registered`;
      this.logger?.warn(errorMessage);
      throw new Error(errorMessage);
    }

    this.middlewares.set(registration.id, registration);
    this.logger?.debug(`Registered middleware: ${registration.name} (${registration.id})`);
  }

  /**
   * Get a middleware by ID
   */
  public get<TInput, TOutput>(id: string): IMiddlewareRegistration<TInput, TOutput> | undefined {
    return this.middlewares.get(id) as IMiddlewareRegistration<TInput, TOutput> | undefined;
  }

  /**
   * Check if a middleware is registered
   */
  public has(id: string): boolean {
    return this.middlewares.has(id);
  }

  /**
   * Unregister a middleware
   */
  public unregister(id: string): boolean {
    const result = this.middlewares.delete(id);
    if (result) {
      this.logger?.debug(`Unregistered middleware: ${id}`);
    }
    return result;
  }

  /**
   * Get all registered middlewares
   */
  public getAll(): IMiddlewareRegistration<any, any>[] {
    return Array.from(this.middlewares.values());
  }

  /**
   * Find middlewares by tag
   */
  public findByTag(tag: string): IMiddlewareRegistration<any, any>[] {
    return this.getAll().filter((m) => m.tags?.includes(tag));
  }

  /**
   * Find a middleware that can handle the given input
   */
  public async findHandler<TInput, TOutput>(
    input: TInput
  ): Promise<IMiddlewareRegistration<TInput, TOutput> | undefined> {
    for (const middleware of this.middlewares.values()) {
      if (middleware.canHandle && (await middleware.canHandle(input))) {
        return middleware as IMiddlewareRegistration<TInput, TOutput>;
      }
    }
    return undefined;
  }

  /**
   * Clear all registered middlewares
   */
  public clear(): void {
    this.middlewares.clear();
    this.logger?.debug('Cleared all registered middlewares');
  }
}

// Singleton instance of the middleware registry
const middlewareRegistry = new MiddlewareRegistry();

/**
 * Initialize the middleware registry with a logger
 */
export function initializeMiddlewareRegistry(logger: ILogger): MiddlewareRegistry {
  middlewareRegistry.setLogger(logger);
  logger.info('Middleware registry initialized');
  return middlewareRegistry;
}

/**
 * Get the middleware registry instance
 */
export function getMiddlewareRegistry(): MiddlewareRegistry {
  return middlewareRegistry;
}

/**
 * Helper function to create middleware execution context
 */
export function createExecutionContext(
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
    index
  };
}

/**
 * Execute a specific middleware by its ID
 */
export async function executeMiddleware<TInput, TOutput>(
  middlewareId: string,
  input: TInput,
  context: IMiddlewareContext
): Promise<TOutput> {
  const registry = getMiddlewareRegistry();
  const registration = registry.get<TInput, TOutput>(middlewareId);

  if (!registration) {
    throw new Error(`Middleware with ID '${middlewareId}' not found`);
  }

  if (registration.validateInput) {
    const isValid = await registration.validateInput(input);
    if (!isValid) {
      throw new Error(`Input validation failed for middleware '${middlewareId}'`);
    }
  }

  context.logger.debug(`Executing middleware: ${registration.name} (${middlewareId})`);
  return registration.middleware.execute(input, context);
}
