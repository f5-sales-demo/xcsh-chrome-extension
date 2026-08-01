# xcsh — Chrome Web Store Listing

## Short description (132 characters maximum)

AI-driven browser automation for the F5 Distributed Cloud admin console. Navigate, fill forms, click — deterministically.

## Detailed Description

xcsh is a purpose-built Chrome extension that lets the xcsh AI assistant drive your F5 Distributed Cloud admin console directly in your browser — deterministically, in headed mode, while you watch.

**What it does:**
• Navigates the F5 XC console using your real logged-in session
• Reads the page structure via an accessibility tree (role/name/text selectors)
• Fills forms with Angular model commitment (handles the XC console's vsui-input framework)
• Clicks buttons, selects options, scrolls to elements — all via the Chrome DevTools Protocol
• Screenshots the console for verification
• Reads console logs and network requests for debugging

**How it works:**
xcsh (the CLI AI assistant) connects to this extension through a local native-messaging bridge. The extension drives your real Chrome — no separate browser, no debug port, no headless mode. You see everything the agent does.

**Key features:**
• Browser automation tools including navigate, read_ax, find, click, form_input, key_press, select_option, scroll_to, wait_for, assert_text, screenshot, get_page_text, javascript_tool, tabs management, read_console, read_network, browser_batch, resize_window, reload, and detach
• Enterprise managed policy support (allowedDomains, blockedUrlPatterns via Chrome Enterprise)
• F5-red visual indicator ("xcsh" badge) when the agent is driving
• Domain-scoped to F5 XC console URLs only — never acts outside the console

**Privacy:**
• The extension never accepts or stores login credentials; you authenticate directly in Chrome
• Chat content and tenant routing stay in memory for the active side-panel lifetime
• Persisted diagnostics contain metrics only, never tenant/session values or page URLs
• All communication is local (native-messaging bridge to xcsh CLI on your machine)
• No data is sent to external servers
• The extension only operates on F5 Distributed Cloud console domains

**Requirements:**
• xcsh CLI installed (<https://github.com/f5-sales-demo/xcsh>)
• `xcsh chrome setup` run once to install the native-messaging host
• Logged into your F5 XC tenant in Chrome

## Category

Developer Tools

## Language

English
