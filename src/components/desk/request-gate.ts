/**
 * Latest-request-wins gate for async loads. `begin()` hands out a ticket;
 * only the most recent ticket is current. `invalidate()` (e.g. on project
 * switch) makes every outstanding ticket stale so late responses are dropped.
 */
export interface RequestGate {
  begin(): number;
  invalidate(): void;
  isCurrent(ticket: number): boolean;
}

export function createRequestGate(): RequestGate {
  let current = 0;
  return {
    begin: () => ++current,
    invalidate: () => {
      current += 1;
    },
    isCurrent: (ticket) => ticket === current,
  };
}

export type GatedHandlers<T> = {
  /** Runs only if this call is still the latest when the data arrives. */
  onData: (data: T) => void;
  /** Runs only if this call is still the latest when it fails. */
  onError: (err: unknown) => void;
  /** Runs for every failure, latest or not (e.g. forget an id the server says is gone). */
  onAnyError?: (err: unknown) => void;
  /** Runs at the end only if this call is still the latest. */
  onSettled?: () => void;
};

/**
 * Take a ticket, await `work`, and apply the outcome only while the ticket is
 * current. A newer `run` or an `invalidate()` makes every earlier completion
 * (data, error and settle) a no-op. Resolves to whether this call applied.
 */
export async function runLatest<T>(gate: RequestGate, work: () => Promise<T>, handlers: GatedHandlers<T>): Promise<boolean> {
  const ticket = gate.begin();
  try {
    const data = await work();
    if (!gate.isCurrent(ticket)) return false;
    handlers.onData(data);
    return true;
  } catch (err) {
    handlers.onAnyError?.(err);
    if (!gate.isCurrent(ticket)) return false;
    handlers.onError(err);
    return true;
  } finally {
    if (gate.isCurrent(ticket)) handlers.onSettled?.();
  }
}
