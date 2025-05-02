// Add 'group' property to INodePropertyOptions
import { INodePropertyOptions } from 'n8n-workflow';

declare module 'n8n-workflow' {
  interface INodePropertyOptions {
    group?: string;
  }
}
