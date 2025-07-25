import type {
	IDataObject,
	INodeExecutionData,
	INodeProperties,
	IPairedItemData,
} from 'n8n-workflow';

/**
 * Updates the display options of node properties with the provided options
 */
export function updateDisplayOptions(
	displayOptions: IDataObject,
	properties: INodeProperties[],
): INodeProperties[] {
	return properties.map((property) => ({
		...property,
		displayOptions: {
			...property.displayOptions,
			...displayOptions,
		},
	}));
}

/**
 * Wraps data in the format expected by n8n execution
 */
export function wrapData(data: IDataObject[]): INodeExecutionData[] {
	return data.map((item) => ({
		json: item,
	}));
}

/**
 * Generates paired item data for tracking item relationships
 */
export function generatePairedItemData(inputLength: number): IPairedItemData[] {
	return Array.from({ length: inputLength }, (_, index) => ({ item: index }));
}

/**
 * Deep merge two objects, combining nested objects instead of overwriting them
 * Later object properties take precedence over earlier ones for conflicts
 *
 * @param target - The target object (will be modified)
 * @param source - The source object to merge into target
 * @returns The merged object
 */
export function deepMerge(target: IDataObject, source: IDataObject): IDataObject {
	// Handle null/undefined cases
	if (!target || typeof target !== 'object') {
		return source || {};
	}
	if (!source || typeof source !== 'object') {
		return target;
	}

	// Create a copy to avoid modifying the original target
	const result = { ...target };

	for (const key in source) {
		if (source.hasOwnProperty(key)) {
			const sourceValue = source[key];
			const targetValue = result[key];

			// If both values are objects (and not arrays), merge them recursively
			if (
				sourceValue &&
				typeof sourceValue === 'object' &&
				!Array.isArray(sourceValue) &&
				targetValue &&
				typeof targetValue === 'object' &&
				!Array.isArray(targetValue)
			) {
				result[key] = deepMerge(targetValue as IDataObject, sourceValue as IDataObject);
			} else {
				// Otherwise, the source value overwrites the target value
				result[key] = sourceValue;
			}
		}
	}

	return result;
}

/**
 * Helper function for merging input data with output data in operations
 * This ensures nested objects are merged instead of overwritten
 *
 * @param inputData - Input data from previous node (or empty object if not included)
 * @param outputData - Output data from current operation
 * @returns Merged data object
 */
export function mergeInputWithOutput(inputData: IDataObject, outputData: IDataObject): IDataObject {
	return deepMerge(inputData, outputData);
}
