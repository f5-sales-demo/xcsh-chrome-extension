/**
 * Options page (Preact port) — reports live connection status to the xcsh native
 * host, renders the Phase 0a suspension-diagnostics timeline, and lists the
 * Phase 3 discovered bridges. Faithful port of the former `src/options.ts`: it
 * sends the same `status_request` / `bridges_request` messages and reads the
 * same `xcsh.diag.suspension` storage key, then mirrors the old DOM structure.
 */

import { render } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { type DiagEvent, summarizeSuspension } from './diagnostics';
import { injectTokens } from './ui/theme/tokens';

const DIAG_KEY = 'xcsh.diag.suspension';

/** One discovered bridge, as reported by the SW's `bridges_request` reply. */
interface BridgeRow {
  port: number;
  tenant: string | null;
  env: string | null;
  sessionId: string | null;
  lastSeen: number;
}

/** Ping the service worker; a missing reply / runtime error counts as disconnected. */
function readStatus(): Promise<boolean> {
  return new Promise((res) =>
    chrome.runtime.sendMessage({ type: 'status_request' }, (resp: { connected?: boolean } | undefined) =>
      res(chrome.runtime.lastError ? false : !!resp?.connected),
    ),
  );
}

/** Read + summarize the capped suspension-diagnostics buffer (last 60 events). */
async function readDiag(): Promise<{ summary: string; events: string }> {
  const r = await chrome.storage.local.get(DIAG_KEY);
  const events = ((r?.[DIAG_KEY] as DiagEvent[] | undefined) ?? []).slice(-60);
  const s = summarizeSuspension(events);
  const summary = `restarts ${s.restarts} · suspends ${s.suspends} · max tick gap ${(s.maxTickGapMs / 1000).toFixed(1)}s · missed binds ${s.missedBinds}`;
  const t0 = events.length ? events[0].t : 0;
  const text = events
    .map((e) => {
      const { t, event, ...rest } = e;
      const rel = `+${((t - t0) / 1000).toFixed(1)}s`.padStart(9);
      return `${rel}  ${event.padEnd(16)} ${JSON.stringify(rest)}`;
    })
    .join('\n');
  return { summary, events: text };
}

/** Ask the SW for the discovered-bridges registry, formatted one per line. */
async function readBridges(): Promise<string> {
  const resp = await new Promise<{ bridges?: BridgeRow[] } | undefined>((res) =>
    chrome.runtime.sendMessage({ type: 'bridges_request' }, (r) => res(chrome.runtime.lastError ? undefined : r)),
  );
  const rows = resp?.bridges ?? [];
  return rows.length
    ? rows.map((b) => `:${b.port}  ${b.tenant ?? '—'}·${b.env ?? '—'}  ${b.sessionId ?? ''}`).join('\n')
    : '(none)';
}

export function Options() {
  // null = still checking (mirrors the old "Checking connection…" initial state).
  const [connected, setConnected] = useState<boolean | null>(null);
  const [diagSummary, setDiagSummary] = useState('…');
  const [diagEvents, setDiagEvents] = useState('');
  const [bridges, setBridges] = useState('(none)');

  const refresh = useCallback(() => {
    void readDiag().then(({ summary, events }) => {
      setDiagSummary(summary);
      setDiagEvents(events);
    });
    void readBridges().then(setBridges);
  }, []);

  useEffect(() => {
    void readStatus().then(setConnected);
    refresh();
  }, [refresh]);

  return (
    <>
      <h1>
        <img src="icons/icon-48.png" width="32" height="32" alt="" /> xcsh
      </h1>
      <div class="status">
        {connected === null ? (
          <>
            <span class="dot" />
            Checking connection…
          </>
        ) : connected ? (
          <>
            <span class="dot green" />
            Connected to xcsh
          </>
        ) : (
          <>
            <span class="dot red" />
            Not connected — start xcsh and run <code>xcsh chrome setup</code>
          </>
        )}
      </div>

      <h2>Console domains</h2>
      <ul>
        <li>
          <code>*.volterra.us</code>
        </li>
        <li>
          <code>*.console.ves.volterra.io</code>
        </li>
      </ul>

      <h2>
        Suspension diagnostics{' '}
        <button type="button" class="refresh" onClick={refresh}>
          refresh
        </button>
      </h2>
      <div class="status">{diagSummary}</div>
      <pre class="mono">{diagEvents}</pre>

      <h2>Discovered bridges</h2>
      <pre class="mono">{bridges}</pre>

      <footer>v0.1.0 · powered by xcsh</footer>
    </>
  );
}

/** Terminal-themed styling (uses the injected token custom properties). */
const OPTIONS_CSS = `
  body { font: 14px/1.6 var(--font-mono); max-width: 480px; margin: 40px auto; padding: 0 16px;
    color: var(--bright-white); background: var(--deep-charcoal); }
  h1 { font-size: 20px; color: var(--f5-red); display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .04em; color: var(--cool-gray); margin: 24px 0 8px; }
  .status { padding: 12px; border-radius: 8px; background: var(--charcoal); margin: 16px 0; display: flex; align-items: center; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 8px; flex: none; background: var(--dim); }
  .dot.green { background: var(--signal-green); } .dot.red { background: var(--alert-red); }
  ul { margin: 0; padding-left: 20px; }
  code { background: var(--subtle-gray); padding: 1px 5px; border-radius: 4px; font-size: 13px; }
  .refresh { font: 11px var(--font-mono); margin-left: 8px; background: var(--subtle-gray);
    color: var(--bright-white); border: 0; border-radius: 4px; padding: 2px 8px; cursor: pointer; }
  pre.mono { font: 11px var(--font-mono); background: var(--charcoal); border-radius: 8px; padding: 10px;
    max-height: 280px; overflow: auto; white-space: pre-wrap; }
  footer { color: var(--cool-gray); font-size: 12px; margin-top: 24px; border-top: 1px solid var(--subtle-gray); padding-top: 12px; }
`;

// --- Mount (no-op under test where there is no #root) ----------------------
injectTokens(document);
const styleEl = document.createElement('style');
styleEl.textContent = OPTIONS_CSS;
document.head.append(styleEl);

const rootEl = document.getElementById('root');
if (rootEl) render(<Options />, rootEl);
