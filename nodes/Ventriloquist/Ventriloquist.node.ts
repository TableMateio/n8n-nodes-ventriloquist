import {
	INodeType,
	INodeTypeDescription,
	IExecuteFunctions,
	INodeExecutionData,
	IDataObject,
	ICredentialDataDecryptedObject,
	NodeConnectionType,
} from 'n8n-workflow';

// Import puppeteer-core for browser automation
import * as puppeteer from 'puppeteer-core';

/**
 * Ventriloquist is a custom node for N8N that connects to Bright Data's Browser Scraping Browser
 * via WebSocket and performs systematic Puppeteer functions.
 */
export class Ventriloquist implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Ventriloquist',
		name: 'ventriloquist',
		icon: 'file:ventriloquist.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Automate browser actions with Puppeteer',
		defaults: {
			name: 'Ventriloquist',
			color: '#2244BB',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [
			{
				name: 'brightDataApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Open Browser',
						value: 'open',
						description: 'Open a browser instance',
						action: 'Open a browser instance',
					},
				],
				default: 'open',
			},

			// Properties for 'open' operation
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				placeholder: 'https://example.com',
				description: 'The URL to navigate to',
				displayOptions: {
					show: {
						operation: ['open'],
					},
				},
			},
			{
				displayName: 'Incognito Mode',
				name: 'incognito',
				type: 'boolean',
				default: false,
				description: 'Whether to use incognito mode',
				displayOptions: {
					show: {
						operation: ['open'],
					},
				},
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
						description:
							'Wait until there are no more than 2 network connections for at least 500ms',
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
				displayOptions: {
					show: {
						operation: ['open'],
					},
				},
			},
			{
				displayName: 'Timeout',
				name: 'timeout',
				type: 'number',
				default: 30000,
				description: 'Maximum navigation time in milliseconds',
				displayOptions: {
					show: {
						operation: ['open'],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Get credentials
		const credentials = (await this.getCredentials(
			'brightDataApi',
		)) as ICredentialDataDecryptedObject;

		if (!credentials) {
			throw new Error('No credentials provided for Bright Data API');
		}

		const websocketEndpoint = credentials.websocketEndpoint as string;

		if (!websocketEndpoint) {
			throw new Error('WebSocket Endpoint is required');
		}

		// Process all items
		for (let i = 0; i < items.length; i++) {
			const operation = this.getNodeParameter('operation', i) as string;

			try {
				if (operation === 'open') {
					const url = this.getNodeParameter('url', i) as string;
					const incognito = this.getNodeParameter('incognito', i, false) as boolean;
					const waitUntil = this.getNodeParameter(
						'waitUntil',
						i,
						'networkidle0',
					) as puppeteer.PuppeteerLifeCycleEvent;
					const timeout = this.getNodeParameter('timeout', i, 30000) as number;

					// Connect to Bright Data's Scraping Browser via WebSocket
					this.logger.info('Connecting to Bright Data Scraping Browser via WebSocket');
					const browser = await puppeteer.connect({
						browserWSEndpoint: websocketEndpoint,
					});

					// Create a new page
					const context = incognito
						? await browser.browserContexts()[0] || browser.defaultBrowserContext()
						: browser.defaultBrowserContext();
					const page = await context.newPage();

					// Navigate to URL
					this.logger.info(`Navigating to ${url}`);
					const response = await page.goto(url, {
						waitUntil,
						timeout,
					});

					// Extract some basic page information
					const title = await page.title();
					const currentUrl = page.url();
					const status = response ? response.status() : null;

					// Take a screenshot (base64 encoded)
					const screenshot = await page.screenshot({
						encoding: 'base64',
						type: 'jpeg',
						quality: 80,
					});

					// Close browser
					await browser.close();

					// Return page data
					const responseData: IDataObject = {
						success: true,
						operation,
						url: currentUrl,
						title,
						status,
						screenshot: `data:image/jpeg;base64,${screenshot}`,
						incognito,
						timestamp: new Date().toISOString(),
					};

					returnData.push({
						json: responseData,
					});
				}
			} catch (error: any) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							success: false,
							error: error.message || 'An unknown error occurred',
							stack: error.stack || '',
						},
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
