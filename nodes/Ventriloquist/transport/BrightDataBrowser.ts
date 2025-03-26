import * as puppeteer from 'puppeteer-core';
import { URL } from 'url';

/**
 * Class to handle Bright Data browser interactions
 */
export class BrightDataBrowser {
	private logger: any;
	private websocketEndpoint: string;
	private authorizedDomains: string;
	private password?: string;

	/**
	 * Create a BrightDataBrowser instance
	 * @param logger - Logger instance
	 * @param websocketEndpoint - Bright Data WebSocket endpoint
	 * @param authorizedDomains - Comma-separated list of authorized domains
	 * @param password - Optional password for authentication
	 */
	constructor(
		logger: any,
		websocketEndpoint: string,
		authorizedDomains: string = '',
		password?: string,
	) {
		this.logger = logger;
		this.websocketEndpoint = websocketEndpoint;
		this.authorizedDomains = authorizedDomains;
		this.password = password;
	}

	/**
	 * Connect to Bright Data browser
	 */
	async connect(): Promise<puppeteer.Browser> {
		this.logger.info('Connecting to Bright Data Scraping Browser via WebSocket');

		try {
			// Connect to the browser using the WebSocket endpoint
			const browser = await puppeteer.connect({
				browserWSEndpoint: this.websocketEndpoint,
			});

			return browser;
		} catch (error) {
			// Check if this is an authentication error
			if ((error as Error).message.includes('Authentication required') && this.password) {
				this.logger.info('Authentication required, trying with password');

				// Try connecting with authentication
				const browser = await puppeteer.connect({
					browserWSEndpoint: this.websocketEndpoint,
					headers: {
						Authorization: `Basic ${Buffer.from(`user:${this.password}`).toString('base64')}`,
					},
				});

				return browser;
			} else {
				throw error;
			}
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
			// Extract domain for authorization check
			const domain = this.extractDomain(url);

			// Check if domain is authorized
			if (this.authorizedDomains) {
				const domainList = this.authorizedDomains.split(',').map((d) => d.trim().toLowerCase());
				const needsAuthorization = !domainList.some((d) => domain.includes(d));

				if (needsAuthorization) {
					this.logger.warn(`Domain ${domain} may require authorization from Bright Data`);
				}
			}

			// Navigate to the URL
			this.logger.info(`Navigating to ${url}`);
			const response = await page.goto(url, options);

			// Check for specific Bright Data errors
			if (response) {
				const status = response.status();
				if (status === 403) {
					const text = await response.text();
					if (text.includes('requires special permission')) {
						throw new Error(
							`This website (${domain}) requires special permission from Bright Data. ` +
								`Please add "${domain}" to the 'Domains For Authorization' field in your Bright Data credentials ` +
								`or contact Bright Data support to get this domain authorized for your account.`,
						);
					}
				}
			}

			return { response, domain };
		} catch (error) {
			// Enhance error message for common Bright Data issues
			if ((error as Error).message.includes('net::ERR_TUNNEL_CONNECTION_FAILED')) {
				throw new Error(
					`Connection to Bright Data failed. Please check your WebSocket endpoint and credentials.`,
				);
			}
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
		const screenshot = await page.screenshot({
			encoding: 'base64',
			type: 'jpeg',
			quality: 80,
		});

		return `data:image/jpeg;base64,${screenshot}`;
	}

	/**
	 * Extract domain from URL
	 * @param url - URL to extract domain from
	 */
	private extractDomain(url: string): string {
		try {
			return new URL(url).hostname;
		} catch (error) {
			return url;
		}
	}
}
