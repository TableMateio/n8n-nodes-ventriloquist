import {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class UspsApi implements ICredentialType {
	name = 'uspsApi';
	displayName = 'USPS API';
	documentationUrl = 'https://developers.usps.com/';
	properties: INodeProperties[] = [
		{
			displayName: '📮 USPS Developer Portal Setup',
			name: 'setupInstructions',
			type: 'notice',
			default: 'Follow the instructions below to get your USPS Consumer Key and Consumer Secret from the USPS Developer Portal.',
			displayOptions: {
				show: {},
			},
		},
		{
			displayName: 'Setup Instructions',
			name: 'instructions',
			type: 'notice',
			default: '',
			description: `<strong>USPS Developer Portal Setup:</strong><br/><br/>
			1. <strong>Go to:</strong> <a href="https://developers.usps.com/" target="_blank">https://developers.usps.com/</a><br/>
			2. <strong>Create Account</strong> and log in<br/>
			3. <strong>Add New App:</strong><br/>
			&nbsp;&nbsp;• App name: "Address Verification System" (or similar)<br/>
			&nbsp;&nbsp;• Description: Address validation for business applications<br/>
			&nbsp;&nbsp;• Select APIs you need (Address Validation)<br/>
			4. <strong>Get Your Credentials:</strong><br/>
			&nbsp;&nbsp;• Consumer Key (from your app dashboard)<br/>
			&nbsp;&nbsp;• Consumer Secret (from your app dashboard)<br/>
			5. <strong>Copy Both Values</strong> into the fields below<br/><br/>
			<strong>Cost:</strong> Completely FREE - No monthly fees or usage limits!<br/>
			<strong>Documentation:</strong> <a href="https://developers.usps.com/api-catalog" target="_blank">https://developers.usps.com/api-catalog</a>`,
			displayOptions: {
				show: {},
			},
		},
		{
			displayName: 'Consumer Key',
			name: 'consumerKey',
			type: 'string',
			default: '',
			placeholder: 'Your USPS Consumer Key',
			description: 'Consumer Key from your USPS Developer Portal app',
			required: true,
		},
		{
			displayName: 'Consumer Secret',
			name: 'consumerSecret',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			placeholder: 'Your USPS Consumer Secret',
			description: 'Consumer Secret from your USPS Developer Portal app (kept secure)',
			required: true,
		},
	];
}
