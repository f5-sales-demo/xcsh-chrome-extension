import { useRef } from 'preact/hooks';
import { INTERACTION_MODES, type InteractionMode } from '../../chat-protocol';
import { StatusBar } from './StatusBar';

/** Up-arrow send glyph — the shared xcsh composer affordance (mirrors the VSCode
 * extension's InputBar SendIcon so both surfaces read as one product). */
function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M10 5l5 5-1.4 1.4L11 8.83V15H9V8.83L6.4 11.4 5 10z" />
    </svg>
  );
}

/** Rounded-square stop glyph shown while a turn is streaming. */
function StopIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="10" height="10" rx="2" />
    </svg>
  );
}

export function Composer({
  disabled,
  placeholder = 'ask xcsh about this page…',
  sending,
  mode,
  onMode,
  onSend,
  onStop,
  contextPct = null,
  sessionLabel = '',
}: {
  disabled: boolean;
  placeholder?: string;
  sending: boolean;
  mode: InteractionMode;
  onMode: (m: InteractionMode) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  contextPct?: number | null;
  sessionLabel?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const el = ref.current;
    if (!el) return;
    const text = el.value.trim();
    if (!text) return;
    onSend(text);
    el.value = '';
    el.style.height = 'auto';
  }

  function autosize() {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  return (
    <form
      id="composer"
      class="inputBar"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <StatusBar contextPct={contextPct} sessionLabel={sessionLabel} />
      <div class="inputEditorContainer">
        <textarea
          id="input"
          class="inputEditor"
          ref={ref}
          placeholder={placeholder}
          rows={1}
          onInput={autosize}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <div class="inputFooter">
        <div class="footerSpacer" />
        <select
          id="mode"
          class="footerBtn modeBtn"
          title="conversation mode"
          value={mode}
          onChange={(e) => onMode((e.currentTarget as HTMLSelectElement).value as InteractionMode)}
        >
          {INTERACTION_MODES.map((m) => (
            <option key={m.id} value={m.id} title={m.blurb}>
              {m.label}
            </option>
          ))}
        </select>
        {sending ? (
          <button
            id="stop"
            type="button"
            class="footerBtn sendBtn stopBtn"
            title="stop"
            aria-label="stop"
            onClick={onStop}
          >
            <StopIcon />
          </button>
        ) : (
          <button id="send" type="submit" class="footerBtn sendBtn" title="send" aria-label="send" disabled={disabled}>
            <SendIcon />
          </button>
        )}
      </div>
    </form>
  );
}
