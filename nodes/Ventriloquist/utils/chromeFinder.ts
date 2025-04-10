import { existsSync } from 'fs';
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';

/**
 * Information about a found Chrome installation
 */
export interface ChromeInfo {
  executablePath: string;
  type: 'chrome' | 'chromium' | 'edge' | 'custom';
  version?: string;
}

/**
 * Find Chrome installations on the system
 * @returns Information about the found Chrome installation
 * @throws Error if no Chrome installation is found
 */
export async function findChrome(customPath?: string): Promise<ChromeInfo> {
  // If a custom path is provided, verify it exists
  if (customPath) {
    if (existsSync(customPath)) {
      return {
        executablePath: customPath,
        type: 'custom',
      };
    } else {
      throw new Error(`Custom Chrome path does not exist: ${customPath}`);
    }
  }

  const platform = os.platform();

  // Common Chrome locations by platform
  const chromePaths = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/snap/bin/chromium',
    ],
  };

  // Try specifically supported platforms first
  const paths = chromePaths[platform as keyof typeof chromePaths] || [];

  // Find first existing path
  for (const browserPath of paths) {
    if (existsSync(browserPath)) {
      const type = getBrowserType(browserPath);

      try {
        // Try to get version for additional info
        let version: string | undefined;

        if (platform === 'darwin' || platform === 'linux') {
          const result = execSync(`"${browserPath}" --version`, { timeout: 2000 }).toString().trim();
          version = result.match(/[\d.]+/)?.[0];
        } else if (platform === 'win32') {
          const result = execSync(`wmic datafile where name="${browserPath.replace(/\\/g, '\\\\')}" get Version /value`, { timeout: 2000 }).toString().trim();
          version = result.match(/Version=(.+)/)?.[1];
        }

        return {
          executablePath: browserPath,
          type,
          version,
        };
      } catch (e) {
        // If version detection fails, still return the path
        return {
          executablePath: browserPath,
          type,
        };
      }
    }
  }

  // If we reached here, we couldn't find Chrome
  throw new Error(`Could not find Chrome or Chromium on this system (${platform}). Please specify the path manually.`);
}

/**
 * Determine browser type from executable path
 */
function getBrowserType(path: string): ChromeInfo['type'] {
  const lowercasePath = path.toLowerCase();

  if (lowercasePath.includes('edge')) {
    return 'edge';
  } else if (lowercasePath.includes('chromium')) {
    return 'chromium';
  } else {
    return 'chrome';
  }
}
