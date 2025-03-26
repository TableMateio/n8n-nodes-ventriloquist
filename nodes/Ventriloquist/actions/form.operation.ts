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
						displayName: 'Field Type',
						name: 'fieldType',
						type: 'options',
						options: [
							{
								name: 'Text',
								value: 'text',
							},
							{
								name: 'Checkbox',
								value: 'checkbox',
							},
							{
								name: 'Select',
								value: 'select',
							},
						],
						default: 'text',
						description: 'The type of form field',
					},
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
						displayOptions: {
							show: {
								fieldType: ['text', 'select'],
							},
						},
					},
					{
						displayName: 'Check',
						name: 'checked',
						type: 'boolean',
						default: true,
						description: 'Whether to check or uncheck the checkbox',
						displayOptions: {
							show: {
								fieldType: ['checkbox'],
							},
						},
					},
					{
						displayName: 'Delay After',
						name: 'delayAfter',
						type: 'number',
						default: 100,
						description: 'Delay in ms after setting this field (simulates human behavior)',
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
	{
		displayName: 'Take Screenshot After Submission',
		name: 'takeScreenshot',
		type: 'boolean',
		default: false,
		description: 'Whether to take a screenshot after form submission',
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
	const takeScreenshot = this.getNodeParameter('takeScreenshot', index, false) as boolean;

	// Get page from session
	const page = Ventriloquist.getPage(workflowId, pageId);

	if (!page) {
		throw new Error(`Page with ID "${pageId}" not found. Please run the "Open" operation first.`);
	}

	try {
		this.logger.info('Starting form fill operation');
		const results: IDataObject[] = [];

		// Fill each form field
		for (const field of formFields) {
			const fieldType = field.fieldType as string;
			const selector = field.selector as string;
			const delayAfter = field.delayAfter as number || 100;

			this.logger.info(`Processing ${fieldType} field with selector: ${selector}`);

			// Wait for the element to be available
			await page.waitForSelector(selector);

			// Handle different field types
			switch (fieldType) {
				case 'text': {
					const value = field.value as string;
					// Type text into the field
					await page.type(selector, value);
					break;
				}

				case 'select': {
					const value = field.value as string;
					// Select an option from dropdown
					await page.select(selector, value);
					break;
				}

				case 'checkbox': {
					const checked = field.checked as boolean;
					// Get current checked state
					const currentChecked = await page.evaluate((sel: string) => {
						const element = document.querySelector(sel);
						return element ? (element as HTMLInputElement).checked : false;
					}, selector);

					// Only click if the current state doesn't match desired state
					if (currentChecked !== checked) {
						await page.click(selector);
					}
					break;
				}
			}

			// Record the result
			results.push({
				fieldType,
				selector,
				success: true,
			});

			// Add delay to simulate human interaction
			if (delayAfter > 0) {
				await new Promise(resolve => setTimeout(resolve, delayAfter));
			}
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

		// Take a screenshot if requested
		let screenshot = '';
		if (takeScreenshot) {
			const screenshotBuffer = await page.screenshot({
				encoding: 'base64',
				type: 'jpeg',
				quality: 80,
			});

			screenshot = `data:image/jpeg;base64,${screenshotBuffer}`;
		}

		// Return the results
		return {
			json: {
				success: true,
				operation: 'form',
				pageId,
				url: currentUrl,
				title: pageTitle,
				formFields: results,
				submitted: submitForm,
				timestamp: new Date().toISOString(),
				screenshot,
			},
		};
	} catch (error) {
		// Handle errors
		this.logger.error(`Form operation error: ${(error as Error).message}`);

		// Take error screenshot if requested
		let screenshot = '';
		if (takeScreenshot && page) {
			try {
				const screenshotBuffer = await page.screenshot({
					encoding: 'base64',
					type: 'jpeg',
					quality: 80,
				});
				screenshot = `data:image/jpeg;base64,${screenshotBuffer}`;
			} catch {
				// Ignore screenshot errors
			}
		}

		return {
			json: {
				success: false,
				operation: 'form',
				pageId,
				error: (error as Error).message,
				timestamp: new Date().toISOString(),
				screenshot,
			},
		};
	}
}
