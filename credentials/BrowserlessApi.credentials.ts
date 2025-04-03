import type {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class BrowserlessApi implements ICredentialType {
	name = 'browserlessApi';

	displayName = 'Browserless API';

	documentationUrl = 'https://browserless.io/docs/';

	properties: INodeProperties[] = [
		{
			displayName: 'Connection Type',
			name: 'connectionType',
			type: 'options',
			options: [
				{
					name: 'Standard (Domain + Token)',
					value: 'standard',
					description: 'Connect using domain and token separately',
				},
				{
					name: 'Direct WebSocket URL (Railway)',
					value: 'direct',
					description: 'Connect using a direct WebSocket URL (recommended for Railway)',
				},
			],
			default: 'standard',
			description: 'How to connect to the Browserless service',
		},
		{
			displayName: 'Direct WebSocket URL',
			name: 'wsEndpoint',
			type: 'string',
			default: '',
			placeholder: 'wss://browserless-production-xxxx.up.railway.app?token=YOUR_TOKEN',
			description: 'Complete WebSocket URL from Railway (BROWSER_WS_ENDPOINT environment variable). Include the token parameter if available.',
			required: true,
			displayOptions: {
				show: {
					connectionType: ['direct'],
				},
			},
		},
		{
			displayName: 'Token',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			placeholder: 'Your Browserless TOKEN value',
			description: 'Token for Browserless. For Railway deployments, use the "TOKEN" environment variable (not BROWSER_TOKEN).',
			required: true,
			displayOptions: {
				show: {
					connectionType: ['standard'],
				},
			},
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://chrome.browserless.io',
			placeholder: 'browserless-production-2a8f.up.railway.app',
			description: 'Base URL for Browserless. For Railway deployments, use your domain WITHOUT https:// (e.g., browserless-production-xxxx.up.railway.app).',
			required: true,
			displayOptions: {
				show: {
					connectionType: ['standard'],
				},
			},
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
		{
			displayName: 'Note: Railway Deployments',
			name: 'railwayNote',
			type: 'notice',
			default: 'Railway-hosted Browserless instances only respond to WebSocket connections. Use the "Direct WebSocket URL" connection type with the full WebSocket URL from Railway. You can use the test utility to verify your connection: "pnpm run test:browserless your-websocket-url"',
		},
	];

	// Not using standard credential test since Railway instances only accept WebSocket connections
}
