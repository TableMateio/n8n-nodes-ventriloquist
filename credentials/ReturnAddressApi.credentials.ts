import {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ReturnAddressApi implements ICredentialType {
	name = 'returnAddressApi';
	displayName = 'Return Address';
	documentationUrl = 'https://github.com/n8n-io/n8n-nodes-starter';
	properties: INodeProperties[] = [
		{
			displayName: 'Address Name',
			name: 'addressName',
			type: 'string',
			default: '',
			placeholder: 'My Business Address',
			description: 'A friendly name for this return address for easy identification',
			required: true,
		},
		{
			displayName: 'Name',
			name: 'name',
			type: 'string',
			default: '',
			placeholder: 'John Doe',
			description: 'Full name or business name for the return address',
			required: true,
		},
		{
			displayName: 'Company',
			name: 'company',
			type: 'string',
			default: '',
			placeholder: 'Acme Corporation',
			description: 'Company name (optional)',
		},
		{
			displayName: 'Address Line 1',
			name: 'address1',
			type: 'string',
			default: '',
			placeholder: '123 Main Street',
			description: 'First line of the return address',
			required: true,
		},
		{
			displayName: 'Address Line 2',
			name: 'address2',
			type: 'string',
			default: '',
			placeholder: 'Suite 100',
			description: 'Second line of the return address (optional)',
		},
		{
			displayName: 'City/Town',
			name: 'town',
			type: 'string',
			default: '',
			placeholder: 'New York',
			description: 'City or town for the return address',
			required: true,
		},
		{
			displayName: 'State/Region',
			name: 'region',
			type: 'string',
			default: '',
			placeholder: 'NY',
			description: 'State, province, or region for the return address',
			required: true,
		},
		{
			displayName: 'ZIP/Postal Code',
			name: 'postcode',
			type: 'string',
			default: '',
			placeholder: '10001',
			description: 'ZIP code, postal code, or postcode for the return address',
			required: true,
		},
		{
			displayName: 'Country',
			name: 'country',
			type: 'string',
			default: 'US',
			placeholder: 'US',
			description: 'ISO-3166 alpha-2 country code (e.g., "US", "CA", "GB"). This will be automatically normalized.',
			required: true,
		},
	];
}
