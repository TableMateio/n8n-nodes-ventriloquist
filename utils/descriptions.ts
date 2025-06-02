import type { INodeProperties } from 'n8n-workflow';

/**
 * Notice property for old version deprecation warnings
 */
export const oldVersionNotice: INodeProperties = {
	displayName: 'Version Notice',
	name: 'versionNotice',
	type: 'notice',
	default: '',
	displayOptions: {
		show: {},
	},
};
