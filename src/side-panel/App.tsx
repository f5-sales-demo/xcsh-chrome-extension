import { useCallback, useMemo, useRef } from 'preact/hooks';
import type { InteractionMode } from '../chat-protocol';
import type { AttachCategory, ComposerHandle, SlashCommand } from '../vendor/chat-ui';
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
/** The one "+" category this surface offers: the engine's skills. Chrome has no
 *  attachment picker (no photos/files like the Office pane), so the menu exists only
 *  when there is at least one skill to put in it — never an empty affordance. */
const SKILLS_CATEGORY: AttachCategory = {
  id: 'skills',
  label: 'Skills',
  description: 'Run a workspace skill',
};

/**
 * Curated slash commands, matching the VS Code webview's list rather than inventing a
 * third convention. These are ordinary prompts the agent understands — not
 * engine-enumerated commands — so there is nothing to fetch. All three are as
 * meaningful here as in the editor: the panel already shows tenant context in its chip.
 */
const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/status', label: 'Status', description: 'Show integration health' },
  { command: '/context', label: 'Context', description: 'Show active xcsh context' },
  { command: '/resources', label: 'Resources', description: 'Browse current namespace' },
];

export function App() {
  const p = usePanel();
  const s = p.state;
  const streaming = s.active !== null;
  const composerRef = useRef<ComposerHandle>(null);
  const attachCategories = useMemo(() => (p.skills.length > 0 ? [SKILLS_CATEGORY] : undefined), [p.skills.length]);
  // Prefill `/name ` for the user to add input and send — the shared idiom across
  // surfaces; the engine treats a leading /skill as an invocation.
  const onSkillSelect = useCallback((name: string) => composerRef.current?.setText(`/${name} `), []);
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
        ref={composerRef}
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
        attachCategories={attachCategories}
        skills={p.skills}
        onSkillSelect={onSkillSelect}
        slashCommands={SLASH_COMMANDS}
        // SENDS rather than prefills: a slash command is complete as written, unlike a
        // skill (`/name ` + arguments). Same behaviour as the VS Code webview.
        onSlashSelect={p.sendMessage}
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
