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
			placeholder: 'Your Browserless TOKEN value',
			description: 'Token for Browserless. For Railway deployments, use the "TOKEN" environment variable (not BROWSER_TOKEN).',
			required: true,
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://chrome.browserless.io',
			placeholder: 'browserless-production-2a8f.up.railway.app',
			description: 'Base URL for Browserless. For Railway deployments, simply use your domain WITHOUT https:// (e.g., browserless-production-xxxx.up.railway.app).',
			required: true,
		},
		{
			displayName: 'Direct WebSocket URL (Optional)',
			name: 'wsEndpoint',
			type: 'string',
			default: '',
			placeholder: 'wss://browserless-production-2a8f.up.railway.app/browserws',
			description: 'Direct WebSocket URL if available. For Railway deployments, check the BROWSER_WS_ENDPOINT environment variable and copy it here (without the token part).',
			required: false,
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
			baseURL: '={{$credentials.baseUrl.startsWith("http") ? $credentials.baseUrl : "https://" + $credentials.baseUrl}}',
			url: '/healthz',
			method: 'GET',
		},
	};
}
