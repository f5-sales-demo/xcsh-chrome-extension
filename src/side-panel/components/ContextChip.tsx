export function ContextChip({
  label,
  onRefresh,
  onDetach,
}: {
  label: string;
  onRefresh: () => void;
  onDetach: () => void;
}) {
  return (
    <div class="chip">
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
