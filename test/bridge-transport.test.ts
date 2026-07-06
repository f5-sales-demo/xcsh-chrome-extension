/**
 * WS-transport coverage for the extension's bridge CLIENT (#... ). The xcsh
 * producer side has real-socket integration tests (worker.int / manager.int); the
 * extension's client transport had none because service-worker.ts runs
 * side-effects at import. So the transport protocol — what the extension sends on
 * connect (`bridgeHello`) and how it routes inbound frames (`dispatchBridgeFrame`)
 * — is extracted here and exercised BOTH as pure unit tests AND end to end over a
 * real Bun.serve WebSocket bridge (real sockets, real JSON frames).
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { bridgeHello, dispatchBridgeFrame } from '../src/bridge-transport';

// ── unit: the hello frame the extension sends on connect ────────────────────
describe('bridgeHello', () => {
  it('carries the contract version and extension id', () => {
    expect(bridgeHello('1.4.0', 'abcxyz')).toEqual({ type: 'hello', contractVersion: '1.4.0', extensionId: 'abcxyz' });
  });
});

// ── unit: inbound frame routing (the client-side protocol taxonomy) ─────────
describe('dispatchBridgeFrame', () => {
  const spy = () => {
    const calls: Array<[string, unknown]> = [];
    return {
      calls,
      onPing: () => calls.push(['ping', null]),
      onIdentity: (f: unknown) => calls.push(['identity', f]),
      onToolRequest: (f: unknown) => calls.push(['tool', f]),
      onChatInbound: (f: unknown) => calls.push(['chat', f]),
    };
  };

  it('routes ping → onPing', () => {
    const h = spy();
    dispatchBridgeFrame({ type: 'ping' }, h);
    expect(h.calls).toEqual([['ping', null]]);
  });
  it('routes hello_ack AND tenant_changed → onIdentity', () => {
    const h = spy();
    dispatchBridgeFrame({ type: 'hello_ack', sessionId: 'tab-1' }, h);
    dispatchBridgeFrame({ type: 'tenant_changed', tenant: 'acme' }, h);
    expect(h.calls.map((c) => c[0])).toEqual(['identity', 'identity']);
  });
  it('routes tool_request → onToolRequest', () => {
    const h = spy();
    dispatchBridgeFrame({ type: 'tool_request', id: 't1', tool: 'navigate' }, h);
    expect(h.calls[0]).toEqual(['tool', { type: 'tool_request', id: 't1', tool: 'navigate' }]);
  });
  it('routes chat frames (delta/done/error) → onChatInbound', () => {
    const h = spy();
    dispatchBridgeFrame({ type: 'chat_delta', id: 'c-1', seq: 0, delta: 'x' }, h);
    dispatchBridgeFrame({ type: 'chat_done', id: 'c-1' }, h);
    expect(h.calls.map((c) => c[0])).toEqual(['chat', 'chat']);
  });
  it('ignores unknown and non-object frames', () => {
    const h = spy();
    dispatchBridgeFrame({ type: 'wat' }, h);
    dispatchBridgeFrame(null, h);
    dispatchBridgeFrame('nope', h);
    expect(h.calls).toEqual([]);
  });
});

// ── integration: real sockets, real frames, over a live Bun bridge server ───
describe('bridge transport over a real WebSocket', () => {
  let server: ReturnType<typeof Bun.serve> | undefined;
  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  it('completes the hello handshake and dispatches server frames end to end', async () => {
    const received: Record<string, unknown>[] = []; // frames the SERVER got from the client
    server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        if (srv.upgrade(req)) return undefined;
        return new Response('no');
      },
      websocket: {
        data: undefined, // no per-socket data → server.upgrade(req) needs no options
        message(ws, raw) {
          const msg = JSON.parse(String(raw));
          received.push(msg);
          // On the client's hello, reply hello_ack, then exercise ping + tool_request.
          if (msg.type === 'hello') {
            ws.send(
              JSON.stringify({
                type: 'hello_ack',
                sessionId: 'tab-7',
                tenant: 'acme',
                env: 'staging',
                contextBound: true,
              }),
            );
            ws.send(JSON.stringify({ type: 'ping' }));
            ws.send(JSON.stringify({ type: 'tool_request', id: 'tr1', tool: 'navigate', params: {} }));
          }
        },
      },
    });

    const dispatched: Array<[string, unknown]> = [];
    const done = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${server?.port}`);
      ws.onopen = () => ws.send(JSON.stringify(bridgeHello('9.9.9', 'ext-id-123')));
      ws.onmessage = (ev) => {
        dispatchBridgeFrame(JSON.parse(String((ev as MessageEvent).data)), {
          onPing: () => ws.send(JSON.stringify({ type: 'pong' })), // client answers ping
          onIdentity: (f) => dispatched.push(['identity', f]),
          onToolRequest: (f) => {
            dispatched.push(['tool', f]);
            // once we've seen identity + tool + the server has our pong, finish
            if (received.some((m) => m.type === 'pong')) resolve();
            else setTimeout(() => resolve(), 200);
          },
          onChatInbound: (f) => dispatched.push(['chat', f]),
        });
      };
      ws.onerror = () => reject(new Error('client socket error'));
      setTimeout(() => reject(new Error(`timeout; server got ${JSON.stringify(received)}`)), 3000);
    });
    await done;

    // The server received the client's hello with the exact contract + id.
    expect(received.find((m) => m.type === 'hello')).toEqual({
      type: 'hello',
      contractVersion: '9.9.9',
      extensionId: 'ext-id-123',
    });
    // The client answered the server's ping with a pong (real round-trip).
    expect(received.some((m) => m.type === 'pong')).toBe(true);
    // The client dispatched the identity + tool frames to the right handlers.
    expect(dispatched.map((d) => d[0])).toEqual(expect.arrayContaining(['identity', 'tool']));
    const identity = dispatched.find((d) => d[0] === 'identity')?.[1] as Record<string, unknown>;
    expect(identity).toMatchObject({ sessionId: 'tab-7', tenant: 'acme', env: 'staging' });
  });
});
