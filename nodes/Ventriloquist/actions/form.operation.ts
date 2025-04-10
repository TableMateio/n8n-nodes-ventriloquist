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
} from "../utils/actionUtils";

/**
 * Helper function to wait for a specified time using page.evaluate
 * This replaces puppeteer's built-in waitForTimeout which may not be available in all versions
 */
async function waitForDuration(page: Page, duration: number): Promise<void> {
	await page.evaluate((ms) => new Promise(resolve => setTimeout(resolve, ms)), duration);
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
					"Immediate: Do not wait at all after clicking submit (may cause issues if next steps need the new page)",
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

		// Fill each form field
		for (const field of formFields) {
			const fieldType = field.fieldType as string;
			const selector = field.selector as string;

			this.logger.info(
				`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Processing ${fieldType} field with selector: ${selector}`,
			);

			// Wait for the element to be available
			if (waitForSelectors) {
				this.logger.info(
					`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Waiting for selector: ${selector} (timeout: ${selectorTimeout}ms)`,
				);
				await page
					.waitForSelector(selector, { timeout: selectorTimeout })
					.catch((error) => {
						this.logger.warn(
							`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Selector not found: ${selector}, but will try to interact anyway`,
						);
					});
			} else {
				// Check if the element exists first
				const elementExists = await page.evaluate((sel) => {
					return document.querySelector(sel) !== null;
				}, selector);

				if (!elementExists) {
					this.logger.warn(`Element not found without waiting: ${selector}`);
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

			// Add the field result to our results collection
			results.push({
				fieldType,
				selector,
				success: actionResult.success,
				details: actionResult.details,
			});

			// If the field failed and we're not continuing on failure, throw an error
			if (!actionResult.success && !continueOnFail) {
				throw new Error(
					`Failed to fill form field: ${selector} (type: ${fieldType}) - ${actionResult.error || "Unknown error"}`,
				);
			}
		}

		// Submit the form if requested
		let formSubmissionResult: IDataObject = {};
		let retryResults: IDataObject[] = [];

		if (submitFormAfterFill && submitSelector) {
			this.logger.info(
				`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Submitting form using selector: ${submitSelector}`,
			);

			if (retrySubmission) {
				// Use the retry utility
				const retrySubmissionResult = await retryFormSubmission(
					sessionId,
					submitSelector,
					{
						waitAfterSubmit: waitAfterSubmit as
							| "noWait"
							| "fixedTime"
							| "domContentLoaded"
							| "navigationComplete"
							| "urlChanged",
						waitTime,
						maxRetries,
						retryDelay,
					},
					this.logger,
				);

				formSubmissionResult = retrySubmissionResult.finalResult;
				retryResults = retrySubmissionResult.retryResults;

				// Update page reference if retry resulted in a new page object
				if (retrySubmissionResult.reconnectedPage) {
					page = retrySubmissionResult.reconnectedPage;
					this.logger.info(
						`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Updated local page reference from retry submission result.`,
					);
				}

				// Add the initial submission result
				results.push({
					fieldType: "formSubmission",
					success: formSubmissionResult.success,
					details: formSubmissionResult,
				});

				// Add retry results to the results array
				for (const retryResult of retryResults) {
					results.push({
						fieldType: "formSubmissionRetry",
						...retryResult,
					});
				}
			} else {
				// Simple submission without retry
				formSubmissionResult = await submitForm(
					sessionId,
					submitSelector,
					{
						waitAfterSubmit: waitAfterSubmit as
							| "noWait"
							| "fixedTime"
							| "domContentLoaded"
							| "navigationComplete"
							| "urlChanged",
						waitTime,
					},
					this.logger,
				);

				// Update page reference if submission resulted in a new page object
				if (formSubmissionResult.reconnectedPage) {
					page = formSubmissionResult.reconnectedPage as Page;
					this.logger.info(
						`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Updated local page reference from form submission result.`,
					);
				}

				// Add to results array
				results.push({
					fieldType: "formSubmission",
					success: formSubmissionResult.success,
					details: formSubmissionResult,
				});
			}
		}

		// Take a screenshot if requested
		let screenshot: string | null = null;
		if (takeScreenshotAfterSubmit) {
			this.logger.info(
				`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Attempting to take screenshot after submission.`,
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
						`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Screenshot captured successfully.`,
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
		}

		// Return the result data
		const resultData: IDataObject = {
			sessionId,
			formFields: results,
			currentUrl: page ? await page.url() : "Page unavailable",
			pageTitle: page ? await page.title() : "Page unavailable",
		};

		if (submitFormAfterFill) {
			resultData.formSubmission = formSubmissionResult;
		}

		if (screenshot) {
			resultData.screenshot = screenshot;
		}

		// Wait After Action Logic
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
				let waitPromise: Promise<any> | null = null;
				const waitTimeout = selectorTimeout; // Reuse selectorTimeout for wait

				switch (waitAfterAction) {
					case "element":
						if (!waitSelector) {
							throw new Error(
								'"Wait for Element" selected but no selector provided',
							);
						}
						this.logger.info(
							formatOperationLog(
								"Form",
								nodeName,
								nodeId,
								index,
								`Waiting for selector: ${waitSelector}`,
							),
						);
						waitPromise = page.waitForSelector(waitSelector, { timeout: waitTimeout });
						break;
					case "navFast":
						this.logger.info(
							formatOperationLog(
								"Form",
								nodeName,
								nodeId,
								index,
								`Waiting for navigation (fast - networkidle2)`,
							),
						);
						waitPromise = page.waitForNavigation({ waitUntil: "networkidle2", timeout: waitTimeout });
						break;
					case "navFull":
						this.logger.info(
							formatOperationLog(
								"Form",
								nodeName,
								nodeId,
								index,
								`Waiting for navigation (full - networkidle0)`,
							),
						);
						waitPromise = page.waitForNavigation({ waitUntil: "networkidle0", timeout: waitTimeout });
						break;
					case "fixed":
						this.logger.info(
							formatOperationLog(
								"Form",
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

		return this.helpers.returnJsonArray([
			resultData,
		]) as unknown as INodeExecutionData;
	} catch (error) {
		// Handle any errors
		this.logger.error(
			`[Ventriloquist][${nodeName}#${index}][Form][${nodeId}] Error: ${(error as Error).message}`,
		);

		// Take a screenshot for diagnostics if possible
		let errorScreenshot: string | null = null;
		try {
			if (page) {
				errorScreenshot = await takeScreenshot(page, this.logger);
			}
		} catch (screenshotError) {
			this.logger.warn(
				`Failed to take error screenshot: ${(screenshotError as Error).message}`,
			);
		}

		// Prepare error response data
		const errorResponseData = {
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
			return this.helpers.returnJsonArray([
				errorResponseData,
			]) as unknown as INodeExecutionData;
		}

		// If not continuing on fail, re-throw the original error
		// Attach context before throwing
		if (error instanceof Error) {
			(error as any).context = { sessionId, errorResponse: errorResponseData };
		}
		throw error;
	}
}
