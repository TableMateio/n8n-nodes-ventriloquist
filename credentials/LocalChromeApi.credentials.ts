import type {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class LocalChromeApi implements ICredentialType {
	name = 'localChromeApi';

	displayName = 'Local Chrome Browser API';

	documentationUrl = '';

	properties: INodeProperties[] = [
		{
			displayName: 'Chrome Executable Path',
			name: 'executablePath',
			type: 'string',
			default: '',
			placeholder: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
			description: 'Path to Chrome executable. Leave empty for auto-detection based on your operating system.',
			required: false,
		},
		{
			displayName: 'Headless Mode',
			name: 'headless',
			type: 'boolean',
			default: true,
			description: 'Whether to run Chrome without a visible UI (headless mode)',
			required: false,
		},
		{
			displayName: 'User Data Directory',
			name: 'userDataDir',
			type: 'string',
			default: '',
			placeholder: '/path/to/user/data/dir',
			description: 'Directory to store user data (cookies, cache, etc). Leave empty to use a temporary directory.',
			required: false,
		},
		{
			displayName: 'Launch Arguments',
			name: 'launchArgs',
			type: 'string',
			default: '--no-sandbox,--disable-setuid-sandbox',
			placeholder: '--window-size=1920,1080,--disable-gpu',
			description: 'Comma-separated Chrome launch arguments',
			required: false,
		},
		{
			displayName: 'Request Timeout',
			name: 'connectionTimeout',
			type: 'number',
			default: 120000,
			description: 'Maximum time in milliseconds to wait for individual operations like navigation, clicks, or screenshot capture.',
			required: false,
		},
		{
			displayName: 'Stealth Mode',
			name: 'stealthMode',
			type: 'boolean',
			default: true,
			description: 'Whether to use stealth mode to avoid bot detection. Recommended for most web scraping tasks.',
			required: false,
		},
		{
			displayName: 'Note: Local Chrome',
			name: 'localChromeNote',
			type: 'notice',
			default: 'Local Chrome uses your installed Chrome/Chromium browser. For Mac, Windows and Linux, common installation paths are checked automatically if no path is provided.',
		},
	];
}
