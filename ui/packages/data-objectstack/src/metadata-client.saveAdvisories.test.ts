/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `MetadataClient.save` must surface the runtime authoring gate's advisory
 * findings (objectui#4133; backend objectstack#7435, landed as `89d7b35a7`).
 *
 * The save SUCCEEDED — a 200, the row persisted, the version bumped. The gate
 * simply noticed something worth telling the author, and before this the
 * findings were parsed off the wire and dropped on the floor client-side. These
 * pins are the red-first evidence: with the emit removed from `save()`, the
 * "renders the findings" cases below fail because no event ever arrives.
 *
 * The measured example the card is built on: a `nightly_purge` flow whose only
 * defect is a `delete_record` node with `multi: true` and no filter yields
 * `errors = 0 / advisories = 1` — a 200 the author currently learns nothing from.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  MetadataClient,
  readSaveAdvisories,
  type MetadataSaveAdvisoryEvent,
  type RuntimeAuthoringIssue,
} from './metadata-client';

/** The measured `nightly_purge` finding, in the spec's D3 shape. */
const PURGE_ADVISORY: RuntimeAuthoringIssue = {
  severity: 'warning',
  rule: 'flow/delete-without-filter',
  where: 'flow "nightly_purge" · node "purge old rows"',
  path: 'flows[0].nodes[2].config.filters',
  message: 'this delete_record node sets multi: true with no filter, so it deletes every row',
  hint: 'add a filter, or set multi: false to delete a single record',
};

function saveResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function clientWith(
  responseBody: unknown,
  onSaveAdvisory?: (ev: MetadataSaveAdvisoryEvent) => void,
) {
  return new MetadataClient({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async () => saveResponse(responseBody)) as unknown as typeof fetch,
    ...(onSaveAdvisory ? { onSaveAdvisory } : {}),
  });
}

const CLEAN_BODY = { success: true, version: 'v2', seq: 4, state: 'active' };

describe('MetadataClient.save — runtime authoring gate advisories (#4133)', () => {
  it('emits the findings a successful save returned', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith(
      { ...CLEAN_BODY, advisories: [PURGE_ADVISORY] },
      (e) => events.push(e),
    );

    await client.save('flow', 'nightly_purge', { name: 'nightly_purge' });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'flow',
      name: 'nightly_purge',
      // #5026 — the event now names its door, and this is the SAVE one. The
      // whole-object assertion is deliberate: it is what would catch the
      // publish door's `door: 'publish'` leaking into a save.
      door: 'save',
      mode: 'publish',
      advisories: [PURGE_ADVISORY],
    });
  });

  it('carries rule, message and hint through verbatim — they are server prose', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith(
      { ...CLEAN_BODY, advisories: [PURGE_ADVISORY] },
      (e) => events.push(e),
    );

    await client.save('flow', 'nightly_purge', {});

    const [finding] = events[0]!.advisories;
    expect(finding!.rule).toBe('flow/delete-without-filter');
    expect(finding!.message).toBe(PURGE_ADVISORY.message);
    expect(finding!.hint).toBe(PURGE_ADVISORY.hint);
    // Never `error` on this channel — an error-severity finding is a 422.
    expect(finding!.severity).toBe('warning');
  });

  it('says nothing on a clean save — the server omits the key entirely', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith(CLEAN_BODY, (e) => events.push(e));

    await client.save('object', 'account', { name: 'account' });

    expect(events).toEqual([]);
  });

  it('says nothing when the array is present but empty', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith({ ...CLEAN_BODY, advisories: [] }, (e) => events.push(e));

    await client.save('object', 'account', {});

    expect(events).toEqual([]);
  });

  it('still returns the save response unchanged', async () => {
    const body = { ...CLEAN_BODY, advisories: [PURGE_ADVISORY] };
    const client = clientWith(body, () => {});

    const result = await client.save('flow', 'nightly_purge', {});

    expect(result).toEqual(body);
  });

  it('a throwing sink never fails a save the server already committed', async () => {
    const client = clientWith({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] }, () => {
      throw new Error('renderer exploded');
    });

    await expect(client.save('flow', 'nightly_purge', {})).resolves.toBeTruthy();
  });

  /**
   * The honest control for the coverage statement (#4133 requirement 3).
   *
   * A `mode: 'draft'` save is a PUT through the same save door, but the
   * framework's gate returns at its D1 early-return before running a single
   * rule — `runtime-authoring-gate.ts`:
   *
   *     // D1 — drafts are never gated. Publishing one runs this same function.
   *     if (args.state !== 'active') return null;
   *
   * so the server produces no findings and the response carries no key. The
   * client is not what suppresses this; there is nothing to suppress. Pinned
   * because Studio's designer saves as draft on EVERY edit, which is why the
   * affordance renders nothing on that flow today.
   */
  it('a draft save carries no findings — the gate never ran (D1)', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith({ ...CLEAN_BODY, state: 'draft' }, (e) => events.push(e));

    await client.save('flow', 'nightly_purge', {}, { mode: 'draft' });

    expect(events).toEqual([]);
  });

  it('labels the mode when a draft save does somehow advise', async () => {
    // Not reachable through today's server (see D1 above), but the event's
    // `mode` must tell the truth about which door it came through rather than
    // hard-coding one, so the field is pinned on its own.
    const events: MetadataSaveAdvisoryEvent[] = [];
    const client = clientWith(
      { ...CLEAN_BODY, state: 'draft', advisories: [PURGE_ADVISORY] },
      (e) => events.push(e),
    );

    await client.save('flow', 'nightly_purge', {}, { mode: 'draft' });

    expect(events[0]!.mode).toBe('draft');
  });

  it('survives the withEnvironment clone — console clients are all env-scoped', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const base = new MetadataClient({
      baseUrl: 'http://test.local',
      fetch: vi.fn(async () =>
        saveResponse({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] }),
      ) as unknown as typeof fetch,
      onSaveAdvisory: (e) => events.push(e),
    });

    await base.withEnvironment('env_1').save('flow', 'nightly_purge', {});

    expect(events).toHaveLength(1);
  });

  it('survives the withPreviewDrafts clone', async () => {
    const events: MetadataSaveAdvisoryEvent[] = [];
    const base = new MetadataClient({
      baseUrl: 'http://test.local',
      fetch: vi.fn(async () =>
        saveResponse({ ...CLEAN_BODY, advisories: [PURGE_ADVISORY] }),
      ) as unknown as typeof fetch,
      onSaveAdvisory: (e) => events.push(e),
    });

    await base.withPreviewDrafts(true).save('flow', 'nightly_purge', {});

    expect(events).toHaveLength(1);
  });
});

describe('readSaveAdvisories', () => {
  it('reads a well-formed array', () => {
    expect(readSaveAdvisories({ advisories: [PURGE_ADVISORY] })).toEqual([PURGE_ADVISORY]);
  });

  it('returns empty for a response with no advisories key', () => {
    expect(readSaveAdvisories(CLEAN_BODY)).toEqual([]);
  });

  it.each([
    ['null body', null],
    ['a string body', 'nope'],
    ['a non-array advisories', { advisories: { rule: 'x' } }],
  ])('returns empty for %s', (_label, body) => {
    expect(readSaveAdvisories(body)).toEqual([]);
  });

  it('drops half-shaped findings rather than rendering blanks at the author', () => {
    const out = readSaveAdvisories({
      advisories: [PURGE_ADVISORY, { rule: 'only-a-rule' }, null, 'string'],
    });
    expect(out).toEqual([PURGE_ADVISORY]);
  });
});
