/**
 * Client-side bridge WebSocket transport protocol, extracted so it is testable
 * end to end (service-worker.ts runs side-effects at import and can't be loaded
 * in a test). `bridgeHello` is the frame the extension sends on connect;
 * `dispatchBridgeFrame` routes each inbound frame to the right handler. The SW
 * owns the socket lifecycle (connect, reconnect, registry) and injects the
 * effectful handlers; this module is the pure protocol seam between them.
 */
import { type ChatInbound, isChatInbound } from './chat-protocol';

/** The handshake frame the extension sends immediately on opening a bridge
 *  socket. The bridge replies with `hello_ack`. */
export function bridgeHello(
  contractVersion: string,
  extensionId: string,
): { type: 'hello'; contractVersion: string; extensionId: string } {
  return { type: 'hello', contractVersion, extensionId };
}

/** Effect handlers the SW supplies for each inbound bridge frame type. All
 *  optional so a caller (or a test) can wire only what it cares about. */
export interface BridgeFrameHandlers {
  /** liveness `ping` — the SW replies with a `pong`. */
  onPing?: () => void;
  /** `hello_ack` / `tenant_changed` — the worker's advertised identity. */
  onIdentity?: (frame: Record<string, unknown>) => void;
  /** a worker `tool_request` to run against its bound tab. */
  onToolRequest?: (frame: Record<string, unknown>) => void;
  /** an xcsh timing `span` (in-band telemetry) tagged with a correlation id. */
  onSpan?: (frame: Record<string, unknown>) => void;
  /** a chat inbound frame (`chat_delta` / `chat_done` / `chat_error` / notice). */
  onChatInbound?: (frame: ChatInbound) => void;
}

/** Route one parsed bridge frame to its handler. Non-object / unknown frames are
 *  ignored (fail-closed), mirroring the bridge frame taxonomy the worker emits. */
export function dispatchBridgeFrame(raw: unknown, handlers: BridgeFrameHandlers): void {
  if (!raw || typeof raw !== 'object') return;
  const msg = raw as Record<string, unknown>;
  switch (msg.type) {
    case 'ping':
      handlers.onPing?.();
      return;
    case 'hello_ack':
    case 'tenant_changed':
      handlers.onIdentity?.(msg);
      return;
    case 'tool_request':
      handlers.onToolRequest?.(msg);
      return;
    case 'span':
      handlers.onSpan?.(msg);
      return;
  }
  if (isChatInbound(msg as unknown as ChatInbound)) handlers.onChatInbound?.(msg as unknown as ChatInbound);
}
