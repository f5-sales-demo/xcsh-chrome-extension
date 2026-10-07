export function prepareAnswerContinuation(
  message: { type: string; value?: unknown },
  active: boolean,
  id: () => string,
): { chatId: string; summary: string } | undefined {
  if (message.type !== 'interaction_respond' || active || typeof message.value !== 'string') return undefined;
  return { chatId: `answer-${id()}`, summary: `Answer recorded: ${String(message.value)}` };
}
