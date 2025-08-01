import * as puppeteer from 'puppeteer-core';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { BrowserTransport } from './BrowserTransport';
import { findChrome } from '../utils/chromeFinder';

/**
 * Transport for local Chrome browser
 */
export class LocalChromeTransport implements BrowserTransport {
  private tempUserDataDir?: string;

  constructor(
    private logger: any,
    private executablePath: string,
    private userDataDir: string,
    private headless: boolean,
    private launchArgs: string[],
    private stealthMode: boolean,
    private connectionTimeout: number,
    private connectToExisting: boolean = false,
    private debuggingPort: number = 9222,
    private windowPositioning: boolean = false,
    private windowWidth: number = 1024,
    private windowHeight: number = 768,
    private windowX: number = 100,
    private windowY: number = 100,
    private maximizeWindow: boolean = false
  ) {
    this.logger.info(`LocalChromeTransport created with executable: ${executablePath || 'auto-detect'}`);

    // Generate temporary user data directory if none provided
    if (!userDataDir && !connectToExisting) {
      this.tempUserDataDir = path.join(os.tmpdir(), `n8n-chrome-${Date.now()}`);
      this.logger.info(`Using temporary user data directory: ${this.tempUserDataDir}`);
    }

    // Always calculate screen-centered position for window regardless of window positioning setting
    try {
      const screenWidth = 1920; // Default assumption for common screen width
      const screenHeight = 1080; // Default assumption for common screen height

      // Center the window on screen by default
      this.windowX = Math.max(0, Math.floor((screenWidth - this.windowWidth) / 2));
      this.windowY = Math.max(0, Math.floor((screenHeight - this.windowHeight) / 2));

      this.logger.info(`Window position calculated as: x=${this.windowX}, y=${this.windowY}`);
    } catch (error) {
      // Fall back to default values if calculation fails
      this.logger.warn(`Failed to calculate centered window position: ${(error as Error).message}`);
    }
  }

    /**
   * Set up Chrome Preferences to disable password breach detection BEFORE Chrome launches
   * Based on expert advice: policies don't work in unmanaged Puppeteer environment
   */
  private setupChromePreferences(userDataDir: string): void {
    try {
      this.logger.info('Setting up Chrome preferences to disable password breach detection...');

      // Create the Default directory if it doesn't exist
      const defaultDir = path.join(userDataDir, 'Default');
      fs.mkdirSync(defaultDir, { recursive: true });

      const prefsPath = path.join(defaultDir, 'Preferences');

      // The EXACT structure recommended by the Chrome expert
      const preferencesContent = {
        "profile": {
          "password_manager_leak_detection": false
        },
        "credentials_enable_service": false
      };

      // Write preferences BEFORE Chrome launches (critical timing)
      fs.writeFileSync(prefsPath, JSON.stringify(preferencesContent, null, 2));
      this.logger.info(`Created Chrome preferences file: ${prefsPath}`);
      this.logger.info(`Preferences content: ${JSON.stringify(preferencesContent)}`);

      // Verify the file was created correctly
      if (fs.existsSync(prefsPath)) {
        const verification = fs.readFileSync(prefsPath, 'utf-8');
        this.logger.info('Preferences file verified and ready for Chrome launch');
      } else {
        this.logger.error('Failed to create preferences file');
      }

    } catch (error) {
      this.logger.warn(`Failed to create Chrome preferences: ${(error as Error).message}`);
      // Continue anyway - the flags should still help
    }
  }

  /**
   * Connect to a local Chrome browser
   */
  async connect(): Promise<puppeteer.Browser> {
    try {
      // If connecting to an existing Chrome instance
      if (this.connectToExisting) {
        this.logger.info(`Connecting to existing Chrome instance at debugging port: ${this.debuggingPort}`);

        // Connect to the existing Chrome instance
        const browser = await puppeteer.connect({
          browserURL: `http://localhost:${this.debuggingPort}`,
          defaultViewport: {
            width: this.windowWidth,
            height: this.windowHeight
          }
        });

        this.logger.info('Successfully connected to existing Chrome instance');
        return browser;
      }

      // Otherwise, launch a new Chrome instance
      // Determine the Chrome executable path
      const chromeInfo = await findChrome(this.executablePath);
      this.logger.info(`Using ${chromeInfo.type} browser at: ${chromeInfo.executablePath}`);

      if (chromeInfo.version) {
        this.logger.info(`Browser version: ${chromeInfo.version}`);
      }

      // Create launch arguments
      const puppeteerArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        ...this.launchArgs
      ];

      // Always apply window sizing args for non-headless mode
      if (!this.headless) {
        // Always use specific window size and position
        const windowSizeArg = `--window-size=${this.windowWidth},${this.windowHeight}`;
        const windowPositionArg = `--window-position=${this.windowX},${this.windowY}`;

        // Check if these args are already included
        if (!puppeteerArgs.some(arg => arg.startsWith('--window-size'))) {
          puppeteerArgs.push(windowSizeArg);
        }

        if (!puppeteerArgs.some(arg => arg.startsWith('--window-position'))) {
          puppeteerArgs.push(windowPositionArg);
        }

        this.logger.info(`Setting window position and size: ${windowPositionArg} ${windowSizeArg}`);
      }

      // Apply stealth mode settings if enabled
      if (this.stealthMode) {
        puppeteerArgs.push(
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-site-isolation-trials'
        );
      }

            // Add the SPECIFIC flags recommended by Chrome expert
      puppeteerArgs.push(
        // THE KEY FLAG - disables password leak detection UI specifically
        '--enable-features=WebUIDisableLeakDetection',

        // Supporting flags to disable related features
        '--disable-features=PasswordLeakDetection',
        '--disable-features=AutofillServerCommunication',
        '--disable-features=AutofillEnableSaveCard',

        // Keep some existing useful flags
        '--disable-password-generation',
        '--disable-password-manager-reauthentication',
        '--disable-default-browser-check',
        '--disable-first-run-ui'
      );

      // Set up Chrome preferences to disable password breach detection BEFORE launch
      const effectiveUserDataDir = this.userDataDir || this.tempUserDataDir;
      if (effectiveUserDataDir) {
        this.setupChromePreferences(effectiveUserDataDir);
      }

      this.logger.info(`Launching Chrome with args: ${puppeteerArgs.join(' ')}`);
      this.logger.info(`Key flags for password prevention: ${puppeteerArgs.filter(arg => arg.includes('WebUIDisableLeakDetection') || arg.includes('PasswordLeakDetection')).join(', ')}`);

      // Launch the browser
      const browser = await puppeteer.launch({
        executablePath: chromeInfo.executablePath,
        headless: this.headless,
        args: puppeteerArgs,
        timeout: this.connectionTimeout,
        userDataDir: this.userDataDir || this.tempUserDataDir,
        // Newer versions may not support this, but we can use a cast to any
        // @ts-ignore - ignoreHTTPSErrors not in type definition but supported by puppeteer
        ignoreHTTPSErrors: true,
        defaultViewport: {
          width: this.windowWidth,
          height: this.windowHeight
        }
      });

      // Apply additional stealth measures
      if (this.stealthMode) {
        this.logger.info('Applying stealth mode optimizations for all new pages');

        // Listen for new pages and apply stealth measures
        browser.on('targetcreated', async (target) => {
          try {
            const targetPage = await target.page();
            if (targetPage) {
              // Apply stealth mode per page
              await this.applyStealthMode(targetPage);
            }
          } catch (e) {
            // Ignore errors from non-page targets
          }
        });
      }

      this.logger.info('Chrome browser launched successfully');
      return browser;
    } catch (error) {
      this.logger.error(`Failed to connect to Chrome: ${(error as Error).message}`);
      throw new Error(`Failed to connect to Chrome: ${(error as Error).message}`);
    }
  }

  /**
   * Navigate to a URL
   */
  async navigateTo(
    page: puppeteer.Page,
    url: string,
    options: puppeteer.WaitForOptions & {
      waitUntil?: puppeteer.PuppeteerLifeCycleEvent | puppeteer.PuppeteerLifeCycleEvent[];
    },
  ): Promise<{ response: puppeteer.HTTPResponse | null; domain: string }> {
    this.logger.info(`Navigating to: ${url}`);

    // Set default timeout from our connection timeout
    page.setDefaultTimeout(this.connectionTimeout);

    // Apply stealth mode if enabled
    if (this.stealthMode) {
      await this.applyStealthMode(page);
    }

    try {
      // Navigate to the URL
      const response = await page.goto(url, options);

      // Extract domain for logging
      let domain = 'unknown';
      try {
        const urlObj = new URL(url);
        domain = urlObj.hostname;
      } catch (e) {
        // Ignore URL parsing errors
      }

      this.logger.info(`Navigation completed to domain: ${domain}`);
      return { response, domain };
    } catch (error) {
      this.logger.error(`Navigation failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Get page information
   */
  async getPageInfo(
    page: puppeteer.Page,
    response: puppeteer.HTTPResponse | null,
  ): Promise<{
    url: string;
    title: string;
    status: number | null;
  }> {
    try {
      const url = page.url();
      const title = await page.title();
      const status = response ? response.status() : null;

      return { url, title, status };
    } catch (error) {
      this.logger.error(`Failed to get page info: ${(error as Error).message}`);
      return {
        url: 'unknown',
        title: 'unknown',
        status: null,
      };
    }
  }

  /**
   * Take a screenshot of the page
   */
  async takeScreenshot(page: puppeteer.Page): Promise<string> {
    try {
      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 80,
        fullPage: false,
        encoding: 'base64'
      });

      return `data:image/jpeg;base64,${screenshot}`;
    } catch (error) {
      this.logger.error(`Failed to take screenshot: ${(error as Error).message}`);
      return '';
    }
  }

  /**
   * Apply stealth mode to a page to avoid detection
   */
  private async applyStealthMode(page: puppeteer.Page): Promise<void> {
    try {
      // Override user agent to make it look more like a real browser
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Override navigator.webdriver property and other browser fingerprinting
      await page.evaluateOnNewDocument(() => {
        // Safely handle webdriver property - check if it can be redefined
        try {
          if ('webdriver' in navigator) {
            // Try to delete first, then redefine
            delete (navigator as any).webdriver;
          }
          Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
            configurable: true,
          });
        } catch (e) {
          // If we can't redefine it, try to just set it directly
          try {
            (navigator as any).webdriver = false;
          } catch (e2) {
            // Ignore if we can't override at all - some sites lock this down
            console.log('Could not override webdriver property');
          }
        }

        // Modify plugins array
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            {
              description: "Portable Document Format",
              filename: "internal-pdf-viewer",
              name: "Chrome PDF Plugin"
            },
            {
              description: "PDF Viewer",
              filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
              name: "Chrome PDF Viewer"
            },
            {
              description: "PDF Viewer",
              filename: "pdf",
              name: "PDF Viewer"
            }
          ],
        });

        // Modify languages array
        Object.defineProperty(navigator, 'languages', {
          get: () => ["en-US", "en"],
        });

        // Add chrome property to window if it doesn't exist
        // @ts-ignore - we know window.chrome might not exist in the type system
        if (typeof window.chrome === 'undefined') {
          // @ts-ignore - intentionally adding untyped property
          window.chrome = {
            app: {
              isInstalled: false,
            },
            runtime: {},
          };
        }
      });
    } catch (error) {
      this.logger.warn(`Failed to apply stealth mode: ${(error as Error).message}`);
    }
  }
}
