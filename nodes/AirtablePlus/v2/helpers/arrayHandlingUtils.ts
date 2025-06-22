import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { getTableSchema } from './linkedRecordUtils';

export interface ArrayHandlingOptions {
	arrayMergeStrategy: 'replace' | 'append' | 'union';
	arrayFields?: string[];
}

export interface ArrayFieldInfo {
	fieldName: string;
	fieldType: 'linkedRecord' | 'multiSelect';
	linkedTableId?: string;
}

/**
 * Detects array-type fields (linked records and multi-select) in a table
 */
export async function detectArrayFields(
	this: IExecuteFunctions,
	base: string,
	tableId: string,
): Promise<ArrayFieldInfo[]> {
	const { allFields } = await getTableSchema.call(this, base, tableId);
	const arrayFields: ArrayFieldInfo[] = [];

	for (const field of allFields) {
		const fieldType = (field.type as string)?.toLowerCase();

		// Check for linked record fields
		if (fieldType?.includes('multiplerecordlinks') ||
		    fieldType?.includes('foreignkey') ||
		    fieldType?.includes('linkedrecord') ||
		    fieldType === 'multipleRecordLinks') {

			const fieldOptions = field.options as IDataObject;
			arrayFields.push({
				fieldName: field.name as string,
				fieldType: 'linkedRecord',
				linkedTableId: fieldOptions?.linkedTableId as string,
			});
		}

		// Check for multi-select fields
		else if (fieldType?.includes('multipleselects') ||
		         fieldType?.includes('multiselect') ||
		         fieldType === 'multipleSelects') {

			arrayFields.push({
				fieldName: field.name as string,
				fieldType: 'multiSelect',
			});
		}
	}

	return arrayFields;
}

/**
 * Determines which array fields should be processed based on options
 */
export function getFieldsToProcess(
	arrayFields: ArrayFieldInfo[],
	options: ArrayHandlingOptions,
): string[] {
	// If strategy is replace, don't apply special handling
	if (options.arrayMergeStrategy === 'replace') {
		return [];
	}

	// If no specific fields selected, apply to all detected array fields
	if (!options.arrayFields || options.arrayFields.length === 0) {
		return arrayFields.map(field => field.fieldName);
	}

	// Return intersection of detected fields and specified fields
	const detectedFieldNames = arrayFields.map(field => field.fieldName);
	return options.arrayFields.filter(fieldName => detectedFieldNames.includes(fieldName));
}

/**
 * Normalizes a value to an array format, handling smart conversion
 */
export function normalizeToArray(value: any): any[] {
	if (value === null || value === undefined) {
		return [];
	}

	if (Array.isArray(value)) {
		// Filter out empty strings, null, and undefined values
		return value.filter(item => item !== null && item !== undefined && item !== '');
	}

	// Single value - convert to array, but only if it's not empty
	if (value === '' || value === null || value === undefined) {
		return [];
	}

	return [value];
}

/**
 * Merges array values according to the specified strategy with smart array handling
 */
export function mergeArrayValues(
	existingValue: any,
	newValue: any,
	strategy: 'replace' | 'append' | 'union',
): any {
	// For replace strategy, just return the new value as-is
	if (strategy === 'replace') {
		return newValue;
	}

	// Smart array normalization
	const existingArray = normalizeToArray(existingValue);
	const newArray = normalizeToArray(newValue);

	switch (strategy) {
		case 'append':
			return [...existingArray, ...newArray];

		case 'union':
			// Create a set to remove duplicates, handling both strings and objects
			const combined = [...existingArray, ...newArray];
			const seen = new Set();
			return combined.filter(item => {
				// Skip empty strings, null, and undefined values
				if (item === '' || item === null || item === undefined) {
					return false;
				}

				const key = typeof item === 'object' ? JSON.stringify(item) : String(item);
				if (seen.has(key)) {
					return false;
				}
				seen.add(key);
				return true;
			});

		default:
			return newValue;
	}
}

/**
 * Processes record fields according to array handling options
 */
export async function processRecordFields(
	this: IExecuteFunctions,
	base: string,
	tableId: string,
	newFields: IDataObject,
	existingFields: IDataObject | null,
	options: ArrayHandlingOptions,
): Promise<IDataObject> {
	// If replace strategy or no existing fields, return as-is
	if (options.arrayMergeStrategy === 'replace' || !existingFields) {
		return newFields;
	}

	// Detect array fields in the table
	const arrayFields = await detectArrayFields.call(this, base, tableId);
	const fieldsToProcess = getFieldsToProcess(arrayFields, options);

	// If no fields to process, return as-is
	if (fieldsToProcess.length === 0) {
		return newFields;
	}

	// Process each field
	const processedFields = { ...newFields };

	for (const fieldName of fieldsToProcess) {
		if (fieldName in newFields) {
			const existingValue = existingFields[fieldName];
			const newValue = newFields[fieldName];

			processedFields[fieldName] = mergeArrayValues(
				existingValue,
				newValue,
				options.arrayMergeStrategy,
			);
		}
	}

	return processedFields;
}
