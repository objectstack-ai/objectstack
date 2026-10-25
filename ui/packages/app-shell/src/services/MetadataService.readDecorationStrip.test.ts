/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6480 — `saveFields` does not PUT the framework's own read
 * decorations back.
 *
 * `saveFields` spreads the served object verbatim (`...existingObject`) to
 * preserve every key this service does not model. That spread is load-bearing
 * and pinned in `MetadataService.objectPayloadFieldsMap.test.ts` — but it does
 * not distinguish keys the AUTHOR owns from keys the FRAMEWORK adds on the way
 * out. `_diagnostics` and `_draft` are the second kind, and `ObjectSchema`
 * refuses both BY NAME, so a served document carrying either one produced a
 * body the schema rejects.
 *
 * ## The instrument, and why it is the spec's list rather than a local one
 *
 * Everything below reads `METADATA_READ_DECORATIONS` from
 * `@objectstack/spec/kernel` instead of hard-coding `['_diagnostics','_draft']`.
 * That is the point of the fix as much as of the test: a local copy of the list
 * silently goes stale the next time the framework adds a decoration, and a
 * decoration the writer does not know to remove is exactly the defect this card
 * describes. If the spec grows a third member, `the instrument` below starts
 * describing it and the round-trip pin covers it without an edit here.
 *
 * ## Why this is NOT "strip whatever the schema refuses" (AGENTS.md #0.1)
 *
 * The lenient-consumer shape would swallow the next genuinely-unrecognized key
 * along with these two and hide a real producer bug. The strip is bounded to
 * the keys the framework itself ADDS AT READ TIME and never stores, which is
 * why the last describe below asserts that an off-spec key the author owns
 * still goes out and still fails the schema — loudly, where someone can see it.
 *
 * ## Why dropping them is not silent loss on an upsert
 *
 * A PUT here is an upsert: an absent key is absent from the stored document,
 * so removing a key is never neutral by default. These two are the exception,
 * and by the spec's own declaration rather than by assumption — `_diagnostics`
 * is the read-path validation verdict (`decorateMetadataItem` spreads it onto
 * every read and recomputes it every time) and `_draft` reflects the row's
 * `state` column and the `mode` parameter, never the body. Neither is author
 * state, so neither can be lost by not echoing it. The keys that ARE write-path
 * state — the ADR-0010 protection envelope — are deliberately not members of
 * `METADATA_READ_DECORATIONS`, and the last test of `the instrument` pins that
 * this strip leaves them alone.
 */

import { describe, expect, it, vi } from 'vitest';
import { ObjectSchema } from '@objectstack/spec/data';
import { METADATA_READ_DECORATIONS, stripReadDecorations } from '@objectstack/spec/kernel';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import type { DesignerFieldDefinition } from '@object-ui/types';
import { MetadataService } from './MetadataService';

/**
 * Captures the bodies of every PUT the SDK issued, exactly as they went over
 * the wire, and serves a caller-supplied document to the GET `saveFields` does.
 *
 * Deliberately the same harness as `MetadataService.objectPayloadFieldsMap.test.ts`:
 * assertions read `JSON.parse` of a captured request body, so what is measured
 * is the bytes rather than an in-memory object that never had to serialise.
 */
function makeCapturingAdapter(served?: Record<string, unknown>) {
  const puts: Array<Record<string, unknown>> = [];
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PUT') {
        puts.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      }
      if (method === 'GET' && served) {
        return new Response(JSON.stringify({ item: served }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  });
  return { adapter, puts };
}

const issuesOf = (result: ReturnType<typeof ObjectSchema.safeParse>): string[] =>
  result.success ? [] : result.error.issues.map((i) => `${i.code} @ ${i.path.join('.')}`);

/** Every `unrecognized_keys` key the schema named, flattened. */
const refusedKeys = (doc: unknown): string[] => {
  const r = ObjectSchema.safeParse(doc);
  if (r.success) return [];
  return r.error.issues.flatMap((i) =>
    i.code === 'unrecognized_keys' ? ((i as unknown as { keys: string[] }).keys ?? []) : [],
  );
};

const designerField = (name: string, over: Partial<DesignerFieldDefinition> = {}): DesignerFieldDefinition => ({
  id: name,
  name,
  label: name,
  type: 'text',
  ...over,
});

/** A served document decorated exactly as the framework's read path decorates it. */
const DECORATED_SERVED = {
  name: 'account',
  label: 'Account',
  pluralLabel: 'Accounts',
  icon: 'Building',
  fields: { legacy: { type: 'text', label: 'Legacy' } },
  _diagnostics: { valid: false, errors: [{ path: 'fields.legacy', message: 'stale' }] },
  _draft: true,
} satisfies Record<string, unknown>;

// ---------------------------------------------------------------------------

describe('the instrument', () => {
  it('is the spec that names the decorations, and it names exactly these two', () => {
    // Stated before any claim about the fix. If this list grows, the pins below
    // follow it without an edit — that is why they read it rather than spell it.
    expect([...METADATA_READ_DECORATIONS]).toEqual(['_diagnostics', '_draft']);
  });

  it('refuses each decoration BY NAME — the defect, on the schema', () => {
    const base = { name: 'account', label: 'Account', fields: { n: { type: 'text', label: 'N' } } };
    // Control first, so the refusals below are a result about these keys and
    // not a schema that refuses everything.
    expect(ObjectSchema.safeParse(base).success).toBe(true);
    for (const key of METADATA_READ_DECORATIONS) {
      expect(refusedKeys({ ...base, [key]: {} })).toEqual([key]);
    }
    expect(refusedKeys({ ...base, _diagnostics: {}, _draft: true }).sort()).toEqual(['_diagnostics', '_draft']);
  });

  it('leaves the ADR-0010 protection envelope alone — the keys that ARE write-path state', () => {
    // The silent-loss question, answered on the helper rather than assumed.
    // These share the underscore spelling and are deliberately NOT decorations:
    // the server merges them back, so stripping them WOULD lose state.
    const envelope = {
      name: 'account',
      label: 'Account',
      fields: { n: { type: 'text', label: 'N' } },
      _lock: 'full',
      _lockReason: 'shipped by a package',
      _lockSource: 'package',
      _provenance: 'package',
      _packageId: 'crm',
      _packageVersion: '1.2.3',
      _lockDocsUrl: 'https://docs.objectstack.ai/locks',
    };
    expect(ObjectSchema.safeParse(envelope).success).toBe(true);

    const stripped = stripReadDecorations({ ...envelope, _diagnostics: {}, _draft: true }) as Record<string, unknown>;
    expect(stripped).toEqual(envelope);
    expect(ObjectSchema.safeParse(stripped).success).toBe(true);
  });
});

describe('objectui#6480 · saveFields strips the read decorations before it PUTs', () => {
  it('sends neither decoration — asserted on the request bytes', async () => {
    const { adapter, puts } = makeCapturingAdapter(DECORATED_SERVED);

    await new MetadataService(adapter).saveFields('account', [
      designerField('first_name', { label: 'First name' }),
    ]);

    // Falsification: the save really happened and really described this object,
    // so the absences below are absences from a body that exists.
    expect(puts).toHaveLength(1);
    expect(puts[0].name).toBe('account');

    for (const key of METADATA_READ_DECORATIONS) {
      expect(key in puts[0]).toBe(false);
    }
  });

  it('and the whole body parses green — the red-to-green witness of this card', async () => {
    const { adapter, puts } = makeCapturingAdapter(DECORATED_SERVED);
    await new MetadataService(adapter).saveFields('account', [designerField('first_name', { label: 'First name' })]);

    // Before this change: ['unrecognized_keys @ '] naming both decorations.
    expect(issuesOf(ObjectSchema.safeParse(puts[0]))).toEqual([]);
    expect(refusedKeys(puts[0])).toEqual([]);
  });

  it('STILL preserves the author keys the spread exists to carry', async () => {
    // The property this fix must not cost. `_diagnostics` and `pluralLabel`
    // arrive on the same document by the same spread; only the first may go.
    const { adapter, puts } = makeCapturingAdapter({
      ...DECORATED_SERVED,
      fieldGroups: { contact: { label: 'Contact' } },
    });

    await new MetadataService(adapter).saveFields('account', [designerField('first_name', { label: 'First name' })]);

    expect(puts[0]).toMatchObject({
      name: 'account',
      label: 'Account',
      pluralLabel: 'Accounts',
      icon: 'Building',
      fieldGroups: { contact: { label: 'Contact' } },
    });
    // Positive control in the same output: `fields` really WAS replaced, so the
    // line above is about preservation and not about a body echoed back whole.
    expect(Object.keys(puts[0].fields as Record<string, unknown>)).toEqual(['first_name']);
  });

  it('strips each decoration on its own, not only when both are present', async () => {
    // A strip keyed on one of them, or on the pair, would pass the test above
    // and still leave the single-decoration document unsaveable.
    for (const key of METADATA_READ_DECORATIONS) {
      const { adapter, puts } = makeCapturingAdapter({
        name: 'account',
        label: 'Account',
        fields: { legacy: { type: 'text', label: 'Legacy' } },
        [key]: key === '_draft' ? true : { valid: true, errors: [] },
      });
      await new MetadataService(adapter).saveFields('account', [designerField('first_name', { label: 'First name' })]);

      expect(puts).toHaveLength(1);
      expect(key in puts[0]).toBe(false);
      expect(ObjectSchema.safeParse(puts[0]).success).toBe(true);
    }
  });

  it('leaves an undecorated document byte-identical apart from `fields`', async () => {
    // The no-op control: the strip must not be observable on the common path.
    const { adapter, puts } = makeCapturingAdapter({
      name: 'account',
      label: 'Account',
      pluralLabel: 'Accounts',
      fields: { legacy: { type: 'text', label: 'Legacy' } },
    });
    await new MetadataService(adapter).saveFields('account', [designerField('first_name', { label: 'First name' })]);

    expect(puts[0]).toEqual({
      name: 'account',
      label: 'Account',
      pluralLabel: 'Accounts',
      fields: { first_name: { name: 'first_name', type: 'text', label: 'First name' } },
    });
  });
});

describe('objectui#6480 · the strip is bounded — it is not a lenient "drop what the schema refuses" pass', () => {
  it('still sends an off-spec key the AUTHOR owns, and the schema still refuses it', async () => {
    // AGENTS.md #0.1. A general strip would swallow this key and hide the
    // producer's bug; only the framework's own read decorations may be removed.
    const { adapter, puts } = makeCapturingAdapter({
      name: 'account',
      label: 'Account',
      fields: { legacy: { type: 'text', label: 'Legacy' } },
      _diagnostics: { valid: true, errors: [] },
      notASpecKey: 'authored, wrong, and it must stay visible',
    });

    await new MetadataService(adapter).saveFields('account', [designerField('first_name', { label: 'First name' })]);

    expect(puts[0].notASpecKey).toBe('authored, wrong, and it must stay visible');
    // The decoration went; the off-spec author key stayed and is still refused.
    expect('_diagnostics' in puts[0]).toBe(false);
    expect(refusedKeys(puts[0])).toEqual(['notASpecKey']);
  });
});
