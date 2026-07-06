import { ActivationOverlay } from './components/ActivationOverlay';
import { Composer } from './components/Composer';
import { ContextChip } from './components/ContextChip';
import { Transcript } from './components/Transcript';
import { inputLocked, overlayVisible } from './state';
import { usePanel } from './use-panel';

export function App() {
  const p = usePanel();
  const s = p.state;
  return (
    <>
      <ContextChip
        label={p.contextLabel}
        connected={s.connected}
        onRefresh={p.refreshContext}
        onDetach={p.toggleContext}
      />
      <Transcript conv={s.conv} streaming={s.active !== null} />
      <Composer
        disabled={inputLocked(s)}
        placeholder={p.placeholder}
        sending={s.active !== null}
        mode={s.conv.mode}
        onMode={p.setMode}
        onSend={p.sendMessage}
        onStop={p.stop}
        contextPct={null}
        sessionLabel={s.sessionLabel}
      />
      {overlayVisible(s) ? <ActivationOverlay activation={s.activation} onRetry={p.retry} /> : null}
    </>
  );
}
