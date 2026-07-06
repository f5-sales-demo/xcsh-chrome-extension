export function ContextChip({
  label,
  connected,
  onRefresh,
  onDetach,
}: {
  label: string;
  connected: boolean;
  onRefresh: () => void;
  onDetach: () => void;
}) {
  return (
    <div class="chip">
      <span class={`dot ${connected ? 'on' : ''}`} title={connected ? 'bridge connected' : 'bridge offline'} />
      <span>▣</span>
      <span class="title" id="ctx-chip">
        {label}
      </span>
      <button type="button" title="refresh page context" onClick={onRefresh}>
        ↻
      </button>
      <button type="button" title="detach page context" onClick={onDetach}>
        ✕
      </button>
    </div>
  );
}
