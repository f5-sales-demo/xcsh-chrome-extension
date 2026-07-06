import { COLORS } from '../../ui/theme/tokens';

/**
 * Powerline status bar for the Chrome extension. Unlike the xcsh CLI — whose
 * session is tied to a working DIRECTORY (so its bar shows cwd + git) — the
 * browser session is tied to a TENANT. So we deliberately DROP the cwd/"path"
 * and git segments and show only surface-appropriate signals:
 *   left  → context% (model context-window usage; a teal→red gradient)
 *   right → the session identity (tenant·env) in F5 red, right-aligned
 * Segments bleed with ▶ / ◀ caps colored by their own background (the plain-
 * Unicode powerline fallback — renders without a Nerd font). Colors are
 * transcribed from xcsh/.../theme/defaults/xcsh-dark.json + the context gradient.
 */

const SESSION_FG = '#ffffff';

// 21-step context-usage gradient (blue → teal → green → amber → red → purple).
// Pick the highest step whose pct ≤ value (floor to nearest 5), exactly as the CLI.
const CONTEXT_GRADIENT: ReadonlyArray<{ pct: number; bg: string; fg: string }> = [
  { pct: 0, bg: '#0d1b3e', fg: '#ffffff' },
  { pct: 5, bg: '#1a3a6e', fg: '#ffffff' },
  { pct: 10, bg: '#1a4399', fg: '#ffffff' },
  { pct: 15, bg: '#1565c0', fg: '#ffffff' },
  { pct: 20, bg: '#0277bd', fg: '#ffffff' },
  { pct: 25, bg: '#00838f', fg: '#000000' },
  { pct: 30, bg: '#00897b', fg: '#000000' },
  { pct: 35, bg: '#43a047', fg: '#000000' },
  { pct: 40, bg: '#558b2f', fg: '#000000' },
  { pct: 45, bg: '#9e9d24', fg: '#000000' },
  { pct: 50, bg: '#f9a825', fg: '#000000' },
  { pct: 55, bg: '#ff8f00', fg: '#000000' },
  { pct: 60, bg: '#ef6c00', fg: '#000000' },
  { pct: 65, bg: '#e65100', fg: '#000000' },
  { pct: 70, bg: '#d84315', fg: '#000000' },
  { pct: 75, bg: '#c62828', fg: '#ffffff' },
  { pct: 80, bg: '#b71c1c', fg: '#ffffff' },
  { pct: 85, bg: '#880e4f', fg: '#ffffff' },
  { pct: 90, bg: '#6a1b9a', fg: '#ffffff' },
  { pct: 95, bg: '#4a148c', fg: '#ffffff' },
  { pct: 100, bg: '#311b92', fg: '#ffffff' },
];

function gradientFor(pct: number): { bg: string; fg: string } {
  const v = Math.max(0, Math.min(100, pct));
  let chosen = CONTEXT_GRADIENT[0];
  for (const step of CONTEXT_GRADIENT) {
    if (step.pct <= v) chosen = step;
  }
  return chosen;
}

export function StatusBar({
  contextPct,
  sessionLabel,
}: {
  contextPct: number | null;
  sessionLabel: string;
}) {
  const g = contextPct != null ? gradientFor(contextPct) : null;
  return (
    // Transparent: the chips are embedded onto the composer's top border (the
    // "statusline" frame), mirroring the xcsh TUI where the statusline IS the
    // input box's top border rather than a separate bar above it.
    <div class="statusbar">
      {g && (
        <span class="seg seg-context" style={{ background: g.bg, color: g.fg }}>
          {Math.round(contextPct as number)}%<span class="sep-r" style={{ color: g.bg }}>▶</span>
        </span>
      )}
      <span class="seg-spacer" />
      {sessionLabel && (
        <span class="seg seg-session" style={{ background: COLORS.f5Red, color: SESSION_FG }}>
          <span class="sep-l" style={{ color: COLORS.f5Red }}>◀</span>
          {sessionLabel}
        </span>
      )}
    </div>
  );
}
