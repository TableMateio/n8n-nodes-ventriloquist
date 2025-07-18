import type { IDataObject } from 'n8n-workflow';

export interface IAttachment {
	url: string;
	filename: string;
	type: string;
}

export interface IRecord {
	fields: {
		[key: string]: string | IAttachment[];
	};
}

export type UpdateRecord = {
	fields: IDataObject;
	id?: string;
};
export type UpdateBody = {
	records: UpdateRecord[];
	performUpsert?: {
		fieldsToMergeOn: string[];
	};
	typecast?: boolean;
};

export type FieldUpdateStrategy =
	| 'replace'
	| 'preserveExisting'
	| 'replaceUnlessNull'
	| 'append'
	| 'union';

export interface FieldUpdateRule {
	fieldNames: string[];
	strategy: FieldUpdateStrategy;
}

export interface FieldUpdateOptions {
	fieldUpdateStrategy: 'standard' | 'custom';
	fieldUpdateRules?: {
		rules: FieldUpdateRule[];
	};
}
