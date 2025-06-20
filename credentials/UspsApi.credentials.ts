import {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class UspsApi implements ICredentialType {
	name = 'uspsApi';
	displayName = 'USPS API';
	documentationUrl = 'https://www.usps.com/business/web-tools-apis/';
	properties: INodeProperties[] = [
		{
			displayName: '📮 USPS Setup Instructions',
			name: 'setupInstructions',
			type: 'notice',
			default: '',
			displayOptions: {
				show: {},
			},
		},
		{
			displayName: '',
			name: 'instructions',
			type: 'notice',
			default: `
**Required Setup Steps:**

1. **Go to USPS Web Tools**: https://www.usps.com/business/web-tools-apis/
2. **Click "Register Now"** under Legacy Web Tools API Library
3. **Complete Registration Form**:
   - Business email required
   - Describe your use case
   - Accept Terms of Service
4. **Check Your Email**:
   - USPS will send your User ID via email
   - May take a few hours to receive
5. **Copy Your User ID** from the email

**Cost**: Completely FREE - No monthly fees or usage limits!

**Use Case**: Mail deliverability validation (checking if addresses can receive USPS mail delivery)

**Need Help?** Full documentation: https://www.usps.com/business/web-tools-apis/documentation-updates.htm
			`,
			displayOptions: {
				show: {},
			},
		},
		{
			displayName: 'User ID',
			name: 'userId',
			type: 'string',
			default: '',
			placeholder: 'Your USPS Web Tools User ID',
			description: 'Paste your USPS Web Tools User ID here (received via email after registration)',
			required: true,
		},
	];
}
