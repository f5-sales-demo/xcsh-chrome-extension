import { Composer } from './components/Composer';
import { ContextChip } from './components/ContextChip';
import { Transcript } from './components/Transcript';
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
        disabled={s.inputBlocked}
        placeholder={p.placeholder}
        sending={s.active !== null}
        mode={s.conv.mode}
        onMode={p.setMode}
        onSend={p.sendMessage}
        onStop={p.stop}
        contextPct={null}
        sessionLabel={s.sessionLabel}
      />
    </>
  );
}
