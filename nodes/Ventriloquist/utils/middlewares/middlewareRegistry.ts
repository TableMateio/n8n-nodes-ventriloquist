import type { Logger as ILogger } from 'n8n-workflow';
import { IMiddleware, IMiddlewareContext, createPipeline, MiddlewarePipeline } from './middleware';

/**
 * Types of middleware supported by the registry
 */
export enum MiddlewareType {
  EXTRACTION = 'extraction',             // For data extraction
  MATCHING = 'matching',                 // For entity matching
  TRANSFORMATION = 'transformation',     // For data transformation
  VALIDATION = 'validation',             // For data validation
  AI = 'ai',                             // For AI integrations
  ACTION = 'action',                     // For page actions
  FALLBACK = 'fallback',                 // For error handling
  CUSTOM = 'custom',                     // For custom middleware
  ENTITY_MATCHER_EXTRACTION = 'entityMatcherExtraction',  // For entity matcher extraction
  ENTITY_MATCHER_COMPARISON = 'entityMatcherComparison',  // For entity matcher comparison
  ENTITY_MATCHER_ACTION = 'entityMatcherAction'           // For entity matcher actions
}

/**
 * Middleware registration info
 */
export interface IMiddlewareRegistration<T = any, R = any> {
  id?: string;
  type: MiddlewareType;
  name: string;
  description: string;
  middleware?: IMiddleware<T, R>;
  dependencies?: string[];
  configSchema?: object;
  version?: number;
  tags?: string[];
}

/**
 * Middleware registry for managing all middleware components
 */
export class MiddlewareRegistry {
  private static instance: MiddlewareRegistry;
  private middlewares: Map<string, IMiddlewareRegistration> = new Map();
  private logger?: ILogger;

  /**
   * Get the singleton instance
   */
  public static getInstance(): MiddlewareRegistry {
    if (!MiddlewareRegistry.instance) {
      MiddlewareRegistry.instance = new MiddlewareRegistry();
    }
    return MiddlewareRegistry.instance;
  }

  /**
   * Set the logger for the registry
   */
  public setLogger(logger: ILogger): void {
    this.logger = logger;
  }

  /**
   * Register a middleware component
   */
  public register<T, R>(registration: IMiddlewareRegistration<T, R>): void {
    // Generate an ID if not provided
    const id = registration.id || `${registration.type}_${registration.name}_${Date.now()}`;

    if (this.middlewares.has(id)) {
      const message = `Middleware with ID ${id} already registered`;
      this.logger?.warn(`[MiddlewareRegistry] ${message}`);
      throw new Error(message);
    }

    // Create a complete registration with the ID
    const completeRegistration = {
      ...registration,
      id
    };

    this.middlewares.set(id, completeRegistration);
    this.logger?.debug(
      `[MiddlewareRegistry] Registered middleware: ${id} (${registration.type})`
    );
  }

  /**
   * Unregister a middleware component
   */
  public unregister(id: string): boolean {
    const result = this.middlewares.delete(id);
    if (result) {
      this.logger?.debug(`[MiddlewareRegistry] Unregistered middleware: ${id}`);
    } else {
      this.logger?.warn(`[MiddlewareRegistry] Middleware not found for unregistration: ${id}`);
    }
    return result;
  }

  /**
   * Get a middleware registration by ID
   */
  public getRegistration(id: string): IMiddlewareRegistration | undefined {
    return this.middlewares.get(id);
  }

  /**
   * Get all middleware registrations
   */
  public getAllRegistrations(): IMiddlewareRegistration[] {
    return Array.from(this.middlewares.values());
  }

  /**
   * Get all middleware registrations of a specific type
   */
  public getRegistrationsByType(type: MiddlewareType): IMiddlewareRegistration[] {
    return Array.from(this.middlewares.values()).filter(
      registration => registration.type === type
    );
  }

  /**
   * Get all middleware registrations with specific tags
   */
  public getRegistrationsByTags(tags: string[]): IMiddlewareRegistration[] {
    return Array.from(this.middlewares.values()).filter(
      registration => registration.tags && tags.some(tag => registration.tags!.includes(tag))
    );
  }

  /**
   * Create a middleware instance by ID
   */
  public createMiddleware<T, R>(id: string): IMiddleware<T, R> {
    const registration = this.middlewares.get(id);
    if (!registration) {
      const message = `Middleware with ID ${id} not found`;
      this.logger?.error(`[MiddlewareRegistry] ${message}`);
      throw new Error(message);
    }

    return registration.middleware as IMiddleware<T, R>;
  }

  /**
   * Create a pipeline from a list of middleware IDs
   */
  public createPipeline<T, R>(middlewareIds: string[]): MiddlewarePipeline<T, R> {
    const pipeline = createPipeline<T, R>();

    // Check dependencies and build ordered middleware list
    const orderedIds = this.resolveDependencies(middlewareIds);

    // Add middlewares to pipeline
    for (const id of orderedIds) {
      const registration = this.middlewares.get(id);
      if (!registration) {
        const message = `Middleware with ID ${id} not found`;
        this.logger?.error(`[MiddlewareRegistry] ${message}`);
        throw new Error(message);
      }

      pipeline.use(registration.middleware as IMiddleware<any, any>);
      this.logger?.debug(`[MiddlewareRegistry] Added middleware to pipeline: ${id}`);
    }

    return pipeline;
  }

  /**
   * Resolve middleware dependencies and return ordered list
   */
  private resolveDependencies(middlewareIds: string[]): string[] {
    // Build dependency graph
    const graph: Record<string, string[]> = {};
    const visited: Record<string, boolean> = {};
    const result: string[] = [];

    // Initialize graph
    for (const id of middlewareIds) {
      const registration = this.middlewares.get(id);
      if (!registration) {
        const message = `Middleware with ID ${id} not found while resolving dependencies`;
        this.logger?.error(`[MiddlewareRegistry] ${message}`);
        throw new Error(message);
      }

      graph[id] = registration.dependencies || [];
      visited[id] = false;
    }

    // Helper function for topological sort
    const topologicalSort = (id: string, temp: Record<string, boolean> = {}): void => {
      if (temp[id]) {
        const message = `Circular dependency detected in middleware: ${id}`;
        this.logger?.error(`[MiddlewareRegistry] ${message}`);
        throw new Error(message);
      }

      if (!visited[id]) {
        temp[id] = true;

        // Process dependencies
        const dependencies = graph[id] || [];
        for (const depId of dependencies) {
          // Ensure dependency is registered
          if (!this.middlewares.has(depId)) {
            const message = `Dependency middleware not registered: ${depId} (required by ${id})`;
            this.logger?.error(`[MiddlewareRegistry] ${message}`);
            throw new Error(message);
          }

          topologicalSort(depId, temp);
        }

        visited[id] = true;
        temp[id] = false;
        result.push(id);
      }
    };

    // Perform topological sort for each middleware
    for (const id of middlewareIds) {
      if (!visited[id]) {
        topologicalSort(id);
      }
    }

    return result;
  }

  /**
   * Clear all registered middlewares
   */
  public clear(): void {
    this.middlewares.clear();
    this.logger?.debug('[MiddlewareRegistry] Cleared all middleware registrations');
  }
}

/**
 * Convenience function to get the middleware registry instance
 */
export function getMiddlewareRegistry(): MiddlewareRegistry {
  return MiddlewareRegistry.getInstance();
}

/**
 * Middleware composer for creating reusable pipeline configurations
 */
export class MiddlewareComposer<T, R> {
  private registry: MiddlewareRegistry;
  private middlewareIds: string[] = [];
  private beforeHooks: Array<(input: T, context: IMiddlewareContext) => Promise<void>> = [];
  private afterHooks: Array<(result: R, context: IMiddlewareContext) => Promise<void>> = [];
  private errorHandlers: Array<(error: Error, context: IMiddlewareContext) => Promise<R>> = [];

  /**
   * Create a new middleware composer
   */
  constructor(registry: MiddlewareRegistry = getMiddlewareRegistry()) {
    this.registry = registry;
  }

  /**
   * Add a middleware to the pipeline
   */
  public use(middlewareId: string): this {
    this.middlewareIds.push(middlewareId);
    return this;
  }

  /**
   * Add multiple middleware components
   */
  public useMany(middlewareIds: string[]): this {
    this.middlewareIds.push(...middlewareIds);
    return this;
  }

  /**
   * Add a before hook
   */
  public before(hook: (input: T, context: IMiddlewareContext) => Promise<void>): this {
    this.beforeHooks.push(hook);
    return this;
  }

  /**
   * Add an after hook
   */
  public after(hook: (result: R, context: IMiddlewareContext) => Promise<void>): this {
    this.afterHooks.push(hook);
    return this;
  }

  /**
   * Add an error handler
   */
  public catch(handler: (error: Error, context: IMiddlewareContext) => Promise<R>): this {
    this.errorHandlers.push(handler);
    return this;
  }

  /**
   * Build the pipeline
   */
  public build(): MiddlewarePipeline<T, R> {
    const pipeline = this.registry.createPipeline<T, R>(this.middlewareIds);

    // Add hooks and error handlers
    for (const hook of this.beforeHooks) {
      pipeline.before(hook);
    }

    for (const hook of this.afterHooks) {
      pipeline.after(hook);
    }

    for (const handler of this.errorHandlers) {
      pipeline.catch(handler);
    }

    return pipeline;
  }

  /**
   * Create a middleware executor that wraps the pipeline execution
   */
  public createExecutor(): {
    execute: (input: T, context: IMiddlewareContext) => Promise<R>;
  } {
    const pipeline = this.build();

    return {
      execute: async (input: T, context: IMiddlewareContext) => {
        return pipeline.execute(input, context);
      },
    };
  }
}
