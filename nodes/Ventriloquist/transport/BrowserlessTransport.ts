// import { IExecuteFunctions } from 'n8n-workflow';
import * as puppeteer from 'puppeteer-core';
import { URL } from 'node:url';
import { BrowserTransport } from './BrowserTransport';
import type { AntiDetectionLevel } from './BrowserTransportFactory';
import { CURRENT_CHROME_UA } from './LocalChromeTransport';

/**
 * Class to handle Browserless browser interactions
 * Works with both Browserless.io cloud and self-hosted deployments (including Railway)
 */
export class BrowserlessTransport implements BrowserTransport {
	private logger: any;
	private apiKey: string;
	private baseUrl: string;
	private wsEndpoint: string | undefined;
	private antiDetectionLevel: AntiDetectionLevel;
	private requestTimeout: number;
	private browser: puppeteer.Browser | null = null;

	/**
	 * Create a BrowserlessTransport instance
	 * @param logger - Logger instance
	 * @param apiKey - Browserless API token (called TOKEN in Railway)
	 * @param baseUrl - Browserless base URL (cloud or custom deployment URL)
	 * @param antiDetectionLevel - Anti-detection level (off/standard/maximum)
	 * @param requestTimeout - Request timeout in milliseconds (for navigation, operations)
	 * @param wsEndpoint - Optional direct WebSocket endpoint
	 */
	constructor(
		logger: any,
		apiKey: string,
		baseUrl = 'https://browserless.io',
		antiDetectionLevel: AntiDetectionLevel = 'standard',
		requestTimeout = 120000,
		wsEndpoint?: string,
	) {
		this.logger = logger;
		this.apiKey = apiKey;
		this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash if present
		this.wsEndpoint = wsEndpoint;
		this.antiDetectionLevel = antiDetectionLevel;
		this.requestTimeout = requestTimeout;

		// Log all connection parameters (mask sensitive data)
		this.logger.info(`BrowserlessTransport initialized with:
- Base URL: ${this.baseUrl}
- API Key: ${this.apiKey ? '***' : 'None'}
- Direct WS Endpoint: ${this.wsEndpoint ? this.wsEndpoint.replace(/token=([^&]+)/, 'token=***') : 'None'}
- Anti-Detection Level: ${this.antiDetectionLevel}
- Request Timeout: ${this.requestTimeout}ms`);
	}

	/**
	 * Connect to Browserless browser
	 * This establishes a connection to the Browserless service via WebSocket
	 */
	async connect(): Promise<puppeteer.Browser> {
		this.logger.info('Connecting to Browserless service...');

		// Activate rebrowser patches for standard and maximum — these suppress
		// Runtime.Enable and mask Runtime.callFunctionOn, the primary CDP detection vectors.
		if (this.antiDetectionLevel !== 'off') {
			process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE = 'addBinding';
			process.env.REBROWSER_PATCHES_SOURCE_URL = 'pptr:internal';
			this.logger.info(`Rebrowser patches activated (${this.antiDetectionLevel}): Runtime.Enable fix (addBinding mode)`);
		}

		try {
			// Special handling for direct WebSocket endpoints
			if (this.wsEndpoint) {
				let wsUrl = this.wsEndpoint;

				// Add protocol if missing
				if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://') &&
					!wsUrl.startsWith('http://') && !wsUrl.startsWith('https://')) {
					wsUrl = `wss://${wsUrl}`;
					this.logger.info(`Added WSS protocol to direct WebSocket URL: ${wsUrl}`);
				}

				// Convert http protocols to ws if needed
				if (wsUrl.startsWith('http://')) {
					wsUrl = wsUrl.replace('http://', 'ws://');
				} else if (wsUrl.startsWith('https://')) {
					wsUrl = wsUrl.replace('https://', 'wss://');
				}

				// Add token if not present
				if (!wsUrl.includes('token=') && this.apiKey) {
					try {
						const wsUrlObj = new URL(wsUrl);
						wsUrlObj.searchParams.set('token', this.apiKey);
						wsUrl = wsUrlObj.toString();
					} catch (urlError) {
						this.logger.warn(`Could not parse WebSocket URL: ${wsUrl}. Adding token directly.`);
						wsUrl += `${wsUrl.includes('?') ? '&' : '?'}token=${this.apiKey}`;
					}
				}

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
			}

			// Standard approach using baseUrl + path
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
		} finally {
			// Clean up rebrowser env vars — n8n is long-running,
			// env vars must not leak to other workflows
			delete process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE;
			delete process.env.REBROWSER_PATCHES_SOURCE_URL;
		}
	}

	/**
	 * Reconnect to an existing Browserless session
	 * @param sessionId - The ID of the session to reconnect to
	 */
	async reconnect(sessionId: string): Promise<puppeteer.Browser> {
		this.logger.info(`Attempting to reconnect to Browserless session: ${sessionId}`);

		try {
			// Special handling for direct WebSocket endpoints
			if (this.wsEndpoint) {
				let wsUrl = this.wsEndpoint;

				// Log the original WebSocket URL (with masked token if present)
				const maskedUrl = wsUrl.replace(/token=([^&]+)/, 'token=***TOKEN***');
				this.logger.info(`Original WebSocket URL: ${maskedUrl}`);

				// Add protocol if missing
				if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://') &&
					!wsUrl.startsWith('http://') && !wsUrl.startsWith('https://')) {
					wsUrl = `wss://${wsUrl}`;
					this.logger.info(`Added WSS protocol to direct WebSocket URL: ${wsUrl}`);
				}

				// Convert http protocols to ws if needed
				if (wsUrl.startsWith('http://')) {
					wsUrl = wsUrl.replace('http://', 'ws://');
				} else if (wsUrl.startsWith('https://')) {
					wsUrl = wsUrl.replace('https://', 'wss://');
				}

				// Add session ID if provided
				if (sessionId) {
					// Use URL object for proper parameter handling
					try {
						const wsUrlObj = new URL(wsUrl);

						// Set both sessionId and session parameters for compatibility with different implementations
						wsUrlObj.searchParams.set('sessionId', sessionId);
						wsUrlObj.searchParams.set('session', sessionId);

						// Get final URL with session parameters
						wsUrl = wsUrlObj.toString();

						// Mask token for security in logs
						const maskedUrl = wsUrl.replace(/token=([^&]+)/, 'token=***');
						this.logger.info(`Added session parameters to WebSocket URL: ${maskedUrl}`);
					} catch (urlError) {
						this.logger.warn(`Could not parse WebSocket URL: ${wsUrl}. Adding session ID directly.`);
						wsUrl += `${wsUrl.includes('?') ? '&' : '?'}sessionId=${sessionId}&session=${sessionId}`;

						// Mask token for security in logs
						const maskedUrl = wsUrl.replace(/token=([^&]+)/, 'token=***');
						this.logger.info(`Added session parameters to WebSocket URL: ${maskedUrl}`);
					}
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
			}

			// Standard approach using baseUrl + path
			let wsUrl = this.getWsEndpoint();

			// Add the session ID if provided
			if (sessionId) {
				this.logger.info(`Adding session ID to standard WebSocket URL: ${sessionId}`);

				// Create URL object for proper parameter handling
				try {
					const wsUrlObj = new URL(wsUrl);

					// Set both sessionId and session parameters for compatibility with different implementations
					wsUrlObj.searchParams.set('sessionId', sessionId);
					wsUrlObj.searchParams.set('session', sessionId);

					wsUrl = wsUrlObj.toString();
					const maskedFinalUrl = wsUrl.replace(/token=([^&]+)/, 'token=***TOKEN***');
					this.logger.info(`Added session parameters to standard WebSocket URL: ${maskedFinalUrl}`);
				} catch (urlError) {
					this.logger.warn(`Could not parse WebSocket URL: ${wsUrl}. Adding session ID directly.`);
					wsUrl += `${wsUrl.includes('?') ? '&' : '?'}sessionId=${sessionId}&session=${sessionId}`;
					const maskedFinalUrl = wsUrl.replace(/token=([^&]+)/, 'token=***TOKEN***');
					this.logger.info(`Added session parameters to standard WebSocket URL: ${maskedFinalUrl}`);
				}
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
				}
			}

			return { response, domain };
		} catch (error) {
			this.logger.error(`Error navigating to ${url}: ${(error as Error).message}`);
			throw new Error(`Error navigating to ${url}: ${(error as Error).message}`);
		}
	}

	/**
	 * Extract domain from a URL
	 * @param url - The URL to extract the domain from
	 */
	private extractDomain(url: string): string {
		try {
			const urlObj = new URL(url);
			return urlObj.hostname;
		} catch (error) {
			this.logger.error(`Error extracting domain from URL: ${(error as Error).message}`);
			throw new Error(`Error extracting domain from URL: ${(error as Error).message}`);
		}
	}

	/**
	 * Configure a Puppeteer page for optimal scraping with evasion techniques
	 * @param page - The Puppeteer page to configure
	 */
	private async configurePageForScraping(page: puppeteer.Page): Promise<void> {
		if (this.antiDetectionLevel === 'off') {
			this.logger.info('Anti-detection disabled, skipping evasion techniques');
			return;
		}

		this.logger.info(`Configuring page with anti-detection (level: ${this.antiDetectionLevel})`);

		// For standard level only: set UA via CDP (can't use launch flags on remote browser).
		// For maximum: skip UA override to avoid detectable Emulation.setUserAgentOverride CDP call.
		if (this.antiDetectionLevel === 'standard') {
			await page.setUserAgent(CURRENT_CHROME_UA);
		}

		// Apply stealth JS injections (aligned with LocalChromeTransport.applyStealthMode)
		await page.evaluateOnNewDocument(() => {
			// Safely handle webdriver property
			try {
				if ('webdriver' in navigator) {
					delete (navigator as any).webdriver;
				}
				Object.defineProperty(navigator, 'webdriver', {
					get: () => false,
					configurable: true,
				});
			} catch (e) {
				try {
					(navigator as any).webdriver = false;
				} catch (e2) {
					console.log('Could not override webdriver property');
				}
			}

			// Modify plugins array (aligned with LocalChrome)
			Object.defineProperty(navigator, 'plugins', {
				get: () => [
					{
						description: "Portable Document Format",
						filename: "internal-pdf-viewer",
						name: "Chrome PDF Plugin"
					},
					{
						description: "PDF Viewer",
						filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
						name: "Chrome PDF Viewer"
					},
					{
						description: "PDF Viewer",
						filename: "pdf",
						name: "PDF Viewer"
					}
				],
			});

			// Overwrite languages
			Object.defineProperty(navigator, 'languages', {
				get: () => ['en-US', 'en'],
			});

			// Add chrome property to window if it doesn't exist (aligned with LocalChrome)
			// @ts-ignore
			if (typeof window.chrome === 'undefined') {
				// @ts-ignore
				window.chrome = {
					app: {
						isInstalled: false,
					},
					runtime: {},
				};
			}

			// Override the permissions API
			if (window.Notification) {
				Object.defineProperty(window.Notification, 'permission', {
					get: () => 'default',
				});
			}
		});
	}

	/**
	 * Get the WebSocket endpoint for Browserless
	 */
	private getWsEndpoint(): string {
		// Construct the WebSocket URL using the base URL and API key
		let wsUrl = this.baseUrl;

		// Convert HTTP to WebSocket protocol
		if (wsUrl.startsWith('http://')) {
			wsUrl = wsUrl.replace('http://', 'ws://');
		} else if (wsUrl.startsWith('https://')) {
			wsUrl = wsUrl.replace('https://', 'wss://');
		}

		// Ensure we have a WebSocket protocol
		if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
			wsUrl = `wss://${wsUrl}`;
		}

		// Do not add any paths - use the base URL exactly as provided

		// Add token parameter if an API key is provided
		if (this.apiKey) {
			wsUrl += `${wsUrl.includes('?') ? '&' : '?'}token=${this.apiKey}`;
		}

		// Log the WebSocket URL (with masked token)
		const maskedUrl = wsUrl.replace(/token=([^&]+)/, 'token=***');
		this.logger.info(`Using WebSocket endpoint: ${maskedUrl}`);

		return wsUrl;
	}

	/**
	 * Get information about the current page
	 * @param page - The Puppeteer page to get information about
	 * @param response - The HTTP response object
	 */
	async getPageInfo(page: puppeteer.Page, response: puppeteer.HTTPResponse | null): Promise<{ url: string; title: string; status: number | null }> {
		const url = await page.url();
		const title = await page.title();
		const status = response ? response.status() : null;
		return { url, title, status };
	}

	/**
	 * Take a screenshot of the current page
	 * @param page - The Puppeteer page to screenshot
	 */
	async takeScreenshot(page: puppeteer.Page): Promise<string> {
		const screenshot = await page.screenshot({
			encoding: 'base64',
			type: 'jpeg',
			quality: 80
		}) as string;
		return screenshot;
	}
}
