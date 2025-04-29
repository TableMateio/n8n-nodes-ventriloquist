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

      // Check if this field is looking for an href attribute specifically
      // Either from explicit extractionType/attributeName or field name containing 'link'/'url' with anchor selector
      const isLookingForHref =
        (field.extractionType === 'attribute' && field.attributeName === 'href') ||
        ((field.name.toLowerCase().includes('link') || field.name.toLowerCase().includes('url')) &&
          field.relativeSelectorOptional.toLowerCase() === 'a');

      // If looking for href, make sure to extract it properly
      if (isLookingForHref) {
        console.log(`Field "${field.name}" is configured for href extraction`);

        try {
          // Directly extract the href attribute
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
            console.log(`Enhanced href field "${field.name}" with direct href value: ${hrefValue.trim()}`);
            continue; // Skip regular content extraction
          } else {
            console.log(`No href attribute found for field "${field.name}" using selector: ${field.relativeSelectorOptional}`);
          }
        } catch (err) {
          console.error(`Error extracting href for field "${field.name}": ${(err as Error).message}`);
        }
      }

      // For all other cases or as a fallback, extract content normally
      const content = await extractContentFromSelector(
        page,
        mainSelector,
        field.relativeSelectorOptional,
        field.extractionType || 'text',
        field.attributeName || ''
      );

      if (content && content.trim() !== '') {
        // For fields extracting attributes (any attribute, not just href)
        if (field.extractionType === 'attribute' && field.attributeName) {
          const instructionText = field.instructions || field.description || '';
          // Set the instructions with the attribute value clearly marked
          field.instructions = `${instructionText}\n\nThe value of the ${field.attributeName} attribute is: ${content.trim()}`;
          // Set flags for direct attribute return
          field.returnDirectAttribute = true;
          field.referenceContent = content.trim();
          console.log(`Enhanced attribute field "${field.name}" with ${field.attributeName}: ${content.trim()}`);
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
      // Check if instructions already include attribute information
      // This pattern matches "The value of the [attribute] attribute is: [value]"
      if (field.instructions) {
        const attributeMatch = field.instructions.match(/The value of the ([a-zA-Z0-9_-]+) attribute is:\s*(.*?)(?:\n|$)/);
        if (attributeMatch && attributeMatch[1] && attributeMatch[2]) {
          const attributeName = attributeMatch[1];
          const attributeValue = attributeMatch[2].trim();

          console.log(`Field "${field.name}" has ${attributeName} information in instructions: ${attributeValue}`);

          // Set the direct attribute flags
          field.returnDirectAttribute = true;
          field.referenceContent = attributeValue;
        }
      }
    }
  }

  return enhancedFields;
}
