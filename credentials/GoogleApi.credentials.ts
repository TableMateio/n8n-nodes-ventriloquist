import {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class GoogleApi implements ICredentialType {
	name = 'googleApi';
	displayName = 'Google API';
	documentationUrl = 'https://developers.google.com/maps/documentation/geocoding/overview';
	properties: INodeProperties[] = [
		{
			displayName: '🔧 Setup Instructions',
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

1. **Go to Google Cloud Console**: https://console.cloud.google.com/
2. **Create or Select Project**: Choose existing project or create new one
3. **Enable Geocoding API**:
   - Go to "APIs & Services" → "Library"
   - Search for "Geocoding API"
   - Click "Enable"
4. **Create API Key**:
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "API Key"
   - Copy the generated key
5. **Secure Your Key** (Recommended):
   - Click on your API key to edit
   - Under "Application restrictions", choose "HTTP referrers" or "IP addresses"
   - Under "API restrictions", select "Restrict key" and choose "Geocoding API"

**Cost**: Google provides $200/month free credit. Geocoding API costs ~$5 per 1,000 requests.

**Need Help?** Full guide: https://developers.google.com/maps/documentation/geocoding/get-api-key
			`,
			displayOptions: {
				show: {},
			},
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			placeholder: 'AIza...',
			description: 'Paste your Google Maps API Key here (starts with "AIza")',
			required: true,
		},
	];
}
