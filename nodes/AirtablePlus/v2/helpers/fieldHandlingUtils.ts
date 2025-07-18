import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { ApplicationError } from 'n8n-workflow';
import { getTableSchema } from './linkedRecordUtils';
import type { FieldUpdateRule, FieldUpdateStrategy } from './interfaces';

export interface FieldInfo {
	fieldName: string;
	fieldType: string;
	isArray: boolean;
	linkedTableId?: string;
}

export interface FieldProcessingResult {
	shouldUpdate: boolean;
	processedValue: any;
}

/**
 * Detects all fields in a table and categorizes them by type
 */
export async function detectAllFields(
	this: IExecuteFunctions,
	base: string,
	tableId: string,
): Promise<FieldInfo[]> {
	const { allFields } = await getTableSchema.call(this, base, tableId);
	const fields: FieldInfo[] = [];

	for (const field of allFields) {
		const fieldType = (field.type as string)?.toLowerCase() || '';
		const fieldName = field.name as string;

		// Determine if this is an array-type field
		const isArray = fieldType.includes('multiplerecordlinks') ||
			fieldType.includes('linkedrecord') ||
			fieldType.includes('multipleselects') ||
			fieldType.includes('multiselect') ||
			fieldType === 'multipleRecordLinks' ||
			fieldType === 'multipleSelects';

		// Get linked table ID for linked record fields
		let linkedTableId: string | undefined;
		if (fieldType.includes('multiplerecordlinks') ||
		    fieldType.includes('linkedrecord') ||
		    fieldType === 'multipleRecordLinks') {
			const fieldOptions = field.options as IDataObject;
			linkedTableId = fieldOptions?.linkedTableId as string;
		}

		fields.push({
			fieldName,
			fieldType,
			isArray,
			linkedTableId,
		});
	}

	return fields;
}

/**
 * Processes a field value according to the specified update strategy
 */
export async function processFieldValue(
	this: IExecuteFunctions,
	fieldName: string,
	newValue: any,
	existingValue: any,
	strategy: FieldUpdateStrategy,
	fieldInfo: FieldInfo,
): Promise<FieldProcessingResult> {
	switch (strategy) {
		case 'replace':
			// Always update with new value (current default behavior)
			return {
				shouldUpdate: true,
				processedValue: newValue,
			};

				case 'preserveExisting':
			// Don't update if existing value exists and is not null/empty
			const hasExistingValue = existingValue !== null && existingValue !== undefined && existingValue !== '' &&
			    !(Array.isArray(existingValue) && existingValue.length === 0);

			console.log(`🔍 preserveExisting logic for "${fieldName}":`, {
				existingValue,
				hasExistingValue,
				willUpdate: !hasExistingValue
			});

			if (hasExistingValue) {
				return {
					shouldUpdate: false,
					processedValue: existingValue,
				};
			}
			return {
				shouldUpdate: true,
				processedValue: newValue,
			};

		case 'replaceUnlessNull':
			// Only update if new value is not null/empty
			if (newValue === null || newValue === undefined || newValue === '' ||
			    (Array.isArray(newValue) && newValue.length === 0)) {
				return {
					shouldUpdate: false,
					processedValue: existingValue,
				};
			}
			return {
				shouldUpdate: true,
				processedValue: newValue,
			};

		case 'append':
			return processAppendStrategy(newValue, existingValue, fieldInfo);

		case 'union':
			return processUnionStrategy(newValue, existingValue, fieldInfo);

		default:
			// Default to replace if unknown strategy
			return {
				shouldUpdate: true,
				processedValue: newValue,
			};
	}
}

/**
 * Processes the append strategy for different field types
 */
function processAppendStrategy(
	newValue: any,
	existingValue: any,
	fieldInfo: FieldInfo,
): FieldProcessingResult {
	// Handle null/empty cases
	if (newValue === null || newValue === undefined || newValue === '') {
		return {
			shouldUpdate: false,
			processedValue: existingValue,
		};
	}

	if (existingValue === null || existingValue === undefined || existingValue === '') {
		return {
			shouldUpdate: true,
			processedValue: newValue,
		};
	}

	if (fieldInfo.isArray) {
		// For array fields (linked records, multi-select), merge arrays
		const existingArray = Array.isArray(existingValue) ? existingValue : [existingValue];
		const newArray = Array.isArray(newValue) ? newValue : [newValue];
		return {
			shouldUpdate: true,
			processedValue: [...existingArray, ...newArray],
		};
	} else {
		// For text fields, concatenate with separator
		const separator = ', ';
		const processedValue = `${existingValue}${separator}${newValue}`;
		return {
			shouldUpdate: true,
			processedValue,
		};
	}
}

/**
 * Processes the union strategy for different field types
 */
function processUnionStrategy(
	newValue: any,
	existingValue: any,
	fieldInfo: FieldInfo,
): FieldProcessingResult {
	// Handle null/empty cases
	if (newValue === null || newValue === undefined || newValue === '') {
		return {
			shouldUpdate: false,
			processedValue: existingValue,
		};
	}

	if (existingValue === null || existingValue === undefined || existingValue === '') {
		return {
			shouldUpdate: true,
			processedValue: newValue,
		};
	}

	if (fieldInfo.isArray) {
		// For array fields, merge and deduplicate
		const existingArray = Array.isArray(existingValue) ? existingValue : [existingValue];
		const newArray = Array.isArray(newValue) ? newValue : [newValue];
		const combined = [...existingArray, ...newArray];

		// Remove duplicates based on string representation
		const seen = new Set();
		const deduplicated = combined.filter(item => {
			if (item === null || item === undefined || item === '') {
				return false;
			}
			const key = typeof item === 'object' ? JSON.stringify(item) : String(item);
			if (seen.has(key)) {
				return false;
			}
			seen.add(key);
			return true;
		});

		return {
			shouldUpdate: true,
			processedValue: deduplicated,
		};
	} else {
		// For text fields, check if values are different before appending
		const existingStr = String(existingValue);
		const newStr = String(newValue);

		if (existingStr === newStr) {
			// Values are the same, no need to update
			return {
				shouldUpdate: false,
				processedValue: existingValue,
			};
		}

		// Values are different, append with separator
		const separator = ', ';
		const processedValue = `${existingStr}${separator}${newStr}`;
		return {
			shouldUpdate: true,
			processedValue,
		};
	}
}

/**
 * Validates field update rules for conflicts (same field in multiple rules)
 */
export function validateFieldUpdateRules(fieldUpdateRules: FieldUpdateRule[]): void {
	const seenFields = new Set<string>();
	const duplicateFields: string[] = [];

	for (const rule of fieldUpdateRules) {
		for (const fieldName of rule.fieldNames) {
			if (seenFields.has(fieldName)) {
				duplicateFields.push(fieldName);
			} else {
				seenFields.add(fieldName);
			}
		}
	}

	if (duplicateFields.length > 0) {
		throw new ApplicationError(
			`Field Update Rules Error: The following fields appear in multiple rules: ${duplicateFields.join(', ')}. ` +
			'Each field can only be configured in one rule.',
			{ level: 'warning' }
		);
	}
}

/**
 * Gets the appropriate field update rule for a field
 */
export function getFieldUpdateRule(
	fieldName: string,
	fieldUpdateRules: FieldUpdateRule[],
): FieldUpdateRule | null {
	return fieldUpdateRules.find(rule => rule.fieldNames.includes(fieldName)) || null;
}

/**
 * Processes all fields in a record according to their update strategies
 */
export async function processFieldUpdateRules(
	this: IExecuteFunctions,
	base: string,
	tableId: string,
	newFields: IDataObject,
	existingFields: IDataObject | null,
	fieldUpdateRules: FieldUpdateRule[],
): Promise<IDataObject> {
	console.log('🔍 processFieldUpdateRules called with:', {
		fieldsCount: Object.keys(newFields).length,
		rulesCount: fieldUpdateRules.length,
		hasExistingFields: !!existingFields,
		rules: fieldUpdateRules.map(r => ({ fields: r.fieldNames, strategy: r.strategy }))
	});

	// If no rules or no existing fields, return as-is
	if (!fieldUpdateRules.length || !existingFields) {
		console.log('🚫 Early return - no rules or existing fields');
		return newFields;
	}

	// Validate field update rules for conflicts
	validateFieldUpdateRules(fieldUpdateRules);

	// Get field information for the table
	const allFields = await detectAllFields.call(this, base, tableId);
	const fieldInfoMap = new Map(allFields.map(field => [field.fieldName, field]));

	const processedFields: IDataObject = {};

	for (const [fieldName, newValue] of Object.entries(newFields)) {
		const rule = getFieldUpdateRule(fieldName, fieldUpdateRules);

		console.log(`🔍 Processing field "${fieldName}":`, {
			newValue,
			existingValue: existingFields[fieldName],
			hasRule: !!rule,
			strategy: rule?.strategy
		});

		if (rule) {
			// Apply custom strategy for this field
			const fieldInfo = fieldInfoMap.get(fieldName);
			if (fieldInfo) {
				const existingValue = existingFields[fieldName];
				const result = await processFieldValue.call(
					this,
					fieldName,
					newValue,
					existingValue,
					rule.strategy,
					fieldInfo,
				);

				console.log(`✅ Field "${fieldName}" result:`, {
					shouldUpdate: result.shouldUpdate,
					processedValue: result.processedValue
				});

				if (result.shouldUpdate) {
					processedFields[fieldName] = result.processedValue;
				}
			} else {
				// Field not found in schema, use default behavior
				console.log(`⚠️ Field "${fieldName}" not found in schema, using default`);
				processedFields[fieldName] = newValue;
			}
		} else {
			// No custom rule, use default replace behavior
			console.log(`📝 Field "${fieldName}" no custom rule, using default`);
			processedFields[fieldName] = newValue;
		}
	}

	console.log('🏁 processFieldUpdateRules result:', {
		originalCount: Object.keys(newFields).length,
		processedCount: Object.keys(processedFields).length,
		processedFields
	});

	return processedFields;
}
