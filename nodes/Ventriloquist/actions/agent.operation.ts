import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeProperties,
} from "n8n-workflow";
import {
	formatOperationLog,
} from "../utils/resultUtils";
import { mergeInputWithOutput } from '../../../utils/utilities';
import { SessionManager } from '../utils/sessionManager';
import type { Page, Browser } from 'puppeteer-core';
import OpenAI from 'openai';

/**
 * Agent operation description - uses OpenAI's computer-use models with local Puppeteer execution
 */
export const description: INodeProperties[] = [
	{
		displayName: "Session Mode",
		name: "sessionMode",
		type: "options",
		options: [
			{
				name: "Use Existing Session",
				value: "existing",
				description: "Use an existing Ventriloquist browser session",
			},
			{
				name: "Standalone Session",
				value: "standalone",
				description: "Create a new browser session for this agent",
			},
		],
		default: "existing",
		description: "Whether to use an existing Ventriloquist session or create a standalone one",
		displayOptions: {
			show: {
				operation: ["agent"],
			},
		},
	},
	{
		displayName: "Session ID",
		name: "explicitSessionId",
		type: "string",
		default: "",
		description: "Session ID to use (leave empty to use ID from input or current workflow)",
		displayOptions: {
			show: {
				operation: ["agent"],
				sessionMode: ["existing"],
			},
		},
	},

	{
		displayName: "Agent Instructions",
		name: "agentInstructions",
		type: "string",
		typeOptions: {
			rows: 8,
		},
		default: "",
		placeholder: "e.g., 'Navigate to Amazon, search for wireless headphones, add the top result to cart'",
		description: "Detailed instructions for the agent to perform on the current page.",
		required: true,
		displayOptions: {
			show: {
				operation: ["agent"],
			},
		},
	},
	{
		displayName: "Starting Website URL",
		name: "websiteUrl",
		type: "string",
		default: "",
		placeholder: "https://example.com",
		description: "Starting URL for the standalone session. For existing sessions, the agent will work with the current page.",
		displayOptions: {
			show: {
				operation: ["agent"],
				sessionMode: ["standalone"],
			},
		},
	},
	{
		displayName: "Max Steps",
		name: "maxSteps",
		type: "number",
		default: 20,
		description: "Maximum number of actions the agent can take (safety limit)",
		displayOptions: {
			show: {
				operation: ["agent"],
			},
		},
	},
	{
		displayName: "Screenshot Mode",
		name: "screenshotMode",
		type: "options",
		options: [
			{
				name: "Final Screenshot",
				value: "final",
				description: "Return only the final screenshot in your response",
			},
			{
				name: "All Screenshots",
				value: "all",
				description: "Return screenshots from all steps in your response",
			},
			{
				name: "None",
				value: "none",
				description: "Don't include any screenshots in your response",
			},
		],
		default: "final",
		description: "What screenshots to include in YOUR response (AI always sees screenshots for decision-making)",
		displayOptions: {
			show: {
				operation: ["agent"],
			},
		},
	},
	{
		displayName: "Timeout (seconds)",
		name: "timeout",
		type: "number",
		default: 300,
		description: "Maximum time in seconds to wait for the agent to complete",
		displayOptions: {
			show: {
				operation: ["agent"],
			},
		},
	},
	{
		displayName: "Display Width",
		name: "displayWidth",
		type: "number",
		default: 1920,
		description: "Screen width for the virtual display (in pixels)",
		displayOptions: {
			show: {
				operation: ["agent"],
			},
		},
	},
	{
		displayName: "Display Height",
		name: "displayHeight",
		type: "number",
		default: 1080,
		description: "Screen height for the virtual display (in pixels)",
		displayOptions: {
			show: {
				operation: ["agent"],
			},
		},
	},
	{
		displayName: "Debug Mode",
		name: "debugMode",
		type: "boolean",
		default: false,
		description: "Enable debug mode for additional logging",
		displayOptions: {
			show: {
				operation: ["agent"],
			},
		},
	},
	{
		displayName: "Continue On Fail",
		name: "continueOnFail",
		type: "boolean",
		default: true,
		description: "Whether to continue execution even when the operation fails",
		displayOptions: {
			show: {
				operation: ["agent"],
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
				operation: ["agent"],
			},
		},
	},
];

/**
 * Computer use action interface
 */
interface ComputerAction {
	action: string;
	coordinate?: [number, number];
	text?: string;
	scroll_direction?: 'up' | 'down' | 'left' | 'right';
	scroll_amount?: number;
}

/**
 * Execute computer use action on a Puppeteer page
 */
async function executeComputerAction(
	page: Page,
	action: ComputerAction,
	logger: any
): Promise<string> {
	const { action: actionType, coordinate, text, scroll_direction, scroll_amount } = action;

	switch (actionType) {
		case 'screenshot':
			const screenshot = await page.screenshot({
				type: 'png',
				fullPage: false,
				encoding: 'base64'
			});
			return `data:image/png;base64,${screenshot}`;

		case 'left_click':
			if (coordinate) {
				await page.mouse.click(coordinate[0], coordinate[1]);
				logger.debug(`Clicked at coordinates [${coordinate[0]}, ${coordinate[1]}]`);
			}
			return "Click executed successfully";

		case 'type':
			if (text) {
				await page.keyboard.type(text);
				logger.debug(`Typed text: ${text.substring(0, 50)}...`);
			}
			return "Text typed successfully";

		case 'key':
			if (text) {
				await page.keyboard.press(text as any);
				logger.debug(`Pressed key: ${text}`);
			}
			return "Key pressed successfully";

		case 'scroll':
			if (coordinate && scroll_direction && scroll_amount) {
				const scrollDelta = scroll_amount * 100; // Convert to pixels
				const deltaY = scroll_direction === 'down' ? scrollDelta :
							   scroll_direction === 'up' ? -scrollDelta : 0;
				const deltaX = scroll_direction === 'right' ? scrollDelta :
							   scroll_direction === 'left' ? -scrollDelta : 0;

				await page.mouse.move(coordinate[0], coordinate[1]);
				await page.mouse.wheel({ deltaX, deltaY });
				logger.debug(`Scrolled ${scroll_direction} by ${scroll_amount} at [${coordinate[0]}, ${coordinate[1]}]`);
			}
			return "Scroll executed successfully";

		default:
			logger.warn(`Unsupported action: ${actionType}`);
			return `Unsupported action: ${actionType}`;
	}
}

/**
 * Execute agent operation using OpenAI's computer-use models with local Puppeteer execution
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	websocketEndpoint: string,
	workflowId: string,
	openAiApiKey?: string,
): Promise<INodeExecutionData> {
	const startTime = Date.now();
	const inputData = this.getInputData(index);

	// Get operation parameters
	const sessionMode = this.getNodeParameter("sessionMode", index, "existing") as string;
	const explicitSessionId = this.getNodeParameter("explicitSessionId", index, "") as string;
	const agentInstructions = this.getNodeParameter("agentInstructions", index, "") as string;
	const websiteUrl = this.getNodeParameter("websiteUrl", index, "") as string;
	const maxSteps = this.getNodeParameter("maxSteps", index, 20) as number;
	const screenshotMode = this.getNodeParameter("screenshotMode", index, "final") as string;
	const timeout = this.getNodeParameter("timeout", index, 300) as number;
	const displayWidth = this.getNodeParameter("displayWidth", index, 1920) as number;
	const displayHeight = this.getNodeParameter("displayHeight", index, 1080) as number;
	const continueOnFail = this.getNodeParameter("continueOnFail", index, true) as boolean;
	const outputInputData = this.getNodeParameter("outputInputData", index, true) as boolean;
	const debugMode = this.getNodeParameter("debugMode", index, false) as boolean;

	// Get node information for logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;

	try {
		// Validate required parameters
		if (!agentInstructions || agentInstructions.trim() === "") {
			throw new Error("Agent instructions are required");
		}

		if (!openAiApiKey) {
			throw new Error("OpenAI API key is required for agent operations. Please configure OpenAI credentials.");
		}

		if (sessionMode === "standalone" && (!websiteUrl || websiteUrl.trim() === "")) {
			throw new Error("Website URL is required for standalone sessions.");
		}

		// Log operation start
		if (debugMode) {
			this.logger.debug(`Starting agent operation with instructions: ${agentInstructions.substring(0, 100)}...`);
			this.logger.debug(`Session mode: ${sessionMode}`);
		}

		// Get or create browser session using SessionManager
		let sessionId: string;
		let page: Page;

		if (sessionMode === "existing") {
			// Use existing session - either explicit session ID or workflow ID
			sessionId = explicitSessionId || workflowId;
			const session = SessionManager.getSession(sessionId);
			if (!session?.browser?.isConnected()) {
				throw new Error(`No active browser session found for session: ${sessionId}. Use an 'Open' operation first.`);
			}
			const pages = await session.browser.pages();
			page = (pages.find(p => !p.isClosed()) || pages[0]) as any;
			if (!page || page.isClosed()) {
				throw new Error("No active page found in existing session");
			}
		} else {
			// Create standalone session
			const sessionResult = await SessionManager.getOrCreatePageSession(this.logger, {
				websocketEndpoint,
				workflowId: `agent-${Date.now()}`,
				operationName: 'agent',
				nodeId,
				nodeName,
				index,
			});
			sessionId = sessionResult.sessionId;
			const session = SessionManager.getSession(sessionId);
			if (!session?.browser) {
				throw new Error("Failed to create browser session");
			}
			page = await session.browser.newPage() as any;
			await page.setViewport({ width: displayWidth, height: displayHeight });

			// Navigate to starting URL
			if (websiteUrl) {
				await page.goto(websiteUrl, { waitUntil: 'networkidle0', timeout: 30000 });
			}
		}

		// Initialize OpenAI client
		const openai = new OpenAI({ apiKey: openAiApiKey });

		// Agent loop
		const allScreenshots: string[] = [];
		const actionsTaken: Array<{action: string, reasoning: string, status: string}> = [];
		let stepCount = 0;
		let messages: any[] = [];

		// Initial message with instructions and screenshot
		const initialScreenshot = await executeComputerAction(page, { action: 'screenshot' }, this.logger);
		allScreenshots.push(initialScreenshot);

		messages.push({
			role: "user",
			content: [
				{ type: "text", text: agentInstructions },
				{ type: "image_url", image_url: { url: initialScreenshot } }
			]
		});

		while (stepCount < maxSteps) {
			stepCount++;

			if (debugMode) {
				this.logger.debug(`Agent step ${stepCount}/${maxSteps}`);
			}

			// Call OpenAI o4-mini with function calling for computer decisions
			const response = await openai.chat.completions.create({
				model: "o4-mini", // OpenAI's reasoning model for computer use decisions
				max_tokens: 1024,
				messages,
				tools: [{
					type: "function",
					function: {
						name: "computer_action",
						description: "Perform a computer action on the current page",
						parameters: {
							type: "object",
							properties: {
								action: {
									type: "string",
									enum: ["screenshot", "left_click", "type", "key", "scroll"],
									description: "The action to perform"
								},
								coordinate: {
									type: "array",
									items: { type: "number" },
									description: "X,Y coordinates for click or scroll actions"
								},
								text: {
									type: "string",
									description: "Text to type or key to press"
								},
								scroll_direction: {
									type: "string",
									enum: ["up", "down", "left", "right"],
									description: "Direction to scroll"
								},
								scroll_amount: {
									type: "number",
									description: "Amount to scroll (1-5)"
								}
							},
							required: ["action"]
						}
					}
				}],
				tool_choice: "auto"
			});

			const message = response.choices[0]?.message;
			if (!message) {
				throw new Error("No response from OpenAI");
			}

			messages.push(message);

			// Check if the AI wants to use the computer tool
			if (message.tool_calls && message.tool_calls.length > 0) {
				for (const toolCall of message.tool_calls) {
					if (toolCall.function.name === "computer_action") {
						const actionParams = JSON.parse(toolCall.function.arguments);

						// Execute the action on our Puppeteer page
						const result = await executeComputerAction(page, actionParams, this.logger);

						actionsTaken.push({
							action: actionParams.action,
							reasoning: message.content || "",
							status: "completed"
						});

						// If it was a screenshot, add to our collection
						if (actionParams.action === 'screenshot' && screenshotMode !== "none") {
							allScreenshots.push(result);
						}

						// Send tool result back to AI
						if (actionParams.action === 'screenshot') {
							// For screenshots, send back the image
							messages.push({
								role: "user",
								content: [
									{ type: "text", text: "Screenshot taken successfully. What's next?" },
									{ type: "image_url", image_url: { url: result } }
								]
							});
						} else {
							// For other actions, send back text result
							messages.push({
								role: "tool",
								tool_call_id: toolCall.id,
								content: result
							});
						}
					}
				}
			} else {
				// No more tool calls, task is complete
				break;
			}
		}

		// Prepare response data
		const responseData: IDataObject = {
			status: "success",
			session_id: sessionId,
			session_mode: sessionMode,
			final_message: messages[messages.length - 1]?.content || "",
			actions_taken: actionsTaken,
			steps_taken: stepCount,
			model: "o4-mini",
			executionDuration: Date.now() - startTime,
		};

		// Add screenshots based on mode
		if (screenshotMode === "final" && allScreenshots.length > 0) {
			responseData.screenshot = allScreenshots[allScreenshots.length - 1];
		} else if (screenshotMode === "all" && allScreenshots.length > 0) {
			responseData.screenshots = allScreenshots;
		}

		// Log success
		this.logger.info(formatOperationLog(
			'agent',
			nodeName,
			nodeId,
			index,
			`Agent completed successfully - ${actionsTaken.length} actions taken in ${stepCount} steps`
		));

		// Return final response
		const finalResponse = outputInputData ?
			mergeInputWithOutput(inputData?.[0]?.json || {}, responseData) :
			responseData;

		return { json: finalResponse };

	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

		this.logger.error(formatOperationLog(
			'agent',
			nodeName,
			nodeId,
			index,
			`Agent operation failed: ${errorMessage}`
		));

		const errorResponse = {
			status: "error",
			error: errorMessage,
			agent_instructions: agentInstructions,
			session_mode: sessionMode,
			website_url: websiteUrl,
			executionDuration: Date.now() - startTime,
		};

		const finalErrorResponse = outputInputData ?
			mergeInputWithOutput(inputData?.[0]?.json || {}, errorResponse) :
			errorResponse;

		if (!continueOnFail) {
			throw error;
		}

		return { json: finalErrorResponse };
	}
}
