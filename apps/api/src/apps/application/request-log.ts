/**
 * Apps · application/request-log.ts
 * Recording what apps did, without making them pay for it.
 *
 * A row per request, written inline, would put a database write on the hot path
 * of every app call — so an app doing four hundred requests a minute would be
 * charged four hundred inserts for the privilege of being observable. The log
 * buffers in memory and flushes in batches instead.
 *
 * That trade is deliberate and it is lossy: a crash drops whatever had not
 * flushed. That is the right way round for a log. Losing the last few seconds of
 * observability is survivable; making every app request slower to guarantee we
 * never do is not, and an outbox — which is what you would build if losing rows
 * were unacceptable — would cost the write we are avoiding.
 * Layer: application.
 */

import { randomUUID } from 'node:crypto';

import type { AppRequestLog, LogType } from '../domain/monitoring';

export interface RequestLogPorts {
  readonly write: (logs: readonly AppRequestLog[]) => Promise<void>;
  /** Flushed when the buffer reaches this, or when the timer fires. */
  readonly batchSize?: number;
  readonly onError?: (error: unknown) => void;
}

export class AppRequestLogger {
  private buffer: AppRequestLog[] = [];
  private flushing = false;

  constructor(private readonly ports: RequestLogPorts) {}

  private get batchSize(): number {
    return this.ports.batchSize ?? 50;
  }

  /**
   * Records one call. Never awaited by the request that produced it.
   *
   * Returning void rather than a promise is the point: a caller cannot
   * accidentally await this and put the write back on the hot path it exists to
   * keep clear.
   */
  record(entry: Omit<AppRequestLog, 'id'>): void {
    this.buffer.push({ id: randomUUID(), ...entry });
    if (this.buffer.length >= this.batchSize) void this.flush();
  }

  /** Writes what has accumulated. Safe to call concurrently. */
  async flush(): Promise<number> {
    // One flush at a time. Two overlapping ones would each take a slice of the
    // buffer and the second could write rows the first already had.
    if (this.flushing || this.buffer.length === 0) return 0;
    this.flushing = true;

    const batch = this.buffer;
    this.buffer = [];

    try {
      await this.ports.write(batch);
      return batch.length;
    } catch (error) {
      // Dropped, not retried. A log write that fails is not worth failing an
      // app's request over, and a retry queue for observability data is a
      // second outbox to operate.
      this.ports.onError?.(error);
      return 0;
    } finally {
      this.flushing = false;
    }
  }

  /** For shutdown: get what is buffered onto disk before the process ends. */
  pending(): number {
    return this.buffer.length;
  }
}

/**
 * Which log type a request is.
 *
 * Only three of the eight are producible today. Deciding it here rather than at
 * each call site means the day functions or billing exist, one function changes
 * rather than every place that records something.
 */
export function logTypeFor(path: string): LogType {
  if (path.includes('/graphql')) return 'graphql_request';
  return 'rest_request';
}
