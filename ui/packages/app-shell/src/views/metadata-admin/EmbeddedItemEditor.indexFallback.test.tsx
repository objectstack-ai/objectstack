// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The console's hand-copied index schema mirrors `IndexSchema` (objectstack#5247).
 *
 * `index` is an embedded-only sub-type — it lives inside `object.indexes[]` and
 * is not a registered metadata type, so `/meta` has no slot to publish a schema
 * for it and `EmbeddedItemEditor` ships its own copy in `FALLBACK_SCHEMAS.index`.
 * A hand copy is a drift source by construction, and it drifted: the console
 * offered a **`where`** control ("Partial-index predicate") the spec never
 * declared, and a **`brin`** option the spec never allowed.
 *
 * ## Why the pin is measured against the INSTALLED spec, not a literal
 *
 * A test that re-states the expected property names in its own source is a
 * second hand copy — it drifts in lockstep with the first and certifies
 * nothing. Every assertion below therefore runs the console's OWN properties
 * through `@objectstack/spec`'s `IndexSchema`, so the pin re-derives itself on
 * every `@objectstack/spec` bump: the day a key is added, retired, or has its
 * value space narrowed, this file is what goes red.
 *
 * ## Why "the parse succeeded" is not the assertion
 *
 * `IndexSchema` is deliberately NOT `.strict()` (objectstack#4001 批 20 held
 * this one site open precisely because of this console copy), so an undeclared
 * key is **stripped**, not rejected — `safeParse` returns `success: true` and
 * the admin's input is gone. `unrecognized_keys`, the usual reachability
 * criterion for a key-level guard, does not exist on a stripping schema. The
 * equivalent that actually holds here is ROUND-TRIP SURVIVAL: a control is a
 * real authoring surface only if the value it writes is still there after the
 * parse. That is what catches `where`, and it is what the first block asserts.
 *
 * Retired keys are the other half and fail differently — `type` and `partial`
 * are `retiredKey` tombstones in spec 17.0.0 (objectstack#5248, ADR-0049), so
 * they are REJECTED at any value. The old "Algorithm" select was thus a control
 * every one of whose five options produced a 422 on the parent save, not merely
 * a dropped one.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { IndexSchema } from '@objectstack/spec/data';

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => ({
    layered: async () => ({ effective: {}, code: null, overlay: null, overlayScope: null }),
    save: async (_t: string, _n: string, payload: Record<string, unknown>) => payload,
  }),
  // `index` has no registry entry — that absence is what routes the editor to
  // `FALLBACK_SCHEMAS.index`, so it is the state under test, not a shortcut.
  useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
}));

import { EmbeddedItemEditor, FALLBACK_SCHEMAS } from './EmbeddedItemEditor';

afterEach(cleanup);

const INDEX_SCHEMA = FALLBACK_SCHEMAS.index.schema as {
  required?: string[];
  properties: Record<string, Record<string, unknown>>;
};
const CONSOLE_PROPS = INDEX_SCHEMA.properties;

/**
 * A value the console's control for `prop` can actually emit. Kept tiny and
 * derived from the control's own declared shape so it stays honest if a
 * property's type changes.
 */
function sampleFor(prop: string, schema: Record<string, unknown>): unknown {
  const branches = schema.anyOf as Array<Record<string, unknown>> | undefined;
  const effective = branches?.[0] ?? schema;
  const enumValues = effective.enum as unknown[] | undefined;
  if (Array.isArray(enumValues) && enumValues.length > 0) return enumValues[0];
  switch (effective.type) {
    case 'array':
      return ['sample_column'];
    case 'boolean':
      return true;
    case 'number':
    case 'integer':
      return 1;
    default:
      return prop === 'name' ? 'idx_sample' : 'sample';
  }
}

describe('every control the console offers is a real authoring surface', () => {
  it('non-vacuity: the fallback really is the index schema and really has controls', () => {
    // Without this, a renamed export or an emptied `properties` would satisfy
    // every per-property assertion below by iterating nothing.
    expect(Object.keys(CONSOLE_PROPS).length).toBeGreaterThanOrEqual(3);
    expect(CONSOLE_PROPS).toHaveProperty('fields');
    expect(INDEX_SCHEMA.required).toEqual(['fields']);
  });

  it.each(Object.keys(CONSOLE_PROPS))(
    '`%s` survives an IndexSchema parse — not dropped, not rejected',
    (prop) => {
      const value = sampleFor(prop, CONSOLE_PROPS[prop]);
      const parsed = IndexSchema.safeParse({ fields: ['sample_column'], [prop]: value });

      // Half 1 — not REJECTED. This is the half a retired key (`type`,
      // `partial`) fails: the tombstone's message is the upgrade prescription,
      // so surface it rather than a bare boolean.
      expect(
        parsed.success ? '' : parsed.error.issues.map((i) => i.message).join(' | '),
      ).toBe('');

      // Half 2 — not silently STRIPPED. This is the half `where` failed: the
      // save succeeded and the admin's predicate was gone.
      expect(parsed.success && (parsed.data as Record<string, unknown>)[prop]).toEqual(value);
    },
  );

  it('the spec keys an author can still set are all offered (no missing control)', () => {
    // Completeness, the other direction. A tombstone rejects every probe; a
    // live key accepts at least one, so this needs no hand-listed key set and
    // survives the next key the spec adds.
    // `false` too: since protocol 18 the index `unique` takes `false | 'global' |
    // 'organization'` and refuses every other probe here (objectui#12030).
    const probes: unknown[] = ['x', true, false, 1, ['x'], {}];
    const authorable = Object.keys(IndexSchema.shape).filter((key) =>
      probes.some((probe) => IndexSchema.safeParse({ fields: ['c'], [key]: probe }).success),
    );

    expect(authorable.length).toBeGreaterThan(0);
    expect(Object.keys(CONSOLE_PROPS).sort()).toEqual(authorable.sort());
  });
});

describe('the retired keys are gone and stay gone (objectstack#5248)', () => {
  it('offers no `type` / "Algorithm" control and no `partial` / `where` control', () => {
    expect(CONSOLE_PROPS).not.toHaveProperty('type');
    expect(CONSOLE_PROPS).not.toHaveProperty('partial');
    expect(CONSOLE_PROPS).not.toHaveProperty('where');
  });

  it('control: those keys are rejected by the spec, so re-adding them would 422', () => {
    // Pins WHY they may not come back, and is the non-vacuity guard for the
    // assertion above — if a spec bump ever made these parse again, this goes
    // red and the retirement is re-litigated deliberately rather than by drift.
    for (const [key, value] of [
      ['type', 'btree'],
      ['partial', "status = 'open'"],
    ] as const) {
      const parsed = IndexSchema.safeParse({ fields: ['c'], [key]: value });
      expect(parsed.success, `\`${key}\` is a retired-key tombstone`).toBe(false);
    }
    // `brin` was never legal even before the retirement — the enum it sat in
    // was `btree|hash|gin|gist|fulltext`. It is doubly gone.
    expect(JSON.stringify(INDEX_SCHEMA)).not.toContain('brin');
  });
});

describe('`unique` mirrors the ADR-0120 scope union', () => {
  it('offers exactly the scope spellings protocol 18 keeps', () => {
    const branch = (CONSOLE_PROPS.unique.anyOf as Array<Record<string, unknown>>)[0];
    expect(branch.enum).toEqual(['global', 'organization']);
    for (const scope of branch.enum as string[]) {
      expect(IndexSchema.safeParse({ fields: ['c'], unique: scope }).success).toBe(true);
    }
  });

  it('does not offer the retired bare `true` as a selectable option', () => {
    // Bare `true` was the positional spelling of `'global'`; protocol 18 refuses
    // it at parse (objectstack#22103, closing objectstack#5082), which the
    // control below now pins. The scope select never offered it, so this stays
    // a claim about what the console EMITS, asserted on the control.
    const branch = (CONSOLE_PROPS.unique.anyOf as Array<Record<string, unknown>>)[0];
    expect(branch.enum).not.toContain(true);
    expect(branch.enum).not.toContain('true');
    // Control: the spec REFUSES it since protocol 18 (objectui#11864, objectui#12030).
    // A server on 18 serves a stored legacy `true` as `'global'`, so the switch
    // branch below renders only a row that never came from such a server.
    expect(IndexSchema.safeParse({ fields: ['c'], unique: true }).success).toBe(false);
    expect(IndexSchema.safeParse({ fields: ['c'], unique: false }).success).toBe(true);
  });

  it("rejects 'tenant' — the word is 'organization' (ADR-0120 §Terminology)", () => {
    expect(IndexSchema.safeParse({ fields: ['c'], unique: 'tenant' }).success).toBe(false);
  });
});

describe('the rendered form matches the converged schema', () => {
  function openIndex(initialRaw: Record<string, unknown>) {
    return render(
      <EmbeddedItemEditor
        parentType="object"
        parentName="sales_order"
        embeddedPath="indexes"
        itemName="idx_email"
        editAs="index"
        initialRaw={initialRaw}
      />,
    );
  }

  it('draws the surviving controls', () => {
    const { container } = openIndex({ name: 'idx_email', fields: ['email'] });
    expect(screen.getByText('Fields')).toBeInTheDocument();
    expect(screen.getByText('Unique')).toBeInTheDocument();
    // The real form, not the raw-JSON fallback branch (which is a textarea).
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('draws NO "Algorithm" or "Partial-index predicate" control', () => {
    // The user-visible half of the retirement. Asserted on the rendered labels
    // rather than the schema object, because the label is what an admin clicks
    // — and clicking the old one is what produced the 422.
    openIndex({ name: 'idx_email', fields: ['email'] });
    expect(screen.queryByText('Algorithm')).toBeNull();
    expect(screen.queryByText(/partial-index predicate/i)).toBeNull();
  });

  it('a legacy `unique: true` index still renders its control (no data loss)', () => {
    // The boolean branch of the union exists for exactly this: an index
    // authored before ADR-0120 must stay editable, and its stored value must
    // not be silently reinterpreted by the form.
    openIndex({ name: 'idx_email', fields: ['email'], unique: true });
    expect(screen.getByText('Unique')).toBeInTheDocument();
  });
});
