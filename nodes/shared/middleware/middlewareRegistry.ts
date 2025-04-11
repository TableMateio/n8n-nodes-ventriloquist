import { IMiddleware, IMiddlewareContext } from '../../Ventriloquist/utils/middlewares/middleware';

export class MiddlewareRegistry {
	private static instance: MiddlewareRegistry;
	private middlewares: Map<string, IMiddleware<any, any>>;

	private constructor() {
		this.middlewares = new Map();
	}

	public static getInstance(): MiddlewareRegistry {
		if (!MiddlewareRegistry.instance) {
			MiddlewareRegistry.instance = new MiddlewareRegistry();
		}
		return MiddlewareRegistry.instance;
	}

	public registerMiddleware(name: string, middleware: IMiddleware<any, any>): void {
		this.middlewares.set(name, middleware);
	}

	public getMiddleware(name: string): IMiddleware<any, any> {
		const middleware = this.middlewares.get(name);
		if (!middleware) {
			throw new Error(`Middleware ${name} not found`);
		}
		return middleware;
	}

	public hasMiddleware(name: string): boolean {
		return this.middlewares.has(name);
	}

	public removeMiddleware(name: string): void {
		this.middlewares.delete(name);
	}

	public clear(): void {
		this.middlewares.clear();
	}
}
