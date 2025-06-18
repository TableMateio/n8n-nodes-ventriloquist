import {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class SmartyApi implements ICredentialType {
	name = 'smartyApi';
	displayName = 'SmartyStreets API';
	documentationUrl = 'https://www.smartystreets.com/docs';
	properties: INodeProperties[] = [
		{
			displayName: 'Auth ID',
			name: 'authId',
			type: 'string',
			default: '',
			placeholder: 'Your SmartyStreets Auth ID',
			description: 'Your SmartyStreets Auth ID from your account dashboard',
			required: true,
		},
		{
			displayName: 'Auth Token',
			name: 'authToken',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			placeholder: 'Your SmartyStreets Auth Token',
			description: 'Your SmartyStreets Auth Token from your account dashboard',
			required: true,
		},
		{
			displayName: 'License Type',
			name: 'license',
			type: 'options',
			default: 'us-core-cloud',
			options: [
				{
					name: 'US Core Cloud',
					value: 'us-core-cloud',
				},
				{
					name: 'US Rooftop Cloud',
					value: 'us-rooftop-cloud',
				},
				{
					name: 'International Cloud',
					value: 'international-cloud',
				},
			],
			description: 'The license type determines which API endpoints you can use',
		},
	];
}
