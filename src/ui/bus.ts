/** Pure typed pub/sub used for intra-UI events, plus a thin wrapper over the
 * long-lived chrome.runtime Port so components share one transport seam. */
export function createBus<E extends { type: string }>() {
  const handlers = new Map<string, Set<(e: E) => void>>();
  return {
    emit(e: E): void {
      for (const fn of handlers.get(e.type) ?? []) fn(e);
    },
    on(type: E['type'], fn: (e: E) => void): () => void {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(fn);
      return () => set?.delete(fn);
    },
  };
}

export class PortBus {
  private readonly snapshots = new Map<string, unknown>();
  constructor(private readonly port: chrome.runtime.Port) {
    port.onMessage.addListener((message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const type = Reflect.get(message, 'type');
      if (type === 'status' || type === 'bridges') {
        this.snapshots.delete(type);
        this.snapshots.set(type, message);
      }
    });
  }
  post(msg: unknown): void {
    this.port.postMessage(msg);
  }
  on(fn: (msg: unknown) => void): () => void {
    this.port.onMessage.addListener(fn);
    // Chrome can greet the Port before the component's effect subscribes.
    // Retain connection state only; tool/chat frames must never be replayed.
    for (const snapshot of this.snapshots.values()) fn(snapshot);
    return () => this.port.onMessage.removeListener(fn);
  }
}
