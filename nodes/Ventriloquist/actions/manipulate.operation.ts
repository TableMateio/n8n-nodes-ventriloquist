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

// NOTE: Chrome policies are now used instead of trying to manipulate chrome://settings
// This is handled in LocalChromeTransport.setupChromePolicies()

/**
 * Automatically dismiss Chrome password breach detection popups
 */
async function dismissPasswordBreachPopup(page: Page, logger: any): Promise<void> {
	try {
		// Wait a bit for popup to appear
		await new Promise(resolve => setTimeout(resolve, 500));

		// Try multiple approaches to dismiss the popup
		const dismissed = await page.evaluate(() => {
			// Look for Chrome's password breach popup elements
			const selectors = [
				// Common button selectors for Chrome native popups
				'button[aria-label="OK"]',
				'button[aria-label="Change your password"]',
				'button:contains("OK")',
				'button:contains("Change")',
				'button:contains("Got it")',
				'button:contains("Dismiss")',
				'[role="button"]:contains("OK")',
				'[role="button"]:contains("Change")',
				// General dialog dismissal
				'[role="dialog"] button',
				'[data-testid*="ok"]',
				'[data-testid*="dismiss"]',
				'[data-testid*="close"]'
			];

			for (const selector of selectors) {
				try {
					// Try querySelector first
					let element = document.querySelector(selector);
					if (element && (element as HTMLElement).click) {
						(element as HTMLElement).click();
						return true;
					}

					// Try finding by text content
					const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
					for (const button of allButtons) {
						const text = button.textContent?.toLowerCase() || '';
						const ariaLabel = button.getAttribute('aria-label')?.toLowerCase() || '';

						if (text.includes('ok') || text.includes('change') || text.includes('got it') ||
							text.includes('dismiss') || ariaLabel.includes('ok') ||
							ariaLabel.includes('change') || ariaLabel.includes('dismiss')) {
							(button as HTMLElement).click();
							return true;
						}
					}
				} catch (e) {
					// Continue to next selector
				}
			}

			// Try pressing Escape key as last resort
			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 }));
			return false;
		});

		if (dismissed) {
			logger.info('Successfully dismissed password breach popup');
		}
	} catch (error) {
		// Silent fail - popup might not be present
		logger.debug('No password breach popup found to dismiss');
	}
}

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
						type: "multiOptions",
						options: [
							{
								name: "Right-Click (contextmenu)",
								value: "contextmenu",
								description: "Block right-click context menus",
							},
							{
								name: "Right Mouse Down",
								value: "mousedown_right",
								description: "Block right mouse button press events",
							},
							{
								name: "Right Mouse Up",
								value: "mouseup_right",
								description: "Block right mouse button release events",
							},
							{
								name: "Text Selection (selectstart)",
								value: "selectstart",
								description: "Block text selection initiation",
							},
							{
								name: "Copy (copy)",
								value: "copy",
								description: "Block copy operations",
							},
							{
								name: "Paste (paste)",
								value: "paste",
								description: "Block paste operations",
							},
							{
								name: "Cut (cut)",
								value: "cut",
								description: "Block cut operations",
							},
							{
								name: "Drag Start (dragstart)",
								value: "dragstart",
								description: "Block drag and drop initiation",
							},
							{
								name: "Key Down (keydown)",
								value: "keydown",
								description: "Block keyboard key press events",
							},
							{
								name: "All Mouse Events",
								value: "allmouse",
								description: "Block all mouse button events",
							},
						],
						default: ["contextmenu"],
						description: "Select which JavaScript events to intercept and block",
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
						{
							name: "Smart (Multi-Layered)",
							value: "smart",
							description: "Combines all strategies: immediate, DOM ready, delayed, and continuous monitoring for maximum effectiveness",
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
	events?: string | string[];
	targetSelectors?: string;
	timing: "immediate" | "domReady" | "delayed" | "waitForElement" | "continuous" | "smart";
	delayTime?: number;
	waitSelector?: string;
	customCode?: string;
}

/**
 * Expand special event types into their constituent events
 */
function expandEventList(eventList: string[]): string[] {
	const expandedEvents: string[] = [];

	for (const event of eventList) {
		switch (event) {
			case "mousedown_right":
				expandedEvents.push("mousedown");
				break;
			case "mouseup_right":
				expandedEvents.push("mouseup");
				break;
			case "allmouse":
				expandedEvents.push("mousedown", "mouseup", "click", "dblclick", "contextmenu");
				break;
			default:
				expandedEvents.push(event);
				break;
		}
	}

	// Remove duplicates
	return [...new Set(expandedEvents)];
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
		const manipulationScript = createRemoveScript(selector, action.timing === "continuous" || action.timing === "smart", persistence, action.timing);

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

	// Parse events (handle both string and array formats)
	let eventList: string[];
	if (Array.isArray(action.events)) {
		eventList = action.events;
	} else if (typeof action.events === 'string') {
		eventList = action.events.split(',').map(e => e.trim()).filter(Boolean);
	} else {
		eventList = [];
	}

	// Expand special event types
	const events = expandEventList(eventList);
	const targetSelectors = action.targetSelectors || "";

	// Handle timing
	await handleActionTiming(page, action, detectionOptions, logger);

			// Create the event blocking script
		const blockingScript = createBlockScript(eventList, targetSelectors, action.timing === "continuous" || action.timing === "smart", persistence, action.timing);

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

		case "smart":
			// Smart multi-layered timing is handled entirely in the script itself
			break;
	}
}

/**
 * Create the JavaScript code for removing elements
 */
function createRemoveScript(selector: string, continuous: boolean, persistence: string, timing?: string): string {
	// For smart timing, use the multi-layered racing strategy
	if (timing === "smart") {
		return createSmartRemoveScript(selector, persistence);
	}

	// For session-wide persistence, we need a more robust approach
	if (persistence === "session-wide") {
		return `
			(function() {
				console.log('[Manipulate] Session-wide remove script loaded for selector: ${selector}');

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

						if (removed > 0) {
							console.log('[Manipulate] Session-wide removal: ' + removed + ' elements matching: ${selector}');
						}
						return removed;
					} catch (error) {
						console.error('[Manipulate] Error removing elements:', error);
						return 0;
					}
				}

				function setupRemovalSystem() {
					// Remove elements immediately if they exist
					removeElements();

					// Set up MutationObserver for continuous monitoring
					if (!window.ventriloquistRemoveObserver_${selector.replace(/[^a-zA-Z0-9]/g, '_')}) {
						window.ventriloquistRemoveObserver_${selector.replace(/[^a-zA-Z0-9]/g, '_')} = new MutationObserver(function(mutations) {
							let shouldCheck = false;
							mutations.forEach(function(mutation) {
								if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
									// Check if any added nodes match our selector or contain matching elements
									for (let i = 0; i < mutation.addedNodes.length; i++) {
										const node = mutation.addedNodes[i];
										if (node.nodeType === 1) { // Element node
											if (node.matches && node.matches('${selector.replace(/'/g, "\\'")}')) {
												shouldCheck = true;
												break;
											}
											if (node.querySelector && node.querySelector('${selector.replace(/'/g, "\\'")}')) {
												shouldCheck = true;
												break;
											}
										}
									}
								}
							});

							if (shouldCheck) {
								// Small delay to let the element fully render
								setTimeout(removeElements, 50);
							}
						});

						// Observe the entire document for maximum coverage
						window.ventriloquistRemoveObserver_${selector.replace(/[^a-zA-Z0-9]/g, '_')}.observe(document.documentElement, {
							childList: true,
							subtree: true
						});

						console.log('[Manipulate] Set up session-wide MutationObserver for: ${selector}');
					}
				}

				// Wait for DOM to be ready before setting up the system
				if (document.readyState === 'loading') {
					document.addEventListener('DOMContentLoaded', setupRemovalSystem);
				} else {
					setupRemovalSystem();
				}

				// Also try periodically in case elements appear later
				let checkCount = 0;
				const periodicCheck = setInterval(function() {
					removeElements();
					checkCount++;
					if (checkCount >= 10) { // Stop after 10 checks (5 seconds)
						clearInterval(periodicCheck);
					}
				}, 500);

				return 0; // Return 0 for session-wide since we can't count elements reliably
			})();
		`;
	}

	// Original implementation for page-wide and one-time
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
 * Create the JavaScript code for smart multi-layered element removal
 * Implements the "racing strategy" with multiple timing approaches
 */
function createSmartRemoveScript(selector: string, persistence: string): string {
	const isSessionWide = persistence === "session-wide";
	const observerName = `ventriloquistSmartObserver_${selector.replace(/[^a-zA-Z0-9]/g, '_')}`;

	return `
		(function() {
			console.log('[Manipulate] Smart multi-layered removal system loading for: ${selector}');

			function removeElements(context) {
				try {
					const elements = document.querySelectorAll('${selector.replace(/'/g, "\\'")}');
					let removed = 0;

					elements.forEach(element => {
						if (element && element.parentNode) {
							element.remove();
							removed++;
						}
					});

					if (removed > 0) {
						console.log('[Manipulate] ' + context + ': Removed ' + removed + ' elements matching: ${selector}');
					}
					return removed;
				} catch (error) {
					console.error('[Manipulate] Error in removeElements:', error);
					return 0;
				}
			}

			function initSmartRemoval() {
				// === STRATEGY 1: Immediate Execution ===
				console.log('[Manipulate] Strategy 1: Immediate execution');
				removeElements('Immediate');

				// === STRATEGY 2: DOM Ready (if not already ready) ===
				if (document.readyState === 'loading') {
					document.addEventListener('DOMContentLoaded', function() {
						console.log('[Manipulate] Strategy 2: DOM ready execution');
						removeElements('DOM Ready');
					});
				} else {
					console.log('[Manipulate] Strategy 2: DOM already ready, executing now');
					removeElements('DOM Ready');
				}

				// === STRATEGY 3: Delayed Execution ===
				setTimeout(function() {
					console.log('[Manipulate] Strategy 3: Delayed execution (1 second)');
					removeElements('Delayed (1s)');
				}, 1000);

				// === STRATEGY 4: Continuous Monitoring (The Key to "Instant" Removal) ===
				if (!window.${observerName}) {
					console.log('[Manipulate] Strategy 4: Setting up continuous monitoring');

					window.${observerName} = new MutationObserver(function(mutations) {
						let shouldCheck = false;

						mutations.forEach(function(mutation) {
							if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
								// Check if any added nodes match our selector or contain matching elements
								for (let i = 0; i < mutation.addedNodes.length; i++) {
									const node = mutation.addedNodes[i];
									if (node.nodeType === 1) { // Element node
										if (node.matches && node.matches('${selector.replace(/'/g, "\\'")}')) {
											shouldCheck = true;
											break;
										}
										if (node.querySelector && node.querySelector('${selector.replace(/'/g, "\\'")}')) {
											shouldCheck = true;
											break;
										}
									}
								}
							}
						});

						if (shouldCheck) {
							// This is the "instant" removal - happens immediately when elements are added
							removeElements('Mutation Observer (Instant)');
						}
					});

					// Observe the entire document for maximum coverage
					window.${observerName}.observe(document.documentElement, {
						childList: true,
						subtree: true
					});

					console.log('[Manipulate] MutationObserver active - elements will be removed instantly when added');
				}

				// === STRATEGY 5: Periodic Fallback (Safety Net) ===
				let fallbackCount = 0;
				const fallbackInterval = setInterval(function() {
					removeElements('Periodic Fallback');
					fallbackCount++;
					if (fallbackCount >= 6) { // Stop after 6 checks (3 seconds)
						clearInterval(fallbackInterval);
						console.log('[Manipulate] Periodic fallback checks completed');
					}
				}, 500);
			}

			// Initialize the smart removal system
			${isSessionWide ? `
			// For session-wide persistence, ensure we set up on every page
			if (document.readyState === 'loading') {
				document.addEventListener('DOMContentLoaded', initSmartRemoval);
			} else {
				initSmartRemoval();
			}
			` : `
			// For page-wide, run immediately
			initSmartRemoval();
			`}

			return 0; // Return value for initial execution
		})();
	`;
}

/**
 * Create the JavaScript code for blocking events
 */
function createBlockScript(eventList: string[], targetSelectors: string, continuous: boolean, persistence: string, timing?: string): string {
	const targetsArray = targetSelectors ? targetSelectors.split(',').map(s => s.trim()).filter(Boolean) : [];
	const events = expandEventList(eventList);

	// For smart timing, use the multi-layered racing strategy
	if (timing === "smart") {
		return createSmartBlockScript(eventList, targetSelectors, persistence);
	}

	// For session-wide persistence, we need a more robust approach
	if (persistence === "session-wide") {
		return `
			(function() {
				console.log('[Manipulate] Session-wide event blocking script loaded for events: ${events.join(', ')}');

				const eventsToBlock = ${JSON.stringify(events)};
				const targetSelectors = ${JSON.stringify(targetsArray)};

								function setupEventBlocking() {
					eventsToBlock.forEach(function(eventType) {
						// Check if we should use document-wide blocking
						const shouldUseDocumentWide = targetSelectors.length === 0 ||
							targetSelectors.some(sel => sel.toLowerCase().trim() === 'body' || sel.toLowerCase().trim() === 'document' || sel.trim() === '');

						if (shouldUseDocumentWide) {
							// Block events document-wide (more effective for right-click blocking)
							if (!window.ventriloquistDocumentBlocked) {
								window.ventriloquistDocumentBlocked = {};
							}

							if (!window.ventriloquistDocumentBlocked[eventType]) {
																const eventHandler = function(e) {
									// Special filtering for right-click events
									if ((eventType === 'mousedown' || eventType === 'mouseup') && e.button !== 2) {
										return; // Only block right-click (button 2)
									}

									console.log('[Manipulate] Session-wide blocked ' + eventType + ' event document-wide');
									e.stopImmediatePropagation();
									// NOTE: NOT using preventDefault() to allow browser's default right-click menu
								};

								document.addEventListener(eventType, eventHandler, true);
								window.ventriloquistDocumentBlocked[eventType] = true;
								console.log('[Manipulate] Session-wide: Set up document-wide blocking for ' + eventType);
							}
						} else {
							// Block events on specific elements
							targetSelectors.forEach(function(selector) {
								try {
									const elements = document.querySelectorAll(selector);
									elements.forEach(function(element) {
										// Check if this element already has our blocking handler
										if (!element.ventriloquistEventBlocked) {
																						const eventHandler = function(e) {
												// Special filtering for right-click events
												if ((eventType === 'mousedown' || eventType === 'mouseup') && e.button !== 2) {
													return; // Only block right-click (button 2)
												}

												console.log('[Manipulate] Session-wide blocked ' + eventType + ' event on:', selector);
												e.stopImmediatePropagation();
												// NOTE: NOT using preventDefault() to allow browser's default right-click menu
											};

											element.addEventListener(eventType, eventHandler, true);
											element.ventriloquistEventBlocked = true;
										}
									});
								} catch (error) {
									console.error('[Manipulate] Error setting up event blocking for selector:', selector, error);
								}
							});
						}
					});
				}

				function setupBlockingSystem() {
					// Set up event blocking immediately
					setupEventBlocking();

					// Set up MutationObserver to block events on new elements
					if (targetSelectors.length > 0 && !window.ventriloquistBlockObserver_${events.join('_').replace(/[^a-zA-Z0-9]/g, '_')}) {
						window.ventriloquistBlockObserver_${events.join('_').replace(/[^a-zA-Z0-9]/g, '_')} = new MutationObserver(function(mutations) {
							let hasNewNodes = false;
							mutations.forEach(function(mutation) {
								if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
									hasNewNodes = true;
								}
							});

							if (hasNewNodes) {
								// Small delay to let elements fully render
								setTimeout(setupEventBlocking, 50);
							}
						});

						window.ventriloquistBlockObserver_${events.join('_').replace(/[^a-zA-Z0-9]/g, '_')}.observe(document.documentElement, {
							childList: true,
							subtree: true
						});

						console.log('[Manipulate] Set up session-wide MutationObserver for event blocking');
					}
				}

				// Wait for DOM to be ready before setting up the system
				if (document.readyState === 'loading') {
					document.addEventListener('DOMContentLoaded', setupBlockingSystem);
				} else {
					setupBlockingSystem();
				}

				return eventsToBlock;
			})();
		`;
	}

	// Original implementation for page-wide and one-time
	return `
		(function() {
			console.log('[Manipulate] Executing block action for events: ${events.join(', ')}');

			const eventsToBlock = ${JSON.stringify(events)};
			const targetSelectors = ${JSON.stringify(targetsArray)};

			function setupEventBlocking() {
				eventsToBlock.forEach(function(eventType) {
					// Check if we should use document-wide blocking
					const shouldUseDocumentWide = targetSelectors.length === 0 ||
						targetSelectors.some(sel => sel.toLowerCase().trim() === 'body' || sel.toLowerCase().trim() === 'document' || sel.trim() === '');

					if (shouldUseDocumentWide) {
						// Block events document-wide (more effective for right-click blocking)
												const eventHandler = function(e) {
							// Special filtering for right-click events
							if ((eventType === 'mousedown' || eventType === 'mouseup') && e.button !== 2) {
								return; // Only block right-click (button 2)
							}

							console.log('[Manipulate] Blocked ' + eventType + ' event document-wide');
							e.stopImmediatePropagation();
							// NOTE: NOT using preventDefault() to allow browser's default right-click menu
						};

						document.addEventListener(eventType, eventHandler, true);
						console.log('[Manipulate] Set up document-wide blocking for ' + eventType);
					} else {
						// Block events on specific elements
						targetSelectors.forEach(function(selector) {
							try {
								const elements = document.querySelectorAll(selector);
								elements.forEach(function(element) {
																		const eventHandler = function(e) {
										// Special filtering for right-click events
										if ((eventType === 'mousedown' || eventType === 'mouseup') && e.button !== 2) {
											return; // Only block right-click (button 2)
										}

										console.log('[Manipulate] Blocked ' + eventType + ' event on:', selector);
										e.stopImmediatePropagation();
										// NOTE: NOT using preventDefault() to allow browser's default right-click menu
									};

									element.addEventListener(eventType, eventHandler, true);
								});
							} catch (error) {
								console.error('[Manipulate] Error setting up event blocking for selector:', selector, error);
							}
						});
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
 * Create the JavaScript code for smart multi-layered event blocking
 * Implements the "racing strategy" with multiple timing approaches
 */
function createSmartBlockScript(eventList: string[], targetSelectors: string, persistence: string): string {
	const isSessionWide = persistence === "session-wide";
	const targetsArray = targetSelectors ? targetSelectors.split(',').map(s => s.trim()).filter(Boolean) : [];
	const events = expandEventList(eventList);
	const observerName = `ventriloquistSmartBlockObserver_${events.join('_').replace(/[^a-zA-Z0-9]/g, '_')}`;

	return `
		(function() {
			console.log('[Manipulate] Smart multi-layered event blocking system loading for: ${events.join(', ')}');

			const eventsToBlock = ${JSON.stringify(events)};
			const targetSelectors = ${JSON.stringify(targetsArray)};

						function setupEventBlocking(context) {
				try {
					eventsToBlock.forEach(function(eventType) {
						// Check if we should use document-wide blocking
						const shouldUseDocumentWide = targetSelectors.length === 0 ||
							targetSelectors.some(sel => sel.toLowerCase().trim() === 'body' || sel.toLowerCase().trim() === 'document' || sel.trim() === '');

						if (shouldUseDocumentWide) {
							// Block events document-wide (more effective for right-click blocking)
							if (!window.ventriloquistDocumentBlocked) {
								window.ventriloquistDocumentBlocked = {};
							}

							if (!window.ventriloquistDocumentBlocked[eventType]) {
																const eventHandler = function(e) {
									// Special filtering for right-click events
									if ((eventType === 'mousedown' || eventType === 'mouseup') && e.button !== 2) {
										return; // Only block right-click (button 2)
									}

									console.log('[Manipulate] ' + context + ': Blocked ' + eventType + ' event document-wide');
									e.stopImmediatePropagation();
									// NOTE: NOT using preventDefault() to allow browser's default right-click menu
								};

								document.addEventListener(eventType, eventHandler, true);
								window.ventriloquistDocumentBlocked[eventType] = true;
								console.log('[Manipulate] ' + context + ': Set up document-wide blocking for ' + eventType);
							}
						} else {
							// Block events on specific elements
							targetSelectors.forEach(function(selector) {
								try {
									const elements = document.querySelectorAll(selector);
									elements.forEach(function(element) {
										// Check if this element already has our blocking handler for this event
										const flagName = 'ventriloquistBlocked_' + eventType;
										if (!element[flagName]) {
																						const eventHandler = function(e) {
												// Special filtering for right-click events
												if ((eventType === 'mousedown' || eventType === 'mouseup') && e.button !== 2) {
													return; // Only block right-click (button 2)
												}

												console.log('[Manipulate] ' + context + ': Blocked ' + eventType + ' event on:', selector);
												e.stopImmediatePropagation();
												// NOTE: NOT using preventDefault() to allow browser's default right-click menu
											};

											element.addEventListener(eventType, eventHandler, true);
											element[flagName] = true;
										}
									});
								} catch (error) {
									console.error('[Manipulate] Error setting up event blocking for selector:', selector, error);
								}
							});
						}
					});
				} catch (error) {
					console.error('[Manipulate] Error in setupEventBlocking:', error);
				}
			}

			function initSmartBlocking() {
				// === STRATEGY 1: Immediate Execution ===
				console.log('[Manipulate] Strategy 1: Immediate event blocking setup');
				setupEventBlocking('Immediate');

				// === STRATEGY 2: DOM Ready (if not already ready) ===
				if (document.readyState === 'loading') {
					document.addEventListener('DOMContentLoaded', function() {
						console.log('[Manipulate] Strategy 2: DOM ready event blocking setup');
						setupEventBlocking('DOM Ready');
					});
				} else {
					console.log('[Manipulate] Strategy 2: DOM already ready, setting up event blocking now');
					setupEventBlocking('DOM Ready');
				}

				// === STRATEGY 3: Delayed Execution ===
				setTimeout(function() {
					console.log('[Manipulate] Strategy 3: Delayed event blocking setup (1 second)');
					setupEventBlocking('Delayed (1s)');
				}, 1000);

				// === STRATEGY 4: Continuous Monitoring for New Elements ===
				if (targetSelectors.length > 0 && !window.${observerName}) {
					console.log('[Manipulate] Strategy 4: Setting up continuous monitoring for new elements');

					window.${observerName} = new MutationObserver(function(mutations) {
						let hasNewNodes = false;
						mutations.forEach(function(mutation) {
							if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
								hasNewNodes = true;
							}
						});

						if (hasNewNodes) {
							// Setup event blocking on newly added elements
							setupEventBlocking('Mutation Observer (New Elements)');
						}
					});

					window.${observerName}.observe(document.documentElement, {
						childList: true,
						subtree: true
					});

					console.log('[Manipulate] MutationObserver active - new elements will have events blocked instantly');
				}

				// === STRATEGY 5: Periodic Fallback (Safety Net) ===
				let fallbackCount = 0;
				const fallbackInterval = setInterval(function() {
					setupEventBlocking('Periodic Fallback');
					fallbackCount++;
					if (fallbackCount >= 6) { // Stop after 6 checks (3 seconds)
						clearInterval(fallbackInterval);
						console.log('[Manipulate] Periodic event blocking fallback checks completed');
					}
				}, 500);
			}

			// Initialize the smart blocking system
			${isSessionWide ? `
			// For session-wide persistence, ensure we set up on every page
			if (document.readyState === 'loading') {
				document.addEventListener('DOMContentLoaded', initSmartBlocking);
			} else {
				initSmartBlocking();
			}
			` : `
			// For page-wide, run immediately
			initSmartBlocking();
			`}

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

								// NOTE: Password breach detection is disabled via Chrome preferences + WebUIDisableLeakDetection flag
		// Since this manipulate operation isn't used in current workflow, no additional popup handling needed here

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
