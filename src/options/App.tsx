/**
 * Options page component (Preact port of the former `src/options.ts`). Lives in
 * its own module so the entry (`src/options.tsx`) can stay export-free — a
 * top-level `export` in the entry would make the bundle an ES module, which the
 * classic `<script src="options.js">` tag in options.html cannot load.
 *
 * Faithful port: sends the same `status_request` / `bridges_request` messages
 * and reads the same `xcsh.diag.suspension` storage key, mirroring the old DOM.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import { type DiagEvent, summarizeSuspension } from '../diagnostics';

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
