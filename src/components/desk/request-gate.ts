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
