#!/usr/bin/env node
/**
 * Simple utility to test Browserless connections
 * Usage: node testBrowserlessConnection.js "wss://browserless-domain.railway.app?token=YOUR_TOKEN"
 */

const WebSocket = require('ws');

// Get the WebSocket URL from command line
const wsUrl = process.argv[2];

if (!wsUrl) {
  console.error('Please provide a WebSocket URL as a parameter');
  console.error('Example: node testBrowserlessConnection.js "wss://browserless-domain.railway.app?token=YOUR_TOKEN"');
  process.exit(1);
}

console.log(`Testing connection to: ${wsUrl.replace(/token=([^&]+)/, 'token=***TOKEN***')}`);

// Create WebSocket connection
const ws = new WebSocket(wsUrl);

// Set timeout for the test
const timeout = setTimeout(() => {
  console.error('❌ Connection test FAILED: Timeout after 10 seconds');
  ws.terminate();
  process.exit(1);
}, 10000);

// Connection opened
ws.on('open', () => {
  console.log('✅ Connection test SUCCESSFUL');
  clearTimeout(timeout);
  ws.close();
  process.exit(0);
});

// Connection error
ws.on('error', (err) => {
  console.error(`❌ Connection test FAILED: ${err.message}`);
  clearTimeout(timeout);
  process.exit(1);
});

// Connection closed
ws.on('close', (code, reason) => {
  if (code !== 1000) { // 1000 is normal closure
    console.warn(`WebSocket closed with code ${code}: ${reason}`);
  }
});
