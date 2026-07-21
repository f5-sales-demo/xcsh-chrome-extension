import type { InteractionMode } from '../chat-protocol';
import { ActivationOverlay, Composer, ContextChip, Transcript } from '../vendor/chat-ui';
import { activationToGates, convToMessages, MODES, overlayBlocked } from './adapt';
import { inputLocked, overlayVisible } from './state';
import { usePanel } from './use-panel';

/**
 * The side-panel shell, rendered entirely from the shared `@f5-sales-demo/
 * xcsh-chat-ui` components (vendored under `src/vendor/chat-ui`). The Chrome
 * view-model (Conversation / ActivationState / modes) is mapped into their
 * headless props by `./adapt`; all behavior still lives in `usePanel`.
 */
export function App() {
  const p = usePanel();
  const s = p.state;
  const streaming = s.active !== null;
  return (
    <>
      <ContextChip
        label={p.contextLabel}
        connected={s.connected}
        onRefresh={p.refreshContext}
        onDismiss={p.toggleContext}
        connectedTitle="bridge connected"
        disconnectedTitle="bridge offline"
      />
      <Transcript messages={convToMessages(s.conv)} streaming={streaming} onRetry={p.resendMessage} />
      <Composer
        disabled={inputLocked(s)}
        placeholder={p.placeholder}
        streaming={streaming}
        modes={MODES}
        mode={s.conv.mode}
        onModeChange={(id) => p.setMode(id as InteractionMode)}
        onSend={p.sendMessage}
        onStop={p.stop}
        contextPct={null}
        sessionLabel={s.sessionLabel}
      />
      {overlayVisible(s) ? (
        <ActivationOverlay
          gates={activationToGates(s.activation)}
          blocked={overlayBlocked(s.activation)}
          onRetry={p.retry}
        />
      ) : null}
    </>
  );
}
