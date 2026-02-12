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
					name: 'Direct WebSocket URL (Recommended for Railway)',
					value: 'direct',
					description: 'Connect using a direct WebSocket URL (most reliable option)',
				},
				{
					name: 'Standard (Domain + Token)',
					value: 'standard',
					description: 'Connect using domain and token separately',
				},
			],
			default: 'direct',
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
			displayName: 'Anti-Detection Level',
			name: 'antiDetectionLevel',
			type: 'options',
			options: [
				{
					name: 'Off',
					value: 'off',
					description: 'No anti-detection measures. For trusted internal sites.',
				},
				{
					name: 'Standard',
					value: 'standard',
					description: 'Basic stealth: webdriver override, plugins mock, launch flags. Same as previous Stealth Mode.',
				},
				{
					name: 'Maximum',
					value: 'maximum',
					description: 'Full anti-detection: CDP leak prevention, all standard measures. Recommended for Cloudflare/Turnstile sites.',
				},
			],
			default: 'standard',
			description: 'Level of anti-detection measures to apply. Standard preserves existing behavior. Maximum adds CDP-level patches to defeat Cloudflare Turnstile.',
			required: false,
		},
		{
			// Hidden - kept for backward compatibility with existing credentials
			displayName: 'Stealth Mode (Deprecated)',
			name: 'stealthMode',
			type: 'hidden',
			default: true,
		},
		{
			displayName: 'Note: Railway Deployments',
			name: 'railwayNote',
			type: 'notice',
			default: 'For Railway deployments, the "Direct WebSocket URL" connection type is strongly recommended. Use the complete WebSocket URL from the BROWSER_WS_ENDPOINT variable.',
		},
	];

	// Not using standard credential test since Railway instances only accept WebSocket connections
}
