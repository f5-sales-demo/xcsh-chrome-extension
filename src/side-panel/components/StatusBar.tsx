import { COLORS } from '../../ui/theme/tokens';

function Seg({ cls, bg, fg, children }: { cls: string; bg: string; fg: string; children: preact.ComponentChildren }) {
  return (
    <span class={`seg ${cls}`} style={{ background: bg, color: fg }}>
      {children}
      <span class="sep" style={{ color: bg }}>
        ▶
      </span>
    </span>
  );
}

export function StatusBar({
  model,
  contextPct,
  contextLabel,
  connected,
}: {
  model: string;
  contextPct: number | null;
  contextLabel: string;
  connected: boolean;
}) {
  return (
    <div class="statusbar">
      <Seg cls="seg-model" bg={COLORS.subtleGray} fg={COLORS.brightWhite}>
        ⬢ {model || '—'}
      </Seg>
      <Seg cls="seg-conn" bg={connected ? COLORS.signalGreen : COLORS.alertRed} fg={COLORS.deepCharcoal}>
        {connected ? 'connected' : 'offline'}
      </Seg>
      <span class="seg seg-context" style={{ background: COLORS.f5Red, color: '#fff' }}>
        ◫ {contextLabel}
        {contextPct != null ? ` ${contextPct}%` : ''}
      </span>
    </div>
  );
}
