import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { Ventriloquist } from '../Ventriloquist.node';

/**
 * Form operation description
 */
export const description: INodeProperties[] = [
	{
		displayName: 'Page ID',
		name: 'pageId',
		type: 'string',
		default: '',
		description: 'ID of the page to use (from a previous open operation)',
		required: true,
		displayOptions: {
			show: {
				operation: ['form'],
			},
		},
	},
	{
		displayName: 'Form Fields',
		name: 'formFields',
		placeholder: 'Add Form Field',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		default: {},
		options: [
			{
				name: 'fields',
				displayName: 'Fields',
				values: [
					{
						displayName: 'Selector',
						name: 'selector',
						type: 'string',
						default: '',
						placeholder: '#input-field, .form-control, input[name="email"]',
						description: 'CSS selector of the form field',
						required: true,
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						description: 'Value to set for the form field',
					},
				],
			},
		],
		displayOptions: {
			show: {
				operation: ['form'],
			},
		},
	},
	{
		displayName: 'Submit Form',
		name: 'submitForm',
		type: 'boolean',
		default: true,
		description: 'Whether to submit the form after filling the fields',
		displayOptions: {
			show: {
				operation: ['form'],
			},
		},
	},
	{
		displayName: 'Submit Button Selector',
		name: 'submitSelector',
		type: 'string',
		default: '',
		placeholder: 'button[type="submit"], input[type="submit"], .submit-button',
		description: 'CSS selector of the submit button',
		displayOptions: {
			show: {
				operation: ['form'],
				submitForm: [true],
			},
		},
	},
];

/**
 * Execute the form operation
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
	websocketEndpoint: string,
	workflowId: string,
): Promise<INodeExecutionData> {
	// Get parameters
	const pageId = this.getNodeParameter('pageId', index) as string;
	const formFields = this.getNodeParameter('formFields.fields', index, []) as IDataObject[];
	const submitForm = this.getNodeParameter('submitForm', index, true) as boolean;
	const submitSelector = this.getNodeParameter('submitSelector', index, '') as string;

	// Get page from session
	const page = Ventriloquist.getPage(workflowId, pageId);

	if (!page) {
		throw new Error(`Page with ID "${pageId}" not found. Please run the "Open" operation first.`);
	}

	try {
		this.logger.info('Starting form fill operation');

		// Fill each form field
		for (const field of formFields) {
			const selector = field.selector as string;
			const value = field.value as string;

			this.logger.info(`Filling field with selector: ${selector}`);

			// Wait for the element to be available
			await page.waitForSelector(selector);

			// Type text into the field
			await page.type(selector, value);

			// Add a small delay for stability
			await new Promise(resolve => setTimeout(resolve, 100));
		}

		// Submit the form if requested
		if (submitForm && submitSelector) {
			this.logger.info('Submitting the form');
			await page.click(submitSelector);

			// Wait for navigation to complete
			await page.waitForNavigation();
		}

		// Get current page info
		const currentUrl = page.url();
		const pageTitle = await page.title();

		// Return the results
		return {
			json: {
				success: true,
				operation: 'form',
				pageId,
				url: currentUrl,
				title: pageTitle,
			},
		};
	} catch (error) {
		// Handle errors
		this.logger.error(`Form operation error: ${(error as Error).message}`);

		return {
			json: {
				success: false,
				operation: 'form',
				pageId,
				error: (error as Error).message,
			},
		};
	}
}
