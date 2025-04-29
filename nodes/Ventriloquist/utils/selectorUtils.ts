/**
 * Utilities for working with CSS selectors
 */
import type { Page, ElementHandle } from 'puppeteer-core';
import type { Logger as ILogger } from 'n8n-workflow';

/**
 * Generates a unique CSS selector for a specific element
 * This creates a selector that should match only this specific element
 */
export async function generateUniqueSelector(
    page: Page,
    element: ElementHandle<Element>,
    logger?: ILogger
): Promise<string> {
    try {
        // Try to generate a specific selector using the page's internal API
        return await page.evaluate((el) => {
            /**
             * Helper to escape CSS identifiers
             */
            const escapeCssIdentifier = (str: string): string => {
                return str.replace(/[\s!"#$%&'()*+,./;<=>?@[\\\]^`{|}~]/g, '\\$&');
            };

            /**
             * Generate a path from element to ancestor using CSS selectors
             */
            const getElementPath = (element: Element, maxAncestors = 4): string => {
                const path: string[] = [];
                let current: Element | null = element;
                let index = 0;

                // Build path from element up to document body or the max ancestor limit
                while (current && current !== document.body && index < maxAncestors) {
                    // Create a specific selector for this element
                    let selector = current.tagName.toLowerCase();

                    // Add id if available (most specific)
                    if (current.id) {
                        selector += '#' + escapeCssIdentifier(current.id);
                        // ID should be unique, so we can return right away
                        path.unshift(selector);
                        return path.join(' > ');
                    }

                    // Add classes if available
                    const classes = Array.from(current.classList).filter(c =>
                        // Filter out dynamic or utility classes
                        !c.match(/^(js-|hover:|focus:|active:|disabled:|enabled:|selected:|checked:|unchecked:|visible:|hidden:|data-v-|react-|ng-|v-|[0-9a-f]{8,})/) &&
                        // Avoid classes that probably contain dynamic data
                        !c.match(/\d{4,}|guid|uuid|hash/)
                    );

                    if (classes.length > 0) {
                        selector += '.' + classes.map(escapeCssIdentifier).join('.');
                    }

                    // Add position among siblings for more specificity
                    const parent = current.parentElement;
                    if (parent) {
                        const siblings = Array.from(parent.children).filter(
                            child => child.tagName === current?.tagName
                        );
                        if (siblings.length > 1) {
                            const position = siblings.indexOf(current) + 1;
                            selector += `:nth-of-type(${position})`;
                        }
                    }

                    // Add to path and move up to parent
                    path.unshift(selector);
                    current = current.parentElement;
                    index++;
                }

                return path.join(' > ');
            };

            /**
             * Test if selector uniquely identifies the element
             */
            const isSelectorUnique = (selector: string, element: Element): boolean => {
                try {
                    const matches = document.querySelectorAll(selector);
                    return matches.length === 1 && matches[0] === element;
                } catch {
                    return false; // Invalid selector
                }
            };

            // Start with a simple path
            let selector = getElementPath(el);

            // Test if it's unique
            if (isSelectorUnique(selector, el)) {
                return selector;
            }

            // If not unique, try a more specific approach with full path to body
            selector = getElementPath(el, 10);

            // Test again
            if (isSelectorUnique(selector, el)) {
                return selector;
            }

            // If still not unique, add attributes like name, type, etc.
            if (el instanceof HTMLElement) {
                // Get all non-empty attributes that might help identify the element
                const attrMap: {[key: string]: string} = {};
                const usefulAttrs = ['name', 'type', 'role', 'data-testid', 'data-id', 'data-cy', 'data-test', 'aria-label'];

                for (const attr of usefulAttrs) {
                    const value = el.getAttribute(attr);
                    if (value) {
                        attrMap[attr] = value;
                    }
                }

                // Add most useful attributes to the selector
                for (const [attr, value] of Object.entries(attrMap)) {
                    const attrSelector = `${selector}[${attr}="${escapeCssIdentifier(value)}"]`;
                    if (isSelectorUnique(attrSelector, el)) {
                        return attrSelector;
                    }
                }

                // If we have attributes but still not unique, try combining them
                if (Object.keys(attrMap).length > 1) {
                    let combinedSelector = selector;
                    for (const [attr, value] of Object.entries(attrMap)) {
                        combinedSelector += `[${attr}="${escapeCssIdentifier(value)}"]`;
                    }

                    if (isSelectorUnique(combinedSelector, el)) {
                        return combinedSelector;
                    }
                }
            }

            // Last resort: full path with nth-child for maximum specificity
            let current: Element | null = el;
            const fullPath: string[] = [];

            while (current && current !== document.body) {
                let selector = current.tagName.toLowerCase();

                // Add id if available
                if (current.id) {
                    selector += '#' + escapeCssIdentifier(current.id);
                    fullPath.unshift(selector);
                    break; // ID should be unique in document
                }

                // Add any classes
                if (current.classList.length > 0) {
                    selector += '.' + Array.from(current.classList)
                        .map(escapeCssIdentifier)
                        .join('.');
                }

                // Add nth-child for maximum specificity
                const parent = current.parentElement;
                if (parent) {
                    const position = Array.from(parent.children).indexOf(current) + 1;
                    selector += `:nth-child(${position})`;
                }

                fullPath.unshift(selector);
                current = current.parentElement;
            }

            return fullPath.join(' > ');
        }, element);
    } catch (error) {
        if (logger) {
            logger.warn(`Error generating unique selector: ${(error as Error).message}`);
        }

        // Fallback to simpler approach
        return await fallbackGenerateSelector(page, element, logger);
    }
}

/**
 * Fallback method to generate a selector if the primary method fails
 */
async function fallbackGenerateSelector(
    page: Page,
    element: ElementHandle<Element>,
    logger?: ILogger
): Promise<string> {
    try {
        return await page.evaluate((el) => {
            const getPath = (element: Element): string => {
                if (!element.parentElement) {
                    return element.tagName.toLowerCase();
                }

                const index = Array.from(element.parentElement.children)
                    .filter(child => child.tagName === element.tagName)
                    .indexOf(element) + 1;

                return `${getPath(element.parentElement)} > ${element.tagName.toLowerCase()}:nth-child(${index})`;
            };

            return getPath(el);
        }, element);
    } catch (error) {
        if (logger) {
            logger.warn(`Fallback selector generation failed: ${(error as Error).message}`);
        }

        // Ultimate fallback
        return "body";
    }
}
