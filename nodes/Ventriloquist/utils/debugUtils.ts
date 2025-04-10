import type { Logger as ILogger } from 'n8n-workflow';
import type { Page } from 'puppeteer-core';
import { formatOperationLog } from './resultUtils';
import { getPageInfo } from './extractionUtils';

/**
 * Interface for page info with body text
 */
export interface IPageInfo {
  url: string;
  title: string;
  bodyText: string;
}

/**
 * Debug options for logging page information
 */
export interface IDebugOptions {
  previewLength?: number;
  includeBodyText?: boolean;
  includeUrl?: boolean;
  includeTitle?: boolean;
}

/**
 * Log debug information about a page
 */
export async function logPageDebugInfo(
  page: Page,
  logger: ILogger,
  context: {
    operation: string;
    nodeName: string;
    nodeId: string;
    index: number;
  },
  options: IDebugOptions = {}
): Promise<IPageInfo> {
  const {
    operation,
    nodeName,
    nodeId,
    index
  } = context;

  const {
    previewLength = 200,
    includeBodyText = true,
    includeUrl = true,
    includeTitle = true
  } = options;

  try {
    // Get base page info
    const pageInfo = await getPageInfo(page) as IPageInfo;

    // Get body text if requested
    if (includeBodyText) {
      pageInfo.bodyText = await page.evaluate(
        (len) => document.body?.innerText?.substring(0, len) + '...' || '(No text found)',
        previewLength
      );
    }

    // Log info based on configured options
    if (includeUrl || includeTitle) {
      const pageDetails = [];
      if (includeUrl) pageDetails.push(`URL=${pageInfo.url}`);
      if (includeTitle) pageDetails.push(`title=${pageInfo.title}`);

      logger.info(
        formatOperationLog(
          operation,
          nodeName,
          nodeId,
          index,
          `Page info: ${pageDetails.join(', ')}`
        )
      );
    }

    // Log body preview if requested
    if (includeBodyText) {
      logger.info(
        formatOperationLog(
          operation,
          nodeName,
          nodeId,
          index,
          `Page body preview: ${pageInfo.bodyText}`
        )
      );
    }

    return pageInfo;
  } catch (error) {
    logger.warn(
      formatOperationLog(
        operation,
        nodeName,
        nodeId,
        index,
        `Error getting page info for debug: ${(error as Error).message}`
      )
    );

    return {
      url: 'Error retrieving URL',
      title: 'Error retrieving title',
      bodyText: 'Error retrieving body text'
    };
  }
}
