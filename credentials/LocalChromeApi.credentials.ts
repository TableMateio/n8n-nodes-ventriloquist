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
			default: '--no-sandbox,--disable-setuid-sandbox,--disable-features=PasswordManager,--disable-password-manager-reauthentication,--disable-save-password-bubble,--disable-password-generation,--disable-features=SafeBrowsing,--disable-web-security,--disable-features=VizDisplayCompositor,--disable-password-breach-detection,--disable-component-update,--disable-background-networking,--disable-sync,--disable-default-apps,--disable-extensions,--no-default-browser-check,--no-first-run,--disable-popup-blocking,--disable-notifications,--disable-infobars,--disable-translate,--disable-ipc-flooding-protection,--disable-renderer-backgrounding,--disable-backgrounding-occluded-windows,--disable-features=TranslateUI,--disable-features=Translate,--disable-domain-reliability,--disable-client-side-phishing-detection,--disable-background-timer-throttling,--disable-features=PasswordProtection',
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
			displayName: 'Connect to Existing Instance',
			name: 'connectToExisting',
			type: 'boolean',
			default: false,
			description: 'Whether to connect to an existing Chrome instance instead of launching a new one',
			required: false,
		},
		{
			displayName: 'Remote Debugging Host',
			name: 'debuggingHost',
			type: 'string',
			default: 'localhost',
			placeholder: 'localhost or host.docker.internal',
			description: 'Hostname of the Chrome instance. Use "host.docker.internal" when running n8n in Docker and Chrome on your host machine.',
			required: false,
			displayOptions: {
				show: {
					connectToExisting: [true],
				},
			},
		},
		{
			displayName: 'Remote Debugging Port',
			name: 'debuggingPort',
			type: 'number',
			default: 9222,
			description: 'Port number of existing Chrome instance with remote debugging enabled. Chrome must be started with --remote-debugging-port=9222',
			required: false,
			displayOptions: {
				show: {
					connectToExisting: [true],
				},
			},
		},
		{
			displayName: 'Window Position and Size',
			name: 'windowPositioning',
			type: 'boolean',
			default: false,
			description: 'Whether to specify window position and size for the Chrome window',
			required: false,
			displayOptions: {
				show: {
					headless: [false],
				},
			},
		},
		{
			displayName: 'Maximize Window',
			name: 'maximizeWindow',
			type: 'boolean',
			default: false,
			description: 'Start Chrome with a maximized window',
			required: false,
			displayOptions: {
				show: {
					headless: [false],
					windowPositioning: [false],
				},
			},
		},
		{
			displayName: 'Window Width',
			name: 'windowWidth',
			type: 'number',
			default: 1024,
			description: 'Width of the browser window in pixels',
			required: false,
			displayOptions: {
				show: {
					headless: [false],
					windowPositioning: [true],
				},
			},
		},
		{
			displayName: 'Window Height',
			name: 'windowHeight',
			type: 'number',
			default: 768,
			description: 'Height of the browser window in pixels',
			required: false,
			displayOptions: {
				show: {
					headless: [false],
					windowPositioning: [true],
				},
			},
		},
		{
			displayName: 'Window X Position',
			name: 'windowX',
			type: 'number',
			default: 100,
			description: 'X coordinate of the browser window (0 is the left edge of the screen)',
			required: false,
			displayOptions: {
				show: {
					headless: [false],
					windowPositioning: [true],
				},
			},
		},
		{
			displayName: 'Window Y Position',
			name: 'windowY',
			type: 'number',
			default: 100,
			description: 'Y coordinate of the browser window (0 is the top edge of the screen)',
			required: false,
			displayOptions: {
				show: {
					headless: [false],
					windowPositioning: [true],
				},
			},
		},
		{
			displayName: 'Note: Local Chrome',
			name: 'localChromeNote',
			type: 'notice',
			default: 'Local Chrome uses your installed Chrome/Chromium browser. For Mac, Windows and Linux, common installation paths are checked automatically if no path is provided.',
		},
		{
			displayName: 'Note: Existing Chrome',
			name: 'existingChromeNote',
			type: 'notice',
			default: 'To connect to an existing Chrome instance, start Chrome with: chrome --remote-debugging-port=9222 --user-data-dir=/path/to/data',
			displayOptions: {
				show: {
					connectToExisting: [true],
				},
			},
		},
	];
}
