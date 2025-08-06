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

/**
 * Search operation description
 */
export const description: INodeProperties[] = [
	{
		displayName: "Search Instructions",
		name: "searchInstructions",
		type: "string",
		typeOptions: {
			rows: 8,
		},
		default: "",
		placeholder: "Search for the latest news about artificial intelligence developments, focusing on recent breakthroughs in large language models and their applications in business automation.",
		description: "Detailed instructions for what you want to search for and analyze on the web",
		displayOptions: {
			show: {
				operation: ["search"],
			},
		},
	},
	{
		displayName: "Location",
		name: "location",
		type: "string",
		default: "Norwalk, Connecticut, USA",
		placeholder: "City, State, Country",
		description: "Location context for the search (affects local results and timezone)",
		displayOptions: {
			show: {
				operation: ["search"],
			},
		},
	},
	{
		displayName: "Max Tokens",
		name: "maxTokens",
		type: "number",
		default: 4000,
		description: "Maximum number of tokens for the response",
		displayOptions: {
			show: {
				operation: ["search"],
			},
		},
	},
	{
		displayName: "Temperature",
		name: "temperature",
		type: "number",
		typeOptions: {
			minValue: 0,
			maxValue: 2,
			numberPrecision: 2,
		},
		default: 0.3,
		description: "Controls randomness in the response (0 = focused, 2 = creative)",
		displayOptions: {
			show: {
				operation: ["search"],
			},
		},
	},
	{
		displayName: "Continue On Fail",
		name: "continueOnFail",
		type: "boolean",
		default: true,
		description: "Whether to continue execution even when search fails",
		displayOptions: {
			show: {
				operation: ["search"],
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
				operation: ["search"],
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
				operation: ["search"],
			},
		},
	},
];

/**
 * Execute search operation
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
	const searchInstructions = this.getNodeParameter("searchInstructions", index, "") as string;
	const location = this.getNodeParameter("location", index, "Norwalk, Connecticut, USA") as string;
	const maxTokens = this.getNodeParameter("maxTokens", index, 4000) as number;
	const temperature = this.getNodeParameter("temperature", index, 0.3) as number;
	const continueOnFail = this.getNodeParameter("continueOnFail", index, true) as boolean;
	const outputInputData = this.getNodeParameter("outputInputData", index, true) as boolean;
	const debugMode = this.getNodeParameter("debugMode", index, false) as boolean;

	// Get node information for logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;

	try {
		// Validate required parameters
		if (!searchInstructions || searchInstructions.trim() === "") {
			throw new Error("Search instructions are required");
		}

		if (!openAiApiKey) {
			throw new Error("OpenAI API key is required for search operations. Please configure OpenAI credentials.");
		}

		// Log operation start
		if (debugMode) {
			this.logger.debug(`Starting search operation with instructions: ${searchInstructions.substring(0, 100)}...`);
			this.logger.debug(`Location: ${location}`);
		}

		// Prepare the API request
		const requestBody = {
			model: "gpt-4o-search-preview",
			messages: [
				{
					role: "user",
					content: searchInstructions,
				},
			],
			max_tokens: maxTokens,
			temperature: temperature,
			web_search_options: {
				search_context_size: "medium",
				user_location: {
					type: "approximate",
					approximate: {
						city: location.split(',')[0]?.trim() || "Norwalk",
						region: location.split(',')[1]?.trim() || "Connecticut",
						country: location.split(',')[2]?.trim() || "USA",
						timezone: "America/New_York", // Default timezone for Connecticut
					},
				},
			},
		};

		// Make the API call to OpenAI
		const response = await fetch("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${openAiApiKey}`,
			},
			body: JSON.stringify(requestBody),
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error(`OpenAI API error: ${response.status} ${response.statusText}. ${errorData.error?.message || 'Unknown error'}`);
		}

		const apiResponse = await response.json();

		// Extract the search results
		const searchContent = apiResponse.choices?.[0]?.message?.content || "";
		const usage = apiResponse.usage || {};

		// Prepare the success response data
		const responseData: IDataObject = {
			status: "success",
			search_instructions: searchInstructions,
			location: location,
			search_results: searchContent,
			usage: {
				prompt_tokens: usage.prompt_tokens || 0,
				completion_tokens: usage.completion_tokens || 0,
				total_tokens: usage.total_tokens || 0,
			},
			model: "gpt-4o-search-preview",
			api_response_id: apiResponse.id || null,
		};

		// Log success
		this.logger.info(formatOperationLog(
			'search',
			nodeName,
			nodeId,
			index,
			`Search completed successfully - response length: ${searchContent.length}, tokens used: ${usage.total_tokens || 0}`
		));

		// Calculate execution duration
		const executionDuration = Date.now() - startTime;
		responseData.executionDuration = executionDuration;

		// Merge with input data if requested
		const finalResponse = outputInputData ?
			mergeInputWithOutput(inputData?.[0]?.json || {}, responseData) :
			responseData;

		// Return the success response
		return {
			json: finalResponse,
		};

	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

		// Log error
		this.logger.error(formatOperationLog(
			'search',
			nodeName,
			nodeId,
			index,
			`Search operation failed: ${errorMessage}`
		));

		// Prepare error response data
		const errorResponse = {
			status: "error",
			error: errorMessage,
			search_instructions: searchInstructions,
			location: location,
			executionDuration: Date.now() - startTime,
		};

		// Merge with input data if requested
		const finalErrorResponse = outputInputData ?
			mergeInputWithOutput(inputData?.[0]?.json || {}, errorResponse) :
			errorResponse;

		if (!continueOnFail) {
			throw error;
		}

		// Return error as response with continue on fail
		return {
			json: finalErrorResponse,
		};
	}
}
