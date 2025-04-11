import type { Logger as ILogger } from 'n8n-workflow';
import { MiddlewareRegistry, getMiddlewareRegistry } from './middlewareRegistry';
import { createExtractionMiddlewareRegistration } from './extraction/extractionMiddleware';

/**
 * Register all built-in middleware components
 */
export function registerBuiltInMiddleware(logger?: ILogger): void {
  const registry = getMiddlewareRegistry();

  if (logger) {
    registry.setLogger(logger);
    logger.info('[MiddlewareRegistration] Registering built-in middleware components');
  }

  // Register extraction middleware
  const extractionMiddleware = createExtractionMiddlewareRegistration();
  registry.register(extractionMiddleware);

  // Additional middleware registrations will be added as they are implemented

  if (logger) {
    const count = registry.getAllRegistrations().length;
    logger.info(`[MiddlewareRegistration] Registered ${count} built-in middleware components`);
  }
}

/**
 * Initialize the middleware registry with all built-in middleware
 */
export function initializeMiddlewareRegistry(logger?: ILogger): MiddlewareRegistry {
  const registry = getMiddlewareRegistry();

  // Clear any existing registrations
  registry.clear();

  // Register built-in middleware
  registerBuiltInMiddleware(logger);

  return registry;
}

/**
 * Register a custom middleware
 */
export function registerCustomMiddleware(
  id: string,
  middleware: any,
  type: string,
  options: {
    name: string;
    description: string;
    dependencies?: string[];
    version?: string;
    tags?: string[];
    configSchema?: object;
  },
  logger?: ILogger
): void {
  const registry = getMiddlewareRegistry();

  if (logger) {
    registry.setLogger(logger);
  }

  registry.register({
    id,
    type: type as any,
    middleware,
    name: options.name,
    description: options.description,
    dependencies: options.dependencies,
    version: options.version,
    tags: options.tags,
    configSchema: options.configSchema,
  });

  if (logger) {
    logger.info(`[MiddlewareRegistration] Registered custom middleware: ${id} (${type})`);
  }
}

/**
 * Export utility functions for middleware registration
 */
export default {
  initializeRegistry: initializeMiddlewareRegistry,
  registerBuiltIn: registerBuiltInMiddleware,
  registerCustom: registerCustomMiddleware,
  getRegistry: getMiddlewareRegistry,
};
