/**
 * Define a more flexible Page type to accommodate both puppeteer and puppeteer-core
 */
interface Page {
  evaluate: Function;
  $$eval: Function;
  $eval: Function;
}

/**
 * Utility function to process OpenAI field definitions and append reference content
 * to URL or link-related fields to enhance extraction accuracy.
 *
 * This function is used before sending field definitions to the OpenAI API to ensure
 * that URL or link extraction fields include the current page URL as reference content.
 */
import type { Logger } from 'n8n-workflow';
import { formatOperationLog } from './resultUtils';
import { logWithDebug } from './loggingUtils';
import type { IField } from './aiService';
// import type * as puppeteer from 'puppeteer';

export interface IOpenAIField {
  name: string;
  type?: string;
  instructions: string;
  format?: string;
  formatString?: string;
  required?: boolean;
  examples?: Array<{
    input: string;
    output: string;
  }>;
}

/**
 * Process field definitions to append reference content to appropriate fields
 *
 * @param fields Array of field definitions
 * @param referenceContent Reference content to append (usually URL)
 * @param includeReferenceContext Whether to include reference context
 * @param logger Optional logger instance
 * @param context Optional logging context
 * @returns Modified array of field definitions
 */
export function processFieldsWithReferenceContent<T extends IField>(
  fields: T[],
  referenceContent?: string,
  includeReferenceContext: boolean = false,
  logger?: Logger | undefined,
  context?: { nodeName: string; nodeId: string; index: number; debugMode?: boolean }
): T[] {
  const logTag = "SmartExtraction";
  const nodeName = context?.nodeName || 'Ventriloquist';
  const nodeId = context?.nodeId || 'unknown';
  const index = context?.index ?? 0;

  if (logger) {
    logger.info(
      formatOperationLog(
        logTag,
        nodeName,
        nodeId,
        index,
        `Starting reference content processing with ${fields.length} fields, includeReferenceContext=${includeReferenceContext}`
      )
    );

    logger.info(
      formatOperationLog(
        logTag,
        nodeName,
        nodeId,
        index,
        `Reference content (${referenceContent?.length || 0} chars): ${referenceContent?.substring(0, 100)}${referenceContent && referenceContent.length > 100 ? '...' : ''}`
      )
    );
  }

  if (!includeReferenceContext || !referenceContent || referenceContent.trim() === '') {
    if (logger) {
      logger.info(
        formatOperationLog(
          logTag,
          nodeName,
          nodeId,
          index,
          `No reference context to add, returning original fields`
        )
      );
    }
    return fields;
  }

  return fields.map(field => {
    // Create a copy of the field to avoid modifying the original
    const processedField = { ...field };

    // Get the instruction text. IField has instructions?, but the map in aiService ensures it's a string.
    const instructionText = processedField.instructions || ''; // Default to empty string if somehow undefined

    if (logger) {
      logger.info(
        formatOperationLog(
          logTag,
          nodeName,
          nodeId,
          index,
          `Processing field "${field.name}" with original instructions (${instructionText.length} chars): ${instructionText.substring(0, 100)}${instructionText.length > 100 ? '...' : ''}`
        )
      );
    }

    // Add reference content to instructions
    // The check for existing processedField.referenceContent is removed as IField doesn't have it,
    // and this function's purpose is to add the passed referenceContent.
    const referenceNote = `\n\nUse this as reference: "${referenceContent}"`;

    // Update instructions. It should be a string due to prior mapping in aiService.
    const originalInstructionsLength = processedField.instructions?.length || 0;
    processedField.instructions = (processedField.instructions || '') + referenceNote;

    if (logger) {
      logger.info(
        formatOperationLog(
          logTag,
          nodeName,
          nodeId,
          index,
          `Added reference note to field "${field.name}" instructions, new length: ${processedField.instructions.length} (was ${originalInstructionsLength})`
        )
      );
      // Removed section that updated processedField.description as IField doesn't have it.
      logger.info(
        formatOperationLog(
          logTag,
          nodeName,
          nodeId,
          index,
          `Enhanced field "${processedField.name}" with reference content. Final instructions (${processedField.instructions.length} chars): ${processedField.instructions.substring(0, 100)}${processedField.instructions.length > 100 ? '...' : ''}`
        )
      );
    }

    return processedField as T;
  });
}

/**
 * Process field definitions to append relative selector content to fields where provided
 *
 * @param fields Array of field definitions
 * @param page The Puppeteer page instance
 * @param mainSelector The main element selector (parent element)
 * @param logger Optional logger instance
 * @param context Optional logging context
 * @param rawHtml Optional raw HTML content already extracted using the main selector
 * @returns Promise with the modified array of field definitions
 */
export async function enhanceFieldsWithRelativeSelectorContent<T extends IOpenAIField>(
  page: Page,
  fields: T[],
  mainSelector: string,
  logger?: Logger,
  logOptions?: {
    nodeName?: string;
    nodeId?: string;
    index?: number;
    component?: string;
    functionName?: string;
  }
): Promise<T[]> {
  // Create a copy of the fields array to avoid modifying the original
  const enhancedFields = [...fields];

  // Set defaults for logs
  const nodeName = logOptions?.nodeName || 'Unknown';
  const nodeId = logOptions?.nodeId || 'unknown';
  const index = logOptions?.index !== undefined ? logOptions?.index : 0;
  const component = logOptions?.component || 'processOpenAISchema';
  const functionName = logOptions?.functionName || 'enhanceFieldsWithRelativeSelectorContent';

  // For each field with an AI-provided optional relative selector
  for (const field of enhancedFields) {
    try {
      // Check if it has a relativeSelector (could be AI-provided or explicitly defined)
      // const relativeSelectorOptional = field.relativeSelectorOptional;
      // const relativeSelector = field.relativeSelector;
      const extractionType = (field as any).extractionType || 'text'; // Default to text extraction

      // Skip fields without a relative selector
      if (extractionType === 'text') {
        continue;
      }

      // Determine which selector to use
      // const actualSelector = relativeSelectorOptional || relativeSelector || '';

      // Get extraction type and attribute name if they exist
      const fieldOptions = (field as any).fieldOptions || {};
      const attributeName = fieldOptions.attributeName || '';

      if (logger) {
        logger.info(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Processing field "${field.name}" with ${extractionType} extraction`,
            component,
            functionName
          )
        );
      }

      try {
        // First, get the main element's HTML to work with
        const mainElementHtml = await page.evaluate((selector: string) => {
          const element = document.querySelector(selector);
          if (!element) {
            console.error(`[Browser] Main element not found with selector: ${selector}`);
            return null;
          }
          return element.outerHTML;
        }, mainSelector);

        if (!mainElementHtml) {
          if (logger) {
            logger.warn(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `Main element not found for selector: ${mainSelector}`,
                component,
                functionName
              )
            );
          }
          continue;
        }

        // Clean the selector for safe use in JavaScript
        // const cleanSelector = actualSelector.replace(/"/g, '\\"');

        // Now extract the content using the relative selector within the main element
        const content = await page.evaluate(
          (mainSelector: string, extractionType: string, mainElementHtml: string) => {
            try {
              console.log(`[Browser] Searching for child element using extraction type: ${extractionType} within main element ${mainSelector}`);

              // Create a temporary container with the main element's HTML
              const tempContainer = document.createElement('div');
              tempContainer.innerHTML = mainElementHtml;

              // Find the relative element within the temporary container
              // This is more reliable than trying to query within the live DOM
              const element = tempContainer.querySelector(extractionType);

              if (!element) {
                console.error(`[Browser] Element not found with extraction type: ${extractionType} within the container`);
                return '';
              }

              console.log(`[Browser] Element found with extraction type: ${extractionType}`);

              // Extract based on extraction type
              if (extractionType === 'attribute' && attributeName) {
                const attrValue = element.getAttribute(attributeName) || '';
                console.log(`[Browser] Found attribute ${attributeName} value: ${attrValue}`);

                // Add additional debugging for attribute values
                console.log(`[Browser] ATTRIBUTE DEBUG - Element: ${element.tagName}`);
                console.log(`[Browser] ATTRIBUTE DEBUG - Attribute Name: ${attributeName}`);
                console.log(`[Browser] ATTRIBUTE DEBUG - Attribute Value: ${attrValue}`);
                console.log(`[Browser] ATTRIBUTE DEBUG - Element HTML: ${element.outerHTML.substring(0, 150)}`);

                return attrValue;
              } else if (extractionType === 'html') {
                const htmlContent = element.innerHTML || '';
                console.log(`[Browser] Found HTML content (truncated): ${htmlContent.substring(0, 100)}...`);
                return htmlContent;
              } else {
                const textContent = element.textContent || '';
                console.log(`[Browser] Found text content (truncated): ${textContent.substring(0, 100)}...`);
                return textContent;
              }
            } catch (err) {
              console.error(`[Browser] Error in relative selector extraction: ${err.message}`);
              return '';
            }
          },
          mainSelector,
          extractionType,
          mainElementHtml // Pass the HTML content to the browser context
        );

        if (content && content.trim() !== '') {
          // Store the extracted content in the field for later reference
          // field.referenceContent = content.trim(); // Commented out: IField does not have referenceContent; content is added to instructions

          // For attribute extraction, mark to return the direct value
          if (extractionType === 'attribute' && attributeName) {
            // field.returnDirectAttribute = true;  // Commented out: IField does not have returnDirectAttribute

            if (logger) {
              logger.info(
                formatOperationLog(
                  "SmartExtraction",
                  nodeName,
                  nodeId,
                  index,
                  `Field "${field.name}" will return direct attribute value: "${content.trim()}"`,
                  component,
                  functionName
                )
              );
            }

            // For attribute fields, use a more descriptive reference format
            const instructionText = field.instructions || '';
            field.instructions = `${instructionText}\n\nThe value of the ${attributeName} attribute is: ${content.trim()}`;
          } else {
            // For non-attribute fields, use standard reference format
            const instructionText = field.instructions || '';
            field.instructions = `${instructionText}\n\nUse this as reference: "${content.trim()}"`;
          }

          if (logger) {
            logger.info(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `Enhanced field "${field.name}" with extracted content (${content.length} chars): "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
                component,
                functionName
              )
            );
          }
        } else if (logger) {
          logger.warn(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `No content extracted for field "${field.name}" using extraction type: ${extractionType}`,
              component,
              functionName
            )
          );
        }
      } catch (error) {
        if (logger) {
          logger.error(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Error enhancing field ${field.name} with relative selector content: ${(error as Error).message}`,
              component,
              functionName
            )
          );
        }
      }
    } catch (error) {
      if (logger) {
        logger.error(
          formatOperationLog(
            "OpenAISchema",
            nodeName,
            nodeId,
            index,
            `Error processing field: ${(error as Error).message}`,
            component,
            functionName
          )
        );
      }
    }
  }

  return enhancedFields;
}
