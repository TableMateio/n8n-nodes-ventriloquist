const puppeteer = require('puppeteer');

const N8N_BASE_URL = 'https://localhost:5678';
const WORKFLOW_ID = 'YLEey8jT0fN0ovOl'; // The workflow we want to test
const WORKFLOW_URL = `${N8N_BASE_URL}/workflow/${WORKFLOW_ID}`;
const TEST_BUTTON_SELECTOR = '[data-test-id="execute-workflow-button"]';
const VIEW_EXECUTION_SELECTOR = '[data-test-id="view-execution-button"]'; // Selector to wait for after test starts
const FIRST_WORKFLOW_CARD_SELECTOR = '[data-test-id="resources-list-item"]'; // Selector for first workflow card on dashboard

// Define the auth cookie N8N uses for dev auto-login
const AUTH_COOKIE = {
  name: 'n8n-auth',
  value: 'dev-auto-login',
  domain: 'localhost', // Match the domain N8N is running on
  url: N8N_BASE_URL, // Required if setting cookie before navigating to the domain
  path: '/',
  httpOnly: false, // Needs to be accessible like a browser-set cookie
  secure: true,    // Because N8N is running on HTTPS
  sameSite: 'Lax'  // Standard policy
};

(async () => {
  let browser = null;
  try {
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: false, // Run in non-headless mode to see the browser
      ignoreHTTPSErrors: true, // Ignore self-signed cert error for localhost
      args: ['--start-maximized'], // Optional: Start maximized
      defaultViewport: null // Optional: Use host machine viewport
    });

    const page = await browser.newPage();
    console.log('New page created.');

    // Optional: Log console messages from the browser page
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    // Go to base URL first
    console.log(`Opening base page: ${N8N_BASE_URL}`);
    await page.goto(N8N_BASE_URL, {
      waitUntil: 'networkidle0',
      timeout: 60000
    });
    console.log('Base page loaded (might be login page).');

    // Set the authentication cookie
    console.log('Setting development authentication cookie...');
    await page.setCookie(AUTH_COOKIE);
    console.log('Authentication cookie set.');

    // Reload the page to apply the cookie
    console.log('Reloading page after setting cookie...');
    await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"], timeout: 60000 });
    console.log('Page reloaded (should be dashboard or similar).');

    // Wait for the dashboard/workflow list to appear after reload
    console.log(`Waiting for dashboard element (${FIRST_WORKFLOW_CARD_SELECTOR}) to ensure login worked...`);
    await page.waitForSelector(FIRST_WORKFLOW_CARD_SELECTOR, { visible: true, timeout: 30000 });
    console.log('Dashboard element found.');

    // Now navigate to the specific workflow URL
    console.log(`Navigating to workflow: ${WORKFLOW_URL}`);
    await page.goto(WORKFLOW_URL, {
      waitUntil: 'networkidle2', // Wait until network is mostly idle
      timeout: 90000 // Increased timeout
    });
    console.log('Workflow page loaded.');

    console.log(`Waiting for Test Workflow button: ${TEST_BUTTON_SELECTOR}`);
    // Increased timeout for waiting for the button
    await page.waitForSelector(TEST_BUTTON_SELECTOR, { visible: true, timeout: 90000 });
    console.log('Test Workflow button found.');

    // Click body to ensure focus
    console.log('Clicking body to ensure focus...');
    await page.click('body'); // Click the body element for focus
    await new Promise(resolve => setTimeout(resolve, 500)); // Small delay after click

    console.log('Pressing Cmd+Enter to Test Workflow...');
    await page.keyboard.down('Meta'); // 'Meta' corresponds to Command on macOS
    await page.keyboard.press('Enter');
    await page.keyboard.up('Meta');
    console.log('Cmd+Enter pressed.');

    // Wait for the 'View Execution' button to appear, indicating the test has started running
    console.log(`Waiting for execution to start (looking for ${VIEW_EXECUTION_SELECTOR})...`);
    await page.waitForSelector(VIEW_EXECUTION_SELECTOR, { visible: true, timeout: 30000 }); // Increased timeout
    console.log('Execution seems to have started.');

    // Keep browser open for a bit longer to observe or allow backend logs to catch up
    console.log('Waiting for 30 seconds before closing...');
    await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds

    console.log('Test sequence complete (browser interaction). Check N8N logs for detailed execution status.');

  } catch (error) {
    console.error('Error during Puppeteer test script:', error);
  } finally {
    if (browser) {
      console.log('Closing browser...');
      await browser.close();
      console.log('Browser closed.');
    }
  }
})();
