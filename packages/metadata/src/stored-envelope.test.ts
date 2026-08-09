// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5309 — the stored ENVELOPE / authored BODY split.
 *
 * `peelStoredEnvelope` is the parse boundary between the metadata layer's
 * bookkeeping and the document a spec schema is entitled to judge. Two callers
 * depend on it agreeing with itself: `buildEndpointIndex` (the load-time
 * backstop) and `gateApiItemsForPublish` (the publish gate). Every clause of
 * the rule is pinned here, because the two callers' own tests can only observe
 * its consequences.
 *
 * The rule, restated: a row that carries a `metadata` value IS an envelope
 * around it (everything beside it is bookkeeping, by construction); otherwise
 * the body is the row minus the declared `STORED_ENVELOPE_KEYS`.
 */

import { describe, it, expect } from 'vitest';
import { ApiEndpointSchema } from '@objectstack/spec/api';
import {
  peelStoredEnvelope,
  storedItemName,
  STORED_ENVELOPE_KEYS,
  STORED_BODY_KEY,
} from './stored-envelope.js';

const AUTHORED = {
  name: 'list_tasks',
  path: '/api/v1/apps/showcase/tasks',
  method: 'GET',
  type: 'object_operation',
  target: 'showcase_task',
} as const;

describe('peelStoredEnvelope — the flat shape', () => {
  it('takes every declared bookkeeping key off the body and keeps it on the envelope', () => {
    const row = {
      ...AUTHORED,
      package: 'com.objectstack.showcase',
      packageId: 'com.objectstack.showcase',
      state: 'active',
      version: 3,
      publishedAt: '2026-08-08T00:00:00.000Z',
      publishedBy: 'usr_admin',
      publishedDefinition: { name: 'list_tasks' },
    };

    const { envelope, body, wrapped } = peelStoredEnvelope(row);

    expect(wrapped).toBe(false);
    expect(body).toEqual(AUTHORED);
    for (const key of STORED_ENVELOPE_KEYS) {
      expect(body, `'${key}' must not reach the body`).not.toHaveProperty(key);
      expect(envelope, `'${key}' must stay on the envelope`).toHaveProperty(key);
    }
    expect(envelope.packageId).toBe('com.objectstack.showcase');
    expect(envelope.state).toBe('active');
  });

  it('keeps a key that is body vocabulary — the list is bookkeeping, not a denylist of names', () => {
    // `name` is written by nobody but the author and is required by every
    // metadata schema; it must survive the peel on BOTH shapes.
    const { body } = peelStoredEnvelope({ ...AUTHORED, packageId: 'pkg' });
    expect((body as Record<string, unknown>).name).toBe('list_tasks');
  });

  it('hands back the SAME object when the row carries no bookkeeping at all', () => {
    // An authored declaration must not even change identity: nothing about an
    // authoring parse may shift because storage learned to peel.
    const authored = { ...AUTHORED };
    const { envelope, body, wrapped } = peelStoredEnvelope(authored);

    expect(body).toBe(authored);
    expect(wrapped).toBe(false);
    expect(envelope).toEqual({});
  });

  it('never mutates the row it was handed', () => {
    const row = { ...AUTHORED, packageId: 'pkg', state: 'draft' };
    const before = structuredClone(row);

    peelStoredEnvelope(row);

    expect(row).toEqual(before);
  });
});

describe('peelStoredEnvelope — the publish envelope shape', () => {
  it('reads the body out of `metadata` and treats every sibling key as envelope', () => {
    const row = {
      name: 'list_tasks',
      packageId: 'com.objectstack.showcase',
      state: 'draft',
      // An outer key that is NOT on the declared list is still envelope here:
      // the row said so by wrapping its body.
      updatedAt: '2026-08-08T00:00:00.000Z',
      [STORED_BODY_KEY]: AUTHORED,
    };

    const { envelope, body, wrapped } = peelStoredEnvelope(row);

    expect(wrapped).toBe(true);
    expect(body).toBe(row.metadata);
    expect(envelope).toEqual({
      name: 'list_tasks',
      packageId: 'com.objectstack.showcase',
      state: 'draft',
      updatedAt: '2026-08-08T00:00:00.000Z',
    });
  });

  it('falls through to the flat shape when `metadata` is null or undefined', () => {
    // Mirrors the `data.metadata ?? data` rule this peel replaces — a row with
    // an empty body slot is judged as the flat row it otherwise is.
    for (const empty of [null, undefined]) {
      const { body, wrapped } = peelStoredEnvelope({ ...AUTHORED, packageId: 'pkg', metadata: empty });
      expect(wrapped).toBe(false);
      expect(body).toEqual(AUTHORED);
    }
  });

  it('hands a non-object `metadata` through as the body, for the schema to refuse', () => {
    // Peeling is not judging: a body of the wrong TYPE is the schema's finding
    // to report, with its own message, not something to silently repair here.
    const { body, wrapped } = peelStoredEnvelope({ name: 'x', metadata: 'not-a-document' });
    expect(wrapped).toBe(true);
    expect(body).toBe('not-a-document');
  });
});

describe('peelStoredEnvelope — degenerate inputs stay the schema’s problem', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'nope'],
    ['a number', 7],
    ['an array', [{ name: 'x' }]],
  ])('hands %s straight back as the body with an empty envelope', (_label, input) => {
    const { envelope, body, wrapped } = peelStoredEnvelope(input);
    expect(body).toBe(input);
    expect(wrapped).toBe(false);
    expect(envelope).toEqual({});
  });
});

describe('storedItemName — the row’s own name, for a diagnostic', () => {
  it('reads the flat shape’s body name', () => {
    expect(storedItemName(peelStoredEnvelope({ ...AUTHORED, packageId: 'pkg' }))).toBe('list_tasks');
  });

  it('prefers the envelope name on the publish envelope shape', () => {
    // Same answer `item.name` gave before the split — the outer name is the
    // name the metadata layer knows the row by.
    const peeled = peelStoredEnvelope({ name: 'outer_name', metadata: { ...AUTHORED, name: 'inner_name' } });
    expect(storedItemName(peeled)).toBe('outer_name');
  });

  it('falls back to the body name when the envelope carries none', () => {
    expect(storedItemName(peelStoredEnvelope({ metadata: AUTHORED }))).toBe('list_tasks');
  });

  it('returns undefined when no name can be found — the caller decides the placeholder', () => {
    expect(storedItemName(peelStoredEnvelope({ path: '/x' }))).toBeUndefined();
    expect(storedItemName(peelStoredEnvelope(undefined))).toBeUndefined();
  });
});

/**
 * [#5384] The other half of the split, asserted from this side.
 *
 * `ApiEndpointSchema` closed with `strictObject`, and its `guidance` table
 * carries a wrong-layer prescription for each stored-envelope key: meeting one
 * on an AUTHORED declaration means somebody hand-wrote bookkeeping into a
 * document, where it has never configured anything. That table is a second copy
 * of `STORED_ENVELOPE_KEYS`, one package away, and `packages/spec` may not
 * import from here (Prime Directive #2) — so the copies are pinned equal
 * BEHAVIOURALLY, from the side that is allowed to see both.
 *
 * The drift this catches is one-directional and silent: a seventh bookkeeping
 * key added to `STORED_ENVELOPE_KEYS` would be peeled correctly on the stored
 * paths (so every test above stays green) while an author who wrote it by hand
 * got the generic "unrecognized key" instead of the prescription — the rejection
 * arriving without the upgrade, which is finding 7's shape.
 */
describe('[#5384] every stored-envelope key carries a wrong-layer prescription on the authoring surface', () => {
  it.each([...STORED_ENVELOPE_KEYS])('`%s` is refused by name, with the bookkeeping prescription', (key) => {
    const result = ApiEndpointSchema.safeParse({ ...AUTHORED, [key]: 'anything' });

    expect(result.success, `\`${key}\` parsed clean on an authored endpoint`).toBe(false);
    const unknown = result.error!.issues.find(
      (i) => i.code === 'unrecognized_keys' && (i as { keys?: string[] }).keys?.includes(key),
    );
    expect(unknown, `\`${key}\` was not reported as an unrecognized key`).toBeDefined();
    // The prescription, not merely a rejection: it must name the layer that
    // owns the key and tell the author what to do instead.
    expect(unknown!.message).toContain('storage bookkeeping');
    expect(unknown!.message).toContain('#5309');
  });

  it('CONTROL — the same body without a bookkeeping key parses, so the case above cannot pass vacuously', () => {
    const clean = ApiEndpointSchema.safeParse({ ...AUTHORED });
    expect(clean.success).toBe(true);
  });

  it('CONTROL — `metadata` (the BODY key) is not bookkeeping and gets no prescription', () => {
    // STORED_BODY_KEY is the envelope's carrier, never a declared endpoint key.
    // It must still be refused — but as a plain unknown key, because telling an
    // author it is "storage bookkeeping to remove" would misdescribe it.
    const result = ApiEndpointSchema.safeParse({ ...AUTHORED, [STORED_BODY_KEY]: {} });
    expect(result.success).toBe(false);
    const unknown = result.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(unknown).toBeDefined();
    expect(unknown!.message).not.toContain('storage bookkeeping');
  });
});
