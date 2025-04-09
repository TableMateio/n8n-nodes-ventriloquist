import type { IDataObject, Logger as ILogger } from "n8n-workflow";
import type { Browser, Page } from "puppeteer-core";
import { executeClickAction } from "../middlewares/actions/clickAction";
import type {
	IClickActionParameters,
	IClickActionOptions,
	IClickActionResult,
} from "./clickAction";
import { executeFillAction } from "../middlewares/actions/fillAction";
import type {
	IFillActionParameters,
	IFillActionOptions,
	IFillActionResult,
} from "../middlewares/actions/fillAction";
import { executeNavigateAction } from "../middlewares/actions/navigateAction";
import type {
	INavigateActionParameters,
	INavigateActionResult,
} from "../middlewares/actions/navigateAction";
import { SessionManager } from "../sessionManager";
import { getActivePage } from "../sessionUtils";
import {
	executeExtraction,
	type IExtractOptions,
} from "../middlewares/extractMiddleware";

/**
 * Action types supported by the action utilities
 */
export type ActionType = "click" | "fill" | "extract" | "navigate" | "none";

/**
 * Interface for general action parameters
 */
export interface IActionParameters {
	// Common parameters - each specialized action interface defines its specific parameters
	selector?: string;
	[key: string]: unknown;
}

/**
 * Interface for general action options
 */
export interface IActionOptions {
	nodeName: string;
	nodeId: string;
	index: number;
	waitForSelector?: boolean;
	selectorTimeout?: number;
	detectionMethod?: string;
	earlyExitDelay?: number;
	useHumanDelays?: boolean;
	sessionId: string;
}

/**
 * Interface for action results
 */
export interface IActionResult {
	success: boolean;
	actionType: ActionType | "error";
	details: IDataObject;
	error?: Error | string;
	contextDestroyed?: boolean;
	pageReconnected?: boolean;
	reconnectedPage?: Page;
}

/**
 * Execute an action based on its type
 * Refactored partially for click and fill actions
 */
export async function executeAction(
	sessionId: string,
	action: ActionType,
	parameters: IActionParameters,
	options: IActionOptions,
	logger: ILogger,
): Promise<IActionResult> {
	const logPrefix = `[ActionUtils][${options.nodeName}#${options.index}]`;
	logger.debug(
		`${logPrefix} Starting action: ${action} for session: ${sessionId}`,
	);

	let browser: Browser | null = null;
	let page: Page | null = null;

	try {
		// --- Get Session and Active Page --- //
		const session = SessionManager.getSession(sessionId);
		if (!session?.browser?.isConnected()) {
			throw new Error(`Invalid or disconnected browser session: ${sessionId}`);
		}
		browser = session.browser;

		page = await getActivePage(browser, logger);
		if (!page) {
			throw new Error(`No active page found for session: ${sessionId}`);
		}
		logger.debug(`${logPrefix} Successfully obtained active page.`);

		// --- Execute Action --- //
		switch (action) {
			case "click": {
				const clickParams: IClickActionParameters = {
					selector: parameters.selector || "",
					waitAfterAction: (parameters.waitAfterAction ?? "noWait") as string,
					waitTime: parameters.waitTime as number | undefined,
					waitSelector: parameters.waitSelector as string | undefined,
				};
				const clickOptions: IClickActionOptions = {
					sessionId: options.sessionId,
					nodeName: options.nodeName,
					nodeId: options.nodeId,
					index: options.index,
					selectorTimeout: options.selectorTimeout,
				};
				const result: IClickActionResult = await executeClickAction(
					page,
					clickParams,
					clickOptions,
					logger,
				);
				return {
					success: result.success,
					actionType: "click",
					details: result.details,
					error: result.error,
					contextDestroyed: result.details?.contextDestroyed === true,
				};
			}

			case "fill": {
				const fillParams: IFillActionParameters = {
					selector: parameters.selector || "",
					value: parameters.value as string | undefined,
					fieldType: parameters.fieldType as string | undefined,
					clearField: parameters.clearField === true,
					pressEnter: parameters.pressEnter === true,
					checkState: parameters.checkState as string | undefined,
					checked: parameters.checked !== false,
					filePath: parameters.filePath as string | undefined,
				};
				const fillOptions: IFillActionOptions = {
					nodeName: options.nodeName,
					nodeId: options.nodeId,
					index: options.index,
					useHumanDelays:
						typeof options.useHumanDelays === "boolean"
							? options.useHumanDelays
							: typeof parameters.humanLike === "boolean"
								? parameters.humanLike
								: true,
					sessionId: options.sessionId,
				};
				const result: IFillActionResult = await executeFillAction(
					page,
					fillParams,
					fillOptions,
					logger,
				);
				return {
					success: result.success,
					actionType: "fill",
					details: result.details,
					error: result.error,
					contextDestroyed: result.details?.contextDestroyed === true,
				};
			}

			case "navigate": {
				const navigateParams: INavigateActionParameters = {
					page: page,
					url: parameters.url as string,
					waitUntil: parameters.waitUntil as
						| "load"
						| "domcontentloaded"
						| "networkidle0"
						| "networkidle2"
						| undefined,
					waitTime: parameters.waitTime as number | undefined,
					detectUrlChangeType: parameters.detectUrlChangeType as
						| string
						| undefined,
					referer: parameters.referer as string | undefined,
					headers: parameters.headers as Record<string, string> | undefined,
					nodeName: options.nodeName,
					nodeId: options.nodeId,
					index: options.index,
					logger: logger,
					timeout: parameters.timeout as number | undefined,
				};

				const result: INavigateActionResult =
					await executeNavigateAction(navigateParams);
				return {
					success: result.success,
					actionType: "navigate",
					details: {
						...result.details,
						...(result.contextDestroyed !== undefined && {
							contextDestroyed: result.contextDestroyed,
						}),
						...(result.pageReconnected !== undefined && {
							pageReconnected: result.pageReconnected,
						}),
						...(result.urlChanged !== undefined && {
							urlChanged: result.urlChanged,
						}),
					},
					error: result.error,
				};
			}

			case "extract": {
				const extractOptions: IExtractOptions = {
					extractionType: parameters.extractionType as string,
					selector: parameters.selector as string,
					attributeName: parameters.attributeName as string | undefined,
					outputFormat: parameters.outputFormat as string | undefined,
					includeMetadata: parameters.includeMetadata as boolean | undefined,
					includeHeaders: parameters.includeHeaders as boolean | undefined,
					rowSelector: parameters.rowSelector as string | undefined,
					cellSelector: parameters.cellSelector as string | undefined,
					extractionProperty: parameters.extractionProperty as
						| string
						| undefined,
					limit: parameters.limit as number | undefined,
					separator: parameters.separator as string | undefined,
					waitForSelector: options.waitForSelector,
					selectorTimeout: options.selectorTimeout,
					detectionMethod: options.detectionMethod,
					earlyExitDelay: options.earlyExitDelay,
					nodeName: options.nodeName,
					nodeId: options.nodeId,
					index: options.index,
				};

				const result = await executeExtraction(page, extractOptions, logger);
				return {
					success: result.success,
					actionType: "extract",
					details: {
						data: result.data,
						...result.details,
					},
					error: result.error,
				};
			}

			case "none": {
				return {
					success: true,
					actionType: "none",
					details: { info: "No action performed" },
				};
			}

			default: {
				const errorMsg = `Unsupported action type: ${action}`;
				logger.error(`${logPrefix} ${errorMsg}`);
				return {
					success: false,
					actionType: "error",
					details: { error: errorMsg },
					error: errorMsg,
				};
			}
		}
	} catch (error) {
		const errorMessage = (error as Error).message;
		logger.error(
			`[ActionUtils] Unhandled error in executeAction: ${errorMessage}`,
		);
		return {
			success: false,
			actionType: "error",
			details: { error: errorMessage },
			error: error as Error,
		};
	}
}
