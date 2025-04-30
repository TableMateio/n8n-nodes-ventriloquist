/**
 * Utility function to process OpenAI field definitions and append reference content
 * to URL or link-related fields to enhance extraction accuracy.
 *
 * This function is used before sending field definitions to the OpenAI API to ensure
 * that URL or link extraction fields include the current page URL as reference content.
 */
import type { Logger } from 'n8n-workflow';
import { formatOperationLog } from './resultUtils';

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
  logger?: Logger,
  context?: { nodeName: string; nodeId: string; index: number }
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
 * @returns Promise with the modified array of field definitions
 */
export async function enhanceFieldsWithRelativeSelectorContent<T extends IOpenAIField>(
  fields: T[],
  page: any,
  mainSelector: string,
  logger?: Logger,
  context?: { nodeName: string; nodeId: string; index: number }
): Promise<T[]> {
  const logTag = "SmartExtraction";
  const nodeName = context?.nodeName || 'Ventriloquist';
  const nodeId = context?.nodeId || 'unknown';
  const index = context?.index ?? 0;

  if (!page || !mainSelector || !fields || fields.length === 0) {
    if (logger) {
      logger.warn(
        formatOperationLog(
          logTag,
          nodeName,
          nodeId,
          index,
          `Cannot enhance fields: missing required parameters - page: ${!!page}, mainSelector: ${!!mainSelector}, fields: ${fields?.length || 0}`
        )
      );
    }
    return fields;
  }

  if (logger) {
    logger.info(
      formatOperationLog(
        logTag,
        nodeName,
        nodeId,
        index,
        `Enhancing ${fields.length} fields with relative selector content (main selector: ${mainSelector})`
      )
    );
  }

  const enhancedFields = [...fields]; // Create a copy to avoid modifying the original

  // Check if main selector exists
  const mainSelectorExists = await page.evaluate((sel: string) => {
    return !!document.querySelector(sel);
  }, mainSelector);

  if (!mainSelectorExists) {
    if (logger) {
      logger.warn(
        formatOperationLog(
          logTag,
          nodeName,
          nodeId,
          index,
          `Main selector not found: ${mainSelector}`
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
        logger.info(
          formatOperationLog(
            logTag,
            nodeName,
            nodeId,
            index,
            `Processing field "${field.name}" with relative selector: ${actualSelector}`
          )
        );

        logger.debug(
          formatOperationLog(
            logTag,
            nodeName,
            nodeId,
            index,
            `Field "${field.name}" config: AI=${!!field.relativeSelectorOptional || false}, relativeSelector=${field.relativeSelector || 'none'}, relativeSelectorOptional=${field.relativeSelectorOptional || 'none'}`
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
                logTag,
                nodeName,
                nodeId,
                index,
                `Detected attribute extraction from selector: ${attributeName} using selector: ${cleanSelector}`
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
                logTag,
                nodeName,
                nodeId,
                index,
                `Using explicit attribute extraction: ${attributeName}`
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
              `About to extract content for field "${field.name}" using main selector: ${mainSelector} and relative selector: ${cleanSelector}, type: ${extractionType}, attribute: ${attributeName || 'none'}, AI mode: ${!!field.relativeSelectorOptional}`
            )
          );
        }

        // Extract content using the relative selector
        const content = await page.evaluate(
          (mainSel: string, relSel: string, attrName: string, extractType: string) => {
            try {
              console.log(`[Browser] Finding parent element with selector: ${mainSel}`);
              const parentElement = document.querySelector(mainSel);
              if (!parentElement) {
                console.warn(`[Browser] Parent element not found: ${mainSel}`);
                return '';
              }

              console.log(`[Browser] Finding element with selector: ${relSel} within parent`);
              const element = parentElement.querySelector(relSel);
              if (!element) {
                console.warn(`[Browser] Relative element not found: ${relSel}`);
                return '';
              }

              console.log(`[Browser] Element found: ${element.tagName}, extraction type: ${extractType}`);

              // Get the content based on extraction type
              if (extractType === 'attribute' && attrName) {
                // Check if element has the attribute
                if (!element.hasAttribute(attrName)) {
                  console.warn(`[Browser] Element does not have attribute: ${attrName}`);
                  return '';
                }

                const attrValue = element.getAttribute(attrName) || '';
                console.log(`[Browser] Found attribute ${attrName} value: ${attrValue}`);

                // Add additional debugging for attribute values
                console.log(`[Browser] ATTRIBUTE DEBUG - Element: ${element.tagName}`);
                console.log(`[Browser] ATTRIBUTE DEBUG - Attribute Name: ${attrName}`);
                console.log(`[Browser] ATTRIBUTE DEBUG - Attribute Value: ${attrValue}`);
                console.log(`[Browser] ATTRIBUTE DEBUG - Element HTML: ${element.outerHTML.substring(0, 150)}`);

                return attrValue;
              } else if (extractType === 'html') {
                const htmlContent = element.innerHTML || '';
                console.log(`[Browser] Found HTML content (truncated): ${htmlContent.substring(0, 100)}...`);
                return htmlContent;
              } else {
                const textContent = element.textContent || '';
                console.log(`[Browser] Found text content (truncated): ${textContent.substring(0, 100)}...`);
                return textContent;
              }
            } catch (err: any) {
              console.error(`[Browser] Error in relative selector extraction: ${err.message}`);
              return '';
            }
          },
          mainSelector,
          cleanSelector,
          attributeName,
          extractionType
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
                  logTag,
                  nodeName,
                  nodeId,
                  index,
                  `Field "${field.name}" will return direct attribute value: "${content.trim()}"`
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
                logTag,
                nodeName,
                nodeId,
                index,
                `Enhanced field "${field.name}" with extracted content (${content.length} chars): "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`
              )
            );
          }
        } else if (logger) {
          logger.warn(
            formatOperationLog(
              logTag,
              nodeName,
              nodeId,
              index,
              `No content extracted for field "${field.name}" using selector: ${actualSelector}`
            )
          );
        }
      } catch (error) {
        if (logger) {
          logger.error(
            formatOperationLog(
              logTag,
              nodeName,
              nodeId,
              index,
              `Error enhancing field ${field.name} with relative selector content: ${(error as Error).message}`
            )
          );
        }
      }
    }
  }

  return enhancedFields;
}
