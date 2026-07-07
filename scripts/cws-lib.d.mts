/** Type declarations for the pure Chrome Web Store release helpers. */

export const TRANSIENT: RegExp;

export interface StepResult {
  ok: boolean;
  output?: string;
}

export interface Outcome {
  action: 'ok' | 'fail';
  step: string;
  locked: boolean;
  output: string;
}

export function classifyOutcome(step: 'upload' | 'publish', result: StepResult): Outcome;

export function failureMessage(outcome: { step: string; locked: boolean }, version: string): string;

/** The minimal shape of `fetch` that {@link deleteTagRef} relies on. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<{ status: number }>;

export function deleteTagRef(opts: {
  tag: string;
  repo: string;
  token: string;
  fetchImpl?: FetchLike;
}): Promise<boolean>;
