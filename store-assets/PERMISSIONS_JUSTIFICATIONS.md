# Permissions Justifications (for Chrome Web Store Dashboard)

Copy each justification into the corresponding field in the CWS Developer Dashboard → Privacy tab.

## debugger
"Used to drive the F5 Distributed Cloud admin console deterministically: dispatches mouse clicks (Input.dispatchMouseEvent) on form elements identified by the accessibility tree, reads page state via Runtime.evaluate, enables Page domain for dialog handling, and navigates via Page.navigate. All operations are scoped to F5 XC console domains (*.volterra.us, *.console.ves.volterra.io)."

## nativeMessaging
"Communicates with the xcsh CLI AI assistant running on the user's local machine via Chrome's native-messaging API. The native-messaging host (com.f5xc.xcsh.chrome_host) relays tool requests and responses over a local Unix domain socket. No external network communication."

## scripting
"Injects the accessibility-tree content script into F5 XC console pages to serialize the page's DOM structure (element roles, names, and coordinates) for deterministic element resolution. Also used for login form interaction on the Keycloak authentication pages."

## tabs
"Manages console tabs: creates new tabs for navigation, queries existing console tabs for reuse, updates tab URLs for navigation, and captures the visible tab for screenshots. Tab operations are scoped to F5 XC console domains."

## webNavigation
"Monitors navigation completion events (onCompleted) to detect when F5 XC console pages have finished loading before attempting to read or interact with them."

## activeTab
"Grants temporary access to the active tab when the user interacts with the extension, enabling element inspection and form interaction on the current console page."

## storage
"Reads enterprise-managed Chrome policy (managed_schema.json) for IT-configurable domain allowlists and blocked URL patterns. The extension does not write to Chrome storage."

## alarms
"Schedules a 30-second reconnection alarm to re-establish the native-messaging connection if the service worker is suspended and restarted by Chrome's MV3 lifecycle management."

## host_permissions: <all_urls>
"Required by Chrome's captureVisibleTab API for console screenshots. Despite the broad permission, all automation tools enforce domain-scoping to F5 XC console URLs (*.volterra.us, *.console.ves.volterra.io) and reject operations on non-console pages."

## Single Purpose Description
"Automate the F5 Distributed Cloud admin console: navigate, fill forms, click buttons, and verify page state — driven by the xcsh AI assistant through a local native-messaging bridge."
