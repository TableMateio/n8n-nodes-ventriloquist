import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';

// Types for the transformation
interface IContactRecord extends IDataObject {
	id: string;
	createdTime: string;
	Contact: string;
	'Entity Type': string;
	'First Name': string;
	'Last Name': string;
	'Full Name': string;
	'First and Last': string;
	ID: number;
	'Record ID': string;
	Traced: boolean;
	Relations: string[];
	'Contact Addresses': string[];
	Foreclosures: string[];
	Own: string[];
	'Middle Name'?: string;
	'Middle Initial'?: string;
	Age?: number;
	'Birth Year'?: number;
	Phone?: string;
	Email?: string;
	'Relation to Owner'?: string;
	Deceased?: boolean;
	Bankruptcy?: boolean;
	Sex?: string;
}

interface IAddressRecord extends IDataObject {
	id: string;
	createdTime: string;
	Address: string;
	'Street 1': string;
	City: string;
	State: string;
	'Zip Code': string;
	Type: string;
	ID: number;
	Country: string;
	'Record ID': string;
	Contacts: string[];
	County?: string;
	'Street Number'?: string;
	'Street Name'?: string;
	'Street Suffix'?: string;
	'First Seen'?: string;
	'Last Seen'?: string;
}

interface ITransformationResult {
	contacts: IContactRecord[];
	addresses: IAddressRecord[];
}

export const description: INodeProperties[] = [
	{
		displayName: 'Output Format',
		name: 'outputFormat',
		type: 'options',
		options: [
			{
				name: 'Contacts Only',
				value: 'contacts',
				description: 'Output only contact records',
			},
			{
				name: 'Addresses Only',
				value: 'addresses',
				description: 'Output only address records',
			},
			{
				name: 'Both Contacts and Addresses',
				value: 'both',
				description: 'Output both contact and address records',
			},
		],
		default: 'both',
		displayOptions: {
			show: {
				operation: ['format'],
			},
		},
	},
	{
		displayName: 'Include Relatives',
		name: 'includeRelatives',
		type: 'boolean',
		default: true,
		description: 'Whether to create contact records for relatives (REL1-REL5)',
		displayOptions: {
			show: {
				operation: ['format'],
			},
		},
	},
	{
		displayName: 'Include Property Data',
		name: 'includePropertyData',
		type: 'boolean',
		default: false,
		description: 'Whether to include property information in address records',
		displayOptions: {
			show: {
				operation: ['format'],
			},
		},
	},
];

class IDIToContactsConverter {
	private contactIdCounter: number = 1;
	private addressIdCounter: number = 1;

	generateContactId(): string {
		return `rec${this.generateRandomString(14)}`;
	}

	generateAddressId(): string {
		return `rec${this.generateRandomString(14)}`;
	}

	private generateRandomString(length: number): string {
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		let result = '';
		for (let i = 0; i < length; i++) {
			result += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		return result;
	}

	cleanName(name: string): string {
		if (!name || name.trim() === '') {
			return '';
		}
		return name.trim().split(' ').map(word =>
			word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
		).join(' ');
	}

	parseDate(dateStr: string): string | null {
		if (!dateStr || dateStr.trim() === '') {
			return null;
		}

		try {
			// Try different date formats
			const formats = [
				/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, // MM/DD/YYYY
				/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, // MM/DD/YY
				/^(\d{4})-(\d{1,2})-(\d{1,2})$/,  // YYYY-MM-DD
			];

			for (const format of formats) {
				const match = dateStr.trim().match(format);
				if (match) {
					let year: number, month: number, day: number;

					if (format === formats[2]) { // YYYY-MM-DD
						[, year, month, day] = match.map(Number);
					} else { // MM/DD/YYYY or MM/DD/YY
						[, month, day, year] = match.map(Number);
						if (year < 100) { // 2-digit year
							year += year > 50 ? 1900 : 2000;
						}
					}

					const date = new Date(year, month - 1, day);
					return date.toISOString();
				}
			}
		} catch (error) {
			// Invalid date, return null
		}

		return null;
	}

	ynToBool(ynValue: string): boolean {
		return ynValue?.trim().toUpperCase() === 'Y';
	}

	calculateBirthYear(ageStr: string): number | null {
		try {
			const age = parseInt(ageStr);
			if (age > 0) {
				return new Date().getFullYear() - age;
			}
		} catch (error) {
			// Invalid age
		}
		return null;
	}

	formatPhone(phone: string): string {
		if (!phone) {
			return '';
		}

		// Remove all non-digits
		const digits = phone.replace(/\D/g, '');

		if (digits.length === 10) {
			return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
		} else if (digits.length === 11 && digits[0] === '1') {
			return `(${digits.slice(1, 4)})${digits.slice(4, 7)}-${digits.slice(7)}`;
		}

		return phone; // Return original if can't format
	}

	createContactDisplayName(first: string, last: string, contactId: number): string {
		const firstClean = first ? first.toLowerCase().replace(/\s+/g, '-') : '';
		const lastClean = last ? last.toLowerCase().replace(/\s+/g, '-') : '';
		return `${firstClean}-${lastClean}-${contactId}`;
	}

	guessGender(firstName: string): string {
		if (!firstName) {
			return 'U';
		}

		// Basic gender guessing - you could expand this with a larger name database
		const maleNames = ['james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'joseph', 'thomas', 'daniel'];
		const femaleNames = ['mary', 'patricia', 'jennifer', 'linda', 'elizabeth', 'barbara', 'susan', 'jessica', 'sarah', 'karen'];

		const nameLower = firstName.toLowerCase();
		if (maleNames.includes(nameLower)) {
			return 'M';
		} else if (femaleNames.includes(nameLower)) {
			return 'F';
		}

		return 'U';
	}

	createAddressRecord(
		street: string,
		city: string,
		state: string,
		zipCode: string,
		county: string = '',
		addressType: string = 'Contact',
		firstSeen: string = '',
		lastSeen: string = ''
	): IAddressRecord {
		const addressId = this.generateAddressId();
		this.addressIdCounter++;

		// Parse street into components
		let streetNumber = '';
		let streetName = '';
		let streetSuffix = '';

		if (street) {
			const parts = street.trim().split(/\s+/);
			if (parts.length > 0 && /^\d+/.test(parts[0])) {
				streetNumber = parts[0].replace(/,/g, '');
				const remaining = parts.slice(1).join(' ');

				// Simple suffix detection
				const suffixes = ['ST', 'STREET', 'AVE', 'AVENUE', 'RD', 'ROAD', 'LN', 'LANE', 'DR', 'DRIVE', 'CT', 'COURT', 'BLVD', 'BOULEVARD', 'PL', 'PLACE'];

				for (const suffix of suffixes) {
					if (remaining.toUpperCase().endsWith(suffix)) {
						streetSuffix = suffix;
						streetName = remaining.slice(0, -suffix.length).trim();
						break;
					}
				}

				if (!streetSuffix) {
					streetName = remaining;
				}
			} else {
				streetName = street;
			}
		}

		const fullAddress = street && city ? `${this.addressIdCounter} - ${street} - ${city}` : '';

		const addressRecord: IAddressRecord = {
			id: addressId,
			createdTime: new Date().toISOString(),
			Address: fullAddress,
			'Street 1': street,
			City: city,
			State: state,
			'Zip Code': zipCode,
			Type: addressType,
			ID: this.addressIdCounter,
			Country: 'USA',
			'Record ID': addressId,
			Contacts: [],
			County: county,
		};

		// Add street components if available
		if (streetNumber) {
			addressRecord['Street Number'] = streetNumber;
		}
		if (streetName) {
			addressRecord['Street Name'] = streetName;
		}
		if (streetSuffix) {
			addressRecord['Street Suffix'] = streetSuffix;
		}

		// Add date fields if available
		if (firstSeen) {
			const parsed = this.parseDate(firstSeen);
			if (parsed) {
				addressRecord['First Seen'] = parsed;
			}
		}
		if (lastSeen) {
			const parsed = this.parseDate(lastSeen);
			if (parsed) {
				addressRecord['Last Seen'] = parsed;
			}
		}

		return addressRecord;
	}

	createContactRecord(
		firstName: string,
		lastName: string,
		middleName: string = '',
		age: string = '',
		phone: string = '',
		email: string = '',
		relationToOwner: string = 'Owner',
		deceased: string = '',
		bankruptcy: string = '',
		suffix: string = ''
	): IContactRecord {
		const contactId = this.generateContactId();
		this.contactIdCounter++;

		// Clean names
		const firstClean = this.cleanName(firstName);
		const lastClean = this.cleanName(lastName);
		const middleClean = this.cleanName(middleName);

		// Create display name
		const displayName = this.createContactDisplayName(firstClean, lastClean, this.contactIdCounter);

		// Build full name
		const nameParts = [firstClean];
		if (middleClean) {
			nameParts.push(middleClean);
		}
		nameParts.push(lastClean);
		const fullName = nameParts.filter(Boolean).join(' ');

		// Create contact record
		const contact: IContactRecord = {
			id: contactId,
			createdTime: new Date().toISOString(),
			Contact: displayName,
			'Entity Type': 'Person',
			'First Name': firstClean,
			'Last Name': lastClean,
			'Full Name': fullName,
			'First and Last': `${firstClean} ${lastClean}`,
			ID: this.contactIdCounter,
			'Record ID': contactId,
			Traced: true,
			Relations: [],
			'Contact Addresses': [],
			Foreclosures: [],
			Own: [],
		};

		// Add optional fields
		if (middleClean) {
			contact['Middle Name'] = middleClean;
			contact['Middle Initial'] = middleClean.charAt(0);
		}

		if (age && /^\d+$/.test(age)) {
			contact.Age = parseInt(age);
			const birthYear = this.calculateBirthYear(age);
			if (birthYear) {
				contact['Birth Year'] = birthYear;
			}
		}

		if (phone) {
			contact.Phone = this.formatPhone(phone);
		}

		if (email) {
			contact.Email = email;
		}

		if (relationToOwner) {
			contact['Relation to Owner'] = relationToOwner;
		}

		if (deceased) {
			contact.Deceased = this.ynToBool(deceased);
		}

		if (bankruptcy) {
			contact.Bankruptcy = this.ynToBool(bankruptcy);
		}

		// Add gender guess
		contact.Sex = this.guessGender(firstClean);

		return contact;
	}

	processIDIRow(row: IDataObject, includeRelatives: boolean = true): ITransformationResult {
		const contacts: IContactRecord[] = [];
		const addresses: IAddressRecord[] = [];

		// Create primary contact (the searched person)
		const primaryContact = this.createContactRecord(
			(row['INPUT: First Name'] as string) || '',
			(row['INPUT: Last Name'] as string) || '',
			'', // No middle name in input data
			(row['DOB: Age'] as string) || '',
			(row['PH: Phone1'] as string) || '',
			'', // No email in primary
			'Owner',
			(row['DEC: Deceased (Y/N/U)'] as string) || '',
			(row['BNK: Bankrupt (Y/N/U)'] as string) || ''
		);

		contacts.push(primaryContact);

		// Create primary address if available
		const primaryAddressStreet = (row['ADD: Address1'] as string) || '';
		if (primaryAddressStreet) {
			const primaryAddress = this.createAddressRecord(
				primaryAddressStreet,
				(row['ADD: Address1 City'] as string) || '',
				(row['ADD: Address1 State'] as string) || '',
				(row['ADD: Address1 Zip'] as string) || '',
				(row['ADD: Address1 County'] as string) || '',
				'Contact',
				(row['ADD: Address1 First Seen'] as string) || '',
				(row['ADD: Address1 Last Seen'] as string) || ''
			);

			primaryAddress.Contacts.push(primaryContact.id);
			primaryContact['Contact Addresses'].push(primaryAddress.id);
			addresses.push(primaryAddress);
		}

		// Process relatives (REL1-REL5) if enabled
		if (includeRelatives) {
			for (let i = 1; i <= 5; i++) {
				const relFirst = (row[`REL${i}: First Name`] as string) || '';
				const relLast = (row[`REL${i}: Last Name`] as string) || '';

				if (relFirst && relLast) {
					// Create relative contact
					const relativeContact = this.createContactRecord(
						relFirst,
						relLast,
						(row[`REL${i}: Middle Name`] as string) || '',
						(row[`REL${i}: Age`] as string) || '',
						(row[`REL${i}: Phone 1`] as string) || '',
						(row[`REL${i}: Email 1`] as string) || '',
						(row[`REL${i}: Likely Relationship`] as string) || ''
					);

					// Link relatives bidirectionally
					primaryContact.Relations.push(relativeContact.id);
					relativeContact.Relations.push(primaryContact.id);

					contacts.push(relativeContact);

					// Create relative address if available
					const relAddress = (row[`REL${i}: Address`] as string) || '';
					const relCity = (row[`REL${i}: City`] as string) || '';
					const relState = (row[`REL${i}: State`] as string) || '';
					const relZip = (row[`REL${i}: Zip`] as string) || '';

					if (relAddress) {
						const relativeAddress = this.createAddressRecord(
							relAddress,
							relCity,
							relState,
							relZip
						);

						relativeAddress.Contacts.push(relativeContact.id);
						relativeContact['Contact Addresses'].push(relativeAddress.id);
						addresses.push(relativeAddress);
					}
				}
			}
		}

		return {
			contacts,
			addresses,
		};
	}
}

// Helper function to parse CSV - handles quoted fields and commas within quotes
function parseCSV(csvData: string): any[] {
	const lines = csvData.split('\n');
	if (lines.length < 2) return [];

	// Parse CSV line handling quotes and commas within quotes
	function parseLine(line: string): string[] {
		const result = [];
		let current = '';
		let inQuotes = false;

		for (let i = 0; i < line.length; i++) {
			const char = line[i];

			if (char === '"') {
				inQuotes = !inQuotes;
			} else if (char === ',' && !inQuotes) {
				result.push(current.trim());
				current = '';
			} else {
				current += char;
			}
		}
		result.push(current.trim());
		return result;
	}

	const headers = parseLine(lines[0]);
	const records = [];

	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim()) {
			const values = parseLine(lines[i]);
			const record: any = {};
			headers.forEach((header, index) => {
				record[header] = values[index] || '';
			});
			records.push(record);
		}
	}

	return records;
}

export async function execute(
	this: IExecuteFunctions,
	index: number,
): Promise<INodeExecutionData[]> {
	const item = this.getInputData()[index];
	const inputType = this.getNodeParameter('inputType', index, 'csvFile') as string;
	const outputFormat = this.getNodeParameter('outputFormat', index, 'both') as string;
	const includeRelatives = this.getNodeParameter('includeRelatives', index, true) as boolean;
	const includePropertyData = this.getNodeParameter('includePropertyData', index, false) as boolean;

	const converter = new IDIToContactsConverter();
	const returnData: INodeExecutionData[] = [];

	// Handle different input types
	if (inputType === 'csvFile') {
		// Process CSV file from binary data
		const binaryPropertyName = this.getNodeParameter('binaryPropertyName', index, 'data') as string;

		if (!item.binary || !item.binary[binaryPropertyName]) {
			throw new Error(`No binary data found with property name '${binaryPropertyName}'. Make sure the previous node provides CSV file data.`);
		}

		const binaryData = item.binary[binaryPropertyName];
		const csvContent = Buffer.from(binaryData.data, 'base64').toString('utf-8');

		// Parse CSV and process each row
		const csvRows = parseCSV(csvContent);

		for (let rowIndex = 0; rowIndex < csvRows.length; rowIndex++) {
			const row = csvRows[rowIndex];
			const result = converter.processIDIRow(row, includeRelatives);

			// Add metadata to track which CSV row this came from
			const rowMetadata = {
				csvRowIndex: rowIndex + 1, // 1-based for user friendliness
				totalRows: csvRows.length,
				originalFileName: binaryData.fileName || 'unknown.csv',
			};

			// Return data based on output format
			switch (outputFormat) {
				case 'contacts':
					result.contacts.forEach((contact, contactIndex) => {
						returnData.push({
							json: {
								...contact,
								_metadata: rowMetadata,
							},
							pairedItem: { item: index },
						});
					});
					break;

				case 'addresses':
					result.addresses.forEach((address, addressIndex) => {
						returnData.push({
							json: {
								...address,
								_metadata: rowMetadata,
							},
							pairedItem: { item: index },
						});
					});
					break;

				case 'both':
				default:
					// Add all contacts first
					result.contacts.forEach((contact, contactIndex) => {
						returnData.push({
							json: {
								...contact,
								_metadata: { ...rowMetadata, recordType: 'contact' },
							},
							pairedItem: { item: index },
						});
					});

					// Then add all addresses
					result.addresses.forEach((address, addressIndex) => {
						returnData.push({
							json: {
								...address,
								_metadata: { ...rowMetadata, recordType: 'address' },
							},
							pairedItem: { item: index },
						});
					});
					break;
			}
		}
	} else {
		// Process single JSON row (original behavior)
		const result = converter.processIDIRow(item.json, includeRelatives);

		// Return data based on output format
		switch (outputFormat) {
			case 'contacts':
				result.contacts.forEach(contact => {
					returnData.push({
						json: contact,
						pairedItem: { item: index },
					});
				});
				break;

			case 'addresses':
				result.addresses.forEach(address => {
					returnData.push({
						json: address,
						pairedItem: { item: index },
					});
				});
				break;

			case 'both':
			default:
				// Add all contacts first
				result.contacts.forEach(contact => {
					returnData.push({
						json: {
							...contact,
							_metadata: { recordType: 'contact' },
						},
						pairedItem: { item: index },
					});
				});

				// Then add all addresses
				result.addresses.forEach(address => {
					returnData.push({
						json: {
							...address,
							_metadata: { recordType: 'address' },
						},
						pairedItem: { item: index },
					});
				});
				break;
		}
	}

	return returnData;
}
