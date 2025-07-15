import type {
	IExecuteFunctions,
	INodeExecutionData,
	IDataObject,
	INodeProperties,
} from "n8n-workflow";
import { SessionManager } from "../utils/sessionManager";
import {
	formatOperationLog,
	createSuccessResponse,
} from "../utils/resultUtils";
import { createErrorResponse } from "../utils/errorUtils";

/**
 * Check operation description
 */
export const description: INodeProperties[] = [
	{
		displayName: "Session ID",
		name: "sessionId",
		type: "string",
		default: "",
		description:
			"Session ID to check (if not provided, will try to use session from previous operations)",
		displayOptions: {
			show: {
				operation: ["check"],
			},
		},
	},
	{
		displayName: "Output Input Data",
		name: "outputInputData",
		type: "boolean",
		default: true,
		description: "Whether to include input data from previous nodes in the response",
		displayOptions: {
			show: {
				operation: ["check"],
			},
		},
	},
	{
		displayName: "Take Screenshot",
		name: "takeScreenshot",
		type: "boolean",
		default: false,
		description: "Whether to capture a screenshot if session is active",
		displayOptions: {
			show: {
				operation: ["check"],
			},
		},
	},
];

/**
 * Execute the check operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	websocketEndpoint: string,
	workflowId: string,
): Promise<INodeExecutionData[][]> {
	const startTime = Date.now();
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;
	const item = this.getInputData()[index];

	// Get operation parameters
	const explicitSessionId = this.getNodeParameter("sessionId", index, "") as string;
	const outputInputData = this.getNodeParameter("outputInputData", index, false) as boolean;
	const takeScreenshot = this.getNodeParameter("takeScreenshot", index, false) as boolean;

	this.logger.info(
		formatOperationLog(
			"Check",
			nodeName,
			nodeId,
			index,
			`Starting session check operation`,
		),
	);

	// Determine session ID to check
	let sessionId = explicitSessionId;
	if (!sessionId) {
		// Try to get session ID from previous operations
		const inputData = this.getInputData()[index];
		if (inputData.json && inputData.json.sessionId) {
			sessionId = inputData.json.sessionId as string;
			this.logger.info(
				formatOperationLog(
					"Check",
					nodeName,
					nodeId,
					index,
					`Using session ID from previous operation: ${sessionId}`,
				),
			);
		}
	}

	// If still no session ID, return failure
	if (!sessionId) {
		this.logger.warn(
			formatOperationLog(
				"Check",
				nodeName,
				nodeId,
				index,
				`No session ID provided or found in previous operations`,
			),
		);

		const failureResponse = {
			success: false,
			operation: "check",
			sessionId: "",
			active: false,
			error: "No session ID provided or found in previous operations",
			timestamp: new Date().toISOString(),
			executionDuration: Date.now() - startTime,
			...(outputInputData && item.json ? item.json : {}),
		};

		// Return to failure output (index 1)
		return [
			[], // Success output (empty)
			[{ json: failureResponse, pairedItem: { item: index } }], // Failure output
		];
	}

	this.logger.info(
		formatOperationLog(
			"Check",
			nodeName,
			nodeId,
			index,
			`Checking session status for: ${sessionId}`,
		),
	);

	// Check if session is active
	const isActive = await SessionManager.isSessionActive(sessionId);

	if (isActive) {
		this.logger.info(
			formatOperationLog(
				"Check",
				nodeName,
				nodeId,
				index,
				`Session ${sessionId} is active and operational`,
			),
		);

		// Get session details for additional info
		const session = SessionManager.getSession(sessionId);
		let pageInfo = null;
		let screenshot = null;

		if (session && session.browser) {
			try {
				const pages = await session.browser.pages();
				pageInfo = {
					pageCount: pages.length,
					urls: pages.map(p => p.url()),
				};

				// Take screenshot if requested and we have pages
				if (takeScreenshot && pages.length > 0) {
					const activePage = pages[pages.length - 1];
					try {
						screenshot = await activePage.screenshot({
							encoding: 'base64',
							fullPage: false,
							type: 'png'
						});
					} catch (screenshotError) {
						this.logger.warn(
							formatOperationLog(
								"Check",
								nodeName,
								nodeId,
								index,
								`Failed to take screenshot: ${(screenshotError as Error).message}`,
							),
						);
					}
				}
			} catch (error) {
				this.logger.warn(
					formatOperationLog(
						"Check",
						nodeName,
						nodeId,
						index,
						`Error getting session details: ${(error as Error).message}`,
					),
				);
			}
		}

		const successResponse = {
			success: true,
			operation: "check",
			sessionId,
			active: true,
			pageInfo,
			...(screenshot && { screenshot }),
			timestamp: new Date().toISOString(),
			executionDuration: Date.now() - startTime,
			...(outputInputData && item.json ? item.json : {}),
		};

		// Return to success output (index 0)
		return [
			[{ json: successResponse, pairedItem: { item: index } }], // Success output
			[], // Failure output (empty)
		];
	} else {
		this.logger.info(
			formatOperationLog(
				"Check",
				nodeName,
				nodeId,
				index,
				`Session ${sessionId} is not active or not found`,
			),
		);

		const failureResponse = {
			success: false,
			operation: "check",
			sessionId,
			active: false,
			error: "Session not active or not found",
			timestamp: new Date().toISOString(),
			executionDuration: Date.now() - startTime,
			...(outputInputData && item.json ? item.json : {}),
		};

		// Return to failure output (index 1)
		return [
			[], // Success output (empty)
			[{ json: failureResponse, pairedItem: { item: index } }], // Failure output
		];
	}
}
