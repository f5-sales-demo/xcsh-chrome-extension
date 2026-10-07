export function prepareAnswerContinuation(
  message: { type: string; value?: unknown },
  active: boolean,
  id: () => string,
): { chatId: string; summary: string } | undefined {
  if (message.type !== 'interaction_respond' || active) return undefined;
  return { chatId: `answer-${id()}`, summary: `Answer recorded: ${String(message.value)}` };
}
