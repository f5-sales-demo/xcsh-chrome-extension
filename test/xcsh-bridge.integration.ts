/**
 * Cross-repository contract test. This starts xcsh's real BridgeServer and
 * connects with the extension's real transport and identity-planning helpers.
 *
 * Run with XCSH_REPO pointing at an xcsh checkout:
 * XCSH_REPO=/path/to/xcsh bun run test:xcsh-integration
 */
import { afterAll, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { bridgeHello, dispatchBridgeFrame } from '../src/bridge-transport';
import { type HelloAckPlan, planHelloAck } from '../src/sw-router';
import { NativeWebSocket } from './setup';

interface XcshBridge {
  port: number;
  close(): Promise<void>;
}

interface XcshBridgeModule {
  startBridgeServer(
    port: number | undefined,
    options: {
      serveKind: 'browser';
      sessionInfo: () => {
        sessionId: string;
        tenant: string;
        env: 'staging';
        contextBound: false;
      };
      range: { start: number; end: number };
    },
  ): Promise<XcshBridge>;
}

interface XcshIdentityModule {
  EXTENSION_ID: string;
}

const xcshRoot = process.env.XCSH_REPO;
if (!xcshRoot) throw new Error('XCSH_REPO must point at an xcsh checkout');

const bridgeModulePath = path.join(xcshRoot, 'packages/coding-agent/src/browser/extension-bridge.ts');
const identityModulePath = path.join(xcshRoot, 'packages/coding-agent/src/browser/extension-identity.ts');
if (!fs.existsSync(bridgeModulePath) || !fs.existsSync(identityModulePath)) {
  throw new Error('XCSH_REPO does not contain the coding-agent bridge sources');
}

const bridgeModule = (await import(bridgeModulePath)) as XcshBridgeModule;
const identityModule = (await import(identityModulePath)) as XcshIdentityModule;
const portBase = 30_000 + (process.pid % 100) * 100;
const bridge = await bridgeModule.startBridgeServer(undefined, {
  serveKind: 'browser',
  sessionInfo: () => ({
    sessionId: 'tab-contract-2',
    tenant: 'example-corp',
    env: 'staging',
    contextBound: false,
  }),
  range: { start: portBase, end: portBase + 9 },
});

afterAll(async () => {
  await bridge.close();
});

test('extension and xcsh complete the contract-2 identity handshake over a real WebSocket', async () => {
  const { promise, resolve, reject } = Promise.withResolvers<{
    frame: Record<string, unknown>;
    plan: HelloAckPlan;
  }>();
  const ws = new NativeWebSocket(`ws://127.0.0.1:${bridge.port}`, {
    headers: { Origin: `chrome-extension://${identityModule.EXTENSION_ID}` },
  } as unknown as string[]);
  const timeout = setTimeout(() => reject(new Error('contract-2 handshake timed out')), 5_000);

  ws.onopen = () => ws.send(JSON.stringify(bridgeHello(identityModule.EXTENSION_ID)));
  ws.onmessage = (event) => {
    const frame = JSON.parse(String(event.data)) as Record<string, unknown>;
    dispatchBridgeFrame(frame, {
      onIdentity: (identity) => resolve({ frame: identity, plan: planHelloAck(identity) }),
    });
  };
  ws.onerror = () => reject(new Error('contract-2 WebSocket connection failed'));

  try {
    const result = await promise;
    expect(Object.keys(result.frame).sort()).toEqual(
      ['type', 'sessionId', 'tenant', 'env', 'contextBound', 'contractVersion'].sort(),
    );
    expect(result.plan).toEqual({
      kind: 'accept',
      sessionId: 'tab-contract-2',
      tenant: 'example-corp',
      env: 'staging',
      contextBound: false,
    });
  } finally {
    clearTimeout(timeout);
    ws.close();
  }
});
