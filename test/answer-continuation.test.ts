import { expect, test } from 'bun:test';
import { prepareAnswerContinuation } from '../src/side-panel/answer-continuation';

test('idle answer prepares a readable summary and correlated turn; streaming answers keep current turn', () => {
  const command = {
    type: 'interaction_respond',
    responseId: 'receipt',
    value: 'Montréal 東京',
    requestId: 'request',
  } as const;
  const result = prepareAnswerContinuation(command, false, () => 'fixed');
  expect(result).toEqual({ chatId: 'answer-fixed', summary: 'Answer recorded: Montréal 東京' });
  expect(prepareAnswerContinuation(command, true, () => 'fixed')).toBeUndefined();
  expect(prepareAnswerContinuation({ type: 'interaction_snapshot' }, false, () => 'fixed')).toBeUndefined();
});
