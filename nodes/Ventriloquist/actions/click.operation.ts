import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from "n8n-workflow";
import type { Page } from "puppeteer-core";
import { robustClick, waitAndClick } from "../utils/clickOperations";
import { formatUrl, takeScreenshot } from "../utils/navigationUtils";
import { createErrorResponse } from "../utils/errorUtils";
import {
	createSuccessResponse,
	formatOperationLog,
	createTimingLog,
} from "../utils/resultUtils";
import { SessionManager } from "../utils/sessionManager";
import { getActivePage } from "../utils/sessionUtils";

/**
 * Helper function to wait for a specified time using page.evaluate
 * This replaces puppeteer's built-in waitForTimeout which may not be available in all versions
 */
async function waitForDuration(page: Page, duration: number): Promise<void> {
	await page.evaluate((ms) => new Promise(resolve => setTimeout(resolve, ms)), duration);
}

// Define the properties for the click operation
export const description: INodeProperties[] = [
	{
		displayName: "Session ID",
		name: "explicitSessionId",
		type: "string",
		default: "",
		description:
			"Session ID to use for this operation (leave empty to use ID from input or create new)",
	},
	{
		displayName: "Selector",
		name: "selector",
		type: "string",
		default: "",
		required: true,
		description: "CSS selector of the element to click",
	},
	{
		displayName: "Wait Before Click Selector",
		name: "waitBeforeClickSelector",
		type: "string",
		default: "",
		description:
			"Wait for this element to appear before attempting click (optional)",
	},
	{
		displayName: "Timeout",
		name: "timeout",
		type: "number",
		default: 30000,
		description: "Timeout in milliseconds",
	},
	{
		displayName: "Retries",
		name: "retries",
		type: "number",
		default: 0,
		description: "Number of retry attempts if click fails",
	},
	{
		displayName: "Capture Screenshot",
		name: "captureScreenshot",
		type: "boolean",
		default: true,
		description: "Whether to capture a screenshot after clicking",
	},
	{
		displayName: "Continue On Fail",
		name: "continueOnFail",
		type: "boolean",
		default: true,
		description: "Whether to continue execution even if the operation fails",
	},
	{
		displayName: "Wait After Action",
		name: "waitAfterAction",
		type: "options",
		options: [
			{
				name: "Quick Action (No Wait)",
				value: "quick",
				description: "Continue immediately after the action (default)",
			},
			{
				name: "Wait for Element",
				value: "element",
				description: "Wait for a specific element to appear after the action",
			},
			{
				name: "Wait for Navigation (Fast)",
				value: "navFast",
				description: "Wait for navigation using networkidle2 (good for SPAs)",
			},
			{
				name: "Wait for Page Load (Full)",
				value: "navFull",
				description: "Wait for navigation using networkidle0 (full page loads)",
			},
			{
				name: "Wait Fixed Time",
				value: "fixed",
				description: "Wait for a fixed duration after the action",
			},
		],
		default: "quick",
		description: "Strategy to wait for after the click action completes",
	},
	{
		displayName: "Wait Selector",
		name: "waitSelector",
		type: "string",
		default: "",
		description: "CSS selector of the element to wait for",
		displayOptions: {
			show: {
				waitAfterAction: ["element"],
			},
		},
		placeholder: "#new-element-id",
	},
	{
		displayName: "Wait Duration (ms)",
		name: "waitDuration",
		type: "number",
		default: 1000, // Default to 1 second
		description: "Time to wait in milliseconds",
		displayOptions: {
			show: {
				waitAfterAction: ["fixed"],
			},
		},
		typeOptions: {
			minValue: 0,
		},
	},
];

/**
 * Execute the click operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	websocketEndpoint: string,
	workflowId: string,
): Promise<INodeExecutionData> {
	const startTime = Date.now();
	const items = this.getInputData();
	let sessionId = "";
	let page: Page | null = null;
	let error: Error | undefined;
	let success = false;

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;

	// Visual marker to clearly indicate a new node is starting
	this.logger.info("============ STARTING NODE EXECUTION ============");
	this.logger.info(
		formatOperationLog("Click", nodeName, nodeId, index, "Starting execution"),
	);

	// Operation parameters
	const selector = this.getNodeParameter("selector", index) as string;
	const waitBeforeClickSelector = this.getNodeParameter(
		"waitBeforeClickSelector",
		index,
		"",
	) as string;
	const explicitSessionId = this.getNodeParameter(
		"explicitSessionId",
		index,
		"",
	) as string;
	const timeout = this.getNodeParameter("timeout", index, 30000) as number;
	const retries = this.getNodeParameter("retries", index, 0) as number;
	const captureScreenshot = this.getNodeParameter(
		"captureScreenshot",
		index,
		true,
	) as boolean;
	const continueOnFail = this.getNodeParameter(
		"continueOnFail",
		index,
		true,
	) as boolean;
	const waitAfterAction = this.getNodeParameter(
		"waitAfterAction",
		index,
		"quick",
	) as string;
	const waitSelector = this.getNodeParameter("waitSelector", index, "") as string;
	const waitDuration = this.getNodeParameter("waitDuration", index, 1000) as number;

	try {
		// Use the centralized session management
		const sessionResult = await SessionManager.getOrCreatePageSession(
			this.logger,
			{
				explicitSessionId,
				websocketEndpoint,
				workflowId,
				operationName: "Click",
				nodeId,
				nodeName,
				index,
			},
		);
		sessionId = sessionResult.sessionId;
		page = sessionResult.page; // Keep the initial page reference from the result

		// If the initial page from sessionResult is null, try getting the active page now
		if (!page) {
			const currentSession = SessionManager.getSession(sessionId);
			if (currentSession?.browser?.isConnected()) {
				page = await getActivePage(currentSession.browser, this.logger);
			} else {
				throw new Error(
					"Failed to get session or browser is disconnected after getOrCreatePageSession",
				);
			}
		}

		if (!page) {
			throw new Error("Failed to get or create a page");
		}

		// Log current page info
		const pageUrl = await page.url();
		const pageTitle = await page.title();
		this.logger.info(
			formatOperationLog(
				"Click",
				nodeName,
				nodeId,
				index,
				`Current page URL: ${formatUrl(pageUrl)}, title: ${pageTitle}`,
			),
		);

		// Perform the click operation using the obtained active page
		if (waitBeforeClickSelector) {
			this.logger.info(
				formatOperationLog(
					"Click",
					nodeName,
					nodeId,
					index,
					`Waiting for selector "${waitBeforeClickSelector}" before clicking`,
				),
			);

			// Use the waitAndClick utility with the active page
			const clickResult = await waitAndClick(page, selector, {
				waitTimeout: timeout,
				retries,
				waitBetweenRetries: 1000,
				logger: this.logger,
			});

			success = clickResult.success;
			error = clickResult.error;
		} else {
			// Directly use the robustClick utility with the active page
			const clickResult = await robustClick(page, selector, {
				retries,
				waitBetweenRetries: 1000,
				logger: this.logger,
			});

			success = clickResult.success;
			error = clickResult.error;
		}

		// Wait After Action Logic
		if (success && waitAfterAction !== "quick") {
			this.logger.info(
				formatOperationLog(
					"Click",
					nodeName,
					nodeId,
					index,
					`Performing wait after action: ${waitAfterAction}`,
				),
			);

			try {
				let waitPromise: Promise<any> | null = null;

				switch (waitAfterAction) {
					case "element":
						if (!waitSelector) {
							throw new Error(
								'"Wait for Element" selected but no selector provided',
							);
						}
						this.logger.info(
							formatOperationLog(
								"Click",
								nodeName,
								nodeId,
								index,
								`Waiting for selector: ${waitSelector}`,
							),
						);
						waitPromise = page.waitForSelector(waitSelector, { timeout });
						break;
					case "navFast":
						this.logger.info(
							formatOperationLog(
								"Click",
								nodeName,
								nodeId,
								index,
								`Waiting for navigation (fast - networkidle2)`,
							),
						);
						// Note: waitForNavigation should ideally be combined with the action triggering it (like click)
						// Using it standalone might miss the navigation if it starts/finishes too quickly.
						// For click actions, Promise.all([page.waitForNavigation(), page.click()]) is better,
						// but we are implementing a simpler post-action wait here.
						waitPromise = page.waitForNavigation({ waitUntil: "networkidle2", timeout });
						break;
					case "navFull":
						this.logger.info(
							formatOperationLog(
								"Click",
								nodeName,
								nodeId,
								index,
								`Waiting for navigation (full - networkidle0)`,
							),
						);
						waitPromise = page.waitForNavigation({ waitUntil: "networkidle0", timeout });
						break;
					case "fixed":
						this.logger.info(
							formatOperationLog(
								"Click",
								nodeName,
								nodeId,
								index,
								`Waiting for fixed time: ${waitDuration}ms`,
							),
						);
						waitPromise = waitForDuration(page, waitDuration);
						break;
				}

				if (waitPromise) {
					await waitPromise;
					this.logger.info(
						formatOperationLog(
							"Click",
							nodeName,
							nodeId,
							index,
							`Wait after action (${waitAfterAction}) completed successfully.`,
						),
					);
				}
			} catch (waitError) {
				const waitErrorMessage = `Wait after action (${waitAfterAction}) failed: ${(waitError as Error).message}`;
				this.logger.warn(
					formatOperationLog(
						"Click",
						nodeName,
						nodeId,
						index,
						waitErrorMessage,
					),
				);
				if (!continueOnFail) {
					error = new Error(waitErrorMessage);
					success = false;
				}
			}
		}

		// Log timing information
		createTimingLog("Click", startTime, this.logger, nodeName, nodeId, index);

		// Get active page *again* after the click, in case navigation happened
		// (Note: clickOperations don't wait for navigation, so this might be the same page)
		let finalPage: Page | null = null;
		const currentSession = SessionManager.getSession(sessionId);
		if (currentSession?.browser?.isConnected()) {
			finalPage = await getActivePage(currentSession.browser, this.logger);
		}
		// Use finalPage for response/screenshot creation, fallback to original 'page' if needed
		const pageForResponse = finalPage || page;

		// Prepare the result
		if (success) {
			// Click operation successful
			const successResponse = await createSuccessResponse({
				operation: "click",
				sessionId,
				page: pageForResponse,
				logger: this.logger,
				startTime,
				takeScreenshot: captureScreenshot,
				selector,
				inputData: items[index].json,
			});

			return { json: successResponse };
		}

		// Click operation failed
		const errorMessage =
			error?.message || "Click operation failed for an unknown reason";

		if (!continueOnFail) {
			// If continueOnFail is false, throw the error to fail the node
			throw new Error(`Click operation failed: ${errorMessage}`);
		}

		// Otherwise, return an error response but continue execution
		const errorResponse = await createErrorResponse({
			error: errorMessage,
			operation: "click",
			sessionId,
			nodeId,
			nodeName,
			selector,
			page: pageForResponse,
			logger: this.logger,
			takeScreenshot: captureScreenshot,
			startTime,
			additionalData: items[index].json,
		});

		return { json: errorResponse };
	} catch (catchError) {
		// Attempt to get page for error screenshot if possible
		let errorPage: Page | null = page; // Use initially retrieved page if available
		if (!errorPage) {
			try {
				const currentSession = SessionManager.getSession(sessionId);
				if (currentSession?.browser?.isConnected()) {
					errorPage = await getActivePage(currentSession.browser, this.logger);
				}
			} catch (getPageError) {
				this.logger.warn(
					`Could not get page for error screenshot: ${(getPageError as Error).message}`,
				);
			}
		}

		// Use the standardized error response utility
		const errorResponse = await createErrorResponse({
			error: catchError as Error,
			operation: "click",
			sessionId,
			nodeId,
			nodeName,
			selector,
			page: errorPage,
			logger: this.logger,
			takeScreenshot: captureScreenshot,
			startTime,
			additionalData: {
				...items[index].json, // Pass through input data
			},
		});

		if (!continueOnFail) {
			throw catchError;
		}

		// Return error as response with continue on fail
		return {
			json: errorResponse,
		};
	}
}
