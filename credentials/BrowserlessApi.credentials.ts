import { type ICredentialType, type INodeProperties } from 'n8n-workflow';

export class BrowserlessApi implements ICredentialType {
	name = 'browserlessApi';

	displayName = 'Browserless API';

	documentationUrl = 'https://browserless.io/docs/';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			placeholder: 'Your Browserless API Key',
			description: 'API Key for Browserless Cloud. Get this from your Browserless dashboard.',
			required: true,
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://chrome.browserless.io',
			placeholder: 'https://chrome.browserless.io',
			description: 'Base URL for Browserless. Change only if using a custom deployment or enterprise plan.',
			required: true,
		},
		{
			displayName: 'Request Timeout',
			name: 'connectionTimeout',
			type: 'number',
			default: 120000,
			description: 'Maximum time in milliseconds to wait for individual operations like navigation, clicks, or screenshot capture. Does not affect how long the browser session stays open. For testing, use a higher value (120000 = 2 minutes).',
			required: false,
		},
		{
			displayName: 'Stealth Mode',
			name: 'stealthMode',
			type: 'boolean',
			default: true,
			description: 'Whether to use stealth mode to avoid bot detection. Recommended for most web scraping tasks.',
			required: false,
		},
	];
}
