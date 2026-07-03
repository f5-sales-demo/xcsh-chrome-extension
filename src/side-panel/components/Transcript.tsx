import type { Conversation } from '../../references-store';
import { AssistantMessage, ErrorMessage, ThinkingIndicator, ToolMessage, UserMessage } from './messages';

export function Transcript({ conv, streaming }: { conv: Conversation; streaming: boolean }) {
  return (
    <div id="messages">
      {conv.messages.map((m) => {
        if (m.role === 'user') return <UserMessage key={m.id} text={m.text} />;
        if (m.role === 'tool')
          return <ToolMessage key={m.id} tool={m.tool ?? 'tool'} ok={m.ok ?? true} text={m.text} />;
        if (m.aborted) return <ErrorMessage key={m.id} text={m.text || 'Turn aborted.'} />;
        if (!m.text && streaming) return <ThinkingIndicator key={m.id} />;
        return <AssistantMessage key={m.id} text={m.text} />;
      })}
    </div>
  );
}
