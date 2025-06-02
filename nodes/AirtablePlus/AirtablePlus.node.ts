import type { INodeTypeBaseDescription, IVersionedNodeType } from 'n8n-workflow';
import { VersionedNodeType } from 'n8n-workflow';

import { AirtableV1 } from './v1/AirtableV1.node';
import { AirtableV2 } from './v2/AirtableV2.node';

export class AirtablePlus extends VersionedNodeType {
	constructor() {
		const baseDescription: INodeTypeBaseDescription = {
			displayName: 'Airtable Plus',
			name: 'airtablePlus',
			icon: 'file:airtable.svg',
			group: ['input'],
			description: 'Enhanced Airtable node with additional features for reading, updating, writing and deleting data',
			defaultVersion: 2.1,
		};

		const nodeVersions: IVersionedNodeType['nodeVersions'] = {
			1: new AirtableV1(baseDescription),
			2: new AirtableV2(baseDescription),
			2.1: new AirtableV2(baseDescription),
		};

		super(nodeVersions, baseDescription);
	}
}
