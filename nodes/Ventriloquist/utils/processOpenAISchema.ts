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

export interface IOpenAIField {
  name: string;
  type?: string;
  description?: string;
  instructions: string;
  format?: string;
  formatString?: string;
  required?: boolean;
  examples?: Array<{
    input: string;
    output: string;
  }>;
  relativeSelectorOptional?: string; // Used when AI is ON
  relativeSelector?: string;       // Used when AI is OFF
  extractionType?: string;        // Type of extraction (text, attribute, html)
  attributeName?: string;         // Name of attribute to extract if extraction type is attribute
  returnDirectAttribute?: boolean; // Flag to indicate if attribute value should be returned directly
  referenceContent?: string;      // Stores extracted content for reference
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
export function processFieldsWithReferenceContent<T extends IOpenAIField>(
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

    // Get the instruction or description text
    const instructionText = processedField.instructions || processedField.description || '';

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

    // Add reference content to all fields unless they already have referenceContent
    if (!processedField.referenceContent) {
      // Add reference content to instructions
      const referenceNote = `\n\nUse this as reference: "${referenceContent}"`;

      // Update instructions
      const originalInstructionsLength = processedField.instructions?.length || 0;
      processedField.instructions += referenceNote;

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
      }

      // Update description if it exists
      if (processedField.description) {
        const originalDescriptionLength = processedField.description?.length || 0;
        processedField.description += referenceNote;

        if (logger) {
          logger.info(
            formatOperationLog(
              logTag,
              nodeName,
              nodeId,
              index,
              `Added reference note to field "${field.name}" description, new length: ${processedField.description.length} (was ${originalDescriptionLength})`
            )
          );
        }
      }

      if (logger) {
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
    } else if (logger) {
      logger.info(
        formatOperationLog(
          logTag,
          nodeName,
          nodeId,
          index,
          `Field "${processedField.name}" already has reference content, skipping`
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
  fields: T[],
  page: any,
  mainSelector: string,
  logger?: Logger | undefined,
  context?: { nodeName: string; nodeId: string; index: number; debugMode?: boolean },
  rawHtml?: string
): Promise<T[]> {
  const nodeName = context?.nodeName || 'Ventriloquist';
  const nodeId = context?.nodeId || 'unknown';
  const index = context?.index !== undefined ? context.index : 0;
  const component = 'processOpenAISchema';
  const functionName = 'enhanceFieldsWithRelativeSelectorContent';

  if (!page || !mainSelector || !fields || fields.length === 0) {
    if (logger) {
      logger.warn(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Cannot enhance fields: missing page, selector, or fields`,
          component,
          functionName
        )
      );
    }
    return fields;
  }

  // Find fields with relative selectors
  const enhancedFields = [...fields];

  try {
    if (logger) {
      logWithDebug(
        logger,
        !!context?.debugMode,
        nodeName,
        'SmartExtraction',
        component,
        functionName,
        `Enhancing ${fields.length} fields with relative selector content (main selector: ${mainSelector})`,
        'debug'
      );

      // Log each field that has a relative selector
      fields.forEach(field => {
        if (field.relativeSelectorOptional || field.relativeSelector) {
          logger.debug(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Field ${field.name} has relative selector: ${field.relativeSelectorOptional || field.relativeSelector}`,
              component,
              functionName
            )
          );
        }
      });
    }

    // Determine if we have valid HTML content to work with
    let mainElementHtml = '';
    let mainElementExists = false;

    // If raw HTML was provided, use it directly
    if (rawHtml && rawHtml.length > 0) {
      mainElementHtml = rawHtml;
      mainElementExists = true;

      if (logger) {
        logger.debug(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Using provided HTML content (${mainElementHtml.length} chars) instead of querying for selector`,
            component,
            functionName
          )
        );
      }
    }
    // Otherwise, try to get the HTML from the page
    else {
      try {
        // Check if selector exists and get its HTML content
        const selectorInfo = await page.evaluate((selector: string) => {
          const el = document.querySelector(selector);
          if (!el) return { exists: false, message: `Selector not found: ${selector}` };

          return {
            exists: true,
            html: el.outerHTML,
            message: `Found element with tag ${el.tagName}`
          };
        }, mainSelector);

        if (selectorInfo.exists) {
          mainElementExists = true;
          mainElementHtml = selectorInfo.html;

          if (logger) {
            logger.debug(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `Found main selector: ${mainSelector}, HTML length: ${mainElementHtml.length}`,
                component,
                functionName
              )
            );
          }
        } else {
          if (logger) {
            logger.warn(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `Main selector not found: ${mainSelector}`,
                component,
                functionName
              )
            );

            // Even if main selector isn't found, try to find it with a less strict approach
            logger.info(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `Trying alternative approach to find selector elements`,
                component,
                functionName
              )
            );
          }
        }
      } catch (error) {
        if (logger) {
          logger.warn(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Error evaluating main selector: ${(error as Error).message}`,
              component,
              functionName
            )
          );
        }
      }
    }

    // If we don't have HTML content to work with, return the original fields
    if (!mainElementExists || !mainElementHtml) {
      if (logger) {
        logger.warn(
          formatOperationLog(
            "SmartExtraction",
            nodeName,
            nodeId,
            index,
            `Cannot enhance fields without HTML content to work with`,
            component,
            functionName
          )
        );
      }
      return enhancedFields;
    }

    // Process each field for relative selector content
    for (let i = 0; i < enhancedFields.length; i++) {
      const field = enhancedFields[i];

      // Get the actual selector to use - prioritize relativeSelectorOptional (AI mode) but fallback to relativeSelector (non-AI mode)
      const actualSelector = field.relativeSelectorOptional || field.relativeSelector;

      // Check if the field has any relative selector property
      if (actualSelector && typeof actualSelector === 'string' && actualSelector.trim() !== '') {
        if (logger) {
          logger.debug(
            formatOperationLog(
              "SmartExtraction",
              nodeName,
              nodeId,
              index,
              `Processing field "${field.name}" with relative selector: ${actualSelector}`,
              component,
              functionName
            )
          );
        }

        try {
          // Determine how to extract data - from the field's extractionType and attributeName
          // or from the selector itself if it contains attribute syntax
          let extractionType = field.extractionType || 'text';
          let attributeName = field.attributeName || '';
          let cleanSelector = actualSelector;

          // Check if the selector contains attribute extraction syntax (e.g., [href])
          const attributeMatch = actualSelector.match(/\[([^\]]+)\]$/);
          if (attributeMatch && attributeMatch[1]) {
            attributeName = attributeMatch[1];
            cleanSelector = actualSelector.replace(/\[([^\]]+)\]$/, '');
            extractionType = 'attribute';

            if (logger) {
              logger.info(
                formatOperationLog(
                  "SmartExtraction",
                  nodeName,
                  nodeId,
                  index,
                  `Detected attribute extraction from selector: ${attributeName} using selector: ${cleanSelector}`,
                  component,
                  functionName
                )
              );
            }
          }

          // Override with explicit extraction type if set in the field
          if (field.extractionType === 'attribute' && field.attributeName) {
            extractionType = 'attribute';
            attributeName = field.attributeName;

            if (logger) {
              logger.info(
                formatOperationLog(
                  "SmartExtraction",
                  nodeName,
                  nodeId,
                  index,
                  `Using explicit attribute extraction: ${attributeName}`,
                  component,
                  functionName
                )
              );
            }
          }

          if (logger) {
            logger.info(
              formatOperationLog(
                "SmartExtraction",
                nodeName,
                nodeId,
                index,
                `About to extract content for field "${field.name}" using ${rawHtml ? 'provided HTML' : 'main selector: ' + mainSelector} and relative selector: ${cleanSelector}, type: ${extractionType}, attribute: ${attributeName || 'none'}, AI mode: ${!!field.relativeSelectorOptional}`,
                component,
                functionName
              )
            );
          }

          // Extract content using the relative selector - now we pass the raw HTML to the browser context
          // so it can create a temporary element and query within it
          const content = await page.evaluate(
            (mainSel: string, relSel: string, attrName: string, extractType: string, html: string) => {
              try {
                let parentElement;

                // If we have HTML content, create a temporary element to query within
                if (html) {
                  logWithDebug(
                    logger,
                    true,
                    nodeName || 'Ventriloquist',
                    'SmartExtraction',
                    component,
                    functionName,
                    `Using provided HTML content (${html.length} chars)`,
                    'info'
                  );
                  const tempContainer = document.createElement('div');
                  tempContainer.innerHTML = html;
                  parentElement = tempContainer;
                } else {
                  // Otherwise, query the document directly (fallback)
                  logWithDebug(
                    logger,
                    true,
                    nodeName || 'Ventriloquist',
                    'SmartExtraction',
                    component,
                    functionName,
                    `Finding parent element with selector: ${mainSel}`,
                    'info'
                  );
                  parentElement = document.querySelector(mainSel);
                }

                if (!parentElement) {
                  logWithDebug(
                    logger,
                    true,
                    nodeName || 'Ventriloquist',
                    'SmartExtraction',
                    component,
                    functionName,
                    `Parent element not found or HTML content not valid`,
                    'warn'
                  );
                  return '';
                }

                logWithDebug(
                  logger,
                  true,
                  nodeName || 'Ventriloquist',
                  'SmartExtraction',
                  component,
                  functionName,
                  `Finding element with selector: ${relSel} within parent`,
                  'info'
                );
                const element = parentElement.querySelector(relSel);
                if (!element) {
                  logWithDebug(
                    logger,
                    true,
                    nodeName || 'Ventriloquist',
                    'SmartExtraction',
                    component,
                    functionName,
                    `Relative element not found: ${relSel}`,
                    'warn'
                  );
                  return '';
                }

                logWithDebug(
                  logger,
                  true,
                  nodeName || 'Ventriloquist',
                  'SmartExtraction',
                  component,
                  functionName,
                  `Element found: ${element.tagName}, extraction type: ${extractType}`,
                  'info'
                );

                // Get the content based on extraction type
                if (extractType === 'attribute' && attrName) {
                  // Check if element has the attribute
                  if (!element.hasAttribute(attrName)) {
                    logWithDebug(
                      logger,
                      true,
                      nodeName || 'Ventriloquist',
                      'SmartExtraction',
                      component,
                      functionName,
                      `Element does not have attribute: ${attrName}`,
                      'warn'
                    );
                    return '';
                  }

                  const attrValue = element.getAttribute(attrName) || '';
                  logWithDebug(
                    logger,
                    true,
                    nodeName || 'Ventriloquist',
                    'SmartExtraction',
                    component,
                    functionName,
                    `Found attribute ${attrName} value: ${attrValue}`,
                    'info'
                  );

                  // Add additional debugging for attribute values
                  logWithDebug(
                    logger,
                    true,
                    nodeName || 'Ventriloquist',
                    'SmartExtraction',
                    component,
                    functionName,
                    `ATTRIBUTE DEBUG - Element: ${element.tagName}`,
                    'debug'
                  );
                  logWithDebug(
                    logger,
                    true,
                    nodeName || 'Ventriloquist',
                    'SmartExtraction',
                    component,
                    functionName,
                    `ATTRIBUTE DEBUG - Attribute Name: ${attrName}`,
                    'debug'
                  );
                  logWithDebug(
                    logger,
                    true,
                    nodeName || 'Ventriloquist',
                    'SmartExtraction',
                    component,
                    functionName,
                    `ATTRIBUTE DEBUG - Attribute Value: ${attrValue}`,
                    'debug'
                  );
                  logWithDebug(
                    logger,
                    true,
                    nodeName || 'Ventriloquist',
                    'SmartExtraction',
                    component,
                    functionName,
                    `ATTRIBUTE DEBUG - Element HTML: ${element.outerHTML.substring(0, 150)}`,
                    'debug'
                  );

                  return attrValue;
                } else if (extractType === 'html') {
                  const htmlContent = element.innerHTML || '';
                  logWithDebug(
                    logger,
                    true,
                    nodeName || 'Ventriloquist',
                    'SmartExtraction',
                    component,
                    functionName,
                    `Found HTML content (truncated): ${htmlContent.substring(0, 100)}...`,
                    'info'
                  );
                  return htmlContent;
                } else {
                  const textContent = element.textContent || '';
                  logWithDebug(
                    logger,
                    true,
                    nodeName || 'Ventriloquist',
                    'SmartExtraction',
                    component,
                    functionName,
                    `Found text content (truncated): ${textContent.substring(0, 100)}...`,
                    'info'
                  );
                  return textContent;
                }
              } catch (err: any) {
                logWithDebug(
                  logger,
                  true,
                  nodeName || 'Ventriloquist',
                  'SmartExtraction',
                  component,
                  functionName,
                  `Error in relative selector extraction: ${err.message}`,
                  'error'
                );
                return '';
              }
            },
            mainSelector,
            cleanSelector,
            attributeName,
            extractionType,
            mainElementHtml // Pass the HTML content to the browser context
          );

          if (content && content.trim() !== '') {
            // Store the extracted content in the field for later reference
            field.referenceContent = content.trim();

            // For attribute extraction, mark to return the direct value
            if (extractionType === 'attribute' && attributeName) {
              field.returnDirectAttribute = true;

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
              const instructionText = field.instructions || field.description || '';
              field.instructions = `${instructionText}\n\nThe value of the ${attributeName} attribute is: ${content.trim()}`;
            } else {
              // For non-attribute fields, use standard reference format
              const instructionText = field.instructions || field.description || '';
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
                `No content extracted for field "${field.name}" using selector: ${actualSelector}`,
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
      }
    }

    return enhancedFields;
  } catch (error) {
    if (logger) {
      logger.error(
        formatOperationLog(
          "SmartExtraction",
          nodeName,
          nodeId,
          index,
          `Error enhancing fields: ${(error as Error).message}`,
          component,
          functionName
        )
      );
    }
    return fields;
  }
}
