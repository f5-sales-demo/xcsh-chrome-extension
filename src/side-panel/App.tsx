import { ActivationOverlay } from './components/ActivationOverlay';
import { Composer } from './components/Composer';
import { ContextChip } from './components/ContextChip';
import { Header } from './components/Header';
import { StatusBar } from './components/StatusBar';
import { Transcript } from './components/Transcript';
import { inputLocked, overlayVisible } from './state';
import { usePanel } from './use-panel';

export function App() {
  const p = usePanel();
  const s = p.state;
  return (
    <>
      <Header
        mode={s.conv.mode}
        onMode={p.setMode}
        sessionLabel={s.sessionLabel}
        connected={s.connected}
        sessionTitle=""
      />
      <ContextChip label={p.contextLabel} onRefresh={p.refreshContext} onDetach={p.toggleContext} />
      <Transcript conv={s.conv} streaming={s.active !== null} />
      <StatusBar model={s.conv.mode} contextPct={null} contextLabel={p.contextLabel} connected={s.connected} />
      <Composer
        disabled={inputLocked(s)}
        placeholder={p.placeholder}
        sending={s.active !== null}
        onSend={p.sendMessage}
        onStop={p.stop}
      />
      {overlayVisible(s) ? <ActivationOverlay activation={s.activation} onRetry={p.retry} /> : null}
    </>
  );
}
