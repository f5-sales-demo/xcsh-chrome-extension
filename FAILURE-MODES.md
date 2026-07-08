# Chat turn failure-mode matrix

Every way a chat turn can fail maps to a distinct, actionable message and a
defined recovery path. This is the living contract behind graceful failure: it
is enforced by `test/failure-modes.test.ts`, which checks that each reason below
has a unique, non-terse message and the exact recovery affordances shown here.
The messages themselves live in `abortInfo` (`src/side-panel/state.ts`).

## Reasons

`reason` is carried on `chat_error` over the wire (contract 1.6.0) for causes the
worker or service worker detect, and set directly by the panel for the local
causes (stop, tab closed, no first token).

| reason | where it originates | message shown | Retry button | auto-resend |
| --- | --- | --- | --- | --- |
| `user-stop` | panel: the user pressed Stop | Stopped. | no | no |
| `tab-closed` | panel: the chat tab was closed | Chat tab was closed. | no | no |
| `first-token-timeout` | panel: no first token within the turn deadline | reconnecting notice | yes | yes |
| `bridge-disconnected` | worker or service worker: the bridge closed mid-turn | reconnecting notice | yes | yes |
| `bridge-unresponsive` | service worker: the socket read open but the worker never answered | reconnecting notice | yes | yes |
| `no-worker` | service worker: the tab has no live worker | reconnecting notice | yes | yes |
| `session-busy` | worker: a turn is already running for the session | busy notice | yes | no |
| `session-disposed` | worker: the session was torn down | restarting notice | yes | yes |
| `token-expired` | worker: the F5 XC token expired | run `/context create` | no | no |
| `token-expiring` | worker: the F5 XC token is about to expire | run `/context create` | no | no |
| `provider-4xx` | worker: the upstream model rejected the request | the raw model error | no | no |
| `provider-5xx` | worker: the upstream model failed | provider error notice | yes | no |

## Recovery

- **auto-resend** — the panel transparently re-provisions the tab's worker and
  resends the exact prompt once, then falls back to the Retry button. Every
  auto-resend reason is also retryable.
- **Retry button** — a one-click affordance on the failed turn that replays the
  captured prompt. Shown on the last turn when the reason is retryable.
- **manual step** — token reasons need `/context create`; a `provider-4xx`
  surfaces the raw model error so the user can correct the request.

## Root cause behind this work

An idle-reaped worker plus a stale-open socket produced a bare, non-actionable
`Turn aborted.` with no recovery. The fix spans four changes: the worker stays
alive while chatting (no mid-session reap), `chat_error` carries a machine-readable
`reason`, the service worker probes and recovers a dead socket fast, and
the panel renders the message above with auto-resend and Retry.
