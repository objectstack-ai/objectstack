/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * End-to-end pin for objectui#4237: a save through the SECOND client class
 * reaches the shell's warning surface.
 *
 * `MetadataService` is the most user-reachable of the callers #4237 enumerates
 * — it is what the Object Manager and Field Designer persist through, five save
 * sites in one class — and it is deliberately NOT edited by that fix. That is
 * the claim under test: the emitter sits at the adapter/client seam, so a caller
 * that says nothing about advisories still gets them rendered.
 *
 * The chain exercised here, with nothing stubbed in the middle:
 *
 *   MetadataService.saveObject
 *     → adapter.getClient().meta.saveItem          (the enumerated call site)
 *       → the SDK's real PUT + `unwrapResponse`    (fake `fetch` answers 200)
 *         → the adapter's save-advisory interceptor
 *           → adapter.onSaveAdvisory subscribers   (what AdapterProvider wires)
 *             → emitSaveAdvisories                 (the #4133/#4236 renderer)
 *               → the warning tier
 *
 * `AdapterProvider` is what wires the last two links in the real app; the sink
 * is handed over here instead of mounting a toaster, exactly as
 * `saveAdvisoryToast.test.ts` does, so nothing depends on module mocking.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter, type MetadataSaveAdvisoryEvent } from '@object-ui/data-objectstack';
import type { ObjectDefinition } from '@object-ui/types';
import { MetadataService, type FieldMetadataPayload } from './MetadataService';
import { emitSaveAdvisories, type TranslateFn } from '../providers/saveAdvisoryToast';

const PURGE_ADVISORY = {
  severity: 'warning' as const,
  rule: 'flow/delete-without-filter',
  where: 'flow "nightly_purge" · node "purge old rows"',
  path: 'flows[0].nodes[2].config.filters',
  message: 'this delete_record node sets multi: true with no filter, so it deletes every row',
  hint: 'add a filter, or set multi: false to delete a single record',
};

const CLEAN_BODY = { success: true, version: 'v2', seq: 4, state: 'active' as const };

/** i18next-shaped `t` that renders the inline default with its holes filled. */
const t: TranslateFn = (key, options) => {
  const raw = (options?.defaultValue as string) ?? key;
  let out = raw;
  for (const [k, v] of Object.entries(options ?? {})) {
    if (k === 'defaultValue') continue;
    out = out.split(`{{${k}}}`).join(String(v));
  }
  return out;
};

function makeSink() {
  return {
    warning: vi.fn<(title: string, opts?: { description?: string; duration?: number }) => void>(),
    // Present so a mistaken `sink.error(...)` is observable rather than a
    // TypeError — the assertion below is that it is never reached.
    error: vi.fn(),
    success: vi.fn(),
  };
}

/**
 * A real adapter answering every metadata PUT with `body`, with the shell's
 * `AdapterProvider` wiring reproduced: one `onSaveAdvisory` subscription that
 * renders through `emitSaveAdvisories` into a caller-owned sink.
 */
function makeWiredAdapter(body: unknown) {
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch,
  });
  const sink = makeSink();
  const events: MetadataSaveAdvisoryEvent[] = [];
  adapter.onSaveAdvisory((ev) => {
    events.push(ev);
    emitSaveAdvisories(ev, t, sink);
  });
  return { adapter, sink, events };
}

// `id` is required by `ObjectDefinition` and the fixture never carried it, while
// `fields` is not a key of `ObjectDefinition` at all (`saveObject` takes the
// field list as its SECOND parameter). The `as ObjectDefinition` asserted past
// both, and once compiled the assertion itself is rejected as a non-overlap
// (objectui#4040). Declared properly instead of widening the cast.
const ACCOUNT: ObjectDefinition = { id: 'account', name: 'account', label: 'Account' };

// objectui#6490 made that second parameter REQUIRED. `ObjectSchema.fields` is a
// required record, so a `saveObject` call that omitted the list built a body the
// server refused `422 INVALID_METADATA` every time it ran — these suites were
// asserting the advisory channel on top of a save that could never have
// succeeded against a real backend. The field list is not this file's subject,
// so it hands over the smallest well-formed one; nothing else about these
// assertions changes.
const ACCOUNT_FIELDS: FieldMetadataPayload[] = [{ name: 'name', type: 'text', label: 'Name' }];

describe('MetadataService saves reach the shell advisory surface (#4237)', () => {
  it('renders the gate findings for a save that succeeded', async () => {
    const { adapter, sink, events } = makeWiredAdapter({
      ...CLEAN_BODY,
      advisories: [PURGE_ADVISORY],
    });

    await new MetadataService(adapter).saveObject(ACCOUNT, ACCOUNT_FIELDS);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'object', name: 'account', mode: 'publish' });
    expect(sink.warning).toHaveBeenCalledTimes(1);
  });

  it('lands on the WARNING tier and says "Saved" first — the write succeeded', async () => {
    const { adapter, sink } = makeWiredAdapter({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] });

    await new MetadataService(adapter).saveObject(ACCOUNT, ACCOUNT_FIELDS);

    const [title, opts] = sink.warning.mock.calls[0]!;
    expect(title).toMatch(/^Saved/);
    expect(sink.error).not.toHaveBeenCalled();
    // Server prose, rendered verbatim.
    expect(opts!.description).toContain(PURGE_ADVISORY.message);
    expect(opts!.description).toContain(PURGE_ADVISORY.hint);
  });

  it('a clean save renders no new UI', async () => {
    const { adapter, sink, events } = makeWiredAdapter(CLEAN_BODY);

    await new MetadataService(adapter).saveObject(ACCOUNT, ACCOUNT_FIELDS);

    expect(events).toEqual([]);
    expect(sink.warning).not.toHaveBeenCalled();
    expect(sink.error).not.toHaveBeenCalled();
    expect(sink.success).not.toHaveBeenCalled();
  });

  it("covers the service's generic save door too, not just saveObject", async () => {
    const { adapter, sink } = makeWiredAdapter({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] });

    await new MetadataService(adapter).saveMetadataItem('flow', 'nightly_purge', {
      name: 'nightly_purge',
    });

    expect(sink.warning).toHaveBeenCalledTimes(1);
  });

  it('still performs the save — the advisory channel changes nothing about it', async () => {
    const { adapter } = makeWiredAdapter({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] });
    const invalidate = vi.spyOn(adapter, 'invalidateCache');

    await expect(new MetadataService(adapter).saveObject(ACCOUNT, ACCOUNT_FIELDS)).resolves.toBeUndefined();

    // The service's own post-save step still runs.
    expect(invalidate).toHaveBeenCalledWith('object:account');
  });
});
