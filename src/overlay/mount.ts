/**
 * DOM adapter for the overlay library — the Preact/Shadow-DOM mount behind the
 * public `showOverlay`. It turns an `OverlaySpec` into geometry via the pure
 * `planOverlay`, renders the plan into a fresh, isolated, token-injected Shadow
 * DOM host with Preact, runs the plan's Web-Animations, and self-removes when
 * they finish (with a `ttlMs` safety net so a cancelled/absent animation can
 * never leak a node). Host geometry, markup, animations, and auto-remove timing
 * are preserved bit-for-bit from the original imperative mount.
 */
import { h, render } from 'preact';
import { type OverlaySpec, planOverlay } from '../overlays';
import { injectTokens } from '../vendor/chat-ui/theme/tokens';

export function mountOverlay(spec: OverlaySpec): void {
  const plan = planOverlay(spec);
  if (!plan) return;

  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:${plan.left}px;top:${plan.top}px;z-index:2147483647;pointer-events:none;`;
  const root = host.attachShadow({ mode: 'open' });
  // Shared design tokens (`--f5-red`, …) so primitives can reference them.
  injectTokens(root);
  // Render the plan's self-contained, inline-styled markup into the shadow root.
  // A `display:contents` wrapper keeps the render single-rooted for Preact
  // without adding a layout box, so the absolutely-positioned children resolve
  // against the fixed host exactly as before.
  render(h('div', { style: 'display:contents', dangerouslySetInnerHTML: { __html: plan.html } }), root);
  document.documentElement.appendChild(host);

  let last: Animation | undefined;
  for (const a of plan.anims) {
    const el = root.querySelector(a.sel);
    if (!el || typeof el.animate !== 'function') continue;
    last = el.animate(a.keyframes as Keyframe[], a.timing);
  }
  if (last) {
    last.onfinish = () => host.remove();
    last.oncancel = () => host.remove();
  }
  // Safety net: always clean up by ttl, even if animations are unavailable or a
  // non-final animation outlived `last`. remove() is idempotent.
  setTimeout(() => host.remove(), plan.ttlMs);
}
