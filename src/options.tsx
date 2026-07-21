/**
 * Options page entry — export-free so the bundle stays a classic script (the
 * `<script src="options.js">` tag in options.html has no `type="module"`; a
 * top-level `export` would make Chrome throw and the page render blank). The
 * component lives in `./options/App`; here we only inject theming and mount.
 */

import { render } from 'preact';
import { Options } from './options/App';
import { extUrl } from './ui/ext-url';
import { injectFontFaces, injectTokens } from './vendor/chat-ui/theme/tokens';

/** Terminal-themed styling (uses the injected token custom properties). */
const OPTIONS_CSS = `
  body { font: 14px/1.6 var(--font-mono); max-width: 480px; margin: 40px auto; padding: 0 16px;
    color: var(--bright-white); background: var(--deep-charcoal); }
  h1 { font-size: 20px; color: var(--f5-red); display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .04em; color: var(--cool-gray); margin: 24px 0 8px; }
  .status { padding: 12px; border-radius: 8px; background: var(--charcoal); margin: 16px 0; display: flex; align-items: center; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 8px; flex: none; background: var(--dim); }
  .dot.green { background: var(--signal-green); } .dot.red { background: var(--alert-red); }
  ul { margin: 0; padding-left: 20px; }
  code { background: var(--subtle-gray); padding: 1px 5px; border-radius: 4px; font-size: 13px; }
  .refresh { font: 11px var(--font-mono); margin-left: 8px; background: var(--subtle-gray);
    color: var(--bright-white); border: 0; border-radius: 4px; padding: 2px 8px; cursor: pointer; }
  pre.mono { font: 11px var(--font-mono); background: var(--charcoal); border-radius: 8px; padding: 10px;
    max-height: 280px; overflow: auto; white-space: pre-wrap; }
  footer { color: var(--cool-gray); font-size: 12px; margin-top: 24px; border-top: 1px solid var(--subtle-gray); padding-top: 12px; }
`;

injectTokens(document);
injectFontFaces(document, extUrl);
const style = document.createElement('style');
style.textContent = OPTIONS_CSS;
document.head.append(style);

const root = document.getElementById('root');
if (root) render(<Options />, root);
