/**
 * Utility function to process OpenAI field definitions and append reference content
 * to URL or link-related fields to enhance extraction accuracy.
 *
 * This function is used before sending field definitions to the OpenAI API to ensure
 * that URL or link extraction fields include the current page URL as reference content.
 */

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
  relativeSelectorOptional?: string;
}

/**
 * Process field definitions to append reference content to appropriate fields
 *
 * @param fields Array of field definitions
 * @param referenceContent Reference content to append (usually URL)
 * @param includeReferenceContext Whether to include reference context
 * @returns Modified array of field definitions
 */
export function processFieldsWithReferenceContent<T extends IOpenAIField>(
  fields: T[],
  referenceContent?: string,
  includeReferenceContext: boolean = false
): T[] {
  if (!includeReferenceContext || !referenceContent || referenceContent.trim() === '') {
    return fields;
  }

  return fields.map(field => {
    // Create a copy of the field to avoid modifying the original
    const processedField = { ...field };

    // Get the instruction or description text
    const instructionText = processedField.instructions || processedField.description || '';

    // Check if this field is related to URL extraction
    const isUrlField =
      processedField.name.toLowerCase().includes('url') ||
      processedField.name.toLowerCase().includes('link') ||
      instructionText.toLowerCase().includes('url') ||
      instructionText.toLowerCase().includes('link');

    // Add reference content to URL-related fields
    if (isUrlField) {
      // Add reference content to instructions
      const referenceNote = `\n\nUse this as reference: "${referenceContent}"`;

      // Update instructions
      processedField.instructions += referenceNote;

      // Update description if it exists
      if (processedField.description) {
        processedField.description += referenceNote;
      }

      console.log(`Enhanced field "${processedField.name}" with reference content`);
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
 * @returns Promise with the modified array of field definitions
 */
export async function enhanceFieldsWithRelativeSelectorContent<T extends IOpenAIField>(
  fields: T[],
  page: any,
  mainSelector: string
): Promise<T[]> {
  if (!page || !mainSelector || !fields || fields.length === 0) {
    console.log(`Cannot enhance fields: missing required parameters - page: ${!!page}, mainSelector: ${!!mainSelector}, fields: ${fields?.length || 0}`);
    return fields;
  }

  console.log(`Enhancing ${fields.length} fields with relative selector content (main selector: ${mainSelector})`);
  const enhancedFields = [...fields]; // Create a copy to avoid modifying the original

  // Check if main selector exists
  const mainSelectorExists = await page.evaluate((sel: string) => {
    return !!document.querySelector(sel);
  }, mainSelector);

  if (!mainSelectorExists) {
    console.log(`Main selector not found: ${mainSelector}`);
    return enhancedFields;
  }

  // Process each field for relative selector content
  for (let i = 0; i < enhancedFields.length; i++) {
    const field = enhancedFields[i];

    // Check if the field has a relativeSelectorOptional property
    if (field.relativeSelectorOptional && typeof field.relativeSelectorOptional === 'string' && field.relativeSelectorOptional.trim() !== '') {
      console.log(`Processing field "${field.name}" with relative selector: ${field.relativeSelectorOptional}`);

      try {
        // Check if the selector contains attribute extraction syntax (e.g., [href])
        const attributeMatch = field.relativeSelectorOptional.match(/\[([^\]]+)\]$/);
        let attributeName = '';
        let cleanSelector = field.relativeSelectorOptional;

        if (attributeMatch && attributeMatch[1]) {
          attributeName = attributeMatch[1];
          cleanSelector = field.relativeSelectorOptional.replace(/\[([^\]]+)\]$/, '');
          console.log(`Detected attribute extraction: ${attributeName} using selector: ${cleanSelector}`);
        }

        // Add more detailed logging before extraction
        console.log(`About to extract content for field "${field.name}" using main selector: ${mainSelector} and relative selector: ${field.relativeSelectorOptional}`);

        // Extract content using the relative selector
        const content = await page.evaluate(
          (mainSel: string, relSel: string, attrName: string) => {
            try {
              console.log(`In browser: Looking for parent element using selector: ${mainSel}`);
              const parentElement = document.querySelector(mainSel);
              if (!parentElement) {
                console.log(`Parent element not found: ${mainSel}`);
                return '';
              }

              console.log(`In browser: Parent element found, now looking for child element using selector: ${relSel}`);
              const element = parentElement.querySelector(relSel);
              if (!element) {
                console.log(`Relative element not found: ${relSel}`);
                return '';
              }

              // Get the content based on whether we need an attribute or text
              if (attrName) {
                const attrValue = element.getAttribute(attrName) || '';
                console.log(`In browser: Found attribute value: ${attrValue}`);
                return attrValue;
              } else {
                const textContent = element.textContent || '';
                console.log(`In browser: Found text content: ${textContent}`);
                return textContent;
              }
            } catch (err) {
              console.error('Error in relative selector extraction:', err);
              return '';
            }
          },
          mainSelector,
          attributeName ? cleanSelector : field.relativeSelectorOptional,
          attributeName
        );

        if (content && content.trim() !== '') {
          // Include the actual extracted content directly in the instructions
          // Special handling for the Auction URL field
          if (field.name.toLowerCase().includes('auction') && field.name.toLowerCase().includes('url')) {
            // For Auction URL field, modify the instructions to include the actual URL
            field.instructions = `Extract the auction URL. If the auction URL is "${content.trim()}", return this exact URL. If there is no valid URL, return an empty string.`;
            console.log(`Enhanced Auction URL field with direct content: "${content.trim()}"`);
          } else {
            // For other fields, append the extracted content as reference
            const instructionText = field.instructions || field.description || '';
            field.instructions = instructionText + `\n\nUse this as reference: "${content.trim()}"`;
            console.log(`Enhanced field "${field.name}" with extracted content (${content.length} chars): "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}""`);
          }
        } else {
          console.log(`No content extracted for field "${field.name}" using selector: ${field.relativeSelectorOptional}`);
        }
      } catch (error) {
        console.error(`Error enhancing field ${field.name} with relative selector content:`, error);
      }
    }
  }

  return enhancedFields;
}
