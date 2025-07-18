import type { INodeProperties } from 'n8n-workflow';

export const baseRLC: INodeProperties = {
	displayName: 'Base',
	name: 'base',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	// description: 'The Airtable Base in which to operate on',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: {
				searchListMethod: 'baseSearch',
				searchable: true,
			},
		},
		{
			displayName: 'By URL',
			name: 'url',
			type: 'string',
			placeholder: 'e.g. https://airtable.com/app12DiScdfes/tbl9WvGeEPa6lZyVq/viwHdfasdfeieg5p',
			validation: [
				{
					type: 'regex',
					properties: {
						regex: 'https://airtable.com/([a-zA-Z0-9]{2,})/.*',
						errorMessage: 'Not a valid Airtable Base URL',
					},
				},
			],
			extractValue: {
				type: 'regex',
				regex: 'https://airtable.com/([a-zA-Z0-9]{2,})',
			},
		},
		{
			displayName: 'ID',
			name: 'id',
			type: 'string',
			validation: [
				{
					type: 'regex',
					properties: {
						regex: '[a-zA-Z0-9]{2,}',
						errorMessage: 'Not a valid Airtable Base ID',
					},
				},
			],
			placeholder: 'e.g. appD3dfaeidke',
			url: '=https://airtable.com/{{$value}}',
		},
	],
};

export const tableRLC: INodeProperties = {
	displayName: 'Table',
	name: 'table',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	typeOptions: {
		loadOptionsDependsOn: ['base.value'],
	},
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: {
				searchListMethod: 'tableSearch',
				searchable: true,
			},
		},
		{
			displayName: 'By URL',
			name: 'url',
			type: 'string',
			placeholder: 'https://airtable.com/app12DiScdfes/tblAAAAAAAAAAAAA/viwHdfasdfeieg5p',
			validation: [
				{
					type: 'regex',
					properties: {
						regex: 'https://airtable.com/[a-zA-Z0-9]{2,}/([a-zA-Z0-9]{2,})/.*',
						errorMessage: 'Not a valid Airtable Table URL',
					},
				},
			],
			extractValue: {
				type: 'regex',
				regex: 'https://airtable.com/[a-zA-Z0-9]{2,}/([a-zA-Z0-9]{2,})',
			},
		},
		{
			displayName: 'ID',
			name: 'id',
			type: 'string',
			validation: [
				{
					type: 'regex',
					properties: {
						regex: '[a-zA-Z0-9]{2,}',
						errorMessage: 'Not a valid Airtable Table ID',
					},
				},
			],
			placeholder: 'tbl3dirwqeidke',
		},
	],
};

export const viewRLC: INodeProperties = {
	displayName: 'View',
	name: 'view',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: {
				searchListMethod: 'viewSearch',
				searchable: true,
			},
		},
		{
			displayName: 'By URL',
			name: 'url',
			type: 'string',
			placeholder: 'https://airtable.com/app12DiScdfes/tblAAAAAAAAAAAAA/viwHdfasdfeieg5p',
			validation: [
				{
					type: 'regex',
					properties: {
						regex: 'https://airtable.com/[a-zA-Z0-9]{2,}/[a-zA-Z0-9]{2,}/([a-zA-Z0-9]{2,})/.*',
						errorMessage: 'Not a valid Airtable View URL',
					},
				},
			],
			extractValue: {
				type: 'regex',
				regex: 'https://airtable.com/[a-zA-Z0-9]{2,}/[a-zA-Z0-9]{2,}/([a-zA-Z0-9]{2,})',
			},
		},
		{
			displayName: 'ID',
			name: 'id',
			type: 'string',
			validation: [
				{
					type: 'regex',
					properties: {
						regex: '[a-zA-Z0-9]{2,}',
						errorMessage: 'Not a valid Airtable View ID',
					},
				},
			],
			placeholder: 'viw3dirwqeidke',
		},
	],
};

// Individual top-level parameters for linked table (single table only)
export const linkedTargetTable: INodeProperties = {
	displayName: 'Target Linked Table',
	name: 'linkedTargetTable',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	typeOptions: {
		loadOptionsDependsOn: ['base.value'],
	},
	description: 'The linked table where new records will be created',
	displayOptions: {
		show: {
			'createLinkedRecords': [true],
		},
					},
					modes: [
						{
							displayName: 'From List',
							name: 'list',
							type: 'list',
							typeOptions: {
								searchListMethod: 'tableSearch',
								searchable: true,
							},
						},
		{
			displayName: 'By URL',
			name: 'url',
			type: 'string',
			placeholder: 'https://airtable.com/app12DiScdfes/tblAAAAAAAAAAAAA/viwHdfasdfeieg5p',
			validation: [
				{
					type: 'regex',
					properties: {
						regex: 'https://airtable.com/[a-zA-Z0-9]{2,}/([a-zA-Z0-9]{2,})/.*',
						errorMessage: 'Not a valid Airtable Table URL',
					},
				},
			],
			extractValue: {
				type: 'regex',
				regex: 'https://airtable.com/[a-zA-Z0-9]{2,}/([a-zA-Z0-9]{2,})',
			},
		},
						{
							displayName: 'ID',
							name: 'id',
							type: 'string',
							validation: [
								{
									type: 'regex',
									properties: {
										regex: '[a-zA-Z0-9]{2,}',
										errorMessage: 'Not a valid Airtable Table ID',
									},
								},
							],
							placeholder: 'tbl3dirwqeidke',
						},
					],
};

export const linkedTableColumns: INodeProperties = {
	displayName: 'Linked Table Columns',
	name: 'linkedTableColumns',
					type: 'resourceMapper',
					default: {
						mappingMode: 'defineBelow',
						value: null,
					},
					noDataExpression: true,
					required: true,
					typeOptions: {
		loadOptionsDependsOn: ['base.value', 'linkedTargetTable.value'],
						resourceMapper: {
							resourceMapperMethod: 'getColumnsForTargetTable',
							mode: 'add',
							fieldWords: {
								singular: 'column',
								plural: 'columns',
							},
							addAllFields: true,
							multiKeyMatch: false,
						},
					},
	description: 'Map data to the columns in the linked table',
	displayOptions: {
		show: {
			'createLinkedRecords': [true],
		},
	},
};

export const createLinkedRecordsField: INodeProperties = {
	displayName: 'Create Records in Linked Table',
	name: 'createLinkedRecords',
	type: 'boolean',
	default: false,
	description: 'Whether to create records in linked tables and automatically link them to the main record',
	displayOptions: {
		show: {
			operation: ['create', 'update', 'upsert'],
		},
	},
};

export const insertUpdateOptions: INodeProperties[] = [
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: {
			show: {
				operation: ['create', 'update', 'upsert'],
			},
		},
		options: [
			{
				displayName: 'Typecast',
				name: 'typecast',
				type: 'boolean',
				default: false,
				description:
					'Whether the Airtable API should attempt mapping of string values for linked records & select options',
			},
			{
				displayName: 'Skip Empty/Null Fields',
				name: 'skipEmptyFields',
				type: 'boolean',
				default: false,
				description: 'Whether to skip fields with empty, null, or undefined values (prevents overwriting existing data with empty values)',
			},
			{
				displayName: 'Ignore Fields From Input',
				name: 'ignoreFields',
				type: 'string',
				requiresDataPath: 'multiple',
				displayOptions: {
					show: {
						'/columns.mappingMode': ['autoMapInputData'],
					},
				},
				default: '',
				description: 'Comma-separated list of fields in input to ignore when updating',
			},
			{
				displayName: 'Include Input Data',
				name: 'includeInputData',
				type: 'boolean',
				default: false,
				description: 'Whether to merge the original input data at the top level with the Airtable response data',
			},
			{
				displayName: 'Update All Matches',
				name: 'updateAllMatches',
				type: 'boolean',
				default: false,
				description:
					'Whether to update all records matching the value in the "Column to Match On". If not set, only the first matching record will be updated.',
				displayOptions: {
					show: {
						'/operation': ['update', 'upsert'],
					},
				},
			},
			{
				displayName: 'Array Field Handling',
				name: 'arrayMergeStrategy',
				type: 'options',
				options: [
					{
						name: 'Replace',
						value: 'replace',
						description: 'Replace existing values completely (default behavior)',
					},
					{
						name: 'Append',
						value: 'append',
						description: 'Add new values to existing ones (may create duplicates)',
					},
					{
						name: 'Union',
						value: 'union',
						description: 'Merge values while preventing duplicates (recommended)',
					},
				],
				default: 'replace',
				description: 'How to handle linked records and multi-select fields',
				displayOptions: {
					show: {
						'/operation': ['update', 'upsert'],
					},
				},
			},
			{
				displayName: 'Array Fields',
				name: 'arrayFields',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getArrayFields',
					loadOptionsDependsOn: ['table.value', 'base.value'],
				},
				default: [],
				description: 'Select which linked record and multi-select fields to apply array handling to. Leave empty to use replace behavior for all fields.',
				displayOptions: {
					show: {
						'/operation': ['update', 'upsert'],
						arrayMergeStrategy: ['append', 'union'],
					},
				},
			},
			{
				displayName: 'Field Update Strategy',
				name: 'fieldUpdateStrategy',
				type: 'options',
				options: [
					{
						name: 'Standard (Replace All)',
						value: 'standard',
						description: 'Use current behavior - replace all field values (default)',
					},
					{
						name: 'Custom Per-Field Rules',
						value: 'custom',
						description: 'Define specific update strategies for individual fields',
					},
				],
				default: 'standard',
				description: 'Choose how to handle field updates - standard replacement or custom per-field strategies',
				displayOptions: {
					show: {
						'/operation': ['update', 'upsert'],
					},
				},
			},
			{
				displayName: 'Field Update Rules',
				name: 'fieldUpdateRules',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: { rules: [] },
				description: 'Define specific update strategies for individual fields',
				displayOptions: {
					show: {
						'/operation': ['update', 'upsert'],
						fieldUpdateStrategy: ['custom'],
					},
				},
				options: [
					{
						name: 'rules',
						displayName: 'Field Rule',
						values: [
							{
								displayName: 'Fields',
								name: 'fieldNames',
								type: 'multiOptions',
								typeOptions: {
									loadOptionsMethod: 'getColumns',
									loadOptionsDependsOn: ['table.value', 'base.value'],
								},
								default: [],
								required: true,
								description: 'Select the fields to apply this update strategy to',
							},
							{
								displayName: 'Update Strategy',
								name: 'strategy',
								type: 'options',
								options: [
									{
										name: 'Replace (Default)',
										value: 'replace',
										description: 'Always overwrite the existing value',
									},
									{
										name: 'Preserve Existing',
										value: 'preserveExisting',
										description: 'Don\'t update if the field already has a value in Airtable',
									},
									{
										name: 'Replace unless Null',
										value: 'replaceUnlessNull',
										description: 'Only update if the new value is not null/empty',
									},
									{
										name: 'Append',
										value: 'append',
										description: 'Add new value to existing value (with separator for text)',
									},
									{
										name: 'Union',
										value: 'union',
										description: 'Merge values while removing duplicates',
									},
								],
								default: 'replace',
								required: true,
								description: 'How to handle updates for this field',
							},
						],
					},
				],
			},
			{
				displayName: 'Rename ID Field',
				name: 'renameIdField',
				type: 'string',
				default: '',
				placeholder: 'Property ID',
				description: 'Rename the output ID field to avoid clashing with input fields. Leave empty to keep default "id".',
			},
			{
				displayName: 'Rename Output Fields',
				name: 'renameOutputFields',
				type: 'string',
				default: '',
				placeholder: 'Property Fields',
				description: 'Rename the output fields container to avoid clashing with input fields. Leave empty to use flattened structure.',
			},
		],
	},
];

export const singleLinkedTableFields: INodeProperties[] = [
	{
		displayName: 'Linked Target Table',
		name: 'linkedTargetTable',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'Table in which a new record should be created and linked',
		displayOptions: {
			show: {
				createLinkedRecords: [true],
			},
		},
		typeOptions: {
			loadOptionsDependsOn: ['base.value'],
		},
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'tableSearch',
					searchable: true,
				},
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'tblXXXXXXXXXXXXXX',
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '[a-zA-Z0-9]{2,}',
							errorMessage: 'Not a valid Airtable Table ID',
						},
					},
				],
			},
		],
	},
	{
		displayName: 'Linked Columns',
		name: 'linkedColumns',
		type: 'resourceMapper',
		default: {
			mappingMode: 'defineBelow',
			value: null,
		},
		noDataExpression: true,
		required: true,
		displayOptions: {
			show: {
				createLinkedRecords: [true],
			},
		},
		typeOptions: {
			loadOptionsDependsOn: ['base.value', 'linkedTargetTable.value'],
			resourceMapper: {
				resourceMapperMethod: 'getColumnsForTargetTable',
				mode: 'add',
				fieldWords: {
					singular: 'column',
					plural: 'columns',
				},
				addAllFields: true,
				multiKeyMatch: false,
			},
		},
	},
];

export const linkedRecordField: INodeProperties = {
	displayName: 'Link Through Field',
	name: 'linkedRecordField',
	type: 'options',
	default: '',
	required: true,
	typeOptions: {
		loadOptionsDependsOn: ['base.value', 'table.value'],
		loadOptionsMethod: 'getLinkedRecordFields',
	},
	description: 'Select which field in the main table should contain the link to the created record',
	displayOptions: {
		show: {
			'createLinkedRecords': [true],
		},
	},
};
