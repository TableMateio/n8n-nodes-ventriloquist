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
