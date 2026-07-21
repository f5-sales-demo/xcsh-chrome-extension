/**
 * Composable overlay primitives — the Preact seam for on-page annotation visuals.
 *
 * `Highlight`, `Callout`, and `Fingerprint` migrate the existing overlay visuals
 * into standalone, self-positioning Preact components (each pins itself in the
 * viewport at a `Rect`). They render into an isolated Shadow-DOM host (see
 * `overlay/mount.ts`) so the host page's CSS can neither depend on nor disturb
 * them.
 *
 * `Arrow`, `Underline`, and `ScrollTarget` are the deferred enriched visuals for
 * future automation walkthroughs: flag-gated no-op stubs that establish the seam
 * without shipping any pixels yet. Each stays inert until its feature flag flips.
 */
import { isEnabled } from '../ui/flags';
import { COLORS } from '../vendor/chat-ui/theme/tokens';

/** Viewport-space rectangle a primitive draws itself at (CSS px). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A red outline drawn around a target rect, with an optional label. */
export function Highlight({ rect, label }: { rect: Rect; label?: string }) {
  return (
    <div
      class="ov-highlight"
      style={{
        position: 'fixed',
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.w}px`,
        height: `${rect.h}px`,
        border: `2px solid ${COLORS.f5Red}`,
        borderRadius: '4px',
        pointerEvents: 'none',
      }}
    >
      {label ? <span class="ov-label">{label}</span> : null}
    </div>
  );
}

/** A short text bubble anchored at a target rect. */
export function Callout({ rect, text }: { rect: Rect; text: string }) {
  return (
    <div class="ov-callout" style={{ position: 'fixed', left: `${rect.x}px`, top: `${rect.y}px` }}>
      {text}
    </div>
  );
}

/** A fingerprint marker at a click point (reuses the highlight box for now). */
export function Fingerprint({ rect }: { rect: Rect }) {
  return <Highlight rect={rect} />;
}

// ---------------------------------------------------------------------------
// Deferred enriched visuals — flag-gated no-op stubs. The seam exists so future
// automation walkthroughs can light these up by flipping the flag; until then
// they render nothing. The flag check keeps the gate wired (and referenced) so
// enabling it is the only change needed to start implementing the visual.
// ---------------------------------------------------------------------------

export function Arrow(props: { from: Rect; to: Rect }): null {
  if (isEnabled('overlaysArrow')) void props; // TODO: draw from → to when the flag ships
  return null;
}

export function Underline(props: { rect: Rect }): null {
  if (isEnabled('overlaysUnderline')) void props; // TODO: underline rect when the flag ships
  return null;
}

export function ScrollTarget(props: { rect: Rect }): null {
  if (isEnabled('overlaysScrollTarget')) void props; // TODO: scroll marker when the flag ships
  return null;
}
