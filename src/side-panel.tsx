import { render } from 'preact';
import { App } from './side-panel/App';
import { PANEL_CSS } from './side-panel/panel-style';
import { registerWidget } from './ui/registry';
import { injectFontFaces, injectTokens } from './ui/theme/tokens';

// Deferred, dormant (flag OFF) — proves the registry seam without rendering.
registerWidget({ id: 'references', slot: 'drawer', flag: 'references', component: () => null });

injectTokens(document);
injectFontFaces(document);
const style = document.createElement('style');
style.textContent = PANEL_CSS;
document.head.append(style);

const root = document.getElementById('root');
if (root) render(<App />, root);
