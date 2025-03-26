import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { Ventriloquist } from '../Ventriloquist.node';
import type * as puppeteer from 'puppeteer-core';

/**
 * Extract operation description
 */
export const description: INodeProperties[] = [
	{
		displayName: 'Extraction Type',
		name: 'extractionType',
		type: 'options',
		options: [
			{
				name: 'Attribute',
				value: 'attribute',
				description: 'Extract specific attribute from an element',
			},
			{
				name: 'HTML',
				value: 'html',
				description: 'Extract HTML content from an element',
			},
			{
				name: 'Input Value',
				value: 'value',
				description: 'Extract value from input, select or textarea',
			},
			{
				name: 'Multiple Elements',
				value: 'multiple',
				description: 'Extract data from multiple elements matching a selector',
			},
			{
				name: 'Table',
				value: 'table',
				description: 'Extract data from a table',
			},
			{
				name: 'Text Content',
				value: 'text',
				description: 'Extract text content from an element',
			},
		],
		default: 'text',
		description: 'What type of data to extract from the page',
		displayOptions: {
			show: {
				operation: ['extract'],
			},
		},
	},
	{
		displayName: 'Selector',
		name: 'selector',
		type: 'string',
		default: '',
		placeholder: '#main-content, .result-title, table.data',
		description: 'CSS selector to target the element. Use "#ID" for IDs, ".class" for classes, "tag" for HTML elements, or "tag[attr=value]" for attributes.',
		required: true,
		displayOptions: {
			show: {
				operation: ['extract'],
			},
		},
	},
	{
		displayName: 'Wait For Selector',
		name: 'waitForSelector',
		type: 'boolean',
		default: true,
		description: 'Whether to wait for the selector to appear in page',
		displayOptions: {
			show: {
				operation: ['extract'],
			},
		},
	},
	{
		displayName: 'Timeout',
		name: 'timeout',
		type: 'number',
		default: 30000,
		description: 'Maximum time to wait for the selector in milliseconds',
		displayOptions: {
			show: {
				operation: ['extract'],
				waitForSelector: [true],
			},
		},
	},
	{
		displayName: 'Attribute Name',
		name: 'attributeName',
		type: 'string',
		default: '',
		placeholder: 'href, src, data-id',
		description: 'Name of the attribute to extract from the element',
		displayOptions: {
			show: {
				operation: ['extract'],
				extractionType: ['attribute'],
			},
		},
		required: true,
	},
	{
		displayName: 'Table Options',
		name: 'tableOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		typeOptions: {
			multipleValues: false,
		},
		displayOptions: {
			show: {
				operation: ['extract'],
				extractionType: ['table'],
			},
		},
		options: [
			{
				displayName: 'Include Headers',
				name: 'includeHeaders',
				type: 'boolean',
				default: true,
				description: 'Whether to use the first row as headers in the output',
			},
			{
				displayName: 'Row Selector',
				name: 'rowSelector',
				type: 'string',
				default: 'tr',
				description: 'CSS selector for table rows relative to table selector (default: tr)',
			},
			{
				displayName: 'Cell Selector',
				name: 'cellSelector',
				type: 'string',
				default: 'td, th',
				description: 'CSS selector for table cells relative to row selector (default: td, th)',
			},
			{
				displayName: 'Extract As JSON',
				name: 'extractAsJson',
				type: 'boolean',
				default: true,
				description: 'Whether to extract table data as an array of JSON objects',
			},
		],
	},
	{
		displayName: 'Multiple Elements Options',
		name: 'multipleOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		typeOptions: {
			multipleValues: false,
		},
		displayOptions: {
			show: {
				operation: ['extract'],
				extractionType: ['multiple'],
			},
		},
		options: [
			{
				displayName: 'Extraction Property',
				name: 'extractionProperty',
				type: 'options',
				options: [
					{
						name: 'Text Content',
						value: 'textContent',
					},
					{
						name: 'Inner HTML',
						value: 'innerHTML',
					},
					{
						name: 'Outer HTML',
						value: 'outerHTML',
					},
					{
						name: 'Attribute',
						value: 'attribute',
					},
				],
				default: 'textContent',
				description: 'Property to extract from each matching element',
			},
			{
				displayName: 'Attribute Name',
				name: 'attributeName',
				type: 'string',
				default: '',
				description: 'Name of the attribute to extract (if Extraction Property is set to Attribute)',
				displayOptions: {
					show: {
						extractionProperty: ['attribute'],
					},
				},
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				description: 'Max number of results to return',
			},
		],
	},
	{
		displayName: 'Take Screenshot',
		name: 'takeScreenshot',
		type: 'boolean',
		default: false,
		description: 'Whether to take a screenshot of the page',
		displayOptions: {
			show: {
				operation: ['extract'],
			},
		},
	},
	{
		displayName: 'Use Human-Like Delays',
		name: 'useHumanDelays',
		type: 'boolean',
		default: false,
		description: 'Whether to add a random delay before extraction to simulate human behavior',
		displayOptions: {
			show: {
				operation: ['extract'],
			},
		},
	},
];

/**
 * Get a random human-like delay between 700-2500ms
 */
function getHumanDelay(): number {
	return Math.floor(Math.random() * (2500 - 700 + 1) + 700);
}

/**
 * Execute the extract operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	websocketEndpoint: string,
	workflowId: string,
): Promise<INodeExecutionData> {
	// Get parameters
	const extractionType = this.getNodeParameter('extractionType', index, 'text') as string;
	const selector = this.getNodeParameter('selector', index) as string;
	const waitForSelector = this.getNodeParameter('waitForSelector', index, true) as boolean;
	const timeout = this.getNodeParameter('timeout', index, 30000) as number;
	const takeScreenshot = this.getNodeParameter('takeScreenshot', index, false) as boolean;
	const useHumanDelays = this.getNodeParameter('useHumanDelays', index, false) as boolean;

	// Get or create browser session
	let page: puppeteer.Page;
	let pageId: string;

	try {
		// Create a session or reuse an existing one
		const { browser, pageId: newPageId } = await Ventriloquist.getOrCreateSession(
			workflowId,
			websocketEndpoint,
			this.logger
		);

		// Try to get any existing page from the browser
		const pages = await browser.pages();

		if (pages.length > 0) {
			// Use the first available page
			page = pages[0];
			pageId = `existing_${Date.now()}`;
			this.logger.info('Using existing page from browser session');
		} else {
			// Create a new page if none exists
			page = await browser.newPage();
			pageId = newPageId;
			this.logger.info(`Created new page with ID: ${pageId}`);

			// Store the new page for future operations
			Ventriloquist.storePage(workflowId, pageId, page);

			// Navigate to a blank page to initialize it
			await page.goto('about:blank');
		}
	} catch (error) {
		throw new Error(`Failed to get or create a page: ${(error as Error).message}`);
	}

	try {
		this.logger.info(`Starting extraction operation with selector: ${selector}`);

		// Add a human-like delay if enabled
		if (useHumanDelays) {
			const delay = getHumanDelay();
			this.logger.info(`Adding human-like delay: ${delay}ms`);
			await new Promise(resolve => setTimeout(resolve, delay));
		}

		// Wait for the selector if needed
		if (waitForSelector) {
			this.logger.info(`Waiting for selector: ${selector}`);
			await page.waitForSelector(selector, { timeout });
		}

		let extractedData: IDataObject | string | Array<string | IDataObject> = '';
		let extractionDetails: IDataObject = {};

		// Process different extraction types
		switch (extractionType) {
			case 'text': {
				// Extract text content
				extractedData = await page.$eval(selector, (el) => el.textContent?.trim() || '');
				this.logger.info(`Extracted text: ${extractedData}`);
				break;
			}

			case 'html': {
				// Extract HTML content (inner HTML)
				extractedData = await page.$eval(selector, (el) => el.innerHTML);
				extractionDetails = { htmlLength: (extractedData as string).length };
				break;
			}

			case 'attribute': {
				// Extract an attribute from an element
				const attributeName = this.getNodeParameter('attributeName', index) as string;
				extractedData = await page.$eval(
					selector,
					(el, attr) => el.getAttribute(attr) || '',
					attributeName
				);
				extractionDetails = { attributeName };
				break;
			}

			case 'value': {
				// Extract value from input, select, or textarea
				extractedData = await page.$eval(selector, (el) => {
					if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
						return el.value;
					}
					return '';
				});
				break;
			}

			case 'table': {
				// Extract data from a table
				const tableOptions = this.getNodeParameter('tableOptions', index, {}) as IDataObject;
				const includeHeaders = tableOptions.includeHeaders !== false;
				const rowSelector = (tableOptions.rowSelector as string) || 'tr';
				const cellSelector = (tableOptions.cellSelector as string) || 'td, th';
				const extractAsJson = tableOptions.extractAsJson !== false;

				// Extract the table data
				const tableData = await page.$$eval(
					`${selector} ${rowSelector}`,
					(rows, options) => {
						const { cellSelector, includeHeaders, extractAsJson } = options as {
							cellSelector: string;
							includeHeaders: boolean;
							extractAsJson: boolean;
						};

						// Extract all rows
						const extractedRows = Array.from(rows).map((row) => {
							const cells = Array.from(row.querySelectorAll(cellSelector));
							return cells.map((cell) => cell.textContent?.trim() || '');
						});

						if (extractedRows.length === 0) {
							return [];
						}

						if (extractAsJson && includeHeaders && extractedRows.length > 1) {
							// Convert to array of objects using first row as keys
							const headers = extractedRows[0];
							return extractedRows.slice(1).map((row) => {
								const obj: Record<string, string> = {};
								headers.forEach((header, i) => {
									if (header && i < row.length) {
										obj[header] = row[i];
									}
								});
								return obj;
							});
						}

						// Return as array of arrays, optionally removing header row
						return includeHeaders ? extractedRows : extractedRows.slice(1);
					},
					{ cellSelector, includeHeaders, extractAsJson }
				);

				extractedData = tableData as IDataObject[];
				extractionDetails = {
					rowCount: Array.isArray(tableData) ? tableData.length : 0,
					format: extractAsJson ? 'json' : 'array',
				};
				break;
			}

			case 'multiple': {
				// Extract data from multiple elements
				const multipleOptions = this.getNodeParameter('multipleOptions', index, {}) as IDataObject;
				const extractionProperty = (multipleOptions.extractionProperty as string) || 'textContent';
				const attributeName = (multipleOptions.attributeName as string) || '';
				const limit = (multipleOptions.limit as number) || 50;

				// Extract data from all matching elements
				const elementsData = await page.$$eval(
					selector,
					(elements, options) => {
						const { extractionProperty, attributeName, limit } = options as {
							extractionProperty: string;
							attributeName: string;
							limit: number;
						};

						// Apply limit if specified
						const limitedElements = limit > 0 ? elements.slice(0, limit) : elements;

						// Extract the specified property from each element
						return limitedElements.map((el) => {
							switch (extractionProperty) {
								case 'textContent':
									return el.textContent?.trim() || '';
								case 'innerHTML':
									return el.innerHTML;
								case 'outerHTML':
									return el.outerHTML;
								case 'attribute':
									return el.getAttribute(attributeName) || '';
								default:
									return el.textContent?.trim() || '';
							}
						});
					},
					{ extractionProperty, attributeName, limit }
				);

				extractedData = elementsData as string[];
				extractionDetails = {
					matchCount: Array.isArray(elementsData) ? elementsData.length : 0,
					extractionProperty,
					...(extractionProperty === 'attribute' ? { attributeName } : {}),
				};
				break;
			}
		}

		// Get current page info
		const currentUrl = page.url();
		const pageTitle = await page.title();

		// Take a screenshot if requested
		let screenshot = '';
		if (takeScreenshot) {
			const screenshotBuffer = await page.screenshot({
				encoding: 'base64',
				type: 'jpeg',
				quality: 80,
			});

			screenshot = `data:image/jpeg;base64,${screenshotBuffer}`;
		}

		// Return the results
		return {
			json: {
				success: true,
				operation: 'extract',
				extractionType,
				selector,
				pageId,
				url: currentUrl,
				title: pageTitle,
				data: extractedData,
				...extractionDetails,
				timestamp: new Date().toISOString(),
				screenshot,
			},
		};
	} catch (error) {
		// Handle errors
		this.logger.error(`Extract operation error: ${(error as Error).message}`);

		// Take error screenshot if requested
		let screenshot = '';
		if (takeScreenshot && page) {
			try {
				const screenshotBuffer = await page.screenshot({
					encoding: 'base64',
					type: 'jpeg',
					quality: 80,
				});
				screenshot = `data:image/jpeg;base64,${screenshotBuffer}`;
			} catch {
				// Ignore screenshot errors
			}
		}

		return {
			json: {
				success: false,
				operation: 'extract',
				extractionType,
				selector,
				pageId,
				error: (error as Error).message,
				timestamp: new Date().toISOString(),
				screenshot,
			},
		};
	}
}
