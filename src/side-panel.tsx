import { render } from 'preact';
import { App } from './side-panel/App';
import { extUrl } from './ui/ext-url';
import { PANEL_CSS } from './vendor/chat-ui/theme/panel.css';
import { injectFontFaces, injectTokens } from './vendor/chat-ui/theme/tokens';

injectTokens(document);
injectFontFaces(document, extUrl);
const style = document.createElement('style');
style.textContent = PANEL_CSS;
document.head.append(style);

const root = document.getElementById('root');
if (root) render(<App />, root);
