import type { INodeTypeBaseDescription, IVersionedNodeType } from 'n8n-workflow';
import { VersionedNodeType } from 'n8n-workflow';

import { RouterV3 } from './V3/RouterV3.implementation';

export class Router extends VersionedNodeType {
	constructor() {
		const baseDescription: INodeTypeBaseDescription = {
			displayName: 'Router',
			name: 'router',
			icon: 'fa:route',
			iconColor: 'light-blue',
			group: ['transform'],
			description: 'Route items using nested logical conditions with named outputs',
			defaultVersion: 3,
		};

		const nodeVersions: IVersionedNodeType['nodeVersions'] = {
			3: new RouterV3(baseDescription),
		};

		super(nodeVersions, baseDescription);
	}
}
