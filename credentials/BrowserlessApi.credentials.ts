import {
	type ICredentialType,
	type INodeProperties,
	type ICredentialTestRequest,
} from 'n8n-workflow';

export class BrowserlessApi implements ICredentialType {
	name = 'browserlessApi';

	displayName = 'Browserless API';

	documentationUrl = 'https://browserless.io/docs/';

	properties: INodeProperties[] = [
		{
			displayName: 'Token',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			placeholder: 'Your Browserless API Token',
			description: 'Token for Browserless Cloud. For Railway deployments, this is the "TOKEN" environment variable.',
			required: true,
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://chrome.browserless.io',
			placeholder: 'https://your-deployment.up.railway.app',
			description: 'Base URL for Browserless. For Railway deployments, use your railway-provided domain (e.g., browserless-production-xxxx.up.railway.app).',
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

	// Test if the credentials are valid
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/stats',
			method: 'GET',
			headers: {
				'Cache-Control': 'no-cache',
				'Content-Type': 'application/json',
				'Authorization': '=Bearer {{$credentials.apiKey}}'
			},
		},
	};
}
