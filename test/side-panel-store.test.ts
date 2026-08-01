import { describe, expect, it } from 'bun:test';
import { emptySessionIndex, newConversation, setTenantConv } from '../src/references-store';
import {
  discardTabSession,
  loadConversation,
  loadSessionIndex,
  saveConversation,
  saveSessionIndex,
} from '../src/side-panel-store';

describe('transient side-panel store', () => {
  it('keeps conversations and tenant routing in memory without Chrome storage', async () => {
    const conv = newConversation('conv-example', 1);
    const index = setTenantConv(emptySessionIndex(), 'example-corp|production#7', 7, conv.id);

    await saveConversation(conv);
    await saveSessionIndex(index);

    expect(await loadConversation(conv.id)).toEqual(conv);
    expect(await loadSessionIndex()).toEqual(index);

    await discardTabSession(7);
    expect(await loadConversation(conv.id)).toBeNull();
    expect(await loadSessionIndex()).toEqual(emptySessionIndex());
  });

  it('keeps a transient conversation until its final live route is discarded', async () => {
    const conv = newConversation('conv-shared', 2);
    let index = setTenantConv(emptySessionIndex(), 'example-corp|production#8', 8, conv.id);
    index = setTenantConv(index, 'example-corp|production#9', 9, conv.id);

    await saveConversation(conv);
    await saveSessionIndex(index);

    await discardTabSession(8);
    expect(await loadConversation(conv.id)).toEqual(conv);

    await discardTabSession(9);
    expect(await loadConversation(conv.id)).toBeNull();
    expect(await loadSessionIndex()).toEqual(emptySessionIndex());
  });
});
