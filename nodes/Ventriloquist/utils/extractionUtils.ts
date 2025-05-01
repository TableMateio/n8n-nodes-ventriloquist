import type {
	IDataObject,
	Logger as ILogger,
} from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';

/**
 * Generate a random human-like delay between actions
 */
export function getHumanDelay(): number {
	const min = 300; // Minimum delay in ms
	const max = 1200; // Maximum delay in ms
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Format extracted data for logging, ensuring sensitive data is truncated
 */
export function formatExtractedDataForLog(data: unknown, extractionType: string): string {
	if (data === undefined || data === null) {
		return 'null';
	}

	// For strings, truncate if too long
	if (typeof data === 'string') {
		if (data.length === 0) {
			return '(empty string)';
		}
		if (data.length > 100) {
			return `"${data.substring(0, 100)}..." (${data.length} characters)`;
		}
		return `"${data}"`;
	} else if (Array.isArray(data)) {
		// For arrays, summarize content
		const itemCount = data.length;
		if (itemCount === 0) {
			return '[] (empty array)';
		}

		// Sample a few items from the array
		const sampleSize = Math.min(3, itemCount);
		const sample = data.slice(0, sampleSize).map(item => {
			if (typeof item === 'string') {
				return item.length > 20 ? `"${item.substring(0, 20)}..."` : `"${item}"`;
			} else if (typeof item === 'object') {
				return '[object]';
			}
			return String(item);
		});

		return `[${sample.join(', ')}${itemCount > sampleSize ? `, ... (${itemCount - sampleSize} more)` : ''}]`;
	} else if (typeof data === 'object') {
		// For objects, show a sample of keys and values
		if (data === null) {
			return 'null';
		}

		if (extractionType === 'table') {
			// Special handling for table data
			const rowCount = Array.isArray(data) ? data.length : Object.prototype.hasOwnProperty.call(data, 'rowCount') ? (data as {rowCount: unknown}).rowCount : 'unknown';
			return `[Table data: ${rowCount} row(s)]`;
		}

		// For other objects, sample a few properties
		const keys = Object.keys(data as object);
		if (keys.length === 0) {
			return '{} (empty object)';
		}

		// Only show a few keys
		const sampleSize = Math.min(3, keys.length);
		const sample = keys.slice(0, sampleSize).map(key => {
			const value = (data as Record<string, unknown>)[key];

			// Format the value based on its type
			let valueStr;
			if (typeof value === 'string') {
				valueStr = value.length > 15 ? `"${value.substring(0, 15)}..."` : `"${value}"`;
			} else if (typeof value === 'object') {
				valueStr = '[object]';
			} else {
				valueStr = String(value);
			}

			return `${key}: ${valueStr}`;
		});

		return `{${sample.join(', ')}${keys.length > sampleSize ? `, ... (${keys.length - sampleSize} more)` : ''}}`;
	}

	// For other data types, convert to string
	return String(data);
}

/**
 * Extract text content from a page element
 */
export async function extractTextContent(
	page: puppeteer.Page,
	selector: string,
	logger: ILogger,
	nodeName: string,
	nodeId: string,
): Promise<string> {
	try {
		const textContent = await page.$eval(selector, (el) => el.textContent?.trim() || '');
		const truncatedData = formatExtractedDataForLog(textContent, 'text');
		logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Extracted text content: ${truncatedData}`);
		return textContent;
	} catch (error) {
		logger.error(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Failed to extract text: ${(error as Error).message}`);
		throw error;
	}
}

/**
 * Extract HTML content from a page element
 */
export async function extractHtmlContent(
	page: puppeteer.Page,
	selector: string,
	options: {
		outputFormat: string,
		includeMetadata: boolean,
	},
	logger: ILogger,
	nodeName: string,
	nodeId: string,
): Promise<string | IDataObject> {
	try {
		const htmlContent = await page.$eval(selector, (el) => el.innerHTML);

		if (options.outputFormat === 'html') {
			// Return raw HTML
			return htmlContent;
		}

		// Return as JSON object with optional metadata
		const result: IDataObject = {
			html: htmlContent,
		};

		if (options.includeMetadata) {
			result.metadata = {
				length: htmlContent.length,
				hasImages: htmlContent.includes('<img'),
				hasTables: htmlContent.includes('<table'),
				hasLinks: htmlContent.includes('<a '),
				hasScripts: htmlContent.includes('<script'),
			};
		}

		return result;
	} catch (error) {
		logger.error(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Failed to extract HTML: ${(error as Error).message}`);
		throw error;
	}
}

/**
 * Extract input value from a form element
 */
export async function extractInputValue(
	page: puppeteer.Page,
	selector: string,
	logger: ILogger,
	nodeName: string,
	nodeId: string,
): Promise<string> {
	try {
		const value = await page.$eval(selector, (el) => {
			if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
				return el.value;
			}
			return '';
		});

		const truncatedValue = formatExtractedDataForLog(value, 'value');
		logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Extracted input value: ${truncatedValue}`);
		return value;
	} catch (error) {
		logger.error(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Failed to extract input value: ${(error as Error).message}`);
		throw error;
	}
}

/**
 * Extract attribute value from a page element
 */
export async function extractAttributeValue(
	page: puppeteer.Page,
	selector: string,
	attributeName: string,
	logger: ILogger,
	nodeName: string,
	nodeId: string,
): Promise<string> {
	try {
		const attributeValue = await page.$eval(
			selector,
			(el, attr) => el.getAttribute(attr) || '',
			attributeName
		);

		const truncatedAttribute = formatExtractedDataForLog(attributeValue, 'attribute');
		logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Extracted attribute ${attributeName}: ${truncatedAttribute}`);
		return attributeValue;
	} catch (error) {
		logger.error(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Failed to extract attribute ${attributeName}: ${(error as Error).message}`);
		throw error;
	}
}

/**
 * Extract data from a table element
 */
export async function extractTableData(
	page: puppeteer.Page,
	selector: string,
	options: {
		includeHeaders: boolean,
		rowSelector: string,
		cellSelector: string,
		outputFormat: string,
		extractAttributes?: boolean,
		attributeName?: string,
	},
	logger: ILogger,
	nodeName: string,
	nodeId: string,
): Promise<string | IDataObject[] | Array<Array<string | string[]>>> {
	try {
		// Handle different output formats
		if (options.outputFormat === 'html') {
			// Extract original table HTML
			const tableHtml = await page.$eval(selector, (el) => el.outerHTML);
			return tableHtml;
		}

		// Extract the table data as arrays first
		const tableData = await page.$$eval(
			`${selector} ${options.rowSelector}`,
			(rows, opts) => {
				const { cellSelector, extractAttributes, attributeName } = opts as {
					cellSelector: string;
					extractAttributes?: boolean;
					attributeName?: string;
				};

				// Extract all rows
				return Array.from(rows).map((row) => {
					const cells = Array.from(row.querySelectorAll(cellSelector));
					return cells.map((cell) => {
						// If extracting attributes, get the specified attribute value
						if (extractAttributes && attributeName) {
							// Handle the case where a cell might contain multiple elements with attributes
							// This is a general approach that works for any attribute type, not just links
							const elements = cell.querySelectorAll(`[${attributeName}]`);
							if (elements.length > 1) {
								return Array.from(elements)
									.map(el => el.getAttribute(attributeName) || '')
									.filter(value => value !== ''); // Filter out empty values
							}
							// Otherwise just return the single attribute value
							return cell.getAttribute(attributeName) || '';
						}
						// Otherwise get the text content
						return cell.textContent?.trim() || '';
					});
				});
			},
			{
				cellSelector: options.cellSelector,
				extractAttributes: options.extractAttributes,
				attributeName: options.attributeName
			}
		);

		if (tableData.length === 0) {
			return [];
		}

		if (options.outputFormat === 'json' && options.includeHeaders && tableData.length > 1) {
			// Convert to array of objects using first row as keys
			const headers = tableData[0] as string[];
			const jsonData: IDataObject[] = tableData.slice(1).map((row) => {
				const obj: IDataObject = {};
				headers.forEach((header, i) => {
					if (header && i < row.length) {
						// Preserve any data structure (arrays, objects, primitives) in the output
						obj[header as string] = row[i];
					}
				});
				return obj;
			});
			return jsonData;
		}

		if (options.outputFormat === 'csv') {
			// Convert to CSV string
			const csvRows = tableData.map(row => row.join(','));
			return csvRows.join('\n');
		}

		// Return as array of arrays
		return options.includeHeaders ? tableData : tableData.slice(1) as Array<Array<string | string[]>>;
	} catch (error) {
		logger.error(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Failed to extract table data: ${(error as Error).message}`);
		throw error;
	}
}

/**
 * Extract data from multiple elements
 */
export async function extractMultipleElements(
	page: puppeteer.Page,
	selector: string,
	options: {
		attributeName: string,
		extractionProperty: string,
		limit: number,
		outputFormat: string,
		separator: string,
	},
	logger: ILogger,
	nodeName: string,
	nodeId: string,
): Promise<string | IDataObject[] | string[]> {
	try {
		// Extract data from all matching elements
		const elementsData = await page.$$eval(
			selector,
			(elements, opts) => {
				const { extractionProperty, attributeName, limit } = opts as {
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
			{
				extractionProperty: options.extractionProperty,
				attributeName: options.attributeName,
				limit: options.limit
			}
		);

		if (options.outputFormat === 'json') {
			// Convert to array of objects with indices as keys
			return elementsData.map((value, index) => ({
				index,
				value,
			}));
		}

		if (options.outputFormat === 'string') {
			// Join all elements into one string with the specified separator
			return elementsData.join(options.separator);
		}

		// Default array format
		return elementsData;
	} catch (error) {
		logger.error(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Failed to extract multiple elements: ${(error as Error).message}`);
		throw error;
	}
}

/**
 * Take a screenshot of the current page
 */
export async function takePageScreenshot(
	page: puppeteer.Page,
	logger: ILogger,
	nodeName: string,
	nodeId: string,
): Promise<string> {
	try {
		const screenshotBuffer = await page.screenshot({
			encoding: 'base64',
			type: 'jpeg',
			quality: 80,
		});

		const screenshot = `data:image/jpeg;base64,${screenshotBuffer}`;
		logger.debug(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Captured screenshot`);
		return screenshot;
	} catch (error) {
		logger.warn(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Failed to capture screenshot: ${(error as Error).message}`);
		return '';
	}
}

/**
 * Get current page information (URL and title)
 */
export async function getPageInfo(
	page: puppeteer.Page,
): Promise<{ url: string; title: string }> {
	const url = page.url();
	const title = await page.title();
	return { url, title };
}
