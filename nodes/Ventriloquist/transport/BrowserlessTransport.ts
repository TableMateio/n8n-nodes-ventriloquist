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
	private stealthMode: boolean;
	private requestTimeout: number;

	/**
	 * Create a BrowserlessTransport instance
	 * @param logger - Logger instance
	 * @param apiKey - Browserless API token (called TOKEN in Railway)
	 * @param baseUrl - Browserless base URL (cloud or custom deployment URL)
	 * @param stealthMode - Whether to use stealth mode
	 * @param requestTimeout - Request timeout in milliseconds (for navigation, operations)
	 */
	constructor(
		logger: any,
		apiKey: string,
		baseUrl = 'https://chrome.browserless.io',
		stealthMode = true,
		requestTimeout = 120000,
	) {
		this.logger = logger;
		this.apiKey = apiKey;
		this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash if present
		this.stealthMode = stealthMode;
		this.requestTimeout = requestTimeout;
	}

	/**
	 * Connect to Browserless browser
	 * This establishes a connection to the Browserless service via WebSocket
	 * NOTE: No separate WebSocket endpoint is needed - it's constructed from the base URL
	 */
	async connect(): Promise<puppeteer.Browser> {
		this.logger.info('Connecting to Browserless via WebSocket');

		try {
			// Ensure base URL has protocol
			let formattedBaseUrl = this.baseUrl;
			if (!formattedBaseUrl.startsWith('http')) {
				formattedBaseUrl = `https://${formattedBaseUrl}`;
				this.logger.info(`Adding https:// prefix to base URL: ${formattedBaseUrl}`);
			}

			// Construct the WebSocket URL with the token
			// For Railway deployments, the URL format is: wss://domain.railway.app/browserws?token=TOKEN
			const wsEndpoint = `${formattedBaseUrl.replace('https://', 'wss://').replace('http://', 'ws://')}/browserws?token=${this.apiKey}`;

			// Log the endpoint (hiding token for security)
			const sanitizedEndpoint = wsEndpoint.replace(this.apiKey, '***TOKEN***');
			this.logger.info(`Connecting to Browserless WebSocket endpoint: ${sanitizedEndpoint}`);

			// Connect to the browser using the WebSocket endpoint
			this.logger.info('Attempting connection to WebSocket endpoint...');
			const browser = await puppeteer.connect({
				browserWSEndpoint: wsEndpoint,
				defaultViewport: {
					width: 1920,
					height: 1080,
				},
			});

			this.logger.info('Successfully connected to Browserless');
			return browser;
		} catch (error) {
			// Enhance error message for common Browserless issues
			if ((error as Error).message.includes('connect ETIMEDOUT')) {
				throw new Error('Connection to Browserless timed out. Please check your Token and base URL.');
			}

			if ((error as Error).message.includes('401')) {
				throw new Error('Authentication failed. Please check your Token value - use exactly what is shown for TOKEN in your Railway variables.');
			}

			if ((error as Error).message.includes('403')) {
				throw new Error('Forbidden access. Your TOKEN might not have permission to access the service.');
			}

			if ((error as Error).message.includes('429')) {
				throw new Error('Browserless rate limit exceeded. Please try again later or upgrade your plan.');
			}

			if ((error as Error).message.includes('ENOTFOUND')) {
				throw new Error(`Could not resolve host: ${this.baseUrl}. Please check your Base URL - use exactly the BROWSER_DOMAIN value (e.g., browserless-production-xxxx.up.railway.app).`);
			}

			// WebSocket connection errors
			if ((error as Error).message.includes('WebSocket') || (error as Error).message.includes('not found')) {
				this.logger.error('WebSocket connection error details:', error);
				throw new Error(`WebSocket connection failed. For Railway deployments, try using path /browserws instead of /chrome. Full error: ${(error as Error).message}`);
			}

			// Log the full error for debugging
			this.logger.error('Connection error details:', error);

			// For any other errors, rethrow with original message
			throw new Error(`Connection failed: ${(error as Error).message}`);
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
