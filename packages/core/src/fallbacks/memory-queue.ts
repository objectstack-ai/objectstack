// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * In-memory publish/subscribe queue fallback.
 *
 * Implements the IQueueService contract with synchronous in-process delivery.
 * Used by ObjectKernel as an automatic fallback when no real queue plugin
 * (e.g. BullMQ / RabbitMQ) is registered.
 *
 * [#4058] `degraded`, not `stub` (ADR-0076 D12): messages really reach real
 * subscribers — synchronously, in-process, with no durability or retry.
 * `getQueueSize()` answering 0 follows from that rather than faking it: nothing
 * is ever buffered. `handlerReady: false` — no HTTP surface exists for `queue`.
 */
export function createMemoryQueue() {
  const handlers = new Map<string, Function[]>();
  let msgId = 0;
  return {
    __serviceInfo: {
      status: 'degraded' as const,
      handlerReady: false,
      message: 'Synchronous in-process delivery — no durability, retry, or cross-instance fan-out. Register a queue plugin (e.g. BullMQ) for a real one.',
    },
    _serviceName: 'queue',
    async publish<T = unknown>(queue: string, data: T): Promise<string> {
      const id = `fallback-msg-${++msgId}`;
      const fns = handlers.get(queue) ?? [];
      for (const fn of fns) fn({ id, data, attempts: 1, timestamp: Date.now() });
      return id;
    },
    async subscribe(queue: string, handler: (msg: any) => Promise<void>): Promise<void> {
      handlers.set(queue, [...(handlers.get(queue) ?? []), handler]);
    },
    async unsubscribe(queue: string): Promise<void> { handlers.delete(queue); },
    async getQueueSize(): Promise<number> { return 0; },
    async purge(queue: string): Promise<void> { handlers.delete(queue); },
  };
}
