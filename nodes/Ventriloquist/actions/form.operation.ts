import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeProperties,
} from "n8n-workflow";
import type { Page } from "puppeteer-core";
import { SessionManager } from "../utils/sessionManager";
import {
	retryFormSubmission,
	getHumanDelay,
	submitForm,
} from "../utils/formOperations";
import { takeScreenshot } from "../utils/navigationUtils";
import { getActivePage } from "../utils/sessionUtils";
import { executeAction } from "../utils/actionUtils";
import { formatOperationLog, createTimingLog } from "../utils/resultUtils";
import type {
	IActionParameters,
	IActionOptions,
	ActionType,
	IActionResult,
} from "../utils/actionUtils";
import type { IClickActionResult } from "../utils/actions/clickAction";

/**
 * Helper function to wait for a specified time in Node.js context
 * This is more reliable than running setTimeout in the browser context
 */
async function waitForDuration(page: Page, duration: number): Promise<void> {
	await new Promise(resolve => setTimeout(resolve, duration));
}

/**
 * Form operation description
 */
export const description: INodeProperties[] = [
	{
		displayName: "Session ID",
		name: "explicitSessionId",
		type: "string",
		default: "",
		description:
			"Session ID to use (leave empty to use ID from input or create new)",
		displayOptions: {
			show: {
				operation: ["form"],
			},
		},
	},
	{
		displayName: "Use Human-Like Delays",
		name: "useHumanDelays",
		type: "boolean",
		default: true,
		description:
			"Whether to use random delays between actions to simulate human behavior (100-300ms)",
		displayOptions: {
			show: {
				operation: ["form"],
			},
		},
	},
	{
		displayName: "Wait for Form Elements",
		name: "waitForSelectors",
		type: "boolean",
		default: true,
		description:
			"Whether to wait for form elements to appear before interacting with them",
		displayOptions: {
			show: {
				operation: ["form"],
			},
		},
	},
	{
		displayName: "Timeout",
		name: "selectorTimeout",
		type: "number",
		default: 10000,
		description:
			"Maximum time in milliseconds to wait for form elements to appear",
		displayOptions: {
			show: {
				operation: ["form"],
				waitForSelectors: [true],
			},
		},
	},
	{
		displayName: "Form Fields",
		name: "formFields",
		placeholder: "Add Form Field",
		type: "fixedCollection",
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		default: {},
		options: [
			{
				name: "fields",
				displayName: "Fields",
				values: [
					{
						displayName: "Field Type",
						name: "fieldType",
						type: "options",
						options: [
							{
								name: "Checkbox",
								value: "checkbox",
								description: "Checkbox toggle",
							},
							{
								name: "File Upload",
								value: "file",
								description: "File input field",
							},
							{
								name: "Multi-Select",
								value: "multiSelect",
								description:
									"Multi-select dropdown (allows multiple selections)",
							},
							{
								name: "Password",
								value: "password",
								description: "Password field with secure input",
							},
							{
								name: "Radio Button",
								value: "radio",
								description: "Radio button selection",
							},
							{
								name: "Select/Dropdown",
								value: "select",
								description: "Dropdown menu selection",
							},
							{
								name: "Text Input",
								value: "text",
								description: "Single-line text input",
							},
							{
								name: "Textarea",
								value: "textarea",
								description: "Multi-line text area",
							},
						],
						default: "text",
						description: "Type of form field to fill",
					},
					{
						displayName: "Selector",
						name: "selector",
						type: "string",
						default: "",
						placeholder: '#input-field, .form-control, input[name="email"]',
						description:
							'CSS selector to target the form field. Use "#ID" for IDs, ".class" for classes, "tag" for HTML elements, or "tag[attr=value]" for attributes.',
						required: true,
					},
					{
						displayName: "Value",
						name: "value",
						type: "string",
						default: "",
						description: "Value to set for the form field",
						displayOptions: {
							show: {
								fieldType: ["text", "radio"],
							},
						},
					},
					{
						displayName: "Check",
						name: "checked",
						type: "boolean",
						default: true,
						description: "Whether to check or uncheck the checkbox",
						displayOptions: {
							show: {
								fieldType: ["checkbox"],
							},
						},
					},
					{
						displayName: "File Path",
						name: "filePath",
						type: "string",
						default: "",
						description: "Full path to the file to upload",
						displayOptions: {
							show: {
								fieldType: ["file"],
							},
						},
					},
					{
						displayName: "Clear Field First",
						name: "clearField",
						type: "boolean",
						default: true,
						description:
							"Whether to clear the field before setting the value (for text fields)",
						displayOptions: {
							show: {
								fieldType: ["text"],
							},
						},
					},
					{
						displayName: "Human-Like Typing",
						name: "humanLike",
						type: "boolean",
						default: false,
						description:
							"Whether to type with human-like random delays between keystrokes",
						displayOptions: {
							show: {
								fieldType: ["text"],
							},
						},
					},
					{
						displayName: "Dropdown Value",
						name: "value",
						type: "string",
						default: "",
						description: "Value or text to select from the dropdown",
						displayOptions: {
							show: {
								fieldType: ["select"],
							},
						},
					},
					{
						displayName: "Match Type",
						name: "matchType",
						type: "options",
						options: [
							{
								name: "Exact (Value)",
								value: "exact",
								description: "Match exactly by option value",
							},
							{
								name: "Text Contains",
								value: "textContains",
								description: "Match if option text contains this string",
							},
							{
								name: "Fuzzy Match",
								value: "fuzzy",
								description:
									"Use fuzzy matching to find the closest option text",
							},
						],
						default: "exact",
						description: "How to match the dropdown option",
						displayOptions: {
							show: {
								fieldType: ["select"],
							},
						},
					},
					{
						displayName: "Fuzzy Match Threshold",
						name: "fuzzyThreshold",
						type: "number",
						typeOptions: {
							minValue: 0,
							maxValue: 1,
						},
						default: 0.5,
						description: "Minimum similarity score (0-1) to consider a match",
						displayOptions: {
							show: {
								fieldType: ["select"],
								matchType: ["fuzzy"],
							},
						},
					},
					{
						displayName: "Multi-Select Values",
						name: "multiSelectValues",
						type: "string",
						default: "",
						placeholder: "value1,value2,value3",
						description:
							"Comma-separated list of values to select (for multi-select dropdowns)",
						displayOptions: {
							show: {
								fieldType: ["multiSelect"],
							},
						},
					},
					{
						displayName: "Password Value",
						name: "value",
						type: "string",
						default: "",
						description:
							"Password to enter in the field (masked in logs for security)",
						typeOptions: {
							password: true,
						},
						displayOptions: {
							show: {
								fieldType: ["password"],
							},
						},
					},
					{
						displayName: "Clear Field First",
						name: "clearField",
						type: "boolean",
						default: true,
						description:
							"Whether to clear any existing value in the field before typing",
						displayOptions: {
							show: {
								fieldType: ["password"],
							},
						},
					},
					{
						displayName: "Has Clone Field",
						name: "hasCloneField",
						type: "boolean",
						default: false,
						description:
							"Whether this password field has a clone/duplicate field (common with show/hide password toggles)",
						displayOptions: {
							show: {
								fieldType: ["password"],
							},
						},
					},
					{
						displayName: "Clone Field Selector",
						name: "cloneSelector",
						type: "string",
						default: "",
						placeholder: "#password-clone, .password-visible",
						description:
							"CSS selector for the clone field (often shown when password is toggled to visible)",
						displayOptions: {
							show: {
								fieldType: ["password"],
								hasCloneField: [true],
							},
						},
					},
				],
			},
		],
		displayOptions: {
			show: {
				operation: ["form"],
			},
		},
	},
	{
		displayName: "Submit Form",
		name: "submitForm",
		type: "boolean",
		default: true,
		description: "Whether to submit the form after filling the fields",
		displayOptions: {
			show: {
				operation: ["form"],
			},
		},
	},
	{
		displayName: "Submit Button Selector",
		name: "submitSelector",
		type: "string",
		default: "",
		placeholder: 'button[type="submit"], input[type="submit"], .submit-button',
		description: "CSS selector of the submit button",
		displayOptions: {
			show: {
				operation: ["form"],
				submitForm: [true],
				useEnterToSubmit: [false],
			},
		},
	},
	{
		displayName: "Wait After Submit",
		name: "waitAfterSubmit",
		type: "options",
		options: [
			{
				name: "Fixed Time",
				value: "fixedTime",
				description:
					"Simple: Just wait for a specific amount of time that you set below",
			},
			{
				name: "New Page DOM Loaded",
				value: "domContentLoaded",
				description:
					"Medium: Wait until the new page's DOM is parsed and ready for interaction",
			},
			{
				name: "No Wait",
				value: "noWait",
				description:
					"Immediate: Do not wait at all after submitting form (may cause issues if next steps need the new page)",
			},
			{
				name: "Page Resources Loaded",
				value: "navigationComplete",
				description:
					"Slowest: Wait until all page resources (images, scripts, etc.) have finished loading",
			},
			{
				name: "URL Changed",
				value: "urlChanged",
				description:
					"Fastest: Wait only until the URL changes to confirm navigation started",
			},
		],
		default: "domContentLoaded",
		description:
			"What to wait for after clicking the submit button - needed to ensure the form submission completes properly",
		displayOptions: {
			show: {
				operation: ["form"],
				submitForm: [true],
			},
		},
	},
	{
		displayName: "Wait Time",
		name: "waitTime",
		type: "number",
		default: 5000,
		description: "Time to wait in milliseconds (for fixed time wait)",
		displayOptions: {
			show: {
				operation: ["form"],
				submitForm: [true],
				waitAfterSubmit: ["fixedTime"],
			},
		},
	},
	{
		displayName: "Retry Form Submission",
		name: "retrySubmission",
		type: "boolean",
		default: false,
		description:
			"Whether to retry form submission if no page change is detected after first attempt",
		displayOptions: {
			show: {
				operation: ["form"],
				submitForm: [true],
			},
		},
	},
	{
		displayName: "Max Retries",
		name: "maxRetries",
		type: "number",
		default: 2,
		description:
			"Maximum number of submission attempts if no page change is detected",
		displayOptions: {
			show: {
				operation: ["form"],
				submitForm: [true],
				retrySubmission: [true],
			},
		},
	},
	{
		displayName: "Retry Delay (MS)",
		name: "retryDelay",
		type: "number",
		default: 1000,
		description: "Delay in milliseconds between submission attempts",
		displayOptions: {
			show: {
				operation: ["form"],
				submitForm: [true],
				retrySubmission: [true],
			},
		},
	},
	{
		displayName: "Use Enter to Submit",
		name: "useEnterToSubmit",
		type: "boolean",
		default: false,
		description:
			"Press Enter key to submit the form instead of clicking a submit button. This will press Enter on the last filled form field.",
		displayOptions: {
			show: {
				operation: ["form"],
				submitForm: [true],
			},
		},
	},
	{
		displayName: "Advanced Button Options",
		name: "advancedButtonOptions",
		type: "boolean",
		default: false,
		description:
			"Whether to enable advanced button clicking options for problematic forms",
		displayOptions: {
			show: {
				operation: ["form"],
				submitForm: [true],
				useEnterToSubmit: [false],
			},
		},
	},
	{
		displayName: "Scroll Button Into View",
		name: "scrollIntoView",
		type: "boolean",
		default: true,
		description:
			"Whether to automatically scroll to ensure the button is visible before clicking",
		displayOptions: {
			show: {
				operation: ["form"],
				submitForm: [true],
				advancedButtonOptions: [true],
			},
		},
	},
	{
		displayName: "Button Click Method",
		name: "buttonClickMethod",
		type: "options",
		options: [
			{
				name: "Auto (Try All Methods)",
				value: "auto",
			},
			{
				name: "Standard Click",
				value: "standard",
			},
			{
				name: "JavaScript Click",
				value: "javascript",
			},
			{
				name: "Direct DOM Events",
				value: "events",
			},
		],
		default: "auto",
		description: "Method to use for clicking the submit button",
		displayOptions: {
			show: {
				operation: ["form"],
				submitForm: [true],
				advancedButtonOptions: [true],
			},
		},
	},
	{
		displayName: "Click Timeout (MS)",
		name: "clickTimeout",
		type: "number",
		default: 10000,
		description:
			"Maximum time in milliseconds to wait for button click to complete",
		displayOptions: {
			show: {
				operation: ["form"],
				submitForm: [true],
				advancedButtonOptions: [true],
			},
		},
	},

	{
		displayName: "Clear All Fields",
		name: "clearAllFields",
		type: "boolean",
		default: false,
		description:
			"Whether to clear all text input fields on the page before filling specified fields (clears text, email, password, search, URL, tel inputs and textareas only - safe mode)",
		displayOptions: {
			show: {
				operation: ["form"],
			},
		},
	},
	{
		displayName: "Continue On Fail",
		name: "continueOnFail",
		type: "boolean",
		default: true,
		description:
			"Whether to continue execution even when form operations fail (selector not found or timeout)",
		displayOptions: {
			show: {
				operation: ["form"],
			},
		},
	},
	{
		displayName: "Take Screenshot After Submission",
		name: "takeScreenshot",
		type: "boolean",
		default: false,
		description: "Whether to take a screenshot after form submission",
		displayOptions: {
			show: {
				operation: ["form"],
				submitForm: [true],
			},
		},
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
		description: "Strategy to wait for after the form action completes",
		displayOptions: {
			show: {
				operation: ["form"],
			},
		},
	},
	{
		displayName: "Wait Selector",
		name: "waitSelector",
		type: "string",
		default: "",
		description: "CSS selector of the element to wait for",
		displayOptions: {
			show: {
				operation: ["form"],
				waitAfterAction: ["element"],
			},
		},
		placeholder: "#confirmation-message",
	},
	{
		displayName: "Wait Duration (ms)",
		name: "waitDuration",
		type: "number",
		default: 1000,
		description: "Time to wait in milliseconds",
		displayOptions: {
			show: {
				operation: ["form"],
				waitAfterAction: ["fixed"],
			},
		},
		typeOptions: {
			minValue: 0,
		},
	},
	{
		displayName: "Debug Mode",
		name: "debugMode",
		type: "boolean",
		default: false,
		description:
			"Whether to include detailed debugging information in the output, including element detection results, filled values verification, and technical details about form interactions",
		displayOptions: {
			show: {
				operation: ["form"],
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
				operation: ["form"],
			},
		},
	},
];

/**
 * Execute the form operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	websocketEndpoint: string,
	workflowId: string,
): Promise<INodeExecutionData> {
	// Record start time for execution duration tracking
	const startTime = Date.now();

	// Get parameters
	const formFields = this.getNodeParameter(
		"formFields.fields",
		index,
		[],
	) as IDataObject[];
	const useHumanDelays = this.getNodeParameter(
		"useHumanDelays",
		index,
		true,
	) as boolean;
	const submitFormAfterFill = this.getNodeParameter(
		"submitForm",
		index,
		true,
	) as boolean;
	const submitSelector = this.getNodeParameter(
		"submitSelector",
		index,
		"",
	) as string;
	const waitAfterSubmit = this.getNodeParameter(
		"waitAfterSubmit",
		index,
		"domContentLoaded",
	) as string;
	const waitTime = this.getNodeParameter("waitTime", index, 5000) as number;
	const takeScreenshotAfterSubmit = this.getNodeParameter(
		"takeScreenshot",
		index,
		false,
	) as boolean;
	const waitForSelectors = this.getNodeParameter(
		"waitForSelectors",
		index,
		true,
	) as boolean;
	const selectorTimeout = this.getNodeParameter(
		"selectorTimeout",
		index,
		10000,
	) as number;
	const clearAllFields = this.getNodeParameter(
		"clearAllFields",
		index,
		false,
	) as boolean;
	const continueOnFail = this.getNodeParameter(
		"continueOnFail",
		index,
		true,
	) as boolean;
	const retrySubmission = this.getNodeParameter(
		"retrySubmission",
		index,
		false,
	) as boolean;
	const maxRetries = this.getNodeParameter("maxRetries", index, 2) as number;
	const retryDelay = this.getNodeParameter("retryDelay", index, 1000) as number;
	const waitAfterAction = this.getNodeParameter(
		"waitAfterAction",
		index,
		"quick",
	) as string;
	const waitSelector = this.getNodeParameter("waitSelector", index, "") as string;
	const waitDuration = this.getNodeParameter("waitDuration", index, 1000) as number;
	const debugMode = this.getNodeParameter(
		"debugMode",
		index,
		false,
	) as boolean;
	const outputInputData = this.getNodeParameter(
		"outputInputData",
		index,
		true,
	) as boolean;
	const useEnterToSubmit = this.getNodeParameter(
		"useEnterToSubmit",
		index,
		false,
	) as boolean;
	// Get the main screenshot toggle from node level
	const captureScreenshot = this.getNodeParameter(
		"captureScreenshot",
		index,
		true,
	) as boolean;

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;

	// Visual marker to clearly indicate a new node is starting
	this.logger.info("============ STARTING NODE EXECUTION ============");
	this.logger.info(
		`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Starting execution`,
	);

	// Check if an explicit session ID was provided
	const explicitSessionId = this.getNodeParameter(
		"explicitSessionId",
		index,
		"",
	) as string;

	// Get or create browser session
	let page: Page | null = null;
	let sessionId = "";

	try {
		// Use the centralized session management instead of duplicating code
		const sessionResult = await SessionManager.getOrCreatePageSession(
			this.logger,
			{
				explicitSessionId,
				websocketEndpoint,
				workflowId,
				operationName: "Form",
				nodeId,
				nodeName,
				index,
			},
		);

		page = sessionResult.page;
		sessionId = sessionResult.sessionId;

		if (!page) {
			throw new Error("Failed to get or create a page");
		}

		this.logger.info(
			`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Starting form fill operation`,
		);
		const results: IDataObject[] = [];
		let clearAllFieldsResult: IDataObject | null = null;

		// Wait for form elements if enabled, but don't use smart waiting - just check basic page readiness
		if (waitForSelectors) {
			this.logger.info(
				`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Basic page readiness check`,
			);

			// Check if the page is ready first
			const pageReady = await page.evaluate(() => {
				return {
					readyState: document.readyState,
					bodyExists: !!document.body,
					contentLoaded:
						document.readyState === "interactive" ||
						document.readyState === "complete",
				};
			});

			this.logger.info(
				`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Page readiness state: ${JSON.stringify(pageReady)}`,
			);

			if (!pageReady.bodyExists) {
				this.logger.warn(
					`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Page body not yet available - waiting for page to initialize`,
				);
				try {
					// Wait for the body element specifically
					await page.waitForSelector("body", { timeout: selectorTimeout });
				} catch (bodyError) {
					throw new Error(
						`Page did not initialize properly: ${(bodyError as Error).message}`,
					);
				}
			}

			// Simple wait for page to be fully loaded
			if (!pageReady.contentLoaded) {
				this.logger.info(
					`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Waiting for page content to load`,
				);
				try {
					await page.waitForFunction(() => document.readyState === "complete", {
						timeout: selectorTimeout,
					});
				} catch (loadError) {
					this.logger.warn(
						`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Page load timeout: ${(loadError as Error).message}`,
					);
					// Continue anyway - page might be usable
				}
			}
		}

		// Clear all fields if requested
		if (clearAllFields) {
			this.logger.info(
				`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Clearing all text input fields on the page (safe mode)`,
			);

						try {
				const clearResult = await page.evaluate(() => {
					// Only target text inputs and textareas (safe, like individual field clearing)
					const inputFields = document.querySelectorAll('input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="url"], input[type="tel"], input:not([type]), textarea');
					let clearedCount = 0;
					let errorCount = 0;
					const errors: string[] = [];

					inputFields.forEach((field: Element, index: number) => {
						try {
							const inputElement = field as HTMLInputElement | HTMLTextAreaElement;

							// Simple, safe clearing (no events triggered, just like individual field clearing)
							inputElement.value = '';
							clearedCount++;
						} catch (error) {
							errorCount++;
							errors.push(`Field ${index}: ${(error as Error).message}`);
						}
					});

					return {
						success: true,
						totalFields: inputFields.length,
						clearedCount,
						errorCount,
						errors: errors.slice(0, 5) // Limit to first 5 errors to avoid huge logs
					};
				});

				this.logger.info(
					`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Clear all text fields result: ${clearResult.clearedCount}/${clearResult.totalFields} text fields cleared successfully${clearResult.errorCount > 0 ? `, ${clearResult.errorCount} errors` : ''}`,
				);

				if (clearResult.errors.length > 0) {
					this.logger.warn(
						`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Clear all text fields errors: ${clearResult.errors.join('; ')}`,
					);
				}

				// Store the clear all fields result
				clearAllFieldsResult = {
					fieldType: "clearAllTextFields",
					success: clearResult.success,
					details: {
						totalFields: clearResult.totalFields,
						clearedCount: clearResult.clearedCount,
						errorCount: clearResult.errorCount,
						errors: clearResult.errors
					}
				};

				// Add human-like delay after clearing if enabled
				if (useHumanDelays) {
					const delay = getHumanDelay();
					this.logger.info(
						`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Adding human-like delay of ${delay}ms after clearing all text fields`,
					);
					await new Promise((resolve) => setTimeout(resolve, delay));
				}

						} catch (clearError) {
				this.logger.error(
					`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Error clearing all text fields: ${(clearError as Error).message}`,
				);

				if (!continueOnFail) {
					throw new Error(`Failed to clear all text fields: ${(clearError as Error).message}`);
				}
			}
		}

		// Fill each form field
		for (const field of formFields) {
			const fieldType = field.fieldType as string;
			const selector = field.selector as string;

			this.logger.info(
				`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Processing ${fieldType} field with selector: ${selector}`,
			);

			// Enhanced element detection with debug info
			let elementFound = false;
			let elementInfo: IDataObject = {};

			if (waitForSelectors) {
				this.logger.info(
					`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Waiting for selector: ${selector} (timeout: ${selectorTimeout}ms)`,
				);
				await page
					.waitForSelector(selector, { timeout: selectorTimeout })
					.then(() => {
						elementFound = true;
						if (debugMode) {
							this.logger.info(
								`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] DEBUG: Element found after waiting - ${selector}`,
							);
						}
					})
					.catch((error) => {
						elementFound = false;
						this.logger.warn(
							`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Selector not found: ${selector}, but will try to interact anyway`,
						);
					});
			} else {
				// Check if the element exists first
				elementFound = await page.evaluate((sel) => {
					return document.querySelector(sel) !== null;
				}, selector);

				if (!elementFound) {
					this.logger.warn(`Element not found without waiting: ${selector}`);
				} else if (debugMode) {
					this.logger.info(
						`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] DEBUG: Element found immediately - ${selector}`,
					);
				}
			}

			// Get detailed element information for debug mode
			if (debugMode) {
				try {
					elementInfo = await page.evaluate((sel) => {
						const element = document.querySelector(sel) as HTMLElement;
						if (!element) {
							return {
								found: false,
								error: "Element not found in DOM",
								totalElementsOnPage: document.querySelectorAll('*').length
							};
						}

						const computedStyle = window.getComputedStyle(element);
						const rect = element.getBoundingClientRect();

						return {
							found: true,
							tagName: element.tagName.toLowerCase(),
							type: (element as HTMLInputElement).type || null,
							id: element.id || null,
							className: element.className || null,
							name: (element as HTMLInputElement).name || null,
							value: (element as HTMLInputElement).value || (element as HTMLTextAreaElement).value || null,
							placeholder: (element as HTMLInputElement).placeholder || null,
							visible: computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden',
							inViewport: rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth,
							coordinates: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
							disabled: (element as HTMLInputElement).disabled || false,
							readOnly: (element as HTMLInputElement).readOnly || false,
						};
					}, selector);

					this.logger.info(
						`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] DEBUG: Element details for ${selector}: ${JSON.stringify(elementInfo)}`,
					);
				} catch (debugError) {
					elementInfo = {
						found: false,
						error: `Debug info extraction failed: ${(debugError as Error).message}`,
					};
				}
			}

			// Add human-like delay between form field interactions if enabled
			if (useHumanDelays) {
				const delay = getHumanDelay();
				this.logger.info(
					`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Adding human-like delay of ${delay}ms`,
				);
				await new Promise((resolve) => setTimeout(resolve, delay));
			}

			// Create parameters and options for the action executor
			const actionParameters: IActionParameters = {
				...field, // Include all field properties from the form definition
				selector,
			};

			const actionOptions: IActionOptions = {
				waitForSelector: waitForSelectors,
				selectorTimeout,
				detectionMethod: "standard",
				earlyExitDelay: 500,
				nodeName,
				nodeId,
				index,
				useHumanDelays,
				sessionId: sessionId,
			};

			// Execute the action using the action utils module
			const actionResult = await executeAction(
				sessionId,
				"fill" as ActionType,
				actionParameters,
				actionOptions,
				this.logger,
			);

			// Post-fill verification for debug mode
			let postFillVerification: IDataObject = {};
			if (debugMode && actionResult.success) {
				try {
					postFillVerification = await page.evaluate((sel, expectedValue) => {
						const element = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement;
						if (!element) {
							return { verified: false, error: "Element not found for verification" };
						}

						const currentValue = element.value;
						const matches = currentValue === expectedValue;

						return {
							verified: true,
							currentValue,
							expectedValue,
							matches,
							valueLength: currentValue.length,
							elementType: element.type || element.tagName.toLowerCase(),
						};
					}, selector, field.value || field.checked || "");

					if (debugMode) {
						this.logger.info(
							`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] DEBUG: Post-fill verification for ${selector}: ${JSON.stringify(postFillVerification)}`,
						);
					}
				} catch (verificationError) {
					postFillVerification = {
						verified: false,
						error: `Verification failed: ${(verificationError as Error).message}`,
					};
				}
			}

			// Add the field result to our results collection with enhanced debug info
			const fieldResult: IDataObject = {
				fieldType,
				selector,
				success: actionResult.success,
				details: actionResult.details,
			};

			// Include debug information if debug mode is enabled
			if (debugMode) {
				fieldResult.debug = {
					elementDetection: {
						found: elementFound,
						elementInfo,
					},
					...(postFillVerification.verified !== undefined && { postFillVerification }),
					actionExecuted: actionResult.success,
					actionError: actionResult.error || null,
				};
			}

			results.push(fieldResult);

			// If the field failed and we're not continuing on failure, throw an error
			if (!actionResult.success && !continueOnFail) {
				throw new Error(
					`Failed to fill form field: ${selector} (type: ${fieldType}) - ${actionResult.error || "Unknown error"}`,
				);
			}
		}

		// Submit the form if requested
		let formSubmissionResult: IDataObject = {};

		if (submitFormAfterFill) {
			// Check if we should use Enter key submission
			if (useEnterToSubmit) {
				this.logger.info(
					`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Submitting form using Enter key on last filled field`,
				);

				// Find the last successfully filled form field to press Enter on
				const lastSuccessfulField = results.slice().reverse().find(r => r.success);

				if (lastSuccessfulField) {
					try {
						// Press Enter on the last filled field
						const targetSelector = lastSuccessfulField.selector as string;

						// First, focus the element to ensure it's active
						const focusResult = await page.evaluate((selector) => {
							const element = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
							if (element) {
								// Focus the element
								element.focus();
								// Make sure it's actually focused
								return {
									success: true,
									focused: document.activeElement === element,
									selector,
									elementType: element.tagName.toLowerCase()
								};
							}
							return { success: false, error: 'Element not found', selector };
						}, targetSelector);

						if (!focusResult.success) {
							throw new Error(`Could not focus element: ${focusResult.error}`);
						}

						this.logger.info(
							`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Focused element ${targetSelector} (${focusResult.elementType}), focused: ${focusResult.focused}`,
						);

						// Now press Enter using Puppeteer's built-in method (more reliable)
						await page.keyboard.press('Enter');

						const enterResult = {
							success: true,
							selector: targetSelector,
							method: 'puppeteer_keyboard',
							focused: focusResult.focused
						};

						this.logger.info(
							`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Enter key pressed on ${targetSelector}`,
						);

						formSubmissionResult = {
							success: enterResult.success,
							method: enterResult.method,
							targetSelector: targetSelector,
							details: enterResult,
						};

						// Wait after submission based on the waitAfterSubmit setting
						if (waitAfterSubmit !== 'noWait') {
							this.logger.info(
								`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Waiting after Enter submission: ${waitAfterSubmit}`,
							);

							const effectiveWaitTime = Math.max(
								waitTime,
								waitAfterSubmit === "navigationComplete" ? 30000 : 20000
							);

							switch (waitAfterSubmit) {
								case 'urlChanged':
									// Simple wait since URL changes are hard to detect with Enter
									await waitForDuration(page, Math.min(effectiveWaitTime, 5000));
									break;
								case 'domContentLoaded':
									await waitForDuration(page, effectiveWaitTime);
									break;
								case 'navigationComplete':
									await waitForDuration(page, effectiveWaitTime);
									break;
								case 'fixedTime':
									await waitForDuration(page, waitTime);
									break;
							}
						}

						// Add to results array
						results.push({
							fieldType: "formSubmission",
							success: enterResult.success,
							details: enterResult,
						});

					} catch (enterError) {
						this.logger.warn(
							`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Enter key submission failed: ${(enterError as Error).message}`,
						);

						formSubmissionResult = {
							success: false,
							method: 'enter_key',
							error: (enterError as Error).message,
						};

						// Add failed result
						results.push({
							fieldType: "formSubmission",
							success: false,
							details: { method: 'enter_key', error: (enterError as Error).message },
						});
					}
				} else {
					this.logger.warn(
						`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] No successfully filled fields found for Enter key submission`,
					);

					formSubmissionResult = {
						success: false,
						method: 'enter_key',
						error: 'No successfully filled fields found',
					};
				}
			} else if (submitSelector) {
				this.logger.info(
					`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Submitting form using selector: ${submitSelector}`,
				);

				// Use the executeAction utility with "click" type to handle form submission
				// This provides better consistency with other operations like Decision

				// Set up action options
			const actionOptions: IActionOptions = {
				sessionId,
				waitForSelector: waitForSelectors,
				selectorTimeout,
				detectionMethod: "standard",
				earlyExitDelay: 500,
				nodeName,
				nodeId,
				index,
				useHumanDelays,
			};

			// Set effective timeout for form submission - should be longer than regular clicks
			const effectiveWaitTime = Math.max(
				waitTime,
				waitAfterSubmit === "navigationComplete" ? 30000 : 20000
			);

			this.logger.info(
				formatOperationLog(
					"Form",
					nodeName,
					nodeId,
					index,
					`[Form][Submit] Using click action for form submission with ${waitAfterSubmit} detection (timeout: ${effectiveWaitTime}ms)`
				)
			);

			// Execute the click action for form submission
			const clickResult = await executeAction(
				sessionId,
				"click" as ActionType,
				{
					selector: submitSelector,
					waitAfterAction: waitAfterSubmit,
					waitTime: effectiveWaitTime,
					waitSelector: waitSelector,
				},
				actionOptions,
				this.logger
			) as IClickActionResult;

			// Update formSubmissionResult with the click result
			formSubmissionResult = {
				success: clickResult.success,
				details: clickResult.details,
				error: clickResult.error,
				submitSelector,
				waitAfterSubmit,
				waitTime: effectiveWaitTime,
			};

			// If navigation occurred or context was destroyed, we need to get a fresh page reference
			if ((clickResult as any).contextDestroyed || (clickResult.details?.urlChanged === true)) {
				this.logger.info(
					formatOperationLog(
						"Form",
						nodeName,
						nodeId,
						index,
						`[Form][Submit] Navigation detected after submission: Context destroyed=${!!(clickResult as any).contextDestroyed}, URL changed=${!!clickResult.details?.urlChanged}`
					)
				);

				// Try to get a fresh page reference
				const currentSession = SessionManager.getSession(sessionId);
				if (currentSession?.browser?.isConnected()) {
					const freshPage = await getActivePage(currentSession.browser, this.logger);
					if (freshPage) {
						page = freshPage;
						this.logger.info(
							formatOperationLog(
								"Form",
								nodeName,
								nodeId,
								index,
								`[Form][Submit] Using fresh page reference after navigation`
							)
						);
					}
				}
			}

			// Add to results array
			results.push({
				fieldType: "formSubmission",
				success: clickResult.success,
				details: clickResult.details,
			});

			// Log success or failure of form submission
			if (clickResult.success) {
				this.logger.info(
					formatOperationLog(
						"Form",
						nodeName,
						nodeId,
						index,
						`[Form][Submit] Form submission completed successfully`
					)
				);
			} else {
				this.logger.warn(
					formatOperationLog(
						"Form",
						nodeName,
						nodeId,
						index,
						`[Form][Submit] Form submission had issues: ${clickResult.error || 'Unknown issue'}`
					)
				);
			}
			} else {
				// No submission method configured
				this.logger.warn(
					`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Form submission requested but no method configured (useEnterToSubmit=false, submitSelector empty)`,
				);

				formSubmissionResult = {
					success: false,
					method: 'none',
					error: 'No submission method configured - either enable Enter submission or provide a submit button selector',
				};

				// Add failed result
				results.push({
					fieldType: "formSubmission",
					success: false,
					details: { method: 'none', error: 'No submission method configured' },
				});
			}
		}

		// Take a screenshot if requested (respects both main toggle and after-submission toggle)
		let screenshot: string | null = null;
		const shouldTakeScreenshot = captureScreenshot && (submitFormAfterFill ? takeScreenshotAfterSubmit : true);

		if (shouldTakeScreenshot) {
			const screenshotContext = submitFormAfterFill ? "after submission" : "after form fill";
			this.logger.info(
				`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Attempting to take screenshot ${screenshotContext}.`,
			);
			const currentSession = SessionManager.getSession(sessionId);
			let pageForScreenshot: Page | null = null;
			if (currentSession?.browser?.isConnected()) {
				// Use the potentially updated 'page' variable here
				pageForScreenshot = page;
				// If 'page' is null (shouldn't happen here ideally), try getActivePage as fallback
				if (!pageForScreenshot) {
					pageForScreenshot = await getActivePage(
						currentSession.browser,
						this.logger,
					);
				}
			}

			if (pageForScreenshot) {
				screenshot = await takeScreenshot(pageForScreenshot, this.logger);
				if (screenshot) {
					this.logger.info(
						`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Screenshot captured successfully ${screenshotContext}.`,
					);
				} else {
					this.logger.warn(
						`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Failed to capture screenshot (takeScreenshot returned null).`,
					);
				}
			} else {
				this.logger.warn(
					`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Could not get active page for screenshot.`,
				);
			}
		} else if (debugMode) {
			this.logger.info(
				`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Screenshot skipped - captureScreenshot: ${captureScreenshot}, submitForm: ${submitFormAfterFill}, takeScreenshotAfterSubmit: ${takeScreenshotAfterSubmit}`,
			);
		}

		// Return the result data
		const item = this.getInputData()[index];
		const resultData: IDataObject = {
			...(outputInputData && item.json ? item.json : {}),
			success: true,
			operation: "form",
			sessionId,
			formFields: results,
			currentUrl: page ? await page.url() : "Page unavailable",
			pageTitle: page ? await page.title() : "Page unavailable",
			timestamp: new Date().toISOString(),
			executionDuration: Date.now() - startTime,
			// Add cache explanation
			note: "IMPORTANT: Copy this sessionId value to the 'Session ID' field in your Decision, Form or other subsequent operations.",
			...(debugMode && {
				debug: {
					cacheInfo: "Results may be cached in manual mode. If you see 'fromCache: true', the result came from cache instead of fresh execution.",
					screenshotInfo: `Screenshot captured: ${!!screenshot}, captureScreenshot setting: ${captureScreenshot}, takeScreenshotAfterSubmit: ${takeScreenshotAfterSubmit}`,
					debugModeEnabled: true,
					formFieldsProcessed: formFields.length,
					allFieldsSucceeded: results.every(r => r.success),
				}
			}),
		};

		if (submitFormAfterFill) {
			resultData.formSubmission = formSubmissionResult;
		}

		if (clearAllFieldsResult) {
			resultData.clearAllFields = clearAllFieldsResult;
		}

		if (screenshot) {
			resultData.screenshot = screenshot;
		}

		// Wait After Action Logic using action utilities pattern
		if (results.every(r => r.success) && waitAfterAction !== "quick") {
			this.logger.info(
				formatOperationLog(
					"Form",
					nodeName,
					nodeId,
					index,
					`Performing wait after action: ${waitAfterAction}`,
				),
			);

			try {
				// Map waitAfterAction values to appropriate action parameters
				let waitActionType: string = "";
				let waitActionParams: IActionParameters = {};

				switch (waitAfterAction) {
					case "element":
						if (!waitSelector) {
							throw new Error('"Wait for Element" selected but no selector provided');
						}
						// Use the existing page and executeAction pattern
						waitActionType = "wait";
						waitActionParams = {
							type: "selector",
							selector: waitSelector,
							timeout: selectorTimeout,
						};
						break;

					case "navFast":
						waitActionType = "wait";
						waitActionParams = {
							type: "navigation",
							waitUntil: "networkidle2",
							timeout: selectorTimeout,
						};
						break;

					case "navFull":
						waitActionType = "wait";
						waitActionParams = {
							type: "navigation",
							waitUntil: "networkidle0",
							timeout: selectorTimeout,
						};
						break;

					case "fixed":
						waitActionType = "wait";
						waitActionParams = {
							type: "timeout",
							timeout: waitDuration,
						};
						break;
				}

				// If we have a wait action type, execute it
				if (waitActionType && page) {
					// For now, perform direct page operations since wait is not a full action type
					// In the future, this could be enhanced to use a proper "wait" action type
					switch (waitActionParams.type) {
						case "selector":
							this.logger.info(
								formatOperationLog(
									"Form",
									nodeName,
									nodeId,
									index,
									`Waiting for selector: ${waitActionParams.selector}`,
								),
							);
							await page.waitForSelector(waitActionParams.selector as string, {
								timeout: waitActionParams.timeout as number
							});
							break;

						case "navigation":
							this.logger.info(
								formatOperationLog(
									"Form",
									nodeName,
									nodeId,
									index,
									`Waiting for navigation (${waitActionParams.waitUntil})`,
								),
							);
							await page.waitForNavigation({
								waitUntil: waitActionParams.waitUntil as "networkidle0" | "networkidle2",
								timeout: waitActionParams.timeout as number
							});
							break;

						case "timeout":
							this.logger.info(
								formatOperationLog(
									"Form",
									nodeName,
									nodeId,
									index,
									`Waiting for fixed time: ${waitActionParams.timeout}ms`,
								),
							);
							await waitForDuration(page, waitActionParams.timeout as number);
							break;
					}

					this.logger.info(
						formatOperationLog(
							"Form",
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
						"Form",
						nodeName,
						nodeId,
						index,
						waitErrorMessage,
					),
				);
				if (!continueOnFail) {
					throw new Error(waitErrorMessage);
				}
			}
		}

		// Add timing log
		createTimingLog(
			"Form",
			startTime,
			this.logger,
			nodeName,
			nodeId,
			index,
		);

		// Add a summary message about the operation
		this.logger.info(
			`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Form operation completed successfully with ${results.length} field(s)`
		);
		this.logger.info("============ NODE EXECUTION COMPLETE ============");

		return { json: resultData };
	} catch (error) {
		// Handle any errors
		this.logger.error(
			`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Error: ${(error as Error).message}`,
		);

		// Take a screenshot for diagnostics if possible (respecting user's screenshot settings)
		let errorScreenshot: string | null = null;
		if (captureScreenshot) {
			try {
				if (page) {
					errorScreenshot = await takeScreenshot(page, this.logger);
					this.logger.info(
						`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Error screenshot captured for diagnostics`,
					);
				}
			} catch (screenshotError) {
				this.logger.warn(
					`Failed to take error screenshot: ${(screenshotError as Error).message}`,
				);
			}
		} else if (debugMode) {
			this.logger.info(
				`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Error screenshot skipped - captureScreenshot setting is disabled`,
			);
		}

			// Prepare error response data
	const item = this.getInputData()[index];
	const errorResponseData = {
		...(outputInputData && item.json ? item.json : {}),
		success: false,
		error: {
			message: (error as Error).message,
			stack: (error as Error).stack,
			sessionId,
			...(errorScreenshot && { screenshot: errorScreenshot }),
		},
		sessionId,
	};

		if (continueOnFail) {
			// Return partial results if continue on fail is enabled
			return { json: errorResponseData };
		}

		// If not continuing on fail, re-throw the original error
		// Attach context before throwing
		if (error instanceof Error) {
			(error as any).context = { sessionId, errorResponse: errorResponseData };
		}
		throw error;
	}
}
