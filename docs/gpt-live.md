# Selected-chat voice candidate

Voice controls attach to the current xcsh chat. Typing and spoken delegations retain the
chat's backend model, workspace, execution owner and registered host tools. Start audio
deliberately; use the current audio-owner revision for takeover. Ending voice preserves chat
and backend tasks.

The companion uses its own HTTPS connection credential. Keep its connection link private.
The parent panel remains connected while the companion supplies microphone and speaker
audio. Provider subscription credentials remain on xcsh.

This is a draft implementation. Package builds and synthetic tests do not establish heard
speech, provider delegation, interruption, suspension recovery or physical acceptance.
Qualify an isolated xcsh candidate before testing this client. Preserve the registered
baseline and pairing. Two fresh iPhone Home Screen calls are required, the second at least
twenty minutes; failed physical cases require a changed validated candidate.

The canonical contracts and UI are vendored from xcsh packages/chat-ui. The deterministic
VENDOR-MANIFEST.json verifies their contents without requiring private source credentials.
Detailed backend/native integration and adaptation records live in xcsh's
packages/coding-agent/docs/voice-webrtc-integration.md and the two native crates' UPSTREAM.md.
