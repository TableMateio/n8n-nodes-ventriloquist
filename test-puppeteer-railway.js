#!/usr/bin/env node
/**
 * Simple script to test Puppeteer connection to Browserless on Railway
 * Usage: node test-puppeteer-railway.js
 */

const puppeteer = require('puppeteer-core');

// Replace with your WebSocket URL
const wsUrl = 'wss://browserless-production-2a8f.up.railway.app?token=8laRXWn6OtaJL51zdKbrfbeERbrwWh41m6YhzSJRfkuiLmh1';

async function testConnection() {
  console.log(`Testing Puppeteer connection to: ${wsUrl.replace(/token=([^&]+)/, 'token=***TOKEN***')}`);

  // Add Railway-specific options to improve connection success
  const railwayOptions = [
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-setuid-sandbox',
    '--no-sandbox',
    'stealth'
  ];

  // Build the complete WebSocket URL with options
  let fullWsUrl = wsUrl;
  for (const option of railwayOptions) {
    if (!fullWsUrl.includes(option)) {
      fullWsUrl += `&${option}`;
    }
  }

  console.log('Using enhanced WebSocket URL with Railway options');

  try {
    // Connect to the browser
    console.log('Connecting to browser...');
    const browser = await puppeteer.connect({
      browserWSEndpoint: fullWsUrl,
      defaultViewport: { width: 1920, height: 1080 }
    });

    console.log('✅ Successfully connected to browser!');

    // Create a new page
    console.log('Creating new page...');
    const page = await browser.newPage();
    console.log('✅ Page created successfully');

    // Set a user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    // Navigate to a test page
    console.log('Navigating to example.com...');
    try {
      await page.goto('https://example.com', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      console.log('✅ Navigation successful');

      // Get page title
      const title = await page.title();
      console.log(`Page title: ${title}`);

      // Take a screenshot
      const screenshotBuffer = await page.screenshot({ type: 'jpeg' });
      console.log(`Screenshot taken (${screenshotBuffer.length} bytes)`);

    } catch (navError) {
      console.error(`❌ Navigation error: ${navError.message}`);
    }

    // Close browser
    console.log('Closing connection...');
    await browser.close();
    console.log('Browser connection closed');

  } catch (error) {
    console.error(`❌ Connection failed: ${error.message}`);
    console.error(error.stack);
  }
}

testConnection().catch(console.error);
