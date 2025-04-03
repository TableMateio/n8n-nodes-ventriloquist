# Setting Up Browserless on Railway

This guide will help you configure a Browserless instance on Railway for use with the Ventriloquist n8n node.

## 1. Deploy Browserless on Railway

1. Create a new project on Railway
2. Use the Browserless template or deploy from the Docker image `browserless/chrome`
3. Wait for the deployment to complete

## 2. Required Environment Variables

Set these environment variables in your Railway project:

| Variable | Value | Description |
|----------|-------|-------------|
| `TOKEN` | (generate a secure token) | Authentication token for Browserless |
| `WORKSPACE_EXPIRE_DAYS` | `1` | Expire workspaces after 1 day |
| `ENABLE_DEBUGGER` | `false` | Disable debugger for better performance |
| `ENABLE_XVFB` | `false` | Not needed for headless operation |
| `DEFAULT_BLOCK_ADS` | `true` | Block ads by default for better performance |
| `DEFAULT_STEALTH` | `true` | Enable stealth mode by default |
| `CONNECTION_TIMEOUT` | `120000` | Connection timeout in ms (2 minutes) |
| `MAX_CONCURRENT_SESSIONS` | `5` | Maximum concurrent browser sessions |
| `PRE_REQUEST_HEALTH_CHECK` | `true` | Check browser health before requests |
| `CHROME_REFRESH_TIME` | `3600000` | Refresh Chrome every hour (1h in ms) |
| `EXIT_ON_HEALTH_FAILURE` | `true` | Exit on health check failure |

## 3. Using with Ventriloquist Node

### Direct WebSocket URL Method (Recommended)

1. In n8n, create a new "Browserless API" credential
2. Select "Direct WebSocket URL (Railway)" as connection type
3. Copy the WebSocket URL from Railway: `wss://your-browserless-app.up.railway.app?token=YOUR_TOKEN`
   - Find this in your Railway project, under the "Variables" tab
   - Look for the `BROWSER_WS_ENDPOINT` variable (if it exists)
   - If not, construct it manually using your app's domain and TOKEN value
4. Test the connection with: `pnpm run test:browserless "your-websocket-url"`

### Standard Connection Method (Alternative)

1. In n8n, create a new "Browserless API" credential
2. Select "Standard (Domain + Token)" as connection type
3. Set the Token to your Railway TOKEN value
4. Set the Base URL to just your domain (e.g., `browserless-production-xxxx.up.railway.app`)
5. Set Request Timeout to 120000 (2 minutes) for ample time to handle complex pages
6. Enable Stealth Mode

## 4. Troubleshooting

If you encounter connection issues:

1. Verify the TOKEN value is correct
2. Make sure your Railway instance is running (check the deployment logs)
3. Test the direct WebSocket connection using our test utility
4. Check if your Railway plan has enough resources allocated
5. Verify your Railway instance hasn't hit concurrency limits 
