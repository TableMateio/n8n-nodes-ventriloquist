// import { IExecuteFunctions } from 'n8n-workflow';
import * as puppeteer from 'puppeteer-core';
import { URL } from 'node:url';
import { BrowserTransport } from './BrowserTransport';

/**
 * Class to handle Browserless browser interactions
 * Works with both Browserless.io cloud and self-hosted deployments (including Railway)
 */
export class BrowserlessTransport implements BrowserTransport {
	private logger: any;
	private apiKey: string;
	private baseUrl: string;
	private wsEndpoint: string | undefined;
	private stealthMode: boolean;
	private requestTimeout: number;
	private browser: puppeteer.Browser | null = null;

	/**
	 * Create a BrowserlessTransport instance
	 * @param logger - Logger instance
	 * @param apiKey - Browserless API token (called TOKEN in Railway)
	 * @param baseUrl - Browserless base URL (cloud or custom deployment URL)
	 * @param stealthMode - Whether to use stealth mode
	 * @param requestTimeout - Request timeout in milliseconds (for navigation, operations)
	 * @param wsEndpoint - Optional direct WebSocket endpoint
	 */
	constructor(
		logger: any,
		apiKey: string,
		baseUrl = 'https://chrome.browserless.io',
		stealthMode = true,
		requestTimeout = 120000,
		wsEndpoint?: string,
	) {
		this.logger = logger;
		this.apiKey = apiKey;
		this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash if present
		this.wsEndpoint = wsEndpoint;
		this.stealthMode = stealthMode;
		this.requestTimeout = requestTimeout;
	}

	/**
	 * Connect to Browserless browser
	 * This establishes a connection to the Browserless service via WebSocket
	 */
	async connect(): Promise<puppeteer.Browser> {
		this.logger.info('Connecting to Browserless service...');

		try {
			// Get WebSocket URL using the new method
			const wsUrl = this.getWsEndpoint();

			// Create connection options
			const connectionOptions: puppeteer.ConnectOptions = {
				browserWSEndpoint: wsUrl,
				defaultViewport: {
					width: 1280,
					height: 720,
				},
			};

			// Connect to browser
			this.browser = await puppeteer.connect(connectionOptions);
			this.logger.info('Successfully connected to Browserless!');

			return this.browser;
		} catch (error) {
			this.logger.error(`Error connecting to Browserless: ${(error as Error).message}`);
			throw new Error(`Could not connect to Browserless: ${(error as Error).message}`);
		}
	}

	/**
	 * Reconnect to an existing Browserless session
	 * @param sessionId - The ID of the session to reconnect to
	 */
	async reconnect(sessionId: string): Promise<puppeteer.Browser> {
		this.logger.info(`Attempting to reconnect to Browserless session: ${sessionId}`);

		try {
			// Get the base WebSocket URL
			let wsUrl = this.getWsEndpoint();

			// Add the session ID if valid
			if (sessionId && sessionId.startsWith('session_')) {
				// Create URL object for proper parameter handling
				const wsUrlObj = new URL(wsUrl);

				// Set the sessionId parameter - the standard format for Browserless
				wsUrlObj.searchParams.set('sessionId', sessionId);

				wsUrl = wsUrlObj.toString();
				this.logger.info(`Added session parameter to WebSocket URL: ${wsUrl}`);
			}

			// Create connection options
			const connectOptions: puppeteer.ConnectOptions = {
				browserWSEndpoint: wsUrl,
				defaultViewport: {
					width: 1280,
					height: 720,
				},
			};

			// Connect to browser
			this.browser = await puppeteer.connect(connectOptions);
			this.logger.info(`Successfully reconnected to Browserless session: ${sessionId}`);

			// Return the browser instance
			return this.browser;
		} catch (error) {
			// Handle reconnection failure
			this.logger.error(`Failed to reconnect to session ${sessionId}: ${(error as Error).message}`);

			// Create a helpful error message
			let errorMessage = `Reconnection to session ${sessionId} failed: ${(error as Error).message}\n\n`;
			errorMessage += 'Please check:\n';
			errorMessage += '- Browserless API key\n';
			errorMessage += '- Browserless base URL\n';
			errorMessage += '- Network connectivity\n';
			errorMessage += '- Session timeout settings (default is 30 seconds)\n';
			errorMessage += `- Correct session ID format (should be exactly as shown in logs: ${sessionId})\n`;

			throw new Error(errorMessage);
		}
	}

	/**
	 * Navigate to a URL
	 * @param page - Puppeteer Page
	 * @param url - URL to navigate to
	 * @param options - Navigation options
	 */
	async navigateTo(
		page: puppeteer.Page,
		url: string,
		options: puppeteer.WaitForOptions & {
			waitUntil?: puppeteer.PuppeteerLifeCycleEvent | puppeteer.PuppeteerLifeCycleEvent[];
		},
	): Promise<{ response: puppeteer.HTTPResponse | null; domain: string }> {
		try {
			// Verify page is still valid before proceeding
			try {
				// Simple check to see if page is still functional
				await page.evaluate(() => true).catch(async e => {
					this.logger.warn(`Page appears to be disconnected: ${e.message}`);
					// Try to reload the page if possible
					this.logger.info('Attempting to reconnect page...');

					// Check if the browser is still connected
					try {
						const browser = page.browser();
						const pages = await browser.pages();
						this.logger.info(`Browser has ${pages.length} pages available`);
					} catch (browserError) {
						throw new Error(`Browser disconnected: ${(browserError as Error).message}`);
					}
				});
			} catch (pageError) {
				throw new Error(`Page validation failed: ${(pageError as Error).message}`);
			}

			// Extract domain for logging and status reporting
			const domain = this.extractDomain(url);

			// Configure page for optimal scraping with evasion techniques
			await this.configurePageForScraping(page);

			// Log the navigation attempt
			this.logger.info(`Navigating to ${url}`);

			// Navigation block for EACCES and ECONNREFUSED errors
			let response: puppeteer.HTTPResponse | null = null;

			try {
				// Navigate to the URL with the appropriate timeout
				response = await page.goto(url, {
					...options,
					timeout: this.requestTimeout, // Use our request timeout setting
				});
			} catch (navError) {
				const errorMessage = (navError as Error).message || '';

				// Handle common errors with Railway Browserless
				if (errorMessage.includes('Navigation timeout')) {
					this.logger.warn(`Navigation timeout for ${url}. Continuing with page processing...`);
					// We'll continue with the page as-is since some content may have loaded
				} else if (errorMessage.includes('net::ERR_CONNECTION_REFUSED') ||
						  errorMessage.includes('net::ERR_TUNNEL_CONNECTION_FAILED')) {
					// Common with Railway when site blocks datacenter IPs
					throw new Error(`Connection refused by ${domain}. This site may be blocking Railway IPs or datacenter access.`);
				} else if (errorMessage.includes('net::ERR_NAME_NOT_RESOLVED')) {
					throw new Error(`Could not resolve domain ${domain}. Please check the URL.`);
				} else {
					// For any other navigation errors, rethrow
					throw navError;
				}
			}

			this.logger.info(`Successfully navigated to ${url}`);
			return { response, domain };
		} catch (error) {
			// Enhance error message for common navigation issues
			if ((error as Error).message.includes('Navigation timeout')) {
				throw new Error('Navigation to URL timed out. Consider increasing the Request Timeout in your credentials or checking the URL.');
			}

			if ((error as Error).message.includes('ERR_NAME_NOT_RESOLVED')) {
				throw new Error('Could not resolve domain name. Please check the URL.');
			}

			// For any other navigation errors, rethrow
			throw error;
		}
	}

	/**
	 * Get information about the page
	 * @param page - Puppeteer Page
	 * @param response - HTTP Response
	 */
	async getPageInfo(
		page: puppeteer.Page,
		response: puppeteer.HTTPResponse | null,
	): Promise<{
		url: string;
		title: string;
		status: number | null;
	}> {
		const title = await page.title();
		const currentUrl = page.url();
		const status = response ? response.status() : null;

		return {
			url: currentUrl,
			title,
			status,
		};
	}

	/**
	 * Take a screenshot of the page
	 * @param page - Puppeteer Page
	 */
	async takeScreenshot(page: puppeteer.Page): Promise<string> {
		try {
			this.logger.info('Taking screenshot of current page');

			const screenshot = await page.screenshot({
				encoding: 'base64',
				type: 'jpeg',
				quality: 80,
				fullPage: false,
			});

			this.logger.info('Screenshot captured successfully');
			return `data:image/jpeg;base64,${screenshot}`;
		} catch (error) {
			this.logger.error(`Failed to take screenshot: ${(error as Error).message}`);
			throw new Error(`Failed to take screenshot: ${(error as Error).message}`);
		}
	}

	/**
	 * Configure the page for optimal scraping with evasion techniques
	 * @param page - Puppeteer Page
	 */
	private async configurePageForScraping(page: puppeteer.Page): Promise<void> {
		try {
			// Set a realistic user agent
			await page.setUserAgent(
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
			);

			// Set viewport to standard desktop resolution
			await page.setViewport({
				width: 1920,
				height: 1080,
			});

			// Set common language headers
			await page.setExtraHTTPHeaders({
				'Accept-Language': 'en-US,en;q=0.9',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
				'Accept-Encoding': 'gzip, deflate, br',
				'Cache-Control': 'no-cache',
				'Pragma': 'no-cache',
			});

			// Enable JavaScript
			await page.setJavaScriptEnabled(true);

			// Set timeout for all operations based on our request timeout
			page.setDefaultTimeout(this.requestTimeout);

			// Additional context management for Railway deployments
			if (this.baseUrl.includes('railway.app') || (this.wsEndpoint && this.wsEndpoint.includes('railway.app'))) {
				this.logger.info('Applying Railway-specific browser settings');

				// Enable image loading (some railway deployments block by default)
				await page.setRequestInterception(false);

				// Set extra browser context options (will only apply to future contexts)
				const client = await page.target().createCDPSession();
				await client.send('Network.enable');
				await client.send('Network.setBypassServiceWorker', { bypass: true });

				// Additional network settings
				try {
					// Attempt to clear cache and cookies for clean state
					await client.send('Network.clearBrowserCache');
					await client.send('Network.clearBrowserCookies');
				} catch (err) {
					this.logger.warn('Could not clear browser cache/cookies, continuing anyway');
				}
			}

			// Additional evasion if using stealth mode (already handled by Browserless, but for completeness)
			if (this.stealthMode) {
				this.logger.info('Using stealth mode for bot detection evasion');
			}
		} catch (err) {
			// Log error but don't fail - these are optimizations, not critical functions
			this.logger.warn(`Could not apply all page optimizations: ${(err as Error).message}`);
		}
	}

	/**
	 * Extract domain from URL
	 * @param url - URL to extract domain from
	 */
	private extractDomain(url: string): string {
		try {
			return new URL(url).hostname;
		} catch (error) {
			this.logger.warn(`Could not parse URL: ${url}`);
			return url;
		}
	}

	private getWsEndpoint(baseUrl = this.baseUrl, path = '/browserless'): string {
		try {
			// Format the base URL properly
			const formattedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

			// Use URL API for reliable protocol conversion and parameter handling
			const url = new URL(path, formattedBaseUrl);
			const wsUrl = new URL(url.toString());

			// Convert http/https to ws/wss
			wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';

			// Add token if not already present
			if (!wsUrl.searchParams.has('token') && this.apiKey) {
				wsUrl.searchParams.set('token', this.apiKey);
				this.logger.debug('Added API key to WebSocket URL');
			}

			return wsUrl.toString();
		} catch (error) {
			this.logger.error(`Error creating WebSocket URL: ${(error as Error).message}`);
			throw new Error(`Could not create WebSocket URL from ${baseUrl}: ${(error as Error).message}`);
		}
	}
}
