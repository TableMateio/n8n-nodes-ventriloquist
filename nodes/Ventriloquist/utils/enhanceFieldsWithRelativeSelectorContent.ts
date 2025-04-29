import { IOpenAIField } from './processOpenAISchema';

/**
 * Extracts content from a selector within a main element
 * @param page - Puppeteer page instance
 * @param mainSelector - The main selector to find on page
 * @param relativeSelector - The relative selector to find within main element
 * @param extractionType - Type of extraction (text, attribute)
 * @param attributeName - Name of attribute to extract if extraction type is attribute
 * @returns - Extracted content as string
 */
export async function extractContentFromSelector(
  page: any,
  mainSelector: string,
  relativeSelector: string,
  extractionType: string = 'text',
  attributeName: string = ''
): Promise<string> {
  try {
    // Check if the main selector exists
    const mainElement = await page.$(mainSelector);
    if (!mainElement) {
      console.log(`Main selector "${mainSelector}" not found on page.`);
      return '';
    }

    // Find the element within the main element
    const element = await mainElement.$(relativeSelector);
    if (!element) {
      console.log(`Relative selector "${relativeSelector}" not found within main selector "${mainSelector}"`);
      return '';
    }

    // If we're explicitly extracting an attribute, just do that directly
    if (extractionType === 'attribute' && attributeName) {
      const attrValue = await element.evaluate((el: any, attr: string) => el.getAttribute(attr) || '', attributeName);
      console.log(`Extracted attribute "${attributeName}" with value: ${attrValue}`);
      return attrValue;
    }

    // Handle other extraction types
    if (extractionType === 'html') {
      const content = await element.evaluate((el: any) => el.innerHTML);
      console.log(`Extracted HTML content: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);
      return content;
    }

    // Default is text extraction
    const content = await element.evaluate((el: any) => el.textContent || '');
    console.log(`Extracted text content: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);
    return content;
  } catch (error) {
    console.error(`Error extracting content: ${(error as Error).message}`);
    return '';
  }
}

/**
 * Enhances field definitions with content extracted using relative selectors
 * @param fields - Array of field definitions
 * @param page - Puppeteer page instance
 * @param mainSelector - The main selector to find on page
 * @returns - Array of enhanced field definitions
 */
export async function enhanceFieldsWithRelativeSelectorContent(
  fields: IOpenAIField[],
  page: any,
  mainSelector: string
): Promise<IOpenAIField[]> {
  if (!fields || fields.length === 0 || !page || !mainSelector) {
    console.log('Missing required parameters for enhanceFieldsWithRelativeSelectorContent');
    return fields;
  }

  const enhancedFields = [...fields];
  const mainElement = await page.$(mainSelector);
  if (!mainElement) {
    console.log(`Main selector "${mainSelector}" not found on page.`);
    return enhancedFields;
  }

  for (const field of enhancedFields) {
    if (field.relativeSelectorOptional) {
      console.log(`Processing field "${field.name}" with relative selector: ${field.relativeSelectorOptional}`);

      const content = await extractContentFromSelector(
        page,
        mainSelector,
        field.relativeSelectorOptional,
        field.extractionType || 'text',
        field.attributeName || ''
      );

      if (content && content.trim() !== '') {
        // For fields with href attribute extraction, set up for direct attribute return
        if (field.extractionType === 'attribute' && field.attributeName === 'href') {
          const instructionText = field.instructions || field.description || '';
          field.instructions = `${instructionText}\n\nThe value of the href attribute is: ${content.trim()}`;
          field.returnDirectAttribute = true;
          field.referenceContent = content.trim();
          console.log(`Enhanced href attribute field "${field.name}" with direct href: ${content.trim()}`);
        }
        // For links in field name but not set for attribute extraction
        else if ((field.name.toLowerCase().includes('link') || field.name.toLowerCase().includes('url')) &&
                 field.relativeSelectorOptional.toLowerCase() === 'a' &&
                 field.extractionType !== 'attribute') {
          // For fields named as links but not properly configured, try to extract href
          try {
            const hrefValue = await page.evaluate((mainSel: string, relSel: string) => {
              const mainEl = document.querySelector(mainSel);
              if (!mainEl) return '';

              const el = mainEl.querySelector(relSel);
              if (!el) return '';

              return el.getAttribute('href') || '';
            }, mainSelector, field.relativeSelectorOptional);

            if (hrefValue && hrefValue.trim() !== '') {
              const instructionText = field.instructions || field.description || '';
              field.instructions = `${instructionText}\n\nThe value of the href attribute is: ${hrefValue.trim()}`;
              field.returnDirectAttribute = true;
              field.referenceContent = hrefValue.trim();
              console.log(`Enhanced link field "${field.name}" with direct href: ${hrefValue.trim()}`);
              continue;
            }
          } catch (err) {
            console.log(`Error extracting direct href for field "${field.name}": ${(err as Error).message}`);
          }

          // Fallback to normal processing
          const instructionText = field.instructions || field.description || '';
          field.instructions = `${instructionText}\n\nUse this as reference: "${content.trim()}"`;
        }
        // For all other fields, just append the content as reference
        else {
          const instructionText = field.instructions || field.description || '';
          field.instructions = `${instructionText}\n\nUse this as reference: "${content.trim()}"`;
          console.log(`Enhanced field "${field.name}" with extracted content (${content.length} chars): "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}""`);
        }
      } else {
        console.log(`No content extracted for field "${field.name}" using selector: ${field.relativeSelectorOptional}`);
      }
    } else {
      // Check if this field already has href information in the instructions
      // This handles cases where the instructions already include "The value of the href attribute is: URL"
      if (field.instructions && field.instructions.includes('The value of the href attribute is:')) {
        console.log(`Field "${field.name}" already has href information in instructions`);

        // Extract the URL from the instructions - using a more robust regex
        // This regex will find URLs after "The value of the href attribute is:" until the end of the line or string
        const hrefMatch = field.instructions.match(/The value of the href attribute is:\s*((?:https?:\/\/|www\.)[^\s\n]+)/);

        if (hrefMatch && hrefMatch[1]) {
          const hrefValue = hrefMatch[1].trim();
          console.log(`Extracted href value from instructions: ${hrefValue}`);

          // Set the direct attribute flags
          field.returnDirectAttribute = true;
          field.referenceContent = hrefValue;
        } else {
          // Try an alternative regex for more complex URLs (with special characters)
          const alternativeMatch = field.instructions.match(/The value of the href attribute is:[\s\n]*(.*?)(?:[\n]|$)/);
          if (alternativeMatch && alternativeMatch[1]) {
            const hrefValue = alternativeMatch[1].trim();
            console.log(`Extracted complex href value from instructions: ${hrefValue}`);

            // Set the direct attribute flags
            field.returnDirectAttribute = true;
            field.referenceContent = hrefValue;
          } else {
            console.log(`Unable to extract href value from instructions for field "${field.name}"`);
          }
        }
      }
    }
  }

  return enhancedFields;
}
