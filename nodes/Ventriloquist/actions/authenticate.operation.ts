import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import * as speakeasy from 'speakeasy';
import { Ventriloquist } from '../Ventriloquist.node';

/**
 * Authenticate operation description
 */
export const description: INodeProperties[] = [
	{
		displayName: 'Session ID',
		name: 'sessionId',
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

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;

	// Visual marker to clearly indicate a new node is starting
	this.logger.info('============ STARTING NODE EXECUTION ============');
	this.logger.info(`[Ventriloquist][${nodeName}#${index}][Authenticate][${nodeId}] Starting execution`);

	// Get parameters based on authentication type
	const authenticationType = this.getNodeParameter('authenticationType', index, 'totp') as string;
	const continueOnFail = this.getNodeParameter('continueOnFail', index, true) as boolean;
	const captureScreenshot = this.getNodeParameter('captureScreenshot', index, true) as boolean;

	// Get session ID if provided
	let sessionId = '';
	let page: puppeteer.Page | undefined;

	try {
		// Try to get sessionId from parameters
		const explicitSessionId = this.getNodeParameter('sessionId', index, '') as string;

		if (explicitSessionId) {
			sessionId = explicitSessionId;
			this.logger.info(`[Ventriloquist][${nodeName}#${index}][Authenticate][${nodeId}] Using provided session ID: ${sessionId}`);

			// Try to get existing page from session
			page = Ventriloquist.getPage(workflowId, sessionId);

			if (!page) {
				throw new Error(`Session ID ${sessionId} not found or expired. Please run the Open operation first.`);
			}
		} else {
			// Try to find session ID from input data
			const items = this.getInputData();
			for (const item of items) {
				if (item.json?.sessionId) {
					sessionId = item.json.sessionId as string;
					this.logger.info(`[Ventriloquist][${nodeName}#${index}][Authenticate][${nodeId}] Using session ID from input: ${sessionId}`);

					// Try to get page from session
					page = Ventriloquist.getPage(workflowId, sessionId);

					if (page) {
						break;
					}
				}
			}

			// If still no page found, try to use existing session for this workflow
			if (!page) {
				this.logger.info(`[Ventriloquist][${nodeName}#${index}][Authenticate][${nodeId}] No valid session ID found, trying to use existing session`);

				// Access browserSessions using a getter method or other approach
				const existingSessions = await Ventriloquist.getSessions();
				const existingSession = existingSessions.get(workflowId);

				if (!existingSession) {
					throw new Error('No browser session found. Please run the Open operation first.');
				}

				const pages = await existingSession.browser.pages();

				if (pages.length > 0) {
					page = pages[pages.length - 1]; // Use the most recent page
					this.logger.info(`[Ventriloquist][${nodeName}#${index}][Authenticate][${nodeId}] Using the most recent page from existing session`);
				} else {
					throw new Error('No pages found in the existing browser session.');
				}
			}
		}

		// Now we have a valid page, let's perform the authentication based on the selected type
		if (!page) {
			throw new Error('Failed to obtain a valid browser page');
		}

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
			this.logger.info(`[Ventriloquist][${nodeName}#${index}][Authenticate][${nodeId}] Generated TOTP code: ${totpCode}`);

			// Wait for the input field to be visible
			this.logger.info(`[Ventriloquist][${nodeName}#${index}][Authenticate][${nodeId}] Waiting for input field: ${inputSelector}`);
			await page.waitForSelector(inputSelector, { visible: true, timeout: 10000 });

			// Clear the input field if it has any value
			await page.evaluate((selector) => {
				const input = document.querySelector(selector) as HTMLInputElement;
				if (input) {
					input.value = '';
				}
			}, inputSelector);

			// Type the TOTP code
			this.logger.info(`[Ventriloquist][${nodeName}#${index}][Authenticate][${nodeId}] Typing TOTP code into input field`);
			await page.type(inputSelector, totpCode);

			// If submit button selector is provided, click it
			if (submitSelector) {
				this.logger.info(`[Ventriloquist][${nodeName}#${index}][Authenticate][${nodeId}] Clicking submit button: ${submitSelector}`);
				await page.waitForSelector(submitSelector, { visible: true, timeout: 10000 });
				await page.click(submitSelector);
			} else {
				// Otherwise, press Enter
				this.logger.info(`[Ventriloquist][${nodeName}#${index}][Authenticate][${nodeId}] No submit button provided, pressing Enter key`);
				await page.keyboard.press('Enter');
			}

			// Wait after submit to allow the page to process the authentication
			this.logger.info(`[Ventriloquist][${nodeName}#${index}][Authenticate][${nodeId}] Waiting ${waitAfterSubmit}ms after submitting form`);
			await new Promise(resolve => setTimeout(resolve, waitAfterSubmit));
		}
		// Add other authentication types here in the future

		// Take a screenshot if requested
		let screenshot: string | undefined;
		if (captureScreenshot) {
			try {
				screenshot = await page.screenshot({
					encoding: 'base64',
					type: 'jpeg',
					quality: 80,
					fullPage: false,
				}) as string;
				this.logger.info(`[Ventriloquist][${nodeName}#${index}][Authenticate][${nodeId}] Screenshot captured`);
			} catch (error) {
				this.logger.warn(`[Ventriloquist][${nodeName}#${index}][Authenticate][${nodeId}] Failed to capture screenshot: ${(error as Error).message}`);
			}
		}

		// Get current page info
		const currentUrl = await page.url();
		const pageTitle = await page.title();

		this.logger.info(`[Ventriloquist][${nodeName}#${index}][Authenticate][${nodeId}] Authentication completed on: ${currentUrl} (${pageTitle})`);
		this.logger.info(`[Ventriloquist][${nodeName}#${index}][Authenticate][${nodeId}] AUTHENTICATION OPERATION SUCCESSFUL: Node has finished processing`);

		// Add a visual end marker
		this.logger.info('============ NODE EXECUTION COMPLETE ============');

		// Prepare response data
		const responseData: IDataObject = {
			success: true,
			operation: 'authenticate',
			authenticationType,
			currentUrl,
			pageTitle,
			screenshot,
			sessionId,
			timestamp: new Date().toISOString(),
			executionDuration: Date.now() - startTime,
		};

		return {
			json: responseData,
		};
	} catch (error) {
		const errorMessage = (error as Error).message;
		this.logger.error(`[Ventriloquist][${nodeName}#${index}][Authenticate][${nodeId}] Authentication failed: ${errorMessage}`);

		// Add a visual end marker
		this.logger.info('============ NODE EXECUTION COMPLETE (WITH ERROR) ============');

		// If continueOnFail is false, throw the error to fail the node
		if (!continueOnFail) {
			throw new Error(`Authentication failed: ${errorMessage}`);
		}

		// Otherwise, return an error response
		return {
			json: {
				success: false,
				operation: 'authenticate',
				authenticationType,
				error: errorMessage,
				sessionId,
				timestamp: new Date().toISOString(),
				executionDuration: Date.now() - startTime,
			},
		};
	}
}
