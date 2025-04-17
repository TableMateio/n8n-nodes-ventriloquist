import type { Logger as ILogger } from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { createExtraction, type IExtractionConfig } from './middlewares/extraction/extractionFactory';
import { formatExtractedDataForLog } from './extractionUtils';
import { formatOperationLog } from './resultUtils';
import { getHumanDelay } from './extractionUtils';

/**
 * Interface for extract item configuration
 */
export interface IExtractItem {
  name: string;
  extractionType: string;
  selector: string;
  continueIfNotFound?: boolean;
  attributeName?: string;
  textOptions?: {
    cleanText?: boolean;
  };
  htmlOptions?: {
    outputFormat?: string;
    includeMetadata?: boolean;
  };
  tableOptions?: {
    includeHeaders?: boolean;
    rowSelector?: string;
    cellSelector?: string;
    outputFormat?: string;
  };
  multipleOptions?: {
    attributeName?: string;
    extractionProperty?: string;
    outputLimit?: number;
    extractProperty?: boolean;
    propertyKey?: string;
    separator?: string;
    outputFormat?: string;
  };
}

/**
 * Interface for extract operation configuration
 */
export interface IExtractConfig {
  waitForSelector: boolean;
  timeout: number;
  useHumanDelays: boolean;
  continueOnFail: boolean;
}

/**
 * Process all extraction items using our middleware architecture
 */
export async function processExtractionItems(
  page: puppeteer.Page,
  extractionItems: IExtractItem[],
  config: IExtractConfig,
  context: {
    logger: ILogger;
    nodeName: string;
    nodeId: string;
    sessionId: string;
    index: number;
  }
): Promise<{ [key: string]: any }> {
  const { logger, nodeName, nodeId, index } = context;
  const { waitForSelector, timeout, useHumanDelays, continueOnFail } = config;

  // Log the start of extraction
  logger.info(
    formatOperationLog(
      "Extract",
      nodeName,
      nodeId,
      index,
      `Starting extraction operation with ${extractionItems.length} item(s)`
    )
  );

  // Add a human-like delay if enabled
  if (useHumanDelays) {
    const delay = getHumanDelay();
    logger.info(
      formatOperationLog(
        "Extract",
        nodeName,
        nodeId,
        index,
        `Adding human-like delay: ${delay}ms`
      )
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  // Process each extraction item
  const extractionData: { [key: string]: any } = {};

  for (let i = 0; i < extractionItems.length; i++) {
    const item = extractionItems[i];
    const itemName = item.name;
    const extractionType = item.extractionType;
    const selector = item.selector;

    logger.info(
      formatOperationLog(
        "Extract",
        nodeName,
        nodeId,
        index,
        `Processing extraction item ${i+1}/${extractionItems.length}: ${itemName} (${extractionType}) with selector: ${selector}`
      )
    );

    // Wait for the selector if needed
    if (waitForSelector) {
      logger.info(
        formatOperationLog(
          "Extract",
          nodeName,
          nodeId,
          index,
          `Waiting for selector: ${selector} (timeout: ${timeout}ms)`
        )
      );

      // Add diagnostic check - see if the selector exists immediately
      try {
        const selectorCount = await page.evaluate((sel) => {
          return document.querySelectorAll(sel).length;
        }, selector);

        logger.info(
          formatOperationLog(
            "Extract",
            nodeName,
            nodeId,
            index,
            `Quick check: Found ${selectorCount} elements matching selector immediately`
          )
        );

        // If we found elements, log the page URL to help with debugging
        if (selectorCount === 0) {
          const url = await page.url();
          logger.info(
            formatOperationLog(
              "Extract",
              nodeName,
              nodeId,
              index,
              `Current page URL: ${url}`
            )
          );

          // Check if the page has frames which might contain the element
          const frames = await page.frames();
          if (frames.length > 1) {
            logger.info(
              formatOperationLog(
                "Extract",
                nodeName,
                nodeId,
                index,
                `Page has ${frames.length} frames. Element might be in a frame.`
              )
            );
          }
        }
      } catch (evalError) {
        logger.warn(
          formatOperationLog(
            "Extract",
            nodeName,
            nodeId,
            index,
            `Error during selector check: ${(evalError as Error).message}`
          )
        );
      }

      try {
        await page.waitForSelector(selector, { timeout });
      } catch (error) {
        const errorMessage = `Selector timeout for ${itemName}: ${selector} after ${timeout}ms`;
        logger.error(
          formatOperationLog(
            "Extract",
            nodeName,
            nodeId,
            index,
            errorMessage
          )
        );

        // Check if we should continue with other extractions
        // Item-level setting takes precedence over global setting
        if (item.continueIfNotFound === true || continueOnFail) {
          logger.info(
            formatOperationLog(
              "Extract",
              nodeName,
              nodeId,
              index,
              `Continuing with other extractions (${item.continueIfNotFound ? 'selector-level setting' : 'global setting'})`
            )
          );
          extractionData[itemName] = { error: `Selector not found: ${selector}` };
          continue;
        } else {
          throw error;
        }
      }
    }

    // Create extraction config based on extraction type
    const extractionConfig: IExtractionConfig = {
      extractionType,
      selector,
      waitForSelector: false, // We already handled this above
      selectorTimeout: timeout,
    };

    // Add extraction-specific parameters based on type
    if (extractionType === "html" && item.htmlOptions) {
      extractionConfig.outputFormat = item.htmlOptions.outputFormat || "html";
      extractionConfig.includeMetadata = item.htmlOptions.includeMetadata;
    } else if (extractionType === "attribute") {
      extractionConfig.attributeName = item.attributeName;
    } else if (extractionType === "text" && item.textOptions) {
      extractionConfig.cleanText = item.textOptions.cleanText;
    } else if (extractionType === "table" && item.tableOptions) {
      extractionConfig.includeHeaders = item.tableOptions.includeHeaders !== false;
      extractionConfig.rowSelector = item.tableOptions.rowSelector || "tr";
      extractionConfig.cellSelector = item.tableOptions.cellSelector || "td, th";
      extractionConfig.outputFormat = item.tableOptions.outputFormat || "json";
    } else if (extractionType === "multiple" && item.multipleOptions) {
      extractionConfig.attributeName = item.multipleOptions.attributeName || "";
      extractionConfig.extractionProperty = item.multipleOptions.extractionProperty || "textContent";
      extractionConfig.limit = item.multipleOptions.outputLimit || 0;
      extractionConfig.outputFormat = item.multipleOptions.outputFormat || "array";

      // Only use object format if array output is selected and extractProperty is true
      if (extractionConfig.outputFormat === "array" && item.multipleOptions.extractProperty === true) {
        extractionConfig.outputFormat = "object";
      }

      extractionConfig.separator = item.multipleOptions.separator || ", ";
    }

    try {
      // Create and execute extraction using our factory
      const extraction = createExtraction(page, extractionConfig, context);
      const result = await extraction.execute();

      if (result.success) {
        const extractedData = result.data;

        // Format the data for logging
        const logSafeData = formatExtractedDataForLog(extractedData, extractionType);

        logger.info(
          formatOperationLog(
            "Extract",
            nodeName,
            nodeId,
            index,
            `Extraction result for ${itemName} (${extractionType}): ${logSafeData}`
          )
        );

        // Store result under the item name
        extractionData[itemName] = extractedData;
      } else {
        logger.error(
          formatOperationLog(
            "Extract",
            nodeName,
            nodeId,
            index,
            `Extraction failed for ${itemName}: ${result.error?.message || "Unknown error"}`
          )
        );

        if (continueOnFail) {
          extractionData[itemName] = { error: result.error?.message || "Extraction failed" };
        } else {
          throw result.error || new Error(`Extraction failed for item "${itemName}"`);
        }
      }
    } catch (error) {
      logger.error(
        formatOperationLog(
          "Extract",
          nodeName,
          nodeId,
          index,
          `Error processing extraction item ${itemName}: ${(error as Error).message}`
        )
      );

      if (continueOnFail) {
        extractionData[itemName] = { error: (error as Error).message };
      } else {
        throw error;
      }
    }
  }

  return extractionData;
}
