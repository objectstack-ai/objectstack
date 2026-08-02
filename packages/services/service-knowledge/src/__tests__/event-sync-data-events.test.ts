// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4626 — the knowledge event sync reads the FULFILLED `DataEvent`.
 *
 * `data.record.*` envelopes carry the spec's `DataEvent` in `payload`: the
 * written row is `after`, the id is the required top-level `recordId`. The
 * shared branch this sync used to take read the payload itself as if it were
 * the record, so an object source indexed `{ recordId, after }` — a document
 * with none of the record's fields — and a delete never resolved an id at all.
 */

import { describe, it, expect, vi } from 'vitest';
import type { RealtimeEventHandler, RealtimeEventPayload } from '@objectstack/spec/contracts';
import { KnowledgeServicePlugin } from '../knowledge-service-plugin';
import type { KnowledgeService } from '../knowledge-service';

function makeCtx() {
  let readyHook: (() => Promise<void>) | undefined;
  let handler: RealtimeEventHandler | undefined;
  let service: KnowledgeService | undefined;

  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    hook: (name: string, fn: () => Promise<void>) => {
      if (name === 'kernel:ready') readyHook = fn;
    },
    registerService: (_name: string, svc: KnowledgeService) => { service = svc; },
    getService: (name: string) => {
      if (name === 'realtime') {
        return {
          publish: async () => undefined,
          subscribe: async (_channel: string, h: RealtimeEventHandler) => { handler = h; return 'sub-1'; },
          unsubscribe: async () => undefined,
        };
      }
      throw new Error(`no service ${name}`);
    },
  };

  return {
    ctx,
    async boot(plugin: KnowledgeServicePlugin) {
      await plugin.init(ctx);
      await plugin.start(ctx);
      await readyHook?.();
      return {
        service: service!,
        deliver: (event: RealtimeEventPayload) => handler!(event),
      };
    },
  };
}

const CREATED: RealtimeEventPayload = {
  type: 'data.record.created',
  object: 'task',
  payload: {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    type: 'data.record.created',
    object: 'task',
    recordId: 'task_1',
    after: { id: 'task_1', title: 'Ship it', notes: 'the record body' },
    timestamp: '2026-08-02T12:00:00.000Z',
  },
  timestamp: '2026-08-02T12:00:00.000Z',
};

const DELETED: RealtimeEventPayload = {
  type: 'data.record.deleted',
  object: 'task',
  payload: {
    id: '1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7081',
    type: 'data.record.deleted',
    object: 'task',
    recordId: 'task_1',
    timestamp: '2026-08-02T12:00:01.000Z',
  },
  timestamp: '2026-08-02T12:00:01.000Z',
};

describe('#4626 — KnowledgeServicePlugin event sync on data.record.*', () => {
  it('upserts the RECORD (payload.after), not the event envelope', async () => {
    const harness = makeCtx();
    const { service, deliver } = await harness.boot(new KnowledgeServicePlugin());
    const upsert = vi.spyOn(service, 'handleRecordUpsert').mockResolvedValue(undefined);

    await deliver(CREATED);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toBe('task');
    expect(upsert.mock.calls[0][1]).toEqual({ id: 'task_1', title: 'Ship it', notes: 'the record body' });
  });

  it('resolves the delete id from the required top-level recordId', async () => {
    const harness = makeCtx();
    const { service, deliver } = await harness.boot(new KnowledgeServicePlugin());
    const del = vi.spyOn(service, 'handleRecordDelete').mockResolvedValue(undefined);

    await deliver(DELETED);

    expect(del).toHaveBeenCalledWith('task', 'task_1');
  });

  it('ignores a data event that carries no record body', async () => {
    const harness = makeCtx();
    const { service, deliver } = await harness.boot(new KnowledgeServicePlugin());
    const upsert = vi.spyOn(service, 'handleRecordUpsert').mockResolvedValue(undefined);

    await deliver({
      ...CREATED,
      payload: { ...(CREATED.payload as Record<string, unknown>), after: undefined },
    });

    expect(upsert).not.toHaveBeenCalled();
  });
});
