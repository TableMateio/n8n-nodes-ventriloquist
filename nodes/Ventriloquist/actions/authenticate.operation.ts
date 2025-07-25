import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import * as speakeasy from 'speakeasy';
import { formatOperationLog, createSuccessResponse, createTimingLog } from '../utils/resultUtils';
import { createErrorResponse } from '../utils/errorUtils';
import { SessionManager } from '../utils/sessionManager';
import { mergeInputWithOutput } from '../../../utils/utilities';

/**
 * Authenticate operation description
 */
export const description: INodeProperties[] = [
	{
		displayName: 'Session ID',
		name: 'explicitSessionId',
		type: 'string',
		default: '',
		description: 'Session ID to use (if not provided, will try to use session from previous operations)',
		displayOptions: {
			show: {
				operation: ['authenticate'],
			},
		},
	},
	{
		displayName: 'Authentication Type',
		name: 'authenticationType',
		type: 'options',
		options: [
			{
				name: 'TOTP (Time-Based One-Time Password)',
				value: 'totp',
				description: 'Generate and use a time-based one-time password (e.g., Google Authenticator)',
			},
			// Future authentication types can be added here
			// {
			//   name: 'CAPTCHA',
			//   value: 'captcha',
			//   description: 'Solve CAPTCHA challenges',
			// },
		],
		default: 'totp',
		description: 'The type of authentication to perform',
		displayOptions: {
			show: {
				operation: ['authenticate'],
			},
		},
	},
	{
		displayName: 'TOTP Secret',
		name: 'totpSecret',
		type: 'string',
		default: '',
		description: 'The secret key used to generate the TOTP code',
		typeOptions: {
			password: true,
		},
		displayOptions: {
			show: {
				operation: ['authenticate'],
				authenticationType: ['totp'],
			},
		},
	},
	{
		displayName: 'TOTP Encoding',
		name: 'totpEncoding',
		type: 'options',
		options: [
			{
				name: 'Base32',
				value: 'base32',
				description: 'Base32 encoding (most common)',
			},
			{
				name: 'ASCII',
				value: 'ascii',
				description: 'ASCII encoding',
			},
			{
				name: 'HEX',
				value: 'hex',
				description: 'Hexadecimal encoding',
			},
		],
		default: 'base32',
		description: 'The encoding of the TOTP secret',
		displayOptions: {
			show: {
				operation: ['authenticate'],
				authenticationType: ['totp'],
			},
		},
	},
	{
		displayName: 'Input Field Selector',
		name: 'inputSelector',
		type: 'string',
		default: '',
		placeholder: '#totp-input, input[name="totp"]',
		description: 'CSS selector of the input field where the TOTP code should be entered',
		displayOptions: {
			show: {
				operation: ['authenticate'],
				authenticationType: ['totp'],
			},
		},
	},
	{
		displayName: 'Submit Button Selector',
		name: 'submitSelector',
		type: 'string',
		default: '',
		placeholder: 'button[type="submit"], .submit-button',
		description: 'CSS selector of the submit button to click after entering the TOTP code',
		displayOptions: {
			show: {
				operation: ['authenticate'],
				authenticationType: ['totp'],
			},
		},
	},
	{
		displayName: 'Wait After Submit (MS)',
		name: 'waitAfterSubmit',
		type: 'number',
		default: 5000,
		description: 'Time to wait in milliseconds after submitting the form',
		displayOptions: {
			show: {
				operation: ['authenticate'],
			},
		},
	},
	{
		displayName: 'Capture Screenshot',
		name: 'captureScreenshot',
		type: 'boolean',
		default: true,
		description: 'Whether to capture a screenshot after authentication',
		displayOptions: {
			show: {
				operation: ['authenticate'],
			},
		},
	},
	{
		displayName: 'Continue On Fail',
		name: 'continueOnFail',
		type: 'boolean',
		default: true,
		description: 'Whether to continue execution even when authentication fails',
		displayOptions: {
			show: {
				operation: ['authenticate'],
			},
		},
	},
	{
		displayName: 'Output Input Data',
		name: 'outputInputData',
		type: 'boolean',
		default: true,
		description: 'Whether to include the input data in the output',
		displayOptions: {
			show: {
				operation: ['authenticate'],
			},
		},
	},
	{
		displayName: 'Output TOTP Code',
		name: 'outputTotpCode',
		type: 'boolean',
		default: false,
		description: 'Whether to include the generated TOTP code in the output (useful for debugging)',
		displayOptions: {
			show: {
				operation: ['authenticate'],
				authenticationType: ['totp'],
			},
		},
	},
];

/**
 * Generate a TOTP code using the provided secret
 */
function generateTOTPCode(secret: string, encoding: 'base32' | 'ascii' | 'hex' = 'base32'): string {
	const totpCode = speakeasy.totp({
		secret,
		encoding,
	});
	return totpCode;
}

/**
 * Execute the authenticate operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	websocketEndpoint: string,
	workflowId: string,
): Promise<INodeExecutionData> {
	// Track execution time
	const startTime = Date.now();
	const items = this.getInputData();
	const item = items[index];
	let sessionId = '';
	let page: puppeteer.Page | null = null;

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;

	// Get input data and output settings
	const outputInputData = this.getNodeParameter('outputInputData', index, true) as boolean;
	const outputTotpCode = this.getNodeParameter('outputTotpCode', index, false) as boolean;

	// Visual marker to clearly indicate a new node is starting
	this.logger.info('============ STARTING NODE EXECUTION ============');
	this.logger.info(formatOperationLog('Authenticate', nodeName, nodeId, index, 'Starting execution'));

	// Get parameters based on authentication type
	const authenticationType = this.getNodeParameter('authenticationType', index, 'totp') as string;
	const continueOnFail = this.getNodeParameter('continueOnFail', index, true) as boolean;
	const captureScreenshot = this.getNodeParameter('captureScreenshot', index, true) as boolean;
	const explicitSessionId = this.getNodeParameter('explicitSessionId', index, '') as string;

	// Store the generated codes for potential output
	let generatedTotpCode: string | undefined;

	try {
		// Use the centralized session management instead of duplicating code
		const sessionResult = await SessionManager.getOrCreatePageSession(this.logger, {
			explicitSessionId,
			websocketEndpoint,
			workflowId,
			operationName: 'Authenticate',
			nodeId,
			nodeName,
			index,
		});

		page = sessionResult.page;
		sessionId = sessionResult.sessionId;

		if (!page) {
			throw new Error('Failed to get or create a page');
		}

		// Now we have a valid page, let's perform the authentication based on the selected type
		if (authenticationType === 'totp') {
			// Get TOTP parameters
			const totpSecret = this.getNodeParameter('totpSecret', index) as string;
			const totpEncoding = this.getNodeParameter('totpEncoding', index, 'base32') as string;
			const inputSelector = this.getNodeParameter('inputSelector', index) as string;
			const submitSelector = this.getNodeParameter('submitSelector', index) as string;
			const waitAfterSubmit = this.getNodeParameter('waitAfterSubmit', index, 5000) as number;

			if (!totpSecret) {
				throw new Error('TOTP secret is required for TOTP authentication.');
			}

			if (!inputSelector) {
				throw new Error('Input field selector is required to enter the TOTP code.');
			}

			// Generate TOTP code
			const totpCode = generateTOTPCode(totpSecret, totpEncoding as 'base32' | 'ascii' | 'hex');
			generatedTotpCode = totpCode; // Store for potential output
			this.logger.info(formatOperationLog('Authenticate', nodeName, nodeId, index, `Generated TOTP code: ${totpCode}`));

			// Wait for the input field to be visible
			this.logger.info(formatOperationLog('Authenticate', nodeName, nodeId, index, `Waiting for input field: ${inputSelector}`));
			await page.waitForSelector(inputSelector, { visible: true, timeout: 10000 });

			// Clear the input field if it has any value
			await page.evaluate((selector) => {
				const input = document.querySelector(selector) as HTMLInputElement;
				if (input) {
					input.value = '';
				}
			}, inputSelector);

			// Type the TOTP code
			this.logger.info(formatOperationLog('Authenticate', nodeName, nodeId, index, 'Typing TOTP code into input field'));
			await page.type(inputSelector, totpCode);

			// If submit button selector is provided, click it
			if (submitSelector) {
				this.logger.info(formatOperationLog('Authenticate', nodeName, nodeId, index, `Clicking submit button: ${submitSelector}`));
				await page.waitForSelector(submitSelector, { visible: true, timeout: 10000 });
				await page.click(submitSelector);
			} else {
				// Otherwise, press Enter
				this.logger.info(formatOperationLog('Authenticate', nodeName, nodeId, index, 'No submit button provided, pressing Enter key'));
				await page.keyboard.press('Enter');
			}

			// Wait after submit to allow the page to process the authentication
			this.logger.info(formatOperationLog('Authenticate', nodeName, nodeId, index, `Waiting ${waitAfterSubmit}ms after submitting form`));
			await new Promise(resolve => setTimeout(resolve, waitAfterSubmit));
		}
		// Add other authentication types here in the future

		// Log timing information
		createTimingLog('Authenticate', startTime, this.logger, nodeName, nodeId, index);

		// Prepare success response
		const successResponse = await createSuccessResponse({
			operation: 'authenticate',
			sessionId,
			page,
			logger: this.logger,
			startTime,
			takeScreenshot: captureScreenshot,
			additionalData: {
				authenticationType,
				...(outputTotpCode && generatedTotpCode ? { totpCode: generatedTotpCode } : {}),
			},
			inputData: {},
		});

		const inputData = outputInputData && item.json ? item.json : {};
		const responseData = mergeInputWithOutput(inputData, successResponse);

		return {
			json: responseData
		};
	} catch (error) {
		// Use the standardized error response utility
		const errorResponse = await createErrorResponse({
			error: error as Error,
			operation: 'authenticate',
			sessionId,
			nodeId,
			nodeName,
			page,
			logger: this.logger,
			takeScreenshot: captureScreenshot,
			startTime,
			additionalData: {
				authenticationType,
				...(outputTotpCode && generatedTotpCode ? { totpCode: generatedTotpCode } : {}),
			}
		});

		if (!continueOnFail) {
			throw error;
		}

		// Return error as response with continue on fail
		const errorInputData = outputInputData && item.json ? item.json : {};
		const errorResponseData = mergeInputWithOutput(errorInputData, errorResponse);

		return {
			json: errorResponseData
		};
	}
}
