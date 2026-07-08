import type { Conversation } from '../../references-store';
import { abortInfo } from '../state';
import { AssistantMessage, ErrorMessage, ThinkingIndicator, ToolMessage, UserMessage } from './messages';

export function Transcript({
  conv,
  streaming,
  onRetry,
}: {
  conv: Conversation;
  streaming: boolean;
  onRetry?: (text: string) => void;
}) {
  const lastId = conv.messages.length > 0 ? conv.messages[conv.messages.length - 1].id : null;
  return (
    <div id="messages">
      {conv.messages.map((m) => {
        if (m.role === 'user') return <UserMessage key={m.id} text={m.text} />;
        if (m.role === 'tool')
          return <ToolMessage key={m.id} tool={m.tool ?? 'tool'} ok={m.ok ?? true} text={m.text} />;
        if (m.aborted) {
          const info = abortInfo(m.abortReason);
          // Curated per-reason message when the cause is known; raw text only for a
          // 4xx (names the real problem) or an unclassified error. Retry appears on the
          // LAST turn when the reason is retryable and we captured the prompt.
          const text = m.abortReason ? (info.preferRawText && m.text ? m.text : info.text) : m.text || 'Turn aborted.';
          const canRetry = info.retryable && !!m.retryPrompt && m.id === lastId && !!onRetry;
          return (
            <ErrorMessage
              key={m.id}
              text={text}
              onRetry={canRetry ? () => onRetry?.(m.retryPrompt as string) : undefined}
            />
          );
        }
        if (!m.text && streaming) return <ThinkingIndicator key={m.id} />;
        return <AssistantMessage key={m.id} text={m.text} />;
      })}
    </div>
  );
}
