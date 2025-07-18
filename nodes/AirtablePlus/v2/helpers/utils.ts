import set from 'lodash/set';
import { ApplicationError, type IDataObject, type NodeApiError, type IExecuteFunctions } from 'n8n-workflow';

import type { UpdateRecord } from './interfaces';
import { getTableSchema } from './linkedRecordUtils';
import { apiRequest } from '../transport';

export function removeIgnored(data: IDataObject, ignore: string | string[]) {
	if (ignore) {
		let ignoreFields: string[] = [];

		if (typeof ignore === 'string') {
			ignoreFields = ignore.split(',').map((field) => field.trim());
		} else {
			ignoreFields = ignore;
		}

		const newData: IDataObject = {};

		for (const field of Object.keys(data)) {
			if (!ignoreFields.includes(field)) {
				newData[field] = data[field];
			}
		}

		return newData;
	} else {
		return data;
	}
}

export function removeEmptyFields(data: IDataObject) {
	const newData: IDataObject = {};

	for (const [field, value] of Object.entries(data)) {
		// Skip fields that are null, undefined, empty string, or empty array
		if (value !== null &&
			value !== undefined &&
			value !== '' &&
			!(Array.isArray(value) && value.length === 0)) {
			newData[field] = value;
		}
	}

	return newData;
}

export function findMatches(
	data: UpdateRecord[],
	keys: string[],
	fields: IDataObject,
	updateAll?: boolean,
) {
	// Enhanced matching logic that handles null values more flexibly
	const matchingRecords = data.filter((record) => {
		return keys.every(key => {
			const inputValue = fields[key];
			const recordValue = record.fields[key];

			// Both null/undefined/empty - consider a match
			if ((inputValue === null || inputValue === undefined || inputValue === '') &&
				(recordValue === null || recordValue === undefined || recordValue === '')) {
				return true;
			}

			// Both have values - must be equal
			if (inputValue !== null && inputValue !== undefined && inputValue !== '' &&
				recordValue !== null && recordValue !== undefined && recordValue !== '') {
				return String(inputValue) === String(recordValue);
			}

			// One null, one has value - not a match
			return false;
		});
	});

	if (updateAll) {
		if (!matchingRecords?.length) {
			throw new ApplicationError('No records match provided keys', { level: 'warning' });
		}
		return matchingRecords;
	} else {
		if (!matchingRecords?.length) {
			throw new ApplicationError('Record matching provided keys was not found', {
				level: 'warning',
			});
		}
		return [matchingRecords[0]];
	}
}

export function processAirtableError(error: NodeApiError, id?: string, itemIndex?: number) {
	if (error.description === 'NOT_FOUND' && id) {
		error.description = `${id} is not a valid Record ID`;
	}
	if (error.description?.includes('You must provide an array of up to 10 record objects') && id) {
		error.description = `${id} is not a valid Record ID`;
	}

	if (itemIndex !== undefined) {
		set(error, 'context.itemIndex', itemIndex);
	}

	return error;
}

export const flattenOutput = (record: IDataObject) => {
	const { fields, ...rest } = record;
	return {
		...rest,
		...(fields as IDataObject),
	};
};

export const processOutputFieldRenaming = (record: IDataObject, renameIdField?: string, renameOutputFields?: string) => {
	if (!renameIdField && !renameOutputFields) {
		// No renaming needed, use standard flatten
		return flattenOutput(record);
	}

	const { fields, id, ...rest } = record;
	const result: IDataObject = { ...rest };

	// Handle ID field renaming
	if (renameIdField && renameIdField.trim()) {
		result[renameIdField.trim()] = id;
	} else {
		result.id = id;
	}

	// Handle fields renaming
	if (renameOutputFields && renameOutputFields.trim()) {
		result[renameOutputFields.trim()] = fields;
	} else {
		// Use standard flattening when no renaming is specified
		Object.assign(result, fields as IDataObject);
	}

	return result;
};

/**
 * Validates linked record fields to ensure record IDs belong to the correct linked tables
 */
export async function validateLinkedRecordFields(
	this: IExecuteFunctions,
	base: string,
	tableId: string,
	fieldsData: IDataObject,
): Promise<{ isValid: boolean; errors: string[] }> {
	const errors: string[] = [];

	try {
		// Get the table schema to identify linked record fields
		const { linkedFields } = await getTableSchema.call(this, base, tableId);

		if (linkedFields.length === 0) {
			return { isValid: true, errors: [] };
		}

		// Check each linked field in the provided field data
		for (const linkedField of linkedFields) {
			const fieldValue = fieldsData[linkedField.fieldName];

			// Skip if field is not being set or is empty
			if (!fieldValue || (Array.isArray(fieldValue) && fieldValue.length === 0)) {
				continue;
			}

			// Ensure we have an array of record IDs
			const recordIds = Array.isArray(fieldValue) ? fieldValue : [fieldValue];

			// Validate each record ID
			for (const recordId of recordIds) {
				if (typeof recordId === 'string' && recordId.startsWith('rec')) {
					// Try to fetch the record from the expected linked table to validate it exists there
					try {
						await apiRequest.call(
							this,
							'GET',
							`${base}/${linkedField.linkedTableId}/${recordId}`,
						);
					} catch (error: any) {
						// If we get a 404 or similar error, the record doesn't exist in the expected table
						if (error.httpCode === '404' || error.message?.includes('NOT_FOUND')) {
							errors.push(
								`Field "${linkedField.fieldName}": Record ID "${recordId}" does not exist in linked table "${linkedField.linkedTableName || linkedField.linkedTableId}". ` +
								`This field is configured to link to table "${linkedField.linkedTableId}" but the record ID belongs to a different table.`
							);
						} else if (error.message?.includes('ROW_TABLE_DOES_NOT_MATCH_LINKED_TABLE')) {
							errors.push(
								`Field "${linkedField.fieldName}": Record ID "${recordId}" belongs to a different table than expected. ` +
								`This field is configured to link to table "${linkedField.linkedTableName || linkedField.linkedTableId}".`
							);
						} else {
							// Some other error occurred during validation
							console.warn(`Could not validate linked record ${recordId} in field ${linkedField.fieldName}:`, error);
						}
					}
				}
			}
		}
	} catch (error) {
		console.error('Error during linked record validation:', error);
		// If validation itself fails, we'll allow the operation to proceed and let Airtable handle validation
		return { isValid: true, errors: [] };
	}

	return { isValid: errors.length === 0, errors };
}
