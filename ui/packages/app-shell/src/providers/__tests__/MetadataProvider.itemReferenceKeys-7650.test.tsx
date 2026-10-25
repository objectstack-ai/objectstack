// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7650 — the BY-NAME object-schema serve path canonicalizes too.
 *
 * ## What was broken
 *
 * `MetadataProvider` has two paths that hand an object schema to a reader, and
 * only one of them normalized:
 *
 *   - `ensureType('object')` — the LIST path — ran `normalizeSchemaReferenceKeys`
 *     over every fetched item (objectui#2407 / PR #2587).
 *   - `getItem('object', name)` — the BY-NAME path, behind the PUBLISHED
 *     `useMetadataItem` hook — ran `extractItem`, which only unwraps the
 *     `{ item }` envelope and normalizes nothing.
 *
 * So which spelling a reader saw depended on cache order rather than on the
 * document: warm (list already fetched) it got the stamped def, cold it got
 * whatever single key the producer stored. objectui#7650 measured that the
 * serve path never parses, so `FieldSchema` strictness is no evidence a legacy
 * spelling cannot reach a consumer — a document stored before the key was
 * tightened is served verbatim, forever.
 *
 * ## What these pins hold
 *
 * The assertions read the value a CONSUMER gets back from `getItem`, never the
 * provider's internals — a re-plumbing that still served an unstamped def by
 * some other route would satisfy an internals assertion and violate the card.
 *
 * The negative pins are the load-bearing half: a normalizer that fired for
 * every metadata type, or that overwrote a key the producer had already set,
 * would pass every positive assertion here.
 *
 * ⚠️ objectui#11070 round 4 retired the `reference_to` STAMP: the pass now only
 * FOLDS a legacy spelling onto `reference`. A `reference`-only def therefore
 * comes back unchanged and cannot show that the pass ran, so every positive pin
 * below feeds a LEGACY spelling and reads `reference` back. The first pin used
 * to assert the stamp and now asserts its absence.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MetadataProvider, useMetadata } from '../MetadataProvider';

type Ctx = ReturnType<typeof useMetadata>;

/**
 * Serves ONE named document per type from `docs`, and records every by-name
 * fetch so the cache-order pin can prove which path answered.
 */
function makeAdapter(docs: Record<string, Record<string, unknown>>, itemCalls: string[]) {
  return {
    clearCache: vi.fn(),
    invalidateCache: vi.fn(),
    // objectui#13044 — the provider's by-name OBJECT read goes through the
    // adapter's `getObjectSchema`. This double answers it from the same
    // by-name door, unwrapped the way the adapter unwraps it.
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        // The list path serves nothing: every test here starts from a COLD
        // by-name cache, which is exactly the state the bug needed.
        getItems: (type: string) => Promise.resolve({ type, items: [] }),
        getItem: (type: string, name: string) => {
          itemCalls.push(`${type}/${name}`);
          const doc = docs[`${type}/${name}`];
          // Fresh clone per call — the provider normalizes IN PLACE, and a
          // shared fixture object would let one test's stamp leak into the next
          // assertion and turn a red into a green.
          return Promise.resolve({ item: doc ? structuredClone(doc) : null });
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

/** Mounts the provider and hands the live context back to the test body. */
async function withProvider(
  docs: Record<string, Record<string, unknown>>,
  itemCalls: string[] = [],
): Promise<Ctx> {
  let ctx: Ctx | null = null;
  function Probe() {
    ctx = useMetadata();
    return null;
  }
  render(
    <MetadataProvider adapter={makeAdapter(docs, itemCalls)}>
      <Probe />
    </MetadataProvider>,
  );
  await waitFor(() => expect(ctx).not.toBeNull());
  return ctx as unknown as Ctx;
}

describe('MetadataProvider.getItem canonicalizes object schemas (objectui#7650)', () => {
  it('serves a by-name object def that spells only `reference` unchanged — no `reference_to` stamped', async () => {
    const ctx = await withProvider({
      'object/account': {
        name: 'account',
        fields: { owner: { type: 'lookup', reference: 'user' } },
      },
    });

    const item = await ctx.getItem('object', 'account');

    expect(item.fields.owner).toEqual({ type: 'lookup', reference: 'user' });
  });

  it('folds `reference` onto a by-name object def that spells only the legacy `reference_to`', async () => {
    const ctx = await withProvider({
      'object/contact': {
        name: 'contact',
        fields: { account_id: { type: 'lookup', reference_to: 'account' } },
      },
    });

    const item = await ctx.getItem('object', 'contact');

    expect(item.fields.account_id.reference).toBe('account');
    expect(item.fields.account_id.reference_to).toBe('account');
  });

  it('normalizes the ARRAY field-container shape the metadata API also serves', async () => {
    const ctx = await withProvider({
      'object/lead': {
        name: 'lead',
        fields: [{ name: 'owner', type: 'lookup', reference_to: 'user' }],
      },
    });

    const item = await ctx.getItem('object', 'lead');

    expect(item.fields[0].reference).toBe('user');
  });

  it('NEGATIVE — leaves a non-`object` metadata type untouched', async () => {
    const ctx = await withProvider({
      // A `view` document that happens to carry a `fields` map. Nothing but the
      // `object` type is a field-def carrier, and normalizing one would be this
      // provider inventing a convention the contract does not declare.
      'view/account_list': {
        name: 'account_list',
        fields: { owner: { type: 'lookup', reference_to: 'user' } },
      },
    });

    const item = await ctx.getItem('view', 'account_list');

    expect(item.fields.owner.reference_to).toBe('user');
    expect(item.fields.owner.reference).toBeUndefined();
  });

  it('NEGATIVE — never overwrites a spelling the producer already set', async () => {
    const ctx = await withProvider({
      'object/opportunity': {
        name: 'opportunity',
        fields: {
          // Deliberately inconsistent: if the fold overwrote rather than
          // filled, one of these two values would change.
          owner: { type: 'lookup', reference: 'user', reference_to: 'legacy_user' },
        },
      },
    });

    const item = await ctx.getItem('object', 'opportunity');

    expect(item.fields.owner.reference).toBe('user');
    expect(item.fields.owner.reference_to).toBe('legacy_user');
  });

  it('serves the SAME canonical shape on a repeat read, without a second fetch', async () => {
    const itemCalls: string[] = [];
    const ctx = await withProvider(
      {
        'object/account': {
          name: 'account',
          fields: { owner: { type: 'lookup', reference_to: 'user' } },
        },
      },
      itemCalls,
    );

    await ctx.getItem('object', 'account');
    const second = await ctx.getItem('object', 'account');

    // The by-name cache answered the second read (so the normalization must
    // have stuck to the cached object, not to a throwaway copy).
    expect(itemCalls.filter((c) => c === 'object/account')).toHaveLength(1);
    expect(second.fields.owner.reference).toBe('user');
  });
});
