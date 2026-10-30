export function prepareAnswerContinuation(
  message: { type: string; value?: unknown },
  active: boolean,
  id: () => string,
): { chatId: string } | undefined {
  if (message.type !== 'interaction_respond' || active || typeof message.value !== 'string') return undefined;
  return { chatId: `c-answer-${id()}` };
}
