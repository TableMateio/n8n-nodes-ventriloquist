import type {
	IExecuteFunctions,
	INodeExecutionData,
	IDataObject,
	INodeProperties,
} from 'n8n-workflow';
import type * as puppeteer from 'puppeteer-core';
import { SessionManager } from '../utils/sessionManager';
import { formatOperationLog, createSuccessResponse, createTimingLog } from '../utils/resultUtils';
import { createErrorResponse, safeExecute } from '../utils/errorUtils';
import { waitAndClick } from '../utils/clickOperations';

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
									conditionType: ['one'],
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
	 * Get a random human-like delay between 100-300ms
	 */
	function getHumanDelay(): number {
		return Math.floor(Math.random() * (300 - 100 + 1) + 100);
	}

	/**
	 * Enhanced navigation waiting with better logging
	 */
	async function enhancedWaitForNavigation(
		page: puppeteer.Page,
		options: puppeteer.WaitForOptions,
		logger: IExecuteFunctions['logger'],
		logPrefix: string
	): Promise<void> {
		logger.info(`${logPrefix} Waiting for navigation with options: ${JSON.stringify(options)}`);

		try {
			// Create a promise for navigation
			const navigationPromise = page.waitForNavigation(options);

			// Create a promise for navigation events
			const eventLogsPromise = new Promise<void>(resolve => {
				// Listen for events that might indicate navigation
				page.on('load', () => logger.info(`${logPrefix} Page load event fired`));
				page.on('domcontentloaded', () => logger.info(`${logPrefix} DOMContentLoaded event fired`));
				page.on('framenavigated', (frame) => {
					if (frame === page.mainFrame()) {
						logger.info(`${logPrefix} Main frame navigated to: ${frame.url()}`);
					}
				});
				page.on('request', request => {
					if (request.isNavigationRequest()) {
						logger.info(`${logPrefix} Navigation request to: ${request.url()}`);
					}
				});
				page.on('response', response => {
					if (response.request().isNavigationRequest()) {
						logger.info(`${logPrefix} Navigation response from: ${response.url()} (status: ${response.status()})`);
					}
				});

				// Resolve after 500ms to allow events to be captured but not block
				setTimeout(resolve, 500);
			});

			// Wait for both promises - the navigation promise is the "real" one
			await Promise.all([navigationPromise, eventLogsPromise]);
			logger.info(`${logPrefix} Navigation completed successfully`);
		} catch (error) {
			logger.warn(`${logPrefix} Navigation error: ${(error as Error).message}`);
			throw error;
		}
	}

	/**
	 * Safely matches strings according to the specified match type
	 */
	function matchStrings(value: string, targetValue: string, matchType: string, caseSensitive: boolean): boolean {
		// Apply case sensitivity
		let compareValue = value;
		let compareTarget = targetValue;

		if (!caseSensitive) {
			compareValue = value.toLowerCase();
			compareTarget = targetValue.toLowerCase();
		}

		// Apply match type
		switch (matchType) {
			case 'exact':
				return compareValue === compareTarget;
			case 'contains':
				return compareValue.includes(compareTarget);
			case 'startsWith':
				return compareValue.startsWith(compareTarget);
			case 'endsWith':
				return compareValue.endsWith(compareTarget);
			case 'regex':
				try {
					const regex = new RegExp(targetValue, caseSensitive ? '' : 'i');
					return regex.test(value);
				} catch (error) {
					return false;
				}
			default:
				return compareValue.includes(compareTarget);
		}
	}

	/**
	 * Compare element counts based on the comparison operator
	 */
	function compareCount(actualCount: number, expectedCount: number, operator: string): boolean {
		switch (operator) {
			case 'equal':
				return actualCount === expectedCount;
			case 'greater':
				return actualCount > expectedCount;
			case 'less':
				return actualCount < expectedCount;
			case 'greaterEqual':
				return actualCount >= expectedCount;
			case 'lessEqual':
				return actualCount <= expectedCount;
			default:
				return actualCount === expectedCount;
		}
	}

	// Find the existing waitForNavigation function and replace it
	async function waitForNavigation(page: puppeteer.Page, waitUntil: string, timeout: number, logger: IExecuteFunctions['logger'] = console as any): Promise<void> {
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

		// Call the enhanced function
		await enhancedWaitForNavigation(page, {
			waitUntil: waitUntilOption,
			timeout,
		}, logger, '[Navigation]');
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
		// Use safeExecute to handle errors in a standardized way
		const result = await safeExecute(
			async () => {
				let conditionMet = false;

				switch (conditionType) {
					case 'elementExists': {
						const selector = condition.selector as string;

						if (waitForSelectors) {
							if (detectionMethod === 'smart') {
								// Use smart DOM-aware detection
								conditionMet = await smartWaitForSelector(
									page,
									selector,
									selectorTimeout,
									earlyExitDelay,
									thisNode.logger,
								);
							} else {
								// Use traditional fixed timeout waiting
								try {
									await page.waitForSelector(selector, { timeout: selectorTimeout });
									conditionMet = true;
								} catch (error) {
									conditionMet = false;
								}
							}
						} else {
							// Just check without waiting
							const elementExists = await page.$(selector) !== null;
							conditionMet = elementExists;
						}
						break;
					}

					case 'textContains': {
						const selector = condition.selector as string;
						const textToCheck = condition.textToCheck as string;
						const matchType = condition.matchType as string;
						const caseSensitive = condition.caseSensitive as boolean;

						if (waitForSelectors) {
							let elementExists = false;
							if (detectionMethod === 'smart') {
								// Use smart DOM-aware detection
								elementExists = await smartWaitForSelector(
									page,
									selector,
									selectorTimeout,
									earlyExitDelay,
									thisNode.logger,
								);
							} else {
								// Use traditional fixed timeout waiting
								try {
									await page.waitForSelector(selector, { timeout: selectorTimeout });
									elementExists = true;
								} catch (error) {
									elementExists = false;
								}
							}

							if (!elementExists) {
								conditionMet = false;
								break;
							}
						}

						try {
							const elementText = await page.$eval(selector, (el) => el.textContent || '');
							conditionMet = matchStrings(elementText, textToCheck, matchType, caseSensitive);
						} catch (error) {
							// Element might not exist
							conditionMet = false;
						}
						break;
					}

					case 'elementCount': {
						const selector = condition.selector as string;
						const expectedCount = condition.expectedCount as number;
						const countComparison = condition.countComparison as string;

						// For element count, we just check without waiting as we expect some elements might not exist
						const elements = await page.$$(selector);
						const actualCount = elements.length;

						conditionMet = compareCount(actualCount, expectedCount, countComparison);
						break;
					}

					case 'urlContains': {
						const urlSubstring = condition.urlSubstring as string;
						const matchType = condition.matchType as string || 'contains';
						const caseSensitive = condition.caseSensitive as boolean || false;

						// Check if URL matches criteria
						conditionMet = matchStrings(currentUrl, urlSubstring, matchType, caseSensitive);
						break;
					}

					case 'jsExpression': {
						const jsExpression = condition.jsExpression as string;

						// Execute the JavaScript expression on the page
						try {
							const result = await page.evaluate((expr) => {
								// eslint-disable-next-line no-eval
								return eval(expr);
							}, jsExpression);

							conditionMet = !!result;
						} catch (error) {
							thisNode.logger.error(`Error evaluating JavaScript expression: ${(error as Error).message}`);
							conditionMet = false;
						}
						break;
					}

					default:
						// Unrecognized condition type
						thisNode.logger.warn(`Unrecognized condition type: ${conditionType}`);
						conditionMet = false;
				}

				return conditionMet;
			},
			{
				operation: `Decision-Evaluate-${conditionType}`,
				continueOnFail: true, // Always continue with condition evaluation
				logger: thisNode.logger,
				errorContext: {
					operation: `Decision-Evaluate-${conditionType}`,
					selector: condition.selector as string,
					additionalData: {
						conditionType,
					}
				}
			}
		);

		// Return false if there was an error, otherwise return the result
		return result.success ? result.result || false : false;
	}

	/**
	 * Helper function to format extracted data for logging
	 * Truncates the data to make it more log-friendly
	 */
	function formatExtractedDataForLog(data: any, extractionType: string): string {
		if (data === null || data === undefined) {
			return 'null';
		}

		const truncateLength = 100; // Maximum string length to show in logs
		const truncateMessage = '... (truncated)';

		if (typeof data === 'string') {
			// For string data, truncate if too long
			if (data.length > truncateLength) {
				return `"${data.substring(0, truncateLength)}${truncateMessage}" (${data.length} chars)`;
			}
			return `"${data}"`;
		} else if (Array.isArray(data)) {
			// For arrays, summarize content
			const itemCount = data.length;
			if (itemCount === 0) {
				return '[] (empty array)';
			}

			// Sample a few items from the array
			const sampleSize = Math.min(3, itemCount);
			const sample = data.slice(0, sampleSize).map(item => {
				if (typeof item === 'string') {
					return item.length > 20 ? `"${item.substring(0, 20)}..."` : `"${item}"`;
				} else if (typeof item === 'object') {
					return '[object]';
				}
				return String(item);
			});

			return `[${sample.join(', ')}${itemCount > sampleSize ? `, ... (${itemCount - sampleSize} more)` : ''}]`;
		} else if (typeof data === 'object') {
			// For objects, show a sample of keys and values
			if (data === null) {
				return 'null';
			}

			if (extractionType === 'table') {
				// Special handling for table data
				const rowCount = Array.isArray(data) ? data.length : Object.prototype.hasOwnProperty.call(data, 'rowCount') ? data.rowCount : 'unknown';
				return `[Table data: ${rowCount} row(s)]`;
			}

			// For other objects, sample a few properties
			const keys = Object.keys(data);
			if (keys.length === 0) {
				return '{} (empty object)';
			}

			// Only show a few keys
			const sampleSize = Math.min(3, keys.length);
			const sample = keys.slice(0, sampleSize).map(key => {
				const value = data[key];

				// Format the value based on its type
				let valueStr;
				if (typeof value === 'string') {
					valueStr = value.length > 15 ? `"${value.substring(0, 15)}..."` : `"${value}"`;
				} else if (typeof value === 'object') {
					valueStr = '[object]';
				} else {
					valueStr = String(value);
				}

				return `${key}: ${valueStr}`;
			});

			return `{${sample.join(', ')}${keys.length > sampleSize ? `, ... (${keys.length - sampleSize} more)` : ''}}`;
		}

		// For other data types, convert to string
		return String(data);
	}

	/**
	 * Execute the decision operation
	 */
	export async function execute(
		this: IExecuteFunctions,
		index: number,
		initialPage: puppeteer.Page,
		websocketEndpoint?: string,
		workflowId?: string,
	): Promise<INodeExecutionData[][] | INodeExecutionData[]> {
		const startTime = Date.now();

		// Store this parameter at the top level so it's available in the catch block
		const continueOnFail = this.getNodeParameter('continueOnFail', index, true) as boolean;
		let screenshot: string | undefined;

		// Create a variable for the page that we can safely modify
		let puppeteerPage: puppeteer.Page = initialPage;

		// Added for better logging
		const nodeName = this.getNode().name;
		const nodeId = this.getNode().id;

		// Get existing session ID parameter if available - moved outside try block to make available in catch
		const explicitSessionId = this.getNodeParameter('sessionId', index, '') as string;
		let sessionId = explicitSessionId;

		// Get the current URL (this might fail if the page is disconnected)
		let currentUrl = '';
		try {
			currentUrl = await puppeteerPage.url();
		} catch (error) {
			this.logger.warn(`[Ventriloquist][${nodeName}#${index}][Decision][${nodeId}] Error getting current URL: ${(error as Error).message}`);
			this.logger.warn(`[Ventriloquist][${nodeName}#${index}][Decision][${nodeId}] This might indicate the page is disconnected - will attempt to reconnect`);
		}

		// Visual marker to clearly indicate a new node is starting
		this.logger.info("============ STARTING NODE EXECUTION ============");
		this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index, `Starting execution on URL: ${currentUrl}`));

		try {
			// Get operation parameters
			const conditionGroups = this.getNodeParameter('conditionGroups.groups', index, []) as IDataObject[];
			const fallbackAction = this.getNodeParameter('fallbackAction', index) as string;
			const waitForSelectors = this.getNodeParameter('waitForSelectors', index, true) as boolean;
			const selectorTimeout = this.getNodeParameter('selectorTimeout', index, 5000) as number;
			const detectionMethod = this.getNodeParameter('detectionMethod', index, 'smart') as string;
			const earlyExitDelay = this.getNodeParameter('earlyExitDelay', index, 500) as number;
			const useHumanDelays = this.getNodeParameter('useHumanDelays', index, true) as boolean;
			const takeScreenshot = this.getNodeParameter('takeScreenshot', index, false) as boolean;

			// These were moved outside the try block
			// const explicitSessionId = this.getNodeParameter('sessionId', index, '') as string;
			// let sessionId = explicitSessionId;

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
					"Will attempt to use the existing session for this workflow - this may work but is not reliable"));
				this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
					"For best results, you should provide the session ID from a previous Open operation in the 'Session ID' field"));
			} else {
				this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index, `Using session ID: ${explicitSessionId}`));
			}

			// Check if the page is still connected by trying a simple operation
			let pageConnected = true;
			try {
				// Simple operation to check if page is still connected
				await puppeteerPage.evaluate(() => document.readyState);
				this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index, "Page connection verified"));
			} catch (error) {
				pageConnected = false;
				this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
					`Page appears to be disconnected: ${(error as Error).message}`));
			}

			// If page is disconnected or we have an explicit session ID, use the SessionManager
			if (!pageConnected || explicitSessionId) {
				// Get the actual websocket endpoint from credentials if not provided
				let actualWebsocketEndpoint = websocketEndpoint || '';

				if (!actualWebsocketEndpoint) {
					// Try to determine the credential type
					let credentialType = 'browserlessApi'; // Default

					try {
						// Try to get credentials based on a guessed type
						try {
							const browserlessCredentials = await this.getCredentials('browserlessApi');
							credentialType = 'browserlessApi';

							// Extract WebSocket endpoint from credentials using utility
							actualWebsocketEndpoint = SessionManager.getWebSocketUrlFromCredentials(
								this.logger,
								credentialType,
								browserlessCredentials
							);
						} catch (browserlessError) {
							this.logger.debug(formatOperationLog('Decision', nodeName, nodeId, index,
								`No browserlessApi credentials found: ${(browserlessError as Error).message}`));

							try {
								const brightDataCredentials = await this.getCredentials('brightDataApi');
								credentialType = 'brightDataApi';

								// Extract WebSocket endpoint from credentials using utility
								actualWebsocketEndpoint = SessionManager.getWebSocketUrlFromCredentials(
									this.logger,
									credentialType,
									brightDataCredentials
								);
							} catch (brightDataError) {
								this.logger.debug(formatOperationLog('Decision', nodeName, nodeId, index,
									`No brightDataApi credentials found: ${(brightDataError as Error).message}`));
							}
						}
					} catch (credentialError) {
						this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
							`Could not determine credentials: ${(credentialError as Error).message}`));
					}
				}

				// Use the centralized session management
				if (actualWebsocketEndpoint) {
					this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
						`Using SessionManager to get or create page session`));

					const sessionResult = await SessionManager.getOrCreatePageSession(this.logger, {
						explicitSessionId,
						websocketEndpoint: actualWebsocketEndpoint,
						workflowId,
						operationName: 'Decision',
						nodeId,
						nodeName,
						index,
					});

					puppeteerPage = sessionResult.page || puppeteerPage;
					sessionId = sessionResult.sessionId;

					if (sessionResult.isNewSession) {
						this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
							`Created new session with ID: ${sessionId}`));
					} else {
						this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
							`Using existing session with ID: ${sessionId}`));
					}

					// Update current URL after getting page
					try {
						currentUrl = await puppeteerPage.url();
						this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
							`Current page URL is: ${currentUrl}`));
					} catch (urlError) {
						this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
							`Could not get URL after session management: ${(urlError as Error).message}`));
						currentUrl = 'unknown (connection issues)';
					}
				} else {
					this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
						`No websocket endpoint available - cannot reconnect session`));
				}
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
											screenshot = await puppeteerPage.screenshot({ encoding: 'base64' });
											resultData.screenshot = screenshot;
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

											// Clear the field first
											this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
												`Clearing field: ${actionSelector}`));
											await puppeteerPage.evaluate((selector: string) => {
												const element = document.querySelector(selector) as HTMLInputElement;
												if (element) {
														element.value = '';
												}
											}, actionSelector);

											// Fill the field
											this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
												`Filling field: ${actionSelector} (value masked)`));
											await puppeteerPage.type(actionSelector, actionValue);

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

												// Handle different field types
												switch (fieldType) {
													case 'text': {
														const value = field.value as string || '';
														const clearField = field.clearField as boolean ?? true;
														const pressEnter = field.pressEnter as boolean || false;
														const humanLike = field.humanLike as boolean ?? true;

														// Enhanced debugging for form typing
														const credentialType = group._credentialType || 'unknown';
														this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
															`Filling form field: ${selector} with value: ${value} (human-like: ${humanLike}, credential type: ${credentialType})`));

														// Clear field if requested
														if (clearField) {
															// Click three times to select all text
															await puppeteerPage.click(selector, { clickCount: 3 });
															// Delete selected text
															await puppeteerPage.keyboard.press('Backspace');
														}

														// Try to verify the field is ready for input
														try {
															const isVisible = await puppeteerPage.evaluate((sel) => {
																const element = document.querySelector(sel);
																if (!element) return 'Element not found';
																const style = window.getComputedStyle(element);
																const rect = element.getBoundingClientRect();
																return {
																	visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
																	tag: element.tagName.toLowerCase(),
																	type: element instanceof HTMLInputElement ? element.type : 'not-input'
																};
															}, selector);
															this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
																`Field status: ${JSON.stringify(isVisible)}`));
														} catch (fieldCheckError) {
															this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
																`Could not check field visibility: ${(fieldCheckError as Error).message}`));
														}

														// Use human-like typing with random delays between keystrokes
														try {
															if (humanLike) {
																this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
																	`Using human-like typing for ${value.length} characters`));
																for (const char of value) {
																	this.logger.debug(formatOperationLog('Decision', nodeName, nodeId, index,
																		`Typing character: ${char}`));
																	await puppeteerPage.type(selector, char, { delay: Math.floor(Math.random() * 150) + 25 });
																}
															} else {
																// Fast direct typing without delays for non-human-like mode
																this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
																	`Using fast typing for "${value}"`));
																await puppeteerPage.type(selector, value, { delay: 0 });
															}
															this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
																`Typing completed for selector: ${selector}`));
														} catch (typeError) {
															this.logger.error(formatOperationLog('Decision', nodeName, nodeId, index,
																`Error during typing: ${(typeError as Error).message}`));

															// Try alternative input method as fallback
															this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
																`Trying alternative input method`));
															try {
																await puppeteerPage.evaluate((sel, val) => {
																	const element = document.querySelector(sel);
																	if (element && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
																		element.value = val;
																		element.dispatchEvent(new Event('input', { bubbles: true }));
																		element.dispatchEvent(new Event('change', { bubbles: true }));
																	}
																}, selector, value);
															} catch (evalError) {
																throw new Error(`Both typing methods failed: ${(typeError as Error).message} AND ${(evalError as Error).message}`);
															}
														}

														// Focus the next field or blur current field to trigger validation
														await puppeteerPage.evaluate((sel) => {
															const element = document.querySelector(sel);
															if (element) {
																	(element as HTMLElement).blur();
															}
														}, selector);

														// Press Enter if requested
														if (pressEnter) {
															await puppeteerPage.keyboard.press('Enter');
														}
														break;
													}
													case 'password': {
														const value = field.value as string || '';
														const clearField = field.clearField as boolean ?? true;
														const credentialType = group._credentialType || 'unknown';

														this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
															`Filling password field: ${selector} (value masked) using ${credentialType}`));

														// Clear field if needed
														if (clearField) {
															// For Browserless, use triple-click to select all
															await puppeteerPage.click(selector, { clickCount: 3 });
															await puppeteerPage.keyboard.press('Backspace');
														}

														if (credentialType === 'browserless') {
															// For Browserless, we need a multi-layered approach
															try {
																// First try the direct type method (most reliable for Browserless)
																this.logger.debug(formatOperationLog('Decision', nodeName, nodeId, index,
																	`Using direct type for password with Browserless`));
																await puppeteerPage.click(selector);
																await puppeteerPage.type(selector, value, { delay: 10 });
															} catch (typeError) {
																this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
																	`Direct typing failed for password: ${(typeError as Error).message}`));

																// Fall back to JS method
																try {
																	await puppeteerPage.evaluate((sel, val) => {
																		const element = document.querySelector(sel);
																		if (element && element instanceof HTMLInputElement) {
																			element.value = val;
																			element.dispatchEvent(new Event('input', { bubbles: true }));
																			element.dispatchEvent(new Event('change', { bubbles: true }));
																		}
																	}, selector, value);
																} catch (evalError) {
																	this.logger.error(formatOperationLog('Decision', nodeName, nodeId, index,
																		`Both password input methods failed: ${(evalError as Error).message}`));
																	throw new Error(`Failed to input password using both methods`);
																}
															}
														} else {
															// For other providers like Bright Data, use safer JS evaluation approach
															try {
																await puppeteerPage.evaluate((sel, val) => {
																	const element = document.querySelector(sel);
																	if (element && element instanceof HTMLInputElement) {
																		// Check if element is a password field
																		const isPasswordField = element.type === 'password';
																		const originalType = element.type;

																		try {
																			// Temporarily change type to text if it's a password field
																			if (isPasswordField) {
																				element.setAttribute('type', 'text');
																			}

																			// Set value and dispatch events
																			element.value = val;
																			element.dispatchEvent(new Event('input', { bubbles: true }));
																			element.dispatchEvent(new Event('change', { bubbles: true }));

																			// Change back to original type (password)
																			element.setAttribute('type', originalType || 'password');
																		} catch (err) {
																			console.error('Error while manipulating password field:', err);
																		}
																	}
																}, selector, value);
															} catch (evalError) {
																this.logger.error(formatOperationLog('Decision', nodeName, nodeId, index,
																	`JS eval password input failed: ${(evalError as Error).message}`));

																// Last resort: try direct typing
																this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
																	`Falling back to direct typing for password`));
																await puppeteerPage.click(selector);
																await puppeteerPage.type(selector, value);
															}
														}
														break;
													}
												}
											}

											// Submit the form if requested
											if (submitForm && submitSelector) {
												this.logger.debug(formatOperationLog('Decision', nodeName, nodeId, index,
													`Submitting form using selector: ${submitSelector}`));

												// Wait a short time before submitting (feels more human)
												if (useHumanDelays) {
													await new Promise(resolve => setTimeout(resolve, getHumanDelay()));
												}

												// Log before clicking submit
												this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
													`About to click submit button: ${submitSelector}`));

												try {
													// Capture navigation events that might occur from the form submission
													const logPrefix = `[Ventriloquist][${nodeName}#${index}][Decision][${nodeId}]`;

													// Create a promise that will resolve when the next navigation happens
													const navigationPromise = puppeteerPage.waitForNavigation({
														waitUntil: waitAfterSubmit === 'multiple' ? ['domcontentloaded', 'networkidle0'] :
															(waitAfterSubmit as puppeteer.PuppeteerLifeCycleEvent || 'domcontentloaded'),
														timeout: waitSubmitTime
													});

													// Click the submit button
													this.logger.info(`${logPrefix} Clicking submit button ${submitSelector}`);
													await puppeteerPage.click(submitSelector);
													this.logger.info(`${logPrefix} Submit button clicked successfully`);

													// Wait for navigation to complete
													this.logger.info(`${logPrefix} Waiting for navigation to complete (timeout: ${waitSubmitTime}ms)`);
													await navigationPromise;
													this.logger.info(`${logPrefix} Navigation completed successfully after form submission`);

													// Verify the page is still connected
													await puppeteerPage.evaluate(() => document.readyState)
														.then(readyState => {
															this.logger.info(`${logPrefix} Page ready state after navigation: ${readyState}`);
														})
														.catch(error => {
															this.logger.warn(`${logPrefix} Error checking page state after navigation: ${error.message}`);
															this.logger.warn(`${logPrefix} This may indicate the page context was destroyed during navigation`);
														});
												} catch (navError) {
													this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
														`Navigation error after form submission: ${(navError as Error).message}`));
													this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
														`This is often normal with redirects - attempting to continue`));

													// Try to verify the page is still usable
													try {
														const currentUrl = await puppeteerPage.url();
														this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
															`Current URL after navigation error: ${currentUrl}`));
													} catch (urlError) {
														this.logger.error(formatOperationLog('Decision', nodeName, nodeId, index,
															`Error getting URL after navigation: ${(urlError as Error).message}`));
														this.logger.error(formatOperationLog('Decision', nodeName, nodeId, index,
															`Page context might be destroyed - attempting to reconnect`));

														// If we have a session ID, try to reconnect
														if (sessionId) {
															this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
																`Attempting to reconnect session after navigation error`));

															try {
																// Get browser session information
																const workflowId = this.getWorkflow().id || '';
																if (!workflowId) {
																	throw new Error('Could not get workflow ID for reconnection');
																}

																// Get session info
																let session = null;
																const allSessions = SessionManager.getAllSessions();
																let sessionId = '';

																// Find the session with matching workflowId
																for (const sessionInfo of allSessions) {
																	if (sessionInfo.info.workflowId === workflowId) {
																		sessionId = sessionInfo.sessionId;
																		session = SessionManager.getSession(sessionId);
																		break;
																	}
																}

																if (!session) {
																	throw new Error(`No browser session found for workflow ID: ${workflowId}`);
																}

																// Use the existing browser from the session
																if (session.browser) {
																	this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
																		`Reconnecting to existing browser session`));

																	// Get a new page from the existing browser
																	const pages = await session.browser.pages();
																	if (pages.length === 0) {
																		// Create a new page if none exist
																		puppeteerPage = await session.browser.newPage();
																		this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
																			`Created new page after reconnection`));
																	} else {
																		// Use the first available page
																		puppeteerPage = pages[0];
																		this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
																			`Using existing page after reconnection`));
																	}

																	// Update the session's page reference
																	SessionManager.storePage(sessionId, `page_${Date.now()}`, puppeteerPage);
																	this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
																		`Successfully reconnected and updated page reference`));
																} else {
																	this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
																		`No browser instance in session - cannot reconnect`));
																	throw new Error(`Cannot reconnect after form submission - no browser instance available`);
																}
															} catch (reconnectError) {
																this.logger.error(formatOperationLog('Decision', nodeName, nodeId, index,
																	`Reconnection failed: ${(reconnectError as Error).message}`));
																throw new Error(`Could not reconnect to session ${sessionId} after form submission: ${(reconnectError as Error).message}`);
															}
														}
													}
													// } catch (urlError) {
													// 	this.logger.error(`[Ventriloquist][${nodeName}#${index}][Decision][${nodeId}] Error getting URL after navigation: ${(urlError as Error).message}`);
													// 	this.logger.error(`[Ventriloquist][${nodeName}#${index}][Decision][${nodeId}] Page context might be destroyed - attempting to reconnect`);

													// 	// If we have a session ID, try to reconnect
													// 	if (sessionId) {
													// 		this.logger.info(`[Ventriloquist][${nodeName}#${index}][Decision][${nodeId}] Attempting to reconnect session after navigation error`);

													// 		try {
													// 			// Get browser session information
													// 			const workflowId = this.getWorkflow().id || '';
													// 			if (!workflowId) {
													// 				throw new Error('Could not get workflow ID for reconnection');
													// 			}

													// 			// Get session info
													// 			const session = SessionManager.getAllSessions().get(workflowId);
													// 			if (!session) {
													// 				throw new Error(`No browser session found for workflow ID: ${workflowId}`);
													// 			}

													// 			// Get credentials based on type
													// 			const credentialType = session.credentialType || 'brightDataApi';
													// 			this.logger.info(`[Ventriloquist][${nodeName}#${index}][Decision][${nodeId}] Using credential type: ${credentialType} for reconnection`);

													// 			// Get credentials from workflow
													// 			const credentials = await this.getCredentials(credentialType);

													// 			// Create transport to handle reconnection
													// 			const transportFactory = new BrowserTransportFactory();
													// 			const browserTransport = transportFactory.createTransport(
													// 				credentialType,
													// 				this.logger,
													// 				credentials,
													// 			);

													// 			// Check if the transport has reconnect capability
													// 			if (browserTransport.reconnect) {
													// 				// Reconnect to the session
													// 				this.logger.info(`[Ventriloquist][${nodeName}#${index}][Decision][${nodeId}] Reconnecting to session: ${sessionId}`);
													// 				const reconnectedBrowser = await browserTransport.reconnect(sessionId);

													// 				// Get a new page from the reconnected browser
													// 				const pages = await reconnectedBrowser.pages();
													// 				if (pages.length === 0) {
													// 					// Create a new page if none exist
													// 					puppeteerPage = await reconnectedBrowser.newPage();
													// 					this.logger.info(`[Ventriloquist][${nodeName}#${index}][Decision][${nodeId}] Created new page after reconnection`);
													// 				} else {
													// 					// Use the first available page
													// 					puppeteerPage = pages[0];
													// 					this.logger.info(`[Ventriloquist][${nodeName}#${index}][Decision][${nodeId}] Using existing page after reconnection`);
													// 				}

													// 				// Update the session's page reference
													// 				Ventriloquist.storePage(workflowId, sessionId, puppeteerPage);
													// 				this.logger.info(`[Ventriloquist][${nodeName}#${index}][Decision][${nodeId}] Successfully reconnected and updated page reference`);

													// 				// Form submission was likely successful, continue execution
													// 			} else {
													// 				this.logger.warn(`[Ventriloquist][${nodeName}#${index}][Decision][${nodeId}] Transport doesn't support reconnection for provider: ${credentialType}`);
													// 				throw new Error(`Cannot reconnect after form submission with ${credentialType}`);
													// 			}
													// 		} catch (reconnectError) {
													// 			this.logger.error(`[Ventriloquist][${nodeName}#${index}][Decision][${nodeId}] Reconnection failed: ${(reconnectError as Error).message}`);
													// 			throw new Error(`Could not reconnect to session ${sessionId} after form submission: ${(reconnectError as Error).message}`);
													// 		}
													// 	}
													// }
												}
											}
										}
										else {
											// Neither approach is available, log an error
											throw new Error(`Decision group "${groupName}" has a fill action but no valid selector or form fields.`);
										}

										// After successful form fill, exit immediately
										this.logger.info(formatOperationLog('Decision', nodeName, nodeId, index,
											`Decision point "${groupName}": Form fill completed successfully - exiting decision node`));
										resultData.success = true;
										resultData.routeTaken = groupName;
										resultData.actionPerformed = actionType;
										resultData.currentUrl = await puppeteerPage.url();
										resultData.pageTitle = await puppeteerPage.title();
										resultData.executionDuration = Date.now() - startTime;

										// Take screenshot if requested
										if (takeScreenshot) {
											screenshot = await puppeteerPage.screenshot({ encoding: 'base64' });
											resultData.screenshot = screenshot;
										}

										// Return the result immediately after successful action
										return [this.helpers.returnJsonArray([resultData])];
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
											extractedData = await puppeteerPage.$eval(actionSelector, (el) => el.textContent?.trim() || '');
											break;
										case 'html': {
											// Get HTML options
											const htmlOptions = group.htmlOptions as IDataObject || {};
											const outputFormat = (htmlOptions.outputFormat as string) || 'html';
											const includeMetadata = htmlOptions.includeMetadata as boolean || false;

											// Extract HTML content
											const htmlContent = await puppeteerPage.$eval(actionSelector, (el) => el.innerHTML);

											if (outputFormat === 'html') {
												// Return as raw HTML string
												extractedData = htmlContent;
											} else {
												// Return as JSON object
												extractedData = { html: htmlContent };
											}

											// Add metadata if requested
											if (includeMetadata) {
												// Calculate basic metadata about the HTML
												const elementCount = await puppeteerPage.$eval(actionSelector, (el) => el.querySelectorAll('*').length);
												const imageCount = await puppeteerPage.$eval(actionSelector, (el) => el.querySelectorAll('img').length);
												const linkCount = await puppeteerPage.$eval(actionSelector, (el) => el.querySelectorAll('a').length);

												if (typeof extractedData === 'object') {
													extractedData.metadata = {
														htmlLength: htmlContent.length,
														elementCount,
														imageCount,
														linkCount,
													};
												} else {
													// For string output, add metadata as a separate property
													extractedData = {
														html: htmlContent,
														metadata: {
															htmlLength: htmlContent.length,
															elementCount,
															imageCount,
															linkCount,
														}
													};
												}
											}
											break;
										}
										case 'value':
											extractedData = await puppeteerPage.$eval(actionSelector, (el) => {
												if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
													return el.value;
												}
												return '';
											});
											break;
										case 'attribute': {
											const attributeName = group.extractAttributeName as string;
											extractedData = await puppeteerPage.$eval(
												actionSelector,
												(el, attr) => el.getAttribute(attr) || '',
												attributeName
											);
											break;
										}
										case 'multiple': {
											// Get options for multiple elements extraction
											const multipleOptions = group.multipleOptions as IDataObject || {};
											const extractionProperty = multipleOptions.extractionProperty as string || 'textContent';
											const limit = multipleOptions.limit as number || 50;
											const outputFormat = multipleOptions.outputFormat as string || 'array';

											// Extract data from all matching elements
											const elements = await puppeteerPage.$$(actionSelector);

											// Limit the number of elements processed
											const limitedElements = elements.slice(0, limit);

											if (extractionProperty === 'attribute') {
												const attributeName = multipleOptions.attributeName as string || '';
												// Extract the specified attribute from each element
												extractedData = await Promise.all(
													limitedElements.map(async (el) =>
														puppeteerPage.evaluate(
															(element, attr) => element.getAttribute(attr) || '',
															el,
															attributeName
														)
													)
												);
											} else {
												// Extract the specified property from each element
												extractedData = await Promise.all(
													limitedElements.map(async (el) =>
														puppeteerPage.evaluate(
															(element, prop) => {
																switch (prop) {
																	case 'textContent':
																		return element.textContent?.trim() || '';
																	case 'innerHTML':
																		return element.innerHTML;
																	case 'outerHTML':
																		return element.outerHTML;
																	default:
																		return element.textContent?.trim() || '';
																}
															},
															el,
															extractionProperty
														)
													)
												);
											}

											// Format the output based on the specified format
											if (outputFormat === 'json') {
												const jsonResult: IDataObject = {};
												(extractedData as string[]).forEach((value, index) => {
													jsonResult[index.toString()] = value;
												});
												extractedData = jsonResult;
											} else if (outputFormat === 'string') {
												const separator = multipleOptions.separator as string || ',';
												extractedData = (extractedData as string[]).join(separator);
											}
											// Default is array format, which is already correct
											break;
										}
										case 'table': {
											// Get table options
											const tableOptions = group.tableOptions as IDataObject || {};
											const includeHeaders = tableOptions.includeHeaders as boolean ?? true;
											const tableRow = tableOptions.rowSelector as string || 'tr';
											const tableCell = tableOptions.cellSelector as string || 'td,th';
											const limit = tableOptions.limit as number || 100;
											const outputFormat = tableOptions.outputFormat as string || 'array';

											// Extract table content
											const tableData: string[][] = await puppeteerPage.$$eval(
												`${actionSelector} ${tableRow}`,
												(rows, cellSelector, maxRows) => {
													// Limit the number of rows
													const limitedRows = Array.from(rows).slice(0, maxRows);

													return limitedRows.map(row => {
														const cells = Array.from(row.querySelectorAll(cellSelector));
														return cells.map(cell => cell.textContent?.trim() || '');
													});
												},
												tableCell,
												limit
											);

											if (outputFormat === 'json' && includeHeaders && tableData.length > 1) {
												// Use the first row as headers
												const headers = tableData[0];
												const jsonData = tableData.slice(1).map(row => {
													const obj: IDataObject = {};
													row.forEach((cell, i) => {
														if (i < headers.length) {
															obj[headers[i]] = cell;
														}
													});
													return obj;
												});
												extractedData = jsonData;
											} else {
												// Return as 2D array
												extractedData = tableData;
											}
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
										screenshot = await puppeteerPage.screenshot({ encoding: 'base64' });
										resultData.screenshot = screenshot;
									}

									// Return the result immediately after successful action
									return [this.helpers.returnJsonArray([resultData])];
								}
								case 'navigate': {
									const url = group.url as string;
									const waitAfterAction = group.waitAfterAction as string;
									const waitTime = group.waitTime as number;

									this.logger.debug(`Navigating to URL: ${url}`);
									await puppeteerPage.goto(url);

									// Wait according to specified wait type
									await waitForNavigation(puppeteerPage, waitAfterAction, waitTime);
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
								const fallbackSelector = this.getNodeParameter('fallbackSelector', index) as string;
								const waitAfterFallback = this.getNodeParameter('waitAfterFallback', index) as string;
								const fallbackWaitTime = this.getNodeParameter('fallbackWaitTime', index) as number;

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
											this.logger,
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
								switch (fallbackExtractionType) {
									case 'text':
										extractedData = await puppeteerPage.$eval(fallbackSelector, (el) => el.textContent?.trim() || '');
										break;
									case 'html': {
										// Get HTML options
										const fallbackHtmlOptions = this.getNodeParameter('fallbackHtmlOptions', index, {}) as IDataObject;
										const outputFormat = (fallbackHtmlOptions.outputFormat as string) || 'html';
										const includeMetadata = fallbackHtmlOptions.includeMetadata as boolean || false;

										// Extract HTML content
										const htmlContent = await puppeteerPage.$eval(fallbackSelector, (el) => el.innerHTML);

										if (outputFormat === 'html') {
											// Return as raw HTML string
											extractedData = htmlContent;
										} else {
											// Return as JSON object
											extractedData = { html: htmlContent };
										}

										// Add metadata if requested
										if (includeMetadata) {
											// Calculate basic metadata about the HTML
											const elementCount = await puppeteerPage.$eval(fallbackSelector, (el) => el.querySelectorAll('*').length);
											const imageCount = await puppeteerPage.$eval(fallbackSelector, (el) => el.querySelectorAll('img').length);
											const linkCount = await puppeteerPage.$eval(fallbackSelector, (el) => el.querySelectorAll('a').length);

											if (typeof extractedData === 'object') {
												extractedData.metadata = {
													htmlLength: htmlContent.length,
													elementCount,
														imageCount,
														linkCount,
												};
											} else {
												// For string output, add metadata as a separate property
												extractedData = {
													html: htmlContent,
													metadata: {
															htmlLength: htmlContent.length,
															elementCount,
																imageCount,
																linkCount,
												}
												};
											}
										}
										break;
									}
									case 'value':
										extractedData = await puppeteerPage.$eval(fallbackSelector, (el) => {
											if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
												return el.value;
											}
											return '';
										});
										break;
									case 'attribute': {
										const attributeName = this.getNodeParameter('fallbackAttributeName', index) as string;
										extractedData = await puppeteerPage.$eval(
											fallbackSelector,
											(el, attr) => el.getAttribute(attr) || '',
											attributeName
										);
										break;
									}
									default:
										extractedData = await puppeteerPage.$eval(fallbackSelector, (el) => el.textContent?.trim() || '');
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
											this.logger,
										);

										if (!elementExists) {
											throw new Error(`Fallback element with selector "${fallbackSelector}" not found`);
										}
									} else {
										await puppeteerPage.waitForSelector(fallbackSelector, { timeout: selectorTimeout });
									}
								}

								// Handle different input types
								switch (fallbackInputType) {
									case 'text': {
										const fallbackClearField = this.getNodeParameter('fallbackClearField', index, false) as boolean;
										const fallbackPressEnter = this.getNodeParameter('fallbackPressEnter', index, false) as boolean;

										// Handle text inputs and textareas
										if (fallbackClearField) {
											// Click three times to select all text
											await puppeteerPage.click(fallbackSelector, { clickCount: 3 });
											// Delete selected text
											await puppeteerPage.keyboard.press('Backspace');
										}

										// Type the text
										this.logger.debug(`Fallback action: Filling form field: ${fallbackSelector} with value: ${fallbackText}`);

										// Use human-like typing if enabled
										if (useHumanDelays) {
											for (const char of fallbackText) {
												await puppeteerPage.type(fallbackSelector, char, { delay: Math.floor(Math.random() * 150) + 25 });
											}
										} else {
											await puppeteerPage.type(fallbackSelector, fallbackText);
										}

										// Press Enter if requested
										if (fallbackPressEnter) {
											await puppeteerPage.keyboard.press('Enter');
										}
										break;
									}

									case 'select': {
										// Handle select/dropdown elements
										this.logger.debug(`Fallback action: Setting select element: ${fallbackSelector} to value: ${fallbackText}`);
										await puppeteerPage.select(fallbackSelector, fallbackText);
										break;
									}

									case 'checkbox':
									case 'radio': {
										const fallbackCheckState = this.getNodeParameter('fallbackCheckState', index, 'check') as string;

										// Handle checkbox and radio button inputs
										this.logger.debug(`Fallback action: Setting ${fallbackInputType}: ${fallbackSelector} to state: ${fallbackCheckState}`);

										// Get the current checked state
										const currentChecked = await puppeteerPage.$eval(fallbackSelector, el => (el as HTMLInputElement).checked);

										// Determine if we need to click based on requested state
										let shouldClick = false;
										if (fallbackCheckState === 'check' && !currentChecked) shouldClick = true;
										if (fallbackCheckState === 'uncheck' && currentChecked) shouldClick = true;
										if (fallbackCheckState === 'toggle') shouldClick = true;

										if (shouldClick) {
											await puppeteerPage.click(fallbackSelector);
										}
										break;
									}

									case 'file': {
										const fallbackFilePath = this.getNodeParameter('fallbackFilePath', index, '') as string;

										// Handle file upload inputs
										this.logger.debug(`Fallback action: Setting file input: ${fallbackSelector} with file: ${fallbackFilePath}`);

										const fileInput = await puppeteerPage.$(fallbackSelector) as puppeteer.ElementHandle<HTMLInputElement>;
										if (fileInput) {
											await fileInput.uploadFile(fallbackFilePath);
										} else {
											this.logger.warn(`File input element not found: ${fallbackSelector}`);
										}
										break;
									}
								}
								break;
							}

							case 'navigate': {
								const fallbackUrl = this.getNodeParameter('fallbackUrl', index) as string;
								const waitAfterFallback = this.getNodeParameter('waitAfterFallback', index) as string;
								const fallbackWaitTime = this.getNodeParameter('fallbackWaitTime', index) as number;

								this.logger.debug(`Fallback action: Navigating to URL: ${fallbackUrl}`);
								await puppeteerPage.goto(fallbackUrl);

								// Wait according to specified wait type
								await waitForNavigation(puppeteerPage, waitAfterFallback, fallbackWaitTime);
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
				// Use safeExecute to safely take a screenshot
				const screenshotResult = await safeExecute(
					async () => {
						return await puppeteerPage.screenshot({
							encoding: 'base64',
							type: 'jpeg',
							quality: 80,
						}) as string;
					},
					{
						operation: 'Decision-Screenshot',
						continueOnFail: true, // Always continue even if screenshot fails
						logger: this.logger,
						errorContext: {
							nodeId,
							nodeName,
							sessionId,
						}
					}
				);

				if (screenshotResult.success && screenshotResult.result) {
					screenshot = screenshotResult.result;
					resultData.screenshot = screenshot;
					this.logger.debug(formatOperationLog('Decision', nodeName, nodeId, index,
						`Screenshot captured (${screenshot.length} bytes)`));
				} else {
					this.logger.warn(formatOperationLog('Decision', nodeName, nodeId, index,
						`Failed to capture screenshot: ${screenshotResult.errorResponse?.error || 'Unknown error'}`));
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
			const errorResponse = await createErrorResponse({
				error,
				operation: 'Decision',
				sessionId: sessionId || '',
				nodeId,
				nodeName,
				page: puppeteerPage,
				logger: this.logger,
				takeScreenshot,
				startTime,
				continueOnFail,
				additionalData: {
					routeTaken: 'error',
					actionPerformed: 'none',
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



