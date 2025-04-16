import type { Logger as ILogger } from 'n8n-workflow';
import { IMiddleware, IMiddlewareContext, createPipeline, MiddlewarePipeline } from './middleware';

/**
 * Types of middleware supported by the registry
 */
export enum MiddlewareType {
  EXTRACTION = 'extraction',
  MATCHING = 'matching',
  TRANSFORMATION = 'transformation',
  VALIDATION = 'validation',
  AI = 'ai',
  ACTION = 'action',
  FALLBACK = 'fallback',
  CUSTOM = 'custom'
}

/**
 * Interface for registering a middleware with metadata
 */
export interface IMiddlewareRegistration<TInput = any, TOutput = any> {
  /**
   * Unique identifier for the middleware
   */
  id: string;

  /**
   * Type of middleware for categorization
   */
  type: MiddlewareType;

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
   * Dependencies on other middleware components
   */
  dependencies?: string[];

  /**
   * Optional schema for configuration validation
   */
  configSchema?: object;

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
  register<TInput, TOutput>(registration: IMiddlewareRegistration<TInput, TOutput>): void;
  unregister(id: string): boolean;
  getRegistration<TInput, TOutput>(id: string): IMiddlewareRegistration<TInput, TOutput> | undefined;
  getAllRegistrations(): IMiddlewareRegistration[];
  getRegistrationsByType(type: MiddlewareType): IMiddlewareRegistration[];
  createMiddleware<TInput, TOutput>(id: string): IMiddleware<TInput, TOutput>;
  createPipeline<TInput, TOutput>(middlewareIds: string[]): MiddlewarePipeline<TInput, TOutput>;
  clear(): void;
}

/**
 * Registry for middleware components
 */
export class MiddlewareRegistry implements IMiddlewareRegistry {
  private static instance: MiddlewareRegistry;
  private middlewares: Map<string, IMiddlewareRegistration> = new Map();
  private logger?: ILogger;

  /**
   * Private constructor for singleton pattern
   */
  private constructor() {}

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
   * Register a middleware
   */
  public register<TInput, TOutput>(registration: IMiddlewareRegistration<TInput, TOutput>): void {
    if (this.middlewares.has(registration.id)) {
      const errorMessage = `Middleware with ID '${registration.id}' is already registered`;
      this.logger?.warn(`[MiddlewareRegistry] ${errorMessage}`);
      throw new Error(errorMessage);
    }

    this.middlewares.set(registration.id, registration);
    this.logger?.debug(`[MiddlewareRegistry] Registered middleware: ${registration.name} (${registration.id})`);
  }

  /**
   * Unregister a middleware
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
  public getRegistration<TInput, TOutput>(id: string): IMiddlewareRegistration<TInput, TOutput> | undefined {
    return this.middlewares.get(id) as IMiddlewareRegistration<TInput, TOutput> | undefined;
  }

  /**
   * Create a middleware instance by ID
   */
  public createMiddleware<TInput, TOutput>(id: string): IMiddleware<TInput, TOutput> {
    const registration = this.middlewares.get(id);
    if (!registration) {
      const message = `Middleware with ID ${id} not found`;
      this.logger?.error(`[MiddlewareRegistry] ${message}`);
      throw new Error(message);
    }

    return registration.middleware as IMiddleware<TInput, TOutput>;
  }

  /**
   * Check if a middleware is registered
   */
  public has(id: string): boolean {
    return this.middlewares.has(id);
  }

  /**
   * Get all registered middlewares
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
   * Find middlewares by tag
   */
  public findByTag(tag: string): IMiddlewareRegistration[] {
    return this.getAllRegistrations().filter((m) => m.tags?.includes(tag));
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
   * Create a pipeline from a list of middleware IDs
   */
  public createPipeline<TInput, TOutput>(middlewareIds: string[]): MiddlewarePipeline<TInput, TOutput> {
    const pipeline = createPipeline<TInput, TOutput>();

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
 * Initialize the middleware registry with a logger
 */
export function initializeMiddlewareRegistry(logger: ILogger): MiddlewareRegistry {
  const registry = MiddlewareRegistry.getInstance();
  registry.setLogger(logger);
  logger.info('[MiddlewareRegistry] Middleware registry initialized');
  return registry;
}

/**
 * Get the middleware registry instance
 */
export function getMiddlewareRegistry(): MiddlewareRegistry {
  return MiddlewareRegistry.getInstance();
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
  const registration = registry.getRegistration<TInput, TOutput>(middlewareId);

  if (!registration) {
    throw new Error(`Middleware with ID '${middlewareId}' not found`);
  }

  if (registration.validateInput) {
    const isValid = await registration.validateInput(input);
    if (!isValid) {
      throw new Error(`Input validation failed for middleware '${middlewareId}'`);
    }
  }

  context.logger.debug(`[MiddlewareRegistry] Executing middleware: ${registration.name} (${middlewareId})`);
  return registration.middleware.execute(input, context);
}

/**
 * Middleware composer for creating reusable pipeline configurations
 */
export class MiddlewareComposer<TInput, TOutput> {
  private registry: MiddlewareRegistry;
  private middlewareIds: string[] = [];
  private beforeHooks: Array<(input: TInput, context: IMiddlewareContext) => Promise<void>> = [];
  private afterHooks: Array<(result: TOutput, context: IMiddlewareContext) => Promise<void>> = [];
  private errorHandlers: Array<(error: Error, context: IMiddlewareContext) => Promise<TOutput>> = [];

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
   * Add multiple middlewares to the pipeline
   */
  public useMany(middlewareIds: string[]): this {
    this.middlewareIds.push(...middlewareIds);
    return this;
  }

  /**
   * Add a hook to run before execution
   */
  public before(hook: (input: TInput, context: IMiddlewareContext) => Promise<void>): this {
    this.beforeHooks.push(hook);
    return this;
  }

  /**
   * Add a hook to run after execution
   */
  public after(hook: (result: TOutput, context: IMiddlewareContext) => Promise<void>): this {
    this.afterHooks.push(hook);
    return this;
  }

  /**
   * Add an error handler
   */
  public catch(handler: (error: Error, context: IMiddlewareContext) => Promise<TOutput>): this {
    this.errorHandlers.push(handler);
    return this;
  }

  /**
   * Build the pipeline with all configured middlewares and hooks
   */
  public build(): MiddlewarePipeline<TInput, TOutput> {
    const pipeline = this.registry.createPipeline<TInput, TOutput>(this.middlewareIds);

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
   * Create an executor function that wraps the pipeline
   */
  public createExecutor(): {
    execute: (input: TInput, context: IMiddlewareContext) => Promise<TOutput>;
  } {
    const pipeline = this.build();

    return {
      execute: async (input: TInput, context: IMiddlewareContext): Promise<TOutput> => {
        return pipeline.execute(input, context);
      },
    };
  }
}
