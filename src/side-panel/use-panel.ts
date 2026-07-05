/**
 * Panel controller hook — ports the EFFECT logic of the old imperative
 * `src/side-panel.ts` (Port routing, panel-owned tab gating, per-(tenant,tab)
 * session load/save, 30s turn timeout, send/stop, debounced save) onto the pure
 * `panelReducer` (Task 6). I/O-heavy (chrome.runtime Port + chrome.tabs); it is
 * verified end-to-end in Task 10, not by faking Chrome. Every block cites the
 * matching region of the old file it preserves.
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
  tenantConv,
} from '../references-store';
import { loadConversation, loadSessionIndex, saveConversation, saveSessionIndex } from '../side-panel-store';
import { sessionKeyFromUrl, sessionKeyStr } from '../tab-binding';
import { PortBus } from '../ui/bus';
import { contextChipText, initPanelState, panelReducer } from './state';

const TURN_TIMEOUT_MS = 30_000; // old side-panel.ts:84
const now = () => Date.now();
// Per-(tenant,tab) conv-index key — tenant is part of the key so two tabs of one
// tenant keep distinct transcripts and a re-login never carries (old:303–310).
const tabConvKey = (sessionKey: string, tabId: number) => `${sessionKey}#${tabId}`;

export function usePanel() {
  const [state, dispatch] = useReducer(panelReducer, undefined, () =>
    initPanelState(newConversation(`conv-${crypto.randomUUID()}`, now())),
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  // One long-lived Port ("xcsh-chat") wrapped in PortBus (old:98).
  const bus = useMemo(() => new PortBus(chrome.runtime.connect({ name: 'xcsh-chat' })), []);
  const latestContext = useRef<unknown>(null);
  const liveTenants = useRef<LiveTenant[]>([]);
  const boundSessionKey = useRef<string | null>(null);
  const boundTabId = useRef<number | undefined>(undefined);
  const turnTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Adopt the CURRENT (in-flight) conv for the (tenant,tab) the automation binds
  // mid-turn, without swapping — flagship first run's chat belongs to the tab it
  // drove. No-op if that tab already has a session (old adoptCurrentConvForTenant,
  // lines 346–352).
  async function adoptCurrentConvForTenant(sessionKey: string, tabId: number) {
    const idx = await loadSessionIndex();
    const convKey = tabConvKey(sessionKey, tabId);
    if (tenantConv(idx, convKey)) return;
    const conv = stateRef.current.conv;
    await saveSessionIndex(setTenantConv(idx, convKey, tabId, conv.id));
    await saveConversation(conv);
  }

  // Panel-owned activation gating (old gateToActiveTab, lines 364–423).
  async function gateToActiveTab(tabId?: number) {
    // If a turn is running on another tab, save + suspend it rather than locking
    // the panel (the old `if (active) return` caused cross-tab transcript bleed +
    // blanking: tab B's commands went to tab A's worker because boundTabId never
    // updated, and tab B's conversation was empty when you returned). The suspended
    // turn's stream is safely ignored (the `active.id !== ev.id` guard drops it).
    if (stateRef.current.active) {
      await saveConversation(stateRef.current.conv);
      dispatch({ type: 'suspend_turn' });
    }
    let tab: chrome.tabs.Tab | undefined;
    if (tabId !== undefined) tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!tab) tab = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []))[0];
    const key = sessionKeyFromUrl(tab?.url);
    const keyStr = key ? sessionKeyStr(key) : null;
    if (keyStr && key) {
      const live = liveTenants.current.some((t) => t.tenant === keyStr);
      if (!live) {
        // Valid tenant tab but no xcsh process for it — guide, never route elsewhere.
        boundTabId.current = tab?.id;
        boundSessionKey.current = null;
        dispatch({ type: 'set_inactive', label: `${key.tenant}·${key.env}` });
        dispatch({ type: 'input_blocked', blocked: true });
        dispatch({ type: 'set_conv', conv: newConversation(`conv-${crypto.randomUUID()}`, now()) });
        // RC-3 evidence (#166): record WHY a connected tab blocked, so the live
        // registry state (not a guess) names the cause. See diag_suspension.
        bus.post({ type: 'gate_blocked', tabId: tab?.id, key: keyStr });
        return;
      }
      dispatch({ type: 'input_blocked', blocked: false });
      const prev = boundTabId.current;
      boundTabId.current = tab?.id;
      dispatch({ type: 'set_active_tenant', label: `${key.tenant}·${key.env}` });
      // Swap when the tenant OR the tab changed (old:407).
      if (keyStr !== boundSessionKey.current || tab?.id !== prev) await switchToTenantSession(keyStr, tab?.id);
      // Refresh context for the NEWLY-focused tab so the snapshot attached to the
      // next turn is this tab's, not the previously-controlled tab's (RC-2, #166).
      bus.post({ type: 'get_page_context', tabId: tab?.id });
    } else {
      // Active tab is NOT a tenant — enforce inactive every time (old:410–421).
      boundTabId.current = undefined;
      boundSessionKey.current = null;
      dispatch({ type: 'set_inactive', label: '' });
      dispatch({ type: 'input_blocked', blocked: false });
      dispatch({ type: 'set_conv', conv: newConversation(`conv-${crypto.randomUUID()}`, now()) });
    }
  }

  // Port routing + tab listeners (old port.onMessage 470–605; tab listeners 425–428). Mount once.
  useEffect(() => {
    const offPort = bus.on((m: unknown) => {
      if (!m || typeof m !== 'object') return;
      const msg = m as Record<string, unknown>;
      if (msg.type === 'status') return void dispatch({ type: 'connected', on: !!msg.connected });
      // session_info (old:482) sets a DOM-only connection tooltip — no panel state to carry; dropped.
      if (msg.type === 'bridges') {
        liveTenants.current = (msg.tenants as LiveTenant[]) ?? [];
        void gateToActiveTab(); // re-evaluate the focused tab against the new set (old:495–498)
        return;
      }
      if (msg.type === 'tab_bound') {
        // Idle: the panel-owned gate is the single authority — ignore. Only adopt
        // during an in-flight turn (old:501–517).
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
      if (msg.type === 'tab_unbound' || msg.type === 'tab_inactive') return; // defer to the gate (old:519–524)
      if (msg.type === 'tab_closed') {
        // Only abort the in-flight turn when the CLOSED tab is the one we drive (old:526–536).
        if ((msg.tabId as number) === boundTabId.current && stateRef.current.active) {
          if (turnTimeout.current) clearTimeout(turnTimeout.current);
          dispatch({ type: 'abort_turn', at: now() });
        }
        // Transcript cleanup stays unconditional — drop the tab→key mapping (old pruneTabSession, 337–340).
        loadSessionIndex()
          .then((i) => saveSessionIndex(removeTabSession(i, msg.tabId as number)))
          .catch(() => {});
        return;
      }
      if (msg.type === 'page_context') {
        latestContext.current = msg.snapshot;
        const snap = msg.snapshot as { title?: string; path?: string } | null;
        dispatch({
          type: 'page_context',
          meta: snap ? { title: snap.title, path: snap.path } : null,
          snapshot: msg.snapshot,
        });
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

    // Boot (old:741–745).
    bus.post({ type: 'status_request' });
    bus.post({ type: 'get_page_context', tabId: boundTabId.current });
    void gateToActiveTab();

    return () => {
      offPort();
      chrome.tabs.onActivated.removeListener(onAct);
      chrome.tabs.onUpdated.removeListener(onUpd);
    };
    // eslint-disable-next-line
  }, []);

  // Inbound chat routing (old onChatEvent, lines 551–605).
  function onChatEvent(ev: ChatInbound) {
    const active = stateRef.current.active;
    if (!active || active.id !== ev.id) return; // late inbound for a finished/aborted turn — ignore
    if (turnTimeout.current) {
      // First inbound for this turn — clear the timeout (old:556–559).
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
    else saveConversation(stateRef.current.conv).catch(() => {}); // chat_done / chat_error — flush now
  }

  // Send (old sendMessage, lines 611–663; turn timeout 653–660).
  function sendMessage(text: string) {
    const s = stateRef.current;
    if (!text || s.active) return;
    // Append the user message + an instant aborted-assistant notice, persist, and
    // return WITHOUT beginning a turn — used for the blocked/disconnected fast-paths
    // so a send never hangs for the full 30s turn timeout.
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
    // No live xcsh worker for the active tenant (the gate blocked input) — surface it
    // per-send instead of swallowing the send (parity with old side-panel.ts:612–615).
    if (s.inputBlocked)
      return notify('No xcsh running for this tenant — start the xcsh CLI in that context, then resend.');
    // Disconnected fast-path (old side-panel.ts:619–627) — avoid the 30s hang.
    if (!s.connected) return notify('xcsh not connected — start the xcsh CLI, then resend.');
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
    // Stamp the panel's bound tab so the SW routes this turn to THIS tab's worker
    // (resolveChatPort), not a global activePort that could hit another tab's busy
    // session — the SW refuses a chat_request with no tabId (#148/#33). Also stamp
    // the tab's CURRENT session key so the SW refuses a worker still bound to this
    // tab's sid but advertising the OLD tenant after a same-tab re-login (#166).
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

  // Stop (old stopBtn handler, lines 720–727) — posts buildChatStop.
  function stop() {
    const active = stateRef.current.active;
    if (!active) return;
    bus.post(buildChatStop(active.id));
    if (turnTimeout.current) clearTimeout(turnTimeout.current);
    dispatch({ type: 'abort_turn', at: now() });
    saveConversation(stateRef.current.conv).catch(() => {});
  }

  // Mode change (old modeEl change handler, lines 705–709).
  function setMode(m: InteractionMode) {
    const conv = setConvMode(stateRef.current.conv, m, now());
    dispatch({ type: 'set_conv', conv });
    saveConversation(conv).catch(() => {});
  }

  function refreshContext() {
    bus.post({ type: 'get_page_context', tabId: boundTabId.current }); // old ctx-refresh handler, 711–713
  }
  function toggleContext() {
    dispatch({ type: 'toggle_context' }); // old ctx-detach handler, 715–718
  }

  return {
    state,
    contextLabel: contextChipText(state),
    sendMessage,
    stop,
    setMode,
    refreshContext,
    toggleContext,
  };
}
