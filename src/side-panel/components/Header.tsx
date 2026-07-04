import { INTERACTION_MODES, type InteractionMode } from '../../chat-protocol';

export function Header({
  mode,
  onMode,
  sessionLabel,
  connected,
  sessionTitle,
}: {
  mode: InteractionMode;
  onMode: (m: InteractionMode) => void;
  sessionLabel: string;
  connected: boolean;
  sessionTitle: string;
}) {
  return (
    <header>
      <span class="mark">xcsh</span>
      <span class="sub">chat</span>
      <select
        id="mode"
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
      <span id="sess" title="xcsh session tenant">
        {sessionLabel}
      </span>
      <span class={`dot ${connected ? 'on' : ''}`} title={sessionTitle || 'bridge connection'} />
    </header>
  );
}
