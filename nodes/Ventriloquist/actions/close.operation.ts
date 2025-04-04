import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { SessionManager } from '../utils/sessionManager';

/**
 * Close operation description
 */
export const description: INodeProperties[] = [
	{
		displayName: 'Close Mode',
		name: 'closeMode',
		type: 'options',
		options: [
			{
				name: 'Close Session',
				value: 'session',
				description: 'Close a specific browser session',
			},
			{
				name: 'Close All Sessions',
				value: 'all',
				description: 'Close all browser sessions',
			},
			{
				name: 'Close Multiple Sessions',
				value: 'multiple',
				description: 'Close a list of specific browser sessions',
			},
		],
		default: 'session',
		description: 'How to close browser sessions',
		displayOptions: {
			show: {
				operation: ['close'],
			},
		},
	},
	{
		displayName: 'Session ID',
		name: 'explicitSessionId',
		type: 'string',
		default: '',
		description: 'Session ID to close',
		displayOptions: {
			show: {
				operation: ['close'],
				closeMode: ['session'],
			},
		},
	},
	{
		displayName: 'Session IDs',
		name: 'sessionIds',
		type: 'string',
		typeOptions: {
			multipleValues: true,
		},
		default: [],
		description: 'List of session IDs to close',
		displayOptions: {
			show: {
				operation: ['close'],
				closeMode: ['multiple'],
			},
		},
	},
	{
		displayName: 'Continue On Fail',
		name: 'continueOnFail',
		type: 'boolean',
		default: true,
		description: 'Whether to continue execution even when close operations fail',
		displayOptions: {
			show: {
				operation: ['close'],
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

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;
	this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Close] ========== START CLOSE NODE EXECUTION ==========`);

	// Get input item
	const item = this.getInputData()[index];

	// Get parameters
	const closeMode = this.getNodeParameter('closeMode', index, 'session') as string;
	const continueOnFail = this.getNodeParameter('continueOnFail', index, true) as boolean;

	try {
		if (closeMode === 'session') {
			// Close a specific session
			let sessionId = '';

			// First, check if an explicit session ID was provided
			const explicitSessionId = this.getNodeParameter('explicitSessionId', index, '') as string;
			if (explicitSessionId) {
				sessionId = explicitSessionId;
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Close] Using explicitly provided session ID: ${sessionId}`);
			}
			// If not, try to get sessionId from the current item
			if (!sessionId && item.json?.sessionId) {
				sessionId = item.json.sessionId as string;
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Close] Using sessionId from input data: ${sessionId}`);
			}
			// For backward compatibility, also check for pageId
			if (!sessionId && item.json?.pageId) {
				sessionId = item.json.pageId as string;
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Close] Using legacy pageId as sessionId for compatibility: ${sessionId}`);
			}

			// If we found a sessionId, close it
			if (sessionId) {
				try {
					// Check if the session exists first
					if (await SessionManager.isSessionActive(sessionId)) {
						// Try to close any pages associated with this session first
						const page = SessionManager.getPage(sessionId);
						if (page) {
							try {
								await page.close();
								this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Close] Closed page for session ID: ${sessionId}`);
							} catch (pageError) {
								this.logger.warn(`[Ventriloquist][${nodeName}][${nodeId}][Close] Error closing page: ${(pageError as Error).message}, continuing to close session`);
							}
						}

						// Then close the full session
						const result = await SessionManager.closeSessions(this.logger, { sessionId });
						this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Close] Session closed successfully: ${sessionId} (${result.closed} of ${result.total})`);
					} else {
						this.logger.warn(`[Ventriloquist][${nodeName}][${nodeId}][Close] Session ID not found or not active: ${sessionId}`);
					}
				} catch (error) {
					// If an error occurs, but we still want to continue
					if (continueOnFail) {
						this.logger.error(`[Ventriloquist][${nodeName}][${nodeId}][Close] Error closing session ${sessionId}: ${(error as Error).message}`);
					} else {
						throw error;
					}
				}

				// Return success
				const executionDuration = Date.now() - startTime;
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Close] Completed execution in ${executionDuration}ms`);
				this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Close] ========== END CLOSE NODE EXECUTION ==========`);

				return {
					json: {
						...item.json, // Pass through input data
						success: true,
						operation: 'close',
						closeMode,
						sessionId,
						message: `Browser session ${sessionId} closed successfully`,
						timestamp: new Date().toISOString(),
						executionDuration,
					},
				};
			} else {
				// No session ID found
				throw new Error('No session ID provided or found in input');
			}
		} else if (closeMode === 'all') {
			// Close all browser sessions
			const result = await SessionManager.closeSessions(this.logger, { all: true });

			// Return success with details
			const executionDuration = Date.now() - startTime;
			this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Close] Closed ${result.closed} of ${result.total} browser sessions`);
			this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Close] Completed execution in ${executionDuration}ms`);
			this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Close] ========== END CLOSE NODE EXECUTION ==========`);

			return {
				json: {
					...item.json, // Pass through input data
					success: true,
					operation: 'close',
					closeMode,
					totalSessions: result.total,
					closedSessions: result.closed,
					message: `Closed ${result.closed} of ${result.total} browser sessions`,
					note: "This operation only closes sessions tracked by this N8N instance.",
					browserlessConsoleUrl: "https://cloud.browserless.io/dashboard",
					brightDataConsoleUrl: "https://brightdata.com/cp/zones",
					timestamp: new Date().toISOString(),
					executionDuration,
				},
			};
		} else if (closeMode === 'multiple') {
			// Close a list of specific sessions
			const sessionIds = this.getNodeParameter('sessionIds', index, []) as string[];
			const closedSessions: string[] = [];
			const failedSessions: string[] = [];

			// Process each session ID
			for (const sessionId of sessionIds) {
				try {
					// Check if the session exists and is active
					if (await SessionManager.isSessionActive(sessionId)) {
						// Try to close any pages associated with this session first
						const page = SessionManager.getPage(sessionId);
						if (page) {
							try {
								await page.close();
								this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Close] Closed page for session ID: ${sessionId}`);
							} catch (pageError) {
								this.logger.warn(`[Ventriloquist][${nodeName}][${nodeId}][Close] Error closing page: ${(pageError as Error).message}, continuing to close session`);
							}
						}

						// Then close the full session
						await SessionManager.closeSessions(this.logger, { sessionId });
						closedSessions.push(sessionId);
						this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Close] Closed session ID: ${sessionId}`);
					} else {
						failedSessions.push(sessionId);
						this.logger.warn(`[Ventriloquist][${nodeName}][${nodeId}][Close] Session ID not found or not active: ${sessionId}`);
					}
				} catch (error) {
					failedSessions.push(sessionId);
					this.logger.error(`[Ventriloquist][${nodeName}][${nodeId}][Close] Error closing session ${sessionId}: ${(error as Error).message}`);
				}
			}

			// Return result
			const executionDuration = Date.now() - startTime;
			this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Close] Closed ${closedSessions.length} of ${sessionIds.length} sessions successfully`);
			this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Close] Completed execution in ${executionDuration}ms`);
			this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Close] ========== END CLOSE NODE EXECUTION ==========`);

			return {
				json: {
					...item.json, // Pass through input data
					success: true,
					operation: 'close',
					closeMode,
					closedSessions,
					failedSessions,
					message: `Closed ${closedSessions.length} of ${sessionIds.length} sessions successfully`,
					timestamp: new Date().toISOString(),
					executionDuration,
				},
			};
		} else {
			// Invalid close mode
			throw new Error(`Invalid close mode: ${closeMode}`);
		}
	} catch (error) {
		// Handle errors based on continueOnFail setting
		const executionDuration = Date.now() - startTime;
		this.logger.error(`[Ventriloquist][${nodeName}][${nodeId}][Close] Error during execution: ${(error as Error).message}`);
		this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Close] ========== END CLOSE NODE EXECUTION (ERROR) ==========`);

		if (!continueOnFail) {
			// If continueOnFail is false, throw the error to fail the node
			throw new Error(`Close operation failed: ${(error as Error).message}`);
		}

		// Otherwise, return an error response and continue
		return {
			json: {
				...item.json, // Pass through input data
				success: false,
				operation: 'close',
				closeMode,
				error: (error as Error).message,
				timestamp: new Date().toISOString(),
				executionDuration,
			},
		};
	}
}
