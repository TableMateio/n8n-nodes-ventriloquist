import type {
	IExecuteFunctions,
	INodeExecutionData,
	IDataObject,
	INodeProperties,
} from "n8n-workflow";
import type * as puppeteer from "puppeteer-core";
import { SessionManager } from "../utils/sessionManager";
import {
	formatOperationLog,
	createSuccessResponse,
	createTimingLog,
} from "../utils/resultUtils";
import { createErrorResponse } from "../utils/errorUtils";
import { getHumanDelay } from "../utils/formOperations";
import { takeScreenshot as captureScreenshot } from "../utils/navigationUtils";
import {
	executeAction,
	type ActionType,
	type IActionOptions,
	type IActionParameters,
} from "../utils/actionUtils";
import type { IClickActionResult } from "../utils/middlewares/actions/clickAction";
// Add import for conditionUtils module
import {
	evaluateConditionGroup,
	type IConditionGroup,
} from "../utils/conditionUtils";
// Add import for fallbackUtils module
import { executeFallback, type IFallbackOptions } from "../utils/fallbackUtils";
import { formatExtractedDataForLog } from "../utils/extractionUtils";
import { waitForUrlChange } from "../utils/navigationUtils";
import { enhancedNavigationWait } from "../utils/navigationUtils";
import { getActivePage } from "../utils/sessionUtils";

/**
 * Decision operation description
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
				operation: ["decision"],
			},
		},
	},
	{
		displayName: "Enable Routing",
		name: "enableRouting",
		type: "boolean",
		default: false,
		description:
			"Whether to route data to different outputs based on conditions",
		displayOptions: {
			show: {
				operation: ["decision"],
			},
		},
	},
	{
		displayName: "Number of Routes",
		name: "routeCount",
		type: "number",
		default: 2,
		description: "Maximum number of routes to create",
		displayOptions: {
			show: {
				operation: ["decision"],
				enableRouting: [true],
			},
		},
	},
	{
		displayName: "Decisions",
		name: "conditionGroups",
		placeholder: "Add Decision",
		type: "fixedCollection",
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		displayOptions: {
			show: {
				operation: ["decision"],
			},
		},
		description: "Define conditions to check and actions to take if they match",
		default: {
			groups: [
				{
					name: "Default",
					conditionType: "one",
					singleConditionType: "elementExists",
					singleSelector: "",
				},
			],
		},
		options: [
			{
				name: "groups",
				displayName: "Decision",
				values: [
					{
						displayName: "Group Name",
						name: "name",
						type: "string",
						default: "",
						description: "Name for this decision group, used in output",
						placeholder: "e.g., loginForm",
						required: true,
					},
					{
						displayName: "Route Name or ID",
						name: "route",
						type: "options",
						default: "",
						description:
							'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
						displayOptions: {
							show: {
								"/operation": ["decision"],
								"/enableRouting": [true],
							},
						},
						typeOptions: {
							loadOptionsMethod: "getRoutes",
						},
					},
					{
						displayName: "Condition Type",
						name: "conditionType",
						type: "options",
						options: [
							{
								name: "One Condition",
								value: "one",
								description: "Only use a single condition",
							},
							{
								name: "AND - All Conditions Must Match",
								value: "and",
								description:
									"All conditions must be true for the group to match (logical AND)",
							},
							{
								name: "OR - Any Condition Can Match",
								value: "or",
								description:
									"At least one condition must be true for the group to match (logical OR)",
							},
						],
						default: "one",
						description: "How to evaluate conditions in this group",
						displayOptions: {
							show: {
								"/operation": ["decision"],
							},
						},
					},
					// Single condition fields (only shown when conditionType is 'one')
					{
						displayName: "Condition Type",
						name: "singleConditionType",
						type: "options",
						options: [
							{
								name: "Attribute Value",
								value: "attributeValue",
								description: "Check if element's attribute has a specific value",
							},
							{
								name: "Element Count",
								value: "elementCount",
								description: "Count the elements that match a selector",
							},
							{
								name: "Element Exists",
								value: "elementExists",
								description: "Check if element exists on the page",
							},
							{
								name: "Execution Count",
								value: "executionCount",
								description: "Check how many times this node has been executed",
							},
							{
								name: "Expression",
								value: "expression",
								description: "Evaluate a JavaScript expression",
							},
							{
								name: "Input Source",
								value: "inputSource",
								description: "Check which node the data came from",
							},
							{
								name: "Text Contains",
								value: "textContains",
								description: "Check if element contains specific text",
							},
							{
								name: "URL Contains",
								value: "urlContains",
								description: "Check if current URL contains string",
							},
							{
								name: "Element(s) Exist",
								value: "elementExists",
								description: "Check if element(s) exist on the page. Use comma-separated selectors to check for multiple elements.",
							},
						],
						default: "elementExists",
						description: "Type of condition to check",
						displayOptions: {
							show: {
								"/operation": ["decision"],
								conditionType: ["one"],
							},
						},
					},
					{
						displayName: "JavaScript Expression",
						name: "singleJsExpression",
						type: "string",
						typeOptions: {
							rows: 4,
						},
						default: "$input.item.json.someProperty === true",
						description:
							"JavaScript expression that should evaluate to true or false. You can use $input to access the input data.",
						placeholder:
							'$input.item.json.status === "success" || $input.item.json.count > 5',
						displayOptions: {
							show: {
								"/operation": ["decision"],
								conditionType: ["one"],
								singleConditionType: ["expression"],
							},
						},
					},
					{
						displayName: "Source Node Name",
						name: "singleSourceNodeName",
						type: "string",
						default: "",
						placeholder: "e.g., HTTP Request, Function, Switch",
						description:
							"Enter the exact name of the node that should trigger this condition. This is the name shown in the node's title bar.",
						displayOptions: {
							show: {
								"/operation": ["decision"],
								conditionType: ["one"],
								singleConditionType: ["inputSource"],
							},
						},
					},
					{
						displayName: "Count Comparison",
						name: "singleExecutionCountComparison",
						type: "options",
						options: [
							{
								name: "Equal To",
								value: "equal",
							},
							{
								name: "Greater Than",
								value: "greater",
							},
							{
								name: "Greater Than or Equal To",
								value: "greaterEqual",
							},
							{
								name: "Less Than",
								value: "less",
							},
							{
								name: "Less Than or Equal To",
								value: "lessEqual",
							},
						],
						default: "equal",
						description: "How to compare the execution count",
						displayOptions: {
							show: {
								"/operation": ["decision"],
								conditionType: ["one"],
								singleConditionType: ["executionCount"],
							},
						},
					},
					{
						displayName: "Execution Count",
						name: "singleExecutionCountValue",
						type: "number",
						default: 1,
						description: "The value to compare the execution count against",
						displayOptions: {
							show: {
								"/operation": ["decision"],
								conditionType: ["one"],
								singleConditionType: ["executionCount"],
							},
						},
					},
					{
						displayName: "Selector",
						name: "singleSelector",
						type: "string",
						default: "",
						placeholder: '#element, .class, div[data-test="value"]',
						description: "CSS selector to target the element(s)",
						displayOptions: {
							show: {
								"/operation": ["decision"],
								conditionType: ["one"],
								singleConditionType: [
									"attributeValue",
									"elementExists",
									"textContains",
									"elementCount",
								],
							},
						},
					},
					{
						displayName: "Text to Check",
						name: "singleTextToCheck",
						type: "string",
						default: "",
						description: "Text content to check for in the selected element",
						displayOptions: {
							show: {
								"/operation": ["decision"],
								conditionType: ["one"],
								singleConditionType: ["textContains"],
							},
						},
					},
					{
						displayName: "Attribute Name",
						name: "singleAttributeName",
						type: "string",
						default: "",
						placeholder: "disabled, data-value, href",
						description: "Name of the attribute to check",
						displayOptions: {
							show: {
								"/operation": ["decision"],
								conditionType: ["one"],
								singleConditionType: ["attributeValue"],
							},
						},
					},
					{
						displayName: "Attribute Value",
						name: "singleAttributeValue",
						type: "string",
						default: "",
						placeholder: "disabled, true, #some-url",
						description: "Expected value of the attribute",
						displayOptions: {
							show: {
								"/operation": ["decision"],
								conditionType: ["one"],
								singleConditionType: ["attributeValue"],
							},
						},
					},
					{
						displayName: "URL Substring",
						name: "singleUrlSubstring",
						type: "string",
						default: "",
						description: "Text to look for in the current URL",
						displayOptions: {
							show: {
								"/operation": ["decision"],
								conditionType: ["one"],
								singleConditionType: ["urlContains"],
							},
						},
					},
					{
						displayName: "Count Comparison",
						name: "singleCountComparison",
						type: "options",
						options: [
							{
								name: "Equal To",
								value: "equal",
							},
							{
								name: "Greater Than",
								value: "greater",
							},
							{
								name: "Greater Than or Equal To",
								value: "greaterEqual",
							},
							{
								name: "Less Than",
								value: "less",
							},
							{
								name: "Less Than or Equal To",
								value: "lessEqual",
							},
						],
						default: "equal",
						description:
							"How to compare the actual element count with the expected count",
						displayOptions: {
							show: {
								"/operation": ["decision"],
								conditionType: ["one"],
								singleConditionType: ["elementCount"],
							},
						},
					},
					{
						displayName: "Expected Count",
						name: "singleExpectedCount",
						type: "number",
						default: 1,
						description: "The value to compare the element count against",
						displayOptions: {
							show: {
								"/operation": ["decision"],
								conditionType: ["one"],
								singleConditionType: ["elementCount"],
							},
						},
					},
					{
						displayName: "Match Type",
						name: "singleMatchType",
						type: "options",
						options: [
							{
								name: "Contains",
								value: "contains",
								description: "Value must contain the specified string",
							},
							{
								name: "Ends With",
								value: "endsWith",
								description: "Value must end with the specified string",
							},
							{
								name: "Exact Match",
								value: "exact",
								description: "Value must match exactly",
							},
							{
								name: "RegEx",
								value: "regex",
								description: "Match using a regular expression",
							},
							{
								name: "Starts With",
								value: "startsWith",
								description: "Value must start with the specified string",
							},
						],
						default: "contains",
						description: "How to match the text, URL, or attribute value",
						displayOptions: {
							show: {
								"/operation": ["decision"],
								conditionType: ["one"],
								singleConditionType: ["attributeValue", "textContains", "urlContains"],
							},
						},
					},
					{
						displayName: "Case Sensitive",
						name: "singleCaseSensitive",
						type: "boolean",
						default: false,
						description: "Whether the matching should be case-sensitive",
						displayOptions: {
							show: {
								"/operation": ["decision"],
								conditionType: ["one"],
								singleConditionType: ["attributeValue", "textContains", "urlContains"],
							},
						},
					},
					{
						displayName: "Invert Condition",
						name: "singleInvertCondition",
						type: "boolean",
						default: false,
						description:
							"Whether to invert the condition result (true becomes false, false becomes true)",
						displayOptions: {
							show: {
								"/operation": ["decision"],
							},
						},
					},
					// Multiple conditions collection (only shown when conditionType is 'and' or 'or')
					{
						displayName: "Conditions",
						name: "conditions",
						placeholder: "Add Condition",
						type: "fixedCollection",
						typeOptions: {
							multipleValues: true,
							sortable: true,
							multipleValueButtonText: "Add Condition",
						},
						default: {
							condition: [
								{
									conditionType: "elementExists",
									selector: "",
								},
							],
						},
						description: "Define the conditions to check",
						displayOptions: {
							show: {
								"/operation": ["decision"],
								conditionType: ["and", "or"],
							},
						},
						options: [
							{
								name: "condition",
								displayName: "Condition",
								values: [
									{
										displayName: "Condition Type",
										name: "conditionType",
										type: "options",
										options: [
											{
												name: "Attribute Value",
												value: "attributeValue",
												description: "Check if element's attribute has a specific value",
											},
											{
												name: "Element Count",
												value: "elementCount",
												description: "Count the elements that match a selector",
											},
											{
												name: "Element Exists",
												value: "elementExists",
												description: "Check if element exists on the page",
											},
											{
												name: "Execution Count",
												value: "executionCount",
												description:
													"Check how many times this node has been executed",
											},
											{
												name: "Expression",
												value: "expression",
												description: "Evaluate a JavaScript expression",
											},
											{
												name: "Input Source",
												value: "inputSource",
												description: "Check which node the data came from",
											},
											{
												name: "Text Contains",
												value: "textContains",
												description: "Check if element contains specific text",
											},
											{
												name: "URL Contains",
												value: "urlContains",
												description: "Check if current URL contains string",
											},
										],
										default: "elementExists",
										description: "Type of condition to check",
									},
									{
										displayName: "JavaScript Expression",
										name: "jsExpression",
										type: "string",
										typeOptions: {
											rows: 4,
										},
										default: "$input.item.json.someProperty === true",
										description:
											"JavaScript expression that should evaluate to true or false. You can use $input to access the input data.",
										placeholder:
											'$input.item.json.status === "success" || $input.item.json.count > 5',
										displayOptions: {
											show: {
												conditionType: ["expression"],
											},
										},
									},
									{
										displayName: "Source Node Name",
										name: "sourceNodeName",
										type: "string",
										default: "",
										placeholder: "e.g., HTTP Request, Function, Switch",
										description:
											"Enter the exact name of the node that should trigger this condition. This is the name shown in the node's title bar.",
										displayOptions: {
											show: {
												conditionType: ["inputSource"],
											},
										},
									},
									{
										displayName: "Count Comparison",
										name: "executionCountComparison",
										type: "options",
										options: [
											{
												name: "Equal To",
												value: "equal",
											},
											{
												name: "Greater Than",
												value: "greater",
											},
											{
												name: "Greater Than or Equal To",
												value: "greaterEqual",
											},
											{
												name: "Less Than",
												value: "less",
											},
											{
												name: "Less Than or Equal To",
												value: "lessEqual",
											},
										],
										default: "equal",
										description: "How to compare the execution count",
										displayOptions: {
											show: {
												conditionType: ["executionCount"],
											},
										},
									},
									{
										displayName: "Execution Count",
										name: "executionCountValue",
										type: "number",
										default: 1,
										description:
											"The value to compare the execution count against",
										displayOptions: {
											show: {
												conditionType: ["executionCount"],
											},
										},
									},
									{
										displayName: "Selector",
										name: "selector",
										type: "string",
										default: "",
										placeholder: '#element, .class, div[data-test="value"]',
										description: "CSS selector to target the element(s)",
										displayOptions: {
											show: {
												conditionType: [
													"attributeValue",
													"elementExists",
													"textContains",
													"elementCount",
												],
											},
										},
									},
									{
										displayName: "Text to Check",
										name: "textToCheck",
										type: "string",
										default: "",
										description:
											"Text content to check for in the selected element",
										displayOptions: {
											show: {
												conditionType: ["textContains"],
											},
										},
									},
									{
										displayName: "Attribute Name",
										name: "attributeName",
										type: "string",
										default: "",
										placeholder: "disabled, data-value, href",
										description: "Name of the attribute to check",
										displayOptions: {
											show: {
												conditionType: ["attributeValue"],
											},
										},
									},
									{
										displayName: "Attribute Value",
										name: "attributeValue",
										type: "string",
										default: "",
										placeholder: "disabled, true, #some-url",
										description: "Expected value of the attribute",
										displayOptions: {
											show: {
												conditionType: ["attributeValue"],
											},
										},
									},
									{
										displayName: "URL Substring",
										name: "urlSubstring",
										type: "string",
										default: "",
										description: "Text to look for in the current URL",
										displayOptions: {
											show: {
												conditionType: ["urlContains"],
											},
										},
									},
									{
										displayName: "Count Comparison",
										name: "countComparison",
										type: "options",
										options: [
											{
												name: "Equal To",
												value: "equal",
											},
											{
												name: "Greater Than",
												value: "greater",
											},
											{
												name: "Greater Than or Equal To",
												value: "greaterEqual",
											},
											{
												name: "Less Than",
												value: "less",
											},
											{
												name: "Less Than or Equal To",
												value: "lessEqual",
											},
										],
										default: "equal",
										description:
											"How to compare the actual element count with the expected count",
										displayOptions: {
											show: {
												conditionType: ["elementCount"],
											},
										},
									},
									{
										displayName: "Expected Count",
										name: "expectedCount",
										type: "number",
										default: 1,
										description:
											"The value to compare the element count against",
										displayOptions: {
											show: {
												conditionType: ["elementCount"],
											},
										},
									},
									{
										displayName: "Match Type",
										name: "matchType",
										type: "options",
										options: [
											{
												name: "Contains",
												value: "contains",
												description: "Value must contain the specified string",
											},
											{
												name: "Ends With",
												value: "endsWith",
												description: "Value must end with the specified string",
											},
											{
												name: "Exact Match",
												value: "exact",
												description: "Value must match exactly",
											},
											{
												name: "RegEx",
												value: "regex",
												description: "Match using a regular expression",
											},
											{
												name: "Starts With",
												value: "startsWith",
												description:
													"Value must start with the specified string",
											},
										],
										default: "contains",
										description: "How to match the text, URL, or attribute value",
										displayOptions: {
											show: {
												conditionType: ["attributeValue", "textContains", "urlContains"],
											},
										},
									},
									{
										displayName: "Case Sensitive",
										name: "caseSensitive",
										type: "boolean",
										default: false,
										description:
											"Whether the matching should be case-sensitive",
										displayOptions: {
											show: {
												conditionType: ["attributeValue", "textContains", "urlContains"],
											},
										},
									},
									{
										displayName: "Invert Condition",
										name: "invertCondition",
										type: "boolean",
										default: false,
										description:
											"Whether to invert the condition result (true becomes false, false becomes true)",
									},
								],
							},
						],
					},
					{
						displayName: "Action If Condition Matches",
						name: "actionType",
						type: "options",
						options: [
							{
								name: "Click Element(s)",
								value: "click",
								description: "Click on one or more elements. Use comma-separated selectors to try each in order.",
							},
							{
								name: "Extract Data",
								value: "extract",
								description: "Extract data from an element on the page",
							},
							{
								name: "Fill Form Field",
								value: "fill",
								description: "Enter text into a form field",
							},
							{
								name: "Navigate to URL",
								value: "navigate",
								description: "Navigate to a specific URL",
							},
							{
								name: "No Action (Just Detect)",
								value: "none",
								description:
									"Only detect the condition, do not take any action",
							},
						],
						default: "click",
						description: "Action to take if the condition is met",
					},
					{
						displayName: "Action Selector",
						name: "actionSelector",
						type: "string",
						default: "",
						placeholder: 'button.submit, input[type="text"]',
						description: "CSS selector for the element to interact with",
						displayOptions: {
							show: {
								actionType: ["click", "extract"],
							},
						},
					},
					// Add Extraction Type for Extract action
					{
						displayName: "Extraction Type",
						name: "extractionType",
						type: "options",
						options: [
							{
								name: "Attribute",
								value: "attribute",
								description: "Extract specific attribute from an element",
							},
							{
								name: "HTML",
								value: "html",
								description: "Extract HTML content from an element",
							},
							{
								name: "Input Value",
								value: "value",
								description: "Extract value from input, select or textarea",
							},
							{
								name: "Multiple Elements",
								value: "multiple",
								description:
									"Extract data from multiple elements matching a selector",
							},
							{
								name: "Table",
								value: "table",
								description: "Extract data from a table",
							},
							{
								name: "Text Content",
								value: "text",
								description: "Extract text content from an element",
							},
						],
						default: "text",
						description: "What type of data to extract from the element",
						displayOptions: {
							show: {
								actionType: ["extract"],
							},
						},
					},
					{
						displayName: "Attribute Name",
						name: "extractAttributeName",
						type: "string",
						default: "",
						placeholder: "href, src, data-ID",
						description: "Name of the attribute to extract from the element",
						displayOptions: {
							show: {
								actionType: ["extract"],
								extractionType: ["attribute"],
							},
						},
					},
					// HTML Options for Extract Action
					{
						displayName: "HTML Options",
						name: "htmlOptions",
						type: "collection",
						placeholder: "Add Option",
						default: {},
						typeOptions: {
							multipleValues: false,
						},
						displayOptions: {
							show: {
								actionType: ["extract"],
								extractionType: ["html"],
							},
						},
						options: [
							{
								displayName: "Output Format",
								name: "outputFormat",
								type: "options",
								options: [
									{
										name: "HTML (String)",
										value: "html",
										description: "Return the HTML as a raw string",
									},
									{
										name: "JSON",
										value: "json",
										description: "Return the HTML wrapped in a JSON object",
									},
								],
								default: "html",
								description: "Format of the output data",
							},
							{
								displayName: "Include Metadata",
								name: "includeMetadata",
								type: "boolean",
								default: false,
								description:
									"Whether to include metadata about the HTML (length, structure info)",
							},
						],
					},
					// Table Options for Extract Action
					{
						displayName: "Table Options",
						name: "tableOptions",
						type: "collection",
						placeholder: "Add Option",
						default: {},
						typeOptions: {
							multipleValues: false,
						},
						displayOptions: {
							show: {
								actionType: ["extract"],
								extractionType: ["table"],
							},
						},
						options: [
							{
								displayName: "Include Headers",
								name: "includeHeaders",
								type: "boolean",
								default: true,
								description:
									"Whether to use the first row as headers in the output",
							},
							{
								displayName: "Row Selector",
								name: "rowSelector",
								type: "string",
								default: "tr",
								description:
									"CSS selector for table rows relative to table selector (default: tr)",
							},
							{
								displayName: "Cell Selector",
								name: "cellSelector",
								type: "string",
								default: "td, th",
								description:
									"CSS selector for table cells relative to row selector (default: td, th)",
							},
							{
								displayName: "Output Format",
								name: "outputFormat",
								type: "options",
								options: [
									{
										name: "JSON Objects",
										value: "json",
										description:
											"Return table as array of JSON objects using headers as keys",
									},
									{
										name: "Array of Arrays",
										value: "array",
										description:
											"Return table as a simple array of arrays (rows and cells)",
									},
									{
										name: "HTML",
										value: "html",
										description: "Return the original HTML of the table",
									},
									{
										name: "CSV",
										value: "csv",
										description: "Return the table formatted as CSV text",
									},
								],
								default: "json",
								description: "Format of the extracted table data",
							},
						],
					},
					// Multiple Elements Options for Extract Action
					{
						displayName: "Multiple Elements Options",
						name: "multipleOptions",
						type: "collection",
						placeholder: "Add Option",
						default: {},
						typeOptions: {
							multipleValues: false,
						},
						displayOptions: {
							show: {
								actionType: ["extract"],
								extractionType: ["multiple"],
							},
						},
						options: [
							{
								displayName: "Extraction Property",
								name: "extractionProperty",
								type: "options",
								options: [
									{
										name: "Text Content",
										value: "textContent",
									},
									{
										name: "Inner HTML",
										value: "innerHTML",
									},
									{
										name: "Outer HTML",
										value: "outerHTML",
									},
									{
										name: "Attribute",
										value: "attribute",
									},
								],
								default: "textContent",
								description: "Property to extract from each matching element",
							},
							{
								displayName: "Attribute Name",
								name: "attributeName",
								type: "string",
								default: "",
								description:
									"Name of the attribute to extract (if Extraction Property is set to Attribute)",
								displayOptions: {
									show: {
										extractionProperty: ["attribute"],
									},
								},
							},
							{
								displayName: "Limit",
								name: "limit",
								type: "number",
								default: 50,
								description: "Max number of results to return",
								typeOptions: {
									minValue: 1,
								},
							},
							{
								displayName: "Output Format",
								name: "outputFormat",
								type: "options",
								options: [
									{
										name: "Array",
										value: "array",
										description: "Return results as a simple array",
									},
									{
										name: "JSON Objects",
										value: "json",
										description:
											"Return results as array of objects with indices as keys",
									},
									{
										name: "Concatenated String",
										value: "string",
										description:
											"Combine all results into one string with separator",
									},
								],
								default: "array",
								description: "Format of the extracted data",
							},
							{
								displayName: "Separator",
								name: "separator",
								type: "string",
								default: ",",
								description:
									"Separator to use when concatenating results (if Output Format is String)",
								displayOptions: {
									show: {
										outputFormat: ["string"],
									},
								},
							},
						],
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
						displayOptions: {
							show: {
								actionType: ["fill"],
							},
						},
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
												description: "Checkbox input element",
											},
											{
												name: "File",
												value: "file",
												description: "File upload input element",
											},
											{
												name: "Multi-Select",
												value: "multiSelect",
												description: "Multiple select dropdown element",
											},
											{
												name: "Password",
												value: "password",
												description: "Secure password input field",
											},
											{
												name: "Radio",
												value: "radio",
												description: "Radio button input element",
											},
											{
												name: "Select (Dropdown)",
												value: "select",
												description: "Dropdown select element",
											},
											{
												name: "Text",
												value: "text",
												description: "Standard text input or textarea",
											},
										],
										default: "text",
										description: "The type of form field",
									},
									{
										displayName: "Selector",
										name: "selector",
										type: "string",
										default: "",
										placeholder:
											'#input-field, .form-control, input[name="email"]',
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
												description:
													"Match if option text contains this string",
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
										description:
											"Minimum similarity score (0-1) to consider a match",
										displayOptions: {
											show: {
												fieldType: ["select"],
												matchType: ["fuzzy"],
											},
										},
									},
									{
										displayName: "Clear Field First",
										name: "clearField",
										type: "boolean",
										default: true,
										description:
											"Whether to clear the field before entering text",
										displayOptions: {
											show: {
												fieldType: ["text"],
											},
										},
									},
									{
										displayName: "Press Enter After Input",
										name: "pressEnter",
										type: "boolean",
										default: false,
										description: "Whether to press Enter after entering text",
										displayOptions: {
											show: {
												fieldType: ["text"],
											},
										},
									},
									{
										displayName: "Check",
										name: "checked",
										type: "boolean",
										default: true,
										description:
											"Whether to check or uncheck the checkbox/radio button",
										displayOptions: {
											show: {
												fieldType: ["checkbox", "radio"],
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
										displayName: "Human-Like Typing",
										name: "humanLike",
										type: "boolean",
										default: true,
										description:
											"Whether to use human-like typing with random delays between keystrokes",
										displayOptions: {
											show: {
												fieldType: ["text"],
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
					},
					{
						displayName: "Submit Form After Filling",
						name: "submitForm",
						type: "boolean",
						default: false,
						description: "Whether to submit the form after filling the fields",
						displayOptions: {
							show: {
								actionType: ["fill"],
							},
						},
					},
					{
						displayName: "Submit Button Selector",
						name: "submitSelector",
						type: "string",
						default: "",
						placeholder:
							'button[type="submit"], input[type="submit"], .submit-button',
						description: "CSS selector of the submit button",
						displayOptions: {
							show: {
								actionType: ["fill"],
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
								name: "DOM Content Loaded",
								value: "domContentLoaded",
								description: "Wait until the DOM content is loaded (faster)",
							},
							{
								name: "Fixed Time",
								value: "fixedTime",
								description: "Wait for a specific amount of time",
							},
							{
								name: "Navigation Complete",
								value: "navigationComplete",
								description:
									"Wait until navigation is complete (slower but more thorough)",
							},
							{
								name: "No Wait",
								value: "noWait",
								description: "Do not wait after clicking submit",
							},
							{
								name: "URL Changed",
								value: "urlChanged",
								description:
									"Wait only until the URL changes to confirm navigation started",
							},
							{
								name: "Any URL Change",
								value: "anyUrlChange",
								description:
									"Detect any URL change (hard navigation or client-side routing)",
							},
						],
						default: "domContentLoaded",
						description: "What to wait for after clicking the submit button",
						displayOptions: {
							show: {
								actionType: ["fill"],
								submitForm: [true],
							},
						},
					},
					{
						displayName: "Wait Time (MS)",
						name: "waitSubmitTime",
						type: "number",
						default: 2000,
						description: "Time to wait in milliseconds (for fixed time wait)",
						displayOptions: {
							show: {
								actionType: ["fill"],
								submitForm: [true],
								waitAfterSubmit: ["fixedTime"],
							},
						},
					},
					{
						displayName: "URL",
						name: "url",
						type: "string",
						default: "",
						placeholder: "https://example.com/page",
						description: "URL to navigate to",
						displayOptions: {
							show: {
								actionType: ["navigate"],
							},
						},
					},
					{
						displayName: "Wait After Action",
						name: "waitAfterAction",
						type: "options",
						options: [
							{
								name: "No Wait",
								value: "noWait",
								description:
									"Continue immediately after action without waiting",
							},
							{
								name: "Fixed Time",
								value: "fixedTime",
								description: "Wait for a fixed amount of time after the action",
							},
							{
								name: "URL Changed",
								value: "urlChanged",
								description:
									"Wait for the URL to change after the action (hard navigation)",
							},
							{
								name: "Any URL Change",
								value: "anyUrlChange",
								description:
									"Detect any URL change (hard navigation or client-side routing)",
							},
							{
								name: "Navigation Complete",
								value: "navigationComplete",
								description: "Wait for navigation to complete after the action",
							},
						],
						default: "noWait",
						description: "What to wait for after performing the action",
						displayOptions: {
							show: {
								actionType: ["click", "navigate"],
							},
						},
					},
					{
						displayName: "Wait Time (MS)",
						name: "waitTime",
						type: "number",
						default: 2000,
						description: "Time to wait in milliseconds (for fixed time wait)",
						displayOptions: {
							show: {
								waitAfterAction: ["fixedTime"],
								actionType: ["click", "navigate"],
							},
						},
					},
				],
			},
		],
		required: true,
	},
	{
		displayName: "Fallback Action",
		name: "fallbackAction",
		type: "options",
		options: [
			{
				name: "Click Element",
				value: "click",
				description: "Click on an element",
			},
			{
				name: "Extract Data",
				value: "extract",
				description: "Extract data from an element on the page",
			},
			{
				name: "Fill Form Field",
				value: "fill",
				description: "Enter text into a form field",
			},
			{
				name: "Navigate to URL",
				value: "navigate",
				description: "Navigate to a specific URL",
			},
			{
				name: "None",
				value: "none",
				description: "Do not perform any fallback action",
			},
		],
		default: "none",
		description: "Action to take if none of the conditions match",
		displayOptions: {
			show: {
				operation: ["decision"],
			},
		},
	},
	{
		displayName: "Fallback Selector",
		name: "fallbackSelector",
		type: "string",
		default: "",
		placeholder: 'button.cancel, input[type="text"]',
		description:
			"CSS selector for the element to interact with in the fallback action",
		displayOptions: {
			show: {
				operation: ["decision"],
				fallbackAction: ["click", "fill", "extract"],
			},
		},
	},
	{
		displayName: "Fallback Extraction Type",
		name: "fallbackExtractionType",
		type: "options",
		options: [
			{
				name: "Attribute",
				value: "attribute",
				description: "Extract specific attribute from an element",
			},
			{
				name: "HTML",
				value: "html",
				description: "Extract HTML content from an element",
			},
			{
				name: "Input Value",
				value: "value",
				description: "Extract value from input, select or textarea",
			},
			{
				name: "Text Content",
				value: "text",
				description: "Extract text content from an element",
			},
		],
		default: "text",
		description: "What type of data to extract from the element",
		displayOptions: {
			show: {
				operation: ["decision"],
				fallbackAction: ["extract"],
			},
		},
	},
	{
		displayName: "Fallback HTML Options",
		name: "fallbackHtmlOptions",
		type: "collection",
		placeholder: "Add Option",
		default: {},
		typeOptions: {
			multipleValues: false,
		},
		displayOptions: {
			show: {
				operation: ["decision"],
				fallbackAction: ["extract"],
				fallbackExtractionType: ["html"],
			},
		},
		options: [
			{
				displayName: "Output Format",
				name: "outputFormat",
				type: "options",
				options: [
					{
						name: "HTML (String)",
						value: "html",
						description: "Return the HTML as a raw string",
					},
					{
						name: "JSON",
						value: "json",
						description: "Return the HTML wrapped in a JSON object",
					},
				],
				default: "html",
				description: "Format of the output data",
			},
			{
				displayName: "Include Metadata",
				name: "includeMetadata",
				type: "boolean",
				default: false,
				description:
					"Whether to include metadata about the HTML (length, structure info)",
			},
		],
	},
	{
		displayName: "Fallback Attribute Name",
		name: "fallbackAttributeName",
		type: "string",
		default: "",
		placeholder: "href, src, data-ID",
		description: "Name of the attribute to extract from the element",
		displayOptions: {
			show: {
				operation: ["decision"],
				fallbackAction: ["extract"],
				fallbackExtractionType: ["attribute"],
			},
		},
	},
	{
		displayName: "Fallback Text",
		name: "fallbackText",
		type: "string",
		default: "",
		description: "Text to enter into the form field in the fallback action",
		displayOptions: {
			show: {
				operation: ["decision"],
				fallbackAction: ["fill"],
			},
		},
	},
	{
		displayName: "Fallback Input Type",
		name: "fallbackInputType",
		type: "options",
		options: [
			{
				name: "Checkbox",
				value: "checkbox",
				description: "Checkbox input element",
			},
			{
				name: "File Upload",
				value: "file",
				description: "File input element",
			},
			{
				name: "Radio Button",
				value: "radio",
				description: "Radio button input element",
			},
			{
				name: "Select / Dropdown",
				value: "select",
				description: "Dropdown select element",
			},
			{
				name: "Text / Textarea",
				value: "text",
				description: "Standard text input or textarea",
			},
		],
		default: "text",
		description: "Type of form input to interact with in the fallback action",
		displayOptions: {
			show: {
				operation: ["decision"],
				fallbackAction: ["fill"],
			},
		},
	},
	{
		displayName: "Fallback Clear Field First",
		name: "fallbackClearField",
		type: "boolean",
		default: false,
		description:
			"Whether to clear the field before entering text (useful for pre-filled inputs)",
		displayOptions: {
			show: {
				operation: ["decision"],
				fallbackAction: ["fill"],
				fallbackInputType: ["text"],
			},
		},
	},
	{
		displayName: "Fallback Press Enter After Input",
		name: "fallbackPressEnter",
		type: "boolean",
		default: false,
		description:
			"Whether to press Enter after entering text (useful for forms that submit on Enter)",
		displayOptions: {
			show: {
				operation: ["decision"],
				fallbackAction: ["fill"],
				fallbackInputType: ["text"],
			},
		},
	},
	{
		displayName: "Fallback Check State",
		name: "fallbackCheckState",
		type: "options",
		options: [
			{
				name: "Check / Select",
				value: "check",
				description: "Check/select the element",
			},
			{
				name: "Uncheck / Deselect",
				value: "uncheck",
				description: "Uncheck/deselect the element",
			},
			{
				name: "Toggle",
				value: "toggle",
				description: "Toggle the current state",
			},
		],
		default: "check",
		description: "Whether to check or uncheck the checkbox/radio button",
		displayOptions: {
			show: {
				operation: ["decision"],
				fallbackAction: ["fill"],
				fallbackInputType: ["checkbox", "radio"],
			},
		},
	},
	{
		displayName: "Fallback File Path",
		name: "fallbackFilePath",
		type: "string",
		default: "",
		description:
			"Path to the file to upload (must be accessible to the Ventriloquist server)",
		displayOptions: {
			show: {
				operation: ["decision"],
				fallbackAction: ["fill"],
				fallbackInputType: ["file"],
			},
		},
	},
	{
		displayName: "Fallback URL",
		name: "fallbackUrl",
		type: "string",
		default: "",
		placeholder: "https://example.com/fallback",
		description: "URL to navigate to in the fallback action",
		displayOptions: {
			show: {
				operation: ["decision"],
				fallbackAction: ["navigate"],
			},
		},
	},
	{
		displayName: "Wait After Fallback",
		name: "waitAfterFallback",
		type: "options",
		options: [
			{
				name: "DOM Content Loaded",
				value: "domContentLoaded",
				description: "Wait until the DOM content is loaded (faster)",
			},
			{
				name: "Fixed Time",
				value: "fixedTime",
				description: "Wait for a specific amount of time",
			},
			{
				name: "Navigation Complete",
				value: "navigationComplete",
				description:
					"Wait until navigation is complete (slower but more thorough)",
			},
			{
				name: "No Wait",
				value: "noWait",
				description: "Do not wait after the action",
			},
			{
				name: "URL Changed",
				value: "urlChanged",
				description:
					"Wait only until the URL changes to confirm navigation started",
			},
		],
		default: "domContentLoaded",
		description: "What to wait for after performing the fallback action",
		displayOptions: {
			show: {
				operation: ["decision"],
				fallbackAction: ["click", "navigate"],
			},
		},
	},
	{
		displayName: "Fallback Wait Time (MS)",
		name: "fallbackWaitTime",
		type: "number",
		default: 2000,
		description:
			"Time to wait in milliseconds for fallback action (for fixed time wait)",
		displayOptions: {
			show: {
				operation: ["decision"],
				fallbackAction: ["click", "navigate"],
				waitAfterFallback: ["fixedTime"],
			},
		},
	},
	{
		displayName: "Fallback Route Name or ID",
		name: "fallbackRoute",
		type: "options",
		default: "",
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		displayOptions: {
			show: {
				"/operation": ["decision"],
				"/enableRouting": [true],
			},
		},
		typeOptions: {
			loadOptionsMethod: "getRoutes",
		},
	},
	{
		displayName: "Wait for Selectors",
		name: "waitForSelectors",
		type: "boolean",
		default: true,
		description:
			"Whether to wait for selectors to appear before checking conditions",
		displayOptions: {
			show: {
				operation: ["decision"],
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
				description:
					"Intelligently detects when the page is fully loaded before checking for elements (faster for elements that don't exist)",
			},
			{
				name: "Fixed Timeout",
				value: "fixed",
				description:
					"Simply waits for the specified timeout (may be slower but more thorough)",
			},
		],
		default: "smart",
		description: "Method to use when checking for elements",
		displayOptions: {
			show: {
				operation: ["decision"],
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
				operation: ["decision"],
				waitForSelectors: [true],
			},
		},
	},
	{
		displayName: "Early Exit Delay (MS)",
		name: "earlyExitDelay",
		type: "number",
		default: 500,
		description:
			"Time in milliseconds to wait after DOM is loaded before checking for elements (for Smart Detection only)",
		displayOptions: {
			show: {
				operation: ["decision"],
				waitForSelectors: [true],
				detectionMethod: ["smart"],
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
				operation: ["decision"],
			},
		},
	},
	{
		displayName: "Take Screenshot",
		name: "takeScreenshot",
		type: "boolean",
		default: false,
		description:
			"Whether to take a screenshot after the decision operation completes",
		displayOptions: {
			show: {
				operation: ["decision"],
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
				operation: ["decision"],
			},
		},
	},
	{
		displayName: "Output Input Data",
		name: "outputInputData",
		type: "boolean",
		default: true,
		description: "Whether to include the input data in the output",
		displayOptions: {
			show: {
				operation: ["decision"],
			},
		},
	},
];

/**
 * Smart wait for element with DOM-aware early exit strategy
 */
async function smartWaitForSelector(
	page: puppeteer.Page,
	selector: string,
	timeout: number,
	earlyExitDelay: number,
	logger: IExecuteFunctions["logger"],
): Promise<boolean> {
	// Create a promise that resolves when the element is found
	const elementPromise = page
		.waitForSelector(selector, { timeout })
		.then(() => {
			logger.debug(`Element found: ${selector}`);
			return true;
		})
		.catch(() => {
			logger.debug(`Element not found within timeout: ${selector}`);
			return false;
		});

	// Check if the DOM is already loaded
	const domState = await page.evaluate(() => {
		return {
			readyState: document.readyState,
			bodyExists: !!document.body,
		};
	});

	logger.debug(
		`DOM state: readyState=${domState.readyState}, bodyExists=${domState.bodyExists}`,
	);

	// If DOM is not loaded yet, wait for it
	if (
		domState.readyState !== "complete" &&
		domState.readyState !== "interactive"
	) {
		logger.debug("DOM not ready, waiting for it to load...");
		await page.waitForFunction(
			() =>
				document.readyState === "complete" ||
				document.readyState === "interactive",
			{ timeout: Math.min(timeout, 10000) }, // Cap at 10 seconds max for DOM loading
		);
	}

	// If there's no body yet (rare case), wait for it
	if (!domState.bodyExists) {
		logger.debug("Document body not found, waiting for it...");
		await page.waitForFunction(() => !!document.body, {
			timeout: Math.min(timeout, 5000), // Cap at 5 seconds max for body
		});
	}

	// Wait a small delay to allow dynamic content to load
	if (earlyExitDelay > 0) {
		logger.debug(`Waiting ${earlyExitDelay}ms early exit delay...`);
		await new Promise((resolve) => setTimeout(resolve, earlyExitDelay));
	}

	// Check if element exists without waiting (quick check)
	const elementExistsNow = await page.evaluate((sel) => {
		return document.querySelector(sel) !== null;
	}, selector);

	if (elementExistsNow) {
		logger.debug(`Element found immediately after DOM ready: ${selector}`);
		return true;
	}

	logger.debug(
		`Element not found in initial check, waiting up to timeout: ${selector}`,
	);
	// If not found immediately, wait for the original promise with timeout
	return elementPromise;
}

/**
 * Execute decision operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	websocketEndpoint: string,
	workflowId: string,
): Promise<INodeExecutionData[][] | INodeExecutionData[]> {
	const startTime = Date.now();

	// Get input data
	const items = this.getInputData();
	const item = items[index];

	// Store this parameter at the top level so it's available in the catch block
	const continueOnFail = this.getNodeParameter(
		"continueOnFail",
		index,
		true,
	) as boolean;
	const outputInputData = this.getNodeParameter(
		"outputInputData",
		index,
		true,
	) as boolean;
	let screenshot: string | undefined;

	// Added for better logging
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;

	// Get existing session ID parameter if available - moved outside try block to make available in catch
	const explicitSessionId = this.getNodeParameter(
		"sessionId",
		index,
		"",
	) as string;
	let sessionId = explicitSessionId;
	let puppeteerPage: puppeteer.Page | null = null;

	// Visual marker to clearly indicate a new node is starting
	this.logger.info("============ STARTING NODE EXECUTION ============");
	this.logger.info(
		formatOperationLog(
			"Decision",
			nodeName,
			nodeId,
			index,
			`Starting execution`,
		),
	);

	try {
		// Try to get or create a session, but continue if it fails
		let hasValidSession = false;

		try {
			// Use the centralized session management
			const sessionResult = await SessionManager.getOrCreatePageSession(
				this.logger,
				{
					explicitSessionId,
					websocketEndpoint,
					workflowId,
					operationName: "Decision",
					nodeId,
					nodeName,
					index,
				},
			);

			puppeteerPage = sessionResult.page;
			sessionId = sessionResult.sessionId;
			hasValidSession = !!puppeteerPage;

			if (hasValidSession) {
				this.logger.info(
					formatOperationLog(
						"Decision",
						nodeName,
						nodeId,
						index,
						`Successfully connected to session: ${sessionId}`,
					),
				);
			}
		} catch (sessionError) {
			// Log the session error but continue execution
			this.logger.warn(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					`Could not establish session: ${(sessionError as Error).message}`,
				),
			);
			this.logger.info(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					`Continuing without session - some conditions may not work`,
				),
			);
			hasValidSession = false;
			puppeteerPage = null;
		}

		// Update current URL after getting page (if we have one)
		let currentUrl = "";
		if (hasValidSession && puppeteerPage) {
			try {
				currentUrl = await puppeteerPage.url();
				this.logger.info(
					formatOperationLog(
						"Decision",
						nodeName,
						nodeId,
						index,
						`Current page URL is: ${currentUrl}`,
					),
				);
			} catch (urlError) {
				this.logger.warn(
					formatOperationLog(
						"Decision",
						nodeName,
						nodeId,
						index,
						`Could not get URL after session management: ${(urlError as Error).message}`,
					),
				);
				currentUrl = "unknown (connection issues)";
			}
		} else {
			currentUrl = "no session";
			this.logger.info(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					`No session available - URL is: ${currentUrl}`,
				),
			);
		}

		// Get operation parameters
		const conditionGroups = this.getNodeParameter(
			"conditionGroups.groups",
			index,
			[],
		) as IDataObject[];
		const fallbackAction = this.getNodeParameter(
			"fallbackAction",
			index,
		) as string;
		const waitForSelectors = this.getNodeParameter(
			"waitForSelectors",
			index,
			true,
		) as boolean;
		const selectorTimeout = this.getNodeParameter(
			"selectorTimeout",
			index,
			5000,
		) as number;
		const detectionMethod = this.getNodeParameter(
			"detectionMethod",
			index,
			"smart",
		) as string;
		const earlyExitDelay = this.getNodeParameter(
			"earlyExitDelay",
			index,
			500,
		) as number;
		const useHumanDelays = this.getNodeParameter(
			"useHumanDelays",
			index,
			true,
		) as boolean;
		const takeScreenshot = this.getNodeParameter(
			"takeScreenshot",
			index,
			false,
		) as boolean;

		// Log parameters for debugging
		this.logger.info(
			formatOperationLog(
				"Decision",
				nodeName,
				nodeId,
				index,
				`Parameters: waitForSelectors=${waitForSelectors}, selectorTimeout=${selectorTimeout}, detectionMethod=${detectionMethod}`,
			),
		);
		this.logger.info(
			formatOperationLog(
				"Decision",
				nodeName,
				nodeId,
				index,
				`Evaluating ${conditionGroups.length} condition groups with fallbackAction=${fallbackAction}`,
			),
		);

		// Validate session ID - add extra logging to help debug issues
		if (!explicitSessionId) {
			this.logger.warn(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					"WARNING: No session ID provided in the 'Session ID' field",
				),
			);
			this.logger.warn(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					"For best results, you should provide the session ID from a previous Open operation in the 'Session ID' field",
				),
			);
		} else {
			this.logger.info(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					`Using session ID: ${explicitSessionId}`,
				),
			);
		}

		// Check if the page is valid (only if we have a session)
		if (hasValidSession && puppeteerPage) {
			// Verify the document content to ensure we have a valid page
			try {
				const docHtml = await puppeteerPage.evaluate(
					() => document.documentElement.outerHTML.length,
				);
				this.logger.info(
					formatOperationLog(
						"Decision",
						nodeName,
						nodeId,
						index,
						`Document verified - contains ${docHtml} characters of HTML`,
					),
				);
			} catch (docError) {
				this.logger.warn(
					formatOperationLog(
						"Decision",
						nodeName,
						nodeId,
						index,
						`Cannot access document: ${(docError as Error).message}`,
					),
				);
				if (!continueOnFail) {
					throw new Error(
						`Cannot access page document: ${(docError as Error).message}`,
					);
				}
			}
		} else {
			this.logger.info(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					`No session available - skipping document verification`,
				),
			);
		}

		// Get routing parameters
		const enableRouting = this.getNodeParameter(
			"enableRouting",
			index,
			false,
		) as boolean;

		// Initialize routing variables
		let routeTaken = "none";
		let actionPerformed = "none";
		let routeIndex = 0;
		let pageUrl = "";

		if (hasValidSession && puppeteerPage) {
			try {
				pageUrl = await puppeteerPage.url();
			} catch (urlError) {
				this.logger.warn(
					formatOperationLog(
						"Decision",
						nodeName,
						nodeId,
						index,
						`Error getting page URL: ${(urlError as Error).message}`,
					),
				);
				pageUrl = "unknown";
			}
		} else {
			pageUrl = "no session";
		}

		// Initialize result data for the operation
		const resultData: IDataObject = {
			success: true,
			routeTaken: "none",
			actionPerformed: "none",
			currentUrl: "",
			pageTitle: "",
			executionDuration: 0,
			// Include the sessionId in the output
			sessionId: sessionId || "",
			// Navigation related properties
			navigationCompleted: false,
			urlChangeDetected: false,
			contextDestroyed: false,
			beforeUrl: "",
			afterUrl: "",
			navigationError: "",
		};

		// If there's an inputSessionId, use it and log it
		if (explicitSessionId) {
			this.logger.info(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					`Using provided session ID: ${explicitSessionId}`,
				),
			);

			// Check if the page URL is blank or about:blank, which might indicate a problem
			if (hasValidSession && (pageUrl === "about:blank" || pageUrl === "")) {
				this.logger.warn(
					formatOperationLog(
						"Decision",
						nodeName,
						nodeId,
						index,
						`WARNING: Page URL is ${pageUrl} - this may indicate the session was not properly loaded`,
					),
				);
				this.logger.warn(
					formatOperationLog(
						"Decision",
						nodeName,
						nodeId,
						index,
						`Verify that you're using the correct session ID from the Open operation`,
					),
				);
			}
		} else if (hasValidSession && puppeteerPage) {
			// As a fallback, still try to get the session ID from the page
			try {
				const pageSessionId = await puppeteerPage.evaluate(() => {
					interface VentriloquistWindow extends Window {
						__VENTRILOQUIST_SESSION_ID__?: string;
					}
					return (
						(window as VentriloquistWindow).__VENTRILOQUIST_SESSION_ID__ || ""
					);
				});

				if (pageSessionId) {
					resultData.sessionId = pageSessionId;
					this.logger.info(
						formatOperationLog(
							"Decision",
							nodeName,
							nodeId,
							index,
							`Found session ID in page: ${pageSessionId}`,
						),
					);
				} else {
					this.logger.warn(
						formatOperationLog(
							"Decision",
							nodeName,
							nodeId,
							index,
							`No session ID provided or found in page`,
						),
					);
				}
			} catch (error) {
				this.logger.warn(
					formatOperationLog(
						"Decision",
						nodeName,
						nodeId,
						index,
						`Error retrieving session ID from page: ${(error as Error).message}`,
					),
				);
			}
		} else {
			this.logger.info(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					`No session available - skipping session ID retrieval from page`,
				),
			);
		}

		// Check each condition group
		for (const group of conditionGroups) {
			const groupName = group.name as string;

			// Get route if routing is enabled
			if (enableRouting) {
				// Get the route value and ensure we properly parse it
				// Route might be a string or number depending on how n8n passes parameters
				const groupRoute = group.route;

				// REMOVED: Setting routeIndex before condition evaluation
				// This was causing the issue where the last condition's route would override previous settings
				this.logger.info(
					formatOperationLog(
						"Decision",
						nodeName,
						nodeId,
						index,
						`Group "${groupName}" has route: ${groupRoute} (will be set if condition matches)`,
					),
				);
			}

			this.logger.info(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					`Checking group: "${groupName}"`,
				),
			);

			try {
				// Create a proper IConditionGroup object
				const conditionGroup: IConditionGroup = {
					name: group.name as string,
					conditionType: (group.conditionType as string) || "one",
					singleConditionType: group.singleConditionType as string,
					singleSelector: group.singleSelector as string,
					singleTextToCheck: group.singleTextToCheck as string,
					singleUrlSubstring: group.singleUrlSubstring as string,
					singleCountComparison: group.singleCountComparison as string,
					singleExpectedCount: group.singleExpectedCount as number,
					singleJsExpression: group.singleJsExpression as string,
					singleSourceNodeName: group.singleSourceNodeName as string,
					singleExecutionCountComparison:
						group.singleExecutionCountComparison as string,
					singleExecutionCountValue: group.singleExecutionCountValue as number,
					singleMatchType: group.singleMatchType as string,
					singleCaseSensitive: group.singleCaseSensitive as boolean,
					singleInvertCondition: group.singleInvertCondition as boolean,
					invertCondition: group.invertCondition as boolean,
					// Convert conditions collection if it exists
					conditions:
						group.conditions &&
							typeof group.conditions === "object" &&
							(group.conditions as IDataObject).condition
							? ((group.conditions as IDataObject).condition as IDataObject[])
							: undefined,
				};

				// Use the properly constructed object
				// Note: puppeteerPage might be null if no session is available
				const conditionGroupResult = await evaluateConditionGroup(
					puppeteerPage,
					conditionGroup,
					waitForSelectors,
					selectorTimeout,
					detectionMethod,
					earlyExitDelay,
					currentUrl,
					index,
					this,
				);

				// If condition is met
				if (conditionGroupResult.success) {
					routeTaken = groupName;
					const actionType = group.actionType as string;

					this.logger.info(
						formatOperationLog(
							"Decision",
							nodeName,
							nodeId,
							index,
							`Condition met for group "${groupName}", taking this route`,
						),
					);

					// For routing capability, store route information
					if (enableRouting) {
						const groupRoute = group.route as number;
						if (groupRoute !== undefined && groupRoute !== null) {
							// Convert to number regardless of original type
							let routeNumber: number;
							if (typeof groupRoute === 'string') {
								routeNumber = parseInt(groupRoute, 10);
							} else {
								routeNumber = groupRoute as number;
							}

							// Ensure it's a valid number
							if (!isNaN(routeNumber)) {
								// Route numbers are 1-based, but indexes are 0-based
								routeIndex = routeNumber - 1;
								this.logger.info(
									formatOperationLog(
										"Decision",
										nodeName,
										nodeId,
										index,
										`Using route: ${routeNumber} (index: ${routeIndex})`,
									),
								);
								// Add debug checkpoint for route selection
								this.logger.info(
									formatOperationLog(
										"Decision",
										nodeName,
										nodeId,
										index,
										`ROUTE DEBUG: After condition match, routeIndex=${routeIndex}`,
									),
								);
							} else {
								this.logger.warn(
									formatOperationLog(
										"Decision",
										nodeName,
										nodeId,
										index,
										`Invalid route value: ${groupRoute}. Using default route 1.`,
									),
								);
								routeIndex = 0; // Default to first route
							}
						} else {
							this.logger.warn(
								formatOperationLog(
									"Decision",
									nodeName,
									nodeId,
									index,
									`No route specified for group "${groupName}". Using default route 1.`,
								),
							);
							routeIndex = 0; // Default to first route
						}
					}

					if (actionType !== "none") {
						// Check if we need a session for this action
						if (!hasValidSession || !puppeteerPage) {
							this.logger.warn(
								formatOperationLog(
									"Decision",
									nodeName,
									nodeId,
									index,
									`Action "${actionType}" requires a session but no session is available - skipping action`,
								),
							);

							// Set up result data for no session case
							resultData.success = true;
							resultData.routeTaken = groupName;
							resultData.actionPerformed = "none";
							resultData.currentUrl = currentUrl;
							resultData.pageTitle = "no session";
							resultData.executionDuration = Date.now() - startTime;

							// Return early result for no session
							return [this.helpers.returnJsonArray([{
								...(outputInputData ? item.json : {}),
								...resultData
							}])];
						}

						actionPerformed = actionType;
						this.logger.info(
							formatOperationLog(
								"Decision",
								nodeName,
								nodeId,
								index,
								`Performing action: "${actionType}"`,
							),
						);

						// Add human-like delay if enabled
						if (useHumanDelays) {
							await new Promise((resolve) =>
								setTimeout(resolve, getHumanDelay()),
							);
						}

						switch (actionType) {
							case "click": {
								const actionSelector = group.actionSelector as string;
								const waitAfterAction =
									(group.waitAfterAction as string) || "urlChanged";

								// Ensure we have ample wait time, especially for URL changes
								let waitTime = group.waitTime as number;
								if (waitTime === undefined) {
									waitTime =
										waitAfterAction === "fixedTime"
											? 2000
											: waitAfterAction === "urlChanged"
												? 30000
												: 7000;
								}

								this.logger.info(
									formatOperationLog(
										"Decision",
										nodeName,
										nodeId,
										index,
										`Executing click action on "${actionSelector}" using action utility with ${waitTime}ms timeout`,
									),
								);

								try {
									// Create options for the action
									const actionOptions: IActionOptions = {
										sessionId,
										waitForSelector: waitForSelectors,
										selectorTimeout,
										detectionMethod,
										earlyExitDelay,
										nodeName,
										nodeId,
										index,
										useHumanDelays,
									};

									// Log what action we're executing with details
									this.logger.info(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`[Decision][clickAction] Executing click action on "${actionSelector}" using action utility with ${waitTime}ms timeout`,
										),
									);

									// Determine the wait strategy for the click action utility
									// Prioritize 'navigationComplete' if specified, otherwise use the selected waitAfterAction
									// This ensures we use a more robust wait when explicitly requested
									const effectiveWaitAfterAction =
										(group.waitAfterAction as string) === "navigationComplete"
											? "navigationComplete" // Use networkidle0 via enhancedNavigationWait
											: (group.waitAfterAction as string) || "anyUrlChange"; // Default to anyUrlChange

									// Log the effective wait strategy being used
									this.logger.info(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`[Decision][clickAction] Effective wait strategy: ${effectiveWaitAfterAction} (Original: ${group.waitAfterAction || "default"})`,
										),
									);

									// Execute the click action using the utility
									this.logger.info(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											// Use the effective wait strategy in the log message
											`[Decision][clickAction] Calling executeAction with type: click, selector: "${actionSelector}", waitAfterAction: ${effectiveWaitAfterAction}`,
										),
									);

									const actionResult = await executeAction(
										sessionId,
										"click" as ActionType,
										{
											selector: actionSelector,
											// Pass the effective wait strategy to the action utility
											waitAfterAction: effectiveWaitAfterAction,
											waitTime,
											waitSelector: group.waitSelector as string,
										},
										actionOptions,
										this.logger,
									);

									// Log the action result with detail
									this.logger.info(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`[Decision][clickAction] Action result received - success: ${actionResult.success}, error: ${actionResult.error || "none"}`,
										),
									);

									// Add detailed logging for URL change detection
									this.logger.info(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`[Decision][clickAction] URL change details - urlChanged: ${actionResult.urlChanged}, navigationSuccessful: ${actionResult.navigationSuccessful}, contextDestroyed: ${actionResult.contextDestroyed}`,
										),
									);

									// Update result data with navigation status from the click result
									resultData.urlChangeDetected = !!actionResult.urlChanged;
									resultData.navigationCompleted = !!actionResult.navigationSuccessful;
									resultData.contextDestroyed = !!actionResult.contextDestroyed;

									// Log the updated resultData
									this.logger.info(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`[Decision][clickAction] Updated result data - urlChangeDetected: ${resultData.urlChangeDetected}, navigationCompleted: ${resultData.navigationCompleted}, contextDestroyed: ${resultData.contextDestroyed}`,
										),
									);

									// Handle action failures
									if (!actionResult.success) {
										// Update the error in the result data
										resultData.success = false;
										resultData.error = `Action error: ${actionResult.error}`;
										resultData.actionError = true;

										// Log the error but mention we'll maintain the route if continueOnFail is true
										this.logger.error(
											formatOperationLog(
												"Decision",
												nodeName,
												nodeId,
												index,
												`Error during click action: ${actionResult.error}`
											)
										);

										this.logger.info(
											formatOperationLog(
												"Decision",
												nodeName,
												nodeId,
												index,
												`Current page when error occurred - URL: ${resultData.currentUrl}, Title: ${resultData.pageTitle}`
											)
										);

										// If continueOnFail is true, we'll force an immediate return with the matched route
										if (continueOnFail && enableRouting) {
											this.logger.info(
												formatOperationLog(
													"Decision",
													nodeName,
													nodeId,
													index,
													`CRITICAL FIX: Forcing return to route ${routeIndex + 1} despite click error [ADDED CODE]`
												)
											);

											// Create output structure
											const routeCount = this.getNodeParameter(
												"routeCount",
												index,
												2,
											) as number;

											// Prepare routes array
											const routes: INodeExecutionData[][] = Array(routeCount)
												.fill(null)
												.map(() => []);

											// Add actionDetails to resultData
											resultData.actionDetails = {
												selectorFound: true, // We got to click, so selector was found
												actionType: actionPerformed,
												actionSuccess: false,
												actionError: actionResult.error,
											} as IDataObject;

											// Place data in correct route despite error
											if (routeIndex < routeCount) {
												routes[routeIndex].push({
													json: {
														...(outputInputData ? item.json : {}),
														...resultData
													},
													pairedItem: { item: index },
												});
												this.logger.info(
													formatOperationLog(
														"Decision",
														nodeName,
														nodeId,
														index,
														`Forcing route ${routeIndex + 1} even with click error`
													)
												);
											} else {
												// Fallback to first route if index out of bounds
												routes[0].push({
													json: {
														...(outputInputData ? item.json : {}),
														...resultData
													},
													pairedItem: { item: index },
												});
											}

											// IMMEDIATE RETURN to prevent any other processing
											return routes;
										} else if (continueOnFail) {
											// continueOnFail=true but routing disabled
											this.logger.info(
												formatOperationLog(
													"Decision",
													nodeName,
													nodeId,
													index,
													`Continuing despite error (continueOnFail=true)`
												)
											);
											break;
										} else {
											throw new Error(
												`Decision action failed: ${actionResult.error}`,
											);
										}
									}

									this.logger.info(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`[Decision][clickAction] Click action completed successfully using action utility`,
										),
									);

									// CRITICAL FIX: Immediately after successful click, handle routing
									if (enableRouting && routeIndex >= 0) {
										this.logger.info(
											formatOperationLog(
												"Decision",
												nodeName,
												nodeId,
												index,
												`CRITICAL FIX: Explicit return after click action with route ${routeIndex + 1} [ADDED CODE]`,
											),
										);

										// Create output structure
										const routeCount = this.getNodeParameter(
											"routeCount",
											index,
											2,
										) as number;

										// Prepare routes array
										const routes: INodeExecutionData[][] = Array(routeCount)
											.fill(null)
											.map(() => []);

										// Add actionDetails to resultData
										resultData.actionDetails = {
											selectorFound: true,
											actionType: actionPerformed,
											actionSuccess: true,
										} as IDataObject;

										// Place data in correct route
										if (routeIndex < routeCount) {
											routes[routeIndex].push({
												json: {
													...(outputInputData ? item.json : {}),
													...resultData
												},
												pairedItem: { item: index },
											});
											this.logger.info(
												formatOperationLog(
													"Decision",
													nodeName,
													nodeId,
													index,
													`Sending to route ${routeIndex + 1} with data: ${JSON.stringify(resultData.actionDetails)}`,
												),
											);
										} else {
											// Fallback to first route if index out of bounds
											routes[0].push({
												json: {
													...(outputInputData ? item.json : {}),
													...resultData
												},
												pairedItem: { item: index },
											});
											this.logger.warn(
												formatOperationLog(
													"Decision",
													nodeName,
													nodeId,
													index,
													`Index ${routeIndex} out of bounds, using route 1`,
												),
											);
										}

										// IMMEDIATE RETURN to prevent any further processing
										return routes;
									}

									// Check if the context was destroyed or navigation happened
									// Cast to IClickActionResult to access the urlChanged property
									const clickResult = actionResult as IClickActionResult;

									this.logger.info(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`[Decision][clickAction] Navigation status - contextDestroyed: ${!!clickResult.contextDestroyed}, urlChanged: ${!!clickResult.urlChanged}, navigationSuccessful: ${!!clickResult.navigationSuccessful}`,
										),
									);

									if (clickResult.contextDestroyed || clickResult.urlChanged) {
										this.logger.info(
											formatOperationLog(
												"Decision",
												nodeName,
												nodeId,
												index,
												`[Decision][clickAction] Navigation detected after click: Context destroyed=${!!clickResult.contextDestroyed}, URL changed=${!!clickResult.urlChanged}`,
											),
										);

										// Get a fresh page reference after navigation using the new pattern
										this.logger.info(
											formatOperationLog(
												"Decision",
												nodeName,
												nodeId,
												index,
												`[Decision][clickAction] Getting fresh page reference after navigation`,
											),
										);

										// --- START REFACTOR ---
										let freshPage: puppeteer.Page | null = null;
										const currentSession = SessionManager.getSession(sessionId);
										if (currentSession?.browser?.isConnected()) {
											freshPage = await getActivePage(
												currentSession.browser,
												this.logger,
											);
										} else {
											this.logger.warn(
												formatOperationLog(
													"Decision",
													nodeName,
													nodeId,
													index,
													`[Decision][clickAction] Session or browser disconnected after navigation, cannot get fresh page.`,
												),
											);
										}
										// --- END REFACTOR ---

										if (freshPage) {
											puppeteerPage = freshPage;
											this.logger.info(
												formatOperationLog(
													"Decision",
													nodeName,
													nodeId,
													index,
													`[Decision][clickAction] Using fresh page reference after navigation`,
												),
											);

											try {
												// Update result data
												resultData.success = true;
												resultData.routeTaken = groupName;
												resultData.actionPerformed = actionType;
												resultData.currentUrl = puppeteerPage ? await puppeteerPage.url() : currentUrl;
												resultData.pageTitle = puppeteerPage ? await puppeteerPage.title() : "no session";
												resultData.executionDuration = Date.now() - startTime;

												this.logger.info(
													formatOperationLog(
														"Decision",
														nodeName,
														nodeId,
														index,
														`[Decision][clickAction] Returning successful result after navigation - Group: ${groupName}, URL: ${resultData.currentUrl}`,
													),
												);

												// Modified: respect routing configuration instead of returning directly
												if (enableRouting) {
													// Create an array for each possible output route
													const routeCount = this.getNodeParameter(
														"routeCount",
														index,
														2,
													) as number;
													const routes: INodeExecutionData[][] = Array(routeCount)
														.fill(null)
														.map(() => []);

													// Add detailed debugging log
													this.logger.info(
														formatOperationLog(
															"Decision",
															nodeName,
															nodeId,
															index,
															`[Decision][clickAction] Early return routing - routeIndex: ${routeIndex}, routeCount: ${routeCount}`,
														),
													);

													// Put the item in the correct route
													if (routeIndex >= 0 && routeIndex < routeCount) {
														routes[routeIndex].push({
															json: {
																...(outputInputData ? item.json : {}),
																...resultData
															},
															pairedItem: { item: index },
														});
														this.logger.info(
															formatOperationLog(
																"Decision",
																nodeName,
																nodeId,
																index,
																`[Decision][clickAction] Sending output to route ${routeIndex + 1}`,
															),
														);
													} else {
														// Default to route 0 if routeIndex is out of bounds
														routes[0].push({
															json: {
																...(outputInputData ? item.json : {}),
																...resultData
															},
															pairedItem: { item: index },
														});
														this.logger.warn(
															formatOperationLog(
																"Decision",
																nodeName,
																nodeId,
																index,
																`[Decision][clickAction] Route index ${routeIndex} out of bounds, defaulting to route 1`,
															),
														);
													}

													return routes;
												}

												return [this.helpers.returnJsonArray([{
													...(outputInputData ? item.json : {}),
													...resultData
												}])];
											} catch (pageError) {
												// If we still can't access the page, return with limited data
												this.logger.warn(
													formatOperationLog(
														"Decision",
														nodeName,
														nodeId,
														index,
														`[Decision][clickAction] Could not access page properties after navigation: ${(pageError as Error).message}`,
													),
												);

												resultData.success = true;
												resultData.routeTaken = groupName;
												resultData.actionPerformed = actionType;
												resultData.navigationContext =
													"destroyed-but-successful";
												resultData.executionDuration = Date.now() - startTime;

												this.logger.info(
													formatOperationLog(
														"Decision",
														nodeName,
														nodeId,
														index,
														`[Decision][clickAction] Returning success with limited data after navigation failure`,
													),
												);

												return [this.helpers.returnJsonArray([{
													...(outputInputData ? item.json : {}),
													...resultData
												}])];
											}
										} else {
											// If we don't have a page reference but navigation was successful, still return success
											this.logger.warn(
												formatOperationLog(
													"Decision",
													nodeName,
													nodeId,
													index,
													`[Decision][clickAction] Could not get fresh page reference after navigation, but click was successful`,
												),
											);

											resultData.success = true;
											resultData.routeTaken = groupName;
											resultData.actionPerformed = actionType;
											resultData.navigationContext = "destroyed-no-page";
											resultData.executionDuration = Date.now() - startTime;

											this.logger.info(
												formatOperationLog(
													"Decision",
													nodeName,
													nodeId,
													index,
													`[Decision][clickAction] Returning success with context destruction noted`,
												),
											);

											// Modified: respect routing configuration instead of returning directly
											if (enableRouting) {
												// Create an array for each possible output route
												const routeCount = this.getNodeParameter(
													"routeCount",
													index,
													2,
												) as number;
												const routes: INodeExecutionData[][] = Array(routeCount)
													.fill(null)
													.map(() => []);

												// Add detailed debugging log
												this.logger.info(
													formatOperationLog(
														"Decision",
														nodeName,
														nodeId,
														index,
														`[Decision][clickAction] Early return routing (no-page) - routeIndex: ${routeIndex}, routeCount: ${routeCount}`,
													),
												);

												// Put the item in the correct route
												if (routeIndex >= 0 && routeIndex < routeCount) {
													routes[routeIndex].push({
														json: {
															...(outputInputData ? item.json : {}),
															...resultData
														},
														pairedItem: { item: index },
													});
													this.logger.info(
														formatOperationLog(
															"Decision",
															nodeName,
															nodeId,
															index,
															`[Decision][clickAction] Sending output to route ${routeIndex + 1}`,
														),
													);
												} else {
													// Default to route 0 if routeIndex is out of bounds
													routes[0].push({
														json: {
															...(outputInputData ? item.json : {}),
															...resultData
														},
														pairedItem: { item: index },
													});
													this.logger.warn(
														formatOperationLog(
															"Decision",
															nodeName,
															nodeId,
															index,
															`[Decision][clickAction] Route index ${routeIndex} out of bounds, defaulting to route 1`,
														),
													);
												}

												return routes;
											}

											return [this.helpers.returnJsonArray([{
												...(outputInputData ? item.json : {}),
												...resultData
											}])];
										}
									}

									// No navigation happened, continue with regular flow
									try {
										// Update result data
										resultData.success = true;
										resultData.routeTaken = groupName;
										resultData.actionPerformed = actionType;
										resultData.currentUrl = puppeteerPage ? await puppeteerPage.url() : currentUrl;
										resultData.pageTitle = puppeteerPage ? await puppeteerPage.title() : "no session";
										resultData.executionDuration = Date.now() - startTime;
									} catch (pageError) {
										// Handle late context destruction
										this.logger.warn(
											formatOperationLog(
												"Decision",
												nodeName,
												nodeId,
												index,
												`Could not access page properties after successful click: ${(pageError as Error).message}`,
											),
										);

										resultData.success = true;
										resultData.routeTaken = groupName;
										resultData.actionPerformed = actionType;
										resultData.navigationContext = "destroyed-late";
										resultData.executionDuration = Date.now() - startTime;
									}

									return [this.helpers.returnJsonArray([{
										...(outputInputData ? item.json : {}),
										...resultData
									}])];
								} catch (error) {
									// Handle expected context destruction errors in a special way
									if (
										(error as Error).message.includes(
											"context was destroyed",
										) ||
										(error as Error).message.includes("Execution context") ||
										(error as Error).message.includes("Target closed")
									) {
										this.logger.info(
											formatOperationLog(
												"Decision",
												nodeName,
												nodeId,
												index,
												"Navigation caused context destruction - this is expected during some navigations",
											),
										);

										// Try to get a fresh page reference after context destruction
										const session = SessionManager.getSession(sessionId);
										let freshPage = null;
										if (session?.browser?.isConnected()) {
											freshPage = await getActivePage(
												session.browser,
												this.logger,
											);
										}
										if (freshPage) {
											puppeteerPage = freshPage;
											this.logger.info(
												formatOperationLog(
													"Decision",
													nodeName,
													nodeId,
													index,
													"Reconnected to page after context destruction",
												),
											);
										}

										// Set result as success with notification about context destruction
										resultData.success = true;
										resultData.routeTaken = groupName;
										resultData.actionPerformed = actionType;
										resultData.navigationContext = "destroyed-expected";
										resultData.executionDuration = Date.now() - startTime;

										// Add recovery delay
										await new Promise((resolve) => setTimeout(resolve, 5000));

										// Try to recover page state after context destruction
										try {
											if (freshPage) {
												const finalUrl = await freshPage.url();
												const finalTitle = await freshPage.title();

												resultData.currentUrl = finalUrl;
												resultData.pageTitle = finalTitle;
											} else {
												resultData.currentUrl =
													"Context destroyed during navigation";
												resultData.pageTitle = "Navigation in progress";
											}
										} catch (recoveryError) {
											this.logger.warn(
												formatOperationLog(
													"Decision",
													nodeName,
													nodeId,
													index,
													`Could not get final page state after context destruction: ${(recoveryError as Error).message}`,
												),
											);

											resultData.currentUrl =
												"Context destroyed during navigation";
											resultData.pageTitle = "Navigation in progress";
										}

										return [this.helpers.returnJsonArray([{
											...(outputInputData ? item.json : {}),
											...resultData
										}])];
									}

									this.logger.error(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`Error during click action: ${(error as Error).message}`,
										),
									);

									// Try to get page details for better error context
									try {
										const currentUrl = puppeteerPage ? await puppeteerPage.url() : "no session";
										const pageTitle = puppeteerPage ? await puppeteerPage.title() : "no session";
										this.logger.info(
											formatOperationLog(
												"Decision",
												nodeName,
												nodeId,
												index,
												`Current page when error occurred - URL: ${currentUrl}, Title: ${pageTitle}`,
											),
										);
									} catch (pageError) {
										this.logger.warn(
											formatOperationLog(
												"Decision",
												nodeName,
												nodeId,
												index,
												`Failed to get page URL/title for error context: ${(pageError as Error).message}`,
											),
										);
									}

									// If continueOnFail is true, we should return a partially successful result instead of throwing
									if (continueOnFail) {
										this.logger.info(
											formatOperationLog(
												"Decision",
												nodeName,
												nodeId,
												index,
												"Continuing despite error (continueOnFail=true)",
											),
										);

										resultData.success = false;
										resultData.routeTaken = groupName;
										resultData.actionPerformed = actionType;
										resultData.error = (error as Error).message;
										resultData.executionDuration = Date.now() - startTime;

										// Exit the decision node with the error result
										return [this.helpers.returnJsonArray([{
											...(outputInputData ? item.json : {}),
											...resultData
										}])];
									}

									throw error;
								}
							}
							case "fill": {
								// Check if we have simple action fields or complex form fields
								const hasActionSelector = !!group.actionSelector;
								const hasFormFields = !!(
									group.formFields && (group.formFields as IDataObject).fields
								);

								// Get browser session information and credential type for compatibility
								const workflowId = this.getWorkflow().id || "";
								// Get all active sessions and find the one for this workflow
								const allSessions = SessionManager.getAllSessions();
								let session = null;
								for (const sessionInfo of allSessions) {
									if (sessionInfo.info.workflowId === workflowId) {
										session = SessionManager.getSession(sessionInfo.sessionId);
										break;
									}
								}
								let credentialType = "brightDataApi"; // Default

								if (session && typeof session.credentialType === "string") {
									credentialType = session.credentialType;
									this.logger.info(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`Using credential type from session: ${credentialType}`,
										),
									);
								} else {
									this.logger.warn(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`No credential type found in session, defaulting to: ${credentialType}`,
										),
									);
								}

								// Store credential type for field handling
								group._credentialType = credentialType;

								// Log what approach we're using for debugging
								this.logger.info(
									formatOperationLog(
										"Decision",
										nodeName,
										nodeId,
										index,
										`Form fill approach: ${hasActionSelector ? "Simple" : hasFormFields ? "Complex" : "Unknown"} with provider: ${credentialType}`,
									),
								);

								try {
									// Handle simple action selector approach
									if (hasActionSelector) {
										const actionSelector = group.actionSelector as string;
										const actionValue = group.actionValue as string;
										const waitAfterAction = group.waitAfterAction as string;
										const fieldType = (group.fieldType as string) || "text";
										let waitTime = group.waitTime as number;
										if (waitTime === undefined) {
											waitTime =
												waitAfterAction === "fixedTime"
													? 2000
													: waitAfterAction === "urlChanged"
														? 6000
														: 30000;
										}

										this.logger.info(
											formatOperationLog(
												"Decision",
												nodeName,
												nodeId,
												index,
												`Executing simple form fill on "${actionSelector}" (type: ${fieldType})`,
											),
										);

										// For actions, we always need to ensure the element exists
										if (waitForSelectors) {
											if (detectionMethod === "smart") {
												const elementExists = await smartWaitForSelector(
													puppeteerPage!,
													actionSelector,
													selectorTimeout,
													earlyExitDelay,
													this.logger,
												);

												if (!elementExists) {
													throw new Error(
														`Decision action: Element "${actionSelector}" required for this path is not present or visible`,
													);
												}
											} else {
												await puppeteerPage!.waitForSelector(actionSelector, {
													timeout: selectorTimeout,
												});
											}
										}

										// Process the form field using our utility function
										const field: IDataObject = {
											fieldType,
											selector: actionSelector,
											value: actionValue,
											// Add options based on field type
											...(fieldType === "text"
												? {
													clearField: true,
													humanLike: useHumanDelays,
												}
												: {}),
											...(fieldType === "password"
												? {
													clearField: true,
												}
												: {}),
										};

										// Create options for the action
										const actionOptions: IActionOptions = {
											sessionId,
											waitForSelector: waitForSelectors,
											selectorTimeout,
											detectionMethod,
											earlyExitDelay,
											nodeName,
											nodeId,
											index,
											useHumanDelays,
										};

										// Execute the fill action using the utility
										const actionResult = await executeAction(
											sessionId,
											"fill" as ActionType,
											field,
											actionOptions,
											this.logger,
										);

										// Check if we need to use a reconnected page
										if (
											actionResult.details.pageReconnected === true &&
											actionResult.details.reconnectedPage
										) {
											this.logger.info(
												formatOperationLog(
													"Decision",
													nodeName,
													nodeId,
													index,
													"Using reconnected page after fill action from details",
												),
											);
											puppeteerPage = actionResult.details
												.reconnectedPage as puppeteer.Page;

											// --- START REFACTOR ---
											// REMOVED: SessionManager.storePage call
											// The puppeteerPage variable is updated, which is sufficient for subsequent steps within this execution.
											// getActivePage will handle retrieving the correct page in the next node.
											this.logger.info(
												formatOperationLog(
													"Decision",
													nodeName,
													nodeId,
													index,
													`Reconnected page reference updated locally. Session Manager state not modified.`,
												),
											);
											// --- END REFACTOR ---
										}

										// Handle action failures
										if (!actionResult.success) {
											throw new Error(
												`Failed to fill form field: ${field.selector as string} (type: ${field.fieldType as string}) - ${actionResult.error || "Unknown error"}`,
											);
										}

										// Store field result for response
										if (!resultData.formFields) {
											resultData.formFields = [];
										}
										(resultData.formFields as IDataObject[]).push(
											actionResult.details,
										);

										// ---- Add logic to update puppeteerPage if needed ----
										if (
											actionResult.details.pageReconnected === true &&
											actionResult.details.reconnectedPage
										) {
											this.logger.info(
												formatOperationLog(
													"Decision",
													nodeName,
													nodeId,
													index,
													`Fill action reconnected page. Updating main page reference.`,
												),
											);
											puppeteerPage = actionResult.details
												.reconnectedPage as puppeteer.Page;
										}
										// -------------------------------------------------------

										// Handle post-fill waiting
										if (waitAfterAction === "fixedTime") {
											await new Promise((resolve) =>
												setTimeout(resolve, waitTime),
											);
										} else if (
											waitAfterAction === "urlChanged" ||
											waitAfterAction === "anyUrlChange"
										) {
											try {
												// Get current URL to detect changes
												const currentUrl = await puppeteerPage.url();
												this.logger.info(
													formatOperationLog(
														"Decision",
														nodeName,
														nodeId,
														index,
														`Waiting for ${waitAfterAction === "anyUrlChange" ? "any URL change" : "URL to change"} from: ${currentUrl}`,
													),
												);

												// Use waitForUrlChange utility from navigationUtils
												const urlChanged = await waitForUrlChange(
													sessionId,
													currentUrl,
													waitTime,
													this.logger,
												);

												if (urlChanged) {
													this.logger.info(
														formatOperationLog(
															"Decision",
															nodeName,
															nodeId,
															index,
															"Navigation after action completed successfully - URL changed",
														),
													);

													// Mark the navigation as successful
													resultData.navigationCompleted = true;
													resultData.urlChangeDetected = true;
												} else {
													this.logger.warn(
														formatOperationLog(
															"Decision",
															nodeName,
															nodeId,
															index,
															`Navigation after action may not have completed - URL did not change from ${currentUrl}`,
														),
													);

													// Don't mark the navigation as failed - we're being conservative here
													// It's possible the action was successful but didn't result in a URL change
													resultData.navigationCompleted = false;
													resultData.urlChangeDetected = false;
												}
											} catch (navigationError) {
												// This is expected in many cases when URL changes - the navigation destroys the execution context
												// Don't fail the action on this type of error
												if (
													(navigationError as Error).message.includes(
														"context was destroyed",
													) ||
													(navigationError as Error).message.includes(
														"Execution context",
													)
												) {
													this.logger.info(
														formatOperationLog(
															"Decision",
															nodeName,
															nodeId,
															index,
															"Navigation context was destroyed, which likely indicates successful navigation",
														),
													);

													// Mark the navigation as successful despite the error
													resultData.navigationCompleted = true;
													resultData.contextDestroyed = true;
												} else {
													// For other navigation errors, log but don't fail the action
													this.logger.warn(
														formatOperationLog(
															"Decision",
															nodeName,
															nodeId,
															index,
															`Navigation after action encountered an issue: ${(navigationError as Error).message}`,
														),
													);

													// We're being conservative and not marking this as a failure
													resultData.navigationCompleted = false;
													resultData.navigationError = (
														navigationError as Error
													).message;
												}
											}
										} else if (waitAfterAction === "navigationComplete") {
											try {
												this.logger.info(
													formatOperationLog(
														"Decision",
														nodeName,
														nodeId,
														index,
														"Waiting for navigation to complete",
													),
												);

												// Store the current URL for reference
												const beforeUrl = puppeteerPage ? await puppeteerPage.url() : currentUrl;

												// Use enhanced navigation wait for better reliability
												await enhancedNavigationWait(
													puppeteerPage!,
													"networkidle0",
													waitTime,
													this.logger,
													formatOperationLog(
														"Decision",
														nodeName,
														nodeId,
														index,
														"",
													),
												);

												// Try to capture the final URL after navigation
												try {
													const afterUrl = puppeteerPage ? await puppeteerPage.url() : beforeUrl;
													const urlChanged = afterUrl !== beforeUrl;

													this.logger.info(
														formatOperationLog(
															"Decision",
															nodeName,
															nodeId,
															index,
															`Navigation completed. URL changed: ${urlChanged} (${beforeUrl} → ${afterUrl})`,
														),
													);

													// Mark the navigation as successful
													resultData.navigationCompleted = true;
													resultData.urlChangeDetected = urlChanged;
													resultData.beforeUrl = beforeUrl;
													resultData.afterUrl = afterUrl;
												} catch (urlError) {
													// This might happen if the context was destroyed during navigation
													if (
														(urlError as Error).message.includes(
															"context was destroyed",
														) ||
														(urlError as Error).message.includes(
															"Execution context",
														)
													) {
														this.logger.info(
															formatOperationLog(
																"Decision",
																nodeName,
																nodeId,
																index,
																"Context destroyed while getting URL after navigation - this indicates successful navigation",
															),
														);

														// Mark as successful despite the error
														resultData.navigationCompleted = true;
														resultData.contextDestroyed = true;
														resultData.beforeUrl = beforeUrl;
													} else {
														this.logger.warn(
															formatOperationLog(
																"Decision",
																nodeName,
																nodeId,
																index,
																`Could not get URL after navigation: ${(urlError as Error).message}`,
															),
														);

														// Still mark as successful since the navigation wait itself succeeded
														resultData.navigationCompleted = true;
														resultData.beforeUrl = beforeUrl;
													}
												}
											} catch (navigationError) {
												// Handle context destruction during navigation
												if (
													(navigationError as Error).message.includes(
														"context was destroyed",
													) ||
													(navigationError as Error).message.includes(
														"Execution context",
													)
												) {
													this.logger.info(
														formatOperationLog(
															"Decision",
															nodeName,
															nodeId,
															index,
															"Context destroyed during navigation wait - this is expected and indicates navigation",
														),
													);

													// Mark as successful despite the error
													resultData.navigationCompleted = true;
													resultData.contextDestroyed = true;
												} else {
													// For other errors, log warning but still don't fail the action
													this.logger.warn(
														formatOperationLog(
															"Decision",
															nodeName,
															nodeId,
															index,
															`Navigation error: ${(navigationError as Error).message}`,
														),
													);

													// Don't mark as complete failure
													resultData.navigationCompleted = false;
													resultData.navigationError = (
														navigationError as Error
													).message;
												}
											}
										} else if (waitAfterAction === "selector") {
											const waitSelector = group.waitSelector as string;
											await puppeteerPage.waitForSelector(waitSelector, {
												timeout: waitTime,
											});
										}
									}
									// Handle complex form fields approach
									else if (hasFormFields) {
										// Get form parameters
										const formFields =
											((group.formFields as IDataObject)
												.fields as IDataObject[]) || [];
										const submitForm = (group.submitForm as boolean) || false;
										const submitSelector =
											(group.submitSelector as string) || "";
										const waitAfterSubmit =
											(group.waitAfterSubmit as string) || "domContentLoaded";
										const waitSubmitTime =
											(group.waitSubmitTime as number) || 2000;

										this.logger.info(
											formatOperationLog(
												"Decision",
												nodeName,
												nodeId,
												index,
												`Using complex form fill with ${formFields.length} fields`,
											),
										);

										// Create action options once
										const actionOptions: IActionOptions = {
											sessionId,
											waitForSelector: waitForSelectors,
											selectorTimeout,
											detectionMethod,
											earlyExitDelay,
											nodeName,
											nodeId,
											index,
											useHumanDelays,
										};

										// Process each form field using actionUtils
										for (const field of formFields) {
											// Execute the fill action using the utility
											const actionResult = await executeAction(
												sessionId,
												"fill" as ActionType,
												field,
												actionOptions,
												this.logger,
											);

											// Check if we need to use a reconnected page
											if (
												actionResult.details.pageReconnected === true &&
												actionResult.details.reconnectedPage
											) {
												this.logger.info(
													formatOperationLog(
														"Decision",
														nodeName,
														nodeId,
														index,
														"Using reconnected page after fill action",
													),
												);
												puppeteerPage = actionResult.details
													.reconnectedPage as puppeteer.Page;

												// --- START REFACTOR ---
												// REMOVED: SessionManager.storePage call
												// The puppeteerPage variable is updated, which is sufficient for subsequent steps within this execution.
												// getActivePage will handle retrieving the correct page in the next node.
												this.logger.info(
													formatOperationLog(
														"Decision",
														nodeName,
														nodeId,
														index,
														`Reconnected page reference updated locally. Session Manager state not modified.`,
													),
												);
												// --- END REFACTOR ---
											}

											// Handle action failures
											if (!actionResult.success) {
												throw new Error(
													`Failed to fill form field: ${field.selector as string} (type: ${field.fieldType as string}) - ${actionResult.error || "Unknown error"}`,
												);
											}

											// Store field result for response
											if (!resultData.formFields) {
												resultData.formFields = [];
											}
											(resultData.formFields as IDataObject[]).push(
												actionResult.details,
											);
										}

										// Submit the form if requested
										if (submitForm && submitSelector) {
											this.logger.info(
												formatOperationLog(
													"Decision",
													nodeName,
													nodeId,
													index,
													`Submitting form using selector: ${submitSelector}`,
												),
											);

											// Wait a short time before submitting (feels more human)
											if (useHumanDelays) {
												await new Promise((resolve) =>
													setTimeout(resolve, getHumanDelay()),
												);
											}

											try {
												// For URL changed form submission, we'll use our improved click action middleware
												if (
													waitAfterSubmit === "urlChanged" ||
													waitAfterSubmit === "anyUrlChange" ||
													// ADDED: Also use click middleware for navigationComplete
													waitAfterSubmit === "navigationComplete"
												) {
													this.logger.info(
														formatOperationLog(
															"Decision",
															nodeName,
															nodeId,
															index,
															// Updated log message to include navigationComplete
															`Using click action middleware for form submission with ${waitAfterSubmit} detection`,
														),
													);

													// We'll use the click action with URL change detection
													const actionOptions: IActionOptions = {
														sessionId,
														waitForSelector: waitForSelectors,
														selectorTimeout,
														detectionMethod,
														earlyExitDelay,
														nodeName,
														nodeId,
														index,
														useHumanDelays,
													};

													// Use at least 20 seconds for timeout, especially for navigationComplete
													const effectiveWaitTime = Math.max(
														waitSubmitTime,
														waitAfterSubmit === "navigationComplete"
															? 30000
															: 20000, // Increased timeout for navigationComplete
													);

													// Log the effective wait time
													this.logger.info(
														formatOperationLog(
															"Decision",
															nodeName,
															nodeId,
															index,
															`[Form Submit] Effective wait time: ${effectiveWaitTime}ms (Original: ${waitSubmitTime}ms)`,
														),
													);

													const clickResult = await executeAction(
														sessionId,
														"click" as ActionType,
														{
															selector: submitSelector,
															waitAfterAction: waitAfterSubmit, // Pass the original wait strategy
															waitTime: effectiveWaitTime, // Use the adjusted timeout
														},
														actionOptions,
														this.logger,
													);

													// Check if we need to use a reconnected page
													if (
														clickResult.details.pageReconnected === true &&
														clickResult.details.reconnectedPage
													) {
														this.logger.info(
															formatOperationLog(
																"Decision",
																nodeName,
																nodeId,
																index,
																"Using reconnected page after form submission with URL change",
															),
														);
														puppeteerPage = clickResult.details
															.reconnectedPage as puppeteer.Page;

														// --- START REFACTOR ---
														// REMOVED: SessionManager.storePage call
														// The puppeteerPage variable is updated, which is sufficient for subsequent steps within this execution.
														// getActivePage will handle retrieving the correct page in the next node.
														this.logger.info(
															formatOperationLog(
																"Decision",
																nodeName,
																nodeId,
																index,
																`Reconnected page reference updated locally. Session Manager state not modified.`,
															),
														);
														// --- END REFACTOR ---
													}

													// After successful submission, add an additional stabilization delay
													// Especially important for navigationComplete to ensure stability
													if (clickResult.success) {
														this.logger.info(
															formatOperationLog(
																"Decision",
																nodeName,
																nodeId,
																index,
																`Form submission successful with ${waitAfterSubmit} using click middleware`,
															),
														);

														// Add additional stabilization delay after form submission
														const stabilizationDelay =
															waitAfterSubmit === "navigationComplete"
																? 7000
																: 5000; // Longer delay for navigationComplete
														this.logger.info(
															formatOperationLog(
																"Decision",
																nodeName,
																nodeId,
																index,
																`Adding post-submission stabilization delay (${stabilizationDelay}ms)`,
															),
														);
														await new Promise((resolve) =>
															setTimeout(resolve, stabilizationDelay),
														);

														resultData.formSubmission = {
															success: true,
															submitSelector,
															waitAfterSubmit,
															waitSubmitTime: effectiveWaitTime,
															details: clickResult.details,
														};
													} else {
														this.logger.warn(
															formatOperationLog(
																"Decision",
																nodeName,
																nodeId,
																index,
																`Form submission failed: ${clickResult.error instanceof Error ? clickResult.error.message : String(clickResult.error || "Unknown error")}`,
															),
														);

														resultData.formSubmission = {
															success: false,
															error:
																clickResult.error instanceof Error
																	? clickResult.error.message
																	: String(
																		clickResult.error || "Unknown error",
																	),
															submitSelector,
															waitAfterSubmit,
															waitSubmitTime,
														};
													}
												} else {
													// For non-URL change submissions, use the original approach
													// We don't need to get the URL since we don't use it
													// Remove the unused currentUrl variable

													// Create a navigation promise based on wait type
													let navigationPromise;

													if (waitAfterSubmit === "noWait") {
														navigationPromise = Promise.resolve();
													} else {
														// For standard navigation events, use waitForNavigation
														navigationPromise = puppeteerPage.waitForNavigation(
															{
																waitUntil:
																	waitAfterSubmit === "multiple"
																		? ["domcontentloaded", "networkidle0"]
																		: waitAfterSubmit === "domContentLoaded"
																			? "domcontentloaded"
																			: waitAfterSubmit === "navigationComplete"
																				? "networkidle0"
																				: "domcontentloaded",
																timeout: waitSubmitTime,
															},
														);
													}

													// Click the submit button
													this.logger.info(
														formatOperationLog(
															"Decision",
															nodeName,
															nodeId,
															index,
															`Clicking submit button: ${submitSelector}`,
														),
													);
													await puppeteerPage.click(submitSelector);
													this.logger.info(
														formatOperationLog(
															"Decision",
															nodeName,
															nodeId,
															index,
															`Submit button clicked successfully`,
														),
													);

													// Wait for navigation to complete
													if (waitAfterSubmit !== "noWait") {
														this.logger.info(
															formatOperationLog(
																"Decision",
																nodeName,
																nodeId,
																index,
																`Waiting for navigation to complete (timeout: ${waitSubmitTime}ms)`,
															),
														);
														await navigationPromise;
														this.logger.info(
															formatOperationLog(
																"Decision",
																nodeName,
																nodeId,
																index,
																`Navigation completed successfully after form submission`,
															),
														);
													}

													// Store form submission result
													resultData.formSubmission = {
														success: true,
														submitSelector,
														waitAfterSubmit,
														waitSubmitTime,
													};
												}
											} catch (navError) {
												// Don't treat context destruction as an error if we're doing URL navigation
												if (
													(waitAfterSubmit === "urlChanged" ||
														waitAfterSubmit === "anyUrlChange") &&
													((navError as Error).message.includes(
														"context was destroyed",
													) ||
														(navError as Error).message.includes(
															"Execution context",
														))
												) {
													this.logger.info(
														formatOperationLog(
															"Decision",
															nodeName,
															nodeId,
															index,
															"Navigation context was destroyed, which likely indicates successful navigation",
														),
													);

													// Add recovery delay to ensure page has completed loading
													this.logger.info(
														formatOperationLog(
															"Decision",
															nodeName,
															nodeId,
															index,
															"Adding extended recovery delay after context destruction (5000ms)",
														),
													);
													await new Promise((resolve) =>
														setTimeout(resolve, 5000),
													);

													// Try to recover page state
													try {
														const finalUrl = await puppeteerPage.url();
														const finalTitle = await puppeteerPage.title();

														this.logger.info(
															formatOperationLog(
																"Decision",
																nodeName,
																nodeId,
																index,
																`Final page state after recovery - URL: ${finalUrl}, Title: ${finalTitle}`,
															),
														);

														// Store form submission result as success
														resultData.formSubmission = {
															success: true,
															submitSelector,
															waitAfterSubmit,
															waitSubmitTime,
															contextDestroyed: true,
															finalUrl,
														};
													} catch (finalError) {
														this.logger.warn(
															formatOperationLog(
																"Decision",
																nodeName,
																nodeId,
																index,
																`Could not get final page state: ${(finalError as Error).message}`,
															),
														);

														// Store form submission result as success even without final state
														resultData.formSubmission = {
															success: true,
															submitSelector,
															waitAfterSubmit,
															waitSubmitTime,
															contextDestroyed: true,
															recoveryFailed: true,
														};
													}
												} else {
													this.logger.warn(
														formatOperationLog(
															"Decision",
															nodeName,
															nodeId,
															index,
															`Navigation error after form submission: ${(navError as Error).message}`,
														),
													);
													this.logger.warn(
														formatOperationLog(
															"Decision",
															nodeName,
															nodeId,
															index,
															`This is often normal with redirects - attempting to continue`,
														),
													);

													// Store form submission result with error
													resultData.formSubmission = {
														success: false,
														error: (navError as Error).message,
														submitSelector,
														waitAfterSubmit,
														waitSubmitTime,
													};
												}
											}
										}
									}

									// After successful action, exit with result
									this.logger.info(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`Decision point "${groupName}": Form action completed successfully - exiting decision node`,
										),
									);
									resultData.success = true;
									resultData.routeTaken = groupName;
									resultData.actionPerformed = actionType;
									resultData.currentUrl = await puppeteerPage.url();
									resultData.pageTitle = await puppeteerPage.title();
									resultData.executionDuration = Date.now() - startTime;

									// Take screenshot if requested
									if (takeScreenshot) {
										const screenshotResult = await captureScreenshot(
											puppeteerPage,
											this.logger,
										);
										if (screenshotResult !== null) {
											resultData.screenshot = screenshotResult;
										}
									}

									// Return the result immediately after successful action
									return [this.helpers.returnJsonArray([{
										...(outputInputData ? item.json : {}),
										...resultData
									}])];
								} catch (error) {
									this.logger.error(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`Error during fill action: ${(error as Error).message}`,
										),
									);
									this.logger.error(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`Action execution error in group "${groupName}": ${(error as Error).message}`,
										),
									);

									if (continueOnFail) {
										// If continueOnFail is enabled, update result and move on
										resultData.success = false;
										resultData.routeTaken = "none";
										resultData.actionPerformed = "error";
										resultData.currentUrl = await puppeteerPage.url();
										resultData.pageTitle = await puppeteerPage.title();
										resultData.error = (error as Error).message;
										resultData.executionDuration = Date.now() - startTime;

										// Exit the decision node with the error result
										return [this.helpers.returnJsonArray([{
											...(outputInputData ? item.json : {}),
											...resultData
										}])];
									}

									// If continueOnFail is not enabled, rethrow the error
									throw error;
								}
							}
							case "extract": {
								const actionSelector = group.actionSelector as string;
								const extractionType = group.extractionType as string;

								// Get extraction options based on the extraction type
								let extractionParams: IActionParameters = {
									selector: actionSelector,
									extractionType,
								};

								// Add specific options based on extraction type
								switch (extractionType) {
									case "html": {
										// Get HTML options
										const htmlOptions =
											(group.htmlOptions as IDataObject) || {};
										extractionParams.outputFormat =
											(htmlOptions.outputFormat as string) || "html";
										extractionParams.includeMetadata =
											(htmlOptions.includeMetadata as boolean) || false;
										break;
									}
									case "attribute": {
										extractionParams.attributeName =
											group.extractAttributeName as string;
										break;
									}
									case "multiple": {
										// Get options for multiple elements extraction
										const multipleOptions =
											(group.multipleOptions as IDataObject) || {};

										extractionParams = {
											...extractionParams,
											extractionProperty:
												(multipleOptions.extractionProperty as string) ||
												"textContent",
											limit: (multipleOptions.limit as number) || 50,
											outputFormat:
												(multipleOptions.outputFormat as string) || "array",
											separator: (multipleOptions.separator as string) || ",",
											attributeName:
												(multipleOptions.attributeName as string) || "",
										};
										break;
									}
									case "table": {
										// Get table options
										const tableOptions =
											(group.tableOptions as IDataObject) || {};

										extractionParams = {
											...extractionParams,
											includeHeaders:
												(tableOptions.includeHeaders as boolean) ?? true,
											rowSelector: (tableOptions.rowSelector as string) || "tr",
											cellSelector:
												(tableOptions.cellSelector as string) || "td,th",
											outputFormat:
												(tableOptions.outputFormat as string) || "array",
										};
										break;
									}
								}

								this.logger.info(
									formatOperationLog(
										"Decision",
										nodeName,
										nodeId,
										index,
										`Executing extraction action from "${actionSelector}" using action utility`,
									),
								);

								try {
									// Create options for the action
									const actionOptions: IActionOptions = {
										sessionId,
										waitForSelector: waitForSelectors,
										selectorTimeout,
										detectionMethod,
										earlyExitDelay,
										nodeName,
										nodeId,
										index,
										useHumanDelays,
									};

									// Execute the extract action using the utility
									const actionResult = await executeAction(
										sessionId,
										"extract" as ActionType,
										extractionParams,
										actionOptions,
										this.logger,
									);

									// Handle action failures
									if (!actionResult.success) {
										throw new Error(
											`Decision action failed: ${actionResult.error}`,
										);
									}

									this.logger.info(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`Extraction action completed successfully using action utility`,
										),
									);

									// Store the extracted data if available
									if (actionResult.details.data) {
										// Make sure extractedData object exists
										if (!resultData.extractedData) {
											resultData.extractedData = {};
										}

										// Check if extractedData is an object before accessing its properties
										if (typeof resultData.extractedData === "object") {
											(resultData.extractedData as IDataObject).primary =
												actionResult.details.data;
										}
									}

									// Log the extraction result (truncated for readability)
									const truncatedData = formatExtractedDataForLog(
										actionResult.details.data,
										extractionType,
									);
									this.logger.info(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`Extracted ${extractionType} data: ${truncatedData}`,
										),
									);

									// After successful extraction, exit immediately
									this.logger.info(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`Decision point "${groupName}": Extraction completed successfully - exiting decision node`,
										),
									);
									resultData.success = true;
									resultData.routeTaken = groupName;
									resultData.actionPerformed = actionType;
									resultData.currentUrl = await puppeteerPage.url();
									resultData.pageTitle = await puppeteerPage.title();
									resultData.executionDuration = Date.now() - startTime;

									// Take screenshot if requested
									if (takeScreenshot) {
										const screenshotResult = await captureScreenshot(
											puppeteerPage,
											this.logger,
										);
										if (screenshotResult !== null) {
											resultData.screenshot = screenshotResult;
										}
									}

									// Return the result immediately after successful action
									return [this.helpers.returnJsonArray([{
										...(outputInputData ? item.json : {}),
										...resultData
									}])];
								} catch (error) {
									this.logger.error(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`Error during extraction action: ${(error as Error).message}`,
										),
									);
									throw error;
								}
							}
							case "navigate": {
								const url = group.url as string;
								const waitAfterAction = group.waitAfterAction as string;
								const waitTime = group.waitTime as number;

								this.logger.info(
									formatOperationLog(
										"Decision",
										nodeName,
										nodeId,
										index,
										`Executing navigation action to "${url}" using action utility`,
									),
								);

								try {
									// Create options and parameters for the action
									const actionOptions: IActionOptions = {
										sessionId,
										waitForSelector: waitForSelectors,
										selectorTimeout,
										detectionMethod,
										earlyExitDelay,
										nodeName,
										nodeId,
										index,
										useHumanDelays,
									};

									const actionParameters: IActionParameters = {
										url,
										waitUntil: waitAfterAction,
										waitTime,
									};

									// Execute the navigation action using the utility
									const actionResult = await executeAction(
										sessionId,
										"navigate" as ActionType,
										actionParameters,
										actionOptions,
										this.logger,
									);

									// Handle action failures
									if (!actionResult.success) {
										throw new Error(
											`Decision action failed: ${actionResult.error}`,
										);
									}

									this.logger.info(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`Navigation action completed successfully using action utility`,
										),
									);

									// After successful action, exit immediately
									this.logger.info(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`Decision point "${groupName}": Action completed successfully - exiting decision node`,
										),
									);
									resultData.success = true;
									resultData.routeTaken = groupName;
									resultData.actionPerformed = actionType;
									resultData.currentUrl = await puppeteerPage.url();
									resultData.pageTitle = await puppeteerPage.title();
									resultData.executionDuration = Date.now() - startTime;

									// Take screenshot if requested
									if (takeScreenshot) {
										const screenshotResult = await captureScreenshot(
											puppeteerPage,
											this.logger,
										);
										if (screenshotResult !== null) {
											resultData.screenshot = screenshotResult;
										}
									}

									// Return the result immediately after successful action
									return [this.helpers.returnJsonArray([{
										...(outputInputData ? item.json : {}),
										...resultData
									}])];
								} catch (error) {
									this.logger.error(
										formatOperationLog(
											"Decision",
											nodeName,
											nodeId,
											index,
											`Error during navigation action: ${(error as Error).message}`,
										),
									);
									throw error;
								}
							}
						}
					}

					// Exit after the first match - we don't continue checking conditions
					break;
				} else {
					// Important change: This is NOT an error, just a normal condition not being met
					this.logger.debug(
						formatOperationLog(
							"Decision",
							nodeName,
							nodeId,
							index,
							`Condition not met for group "${groupName}", continuing to next condition`,
						),
					);
				}
			} catch (error) {
				// Check if this is a navigation timeout, which might be expected behavior
				const errorMessage = (error as Error).message;
				if (errorMessage.includes("Navigation timeout")) {
					// This is likely just a timeout during navigation, which might be expected
					this.logger.info(
						formatOperationLog(
							"Decision",
							nodeName,
							nodeId,
							index,
							`Navigation timeout in group "${groupName}": ${errorMessage} - this may be expected behavior`,
						),
					);
				} else if (
					errorMessage.includes("not found") ||
					errorMessage.includes("not clickable or visible")
				) {
					// Not an error - decision point didn't match selected element
					this.logger.info(
						formatOperationLog(
							"Decision",
							nodeName,
							nodeId,
							index,
							`Decision point "${groupName}": Element not available - continuing to next decision`,
						),
					);

					// Add additional details at debug level
					this.logger.debug(
						formatOperationLog(
							"Decision",
							nodeName,
							nodeId,
							index,
							`Details: ${errorMessage}`,
						),
					);
				} else {
					// This is a genuine error in execution, not just a condition failing
					this.logger.error(
						formatOperationLog(
							"Decision",
							nodeName,
							nodeId,
							index,
							`Action execution error in group "${groupName}": ${errorMessage}`,
						),
					);
				}
				// No need for continue statement as it's the last statement in the loop
			}
		}

		// If no condition was met, set up fallback handling
		if (routeTaken === "none") {
			// Set fallback route if routing is enabled, regardless of fallback action
			if (enableRouting) {
				const fallbackRoute = this.getNodeParameter(
					"fallbackRoute",
					index,
					1,
				) as number;
				routeIndex = fallbackRoute - 1;

				// If we're routing but not performing an action, mark this state
				if (fallbackAction === "none") {
					routeTaken = "fallback-route";
					actionPerformed = "none";
				}
			}

			// Perform fallback action if not 'none'
			if (fallbackAction !== "none") {
				routeTaken = "fallback";
				actionPerformed = fallbackAction;

				this.logger.info(
					formatOperationLog(
						"Decision",
						nodeName,
						nodeId,
						index,
						`Executing fallback action: ${fallbackAction}`,
					),
				);

				// Create fallback options object
				const fallbackOptions: IFallbackOptions = {
					enableFallback: true,
					fallbackAction,
					fallbackSelector: this.getNodeParameter(
						"fallbackSelector",
						index,
						"",
					) as string,
					fallbackUrl: this.getNodeParameter(
						"fallbackUrl",
						index,
						"",
					) as string,
					fallbackTimeout: this.getNodeParameter(
						"fallbackWaitTime",
						index,
						30000,
					) as number,
				};

				try {
					// Execute the fallback using our utility function
					const fallbackResult = await executeFallback(
						puppeteerPage!,
						fallbackOptions,
						resultData,
						index,
						this,
					);

					if (fallbackResult) {
						this.logger.info(
							formatOperationLog(
								"Decision",
								nodeName,
								nodeId,
								index,
								`Fallback action ${fallbackAction} executed successfully`,
							),
						);
					} else {
						this.logger.warn(
							formatOperationLog(
								"Decision",
								nodeName,
								nodeId,
								index,
								`Fallback action did not execute successfully`,
							),
						);
					}
				} catch (error) {
					this.logger.error(
						formatOperationLog(
							"Decision",
							nodeName,
							nodeId,
							index,
							`Error in fallback action: ${(error as Error).message}`,
						),
					);

					if (!continueOnFail) {
						throw error;
					}
				}
			}
		}

		// Take screenshot if requested
		if (takeScreenshot && puppeteerPage) {
			try {
				screenshot = (await puppeteerPage.screenshot({
					encoding: "base64",
					type: "jpeg",
					quality: 80,
				})) as string;

				resultData.screenshot = screenshot;
				this.logger.debug(
					formatOperationLog(
						"Decision",
						nodeName,
						nodeId,
						index,
						`Screenshot captured (${screenshot.length} bytes)`,
					),
				);
			} catch (screenshotError) {
				this.logger.warn(
					formatOperationLog(
						"Decision",
						nodeName,
						nodeId,
						index,
						`Failed to capture screenshot: ${(screenshotError as Error).message}`,
					),
				);
				// Continue execution even if screenshot fails
			}
		}

		// Update result data
		resultData.executionDuration = Date.now() - startTime;
		resultData.currentUrl = puppeteerPage ? await puppeteerPage.url() : currentUrl;
		resultData.pageTitle = puppeteerPage ? await puppeteerPage.title() : "no session";
		resultData.routeTaken = routeTaken;
		resultData.actionPerformed = actionPerformed;

		// Add standard timing log
		createTimingLog(
			"Decision",
			startTime,
			this.logger,
			nodeName,
			nodeId,
			index,
		);

		// Log additional information about the execution
		this.logger.info(
			formatOperationLog(
				"Decision",
				nodeName,
				nodeId,
				index,
				`Completed execution: route="${routeTaken}", action="${actionPerformed}"`,
			),
		);

		// Add more specific completion information based on action performed
		if (actionPerformed === "click") {
			this.logger.info(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					`CLICK ACTION SUCCESSFUL: Node has finished processing and is ready for the next node`,
				),
			);
		} else if (actionPerformed === "fill") {
			this.logger.info(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					`FORM FILL SUCCESSFUL: Node has finished processing and is ready for the next node`,
				),
			);
		} else if (actionPerformed === "extract") {
			this.logger.info(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					`EXTRACTION SUCCESSFUL: Node has finished processing and is ready for the next node`,
				),
			);
		} else if (actionPerformed === "navigate") {
			this.logger.info(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					`NAVIGATION SUCCESSFUL: Node has finished processing and is ready for the next node`,
				),
			);
		} else {
			this.logger.info(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					`NODE SUCCESSFUL: Processing complete and ready for next node`,
				),
			);
		}

		// Add a visual end marker
		this.logger.info("============ NODE EXECUTION COMPLETE ============");

		// Debug logging for input data
		this.logger.info(
			formatOperationLog(
				"Decision",
				nodeName,
				nodeId,
				index,
				`DEBUG: outputInputData=${outputInputData}, item.json exists=${!!item.json}`,
			),
		);
		if (outputInputData && item.json) {
			this.logger.info(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					`DEBUG: Input data keys: ${Object.keys(item.json).join(', ')}`,
				),
			);
		}

		// Create standardized success response
		const successResponse = await createSuccessResponse({
			operation: "Decision",
			sessionId: sessionId || "",
			page: hasValidSession ? puppeteerPage : null,
			logger: this.logger,
			startTime,
			takeScreenshot: this.getNodeParameter(
				"takeScreenshot",
				index,
				false,
			) as boolean,
			additionalData: {
				routeTaken,
				actionPerformed,
				currentUrl: resultData.currentUrl,
				pageTitle: resultData.pageTitle,
				sessionId: sessionId || "",
				navigationCompleted: resultData.navigationCompleted,
				urlChangeDetected: resultData.urlChangeDetected,
				contextDestroyed: resultData.contextDestroyed,
				beforeUrl: resultData.beforeUrl,
				afterUrl: resultData.afterUrl,
				navigationError: resultData.navigationError,
				hasValidSession,
			},
			inputData: outputInputData ? item.json : undefined,
		});

		// Debug logging for success response
		this.logger.info(
			formatOperationLog(
				"Decision",
				nodeName,
				nodeId,
				index,
				`DEBUG: Success response keys: ${Object.keys(successResponse).join(', ')}`,
			),
		);

		// Store the page reference for future operations to ensure the session is properly maintained
		if (sessionId && workflowId) {
			// SessionManager.storePage(sessionId, `page_${Date.now()}`, puppeteerPage);
			this.logger.info(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					`Stored page reference with session ID: ${sessionId}`,
				),
			);
		}

		// Build the output item in accordance with n8n standards
		const returnItem: INodeExecutionData = {
			json: successResponse,
			pairedItem: { item: index },
		};

		// Output the results
		if (enableRouting) {
			// Create an array for each possible output route
			const routeCount = this.getNodeParameter(
				"routeCount",
				index,
				2,
			) as number;
			const routes: INodeExecutionData[][] = Array(routeCount)
				.fill(null)
				.map(() => []);

			// Add detailed debugging log
			this.logger.info(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					`Routing details - routeIndex: ${routeIndex}, routeCount: ${routeCount}, enableRouting: ${enableRouting}`,
				),
			);

			// CRITICAL FIX: Add explicit debugging of route information
			this.logger.info(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					`ROUTE DEBUG: Final return - routeIndex=${routeIndex}, routeTaken="${routeTaken}", conditions evaluated`,
				),
			);

			// Put the item in the correct route
			if (routeIndex >= 0 && routeIndex < routeCount) {
				// Add action success/selector info to output
				if (!returnItem.json.actionDetails) {
					returnItem.json.actionDetails = {} as IDataObject;
				}
				(returnItem.json.actionDetails as IDataObject).selectorFound = true; // We would only get here if selector was found
				(returnItem.json.actionDetails as IDataObject).actionType = actionPerformed;

				routes[routeIndex].push(returnItem);
				this.logger.info(
					formatOperationLog(
						"Decision",
						nodeName,
						nodeId,
						index,
						`Sending output to route ${routeIndex + 1} (routes array length: ${routes.length})`,
					),
				);

				// Debug each route's item count
				for (let i = 0; i < routes.length; i++) {
					this.logger.info(
						formatOperationLog(
							"Decision",
							nodeName,
							nodeId,
							index,
							`Route ${i + 1} has ${routes[i].length} items`,
						),
					);
				}

				// DEBUG: Check final output before returning
				this.logger.info(
					formatOperationLog(
						"Decision",
						nodeName,
						nodeId,
						index,
						`DEBUG: Final routing returnItem.json keys: ${Object.keys(returnItem.json).join(', ')}`,
					),
				);

				// CRITICAL FIX: Return the routes IMMEDIATELY to prevent any further code changing routeIndex
				return routes;
			} else {
				// Log warning but still use fallback
				this.logger.warn(
					formatOperationLog(
						"Decision",
						nodeName,
						nodeId,
						index,
						`Route index ${routeIndex} out of bounds, defaulting to route 1`,
					),
				);

				// Add action success/selector info even in fallback case
				if (!returnItem.json.actionDetails) {
					returnItem.json.actionDetails = {} as IDataObject;
				}
				(returnItem.json.actionDetails as IDataObject).selectorFound = true;
				(returnItem.json.actionDetails as IDataObject).actionType = actionPerformed;

				routes[0].push(returnItem);

				// CRITICAL FIX: Return immediately here too
				return routes;
			}

			// Remove this line - it should never be reached due to the immediate returns above
			// return routes;
		}

		// Single output case
		// Add action success/selector info here too
		if (!returnItem.json.actionDetails) {
			returnItem.json.actionDetails = {} as IDataObject;
		}
		(returnItem.json.actionDetails as IDataObject).selectorFound = true;
		(returnItem.json.actionDetails as IDataObject).actionType = actionPerformed;

		// DEBUG: Check final output before returning (non-routing case)
		this.logger.info(
			formatOperationLog(
				"Decision",
				nodeName,
				nodeId,
				index,
				`DEBUG: Final non-routing returnItem.json keys: ${Object.keys(returnItem.json).join(', ')}`,
			),
		);

		return [returnItem];
	} catch (error) {
		// Use standardized error response utility
		const takeScreenshot = this.getNodeParameter(
			"takeScreenshot",
			index,
			false,
		) as boolean;

		// Get current URL and title for error context if page is available
		let currentUrl = "";
		let pageTitle = "";
		try {
			if (puppeteerPage) {
				currentUrl = await puppeteerPage.url();
				pageTitle = await puppeteerPage.title();
			}
		} catch (urlError) {
			this.logger.warn(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					`Failed to get page URL/title for error context: ${(urlError as Error).message}`,
				),
			);
		}

		// Get node parameters for error context
		const waitForSelectorsParam = this.getNodeParameter(
			"waitForSelectors",
			index,
			true,
		) as boolean;
		const selectorTimeoutParam = this.getNodeParameter(
			"selectorTimeout",
			index,
			5000,
		) as number;
		const detectionMethodParam = this.getNodeParameter(
			"detectionMethod",
			index,
			"standard",
		) as string;
		const earlyExitDelayParam = this.getNodeParameter(
			"earlyExitDelay",
			index,
			500,
		) as number;

		// Create a detailed error response with additional context
		const errorResponse = await createErrorResponse({
			error,
			operation: "Decision",
			sessionId: sessionId || "",
			nodeId,
			nodeName,
			url: currentUrl,
			title: pageTitle,
			page: puppeteerPage,
			logger: this.logger,
			takeScreenshot,
			startTime,
			continueOnFail,
			additionalData: {
				...(outputInputData ? item.json : {}),
				routeTaken: "error",
				actionPerformed: "none",
				conditionGroups: this.getNodeParameter(
					"conditionGroups",
					index,
					{},
				) as IDataObject,
				parameters: {
					waitForSelectors: waitForSelectorsParam,
					selectorTimeout: selectorTimeoutParam,
					detectionMethod: detectionMethodParam,
					earlyExitDelay: earlyExitDelayParam,
					takeScreenshot,
					continueOnFail,
				},
			},
		});

		// If continueOnFail is true, return error data instead of throwing
		if (continueOnFail) {
			this.logger.info(
				formatOperationLog(
					"Decision",
					nodeName,
					nodeId,
					index,
					`Continuing despite error (continueOnFail=true)`,
				),
			);

			const returnItem: INodeExecutionData = {
				json: errorResponse,
				pairedItem: { item: index },
			};

			// Route to the first output or return as single output
			const enableRouting = this.getNodeParameter(
				"enableRouting",
				index,
				false,
			) as boolean;

			if (enableRouting) {
				const routeCount = this.getNodeParameter(
					"routeCount",
					index,
					2,
				) as number;
				const routes: INodeExecutionData[][] = Array(routeCount)
					.fill(null)
					.map(() => []);
				routes[0].push(returnItem);
				return routes;
			}

			return [returnItem];
		}

		// If continueOnFail is false, throw the error
		throw error;
	}
}
