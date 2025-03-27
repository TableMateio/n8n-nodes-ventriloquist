import {
	type IExecuteFunctions,
	type IDataObject,
	type INodeExecutionData,
	type INodeProperties,
} from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { BrightDataBrowser } from '../transport/BrightDataBrowser';

/**
 * Open operation description
 */
export const description: INodeProperties[] = [
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		placeholder: 'https://example.com',
		description: 'The URL to navigate to',
		required: true,
	},
	{
		displayName: 'Incognito Mode',
		name: 'incognito',
		type: 'boolean',
		default: false,
		description: 'Whether to use incognito mode',
	},
	{
		displayName: 'Wait Until',
		name: 'waitUntil',
		type: 'options',
		options: [
			{
				name: 'Navigation Complete',
				value: 'networkidle0',
				description: 'Wait until there are no network connections for at least 500ms',
			},
			{
				name: 'Almost Complete',
				value: 'networkidle2',
				description: 'Wait until there are no more than 2 network connections for at least 500ms',
			},
			{
				name: 'DOM Content Loaded',
				value: 'domcontentloaded',
				description: 'Wait until DOMContentLoaded event is fired',
			},
			{
				name: 'Page Load',
				value: 'load',
				description: 'Wait until load event is fired',
			},
		],
		default: 'networkidle0',
		description: 'When to consider navigation completed',
	},
	{
		displayName: 'Timeout',
		name: 'timeout',
		type: 'number',
		default: 30000,
		description: 'Maximum navigation time in milliseconds',
	},
	{
		displayName: 'Continue On Fail',
		name: 'continueOnFail',
		type: 'boolean',
		default: true,
		description: 'Whether to continue execution even when browser operations fail (cannot connect or navigate)',
	},
];

/**
 * Execute the open operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	websocketEndpoint: string,
): Promise<INodeExecutionData> {
	const url = this.getNodeParameter('url', index) as string;
	const incognito = this.getNodeParameter('incognito', index, false) as boolean;
	const waitUntil = this.getNodeParameter(
		'waitUntil',
		index,
		'networkidle0',
	) as puppeteer.PuppeteerLifeCycleEvent;
	const timeout = this.getNodeParameter('timeout', index, 30000) as number;
	const continueOnFail = this.getNodeParameter('continueOnFail', index, true) as boolean;

	// Get the authorized domains from the credentials
	const credentials = await this.getCredentials('brightDataApi');
	const authorizedDomains = (credentials.authorizedDomains as string) || '';
	const password = (credentials.password as string) || undefined;

	// Create the BrightDataBrowser instance with authorized domains and password
	const brightDataBrowser = new BrightDataBrowser(
		this.logger,
		websocketEndpoint,
		authorizedDomains,
		password,
	);

	let browser: puppeteer.Browser | undefined;
	let page: puppeteer.Page | undefined;

	try {
		// Connect to Bright Data's Scraping Browser
		browser = await brightDataBrowser.connect();

		// Create a new page
		const context = incognito
			? await browser.createBrowserContext()
			: browser.defaultBrowserContext();
		page = await context.newPage();

		// Set up response handling for better error messages
		page.on('response', (response) => {
			if (!response.ok()) {
				this.logger.warn(`Response error: ${response.status()} for ${response.url()}`);
			}
		});

		// Navigate to the URL
		const { response, domain } = await brightDataBrowser.navigateTo(page, url, {
			waitUntil,
			timeout,
		});

		// Get page information
		const pageInfo = await brightDataBrowser.getPageInfo(page, response);

		// Take a screenshot
		const screenshot = await brightDataBrowser.takeScreenshot(page);

		// Prepare response data
		const responseData: IDataObject = {
			success: true,
			operation: 'open',
			...pageInfo,
			screenshot,
			incognito,
			domain,
			timestamp: new Date().toISOString(),
		};

		return {
			json: responseData,
		};
	} catch (error) {
		// Extract domain if possible
		let domain = '';
		try {
			domain = new URL(url).hostname;
		} catch {}

		let errorMessage = (error as Error).message;

		// Provide more specific error message for common Bright Data errors
		if (
			errorMessage.includes('This website') &&
			errorMessage.includes('requires special permission from Bright Data')
		) {
			// Error message already properly formatted by BrightDataBrowser.navigateTo()
		} else if (
			(error as Error).message.includes('proxy_error') ||
			(error as Error).message.includes('Forbidden: target site requires special permission')
		) {
			errorMessage = `This website (${domain}) requires special permission from Bright Data. Please add "${domain}" to the 'Domains For Authorization' field in your Bright Data credentials or contact Bright Data support to get this domain authorized for your account. Error details: ${(error as Error).message}`;
		}

		// If continueOnFail is false, throw the error to fail the node
		if (!continueOnFail) {
			throw new Error(`Open operation failed: ${errorMessage}`);
		}

		// Otherwise, return an error response
		return {
			json: {
				success: false,
				operation: 'open',
				error: errorMessage,
				domain,
				url,
				timestamp: new Date().toISOString(),
			},
		};
	} finally {
		// Always close the browser to avoid memory leaks
		if (browser) {
			try {
				await browser.close();
			} catch (error) {
				this.logger.warn(`Error closing browser: ${(error as Error).message}`);
			}
		}
	}
}
