import set from 'lodash/set';
import { ApplicationError, type IDataObject, type NodeApiError } from 'n8n-workflow';

import type { UpdateRecord } from './interfaces';

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
