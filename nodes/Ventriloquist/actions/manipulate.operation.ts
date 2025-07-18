import type {
	IExecuteFunctions,
	INodeExecutionData,
	IDataObject,
	INodeProperties,
} from "n8n-workflow";
import type { Page } from "puppeteer-core";
import { SessionManager } from "../utils/sessionManager";
import {
	formatOperationLog,
	createSuccessResponse,
	createTimingLog,
} from "../utils/resultUtils";
import { createErrorResponse } from "../utils/errorUtils";
import { getActivePage } from "../utils/sessionUtils";
import { detectElement, smartWaitForSelector, type IDetectionOptions } from "../utils/detectionUtils";

/**
 * Manipulate operation description
 */
export const description: INodeProperties[] = [
	{
		displayName: "Session ID",
		name: "sessionId",
		type: "string",
		default: "",
		description:
			"Session ID to use (if not provided, will try to use session from previous operations)",
		displayOptions: {
			show: {
				operation: ["manipulate"],
			},
		},
	},
	{
		displayName: "Persistence Scope",
		name: "persistence",
		type: "options",
		options: [
			{
				name: "Session-Wide",
				value: "session-wide",
				description: "Apply to all future pages in this session automatically",
			},
			{
				name: "Page-Wide",
				value: "page-wide",
				description: "Apply to current page and persist through dynamic changes",
			},
			{
				name: "One-Time",
				value: "one-time",
				description: "Apply once to current page state only",
			},
		],
		default: "page-wide",
		description: "How long and where the manipulations should persist",
		displayOptions: {
			show: {
				operation: ["manipulate"],
			},
		},
	},
	{
		displayName: "Manipulation Actions",
		name: "actions",
		placeholder: "Add Action",
		type: "fixedCollection",
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		displayOptions: {
			show: {
				operation: ["manipulate"],
			},
		},
		description: "Define what manipulations to perform on the page",
		default: {
			action: [
				{
					actionType: "remove",
					selectors: "",
				},
			],
		},
		options: [
			{
				name: "action",
				displayName: "Action",
				values: [
					{
						displayName: "Action Type",
						name: "actionType",
						type: "options",
						options: [
							{
								name: "Remove Elements",
								value: "remove",
								description: "Remove DOM elements matching CSS selectors",
							},
							{
								name: "Block Events",
								value: "block",
								description: "Intercept and prevent JavaScript events",
							},
							{
								name: "Inject JavaScript (Future)",
								value: "inject",
								description: "Execute custom JavaScript code - Coming Soon",
							},
							{
								name: "Add Elements (Future)",
								value: "add",
								description: "Insert HTML elements into page - Coming Soon",
							},
							{
								name: "Change Attributes (Future)",
								value: "change",
								description: "Modify element attributes/styles - Coming Soon",
							},
						],
						default: "remove",
						description: "Type of manipulation to perform",
					},
					{
						displayName: "CSS Selectors",
						name: "selectors",
						type: "string",
						default: "",
						placeholder: ".modal, .popup, div[data-testid='overlay']",
						description: "CSS selectors for elements to remove (comma-separated for multiple)",
						displayOptions: {
							show: {
								actionType: ["remove"],
							},
						},
					},
					{
						displayName: "Events to Block",
						name: "events",
						type: "string",
						default: "contextmenu",
						placeholder: "contextmenu, mousedown, selectstart, copy, paste",
						description: "JavaScript events to intercept and block (comma-separated)",
						displayOptions: {
							show: {
								actionType: ["block"],
							},
						},
					},
					{
						displayName: "Target Selectors (Optional)",
						name: "targetSelectors",
						type: "string",
						default: "",
						placeholder: "body, .content-area",
						description: "Limit event blocking to specific elements (leave empty for document-wide)",
						displayOptions: {
							show: {
								actionType: ["block"],
							},
						},
					},
					{
						displayName: "Timing",
						name: "timing",
						type: "options",
						options: [
							{
								name: "Immediate",
								value: "immediate",
								description: "Execute immediately when script loads",
							},
							{
								name: "DOM Ready",
								value: "domReady",
								description: "Wait for DOM content to be loaded",
							},
							{
								name: "Delayed",
								value: "delayed",
								description: "Wait for specified time before executing",
							},
							{
								name: "Wait for Element",
								value: "waitForElement",
								description: "Wait for specific selector to appear first",
							},
							{
								name: "Continuous",
								value: "continuous",
								description: "Use MutationObserver for ongoing monitoring",
							},
						],
						default: "domReady",
						description: "When to execute this manipulation",
					},
					{
						displayName: "Delay Time (MS)",
						name: "delayTime",
						type: "number",
						default: 1000,
						description: "Time to wait in milliseconds before executing",
						displayOptions: {
							show: {
								timing: ["delayed"],
							},
						},
					},
					{
						displayName: "Wait Selector",
						name: "waitSelector",
						type: "string",
						default: "",
						placeholder: ".content-loaded, #main-content",
						description: "CSS selector to wait for before executing manipulation",
						displayOptions: {
							show: {
								timing: ["waitForElement"],
							},
						},
					},
					{
						displayName: "Custom JavaScript (Future)",
						name: "customCode",
						type: "string",
						typeOptions: {
							rows: 4,
						},
						default: "// Custom JavaScript code here\nconsole.log('Hello from injection!');",
						description: "Custom JavaScript code to execute - Feature coming soon",
						displayOptions: {
							show: {
								actionType: ["inject"],
							},
						},
					},
				],
			},
		],
	},
	{
		displayName: "Wait for Selectors",
		name: "waitForSelectors",
		type: "boolean",
		default: true,
		description: "Whether to wait for selectors to appear before performing manipulations",
		displayOptions: {
			show: {
				operation: ["manipulate"],
			},
		},
	},
	{
		displayName: "Detection Method",
		name: "detectionMethod",
		type: "options",
		options: [
			{
				name: "Smart Detection (DOM-Aware)",
				value: "smart",
				description: "Intelligently detects when page is fully loaded before checking elements",
			},
			{
				name: "Fixed Timeout",
				value: "fixed",
				description: "Simply waits for the specified timeout period",
			},
		],
		default: "smart",
		description: "Method to use when detecting elements",
		displayOptions: {
			show: {
				operation: ["manipulate"],
				waitForSelectors: [true],
			},
		},
	},
	{
		displayName: "Timeout",
		name: "selectorTimeout",
		type: "number",
		default: 5000,
		description: "Maximum time in milliseconds to wait for selectors to appear",
		displayOptions: {
			show: {
				operation: ["manipulate"],
				waitForSelectors: [true],
			},
		},
	},
	{
		displayName: "Early Exit Delay (MS)",
		name: "earlyExitDelay",
		type: "number",
		default: 500,
		description: "Time to wait after DOM loads before checking elements (Smart Detection only)",
		displayOptions: {
			show: {
				operation: ["manipulate"],
				waitForSelectors: [true],
				detectionMethod: ["smart"],
			},
		},
	},
];

/**
 * Interface for manipulation action
 */
interface IManipulateAction {
	actionType: "remove" | "block" | "inject" | "add" | "change";
	selectors?: string;
	events?: string;
	targetSelectors?: string;
	timing: "immediate" | "domReady" | "delayed" | "waitForElement" | "continuous";
	delayTime?: number;
	waitSelector?: string;
	customCode?: string;
}

/**
 * Execute a remove action to eliminate DOM elements
 */
async function executeRemoveAction(
	page: Page,
	action: IManipulateAction,
	detectionOptions: IDetectionOptions,
	logger: any,
	persistence: string,
): Promise<number> {
	if (!action.selectors) {
		logger.warn("Remove action has no selectors specified");
		return 0;
	}

	// Parse comma-separated selectors
	const selectors = action.selectors.split(',').map(s => s.trim()).filter(Boolean);
	let totalRemoved = 0;

	for (const selector of selectors) {
		logger.debug(`Processing remove selector: ${selector}`);

		// Handle timing
		await handleActionTiming(page, action, detectionOptions, logger);

		// Create the manipulation script based on persistence
		const manipulationScript = createRemoveScript(selector, action.timing === "continuous", persistence);

		try {
			if (persistence === "session-wide") {
				// Inject into all future pages using evaluateOnNewDocument
				await page.evaluateOnNewDocument(manipulationScript);
				logger.info(`Injected session-wide remove script for selector: ${selector}`);
			}

			// Execute on current page
			const removed = await page.evaluate(manipulationScript) as number;
			totalRemoved += removed;

			logger.info(`Removed ${removed} elements matching selector: ${selector}`);
		} catch (error) {
			logger.error(`Failed to execute remove action for selector "${selector}": ${(error as Error).message}`);
		}
	}

	return totalRemoved;
}

/**
 * Execute a block action to intercept JavaScript events
 */
async function executeBlockAction(
	page: Page,
	action: IManipulateAction,
	detectionOptions: IDetectionOptions,
	logger: any,
	persistence: string,
): Promise<string[]> {
	if (!action.events) {
		logger.warn("Block action has no events specified");
		return [];
	}

	// Parse comma-separated events
	const events = action.events.split(',').map(e => e.trim()).filter(Boolean);
	const targetSelectors = action.targetSelectors || "";

	// Handle timing
	await handleActionTiming(page, action, detectionOptions, logger);

	// Create the event blocking script
	const blockingScript = createBlockScript(events, targetSelectors, action.timing === "continuous", persistence);

	try {
		if (persistence === "session-wide") {
			// Inject into all future pages using evaluateOnNewDocument
			await page.evaluateOnNewDocument(blockingScript);
			logger.info(`Injected session-wide event blocking script for events: ${events.join(', ')}`);
		}

		// Execute on current page
		await page.evaluate(blockingScript);

		logger.info(`Blocked events: ${events.join(', ')} ${targetSelectors ? `on elements: ${targetSelectors}` : 'document-wide'}`);
		return events;
	} catch (error) {
		logger.error(`Failed to execute block action for events "${events.join(', ')}": ${(error as Error).message}`);
		return [];
	}
}

/**
 * Handle action timing requirements
 */
async function handleActionTiming(
	page: Page,
	action: IManipulateAction,
	detectionOptions: IDetectionOptions,
	logger: any,
): Promise<void> {
	switch (action.timing) {
		case "immediate":
			// No waiting needed
			break;

		case "domReady":
			// Wait for DOM to be ready
			await page.waitForFunction(() => document.readyState === 'complete' || document.readyState === 'interactive');
			break;

		case "delayed":
			// Wait for specified delay
			const delay = action.delayTime || 1000;
			await new Promise(resolve => setTimeout(resolve, delay));
			break;

		case "waitForElement":
			// Wait for specific element to appear
			if (action.waitSelector) {
				try {
					await smartWaitForSelector(
						page,
						action.waitSelector,
						detectionOptions.selectorTimeout,
						detectionOptions.earlyExitDelay,
						logger,
						detectionOptions.nodeName,
						detectionOptions.nodeId,
					);
				} catch (error) {
					logger.warn(`Failed to wait for element "${action.waitSelector}": ${(error as Error).message}`);
				}
			}
			break;

		case "continuous":
			// Continuous monitoring is handled in the script itself
			break;
	}
}

/**
 * Create the JavaScript code for removing elements
 */
function createRemoveScript(selector: string, continuous: boolean, persistence: string): string {
	return `
		(function() {
			console.log('[Manipulate] Executing remove action for selector: ${selector}');

			function removeElements() {
				try {
					const elements = document.querySelectorAll('${selector.replace(/'/g, "\\'")}');
					let removed = 0;

					elements.forEach(element => {
						if (element && element.parentNode) {
							element.remove();
							removed++;
						}
					});

					console.log('[Manipulate] Removed ' + removed + ' elements matching: ${selector}');
					return removed;
				} catch (error) {
					console.error('[Manipulate] Error removing elements:', error);
					return 0;
				}
			}

			// Execute immediately
			const initialRemoved = removeElements();

			${continuous || persistence === "page-wide" ? `
			// Set up MutationObserver for continuous monitoring
			if (!window.ventriloquistRemoveObserver) {
				window.ventriloquistRemoveObserver = new MutationObserver(function(mutations) {
					let hasNewNodes = false;
					mutations.forEach(function(mutation) {
						if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
							hasNewNodes = true;
						}
					});

					if (hasNewNodes) {
						removeElements();
					}
				});

				window.ventriloquistRemoveObserver.observe(document.body, {
					childList: true,
					subtree: true
				});

				console.log('[Manipulate] Set up MutationObserver for continuous element removal');
			}
			` : ''}

			return initialRemoved;
		})();
	`;
}

/**
 * Create the JavaScript code for blocking events
 */
function createBlockScript(events: string[], targetSelectors: string, continuous: boolean, persistence: string): string {
	const targetsArray = targetSelectors ? targetSelectors.split(',').map(s => s.trim()).filter(Boolean) : [];

	return `
		(function() {
			console.log('[Manipulate] Executing block action for events: ${events.join(', ')}');

			const eventsToBlock = ${JSON.stringify(events)};
			const targetSelectors = ${JSON.stringify(targetsArray)};

			function setupEventBlocking() {
				eventsToBlock.forEach(function(eventType) {
					if (targetSelectors.length > 0) {
						// Block events on specific elements
						targetSelectors.forEach(function(selector) {
							try {
								const elements = document.querySelectorAll(selector);
								elements.forEach(function(element) {
									element.addEventListener(eventType, function(e) {
										console.log('[Manipulate] Blocked ' + eventType + ' event on:', selector);
										e.stopImmediatePropagation();
										e.preventDefault();
									}, true);
								});
							} catch (error) {
								console.error('[Manipulate] Error setting up event blocking for selector:', selector, error);
							}
						});
					} else {
						// Block events document-wide
						document.addEventListener(eventType, function(e) {
							console.log('[Manipulate] Blocked ' + eventType + ' event document-wide');
							e.stopImmediatePropagation();
							// Don't preventDefault for document-wide to avoid breaking normal functionality
						}, true);
					}
				});
			}

			// Execute immediately
			setupEventBlocking();

			${continuous || persistence === "page-wide" ? `
			// Set up MutationObserver to block events on new elements
			if (!window.ventriloquistBlockObserver) {
				window.ventriloquistBlockObserver = new MutationObserver(function(mutations) {
					let hasNewNodes = false;
					mutations.forEach(function(mutation) {
						if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
							hasNewNodes = true;
						}
					});

					if (hasNewNodes && targetSelectors.length > 0) {
						setupEventBlocking();
					}
				});

				window.ventriloquistBlockObserver.observe(document.body, {
					childList: true,
					subtree: true
				});

				console.log('[Manipulate] Set up MutationObserver for continuous event blocking');
			}
			` : ''}

			return eventsToBlock;
		})();
	`;
}

/**
 * Execute the manipulate operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
): Promise<INodeExecutionData[]> {
	const startTime = Date.now();
	const items = this.getInputData();
	let sessionId = "";
	let page: Page | null = null;

	// Get parameters
	const explicitSessionId = this.getNodeParameter("sessionId", index, "") as string;
	const persistence = this.getNodeParameter("persistence", index, "page-wide") as string;
	const actions = this.getNodeParameter("actions.action", index, []) as IManipulateAction[];
	const waitForSelectors = this.getNodeParameter("waitForSelectors", index, true) as boolean;
	const detectionMethod = this.getNodeParameter("detectionMethod", index, "smart") as string;
	const selectorTimeout = this.getNodeParameter("selectorTimeout", index, 5000) as number;
	const earlyExitDelay = this.getNodeParameter("earlyExitDelay", index, 500) as number;

	const logger = this.logger;
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;

	logger.info(
		formatOperationLog(
			"Manipulate",
			nodeName,
			nodeId,
			index,
			`Starting manipulation - persistence: ${persistence}, actions: ${actions.length}`,
		),
	);

	try {
		// Get session ID from parameter or input data
		const effectiveSessionId = explicitSessionId || (items[index]?.json?.sessionId as string);
		if (!effectiveSessionId) {
			throw new Error("No session ID provided");
		}

		const session = SessionManager.getSession(effectiveSessionId);
		if (!session?.browser?.isConnected()) {
			throw new Error(`Invalid or disconnected browser session: ${effectiveSessionId}`);
		}

		page = await getActivePage(session.browser, logger);
		if (!page) {
			throw new Error(`No active page found for session: ${effectiveSessionId}`);
		}

		sessionId = effectiveSessionId;

		logger.debug(
			formatOperationLog(
				"Manipulate",
				nodeName,
				nodeId,
				index,
				`Got active page for session: ${sessionId}`,
			),
		);

		// Filter out future actions that aren't implemented yet
		const implementedActions = actions.filter(action =>
			action.actionType === "remove" || action.actionType === "block"
		);

		if (implementedActions.length === 0) {
			logger.warn(
				formatOperationLog(
					"Manipulate",
					nodeName,
					nodeId,
					index,
					"No implemented actions found (inject, add, change are coming soon)",
				),
			);
		}

		// Execute the manipulations
		let elementsRemoved = 0;
		const eventsBlocked: string[] = [];

		for (const action of implementedActions) {
			logger.info(
				formatOperationLog(
					"Manipulate",
					nodeName,
					nodeId,
					index,
					`Executing ${action.actionType} action with timing: ${action.timing}`,
				),
			);

			if (action.actionType === "remove") {
				const removed = await executeRemoveAction(page, action, {
					waitForSelectors,
					selectorTimeout,
					detectionMethod,
					earlyExitDelay,
					nodeName,
					nodeId,
					index,
				}, logger, persistence);
				elementsRemoved += removed;
			} else if (action.actionType === "block") {
				const blocked = await executeBlockAction(page, action, {
					waitForSelectors,
					selectorTimeout,
					detectionMethod,
					earlyExitDelay,
					nodeName,
					nodeId,
					index,
				}, logger, persistence);
				eventsBlocked.push(...blocked);
			}
		}

		const manipulationResults = {
			actionsExecuted: implementedActions.length,
			elementsRemoved,
			eventsBlocked,
			persistence,
			message: `Successfully executed ${implementedActions.length} manipulation actions`
		};

		logger.info(
			formatOperationLog(
				"Manipulate",
				nodeName,
				nodeId,
				index,
				`Manipulation completed - ${manipulationResults.actionsExecuted} actions executed`,
			),
		);

		// Create success response
		const successResponse = await createSuccessResponse({
			operation: "manipulate",
			sessionId,
			page,
			logger,
			startTime,
			takeScreenshot: false,
			additionalData: manipulationResults,
			inputData: items[index]?.json || {},
		});

		return [{ json: successResponse }];

	} catch (error) {
		logger.error(
			formatOperationLog(
				"Manipulate",
				nodeName,
				nodeId,
				index,
				`Manipulation failed: ${error instanceof Error ? error.message : String(error)}`,
			),
		);

		// Create error response
		const errorResponse = await createErrorResponse({
			error: error as Error,
			operation: "manipulate",
			sessionId,
			nodeId,
			nodeName,
			page,
			logger,
			takeScreenshot: false,
			startTime,
			additionalData: items[index]?.json || {},
		});

		return [{ json: errorResponse }];
	}
}
