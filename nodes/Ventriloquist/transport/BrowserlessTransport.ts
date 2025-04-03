import * as puppeteer from 'puppeteer-core';
import { URL } from 'node:url';
import { BrowserTransport } from './BrowserTransport';
import { testBrowserlessConnection } from '../utils/testBrowserlessConnection';

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
			// List of WebSocket URLs to try in order, starting with the most likely to succeed
			const wsUrlsToTry: string[] = [];
			let successfulUrl: string | null = null;

			// 1. If direct WebSocket endpoint is provided, add it first
			if (this.wsEndpoint) {
				// Check if endpoint already has a token
				if (this.wsEndpoint.includes('token=')) {
					// Already has token, use as is
					wsUrlsToTry.push(this.wsEndpoint);
				} else {
					// Add token to the URL
					wsUrlsToTry.push(`${this.wsEndpoint}${this.wsEndpoint.includes('?') ? '&' : '?'}token=${this.apiKey}`);
				}
			}

			// 2. If we have a base URL, construct WebSocket URLs from it
			if (this.baseUrl) {
				let formattedBaseUrl = this.baseUrl;
				// Add protocol if missing
				if (!formattedBaseUrl.startsWith('http')) {
					formattedBaseUrl = `https://${formattedBaseUrl}`;
				}

				// Convert to WebSocket protocol
				const wsBaseUrl = formattedBaseUrl.replace('https://', 'wss://').replace('http://', 'ws://');

				// Add various formats to try
				wsUrlsToTry.push(`${wsBaseUrl}?token=${this.apiKey}`); // Direct connection
				wsUrlsToTry.push(`${wsBaseUrl}/browserws?token=${this.apiKey}`); // Standard browserws path
				wsUrlsToTry.push(`${wsBaseUrl}/chrome?token=${this.apiKey}`); // Legacy chrome path
			}

			// 3. Add the exact URL format from the error message if it looks like that format
			const railwayFormat = `wss://${this.baseUrl.replace('https://', '').replace('http://', '')}?token=${this.apiKey}`;
			if (!wsUrlsToTry.includes(railwayFormat)) {
				wsUrlsToTry.push(railwayFormat);
			}

			// Test each WebSocket URL before trying to connect with Puppeteer
			this.logger.info(`Will attempt ${wsUrlsToTry.length} different WebSocket URL formats`);

			for (const wsUrl of wsUrlsToTry) {
				// Test the connection directly first
				const isConnectable = await testBrowserlessConnection(wsUrl, this.logger);

				if (isConnectable) {
					successfulUrl = wsUrl;
					this.logger.info(`Found working WebSocket URL: ${wsUrl.replace(/token=([^&]+)/, 'token=***TOKEN***')}`);
					break;
				}
			}

			// If we found a working URL, connect with Puppeteer
			if (successfulUrl) {
				this.logger.info('Connecting to Browserless with Puppeteer...');

				// Enhanced connection options for Railway Browserless
				const isRailway = successfulUrl.includes('railway.app');

				const connectionOptions: puppeteer.ConnectOptions = {
					browserWSEndpoint: successfulUrl,
					defaultViewport: { width: 1920, height: 1080 },
				};

				// Add Railway-specific options
				if (isRailway) {
					this.logger.info('Using Railway-specific connection options');

					// Add special query parameters that Browserless on Railway understands
					// These help with connection stability and performance
					if (!successfulUrl.includes('--disable-dev-shm-usage')) {
						connectionOptions.browserWSEndpoint += '&--disable-dev-shm-usage';
					}

					if (!successfulUrl.includes('--disable-gpu')) {
						connectionOptions.browserWSEndpoint += '&--disable-gpu';
					}

					if (!successfulUrl.includes('--disable-setuid-sandbox')) {
						connectionOptions.browserWSEndpoint += '&--disable-setuid-sandbox';
					}

					if (!successfulUrl.includes('--no-sandbox')) {
						connectionOptions.browserWSEndpoint += '&--no-sandbox';
					}

					if (this.stealthMode && !successfulUrl.includes('stealth')) {
						connectionOptions.browserWSEndpoint += '&stealth';
					}
				}

				const browser = await puppeteer.connect(connectionOptions);

				this.logger.info('Successfully connected to Browserless!');
				return browser;
			}

			// If we get here, all URLs failed
			throw new Error('All WebSocket connection attempts failed. Please check your credentials and try again.');
		} catch (error) {
			// Enhanced error diagnosis with detailed information
			let errorMessage = `Connection to Browserless failed: ${(error as Error).message}\n\n`;

			errorMessage += `Troubleshooting steps:
1. Double-check your TOKEN value
2. Try using the exact WebSocket URL directly:
   - Copy the BROWSER_WS_ENDPOINT value from Railway
   - Paste it in the "Direct WebSocket URL" field
   - Try with and without adding the token parameter
3. Verify your Railway deployment is properly configured:
   - Check that the TOKEN environment variable is set
   - Ensure MAX_CONCURRENT_SESSIONS is at least 5
   - Set DEFAULT_STEALTH to true
   - Set CONNECTION_TIMEOUT to 120000 or higher

For Railway deployments, your WebSocket URL likely looks like:
wss://browserless-production-xxxx.up.railway.app?token=YOUR_TOKEN

Error details: ${(error as Error).stack || (error as Error).message}`;

			this.logger.error('Connection error details:', error);
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
}
