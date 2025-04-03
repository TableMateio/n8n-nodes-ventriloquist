![Banner image](https://user-images.githubusercontent.com/10284570/173569848-c624317f-42b1-45a6-ab09-f0ea3c247648.png)

# n8n-nodes-starter

This repo contains example nodes to help you get started building your own custom integrations for [n8n](n8n.io). It includes the node linter and other dependencies.

To make your custom node available to the community, you must create it as an npm package, and [submit it to the npm registry](https://docs.npmjs.com/packages-and-modules/contributing-packages-to-the-registry).

## Prerequisites

You need the following installed on your development machine:

* [git](https://git-scm.com/downloads)
* Node.js and pnpm. Minimum version Node 18. You can find instructions on how to install both using nvm (Node Version Manager) for Linux, Mac, and WSL [here](https://github.com/nvm-sh/nvm). For Windows users, refer to Microsoft's guide to [Install NodeJS on Windows](https://docs.microsoft.com/en-us/windows/dev-environment/javascript/nodejs-on-windows).
* Install n8n with:
  ```
  pnpm install n8n -g
  ```
* Recommended: follow n8n's guide to [set up your development environment](https://docs.n8n.io/integrations/creating-nodes/build/node-development-environment/).

## Using this starter

These are the basic steps for working with the starter. For detailed guidance on creating and publishing nodes, refer to the [documentation](https://docs.n8n.io/integrations/creating-nodes/).

1. [Generate a new repository](https://github.com/n8n-io/n8n-nodes-starter/generate) from this template repository.
2. Clone your new repo:
   ```
   git clone https://github.com/<your organization>/<your-repo-name>.git
   ```
3. Run `pnpm i` to install dependencies.
4. Open the project in your editor.
5. Browse the examples in `/nodes` and `/credentials`. Modify the examples, or replace them with your own nodes.
6. Update the `package.json` to match your details.
7. Run `pnpm lint` to check for errors or `pnpm lintfix` to automatically fix errors when possible.
8. Test your node locally. Refer to [Run your node locally](https://docs.n8n.io/integrations/creating-nodes/test/run-node-locally/) for guidance.
9. Replace this README with documentation for your node. Use the [README_TEMPLATE](README_TEMPLATE.md) to get started.
10. Update the LICENSE file to use your details.
11. [Publish](https://docs.npmjs.com/packages-and-modules/contributing-packages-to-the-registry) your package to npm.

## More information

Refer to our [documentation on creating nodes](https://docs.n8n.io/integrations/creating-nodes/) for detailed information on building your own nodes.

## License

[MIT](https://github.com/n8n-io/n8n-nodes-starter/blob/master/LICENSE.md)

## Ventriloquist

The Ventriloquist node is an advanced browser automation tool for n8n that allows you to perform web scraping, form filling, clicking, and extracting data from websites. This node supports two different browser providers:

### Supported Browser Providers

#### 1. Bright Data Browser

Bright Data provides a managed browser service with unblocked access to many websites:

- **Advantages**: Excellent IP rotation, built-in unblocking features
- **Limitations**: Some websites may require special permission
- **Setup**: Requires a Bright Data subscription and WebSocket endpoint

#### 2. Browserless.io

Browserless is a cloud browser automation service:

- **Advantages**: Simple API, no special permissions needed for most sites
- **Limitations**: May encounter more CAPTCHAs without additional configuration
- **Setup**: Requires a Browserless.io API key

### Credential Configuration

#### Bright Data API Credentials

- **WebSocket Endpoint**: Your Bright Data Browser WebSocket URL (required)
- **Authorized Domains**: List of domains that need authorization (optional)
- **Password**: For authentication if required (optional)

#### Browserless API Credentials

- **API Key**: Your Browserless API key (required)
- **Base URL**: Base URL for Browserless (default: `https://chrome.browserless.io`)
- **Request Timeout**: Maximum time in milliseconds for operations like navigation (default: 120000)
- **Stealth Mode**: Enable bot detection evasion techniques (default: true)

### Tips for Using Ventriloquist

1. **Session Management**: 
   - The "Open Browser" operation creates a session
   - Copy the `sessionId` to subsequent operations
   - Use the "Close" operation to close sessions when done

2. **Timeouts**:
   - "Request Timeout" in credentials controls individual operation timeouts
   - "Session Timeout" in the Open operation controls how long the browser stays open when idle

3. **Choosing a Provider**:
   - For general scraping, either provider works well
   - For websites with strong anti-bot measures, Bright Data often works better
   - For simple automation tasks, Browserless is often easier to set up

4. **Debugging**:
   - Enable the "Debug" option in the Open operation for troubleshooting
   - Check logs for detailed information about each step

## Testing Browserless Connections

For testing connections to Browserless instances, especially those hosted on Railway:

```bash
# Install the node package
npm install -g n8n-nodes-ventriloquist

# Test WebSocket connection directly
pnpm run test:browserless "wss://your-browserless-app.up.railway.app?token=YOUR_TOKEN"
```

If the connection is successful, you'll see:
```
Testing connection to: wss://your-browserless-app.up.railway.app?token=***TOKEN***
✅ Connection test SUCCESSFUL
```

You can also use the standalone Puppeteer test script:
```bash
node test-puppeteer-railway.js
```

### Troubleshooting Railway Deployments

Railway-hosted Browserless instances only respond to WebSocket connections, not HTTP endpoints. Use the "Direct WebSocket URL" connection type in the credentials configuration.

Make sure your Railway deployment has these environment variables:
- `TOKEN`: Authentication token for Browserless
- `DEFAULT_STEALTH`: true
- `CONNECTION_TIMEOUT`: 120000 (2 minutes)

For full setup instructions, see the [Railway Browserless Setup Guide](docs/railway-browserless-setup.md).
