# Ventriloquist Node for n8n

[![Banner image](https://user-images.githubusercontent.com/10284570/173569848-c624317f-42b1-45a6-ab09-f0ea3c247648.png)](https://n8n.io/)

The Ventriloquist node is an advanced browser automation tool for n8n that allows you to perform web scraping, form filling, clicking, and extracting data from websites.

**Status:** Under active development. Currently focused on resolving issues related to debugger disconnections during complex navigations.

## Features

*   **Browser Automation:** Control headless browsers to interact with web pages.
*   **Multiple Operations:** Open/Close sessions, Navigate, Click, Fill Forms, Evaluate JS, Extract Data, Handle Conditions.
*   **Session Management:** Maintain persistent browser sessions across workflow steps using a `sessionId`.
*   **Provider Support:** Currently configured primarily for Browserless.io (including self-hosted or cloud instances like Railway). Bright Data support was previously included but may need verification/updates.
*   **Error Handling:** Includes logic to handle common scenarios like page redirects and context destruction during navigation.

## Prerequisites

*   Node.js (>= v18.10 recommended)
*   pnpm (v10+ recommended)
*   A running N8N instance (v1.x) for development and testing. See [N8N development setup guide](https://docs.n8n.io/integrations/creating-nodes/build/node-development-environment/).
*   Access to a Browserless instance (self-hosted, Railway, or Browserless.io cloud account).

## Installation in N8N (Development)

1.  Clone this repository:
    ```bash
    git clone https://github.com/TableMateio/n8n-nodes-ventriloquist.git
    cd n8n-nodes-ventriloquist
    ```
2.  Install dependencies:
    ```bash
    pnpm install
    ```
3.  Build the node:
    ```bash
    pnpm run build
    ```
4.  Link the node to your n8n development instance. From your n8n project directory, run:
    ```bash
    # Adjust the path to point to this cloned repository
    pnpm link /path/to/n8n-nodes-ventriloquist
    ```
    (Replace `/path/to/n8n-nodes-ventriloquist` with the actual path)
5.  Restart your n8n development instance. The "Ventriloquist" node should now appear in the node panel.

## Credential Configuration (Browserless)

Set up the "Browserless API" credentials in n8n:

*   **API Key:** Your Browserless instance token (if required, often set via `TOKEN` env var in Browserless).
*   **Base URL / WebSocket URL:**
    *   **Standard Connection (Recommended for Railway/Cloud):** Enter the base HTTP/HTTPS URL (e.g., `https://your-instance.up.railway.app`). The node will construct the WebSocket URL (`wss://...`).
    *   **Direct WebSocket URL:** Enter the full `ws://` or `wss://` endpoint directly.
*   **Request Timeout:** Max time for operations (default: 120000ms).
*   **Stealth Mode:** Enable bot evasion techniques (default: true).

Refer to `docs/railway-browserless-setup.md` for specific Railway setup guidance.

## Development & Testing Workflow

We are currently using the following collaborative workflow for debugging:

1.  **Start N8N Backend (Manual - User):**
    *   Open Terminal 1.
    *   `cd /path/to/your/n8n/project`
    *   `./run dev-test -c` (Starts N8N without opening browser)
    *   Wait for `Editor is now accessible via: https://localhost:5678`.
    *   Monitor this terminal for backend logs.

2.  **Trigger Workflow Test (Manual - User):**
    cd /Users/scottbergman/dropbox/taxsurplus/technology/n8n && NODE_ENV=development ./packages/cli/bin/n8n execute --id=YLEey8jT0fN0ovOl

3.  **Monitor & Debug (Collaborative):**
    *   Observe the workflow execution in the UI and the Browserless debugger (if attached).
    *   If a node hangs or the debugger disconnects (especially during the "Continue with Username" node click):
        *   User copies relevant logs from Terminal 1 (N8N backend).
        *   User pastes logs into the chat for AI analysis.

4.  **Code Changes (AI - Gemini):**
    *   AI analyzes logs for errors, disconnection events, etc.
    *   AI proposes and implements code changes (usually in `nodes/Ventriloquist/utils/`).

5.  **Rebuild (AI - Gemini):**
    *   AI runs `pnpm run build` in the `n8n-nodes-ventriloquist` directory (Terminal 2).

6.  **Repeat Cycle:** Go back to Step 2 to test the changes.

7.  **Commit Changes (AI - Gemini):**
    *   Once a fix is confirmed by the user, AI stages relevant files.
    *   AI suggests a commit message.
    *   Upon user approval, AI runs `git commit ... && git push`.

*(Optional: An automated test script exists in `/testing/run-n8n-test.js` using Puppeteer, but is currently facing challenges with reliable automated login/UI interaction.)*

## License

[MIT](LICENSE.md)
