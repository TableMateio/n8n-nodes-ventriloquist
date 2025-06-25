import {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class LobApi implements ICredentialType {
	name = 'lobApi';
	displayName = 'Lob API';
	documentationUrl = 'https://docs.lob.com/';
	properties: INodeProperties[] = [
		{
			displayName: 'Secret API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			placeholder: 'test_... or live_...',
			description: 'Your Lob Secret API Key (NOT the Publishable Key). Starts with test_ or live_. Find it in your Lob Dashboard under Settings → API Keys.',
			required: true,
		},
		{
			displayName: 'Environment',
			name: 'environment',
			type: 'options',
			default: 'test',
			options: [
				{
					name: 'Test',
					value: 'test',
				},
				{
					name: 'Production',
					value: 'live',
				},
			],
			description: 'The environment to use - test keys start with test_ and live keys start with live_',
		},
	];
}
