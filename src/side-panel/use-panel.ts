/**
 * Panel controller hook. Owns the long-lived chat Port, per-(tenant,tab) session
 * load/save, the 30s turn timeout, and — new — the tab-activation READINESS
 * machine: it maps real Chrome/Port signals (status, bridges, page_context) to
 * pure activation gate events (see activation.ts), owns the per-gate timeout
 * timers, forwards per-gate timing frames to the SW, and correlates a page
 * snapshot to the activation run that requested it. The panel presents as ready
 * only when bridge + worker + page have all passed (App reads the derived phase).
 */
import { useEffect, useMemo, useReducer, useRef } from 'preact/hooks';
import type { LiveTenant } from '../bridge-discovery';
import {
  buildChatRequest,
  buildChatStop,
  type ChatInbound,
  type ChatStreamMsg,
  type InteractionMode,
  isChatInbound,
} from '../chat-protocol';
import {
  appendToolNotice,
  appendUserMessage,
  newConversation,
  removeTabSession,
  setMode as setConvMode,
  setTenantConv,
  startAssistant,
  tabConvKey,
  tenantConv,
} from '../references-store';
import { loadConversation, loadSessionIndex, saveConversation, saveSessionIndex } from '../side-panel-store';
import { sessionKeyFromUrl, sessionKeyStr } from '../tab-binding';
import { PortBus } from '../ui/bus';
import { type ActivationEvent, activationReducer, GATES, type GateName, newlyResolvedGates } from './activation';
import { composerPlaceholder, contextChipText, initPanelState, inputLocked, panelReducer } from './state';

const TURN_TIMEOUT_MS = 30_000; // old side-panel.ts:84
const BRIDGE_TIMEOUT_MS = 10_000; // hard gate: host unreachable
const WORKER_TIMEOUT_MS = 15_000; // hard gate: worker never bound (was PROVISION_TIMEOUT_MS, #180)
const PAGE_TIMEOUT_MS = 5_000; // soft gate: no fresh snapshot → degraded-ready
const now = () => Date.now();

export function usePanel() {
  const [state, dispatch] = useReducer(panelReducer, undefined, () =>
    initPanelState(newConversation(`conv-${crypto.randomUUID()}`, now())),
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  const bus = useMemo(() => new PortBus(chrome.runtime.connect({ name: 'xcsh-chat' })), []);
  const latestContext = useRef<unknown>(null);
  const liveTenants = useRef<LiveTenant[]>([]);
  const connectedRef = useRef(false);
  const boundSessionKey = useRef<string | null>(null);
  const boundTabId = useRef<number | undefined>(undefined);
  const turnTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gateTimers = useRef<Record<GateName, ReturnType<typeof setTimeout> | null>>({
    bridge: null,
    worker: null,
    page: null,
  });
  const pageRequestedForRun = useRef<number>(-1);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearGateTimers() {
    for (const g of GATES) {
      const t = gateTimers.current[g];
      if (t) {
        clearTimeout(t);
        gateTimers.current[g] = null;
      }
    }
  }

  // Debounced 300ms save (old scheduleSave, lines 104–110).
  function scheduleSave() {
    if (saveTimer.current) return;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      saveConversation(stateRef.current.conv).catch(() => {});
    }, 300);
  }

  // Per-(tenant,tab) session load/save (old switchToTenantSession, lines 316–333).
  async function switchToTenantSession(sessionKey: string | null, tabId?: number) {
    boundSessionKey.current = sessionKey;
    if (!sessionKey || tabId === undefined) {
      dispatch({ type: 'set_conv', conv: newConversation(`conv-${crypto.randomUUID()}`, now()) });
      return;
    }
    const idx = await loadSessionIndex();
    const convKey = tabConvKey(sessionKey, tabId);
    const convId = tenantConv(idx, convKey);
    const existing = convId ? await loadConversation(convId) : null;
    const conv = existing ?? newConversation(`conv-${crypto.randomUUID()}`, now());
    if (!existing) {
      await saveSessionIndex(setTenantConv(idx, convKey, tabId, conv.id));
      await saveConversation(conv);
    }
    dispatch({ type: 'set_conv', conv });
  }

  // Adopt the CURRENT in-flight conv for a tab the automation binds mid-turn
  // (old adoptCurrentConvForTenant, 346–352).
  async function adoptCurrentConvForTenant(sessionKey: string, tabId: number) {
    const idx = await loadSessionIndex();
    const convKey = tabConvKey(sessionKey, tabId);
    if (tenantConv(idx, convKey)) return;
    const conv = stateRef.current.conv;
    await saveSessionIndex(setTenantConv(idx, convKey, tabId, conv.id));
    await saveConversation(conv);
  }

  // --- Activation readiness machine ----------------------------------------

  // Compute the next activation purely, emit timing frames for gates that just
  // resolved, commit it, then schedule the timer/request for whatever gate is now
  // in flight. dispatch is async, so side-effects use the freshly-computed `next`
  // (never a post-dispatch read) — no stale-state races.
  function fireActivation(event: ActivationEvent) {
    const t = now();
    const prev = stateRef.current.activation;
    const next = activationReducer(prev, event, t);
    for (const rec of newlyResolvedGates(prev, next))
      bus.post({ type: 'activation_timing', ...rec, tabId: boundTabId.current }); // tabId → SW keys the `gates` TTFT span to this tab's sid (#170)
    dispatch({ type: 'set_activation', activation: next });
    afterActivation(next);
  }

  function afterActivation(next: (typeof state)['activation']) {
    clearGateTimers();
    let active: GateName | null = null;
    for (const g of GATES) if (next.gates[g].status === 'active') active = g;
    if (active === 'bridge') {
      gateTimers.current.bridge = setTimeout(
        () => fireActivation({ kind: 'timeout', gate: 'bridge' }),
        BRIDGE_TIMEOUT_MS,
      );
    } else if (active === 'worker') {
      gateTimers.current.worker = setTimeout(
        () => fireActivation({ kind: 'timeout', gate: 'worker' }),
        WORKER_TIMEOUT_MS,
      );
      // #182/#183: a workerless tab drives the SW's rate-limited re-provision.
      if (boundTabId.current !== undefined && boundSessionKey.current)
        bus.post({ type: 'gate_blocked', tabId: boundTabId.current, key: boundSessionKey.current });
    } else if (active === 'page') {
      if (pageRequestedForRun.current !== next.runId) {
        pageRequestedForRun.current = next.runId;
        // Worker is bound → load this (tenant,tab)'s conversation and fetch a fresh
        // snapshot tagged with the run id (correlation: a late reply for a superseded
        // run is ignored in the page_context handler).
        if (boundSessionKey.current && boundTabId.current !== undefined)
          void switchToTenantSession(boundSessionKey.current, boundTabId.current);
        bus.post({ type: 'get_page_context', tabId: boundTabId.current, reqId: next.runId });
      }
      gateTimers.current.page = setTimeout(() => fireActivation({ kind: 'timeout', gate: 'page' }), PAGE_TIMEOUT_MS);
    }
  }

  // Start a fresh activation run for a tenant tab. The single "reset" primitive —
  // called by the navigation gate AND by mid-session worker-vanish recovery.
  // tenant·env for the label are derived from keyStr ("tenant|env"), its source.
  function beginActivation(keyStr: string, tabId?: number) {
    boundTabId.current = tabId;
    boundSessionKey.current = keyStr;
    pageRequestedForRun.current = -1;
    const [tenant, env] = keyStr.split('|');
    dispatch({ type: 'set_session_label', label: `${tenant}·${env}` });
    const workerLive = liveTenants.current.some((tt) => tt.tenant === keyStr);
    fireActivation({ kind: 'reset', tenant: true, cold: !workerLive, connected: connectedRef.current, workerLive });
  }

  function beginInactive() {
    boundTabId.current = undefined;
    boundSessionKey.current = null;
    dispatch({ type: 'set_session_label', label: '' });
    dispatch({ type: 'set_conv', conv: newConversation(`conv-${crypto.randomUUID()}`, now()) });
    fireActivation({ kind: 'reset', tenant: false, cold: false, connected: connectedRef.current, workerLive: false });
  }

  // Panel-owned activation gating (old gateToActiveTab, 364–423) — now a run reset.
  async function gateToActiveTab(tabId?: number) {
    let tab: chrome.tabs.Tab | undefined;
    if (tabId !== undefined) tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!tab) tab = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []))[0];
    // Suspend a running turn ONLY when moving to a DIFFERENT tab, not on a same-tab
    // URL change (a turn's own navigation fires onUpdated → here; suspending then
    // would drop its stream). See #175.
    if (stateRef.current.active && tab?.id !== boundTabId.current) {
      await saveConversation(stateRef.current.conv);
      dispatch({ type: 'suspend_turn' });
    }
    const key = sessionKeyFromUrl(tab?.url);
    const keyStr = key ? sessionKeyStr(key) : null;
    const phase = stateRef.current.activation.phase;
    if (
      keyStr &&
      tab?.id === boundTabId.current &&
      keyStr === boundSessionKey.current &&
      (phase === 'ready' || phase === 'degraded')
    ) {
      // Same-tab, same-tenant navigation on an established session: refresh the page
      // snapshot WITHOUT a reset so a turn navigating its own tab (#175) keeps its
      // reply visible (no overlay flash) and its conversation intact (no
      // switchToTenantSession clobber). Full reset is reserved for a real tab switch,
      // a tenant change (#166 re-login → keyStr differs), cold start, and boot.
      bus.post({ type: 'get_page_context', tabId: tab?.id }); // reqId-less → updates chip, never re-gates
      return;
    }
    if (keyStr) beginActivation(keyStr, tab?.id);
    else beginInactive();
  }

  // Port routing + tab listeners. Mount once.
  useEffect(() => {
    const offPort = bus.on((m: unknown) => {
      if (!m || typeof m !== 'object') return;
      const msg = m as Record<string, unknown>;
      if (msg.type === 'status') {
        const on = !!msg.connected;
        connectedRef.current = on;
        dispatch({ type: 'connected', on });
        const a = stateRef.current.activation;
        // Advance the bridge gate for the current run if it is waiting; or, if the
        // bridge already hard-stalled (disconnected), a fresh connection means xcsh
        // finally started → re-gate the tab so the whole sequence restarts.
        if (on && a.gates.bridge.status === 'active') fireActivation({ kind: 'bridge' });
        else if (on && a.phase === 'disconnected') void gateToActiveTab(boundTabId.current);
        return;
      }
      if (msg.type === 'bridges') {
        liveTenants.current = (msg.tenants as LiveTenant[]) ?? [];
        const a = stateRef.current.activation;
        const live = boundSessionKey.current
          ? liveTenants.current.some((t) => t.tenant === boundSessionKey.current)
          : false;
        if (live && a.gates.bridge.status === 'passed' && a.gates.worker.status === 'active') {
          fireActivation({ kind: 'worker' }); // this tab's worker just came live
        } else if (!live && boundSessionKey.current && (a.phase === 'ready' || a.phase === 'degraded')) {
          // The tab's worker vanished mid-session. Force a fresh run directly (NOT
          // gateToActiveTab, whose same-tab soft-refresh guard would no-op here) so we
          // drop back to readying → worker gate → gate_blocked → reprovision (#183).
          // #175's same-tab self-nav soft-refresh is unaffected.
          beginActivation(boundSessionKey.current, boundTabId.current);
        }
        return;
      }
      if (msg.type === 'tab_bound') {
        if (!stateRef.current.active) return;
        const incomingTabId = msg.tabId as number;
        const key = sessionKeyFromUrl(msg.url as string | undefined);
        const keyStr = key ? sessionKeyStr(key) : null;
        if (keyStr && boundSessionKey.current === null) {
          boundSessionKey.current = keyStr;
          boundTabId.current = incomingTabId;
          void adoptCurrentConvForTenant(keyStr, incomingTabId);
        }
        return;
      }
      if (msg.type === 'tab_unbound' || msg.type === 'tab_inactive') return;
      if (msg.type === 'tab_closed') {
        if ((msg.tabId as number) === boundTabId.current && stateRef.current.active) {
          if (turnTimeout.current) clearTimeout(turnTimeout.current);
          dispatch({ type: 'abort_turn', at: now() });
        }
        loadSessionIndex()
          .then((i) => saveSessionIndex(removeTabSession(i, msg.tabId as number)))
          .catch(() => {});
        return;
      }
      if (msg.type === 'page_context') {
        // Activation-run correlation: ignore a late snapshot answering a superseded
        // run (e.g. the tab we just left). A reqId-less reply (manual refresh) is
        // always accepted.
        if (typeof msg.reqId === 'number' && msg.reqId !== stateRef.current.activation.runId) return;
        latestContext.current = msg.snapshot;
        const snap = msg.snapshot as { title?: string; path?: string } | null;
        dispatch({
          type: 'page_context',
          meta: snap ? { title: snap.title, path: snap.path } : null,
          snapshot: msg.snapshot,
        });
        if (stateRef.current.activation.gates.page.status === 'active') fireActivation({ kind: 'page' });
        return;
      }
      if (isChatInbound(m as ChatInbound)) onChatEvent(m as ChatInbound);
    });

    const onAct = ({ tabId }: chrome.tabs.OnActivatedInfo) => void gateToActiveTab(tabId);
    const onUpd = (tabId: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (info.url) void gateToActiveTab(tabId);
    };
    chrome.tabs.onActivated.addListener(onAct);
    chrome.tabs.onUpdated.addListener(onUpd);

    bus.post({ type: 'status_request' });
    void gateToActiveTab(); // page context is requested by afterActivation once the worker gate passes

    return () => {
      offPort();
      chrome.tabs.onActivated.removeListener(onAct);
      chrome.tabs.onUpdated.removeListener(onUpd);
      clearGateTimers();
    };
    // eslint-disable-next-line
  }, []);

  // Inbound chat routing (old onChatEvent, 551–605).
  function onChatEvent(ev: ChatInbound) {
    const active = stateRef.current.active;
    if (!active || active.id !== ev.id) return;
    if (turnTimeout.current) {
      clearTimeout(turnTimeout.current);
      turnTimeout.current = null;
    }
    if (ev.type === 'chat_tool_notice') {
      const conv = appendToolNotice(stateRef.current.conv, {
        id: ev.id,
        tool: ev.tool,
        ok: ev.ok,
        detail: ev.detail,
        at: now(),
      });
      dispatch({ type: 'set_conv', conv });
      scheduleSave();
      return;
    }
    dispatch({ type: 'stream', msg: ev as ChatStreamMsg, at: now() });
    const t = (ev as ChatStreamMsg).type;
    if (t === 'chat_delta') scheduleSave();
    else saveConversation(stateRef.current.conv).catch(() => {});
  }

  // Send (old sendMessage, 611–663).
  function sendMessage(text: string) {
    const s = stateRef.current;
    if (!text || s.active) return;
    const notify = (notice: string) => {
      let conv = appendUserMessage(s.conv, {
        id: `u-${crypto.randomUUID()}`,
        role: 'user',
        text,
        at: now(),
        context: s.attachContext && s.contextMeta ? s.contextMeta : undefined,
      });
      conv = startAssistant(conv, `a-${crypto.randomUUID()}`, now());
      conv = {
        ...conv,
        messages: conv.messages.map((m, i) =>
          i === conv.messages.length - 1 ? { ...m, text: notice, aborted: true } : m,
        ),
      };
      dispatch({ type: 'set_conv', conv });
      saveConversation(conv).catch(() => {});
    };
    // Readiness gate: the composer is locked until the panel is usable. Surface the
    // reason per-send (parity with old side-panel.ts:612–627) rather than hang.
    if (inputLocked(s)) {
      const p = s.activation.phase;
      return notify(
        p === 'disconnected'
          ? 'xcsh not connected — start the xcsh CLI, then resend.'
          : p === 'blocked'
            ? 'No xcsh running for this tab — start the xcsh CLI, then resend.'
            : 'xcsh is starting for this tab — one moment, then resend.',
      );
    }
    const userMsgId = `u-${crypto.randomUUID()}`;
    let conv = appendUserMessage(s.conv, {
      id: userMsgId,
      role: 'user',
      text,
      at: now(),
      context: s.attachContext && s.contextMeta ? s.contextMeta : undefined,
    });
    const asstMsgId = `a-${crypto.randomUUID()}`;
    conv = startAssistant(conv, asstMsgId, now());
    dispatch({ type: 'set_conv', conv });
    const turnId = `c-${crypto.randomUUID()}`;
    dispatch({ type: 'begin_turn', id: turnId, msgId: asstMsgId });
    scheduleSave();
    turnTimeout.current = setTimeout(() => {
      if (stateRef.current.active?.id === turnId) {
        dispatch({ type: 'abort_turn', at: now() });
        saveConversation(stateRef.current.conv).catch(() => {});
      }
    }, TURN_TIMEOUT_MS);
    bus.post(
      buildChatRequest(
        turnId,
        text,
        s.attachContext ? latestContext.current : null,
        s.conv.mode,
        s.conv.id,
        boundTabId.current,
        boundSessionKey.current,
      ),
    );
  }

  function stop() {
    const active = stateRef.current.active;
    if (!active) return;
    bus.post(buildChatStop(active.id));
    if (turnTimeout.current) clearTimeout(turnTimeout.current);
    dispatch({ type: 'abort_turn', at: now() });
    saveConversation(stateRef.current.conv).catch(() => {});
  }

  function setMode(m: InteractionMode) {
    const conv = setConvMode(stateRef.current.conv, m, now());
    dispatch({ type: 'set_conv', conv });
    saveConversation(conv).catch(() => {});
  }

  function refreshContext() {
    bus.post({ type: 'get_page_context', tabId: boundTabId.current }); // no reqId → never gated (manual refresh)
  }
  function toggleContext() {
    dispatch({ type: 'toggle_context' });
  }
  function retry() {
    // Blocked (worker stalled) → re-activate the worker gate (afterActivation re-posts
    // gate_blocked to re-drive provisioning). Disconnected (bridge stalled) → re-attempt
    // the whole gate sequence, which re-checks the connection.
    if (stateRef.current.activation.phase === 'disconnected') void gateToActiveTab(boundTabId.current);
    else fireActivation({ kind: 'retry' });
  }

  return {
    state,
    contextLabel: contextChipText(state),
    placeholder: composerPlaceholder(state),
    sendMessage,
    stop,
    setMode,
    refreshContext,
    toggleContext,
    retry,
  };
}
