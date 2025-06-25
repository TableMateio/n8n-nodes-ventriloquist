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
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			placeholder: 'Your Lob API Key',
			description: 'Your Lob API Key. Find it in your Lob dashboard under Settings → API Keys.',
			required: true,
		},
		{
			displayName: 'Environment',
			name: 'environment',
			type: 'options',
			default: 'test',
			options: [
				{
					name: 'Test (api.lob.com with test_ key)',
					value: 'test',
				},
				{
					name: 'Live (api.lob.com with live_ key)',
					value: 'live',
				},
			],
			description: 'The environment to use - test for development, live for production',
		},
	];
}