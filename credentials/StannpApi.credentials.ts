import {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class StannpApi implements ICredentialType {
	name = 'stannpApi';
	displayName = 'Stannp API';
	documentationUrl = 'https://www.stannp.com/api-documentation';
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			placeholder: 'Your Stannp API Key',
			description: 'Your Stannp API Key (NOT the Public Key). Find it in Settings → API screen.',
			required: true,
		},
		{
			displayName: 'API Server',
			name: 'server',
			type: 'options',
			default: 'us1',
			options: [
				{
					name: 'US (api-us1.stannp.com)',
					value: 'us1',
				},
				{
					name: 'EU (api-eu1.stannp.com)',
					value: 'eu1',
				},
			],
			description: 'The server to use based on your account location',
		},
	];
}
