import { render } from 'preact';
import { App } from './side-panel/App';
import { extUrl } from './ui/ext-url';
import { registerWidget } from './ui/registry';
import { PANEL_CSS } from './vendor/chat-ui/theme/panel.css';
import { injectFontFaces, injectTokens } from './vendor/chat-ui/theme/tokens';

// Deferred, dormant (flag OFF) — proves the registry seam without rendering.
registerWidget({ id: 'references', slot: 'drawer', flag: 'references', component: () => null });

injectTokens(document);
injectFontFaces(document, extUrl);
const style = document.createElement('style');
style.textContent = PANEL_CSS;
document.head.append(style);

const root = document.getElementById('root');
if (root) render(<App />, root);
