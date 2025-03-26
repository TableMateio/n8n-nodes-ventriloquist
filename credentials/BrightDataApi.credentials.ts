import { type ICredentialType, type INodeProperties } from 'n8n-workflow';

export class BrightDataApi implements ICredentialType {
	name = 'brightDataApi';

	displayName = 'Bright Data API';

	documentationUrl = 'https://brightdata.com/documentation';

	properties: INodeProperties[] = [
		{
			displayName: 'WebSocket Endpoint',
			name: 'websocketEndpoint',
			type: 'string',
			default: '',
			placeholder: 'wss://brd-customer-xxx.zproxy.lum-superproxy.io/session?token=yyyyy',
			description: 'WebSocket endpoint for Bright Data Browser Scraping Browser',
			required: true,
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'API Key for Bright Data (optional if using WebSocket endpoint with token)',
			required: false,
		},
	];
}
