import type {
	IExecuteFunctions,
	INodeExecutionData,
	IDataObject,
	INodeProperties,
} from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { SessionManager } from '../utils/sessionManager';
import { formatOperationLog, createSuccessResponse, createTimingLog } from '../utils/resultUtils';
import { createErrorResponse } from '../utils/errorUtils';
import { waitAndClick } from '../utils/clickOperations';
import {
	processFormField
} from '../utils/formOperations';
import { takeScreenshot as captureScreenshot } from '../utils/navigationUtils';
import {
	extractTextContent,
	extractHtmlContent,
	extractInputValue,
	extractAttributeValue,
	extractTableData,
	extractMultipleElements,
	formatExtractedDataForLog
} from '../utils/extractionUtils';
import {
	navigateWithRetry,
} from '../utils/navigationUtils';
import {
	detectElement,
	detectText,
	detectCount,
	detectUrl,
	detectExpression,
	IDetectionOptions,
	IDetectionResult
} from '../utils/detectionUtils';

/**
 * Decision operation description
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
				operation: ['decision'],
			},
		},
	},
	{
		displayName: 'Enable Routing',
		name: 'enableRouting',
		type: 'boolean',
		default: false,
		description: 'Whether to route data to different outputs based on conditions',
		displayOptions: {
			show: {
				operation: ['decision'],
			},
		},
	},
	{
		displayName: 'Number of Routes',
		name: 'routeCount',
		type: 'number',
		default: 2,
		description: 'Maximum number of routes to create',
		displayOptions: {
			show: {
				operation: ['decision'],
				enableRouting: [true],
			},
		},
	},
	{
		displayName: 'Decisions',
		name: 'conditionGroups',
		placeholder: 'Add Decision',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		displayOptions: {
			show: {
				operation: ['decision'],
			},
		},
		description: 'Define conditions to check and actions to take if they match',
		default: {
			groups: [
				{
					name: 'Default',
					conditionType: 'one',
					singleConditionType: 'elementExists',
					singleSelector: ''
				}
			]
		},
		options: [
			{
				name: 'groups',
				displayName: 'Decision',
				values: [
					{
							displayName: 'Group Name',
							name: 'name',
							type: 'string',
							default: '',
							description: 'Name for this decision group, used in output',
							placeholder: 'e.g., loginForm',
							required: true,
						},
						{
							displayName: 'Route Name or ID',
							name: 'route',
							type: 'options',
							default: '',
							description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							displayOptions: {
								show: {
									'/operation': ['decision'],
									'/enableRouting': [true],
								},
							},
							typeOptions: {
								loadOptionsMethod: 'getRoutes',
							},
						},
						{
							displayName: 'Condition Type',
							name: 'conditionType',
							type: 'options',
							options: [
								{
									name: 'One Condition',
									value: 'one',
									description: 'Only use a single condition',
								},
								{
									name: 'AND - All Conditions Must Match',
									value: 'and',
									description: 'All conditions must be true for the group to match (logical AND)',
								},
								{
									name: 'OR - Any Condition Can Match',
									value: 'or',
									description: 'At least one condition must be true for the group to match (logical OR)',
								},
							],
							default: 'one',
							description: 'How to evaluate conditions in this group',
							displayOptions: {
								show: {
									'/operation': ['decision'],
								},
							},
						},
						// Single condition fields (only shown when conditionType is 'one')
						{
							displayName: 'Condition Type',
							name: 'singleConditionType',
							type: 'options',
							options: [
								{
									name: 'Element Count',
									value: 'elementCount',
									description: 'Count the elements that match a selector',
								},
								{
									name: 'Element Exists',
									value: 'elementExists',
									description: 'Check if element exists on the page',
								},
								{
									name: 'Execution Count',
									value: 'executionCount',
									description: 'Check how many times this node has been executed',
								},
								{
									name: 'Expression',
									value: 'expression',
									description: 'Evaluate a JavaScript expression',
								},
								{
									name: 'Input Source',
									value: 'inputSource',
									description: 'Check which node the data came from',
								},
								{
									name: 'Text Contains',
									value: 'textContains',
									description: 'Check if element contains specific text',
								},
								{
									name: 'URL Contains',
									value: 'urlContains',
									description: 'Check if current URL contains string',
								},
							],
							default: 'elementExists',
							description: 'Type of condition to check',
							displayOptions: {
								show: {
									'/operation': ['decision'],
									conditionType: ['one'],
								},
							},
						},
						{
							displayName: 'JavaScript Expression',
							name: 'singleJsExpression',
							type: 'string',
							typeOptions: {
								rows: 4,
							},
							default: '$input.item.json.someProperty === true',
							description: 'JavaScript expression that should evaluate to true or false. You can use $input to access the input data.',
								placeholder: '$input.item.json.status === "success" || $input.item.json.count > 5',
							displayOptions: {
								show: {
									'/operation': ['decision'],
									conditionType: ['one'],
									singleConditionType: ['expression'],
								},
							},
						},
						{
							displayName: 'Source Node Name',
							name: 'singleSourceNodeName',
							type: 'string',
							default: '',
							placeholder: 'e.g., HTTP Request, Function, Switch',
							description: 'Enter the exact name of the node that should trigger this condition. This is the name shown in the node\'s title bar.',
							displayOptions: {
								show: {
									'/operation': ['decision'],
									conditionType: ['one'],
									singleConditionType: ['inputSource'],
								},
							},
						},
						{
							displayName: 'Count Comparison',
							name: 'singleExecutionCountComparison',
							type: 'options',
							options: [
								{
									name: 'Equal To',
									value: 'equal',
								},
								{
									name: 'Greater Than',
									value: 'greater',
								},
								{
									name: 'Greater Than or Equal To',
									value: 'greaterEqual',
								},
								{
									name: 'Less Than',
									value: 'less',
								},
								{
									name: 'Less Than or Equal To',
									value: 'lessEqual',
								},
							],
							default: 'equal',
							description: 'How to compare the execution count',
							displayOptions: {
								show: {
									'/operation': ['decision'],
									conditionType: ['one'],
									singleConditionType: ['executionCount'],
								},
							},
						},
						{
							displayName: 'Execution Count',
							name: 'singleExecutionCountValue',
							type: 'number',
							default: 1,
							description: 'The value to compare the execution count against',
							displayOptions: {
								show: {
									'/operation': ['decision'],
									conditionType: ['one'],
									singleConditionType: ['executionCount'],
								},
							},
						},
						{
							displayName: 'Selector',
							name: 'singleSelector',
							type: 'string',
							default: '',
							placeholder: '#element, .class, div[data-test="value"]',
							description: 'CSS selector to target the element(s)',
							displayOptions: {
								show: {
									'/operation': ['decision'],
									conditionType: ['one'],
									singleConditionType: ['elementExists', 'textContains', 'elementCount'],
								},
							},
						},
						{
							displayName: 'Text to Check',
							name: 'singleTextToCheck',
							type: 'string',
							default: '',
							description: 'Text content to check for in the selected element',
							displayOptions: {
								show: {
									'/operation': ['decision'],
									conditionType: ['one'],
									singleConditionType: ['textContains'],
								},
							},
						},
						{
							displayName: 'URL Substring',
							name: 'singleUrlSubstring',
							type: 'string',
							default: '',
							description: 'Text to look for in the current URL',
							displayOptions: {
								show: {
									'/operation': ['decision'],
									conditionType: ['one'],
									singleConditionType: ['urlContains'],
								},
							},
						},
						{
							displayName: 'Count Comparison',
							name: 'singleCountComparison',
							type: 'options',
							options: [
								{
									name: 'Equal To',
									value: 'equal',
								},
								{
									name: 'Greater Than',
									value: 'greater',
								},
								{
									name: 'Greater Than or Equal To',
									value: 'greaterEqual',
								},
								{
									name: 'Less Than',
									value: 'less',
								},
								{
									name: 'Less Than or Equal To',
									value: 'lessEqual',
								},
							],
							default: 'equal',
							description: 'How to compare the actual element count with the expected count',
							displayOptions: {
								show: {
									'/operation': ['decision'],
									conditionType: ['one'],
									singleConditionType: ['elementCount'],
								},
							},
						},
						{
							displayName: 'Expected Count',
							name: 'singleExpectedCount',
							type: 'number',
							default: 1,
							description: 'The value to compare the element count against',
							displayOptions: {
								show: {
									'/operation': ['decision'],
									conditionType: ['one'],
									singleConditionType: ['elementCount'],
								},
							},
						},
						{
							displayName: 'Match Type',
							name: 'singleMatchType',
							type: 'options',
							options: [
								{
									name: 'Contains',
									value: 'contains',
									description: 'Value must contain the specified string',
								},
								{
									name: 'Ends With',
									value: 'endsWith',
									description: 'Value must end with the specified string',
								},
								{
									name: 'Exact Match',
									value: 'exact',
									description: 'Value must match exactly',
								},
								{
									name: 'RegEx',
									value: 'regex',
									description: 'Match using a regular expression',
								},
								{
									name: 'Starts With',
									value: 'startsWith',
									description: 'Value must start with the specified string',
								},
							],
							default: 'contains',
							description: 'How to match the text or URL value',
							displayOptions: {
								show: {
									'/operation': ['decision'],
									conditionType: ['one'],
									singleConditionType: ['textContains', 'urlContains'],
								},
							},
						},
						{
							displayName: 'Case Sensitive',
							name: 'singleCaseSensitive',
							type: 'boolean',
							default: false,
							description: 'Whether the matching should be case-sensitive',
							displayOptions: {
								show: {
									'/operation': ['decision'],
									conditionType: ['one'],
									singleConditionType: ['textContains', 'urlContains'],
								},
							},
						},
						{
							displayName: 'Invert Condition',
							name: 'singleInvertCondition',
							type: 'boolean',
							default: false,
							description: 'Whether to invert the condition result (true becomes false, false becomes true)',
							displayOptions: {
								show: {
									'/operation': ['decision'],
								},
							},
						},
						// Multiple conditions collection (only shown when conditionType is 'and' or 'or')
						{
							displayName: 'Conditions',
							name: 'conditions',
							placeholder: 'Add Condition',
							type: 'fixedCollection',
							typeOptions: {
								multipleValues: true,
								sortable: true,
								multipleValueButtonText: 'Add Condition',
							},
							default: {
								condition: [
									{
										conditionType: 'elementExists',
										selector: ''
									}
								]
							},
							description: 'Define the conditions to check',
							displayOptions: {
								show: {
									'/operation': ['decision'],
									conditionType: ['and', 'or'],
								},
							},
							options: [
								{
									name: 'condition',
									displayName: 'Condition',
									values: [
										{
											displayName: 'Condition Type',
											name: 'conditionType',
											type: 'options',
											options: [
												{
													name: 'Element Count',
													value: 'elementCount',
													description: 'Count the elements that match a selector',
												},
												{
													name: 'Element Exists',
													value: 'elementExists',
													description: 'Check if element exists on the page',
												},
												{
													name: 'Execution Count',
													value: 'executionCount',
													description: 'Check how many times this node has been executed',
												},
												{
													name: 'Expression',
													value: 'expression',
													description: 'Evaluate a JavaScript expression',
												},
												{
													name: 'Input Source',
													value: 'inputSource',
													description: 'Check which node the data came from',
												},
												{
													name: 'Text Contains',
													value: 'textContains',
													description: 'Check if element contains specific text',
												},
												{
													name: 'URL Contains',
													value: 'urlContains',
													description: 'Check if current URL contains string',
												},
											],
											default: 'elementExists',
											description: 'Type of condition to check',
										},
										{
											displayName: 'JavaScript Expression',
											name: 'jsExpression',
											type: 'string',
											typeOptions: {
												rows: 4,
											},
											default: '$input.item.json.someProperty === true',
											description: 'JavaScript expression that should evaluate to true or false. You can use $input to access the input data.',
											placeholder: '$input.item.json.status === "success" || $input.item.json.count > 5',
											displayOptions: {
												show: {
													conditionType: ['expression'],
												},
											},
										},
										{
											displayName: 'Source Node Name',
											name: 'sourceNodeName',
											type: 'string',
											default: '',
											placeholder: 'e.g., HTTP Request, Function, Switch',
											description: 'Enter the exact name of the node that should trigger this condition. This is the name shown in the node\'s title bar.',
											displayOptions: {
												show: {
													conditionType: ['inputSource'],
												},
											},
										},
										{
											displayName: 'Count Comparison',
											name: 'executionCountComparison',
											type: 'options',
											options: [
												{
													name: 'Equal To',
													value: 'equal',
												},
												{
													name: 'Greater Than',
													value: 'greater',
												},
												{
													name: 'Greater Than or Equal To',
													value: 'greaterEqual',
												},
												{
													name: 'Less Than',
													value: 'less',
												},
												{
													name: 'Less Than or Equal To',
													value: 'lessEqual',
												},
											],
											default: 'equal',
											description: 'How to compare the execution count',
											displayOptions: {
												show: {
													conditionType: ['executionCount'],
												},
											},
										},
										{
											displayName: 'Execution Count',
											name: 'executionCountValue',
											type: 'number',
											default: 1,
											description: 'The value to compare the execution count against',
											displayOptions: {
												show: {
													conditionType: ['executionCount'],
												},
											},
										},
										{
											displayName: 'Selector',
											name: 'selector',
											type: 'string',
											default: '',
											placeholder: '#element, .class, div[data-test="value"]',
											description: 'CSS selector to target the element(s)',
											displayOptions: {
												show: {
													conditionType: ['elementExists', 'textContains', 'elementCount'],
												},
											},
										},
										{
											displayName: 'Text to Check',
											name: 'textToCheck',
											type: 'string',
											default: '',
											description: 'Text content to check for in the selected element',
											displayOptions: {
												show: {
													conditionType: ['textContains'],
												},
											},
										},
										{
											displayName: 'URL Substring',
											name: 'urlSubstring',
											type: 'string',
											default: '',
											description: 'Text to look for in the current URL',
											displayOptions: {
												show: {
													conditionType: ['urlContains'],
												},
											},
										},
										{
											displayName: 'Count Comparison',
											name: 'countComparison',
											type: 'options',
											options: [
												{
													name: 'Equal To',
													value: 'equal',
												},
												{
													name: 'Greater Than',
													value: 'greater',
												},
												{
													name: 'Greater Than or Equal To',
													value: 'greaterEqual',
												},
												{
													name: 'Less Than',
													value: 'less',
												},
												{
													name: 'Less Than or Equal To',
													value: 'lessEqual',
												},
											],
											default: 'equal',
											description: 'How to compare the actual element count with the expected count',
											displayOptions: {
												show: {
													conditionType: ['elementCount'],
												},
											},
										},
										{
											displayName: 'Expected Count',
											name: 'expectedCount',
											type: 'number',
											default: 1,
											description: 'The value to compare the element count against',
											displayOptions: {
												show: {
													conditionType: ['elementCount'],
												},
											},
										},
										{
											displayName: 'Match Type',
											name: 'matchType',
											type: 'options',
											options: [
												{
													name: 'Contains',
													value: 'contains',
													description: 'Value must contain the specified string',
												},
												{
													name: 'Ends With',
													value: 'endsWith',
													description: 'Value must end with the specified string',
												},
												{
													name: 'Exact Match',
													value: 'exact',
													description: 'Value must match exactly',
												},
												{
													name: 'RegEx',
													value: 'regex',
													description: 'Match using a regular expression',
												},
												{
													name: 'Starts With',
													value: 'startsWith',
													description: 'Value must start with the specified string',
												},
											],
											default: 'contains',
											description: 'How to match the text or URL value',
											displayOptions: {
												show: {
													conditionType: ['textContains', 'urlContains'],
												},
											},
										},
										{
											displayName: 'Case Sensitive',
											name: 'caseSensitive',
											type: 'boolean',
											default: false,
											description: 'Whether the matching should be case-sensitive',
											displayOptions: {
												show: {
													conditionType: ['textContains', 'urlContains'],
												},
											},
										},
										{
											displayName: 'Invert Condition',
											name: 'invertCondition',
											type: 'boolean',
											default: false,
											description: 'Whether to invert the condition result (true becomes false, false becomes true)',
										},
									],
								},
							],
						},
						{
							displayName: 'Action If Condition Matches',
							name: 'actionType',
							type: 'options',
							options: [
								{
									name: 'Click Element',
									value: 'click',
									description: 'Click on an element',
								},
								{
									name: 'Extract Data',
									value: 'extract',
									description: 'Extract data from an element on the page',
								},
								{
									name: 'Fill Form Field',
									value: 'fill',
									description: 'Enter text into a form field',
								},
								{
									name: 'Navigate to URL',
									value: 'navigate',
									description: 'Navigate to a specific URL',
								},
								{
									name: 'No Action (Just Detect)',
									value: 'none',
									description: 'Only detect the condition, do not take any action',
								},
							],
							default: 'click',
							description: 'Action to take if the condition is met',
						},
						{
							displayName: 'Action Selector',
							name: 'actionSelector',
							type: 'string',
							default: '',
							placeholder: 'button.submit, input[type="text"]',
							description: 'CSS selector for the element to interact with',
							displayOptions: {
								show: {
									actionType: ['click', 'extract'],
								},
							},
						},
						// Add Extraction Type for Extract action
						{
							displayName: 'Extraction Type',
							name: 'extractionType',
							type: 'options',
							options: [
								{
									name: 'Attribute',
									value: 'attribute',
									description: 'Extract specific attribute from an element',
								},
								{
									name: 'HTML',
									value: 'html',
									description: 'Extract HTML content from an element',
								},
								{
									name: 'Input Value',
									value: 'value',
									description: 'Extract value from input, select or textarea',
								},
								{
									name: 'Multiple Elements',
									value: 'multiple',
									description: 'Extract data from multiple elements matching a selector',
								},
								{
									name: 'Table',
									value: 'table',
									description: 'Extract data from a table',
								},
								{
									name: 'Text Content',
									value: 'text',
									description: 'Extract text content from an element',
								},
							],
							default: 'text',
							description: 'What type of data to extract from the element',
							displayOptions: {
								show: {
									actionType: ['extract'],
								},
							},
						},
						{
							displayName: 'Attribute Name',
							name: 'extractAttributeName',
							type: 'string',
							default: '',
							placeholder: 'href, src, data-ID',
							description: 'Name of the attribute to extract from the element',
							displayOptions: {
								show: {
									actionType: ['extract'],
									extractionType: ['attribute'],
								},
							},
						},
						// HTML Options for Extract Action
						{
							displayName: 'HTML Options',
							name: 'htmlOptions',
							type: 'collection',
							placeholder: 'Add Option',
							default: {},
							typeOptions: {
								multipleValues: false,
							},
							displayOptions: {
								show: {
									actionType: ['extract'],
									extractionType: ['html'],
								},
							},
							options: [
								{
									displayName: 'Output Format',
									name: 'outputFormat',
									type: 'options',
									options: [
										{
											name: 'HTML (String)',
											value: 'html',
											description: 'Return the HTML as a raw string',
										},
										{
											name: 'JSON',
											value: 'json',
											description: 'Return the HTML wrapped in a JSON object',
										},
									],
									default: 'html',
									description: 'Format of the output data',
								},
								{
									displayName: 'Include Metadata',
									name: 'includeMetadata',
									type: 'boolean',
									default: false,
									description: 'Whether to include metadata about the HTML (length, structure info)',
								},
							],
						},
						// Table Options for Extract Action
						{
							displayName: 'Table Options',
							name: 'tableOptions',
							type: 'collection',
							placeholder: 'Add Option',
							default: {},
							typeOptions: {
								multipleValues: false,
							},
							displayOptions: {
								show: {
									actionType: ['extract'],
									extractionType: ['table'],
								},
							},
							options: [
								{
									displayName: 'Include Headers',
									name: 'includeHeaders',
									type: 'boolean',
									default: true,
									description: 'Whether to use the first row as headers in the output',
								},
								{
									displayName: 'Row Selector',
									name: 'rowSelector',
									type: 'string',
									default: 'tr',
									description: 'CSS selector for table rows relative to table selector (default: tr)',
								},
								{
									displayName: 'Cell Selector',
									name: 'cellSelector',
									type: 'string',
									default: 'td, th',
									description: 'CSS selector for table cells relative to row selector (default: td, th)',
								},
								{
									displayName: 'Output Format',
									name: 'outputFormat',
									type: 'options',
									options: [
										{
											name: 'JSON Objects',
											value: 'json',
											description: 'Return table as array of JSON objects using headers as keys',
										},
										{
											name: 'Array of Arrays',
											value: 'array',
											description: 'Return table as a simple array of arrays (rows and cells)',
										},
										{
											name: 'HTML',
											value: 'html',
											description: 'Return the original HTML of the table',
										},
										{
											name: 'CSV',
											value: 'csv',
											description: 'Return the table formatted as CSV text',
										},
									],
									default: 'json',
									description: 'Format of the extracted table data',
								},
							],
						},
						// Multiple Elements Options for Extract Action
						{
							displayName: 'Multiple Elements Options',
							name: 'multipleOptions',
							type: 'collection',
							placeholder: 'Add Option',
							default: {},
							typeOptions: {
								multipleValues: false,
							},
							displayOptions: {
								show: {
									actionType: ['extract'],
									extractionType: ['multiple'],
								},
							},
							options: [
								{
									displayName: 'Extraction Property',
									name: 'extractionProperty',
									type: 'options',
									options: [
										{
											name: 'Text Content',
											value: 'textContent',
										},
										{
											name: 'Inner HTML',
											value: 'innerHTML',
										},
										{
											name: 'Outer HTML',
											value: 'outerHTML',
										},
										{
											name: 'Attribute',
											value: 'attribute',
										},
									],
									default: 'textContent',
									description: 'Property to extract from each matching element',
								},
								{
									displayName: 'Attribute Name',
									name: 'attributeName',
									type: 'string',
									default: '',
									description: 'Name of the attribute to extract (if Extraction Property is set to Attribute)',
									displayOptions: {
										show: {
											extractionProperty: ['attribute'],
										},
									},
								},
								{
									displayName: 'Limit',
									name: 'limit',
									type: 'number',
									default: 50,
									description: 'Max number of results to return',
									typeOptions: {
										minValue: 1,
									},
								},
								{
									displayName: 'Output Format',
									name: 'outputFormat',
									type: 'options',
									options: [
										{
											name: 'Array',
											value: 'array',
											description: 'Return results as a simple array',
										},
										{
											name: 'JSON Objects',
											value: 'json',
											description: 'Return results as array of objects with indices as keys',
										},
										{
											name: 'Concatenated String',
											value: 'string',
											description: 'Combine all results into one string with separator',
										},
									],
									default: 'array',
									description: 'Format of the extracted data',
								},
								{
									displayName: 'Separator',
									name: 'separator',
									type: 'string',
									default: ',',
									description: 'Separator to use when concatenating results (if Output Format is String)',
									displayOptions: {
										show: {
											outputFormat: ['string'],
										},
									},
								},
							],
						},
						{
							displayName: 'Form Fields',
							name: 'formFields',
							placeholder: 'Add Form Field',
							type: 'fixedCollection',
							typeOptions: {
								multipleValues: true,
								sortable: true,
							},
							default: {},
							displayOptions: {
								show: {
									actionType: ['fill'],
								},
							},
							options: [
								{
									name: 'fields',
									displayName: 'Fields',
									values: [
										{
											displayName: 'Field Type',
											name: 'fieldType',
											type: 'options',
											options: [
												{
													name: 'Checkbox',
													value: 'checkbox',
													description: 'Checkbox input element',
												},
												{
													name: 'File',
													value: 'file',
													description: 'File upload input element',
												},
												{
													name: 'Multi-Select',
													value: 'multiSelect',
													description: 'Multiple select dropdown element',
												},
												{
													name: 'Password',
													value: 'password',
													description: 'Secure password input field',
												},
												{
													name: 'Radio',
													value: 'radio',
													description: 'Radio button input element',
												},
												{
													name: 'Select (Dropdown)',
													value: 'select',
													description: 'Dropdown select element',
												},
												{
													name: 'Text',
													value: 'text',
													description: 'Standard text input or textarea',
												},
											],
											default: 'text',
											description: 'The type of form field',
										},
										{
											displayName: 'Selector',
											name: 'selector',
											type: 'string',
											default: '',
											placeholder: '#input-field, .form-control, input[name="email"]',
											description: 'CSS selector to target the form field. Use "#ID" for IDs, ".class" for classes, "tag" for HTML elements, or "tag[attr=value]" for attributes.',
											required: true,
										},
										{
											displayName: 'Value',
											name: 'value',
											type: 'string',
											default: '',
											description: 'Value to set for the form field',
											displayOptions: {
												show: {
													fieldType: ['text', 'radio'],
												},
											},
										},
										{
											displayName: 'Dropdown Value',
											name: 'value',
											type: 'string',
											default: '',
											description: 'Value or text to select from the dropdown',
											displayOptions: {
												show: {
													fieldType: ['select'],
												},
											},
										},
										{
											displayName: 'Match Type',
											name: 'matchType',
											type: 'options',
											options: [
												{
													name: 'Exact (Value)',
													value: 'exact',
													description: 'Match exactly by option value',
												},
												{
													name: 'Text Contains',
													value: 'textContains',
													description: 'Match if option text contains this string',
												},
												{
													name: 'Fuzzy Match',
													value: 'fuzzy',
													description: 'Use fuzzy matching to find the closest option text',
												},
											],
											default: 'exact',
											description: 'How to match the dropdown option',
											displayOptions: {
												show: {
													fieldType: ['select'],
												},
											},
										},
										{
											displayName: 'Fuzzy Match Threshold',
											name: 'fuzzyThreshold',
											type: 'number',
											typeOptions: {
												minValue: 0,
												maxValue: 1,
											},
											default: 0.5,
											description: 'Minimum similarity score (0-1) to consider a match',
											displayOptions: {
												show: {
													fieldType: ['select'],
													matchType: ['fuzzy'],
												},
											},
										},
										{
											displayName: 'Clear Field First',
											name: 'clearField',
											type: 'boolean',
											default: true,
											description: 'Whether to clear the field before entering text',
											displayOptions: {
												show: {
													fieldType: ['text'],
												},
											},
										},
										{
											displayName: 'Press Enter After Input',
											name: 'pressEnter',
											type: 'boolean',
											default: false,
											description: 'Whether to press Enter after entering text',
											displayOptions: {
												show: {
													fieldType: ['text'],
												},
											},
										},
										{
											displayName: 'Check',
											name: 'checked',
											type: 'boolean',
											default: true,
											description: 'Whether to check or uncheck the checkbox/radio button',
											displayOptions: {
												show: {
													fieldType: ['checkbox', 'radio'],
												},
											},
										},
										{
											displayName: 'File Path',
											name: 'filePath',
											type: 'string',
											default: '',
											description: 'Full path to the file to upload',
											displayOptions: {
												show: {
													fieldType: ['file'],
												},
											},
										},
										{
											displayName: 'Multi-Select Values',
											name: 'multiSelectValues',
											type: 'string',
											default: '',
											placeholder: 'value1,value2,value3',
											description: 'Comma-separated list of values to select (for multi-select dropdowns)',
											displayOptions: {
												show: {
													fieldType: ['multiSelect'],
												},
											},
										},
										{
											displayName: 'Human-Like Typing',
											name: 'humanLike',
											type: 'boolean',
											default: true,
											description: 'Whether to use human-like typing with random delays between keystrokes',
											displayOptions: {
												show: {
													fieldType: ['text'],
												},
											},
										},
										{
											displayName: 'Password Value',
											name: 'value',
											type: 'string',
											default: '',
											description: 'Password to enter in the field (masked in logs for security)',
											typeOptions: {
												password: true,
											},
											displayOptions: {
												show: {
													fieldType: ['password'],
												},
											},
										},
										{
											displayName: 'Clear Field First',
											name: 'clearField',
											type: 'boolean',
											default: true,
											description: 'Whether to clear any existing value in the field before typing',
											displayOptions: {
												show: {
													fieldType: ['password'],
												},
											},
										},
										{
											displayName: 'Has Clone Field',
											name: 'hasCloneField',
											type: 'boolean',
											default: false,
											description: 'Whether this password field has a clone/duplicate field (common with show/hide password toggles)',
											displayOptions: {
												show: {
													fieldType: ['password'],
												},
											},
										},
										{
											displayName: 'Clone Field Selector',
											name: 'cloneSelector',
											type: 'string',
											default: '',
											placeholder: '#password-clone, .password-visible',
											description: 'CSS selector for the clone field (often shown when password is toggled to visible)',
											displayOptions: {
												show: {
													fieldType: ['password'],
													hasCloneField: [true],
												},
											},
										},
									],
								},
							],
						},
						{
							displayName: 'Submit Form After Filling',
							name: 'submitForm',
							type: 'boolean',
							default: false,
							description: 'Whether to submit the form after filling the fields',
							displayOptions: {
								show: {
									actionType: ['fill'],
								},
							},
						},
						{
							displayName: 'Submit Button Selector',
							name: 'submitSelector',
							type: 'string',
							default: '',
							placeholder: 'button[type="submit"], input[type="submit"], .submit-button',
							description: 'CSS selector of the submit button',
							displayOptions: {
								show: {
									actionType: ['fill'],
									submitForm: [true],
								},
							},
						},
						{
							displayName: 'Wait After Submit',
							name: 'waitAfterSubmit',
							type: 'options',
							options: [
								{
									name: 'DOM Content Loaded',
									value: 'domContentLoaded',
									description: 'Wait until the DOM content is loaded (faster)',
								},
								{
									name: 'Fixed Time',
									value: 'fixedTime',
									description: 'Wait for a specific amount of time',
								},
								{
									name: 'Navigation Complete',
									value: 'navigationComplete',
									description: 'Wait until navigation is complete (slower but more thorough)',
								},
								{
									name: 'No Wait',
									value: 'noWait',
									description: 'Do not wait after clicking submit',
								},
								{
									name: 'URL Changed',
									value: 'urlChanged',
									description: 'Wait only until the URL changes to confirm navigation started',
								},
							],
							default: 'domContentLoaded',
							description: 'What to wait for after clicking the submit button',
							displayOptions: {
								show: {
									actionType: ['fill'],
									submitForm: [true],
								},
							},
						},
						{
							displayName: 'Wait Time (MS)',
							name: 'waitSubmitTime',
							type: 'number',
							default: 2000,
							description: 'Time to wait in milliseconds (for fixed time wait)',
							displayOptions: {
								show: {
									actionType: ['fill'],
									submitForm: [true],
									waitAfterSubmit: ['fixedTime'],
								},
							},
						},
						{
							displayName: 'URL',
							name: 'url',
							type: 'string',
							default: '',
							placeholder: 'https://example.com/page',
							description: 'URL to navigate to',
							displayOptions: {
								show: {
									actionType: ['navigate'],
								},
							},
						},
						{
							displayName: 'Wait After Action',
							name: 'waitAfterAction',
							type: 'options',
							options: [
								{
									name: 'DOM Content Loaded',
									value: 'domContentLoaded',
									description: 'Wait until the DOM content is loaded (faster)',
								},
								{
									name: 'Fixed Time',
									value: 'fixedTime',
									description: 'Wait for a specific amount of time',
								},
								{
									name: 'Navigation Complete',
									value: 'navigationComplete',
									description: 'Wait until navigation is complete (slower but more thorough)',
								},
								{
									name: 'No Wait',
									value: 'noWait',
									description: 'Do not wait after the action',
								},
								{
									name: 'URL Changed',
									value: 'urlChanged',
									description: 'Wait only until the URL changes to confirm navigation started',
								},
							],
							default: 'domContentLoaded',
							description: 'What to wait for after performing the action',
							displayOptions: {
								show: {
									actionType: ['click', 'navigate'],
								},
							},
						},
						{
							displayName: 'Wait Time (MS)',
							name: 'waitTime',
							type: 'number',
							default: 2000,
							description: 'Time to wait in milliseconds (for fixed time wait)',
							displayOptions: {
								show: {
									waitAfterAction: ['fixedTime'],
									actionType: ['click', 'navigate'],
								},
							},
						},
					],
				},
			],
			required: true,
		},
		{
			displayName: 'Fallback Action',
			name: 'fallbackAction',
			type: 'options',
			options: [
				{
					name: 'Click Element',
					value: 'click',
					description: 'Click on an element',
				},
				{
					name: 'Extract Data',
					value: 'extract',
					description: 'Extract data from an element on the page',
				},
				{
					name: 'Fill Form Field',
					value: 'fill',
					description: 'Enter text into a form field',
				},
				{
					name: 'Navigate to URL',
					value: 'navigate',
					description: 'Navigate to a specific URL',
				},
				{
					name: 'None',
					value: 'none',
					description: 'Do not perform any fallback action',
				},
			],
			default: 'none',
			description: 'Action to take if none of the conditions match',
			displayOptions: {
				show: {
					operation: ['decision'],
				},
			},
		},
		{
			displayName: 'Fallback Selector',
			name: 'fallbackSelector',
			type: 'string',
			default: '',
			placeholder: 'button.cancel, input[type="text"]',
			description: 'CSS selector for the element to interact with in the fallback action',
			displayOptions: {
				show: {
					operation: ['decision'],
					fallbackAction: ['click', 'fill', 'extract'],
				},
			},
		},
		{
			displayName: 'Fallback Extraction Type',
			name: 'fallbackExtractionType',
			type: 'options',
			options: [
				{
					name: 'Attribute',
					value: 'attribute',
					description: 'Extract specific attribute from an element',
				},
				{
					name: 'HTML',
					value: 'html',
					description: 'Extract HTML content from an element',
				},
				{
					name: 'Input Value',
					value: 'value',
					description: 'Extract value from input, select or textarea',
				},
				{
					name: 'Text Content',
					value: 'text',
					description: 'Extract text content from an element',
				},
			],
			default: 'text',
			description: 'What type of data to extract from the element',
			displayOptions: {
				show: {
					operation: ['decision'],
					fallbackAction: ['extract'],
				},
			},
		},
		{
			displayName: 'Fallback HTML Options',
			name: 'fallbackHtmlOptions',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			typeOptions: {
				multipleValues: false,
			},
			displayOptions: {
				show: {
					operation: ['decision'],
					fallbackAction: ['extract'],
					fallbackExtractionType: ['html'],
				},
			},
			options: [
				{
					displayName: 'Output Format',
					name: 'outputFormat',
					type: 'options',
					options: [
						{
							name: 'HTML (String)',
							value: 'html',
							description: 'Return the HTML as a raw string',
						},
						{
							name: 'JSON',
							value: 'json',
							description: 'Return the HTML wrapped in a JSON object',
						},
					],
					default: 'html',
					description: 'Format of the output data',
				},
				{
					displayName: 'Include Metadata',
					name: 'includeMetadata',
					type: 'boolean',
					default: false,
					description: 'Whether to include metadata about the HTML (length, structure info)',
				},
			],
		},
		{
			displayName: 'Fallback Attribute Name',
			name: 'fallbackAttributeName',
			type: 'string',
			default: '',
			placeholder: 'href, src, data-ID',
			description: 'Name of the attribute to extract from the element',
			displayOptions: {
				show: {
					operation: ['decision'],
					fallbackAction: ['extract'],
					fallbackExtractionType: ['attribute'],
				},
			},
		},
		{
			displayName: 'Fallback Text',
			name: 'fallbackText',
			type: 'string',
			default: '',
			description: 'Text to enter into the form field in the fallback action',
			displayOptions: {
				show: {
					operation: ['decision'],
					fallbackAction: ['fill'],
				},
			},
		},
		{
			displayName: 'Fallback Input Type',
			name: 'fallbackInputType',
			type: 'options',
			options: [
				{
					name: 'Checkbox',
					value: 'checkbox',
					description: 'Checkbox input element',
				},
				{
					name: 'File Upload',
					value: 'file',
					description: 'File input element',
				},
				{
					name: 'Radio Button',
					value: 'radio',
					description: 'Radio button input element',
				},
				{
					name: 'Select / Dropdown',
					value: 'select',
					description: 'Dropdown select element',
				},
				{
					name: 'Text / Textarea',
					value: 'text',
					description: 'Standard text input or textarea',
				},
			],
			default: 'text',
			description: 'Type of form input to interact with in the fallback action',
			displayOptions: {
				show: {
					operation: ['decision'],
					fallbackAction: ['fill'],
				},
			},
		},
		{
			displayName: 'Fallback Clear Field First',
			name: 'fallbackClearField',
			type: 'boolean',
			default: false,
			description: 'Whether to clear the field before entering text (useful for pre-filled inputs)',
			displayOptions: {
				show: {
					operation: ['decision'],
					fallbackAction: ['fill'],
					fallbackInputType: ['text'],
				},
			},
		},
		{
			displayName: 'Fallback Press Enter After Input',
			name: 'fallbackPressEnter',
			type: 'boolean',
			default: false,
			description: 'Whether to press Enter after entering text (useful for forms that submit on Enter)',
			displayOptions: {
				show: {
					operation: ['decision'],
					fallbackAction: ['fill'],
					fallbackInputType: ['text'],
				},
			},
		},
		{
			displayName: 'Fallback Check State',
			name: 'fallbackCheckState',
			type: 'options',
			options: [
				{
					name: 'Check / Select',
					value: 'check',
					description: 'Check/select the element',
				},
				{
					name: 'Uncheck / Deselect',
					value: 'uncheck',
					description: 'Uncheck/deselect the element',
				},
				{
					name: 'Toggle',
					value: 'toggle',
					description: 'Toggle the current state',
				},
			],
			default: 'check',
			description: 'Whether to check or uncheck the checkbox/radio button',
			displayOptions: {
				show: {
					operation: ['decision'],
					fallbackAction: ['fill'],
					fallbackInputType: ['checkbox', 'radio'],
				},
			},
		},
		{
			displayName: 'Fallback File Path',
			name: 'fallbackFilePath',
			type: 'string',
			default: '',
			description: 'Path to the file to upload (must be accessible to the Ventriloquist server)',
			displayOptions: {
				show: {
					operation: ['decision'],
					fallbackAction: ['fill'],
					fallbackInputType: ['file'],
				},
			},
		},
		{
			displayName: 'Fallback URL',
			name: 'fallbackUrl',
			type: 'string',
			default: '',
			placeholder: 'https://example.com/fallback',
			description: 'URL to navigate to in the fallback action',
			displayOptions: {
				show: {
					operation: ['decision'],
					fallbackAction: ['navigate'],
				},
			},
		},
		{
			displayName: 'Wait After Fallback',
			name: 'waitAfterFallback',
			type: 'options',
			options: [
				{
					name: 'DOM Content Loaded',
					value: 'domContentLoaded',
					description: 'Wait until the DOM content is loaded (faster)',
				},
				{
					name: 'Fixed Time',
					value: 'fixedTime',
					description: 'Wait for a specific amount of time',
				},
				{
					name: 'Navigation Complete',
					value: 'navigationComplete',
					description: 'Wait until navigation is complete (slower but more thorough)',
				},
				{
					name: 'No Wait',
					value: 'noWait',
					description: 'Do not wait after the action',
				},
				{
					name: 'URL Changed',
					value: 'urlChanged',
					description: 'Wait only until the URL changes to confirm navigation started',
				},
			],
			default: 'domContentLoaded',
			description: 'What to wait for after performing the fallback action',
			displayOptions: {
				show: {
					operation: ['decision'],
					fallbackAction: ['click', 'navigate'],
				},
			},
		},
		{
			displayName: 'Fallback Wait Time (MS)',
			name: 'fallbackWaitTime',
			type: 'number',
			default: 2000,
			description: 'Time to wait in milliseconds for fallback action (for fixed time wait)',
			displayOptions: {
				show: {
					operation: ['decision'],
					fallbackAction: ['click', 'navigate'],
					waitAfterFallback: ['fixedTime'],
				},
			},
		},
		{
			displayName: 'Fallback Route Name or ID',
			name: 'fallbackRoute',
			type: 'options',
			default: '',
			description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			displayOptions: {
				show: {
					'/operation': ['decision'],
					'/enableRouting': [true],
				},
			},
			typeOptions: {
				loadOptionsMethod: 'getRoutes',
			},
		},
		{
			displayName: 'Wait for Selectors',
			name: 'waitForSelectors',
			type: 'boolean',
			default: true,
			description: 'Whether to wait for selectors to appear before checking conditions',
			displayOptions: {
				show: {
					operation: ['decision'],
				},
			},
		},
		{
			displayName: 'Detection Method',
			name: 'detectionMethod',
			type: 'options',
			options: [
				{
					name: 'Smart Detection (DOM-Aware)',
					value: 'smart',
					description: 'Intelligently detects when the page is fully loaded before checking for elements (faster for elements that don\'t exist)',
				},
				{
					name: 'Fixed Timeout',
					value: 'fixed',
					description: 'Simply waits for the specified timeout (may be slower but more thorough)',
				},
			],
			default: 'smart',
			description: 'Method to use when checking for elements',
			displayOptions: {
				show: {
					operation: ['decision'],
					waitForSelectors: [true],
				},
			},
		},
		{
			displayName: 'Timeout',
			name: 'selectorTimeout',
			type: 'number',
			default: 5000,
			description: 'Maximum time in milliseconds to wait for selectors to appear',
			displayOptions: {
				show: {
					operation: ['decision'],
					waitForSelectors: [true],
				},
			},
		},
		{
			displayName: 'Early Exit Delay (MS)',
			name: 'earlyExitDelay',
			type: 'number',
			default: 500,
			description: 'Time in milliseconds to wait after DOM is loaded before checking for elements (for Smart Detection only)',
			displayOptions: {
				show: {
					operation: ['decision'],
					waitForSelectors: [true],
					detectionMethod: ['smart'],
				},
			},
		},
		{
			displayName: 'Use Human-Like Delays',
			name: 'useHumanDelays',
			type: 'boolean',
			default: true,
			description: 'Whether to use random delays between actions to simulate human behavior (100-300ms)',
			displayOptions: {
				show: {
					operation: ['decision'],
				},
			},
		},
		{
			displayName: 'Take Screenshot',
			name: 'takeScreenshot',
			type: 'boolean',
			default: false,
			description: 'Whether to take a screenshot after the decision operation completes',
			displayOptions: {
				show: {
					operation: ['decision'],
				},
			},
		},
		{
			displayName: 'Continue On Fail',
			name: 'continueOnFail',
			type: 'boolean',
			default: true,
			description: 'Whether to continue execution even when the operation fails',
			displayOptions: {
				show: {
					operation: ['decision'],
				},
			},
		},
	];

	/**
	 * Get a realistic human delay
	 */
	function getHumanDelay(): number {
		return Math.floor(Math.random() * (300 - 100 + 1) + 100);
	}

	/**
	 * Wait for navigation based on the specified wait type
	 */
	async function waitForNavigation(page: puppeteer.Page, waitUntil: string, timeout: number): Promise<void> {
		// Default waitUntil option based on input string
		let waitUntilOption: puppeteer.PuppeteerLifeCycleEvent | puppeteer.PuppeteerLifeCycleEvent[] = 'domcontentloaded';

		// Parse waitUntil string into appropriate option
		switch (waitUntil) {
			case 'load':
				waitUntilOption = 'load';
				break;
			case 'domcontentloaded':
				waitUntilOption = 'domcontentloaded';
				break;
			case 'networkidle0':
				waitUntilOption = 'networkidle0';
				break;
			case 'networkidle2':
				waitUntilOption = 'networkidle2';
				break;
			case 'multiple':
				waitUntilOption = ['domcontentloaded', 'networkidle0'];
				break;
			default:
				waitUntilOption = 'domcontentloaded';
				break;
		}

		// Wait for navigation with the specified options
		await page.waitForNavigation({
			waitUntil: waitUntilOption,
			timeout,
		});
	}

	/**
	 * Smart wait for element with DOM-aware early exit strategy
	 */
	async function smartWaitForSelector(
		page: puppeteer.Page,
		selector: string,
		timeout: number,
		earlyExitDelay: number,
		logger: IExecuteFunctions['logger'],
	): Promise<boolean> {
		// Create a promise that resolves when the element is found
		const elementPromise = page.waitForSelector(selector, { timeout })
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

		logger.debug(`DOM state: readyState=${domState.readyState}, bodyExists=${domState.bodyExists}`);

		// If DOM is not loaded yet, wait for it
		if (domState.readyState !== 'complete' && domState.readyState !== 'interactive') {
			logger.debug('DOM not ready, waiting for it to load...');
			await page.waitForFunction(
				() => document.readyState === 'complete' || document.readyState === 'interactive',
				{ timeout: Math.min(timeout, 10000) }, // Cap at 10 seconds max for DOM loading
			);
		}

		// If there's no body yet (rare case), wait for it
		if (!domState.bodyExists) {
			logger.debug('Document body not found, waiting for it...');
			await page.waitForFunction(() => !!document.body, {
				timeout: Math.min(timeout, 5000), // Cap at 5 seconds max for body
			});
		}

		// Wait a small delay to allow dynamic content to load
		if (earlyExitDelay > 0) {
			logger.debug(`Waiting ${earlyExitDelay}ms early exit delay...`);
			await new Promise(resolve => setTimeout(resolve, earlyExitDelay));
		}

		// Check if element exists without waiting (quick check)
		const elementExistsNow = await page.evaluate((sel) => {
			return document.querySelector(sel) !== null;
		}, selector);

		if (elementExistsNow) {
			logger.debug(`Element found immediately after DOM ready: ${selector}`);
			return true;
		}

		logger.debug(`Element not found in initial check, waiting up to timeout: ${selector}`);
		// If not found immediately, wait for the original promise with timeout
		return elementPromise;
	}

	/**
	 * Evaluate a single condition
	 */
	async function evaluateCondition(
		page: puppeteer.Page,
		condition: IDataObject,
		conditionType: string,
		waitForSelectors: boolean,
		selectorTimeout: number,
		detectionMethod: string,
		earlyExitDelay: number,
		currentUrl: string,
		index: number,
		thisNode: IExecuteFunctions
	): Promise<boolean> {
		try {
			// Create detection options once
			const detectionOptions: IDetectionOptions = {
				waitForSelectors,
				selectorTimeout,
				detectionMethod,
				earlyExitDelay,
				nodeName: thisNode.getNode().name,
				nodeId: thisNode.getNode().id,
				index,
			};

			let result: IDetectionResult;

			switch (conditionType) {
				case 'elementExists': {
					const selector = condition.selector as string;
					result = await detectElement(page, selector, detectionOptions, thisNode.logger);
					break;
				}

				case 'textContains': {
					const selector = condition.selector as string;
					const textToCheck = condition.textToCheck as string;
					const matchType = condition.matchType as string;
					const caseSensitive = condition.caseSensitive as boolean;

					result = await detectText(
						page,
						selector,
						textToCheck,
						matchType,
						caseSensitive,
						detectionOptions,
						thisNode.logger
					);
					break;
				}

				case 'elementCount': {
					const selector = condition.selector as string;
					const expectedCount = condition.expectedCount as number;
					const countComparison = condition.countComparison as string;

					result = await detectCount(
						page,
						selector,
						expectedCount,
						countComparison,
						detectionOptions,
						thisNode.logger
					);
					break;
				}

				case 'urlContains': {
					const urlSubstring = condition.urlSubstring as string;
					const matchType = condition.matchType as string || 'contains';
					const caseSensitive = condition.caseSensitive as boolean || false;

					result = await detectUrl(
						page,
						urlSubstring,
						matchType,
						caseSensitive,
						detectionOptions,
						thisNode.logger
					);
					break;
				}

				case 'jsExpression': {
					const jsExpression = condition.jsExpression as string;
					result = await detectExpression(page, jsExpression, detectionOptions, thisNode.logger);
					break;
				}

				default:
					// Unrecognized condition type
					thisNode.logger.warn(`Unrecognized condition type: ${conditionType}`);
					return false;
			}

			return result.success;
		} catch (error) {
			// Log the error but don't stop execution
			thisNode.logger.error(formatOperationLog('Decision', thisNode.getNode().name, thisNode.getNode().id, index,
				`Error evaluating condition type ${conditionType}: ${(error as Error).message}`));

			// Return false on any error in condition evaluation
			return false;
		}
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

		// Store this parameter at the top level so it's available in the catch block
		const continueOnFail = this.getNodeParameter('continueOnFail', index, true) as boolean;
		let screenshot: string | undefined;

		// Added for better logging
		const nodeName = this.getNode().name;
		const nodeId = this.getNode().id;

		// Get existing session ID parameter if available - moved outside try block to make available in catch
		const explicitSessionId = this.getNodeParameter('sessionId', index, '') as string;
		let sessionId = explicitSessionId;
		let puppeteerPage: puppeteer.Page | null = null;

		// Visual marker to clearly indicate a new node is starting
		this.logger.info("============ STARTING NODE EXECUTION ============");
		this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index, `Starting execution`));

		try {
			// Use the centralized session management
			const sessionResult = await SessionManager.getOrCreatePageSession(this.logger, {
				explicitSessionId,
				websocketEndpoint,
				workflowId,
				operationName: 'Decision',
				nodeId,
				nodeName,
				index,
			});

			puppeteerPage = sessionResult.page;
			sessionId = sessionResult.sessionId;

			if (!puppeteerPage) {
				throw new Error('Failed to get or create a page');
			}

			// Update current URL after getting page
			let currentUrl = '';
			try {
				currentUrl = await puppeteerPage.url();
				this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
					`Current page URL is: ${currentUrl}`));
			} catch (urlError) {
				this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
					`Could not get URL after session management: ${(urlError as Error).message}`));
				currentUrl = 'unknown (connection issues)';
			}

			// Get operation parameters
			const conditionGroups = this.getNodeParameter('conditionGroups.groups', index, []) as IDataObject[];
			const fallbackAction = this.getNodeParameter('fallbackAction', index) as string;
			const waitForSelectors = this.getNodeParameter('waitForSelectors', index, true) as boolean;
			const selectorTimeout = this.getNodeParameter('selectorTimeout', index, 5000) as number;
			const detectionMethod = this.getNodeParameter('detectionMethod', index, 'smart') as string;
			const earlyExitDelay = this.getNodeParameter('earlyExitDelay', index, 500) as number;
			const useHumanDelays = this.getNodeParameter('useHumanDelays', index, true) as boolean;
			const takeScreenshot = this.getNodeParameter('takeScreenshot', index, false) as boolean;

			// Log parameters for debugging
			this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
				`Parameters: waitForSelectors=${waitForSelectors}, selectorTimeout=${selectorTimeout}, detectionMethod=${detectionMethod}`));
			this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
				`Evaluating ${conditionGroups.length} condition groups with fallbackAction=${fallbackAction}`));

			// Validate session ID - add extra logging to help debug issues
			if (!explicitSessionId) {
				this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
					"WARNING: No session ID provided in the 'Session ID' field"));
				this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
					"For best results, you should provide the session ID from a previous Open operation in the 'Session ID' field"));
			} else {
				this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index, `Using session ID: ${explicitSessionId}`));
			}

			// Check if the page is valid
			if (!puppeteerPage) {
				throw new Error('Page is null or undefined');
			}

			// Verify the document content to ensure we have a valid page
			try {
				const docHtml = await puppeteerPage.evaluate(() => document.documentElement.outerHTML.length);
				this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
					`Document verified - contains ${docHtml} characters of HTML`));
			} catch (docError) {
				this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
					`Cannot access document: ${(docError as Error).message}`));
				if (!continueOnFail) {
					throw new Error(`Cannot access page document: ${(docError as Error).message}`);
				}
			}

			// Get routing parameters
			const enableRouting = this.getNodeParameter('enableRouting', index, false) as boolean;

			// Initialize routing variables
			let routeTaken = 'none';
			let actionPerformed = 'none';
			let routeIndex = 0;
			let pageUrl = '';

			try {
				pageUrl = await puppeteerPage.url();
			} catch (urlError) {
				this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
					`Error getting page URL: ${(urlError as Error).message}`));
				pageUrl = 'unknown';
			}

			// Prepare the result data structure
			const resultData: {
				success: boolean;
				routeTaken: string;
				actionPerformed: string;
				currentUrl: string;
				pageTitle: string;
				screenshot: string | undefined;
				executionDuration: number;
				routeName?: string;
				extractedData?: Record<string, unknown>;
				sessionId: string;
				error?: string; // Add error property for error handling
				formFields?: IDataObject[];
				formSubmission?: IDataObject;
				formSubmissionRetries?: IDataObject[];
			} = {
				success: true,
				routeTaken,
				actionPerformed,
				currentUrl: pageUrl,
				pageTitle: await puppeteerPage.title(),
				screenshot,
				executionDuration: 0, // Will be updated at the end
				sessionId: sessionId, // Use the parameter instead of trying to get it from the page
			};

			// If there's an inputSessionId, use it and log it
			if (explicitSessionId) {
				this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
					`Using provided session ID: ${explicitSessionId}`));

				// Check if the page URL is blank or about:blank, which might indicate a problem
				if (pageUrl === 'about:blank' || pageUrl === '') {
					this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
						`WARNING: Page URL is ${pageUrl} - this may indicate the session was not properly loaded`));
					this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
						`Verify that you're using the correct session ID from the Open operation`));
				}
			} else {
				// As a fallback, still try to get the session ID from the page
				try {
					const pageSessionId = await puppeteerPage.evaluate(() => {
						interface VentriloquistWindow extends Window {
							__VENTRILOQUIST_SESSION_ID__?: string;
						}
						return (window as VentriloquistWindow).__VENTRILOQUIST_SESSION_ID__ || '';
					});

					if (pageSessionId) {
						resultData.sessionId = pageSessionId;
						this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
							`Found session ID in page: ${pageSessionId}`));
					} else {
						this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
							`No session ID provided or found in page`));
					}
				} catch (error) {
					this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
						`Error retrieving session ID from page: ${(error as Error).message}`));
				}
			}

			// Check each condition group
			for (const group of conditionGroups) {
				const groupName = group.name as string;
				const invertCondition = group.invertCondition as boolean || false;

				// Get condition type (default to one if not set)
				const conditionType = group.conditionType as string || 'one';

				// Get route if routing is enabled
				if (enableRouting) {
					const groupRoute = group.route as number;
					if (groupRoute) {
						// Route numbers are 1-based, but indexes are 0-based
						routeIndex = groupRoute - 1;
					}
				}

				this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
					`Checking group: "${groupName}" (type: ${conditionType}, invert: ${invertCondition})`));

				// Initialize the overall condition result
				let groupConditionMet = false;

				try {
					// Handle the different condition types
					if (conditionType === 'one') {
						// Handle single condition case with direct parameters (not in a collection)
						const singleConditionType = group.singleConditionType as string || 'elementExists';
						const invertSingleCondition = group.singleInvertCondition as boolean || false;

						// Create a condition object from the single condition parameters
						const singleCondition: IDataObject = {
							conditionType: singleConditionType,
							invertCondition: invertSingleCondition,
						};

						// Add specific fields based on condition type
						switch (singleConditionType) {
							case 'elementExists':
							case 'textContains':
							case 'elementCount':
								singleCondition.selector = group.singleSelector as string;
								break;
							case 'expression':
								singleCondition.jsExpression = group.singleJsExpression as string;
								break;
							case 'inputSource':
								singleCondition.sourceNodeName = group.singleSourceNodeName as string;
								break;
							case 'executionCount':
								singleCondition.executionCountComparison = group.singleExecutionCountComparison as string;
								singleCondition.executionCountValue = group.singleExecutionCountValue as number;
								break;
							case 'urlContains':
								singleCondition.urlSubstring = group.singleUrlSubstring as string;
								break;
						}

						// Add additional fields for specific condition types
						if (singleConditionType === 'textContains') {
							singleCondition.textToCheck = group.singleTextToCheck as string;
							singleCondition.matchType = group.singleMatchType as string;
							singleCondition.caseSensitive = group.singleCaseSensitive as boolean;
						}

						if (singleConditionType === 'urlContains') {
							singleCondition.matchType = group.singleMatchType as string;
							singleCondition.caseSensitive = group.singleCaseSensitive as boolean;
						}

						if (singleConditionType === 'elementCount') {
							singleCondition.countComparison = group.singleCountComparison as string;
							singleCondition.expectedCount = group.singleExpectedCount as number;
						}

						// Evaluate the single condition
						groupConditionMet = await evaluateCondition(
							puppeteerPage,
							singleCondition,
							singleConditionType,
							waitForSelectors,
							selectorTimeout,
							detectionMethod,
							earlyExitDelay,
							currentUrl,
							index,
							this
						);

						// Apply inversion if needed
						if (invertSingleCondition) {
							groupConditionMet = !groupConditionMet;
						}

						this.logger.debug(formatOperationLog('Decision', nodeName, nodeId, index,
							`Single condition (${singleConditionType}) result: ${groupConditionMet}`));
					} else {
						// Handle multiple conditions with AND/OR logic
						// Get conditions and ensure type safety
						let conditions: IDataObject[] = [];
						if (group.conditions &&
							typeof group.conditions === 'object' &&
							(group.conditions as IDataObject).condition &&
							Array.isArray((group.conditions as IDataObject).condition)) {
							conditions = (group.conditions as IDataObject).condition as IDataObject[];
						}

						this.logger.debug(formatOperationLog('Decision', nodeName, nodeId, index,
							`Checking ${conditions.length} conditions with ${conditionType} logic`));

						// Handle the case of no conditions - default to false
						if (conditions.length === 0) {
							this.logger.debug(formatOperationLog('Decision', nodeName, nodeId, index,
								`No conditions in group ${groupName}, skipping`));
							groupConditionMet = false;
						} else if (conditions.length === 1) {
							// Single condition in multiple conditions case
							const condition = conditions[0];
							const singleConditionType = condition.conditionType as string;
							const invertSingleCondition = condition.invertCondition as boolean || false;

							// Evaluate the single condition
							groupConditionMet = await evaluateCondition(
								puppeteerPage,
								condition,
								singleConditionType,
								waitForSelectors,
								selectorTimeout,
								detectionMethod,
								earlyExitDelay,
								currentUrl,
								index,
								this
							);

							// Apply inversion if needed
							if (invertSingleCondition) {
								groupConditionMet = !groupConditionMet;
							}

							this.logger.debug(formatOperationLog('Decision', nodeName, nodeId, index,
								`Single condition in collection (${singleConditionType}) result: ${groupConditionMet}`));
						} else {
							// Multiple conditions case - apply logical operator based on conditionType
							if (conditionType === 'and') {
								// AND logic - start with true, any false makes it false
								groupConditionMet = true;

								for (const condition of conditions) {
									const singleConditionType = condition.conditionType as string;
									const invertSingleCondition = condition.invertCondition as boolean || false;

									// Evaluate the condition
									let conditionMet = await evaluateCondition(
										puppeteerPage,
										condition,
										singleConditionType,
										waitForSelectors,
										selectorTimeout,
										detectionMethod,
										earlyExitDelay,
										currentUrl,
										index,
										this
									);

									// Apply inversion if needed
									if (invertSingleCondition) {
										conditionMet = !conditionMet;
									}

									// Short circuit if any condition is false
									if (!conditionMet) {
										groupConditionMet = false;
										this.logger.debug(formatOperationLog('Decision', nodeName, nodeId, index,
											`Condition (${singleConditionType}) is false, short-circuiting AND logic`));
										break;
									}
								}
							} else if (conditionType === 'or') {
								// OR logic - start with false, any true makes it true
								groupConditionMet = false;

								for (const condition of conditions) {
									const singleConditionType = condition.conditionType as string;
									const invertSingleCondition = condition.invertCondition as boolean || false;

									// Evaluate the condition
									let conditionMet = await evaluateCondition(
										puppeteerPage,
										condition,
										singleConditionType,
										waitForSelectors,
										selectorTimeout,
										detectionMethod,
										earlyExitDelay,
										currentUrl,
										index,
										this
									);

									// Apply inversion if needed
									if (invertSingleCondition) {
										conditionMet = !conditionMet;
									}

									// Short circuit if any condition is true
									if (conditionMet) {
										groupConditionMet = true;
										this.logger.debug(formatOperationLog('Decision', nodeName, nodeId, index,
											`Condition (${singleConditionType}) is true, short-circuiting OR logic`));
										break;
									}
								}
							}

							this.logger.debug(formatOperationLog('Decision', nodeName, nodeId, index,
								`Multiple conditions with ${conditionType} logic result: ${groupConditionMet}`));
						}
					}

					this.logger.debug(formatOperationLog('Decision', nodeName, nodeId, index,
						`Decision group ${groupName} final result: ${groupConditionMet}`));

					// If condition is met
					if (groupConditionMet) {
						routeTaken = groupName;
						const actionType = group.actionType as string;

						this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
							`Condition met for group "${groupName}", taking this route`));

						// For routing capability, store route information
						if (enableRouting) {
							const groupRoute = group.route as number;
							if (groupRoute) {
								// Route numbers are 1-based, but indexes are 0-based
								routeIndex = groupRoute - 1;
								this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
									`Using route: ${groupRoute} (index: ${routeIndex})`));
							}
						}

						if (actionType !== 'none') {
							actionPerformed = actionType;
							this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
								`Performing action: "${actionType}"`));

							// Add human-like delay if enabled
							if (useHumanDelays) {
								await new Promise(resolve => setTimeout(resolve, getHumanDelay()));
							}

							switch (actionType) {
								case 'click': {
									const actionSelector = group.actionSelector as string;
									const waitAfterAction = group.waitAfterAction as string;
									// Fix: Ensure waitTime has a default value based on the waitAfterAction type
									let waitTime = group.waitTime as number;
									if (waitTime === undefined) {
										waitTime = waitAfterAction === 'fixedTime' ? 2000 :
												  waitAfterAction === 'urlChanged' ? 6000 : 30000;
									}

									this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
										`Executing click on "${actionSelector}" (wait: ${waitAfterAction}, timeout: ${waitTime}ms)`));

									try {
										// Use the waitAndClick utility which handles both waiting for the selector and clicking it
										const clickResult = await waitAndClick(
											puppeteerPage,
											actionSelector,
											{
												waitTimeout: selectorTimeout,
												retries: 2,
												waitBetweenRetries: 1000,
												logger: this.logger
											}
										);

										// Handle click failures
										if (!clickResult.success) {
											throw new Error(`Decision action: Failed to click element "${actionSelector}": ${clickResult.error?.message || 'Unknown error'}`);
										}

										this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
											`Click successful on "${actionSelector}"`));

										// Handle post-click waiting
										if (waitAfterAction === 'fixedTime') {
											await new Promise(resolve => setTimeout(resolve, waitTime));
										} else if (waitAfterAction === 'urlChanged') {
											await puppeteerPage.waitForNavigation({ timeout: waitTime });
										} else if (waitAfterAction === 'selector') {
											const waitSelector = group.waitSelector as string;
											await puppeteerPage.waitForSelector(waitSelector, { timeout: waitTime });
										}

										// After successful action, exit immediately
										this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
											`Decision point "${groupName}": Action completed successfully - exiting decision node`));
										resultData.success = true;
										resultData.routeTaken = groupName;
										resultData.actionPerformed = actionType;
										resultData.currentUrl = await puppeteerPage.url();
										resultData.pageTitle = await puppeteerPage.title();
										resultData.executionDuration = Date.now() - startTime;

										// Take screenshot if requested
										if (takeScreenshot) {
											const screenshotResult = await captureScreenshot(puppeteerPage, this.logger);
											if (screenshotResult !== null) {
												resultData.screenshot = screenshotResult;
											}
										}

										// Return the result immediately after successful action
										return [this.helpers.returnJsonArray([resultData])];
									} catch (error) {
										this.logger.error(formatOperationLog('Decision', nodeName, nodeId, index,
											`Error during click action: ${(error as Error).message}`));
										throw error;
									}
								}
								case 'fill': {
									// Check if we have simple action fields or complex form fields
									const hasActionSelector = !!group.actionSelector;
									const hasFormFields = !!(group.formFields && (group.formFields as IDataObject).fields);

									// Get browser session information and credential type for compatibility
									const workflowId = this.getWorkflow().id || '';
									// Get all active sessions and find the one for this workflow
									const allSessions = SessionManager.getAllSessions();
									let session = null;
									for (const sessionInfo of allSessions) {
										if (sessionInfo.info.workflowId === workflowId) {
											session = SessionManager.getSession(sessionInfo.sessionId);
											break;
										}
									}
									let credentialType = 'brightDataApi'; // Default

									if (session && typeof (session as any).credentialType === 'string') {
										credentialType = (session as any).credentialType;
										this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
											`Using credential type from session: ${credentialType}`));
									} else {
										this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
											`No credential type found in session, defaulting to: ${credentialType}`));
									}

									// Store credential type for field handling
									group._credentialType = credentialType;

									// Log what approach we're using for debugging
									this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
										`Form fill approach: ${hasActionSelector ? 'Simple' : hasFormFields ? 'Complex' : 'Unknown'} with provider: ${credentialType}`));

									try {
										// Handle simple action selector approach
										if (hasActionSelector) {
											const actionSelector = group.actionSelector as string;
											const actionValue = group.actionValue as string;
											const waitAfterAction = group.waitAfterAction as string;
											const fieldType = group.fieldType as string || 'text';
											let waitTime = group.waitTime as number;
											if (waitTime === undefined) {
												waitTime = waitAfterAction === 'fixedTime' ? 2000 :
														  waitAfterAction === 'urlChanged' ? 6000 : 30000;
											}

											this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
												`Executing simple fill on "${actionSelector}" (wait: ${waitAfterAction}, timeout: ${waitTime}ms)`));

											// For actions, we always need to ensure the element exists
											if (waitForSelectors) {
												if (detectionMethod === 'smart') {
													const elementExists = await smartWaitForSelector(
														puppeteerPage,
														actionSelector,
														selectorTimeout,
														earlyExitDelay,
														this.logger,
													);

													if (!elementExists) {
														throw new Error(`Decision action: Element "${actionSelector}" required for this path is not present or visible`);
													}
												} else {
													await puppeteerPage.waitForSelector(actionSelector, { timeout: selectorTimeout });
												}
											}

											// Process the form field using our utility function
											const field: IDataObject = {
												fieldType,
												selector: actionSelector,
												value: actionValue,
												// Add options based on field type
												...(fieldType === 'text' ? {
													clearField: true,
													humanLike: useHumanDelays
												} : {}),
												...(fieldType === 'password' ? {
													clearField: true
												} : {})
											};

											const { success, fieldResult } = await processFormField(
												puppeteerPage,
												field,
												this.logger
											);

											if (!success) {
												throw new Error(`Failed to fill form field: ${actionSelector} (type: ${fieldType})`);
											}

											// Store field result for response
											if (!resultData.formFields) {
												resultData.formFields = [];
											}
											(resultData.formFields as IDataObject[]).push(fieldResult);

											// Handle post-fill waiting
											if (waitAfterAction === 'fixedTime') {
												await new Promise(resolve => setTimeout(resolve, waitTime));
											} else if (waitAfterAction === 'urlChanged') {
												await puppeteerPage.waitForNavigation({ timeout: waitTime });
											} else if (waitAfterAction === 'selector') {
												const waitSelector = group.waitSelector as string;
												await puppeteerPage.waitForSelector(waitSelector, { timeout: waitTime });
											}
										}
										// Handle complex form fields approach
										else if (hasFormFields) {
											// Get form parameters
											const formFields = (group.formFields as IDataObject).fields as IDataObject[] || [];
											const submitForm = group.submitForm as boolean || false;
											const submitSelector = group.submitSelector as string || '';
											const waitAfterSubmit = group.waitAfterSubmit as string || 'domContentLoaded';
											const waitSubmitTime = group.waitSubmitTime as number || 2000;

											this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
												`Using complex form fill with ${formFields.length} fields`));

											// Process each form field
											const results: IDataObject[] = [];
											for (const field of formFields) {
												const selector = field.selector as string;
												const fieldType = field.fieldType as string || 'text';

												// Wait for the element if needed
												if (waitForSelectors) {
													if (detectionMethod === 'smart') {
														const elementExists = await smartWaitForSelector(
															puppeteerPage,
															selector,
															selectorTimeout,
															earlyExitDelay,
															this.logger,
														);

														if (!elementExists) {
															throw new Error(`Form field element with selector "${selector}" not found`);
														}
													} else {
														await puppeteerPage.waitForSelector(selector, { timeout: selectorTimeout });
													}
												}

												// Add a human-like delay if enabled
												if (useHumanDelays) {
													await new Promise(resolve => setTimeout(resolve, getHumanDelay()));
												}

												// Process the form field using the utility function
												const { success, fieldResult } = await processFormField(
													puppeteerPage,
													field,
													this.logger
												);

												// Add context to the field result
												fieldResult.nodeId = nodeId;
												fieldResult.nodeName = nodeName;

												// Add the field result to our results collection
												results.push(fieldResult);

												// If the field failed and we're not continuing on failure, throw an error
												if (!success && !continueOnFail) {
													throw new Error(`Failed to fill form field: ${selector} (type: ${fieldType})`);
												}
											}

											// Add form results to response data
											if (!resultData.formFields) {
												resultData.formFields = [];
											}
											(resultData.formFields as IDataObject[]).push(...results);

											// Submit the form if requested
											if (submitForm && submitSelector) {
												this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
													`Submitting form using selector: ${submitSelector}`));

												// Wait a short time before submitting (feels more human)
												if (useHumanDelays) {
													await new Promise(resolve => setTimeout(resolve, getHumanDelay()));
												}

												try {
													// Create a promise that will resolve when the next navigation happens
													const navigationPromise = waitAfterSubmit !== 'noWait' ?
														puppeteerPage.waitForNavigation({
															waitUntil: waitAfterSubmit === 'multiple' ? ['domcontentloaded', 'networkidle0'] :
																(waitAfterSubmit as puppeteer.PuppeteerLifeCycleEvent || 'domcontentloaded'),
															timeout: waitSubmitTime
														}) :
														Promise.resolve();

													// Click the submit button
													this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
														`Clicking submit button: ${submitSelector}`));
													await puppeteerPage.click(submitSelector);
													this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
														`Submit button clicked successfully`));

													// Wait for navigation to complete
													if (waitAfterSubmit !== 'noWait') {
														this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
															`Waiting for navigation to complete (timeout: ${waitSubmitTime}ms)`));
														await navigationPromise;
														this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
															`Navigation completed successfully after form submission`));
													}

													// Store form submission result
													resultData.formSubmission = {
														success: true,
														submitSelector,
														waitAfterSubmit,
														waitSubmitTime
													};
												} catch (navError) {
													this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
														`Navigation error after form submission: ${(navError as Error).message}`));
													this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
														`This is often normal with redirects - attempting to continue`));

													// Store form submission result with error
													resultData.formSubmission = {
														success: false,
														error: (navError as Error).message,
														submitSelector,
														waitAfterSubmit,
														waitSubmitTime
													};
												}
											}
										}
									} catch (error) {
										this.logger.error(formatOperationLog('Decision', nodeName, nodeId, index,
													`Error during fill action: ${(error as Error).message}`));
										this.logger.error(formatOperationLog('Decision', nodeName, nodeId, index,
													`Action execution error in group "${groupName}": ${(error as Error).message}`));

										if (continueOnFail) {
											// If continueOnFail is enabled, update result and move on
											resultData.success = false;
											resultData.routeTaken = 'none';
											resultData.actionPerformed = 'error';
											resultData.currentUrl = await puppeteerPage.url();
											resultData.pageTitle = await puppeteerPage.title();
											resultData.error = (error as Error).message;
											resultData.executionDuration = Date.now() - startTime;

											// Exit the decision node with the error result
											return [this.helpers.returnJsonArray([resultData])];
										}

										// If continueOnFail is not enabled, rethrow the error
										throw error;
									}
								}
								case 'extract': {
									const actionSelector = group.actionSelector as string;
									const extractionType = group.extractionType as string;

									if (waitForSelectors) {
										// For actions, we always need to ensure the element exists
										if (detectionMethod === 'smart') {
											const elementExists = await smartWaitForSelector(
												puppeteerPage,
												actionSelector,
												selectorTimeout,
												earlyExitDelay,
												this.logger,
											);

											if (!elementExists) {
												throw new Error(`Element with selector "${actionSelector}" not found for extraction`);
											}
										} else {
											await puppeteerPage.waitForSelector(actionSelector, { timeout: selectorTimeout });
										}
									}

									// Extract data based on extraction type
									let extractedData: string | null | IDataObject | IDataObject[] | string[][] | string[] = null;
									switch (extractionType) {
										case 'text':
											extractedData = await extractTextContent(
												puppeteerPage,
												actionSelector,
												this.logger,
												nodeName,
												nodeId
											);
											break;
										case 'html': {
											// Get HTML options
											const htmlOptions = group.htmlOptions as IDataObject || {};
											const outputFormat = (htmlOptions.outputFormat as string) || 'html';
											const includeMetadata = htmlOptions.includeMetadata as boolean || false;

											extractedData = await extractHtmlContent(
												puppeteerPage,
												actionSelector,
												{
													outputFormat,
													includeMetadata,
												},
												this.logger,
												nodeName,
												nodeId
											);
											break;
										}
										case 'value':
											extractedData = await extractInputValue(
												puppeteerPage,
												actionSelector,
												this.logger,
												nodeName,
												nodeId
											);
											break;
										case 'attribute': {
											const attributeName = group.extractAttributeName as string;
											extractedData = await extractAttributeValue(
												puppeteerPage,
												actionSelector,
												attributeName,
												this.logger,
												nodeName,
												nodeId
											);
											break;
										}
										case 'multiple': {
											// Get options for multiple elements extraction
											const multipleOptions = group.multipleOptions as IDataObject || {};
											const extractionProperty = multipleOptions.extractionProperty as string || 'textContent';
											const limit = multipleOptions.limit as number || 50;
											const outputFormat = multipleOptions.outputFormat as string || 'array';
											const separator = multipleOptions.separator as string || ',';
											const attributeName = multipleOptions.attributeName as string || '';

											extractedData = await extractMultipleElements(
												puppeteerPage,
												actionSelector,
												{
													extractionProperty,
													limit,
													outputFormat,
													separator,
													attributeName,
												},
												this.logger,
												nodeName,
												nodeId
											);
											break;
										}
										case 'table': {
											// Get table options
											const tableOptions = group.tableOptions as IDataObject || {};
											const includeHeaders = tableOptions.includeHeaders as boolean ?? true;
											const tableRow = tableOptions.rowSelector as string || 'tr';
											const tableCell = tableOptions.cellSelector as string || 'td,th';
											const outputFormat = tableOptions.outputFormat as string || 'array';

											extractedData = await extractTableData(
												puppeteerPage,
												actionSelector,
												{
													includeHeaders,
													rowSelector: tableRow,
													cellSelector: tableCell,
													outputFormat,
												},
												this.logger,
												nodeName,
												nodeId
											);
											break;
										}
									}

									// Store the extracted data
									if (!resultData.extractedData) {
										resultData.extractedData = {};
									}
									resultData.extractedData.primary = extractedData;

									// Log the extraction result (truncated for readability)
									const truncatedData = formatExtractedDataForLog(extractedData, extractionType);
									this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
										`Extracted ${extractionType} data: ${truncatedData}`));

									// After successful extraction, exit immediately
									this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
										`Decision point "${groupName}": Extraction completed successfully - exiting decision node`));
									resultData.success = true;
									resultData.routeTaken = groupName;
									resultData.actionPerformed = actionType;
									resultData.currentUrl = await puppeteerPage.url();
									resultData.pageTitle = await puppeteerPage.title();
									resultData.executionDuration = Date.now() - startTime;

									// Take screenshot if requested
									if (takeScreenshot) {
										const screenshotResult = await captureScreenshot(puppeteerPage, this.logger);
										if (screenshotResult !== null) {
											resultData.screenshot = screenshotResult;
										}
									}

									// Return the result immediately after successful action
									return [this.helpers.returnJsonArray([resultData])];
								}
								case 'navigate': {
									const url = group.url as string;
									const waitAfterAction = group.waitAfterAction as string;
									const waitTime = group.waitTime as number;

									this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
										`Navigating to URL: ${url} (wait: ${waitAfterAction}, timeout: ${waitTime}ms)`));

									try {
										// Use navigationWithRetry utility for more robust navigation
										const navigationResult = await navigateWithRetry(
											puppeteerPage,
											url,
											{
												waitUntil: waitAfterAction as 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2',
												timeout: waitTime,
												maxRetries: 2,
												retryDelay: 1000,
											},
											this.logger
										);

										if (!navigationResult) {
											this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
												`Navigation may have encountered issues, but continuing execution`));
										} else {
											this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
												`Navigation completed successfully to ${url}`));
										}
									} catch (error) {
										this.logger.error(formatOperationLog('Decision', nodeName, nodeId, index,
											`Navigation error: ${(error as Error).message}`));
										throw error;
									}
									break;
								}
							}
						}

						// Exit after the first match - we don't continue checking conditions
						break;
					} else {
						// Important change: This is NOT an error, just a normal condition not being met
						this.logger.debug(formatOperationLog('Decision', nodeName, nodeId, index,
							`Condition not met for group "${groupName}", continuing to next condition`));
					}
				} catch (error) {
					// Check if this is a navigation timeout, which might be expected behavior
					const errorMessage = (error as Error).message;
					if (errorMessage.includes('Navigation timeout')) {
						// This is likely just a timeout during navigation, which might be expected
						this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
							`Navigation timeout in group "${groupName}": ${errorMessage} - this may be expected behavior`));
					} else if (errorMessage.includes('not found') || errorMessage.includes('not clickable or visible')) {
						// Not an error - decision point didn't match selected element
						this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
							`Decision point "${groupName}": Element not available - continuing to next decision`));

						// Add additional details at debug level
						this.logger.debug(formatOperationLog('Decision', nodeName, nodeId, index,
							`Details: ${errorMessage}`));
					} else {
						// This is a genuine error in execution, not just a condition failing
						this.logger.error(formatOperationLog('Decision', nodeName, nodeId, index,
							`Action execution error in group "${groupName}": ${errorMessage}`));
					}
					// No need for continue statement as it's the last statement in the loop
				}
			}

			// If no condition was met, set up fallback handling
			if (routeTaken === 'none') {
				// Set fallback route if routing is enabled, regardless of fallback action
				if (enableRouting) {
					const fallbackRoute = this.getNodeParameter('fallbackRoute', index, 1) as number;
					routeIndex = fallbackRoute - 1;

					// If we're routing but not performing an action, mark this state
					if (fallbackAction === 'none') {
						routeTaken = 'fallback-route';
						actionPerformed = 'none';
					}
				}

				// Perform fallback action if not 'none'
				if (fallbackAction !== 'none') {
					routeTaken = 'fallback';
						actionPerformed = fallbackAction;

					try {
						// Add human-like delay if enabled
						if (useHumanDelays) {
							await new Promise(resolve => setTimeout(resolve, getHumanDelay()));
						}

						switch (fallbackAction) {
							case 'click': {
								try {
									// Retrieve parameters one by one with detailed error handling
									let fallbackSelector: string;
									let waitAfterFallback: string;
									let fallbackWaitTime: number;

									try {
										fallbackSelector = this.getNodeParameter('fallbackSelector', index) as string;
										if (!fallbackSelector) {
											throw new Error('Fallback selector is empty');
										}
									} catch (error) {
										this.logger.error(formatOperationLog('Decision', nodeName, nodeId, index,
											`Missing required parameter: fallbackSelector`));
										throw new Error('Missing required parameter: fallbackSelector');
									}

									try {
										waitAfterFallback = this.getNodeParameter('waitAfterFallback', index, 'domcontentloaded') as string;
									} catch (error) {
										waitAfterFallback = 'domcontentloaded';
										this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
											`Using default value for waitAfterFallback: ${waitAfterFallback}`));
									}

									try {
										fallbackWaitTime = this.getNodeParameter('fallbackWaitTime', index, 5000) as number;
									} catch (error) {
										fallbackWaitTime = 5000;
										this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
											`Using default value for fallbackWaitTime: ${fallbackWaitTime}`));
									}

									this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
										`Executing fallback click on "${fallbackSelector}"`));

									// Use waitAndClick utility for consistent click behavior
									const clickResult = await waitAndClick(
										puppeteerPage,
										fallbackSelector,
										{
											waitTimeout: selectorTimeout,
											retries: 2,
											waitBetweenRetries: 1000,
											logger: this.logger
										}
									);

									// Handle click failures
									if (!clickResult.success) {
										throw new Error(`Fallback action: Failed to click element "${fallbackSelector}": ${clickResult.error?.message || 'Unknown error'}`);
									}

									this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
										`Fallback click successful on "${fallbackSelector}"`));

									// Wait according to specified wait type
									await waitForNavigation(puppeteerPage, waitAfterFallback, fallbackWaitTime);
								} catch (paramError) {
									this.logger.error(formatOperationLog('Decision', nodeName, nodeId, index,
										`Error in fallback click action: ${(paramError as Error).message}`));
									throw paramError;
								}
								break;
							}

							case 'extract': {
								const fallbackSelector = this.getNodeParameter('fallbackSelector', index) as string;
								const fallbackExtractionType = this.getNodeParameter('fallbackExtractionType', index) as string;

								if (waitForSelectors) {
									// For actions, we always need to ensure the element exists
									if (detectionMethod === 'smart') {
										const elementExists = await smartWaitForSelector(
											puppeteerPage,
											fallbackSelector,
											selectorTimeout,
											earlyExitDelay,
											this.logger
										);

										if (!elementExists) {
											throw new Error(`Element with selector "${fallbackSelector}" not found for fallback extraction`);
										}
									} else {
										await puppeteerPage.waitForSelector(fallbackSelector, { timeout: selectorTimeout });
									}
								}

								// Extract data based on extraction type
								let extractedData: string | null | IDataObject = null;
								try {
									switch (fallbackExtractionType) {
										case 'text':
											extractedData = await extractTextContent(
												puppeteerPage,
												fallbackSelector,
												this.logger,
												nodeName,
												nodeId
											);
											break;

										case 'html': {
											// Get HTML options
											const fallbackHtmlOptions = this.getNodeParameter('fallbackHtmlOptions', index, {}) as IDataObject;
											const outputFormat = (fallbackHtmlOptions.outputFormat as string) || 'html';
											const includeMetadata = fallbackHtmlOptions.includeMetadata as boolean || false;

											extractedData = await extractHtmlContent(
												puppeteerPage,
												fallbackSelector,
												{
													outputFormat,
													includeMetadata,
												},
												this.logger,
												nodeName,
												nodeId
											);
											break;
										}

										case 'value':
											extractedData = await extractInputValue(
												puppeteerPage,
												fallbackSelector,
												this.logger,
												nodeName,
												nodeId
											);
											break;

										case 'attribute': {
											const attributeName = this.getNodeParameter('fallbackAttributeName', index) as string;
											extractedData = await extractAttributeValue(
												puppeteerPage,
												fallbackSelector,
												attributeName,
												this.logger,
												nodeName,
												nodeId
											);
											break;
										}

										default:
											extractedData = await extractTextContent(
												puppeteerPage,
												fallbackSelector,
												this.logger,
												nodeName,
												nodeId
											);
									}
								} catch (error) {
									this.logger.error(formatOperationLog('Decision', nodeName, nodeId, index,
											`Fallback extraction error: ${(error as Error).message}`));
									throw error;
								}

								// Store the extracted data in the result
								if (!resultData.extractedData) {
									resultData.extractedData = {};
								}
								resultData.extractedData.fallback = extractedData;

								const truncatedData = formatExtractedDataForLog(extractedData, fallbackExtractionType);
								this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
									`Fallback: Extracted ${fallbackExtractionType} data from: ${fallbackSelector} - Value: ${truncatedData}`));
								break;
							}

							case 'fill': {
								const fallbackSelector = this.getNodeParameter('fallbackSelector', index) as string;
								const fallbackText = this.getNodeParameter('fallbackText', index) as string;
								const fallbackInputType = this.getNodeParameter('fallbackInputType', index, 'text') as string;

								if (waitForSelectors) {
									// For actions, we always need to ensure the element exists
									if (detectionMethod === 'smart') {
										const elementExists = await smartWaitForSelector(
											puppeteerPage,
											fallbackSelector,
											selectorTimeout,
											earlyExitDelay,
											this.logger
										);

										if (!elementExists) {
											throw new Error(`Fallback element with selector "${fallbackSelector}" not found`);
										}
									} else {
										await puppeteerPage.waitForSelector(fallbackSelector, { timeout: selectorTimeout });
									}
								}

								// Process the form field using the utility function
								const field: IDataObject = {
									fieldType: fallbackInputType,
									selector: fallbackSelector,
									value: fallbackText
								};

								// Add specific options based on input type
								if (fallbackInputType === 'text') {
									field.clearField = this.getNodeParameter('fallbackClearField', index, false) as boolean;
									field.pressEnter = this.getNodeParameter('fallbackPressEnter', index, false) as boolean;
									field.humanLike = useHumanDelays;
								} else if (fallbackInputType === 'checkbox' || fallbackInputType === 'radio') {
									field.checkState = this.getNodeParameter('fallbackCheckState', index, 'check') as string;
								} else if (fallbackInputType === 'file') {
									field.filePath = this.getNodeParameter('fallbackFilePath', index, '') as string;
								}

								this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
									`Processing fallback form field: ${fallbackSelector} (type: ${fallbackInputType})`));

								try {
									const { success, fieldResult } = await processFormField(
										puppeteerPage,
										field,
										this.logger
									);

									if (!success) {
										throw new Error(`Failed to fill form field: ${fallbackSelector} (type: ${fallbackInputType})`);
									}

									// Store field result for response
									if (!resultData.formFields) {
										resultData.formFields = [];
									}
									(resultData.formFields as IDataObject[]).push(fieldResult);

									this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
										`Fallback form field processed successfully: ${fallbackSelector}`));
								} catch (error) {
									this.logger.error(formatOperationLog('Decision', nodeName, nodeId, index,
										`Fallback form field error: ${(error as Error).message}`));
									throw error;
								}
								break;
							}

							case 'navigate': {
								const fallbackUrl = this.getNodeParameter('fallbackUrl', index) as string;
								const waitAfterFallback = this.getNodeParameter('waitAfterFallback', index) as string;
								const fallbackWaitTime = this.getNodeParameter('fallbackWaitTime', index) as number;

								this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
									`Executing fallback navigation to "${fallbackUrl}"`));

								try {
									// Use navigationWithRetry utility for more robust navigation
									const navigationResult = await navigateWithRetry(
										puppeteerPage,
										fallbackUrl,
										{
											waitUntil: waitAfterFallback as 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2',
											timeout: fallbackWaitTime,
											maxRetries: 2,
											retryDelay: 1000,
										},
										this.logger
									);

									if (!navigationResult) {
										this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
											`Fallback navigation may have encountered issues, but continuing execution`));
									} else {
										this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
											`Fallback navigation completed successfully to ${fallbackUrl}`));
									}
								} catch (error) {
									this.logger.error(formatOperationLog('Decision', nodeName, nodeId, index,
										`Fallback navigation error: ${(error as Error).message}`));
									throw error;
								}
								break;
							}
						}
					} catch (error) {
						this.logger.error(formatOperationLog('Decision', nodeName, nodeId, index,
							`Error in fallback action: ${(error as Error).message}`));

						if (!continueOnFail) {
							throw error;
						}
					}
				}
			}

			// Take screenshot if requested
			if (takeScreenshot) {
				try {
					screenshot = await puppeteerPage.screenshot({
						encoding: 'base64',
						type: 'jpeg',
						quality: 80,
					}) as string;

					resultData.screenshot = screenshot;
					this.logger.debug(formatOperationLog('Decision', nodeName, nodeId, index,
						`Screenshot captured (${screenshot.length} bytes)`));
				} catch (screenshotError) {
					this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
						`Failed to capture screenshot: ${(screenshotError as Error).message}`));
					// Continue execution even if screenshot fails
				}
			}

			// Update result data
			resultData.executionDuration = Date.now() - startTime;
			resultData.currentUrl = await puppeteerPage.url();
			resultData.pageTitle = await puppeteerPage.title();
			resultData.routeTaken = routeTaken;
			resultData.actionPerformed = actionPerformed;

			// Add standard timing log
			createTimingLog('Decision', startTime, this.logger, nodeName, nodeId, index);

			// Log additional information about the execution
			this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
				`Completed execution: route="${routeTaken}", action="${actionPerformed}"`));

			// Add more specific completion information based on action performed
			if (actionPerformed === 'click') {
				this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
					`CLICK ACTION SUCCESSFUL: Node has finished processing and is ready for the next node`));
			} else if (actionPerformed === 'fill') {
				this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
					`FORM FILL SUCCESSFUL: Node has finished processing and is ready for the next node`));
			} else if (actionPerformed === 'extract') {
				this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
					`EXTRACTION SUCCESSFUL: Node has finished processing and is ready for the next node`));
			} else if (actionPerformed === 'navigate') {
				this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
					`NAVIGATION SUCCESSFUL: Node has finished processing and is ready for the next node`));
			} else {
				this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
					`NODE SUCCESSFUL: Processing complete and ready for next node`));
			}

			// Add a visual end marker
			this.logger.info("============ NODE EXECUTION COMPLETE ============");

			// Create standardized success response
			const successResponse = await createSuccessResponse({
				operation: 'Decision',
				sessionId: sessionId || '',
				page: puppeteerPage,
				logger: this.logger,
				startTime,
				takeScreenshot: this.getNodeParameter('takeScreenshot', index, false) as boolean,
				additionalData: {
					routeTaken,
					actionPerformed,
					currentUrl: resultData.currentUrl,
					pageTitle: resultData.pageTitle,
				},
			});

			// Store the page reference for future operations to ensure the session is properly maintained
			if (sessionId && workflowId) {
				SessionManager.storePage(sessionId, `page_${Date.now()}`, puppeteerPage);
				this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
					`Stored page reference with session ID: ${sessionId}`));
			}

			// Build the output item in accordance with n8n standards
			const returnItem: INodeExecutionData = {
				json: successResponse,
				pairedItem: { item: index },
			};

			// Output the results
			if (enableRouting) {
				// Create an array for each possible output route
				const routeCount = this.getNodeParameter('routeCount', index, 2) as number;
				const routes: INodeExecutionData[][] = Array(routeCount).fill(null).map(() => []);

				// Put the item in the correct route
				if (routeIndex >= 0 && routeIndex < routeCount) {
					routes[routeIndex].push(returnItem);
					this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
						`Sending output to route ${routeIndex + 1}`));
				} else {
					// Default to route 0 if routeIndex is out of bounds
						routes[0].push(returnItem);
					this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
						`Route index ${routeIndex} out of bounds, defaulting to route 1`));
				}

				return routes;
			}

			// Single output case - no else needed as the if block returns
			return [returnItem];
		} catch (error) {
			// Use standardized error response utility
			const takeScreenshot = this.getNodeParameter('takeScreenshot', index, false) as boolean;

			// Get current URL and title for error context if page is available
			let currentUrl = '';
			let pageTitle = '';
			try {
				if (puppeteerPage) {
					currentUrl = await puppeteerPage.url();
					pageTitle = await puppeteerPage.title();
				}
			} catch (urlError) {
				this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
					`Failed to get page URL/title for error context: ${(urlError as Error).message}`));
			}

			// Get node parameters for error context
			const waitForSelectorsParam = this.getNodeParameter('waitForSelectors', index, true) as boolean;
			const selectorTimeoutParam = this.getNodeParameter('selectorTimeout', index, 5000) as number;
			const detectionMethodParam = this.getNodeParameter('detectionMethod', index, 'standard') as string;
			const earlyExitDelayParam = this.getNodeParameter('earlyExitDelay', index, 500) as number;

			// Create a detailed error response with additional context
			const errorResponse = await createErrorResponse({
				error,
				operation: 'Decision',
				sessionId: sessionId || '',
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
					routeTaken: 'error',
					actionPerformed: 'none',
					conditionGroups: this.getNodeParameter('conditionGroups', index, {}) as IDataObject,
					parameters: {
						waitForSelectors: waitForSelectorsParam,
						selectorTimeout: selectorTimeoutParam,
						detectionMethod: detectionMethodParam,
						earlyExitDelay: earlyExitDelayParam,
						takeScreenshot,
						continueOnFail
					}
				},
			});

			// If continueOnFail is true, return error data instead of throwing
			if (continueOnFail) {
				this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
					`Continuing despite error (continueOnFail=true)`));

				const returnItem: INodeExecutionData = {
					json: errorResponse,
					pairedItem: { item: index },
				};

				// Route to the first output or return as single output
				const enableRouting = this.getNodeParameter('enableRouting', index, false) as boolean;

				if (enableRouting) {
					const routeCount = this.getNodeParameter('routeCount', index, 2) as number;
					const routes: INodeExecutionData[][] = Array(routeCount).fill(null).map(() => []);
					routes[0].push(returnItem);
					return routes;
				}

				return [returnItem];
			}

			// If continueOnFail is false, throw the error
			throw error;
		}
	}



