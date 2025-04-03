import * as puppeteer from 'puppeteer-core';
import { URL } from 'url';
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
		this.logger.info('Connecting to Browserless via WebSocket');

		try {
			// If direct WebSocket endpoint is provided, use it first
			if (this.wsEndpoint) {
				this.logger.info('Direct WebSocket endpoint provided, trying that first...');
				try {
					// Add token to the WebSocket URL if not already included
					const directWsUrl = this.wsEndpoint.includes('token=')
						? this.wsEndpoint
						: `${this.wsEndpoint}${this.wsEndpoint.includes('?') ? '&' : '?'}token=${this.apiKey}`;

					const sanitizedDirectUrl = directWsUrl.replace(this.apiKey, '***TOKEN***');
					this.logger.info(`Connecting using direct WebSocket URL: ${sanitizedDirectUrl}`);

					const browser = await puppeteer.connect({
						browserWSEndpoint: directWsUrl,
						defaultViewport: { width: 1920, height: 1080 },
					});

					this.logger.info('Successfully connected using direct WebSocket URL!');
					return browser;
				} catch (directError) {
					this.logger.warn(`Direct WebSocket connection failed: ${(directError as Error).message}`);
					this.logger.info('Falling back to automatic WebSocket URL construction...');
				}
			}

			// Ensure base URL has protocol
			let formattedBaseUrl = this.baseUrl;
			if (!formattedBaseUrl.startsWith('http')) {
				formattedBaseUrl = `https://${formattedBaseUrl}`;
				this.logger.info(`Adding https:// prefix to base URL: ${formattedBaseUrl}`);
			}

			// We'll try three different WebSocket URL formats, starting with the one most likely to work
			let wsEndpoint = '';
			let browser: puppeteer.Browser | null = null;
			let lastError: Error | null = null;

			// Railway typically provides a direct WebSocket endpoint that we should use
			// Try format 1 (direct connection without path): wss://your-domain.railway.app?token=TOKEN
			this.logger.info('Trying direct WebSocket connection without path...');
			try {
				wsEndpoint = `${formattedBaseUrl.replace('https://', 'wss://').replace('http://', 'ws://')}?token=${this.apiKey}`;
				const sanitizedEndpoint1 = wsEndpoint.replace(this.apiKey, '***TOKEN***');
				this.logger.info(`Trying WebSocket endpoint format 1: ${sanitizedEndpoint1}`);

				browser = await puppeteer.connect({
					browserWSEndpoint: wsEndpoint,
					defaultViewport: { width: 1920, height: 1080 },
				});

				this.logger.info('Successfully connected using direct WebSocket without path!');
				return browser;
			} catch (error1) {
				lastError = error1 as Error;
				this.logger.warn(`Format 1 failed: ${(error1 as Error).message}`);

				// Try format 2 (standard /browserws path): wss://your-domain.railway.app/browserws?token=TOKEN
				this.logger.info('Trying with /browserws path...');
				try {
					wsEndpoint = `${formattedBaseUrl.replace('https://', 'wss://').replace('http://', 'ws://')}/browserws?token=${this.apiKey}`;
					const sanitizedEndpoint2 = wsEndpoint.replace(this.apiKey, '***TOKEN***');
					this.logger.info(`Trying WebSocket endpoint format 2: ${sanitizedEndpoint2}`);

					browser = await puppeteer.connect({
						browserWSEndpoint: wsEndpoint,
						defaultViewport: { width: 1920, height: 1080 },
					});

					this.logger.info('Successfully connected using /browserws path!');
					return browser;
				} catch (error2) {
					this.logger.warn(`Format 2 failed: ${(error2 as Error).message}`);

					// Try format 3 (legacy /chrome path): wss://your-domain.railway.app/chrome?token=TOKEN
					this.logger.info('Trying with legacy /chrome path...');
					try {
						wsEndpoint = `${formattedBaseUrl.replace('https://', 'wss://').replace('http://', 'ws://')}/chrome?token=${this.apiKey}`;
						const sanitizedEndpoint3 = wsEndpoint.replace(this.apiKey, '***TOKEN***');
						this.logger.info(`Trying WebSocket endpoint format 3: ${sanitizedEndpoint3}`);

						browser = await puppeteer.connect({
							browserWSEndpoint: wsEndpoint,
							defaultViewport: { width: 1920, height: 1080 },
						});

						this.logger.info('Successfully connected using legacy /chrome path!');
						return browser;
					} catch (error3) {
						this.logger.error(`All connection formats failed. Last error: ${(error3 as Error).message}`);
						// Continue to error handling below, throwing the original error for better diagnosis
					}
				}
			}

			// If we get here, all connection attempts failed
			// Enhanced error diagnosis with detailed information about the Railway deployment
			if (lastError?.message.includes('ERR_INVALID_URL')) {
				throw new Error(`
Invalid WebSocket URL format. For Railway deployments:
1. Use the TOKEN environment variable value (not BROWSER_TOKEN)
2. For Base URL, try the following formats:
   - Just the domain: browserless-production-xxxx.up.railway.app
   - With https://: https://browserless-production-xxxx.up.railway.app
3. If available, find the BROWSER_WS_ENDPOINT environment variable in Railway and add it to the "Direct WebSocket URL" field.

Full error: ${lastError.message}`);
			}

			// Rethrow the original error if not an invalid URL error
			throw lastError;
		} catch (error) {
			// General error handling for connection issues
			this.logger.error('Connection error details:', error);

			// For any errors, provide detailed troubleshooting information
			throw new Error(`
Connection to Browserless failed: ${(error as Error).message}

Troubleshooting steps:
1. Verify TOKEN value is correct
2. For Base URL - try just the domain without https://
3. Direct WebSocket URL - try copying the BROWSER_WS_ENDPOINT value from Railway
4. Check Railway logs to see if Browserless is running correctly
5. Try changing the path from /browserws to /chrome in the Direct WebSocket URL`);
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
			// Extract domain for logging and status reporting
			const domain = this.extractDomain(url);

			// Configure page for optimal scraping with evasion techniques
			await this.configurePageForScraping(page);

			// Log the navigation attempt
			this.logger.info(`Navigating to ${url}`);

			// Navigate to the URL with the appropriate timeout
			const response = await page.goto(url, {
				...options,
				timeout: this.requestTimeout, // Use our request timeout setting
			});

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
			if (this.baseUrl.includes('railway.app')) {
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
}
