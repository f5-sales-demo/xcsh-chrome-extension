/**
 * Who is waiting for a `skills` reply, keyed by the bridge socket the request went
 * out on.
 *
 * The engine answers `list_skills` with `{ type: 'skills', skills }` and NO turn id,
 * so the SW can't route it through `turnToPort`. Skills belong to the worker behind a
 * socket rather than to a tab, so the socket is the correct key: two tabs sharing a
 * worker legitimately share its skills, while a panel on a different worker never
 * sees them. Fanning an id-less frame to every panel would be the cross-tab leak
 * #33/#166 exist to prevent.
 *
 * This lives in its own module, not inline in `service-worker.ts`, because that file
 * runs side-effects at import and cannot be unit-tested — the same reason
 * `sw-router.ts` exists. The bookkeeping is safety-critical: bridge ports are a
 * REUSABLE POOL (19222–19241), so a waiter that outlives its socket can be handed a
 * later, unrelated (possibly different-tenant) worker's reply. Hence `forgetPort`,
 * and hence tests. See #340.
 */
export class SkillsWaiters<TPanel> {
  readonly #byPort = new Map<number, Set<TPanel>>();

  /** Record that `panel` is awaiting the reply for the request sent on `port`. */
  add(port: number, panel: TPanel): void {
    const waiting = this.#byPort.get(port) ?? new Set<TPanel>();
    waiting.add(panel);
    this.#byPort.set(port, waiting);
  }

  /** The panels awaiting `port`'s reply, consuming them — a duplicate frame delivers
   *  to nobody. */
  take(port: number): TPanel[] {
    const waiting = this.#byPort.get(port);
    if (!waiting) return [];
    this.#byPort.delete(port);
    return [...waiting];
  }

  /** A panel disconnected: drop it from every socket it was waiting on. */
  forgetPanel(panel: TPanel): void {
    for (const [port, waiting] of this.#byPort) {
      if (waiting.delete(panel) && waiting.size === 0) this.#byPort.delete(port);
    }
  }

  /**
   * A bridge socket died: drop its waiters. Load-bearing — the port returns to the
   * pool, so without this a NEW worker on the same port would answer its own
   * `list_skills` into the old panel's menu.
   */
  forgetPort(port: number): void {
    this.#byPort.delete(port);
  }

  /** Ports with at least one waiter — for tests, to prove nothing is left behind. */
  trackedPorts(): number {
    return this.#byPort.size;
  }
}
