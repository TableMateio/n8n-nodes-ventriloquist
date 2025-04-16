import type { IMiddleware } from './middleware';

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
 * Interface for registering middleware in the system
 */
export interface IMiddlewareRegistration<TInput = any, TOutput = any> {
  id: string;
  type: MiddlewareType;
  middleware: IMiddleware<TInput, TOutput>;
  description?: string;
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
 * Middleware registry implementation
 */
class MiddlewareRegistry implements IMiddlewareRegistry {
  private registrations: Map<string, IMiddlewareRegistration> = new Map();

  /**
   * Register a middleware with the system
   */
  public register<TInput, TOutput>(
    id: string,
    type: MiddlewareType,
    middleware: IMiddleware<TInput, TOutput>,
    description?: string
  ): void {
    this.registrations.set(id, {
      id,
      type,
      middleware,
      description,
    });
  }

  /**
   * Get a middleware by ID
   */
  public get<TInput, TOutput>(id: string): IMiddleware<TInput, TOutput> | undefined {
    const registration = this.registrations.get(id);
    return registration?.middleware as IMiddleware<TInput, TOutput>;
  }

  /**
   * Get all registered middlewares
   */
  public getAll(): IMiddlewareRegistration[] {
    return Array.from(this.registrations.values());
  }

  /**
   * Get all middlewares of a specific type
   */
  public getByType(type: MiddlewareType): IMiddlewareRegistration[] {
    return this.getAll().filter(registration => registration.type === type);
  }
}

// Singleton instance for the registry
let middlewareRegistry: IMiddlewareRegistry | null = null;

/**
 * Initialize the middleware registry
 */
export function initializeMiddlewareRegistry(): IMiddlewareRegistry {
  if (!middlewareRegistry) {
    middlewareRegistry = new MiddlewareRegistry();
  }

  return middlewareRegistry;
}

/**
 * Get the middleware registry
 */
export function getMiddlewareRegistry(): IMiddlewareRegistry {
  if (!middlewareRegistry) {
    return initializeMiddlewareRegistry();
  }
  return middlewareRegistry;
}

/**
 * Register a middleware with the system
 */
export function registerMiddleware<TInput, TOutput>(
  id: string,
  type: MiddlewareType,
  middleware: IMiddleware<TInput, TOutput>,
  description?: string
): void {
  const registry = getMiddlewareRegistry();
  registry.register(id, type, middleware, description);
}

/**
 * Unregister a middleware
 */
export function unregisterMiddleware(id: string): void {
  const registry = getMiddlewareRegistry();
  if (registry instanceof MiddlewareRegistry) {
    (registry as any).registrations.delete(id);
  }
}

/**
 * Create a middleware pipeline that executes a chain of middlewares
 */
export function createMiddlewarePipeline<TInput, TOutput>(
  middlewareIds: string[]
): IMiddleware<TInput, TOutput> {
  return {
    async execute(input: TInput, context: any): Promise<TOutput> {
      const registry = getMiddlewareRegistry();
      let currentInput = input;

      for (const id of middlewareIds) {
        const middleware = registry.get<any, any>(id);
        if (!middleware) {
          throw new Error(`Middleware with ID ${id} not found in registry`);
        }

        currentInput = await middleware.execute(currentInput, context);
      }

      return currentInput as unknown as TOutput;
    }
  };
}
