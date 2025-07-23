import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from "n8n-workflow";
import type { Browser } from "puppeteer-core";
import { SessionManager } from "../utils/sessionManager";
import { getActivePage } from "../utils/sessionUtils";
import {
	formatOperationLog,
	createSuccessResponse,
	createTimingLog,
} from "../utils/resultUtils";
import { createErrorResponse } from "../utils/errorUtils";

/**
 * Close operation description
 */
export const description: INodeProperties[] = [
	{
		displayName: "Close Mode",
		name: "closeMode",
		type: "options",
		options: [
			{
				name: "Close Session",
				value: "session",
				description: "Close a specific browser session",
			},
			{
				name: "Close All Sessions",
				value: "all",
				description: "Close all browser sessions",
			},
			{
				name: "Close Multiple Sessions",
				value: "multiple",
				description: "Close a list of specific browser sessions",
			},
		],
		default: "session",
		description: "How to close browser sessions",
		displayOptions: {
			show: {
				operation: ["close"],
			},
		},
	},
	{
		displayName: "Session ID",
		name: "explicitSessionId",
		type: "string",
		default: "",
		description: "Session ID to close",
		displayOptions: {
			show: {
				operation: ["close"],
				closeMode: ["session"],
			},
		},
	},
	{
		displayName: "Session IDs",
		name: "sessionIds",
		type: "string",
		typeOptions: {
			multipleValues: true,
		},
		default: [],
		description: "List of session IDs to close",
		displayOptions: {
			show: {
				operation: ["close"],
				closeMode: ["multiple"],
			},
		},
	},
	{
		displayName: "Continue On Fail",
		name: "continueOnFail",
		type: "boolean",
		default: true,
		description:
			"Whether to continue execution even when close operations fail",
		displayOptions: {
			show: {
				operation: ["close"],
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
				operation: ["close"],
			},
		},
	},
];

/**
 * Execute the close operation to properly close browser sessions
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	websocketEndpoint: string,
	workflowId: string,
): Promise<INodeExecutionData> {
	const startTime = Date.now();
	const items = this.getInputData();
	const item = items[index];

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;

	// Visual marker to clearly indicate a new node is starting
	this.logger.info("============ STARTING NODE EXECUTION ============");
	this.logger.info(
		formatOperationLog("Close", nodeName, nodeId, index, "Starting execution"),
	);

	// Get parameters
	const closeMode = this.getNodeParameter(
		"closeMode",
		index,
		"session",
	) as string;
	const continueOnFail = this.getNodeParameter(
		"continueOnFail",
		index,
		true,
	) as boolean;
	const outputInputData = this.getNodeParameter(
		"outputInputData",
		index,
		true,
	) as boolean;

	try {
		if (closeMode === "session") {
			// Close a specific session
			let sessionId = "";

			// First, check if an explicit session ID was provided
			const explicitSessionId = this.getNodeParameter(
				"explicitSessionId",
				index,
				"",
			) as string;
			if (explicitSessionId) {
				sessionId = explicitSessionId;
				this.logger.info(
					formatOperationLog(
						"Close",
						nodeName,
						nodeId,
						index,
						`Using explicitly provided session ID: ${sessionId}`,
					),
				);
			}
			// If not, try to get sessionId from the current item
			if (!sessionId && item.json?.sessionId) {
				sessionId = item.json.sessionId as string;
				this.logger.info(
					formatOperationLog(
						"Close",
						nodeName,
						nodeId,
						index,
						`Using sessionId from input data: ${sessionId}`,
					),
				);
			}
			// For backward compatibility, also check for pageId
			if (!sessionId && item.json?.pageId) {
				sessionId = item.json.pageId as string;
				this.logger.info(
					formatOperationLog(
						"Close",
						nodeName,
						nodeId,
						index,
						`Using legacy pageId as sessionId for compatibility: ${sessionId}`,
					),
				);
			}

			// If we found a sessionId, close it
			if (sessionId) {
				try {
					// Check if the session exists first
					if (await SessionManager.isSessionActive(sessionId)) {
						// Try to close any pages associated with this session first
						const session = SessionManager.getSession(sessionId);
						let currentUrl = "unknown";
						let currentTitle = "unknown";

						if (session?.browser?.isConnected()) {
							const page = await getActivePage(
								session.browser as Browser,
								this.logger,
							);
							if (page) {
								try {
									// CAPTURE URL AND TITLE BEFORE CLOSING PAGE
									currentUrl = await page.url();
									currentTitle = await page.title();
									this.logger.info(
										formatOperationLog(
											"Close",
											nodeName,
											nodeId,
											index,
											`Captured page state before closing: URL="${currentUrl}", Title="${currentTitle}"`,
										),
									);

									await page.close();
									this.logger.info(
										formatOperationLog(
											"Close",
											nodeName,
											nodeId,
											index,
											`Closed page for session ID: ${sessionId}`,
										),
									);
								} catch (pageError) {
									this.logger.warn(
										formatOperationLog(
											"Close",
											nodeName,
											nodeId,
											index,
											`Error closing page: ${(pageError as Error).message}, continuing to close session`,
										),
									);
								}
							}
						} else {
							this.logger.warn(
								formatOperationLog(
									"Close",
									nodeName,
									nodeId,
									index,
									`Browser for session ${sessionId} is not connected, cannot close specific page.`,
								),
							);
						}

						// Then close the full session
						const result = await SessionManager.closeSessions(this.logger, {
							sessionId,
						});
						this.logger.info(
							formatOperationLog(
								"Close",
								nodeName,
								nodeId,
								index,
								`Session closed successfully: ${sessionId} (${result.closed} of ${result.total})`,
							),
						);

						// Log timing information
						createTimingLog(
							"Close",
							startTime,
							this.logger,
							nodeName,
							nodeId,
							index,
						);

						// Create success response with captured URL data
						const successResponse = await createSuccessResponse({
							operation: "close",
							sessionId,
							page: null, // Page is already closed
							logger: this.logger,
							startTime,
							additionalData: {
								closeMode,
								url: currentUrl, // Include captured URL
								title: currentTitle, // Include captured title
								message: `Browser session ${sessionId} closed successfully`,
							},
							inputData: outputInputData ? item.json : undefined,
						});

						return { json: successResponse };
					} else {
						this.logger.warn(
							formatOperationLog(
								"Close",
								nodeName,
								nodeId,
								index,
								`Session ID not found or not active: ${sessionId}`,
							),
						);
					}
				} catch (error) {
					// If an error occurs, but we still want to continue
					if (continueOnFail) {
						this.logger.error(
							formatOperationLog(
								"Close",
								nodeName,
								nodeId,
								index,
								`Error closing session ${sessionId}: ${(error as Error).message}`,
							),
						);
					} else {
						throw error;
					}
				}

				// Log timing information
				createTimingLog(
					"Close",
					startTime,
					this.logger,
					nodeName,
					nodeId,
					index,
				);

				// Create success response
				const successResponse = await createSuccessResponse({
					operation: "close",
					sessionId,
					page: null,
					logger: this.logger,
					startTime,
					additionalData: {
						closeMode,
						message: `Browser session ${sessionId} closed successfully`,
					},
					inputData: outputInputData ? item.json : undefined,
				});

				return { json: successResponse };
			}

			// No session ID found
			throw new Error("No session ID provided or found in input");
		}

		if (closeMode === "all") {
			// Close all browser sessions
			const result = await SessionManager.closeSessions(this.logger, {
				all: true,
			});

			// Log result
			this.logger.info(
				formatOperationLog(
					"Close",
					nodeName,
					nodeId,
					index,
					`Closed ${result.closed} of ${result.total} browser sessions`,
				),
			);

			// Log timing information
			createTimingLog("Close", startTime, this.logger, nodeName, nodeId, index);

			// Create success response
			const successResponse = await createSuccessResponse({
				operation: "close",
				sessionId: "",
				page: null,
				logger: this.logger,
				startTime,
				additionalData: {
					closeMode,
					url: "multiple-sessions-closed", // Indicate multiple sessions were closed
					title: "Close All Sessions",
					totalSessions: result.total,
					closedSessions: result.closed,
					message: `Closed ${result.closed} of ${result.total} browser sessions`,
					note: "This operation only closes sessions tracked by this N8N instance.",
					browserlessConsoleUrl: "https://cloud.browserless.io/dashboard",
					brightDataConsoleUrl: "https://brightdata.com/cp/zones",
				},
				inputData: outputInputData ? item.json : undefined,
			});

			return { json: successResponse };
		}

		if (closeMode === "multiple") {
			// Close a list of specific sessions
			const sessionIds = this.getNodeParameter(
				"sessionIds",
				index,
				[],
			) as string[];
			const closedSessions: string[] = [];
			const failedSessions: string[] = [];

			// Process each session ID
			for (const sessionId of sessionIds) {
				try {
					// Check if the session exists and is active
					if (await SessionManager.isSessionActive(sessionId)) {
						// Try to close any pages associated with this session first
						const session = SessionManager.getSession(sessionId);
						if (session?.browser?.isConnected()) {
							const page = await getActivePage(
								session.browser as Browser,
								this.logger,
							);
							if (page) {
								try {
									await page.close();
									this.logger.info(
										formatOperationLog(
											"Close",
											nodeName,
											nodeId,
											index,
											`Closed page for session ID: ${sessionId}`,
										),
									);
								} catch (pageError) {
									this.logger.warn(
										formatOperationLog(
											"Close",
											nodeName,
											nodeId,
											index,
											`Error closing page: ${(pageError as Error).message}, continuing to close session`,
										),
									);
								}
							}
						} else {
							this.logger.warn(
								formatOperationLog(
									"Close",
									nodeName,
									nodeId,
									index,
									`Browser for session ${sessionId} is not connected, cannot close specific page.`,
								),
							);
						}

						// Then close the full session
						await SessionManager.closeSessions(this.logger, { sessionId });
						closedSessions.push(sessionId);
						this.logger.info(
							formatOperationLog(
								"Close",
								nodeName,
								nodeId,
								index,
								`Closed session ID: ${sessionId}`,
							),
						);
					} else {
						failedSessions.push(sessionId);
						this.logger.warn(
							formatOperationLog(
								"Close",
								nodeName,
								nodeId,
								index,
								`Session ID not found or not active: ${sessionId}`,
							),
						);
					}
				} catch (error) {
					failedSessions.push(sessionId);
					this.logger.error(
						formatOperationLog(
							"Close",
							nodeName,
							nodeId,
							index,
							`Error closing session ${sessionId}: ${(error as Error).message}`,
						),
					);
				}
			}

			// Log result
			this.logger.info(
				formatOperationLog(
					"Close",
					nodeName,
					nodeId,
					index,
					`Closed ${closedSessions.length} of ${sessionIds.length} sessions successfully`,
				),
			);

			// Log timing information
			createTimingLog("Close", startTime, this.logger, nodeName, nodeId, index);

			// Create success response
			const successResponse = await createSuccessResponse({
				operation: "close",
				sessionId: "",
				page: null,
				logger: this.logger,
				startTime,
				additionalData: {
					closeMode,
					url: `multiple-sessions-closed-${closedSessions.length}`, // Indicate multiple sessions
					title: "Close Multiple Sessions",
					closedSessions,
					failedSessions,
					message: `Closed ${closedSessions.length} of ${sessionIds.length} sessions successfully`,
				},
				inputData: outputInputData ? item.json : undefined,
			});

			return { json: successResponse };
		}

		// Invalid close mode
		throw new Error(`Invalid close mode: ${closeMode}`);
	} catch (error) {
		// Use the standardized error response utility
		const errorResponse = await createErrorResponse({
			error: error as Error,
			operation: "close",
			sessionId: "",
			nodeId,
			nodeName,
			page: null,
			logger: this.logger,
			startTime,
			additionalData: {
				...item.json,
				closeMode,
			},
		});

		if (!continueOnFail) {
			throw error;
		}

		// Return error as response with continue on fail
		return {
			json: errorResponse,
		};
	}
}
