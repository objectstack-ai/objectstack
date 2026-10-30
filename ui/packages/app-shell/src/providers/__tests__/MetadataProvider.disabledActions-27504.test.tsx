// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27504 — the LIST read's `disabledActions` reaches the objects
 * the console renders from.
 *
 * `GET /api/v1/meta/object` serves, beside `items`, the switched-off action
 * names keyed by object. The record page and the list views read their
 * actions off `useMetadata().objects`, so the provider stamps each object's
 * entries as it stores the list; the action gates then stop offering them.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { isActionSwitchedOff, markSwitchedOffActions } from '@object-ui/core';
import { MetadataProvider, useMetadata } from '../MetadataProvider';

type Ctx = ReturnType<typeof useMetadata>;

const TASK = {
  name: 'showcase_task',
  actions: [{ name: 'showcase_mark_done' }, { name: 'showcase_log_time' }],
};

function makeAdapter(listBody: Record<string, unknown>, served: Record<string, any> = {}) {
  return {
    clearCache: vi.fn(),
    invalidateCache: vi.fn(),
    // The adapter's by-name read, already stamped from its own envelope
    // (`getObjectSchema.disabledActions-27504.test.ts` pins that half).
    getObjectSchema: (name: string) => Promise.resolve(served[name] ?? null),
    getClient: () => ({
      meta: {
        getItems: (type: string) =>
          Promise.resolve(type === 'object' ? structuredClone(listBody) : { type, items: [] }),
        getItem: () => Promise.resolve({ item: null }),
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

async function mount(listBody: Record<string, unknown>, served: Record<string, any> = {}): Promise<Ctx> {
  let ctx: Ctx | null = null;
  function Probe() {
    ctx = useMetadata();
    return null;
  }
  render(
    <MetadataProvider adapter={makeAdapter(listBody, served)}>
      <Probe />
    </MetadataProvider>,
  );
  await waitFor(() => expect(ctx).not.toBeNull());
  return ctx as unknown as Ctx;
}

async function objectsServed(listBody: Record<string, unknown>): Promise<any[]> {
  let ctx: Ctx | null = null;
  function Probe() {
    ctx = useMetadata();
    void ctx.objects;
    return null;
  }
  render(
    <MetadataProvider adapter={makeAdapter(listBody)}>
      <Probe />
    </MetadataProvider>,
  );
  await waitFor(() => expect((ctx as unknown as Ctx | null)?.objects?.length).toBe(1));
  return (ctx as unknown as Ctx).objects as any[];
}

describe('MetadataProvider stamps the list envelope disabledActions (objectstack#27504)', () => {
  it('marks the named entry of the named object', async () => {
    const [task] = await objectsServed({
      type: 'object',
      items: [TASK],
      disabledActions: { showcase_task: ['showcase_mark_done'] },
    });
    const byName = (n: string) => task.actions.find((a: any) => a.name === n);
    expect(isActionSwitchedOff(byName('showcase_mark_done'))).toBe(true);
    expect(isActionSwitchedOff(byName('showcase_log_time'))).toBe(false);
  });

  it('marks nothing when the envelope carries no `disabledActions`', async () => {
    const [task] = await objectsServed({ type: 'object', items: [TASK] });
    expect(task.actions.some(isActionSwitchedOff)).toBe(false);
  });

  it('keeps the adapter\'s stamp on the by-name read, which hands out a private copy', async () => {
    // `structuredClone` drops symbol keys: without carrying the stamp across,
    // the record header (`useMetadataItem` → this read) kept a live button.
    const ctx = await mount(
      { type: 'object', items: [] },
      { showcase_task: markSwitchedOffActions(structuredClone(TASK), ['showcase_mark_done']) },
    );
    const item = await ctx.getItem('object', 'showcase_task');
    const byName = (n: string) => item.actions.find((a: any) => a.name === n);
    expect(isActionSwitchedOff(byName('showcase_mark_done'))).toBe(true);
    expect(isActionSwitchedOff(byName('showcase_log_time'))).toBe(false);
  });
});
