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
): Promise<string | string[]> {
	try {
		// Get text directly from the DOM to avoid HTML parsing issues
		const textContents = await page.$$eval(selector, (elements) => {
			return elements.map(el => {
				// Try to get just the visible text first (preferred)
				const visibleText = (el as HTMLElement).innerText || '';

				// Also get HTML as fallback (only used if visibleText is completely empty)
				const htmlContent = el.outerHTML || '';

				// Return both for processing
				return {
					text: visibleText,
					html: htmlContent
				};
			});
		});

		// Log the number of elements found
		logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Found ${textContents.length} elements matching selector for text extraction`);

		// Process the contents with special attention to newlines and tabs
		const processedContents = textContents.map(content => {
			// Strongly prefer innerText, only use HTML as a last resort
			// This is important because innerText already handles correct visibility and styling
			let processedText = content.text && content.text.trim().length > 0
				? content.text
				: content.html;

			// Clean up the text regardless of source (innerText or HTML)
			// First remove problematic HTML elements that often cause issues
			if (processedText.includes('<iframe') || processedText.includes('<script')) {
				processedText = processedText.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
				processedText = processedText.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
				processedText = processedText.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
			}

			// Remove excessive newlines (more than 2 consecutive)
			processedText = processedText.replace(/\n{3,}/g, '\n\n');

			// Replace tabs with spaces
			processedText = processedText.replace(/\t+/g, ' ');

			// Replace multiple spaces with single spaces
			processedText = processedText.replace(/[ ]{2,}/g, ' ');

			// Process each line individually for better quality
			const lines = processedText.split('\n');
			const nonEmptyLines = lines
				.map(line => line.trim())
				.filter(line => line.length > 0);

			// Join with newlines and ensure consistent spacing
			processedText = nonEmptyLines.join('\n');

			return processedText;
		});

		// For backwards compatibility, return a single string if only one element was found
		if (processedContents.length === 1) {
			const truncatedData = formatExtractedDataForLog(processedContents[0], 'text');
			logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Extracted content: ${truncatedData}`);
			return processedContents[0];
		} else {
			// If multiple elements were found, return them as an array
			logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Extracted ${processedContents.length} content values`);
			return processedContents;
		}
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
): Promise<string | string[] | IDataObject | IDataObject[]> {
	try {
		// Changed from $eval to $$eval to get all matching elements
		const htmlContents = await page.$$eval(selector, (els) => els.map(el => el.innerHTML));

		// Log the number of elements found
		logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Found ${htmlContents.length} elements matching selector for HTML extraction`);

		// Handle both single and multiple results with backwards compatibility
		if (htmlContents.length === 1) {
			// Single element - maintain backwards compatibility
			const htmlContent = htmlContents[0];

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
		} else {
			// Multiple elements found
			if (options.outputFormat === 'html') {
				// Return array of raw HTML strings
				return htmlContents;
			}

			// Return array of objects with optional metadata
			return htmlContents.map(htmlContent => {
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
			});
		}
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
): Promise<string | string[]> {
	try {
		// Changed from $eval to $$eval to get all matching elements
		const attributeValues = await page.$$eval(
			selector,
			(els, attr) => els.map(el => el.getAttribute(attr) || ''),
			attributeName
		);

		// Log the number of elements found
		logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Found ${attributeValues.length} elements matching selector for attribute ${attributeName}`);

		// Handle both single and multiple results
		if (attributeValues.length === 1) {
			const truncatedAttribute = formatExtractedDataForLog(attributeValues[0], 'attribute');
			logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Extracted attribute ${attributeName}: ${truncatedAttribute}`);
			return attributeValues[0]; // Return single string for backwards compatibility
		} else {
			logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Extract] Extracted ${attributeValues.length} attribute values for ${attributeName}`);
			return attributeValues; // Return array of values
		}
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
