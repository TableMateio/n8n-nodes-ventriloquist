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
		displayName: 'Session ID',
		name: 'explicitSessionId',
		type: 'string',
		default: '',
		description: 'Session ID to close. Leave blank to close all sessions',
		displayOptions: {
			show: {
				operation: ['close'],
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
	const continueOnFail = this.getNodeParameter('continueOnFail', index, true) as boolean;

	try {
		// Get session ID (if provided)
		let sessionId = '';

		// First, check if an explicit session ID was provided
		const explicitSessionId = this.getNodeParameter('explicitSessionId', index, '') as string;
		if (explicitSessionId) {
			sessionId = explicitSessionId;
			this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Close] Using explicitly provided session ID: ${sessionId}`);
		}
		// If not, try to get sessionId from the current item
		else if (item.json?.sessionId) {
			sessionId = item.json.sessionId as string;
			this.logger.info(`[Ventriloquist][${nodeName}][${nodeId}][Close] Using sessionId from input data: ${sessionId}`);
		}
		// For backward compatibility, also check for pageId
		else if (item.json?.pageId) {
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
					sessionId,
					message: `Browser session ${sessionId} closed successfully`,
					timestamp: new Date().toISOString(),
					executionDuration,
				},
			};
		} else {
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
					totalSessions: result.total,
					closedSessions: result.closed,
					message: `Closed ${result.closed} of ${result.total} browser sessions`,
					timestamp: new Date().toISOString(),
					executionDuration,
				},
			};
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
				error: (error as Error).message,
				timestamp: new Date().toISOString(),
				executionDuration,
			},
		};
	}
}
