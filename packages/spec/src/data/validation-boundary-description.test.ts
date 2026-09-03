// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13879] The transition-gate vs invariant boundary, pinned as contract text.
 *
 * Two write-time mechanisms in this spec look interchangeable and are not, and
 * the difference is invisible from the key names — which is the whole reason
 * this pin exists:
 *
 * - `Field.requiredWhen` and the field bounds (`min` / `max` / `minLength` /
 *   `maxLength`) are **transition gates**. `requiredWhen` refuses a write only
 *   when the merged record violates AND the pre-write record complied
 *   (`evaluateValidationRules`, the ADR-0113 non-regression branch); the bounds
 *   are checked on the WRITTEN value only, because `validateRecord` iterates the
 *   UPDATE payload rather than the field map. A row that predates the rule keeps
 *   passing unrelated edits either way.
 * - A `validations[]` `script` rule is a **true invariant**: `checkPredicate`
 *   evaluates it against the merged record on every write with no pre-state
 *   exemption, so a row that already violates is refused on any edit until a
 *   repairing write lands — frozen, not bricked.
 *
 * Both semantics are deliberate and neither is changed here. What was missing is
 * that no platform surface SAID so, while "required when X" reads to a human (and
 * to an AI metadata author) as an invariant — measured downstream, where three
 * rules written in prose as invariants were all implemented with the gate tool
 * and nothing signalled it.
 *
 * ⛔ These assertions are on the `.describe()` text reached THROUGH the schema,
 * not on the source file: that text is what ships as the JSON Schema
 * `description` and as the generated `content/docs/references/` page, so it is
 * the copy an author actually reads. A source grep would pass on a sentence that
 * never reaches either.
 *
 * Each half must also NAME THE OTHER TOOL — a statement of the boundary that
 * only describes the tool you already chose does not redirect anyone.
 */

import { describe, it, expect } from 'vitest';

import { FieldSchema, InlineGridColumnSchema } from './field.zod';
import { ScriptValidationSchema } from './validation.zod';

const fieldDoc = (key: string): string =>
  ((FieldSchema.shape as Record<string, { description?: string }>)[key]?.description) ?? '';

describe('#13879 — `Field.requiredWhen` states its TRANSITION-GATE semantics', () => {
  it('names the class and the exact rejection condition', () => {
    const doc = fieldDoc('requiredWhen');
    expect(doc).toContain('TRANSITION GATE');
    // The mechanism, not just the label: reject iff merged violates AND the
    // pre-write record complied. Without this clause "transition gate" is a
    // word an author cannot act on.
    expect(doc).toContain('the merged record violates');
    expect(doc).toContain('the pre-write record complied');
  });

  it('names the three refused writes and the writes that stay legal', () => {
    const doc = fieldDoc('requiredWhen');
    expect(doc).toContain('flips the predicate TRUE');
    expect(doc).toContain('INSERT born inside the gate');
    expect(doc).toContain('clears the cell');
    // The other direction — the half an author is surprised by.
    expect(doc).toContain('unrelated edits');
    expect(doc).toContain('inside the gate');
  });

  it('redirects to the invariant tool by name', () => {
    const doc = fieldDoc('requiredWhen');
    expect(doc).toContain('validations[]');
    expect(doc).toContain('`script`');
    expect(doc).toContain('evaluateValidationRules');
  });

  it('does NOT claim invariant semantics (the control)', () => {
    // The failure this pin is really guarding: a later edit that "tidies" the
    // two texts into one. `requiredWhen` must keep saying it is NOT an
    // invariant, in those words.
    const doc = fieldDoc('requiredWhen');
    expect(doc).toContain('not an invariant');
    expect(doc).not.toContain('frozen, not bricked');
  });
});

describe('#13879 — the field bounds state the same transition-gate class', () => {
  // Hardcoded rather than derived from a module set, so this is an independent
  // measurement of which keys carry the statement.
  it.each(['min', 'max', 'minLength', 'maxLength'])(
    '`%s` says the check reads the WRITTEN value only',
    (key) => {
      const doc = fieldDoc(key);
      expect(doc).toContain('WRITTEN value only');
      expect(doc).toContain('never re-read');
      expect(doc).toContain('survives unrelated edits');
    },
  );

  it.each(['min', 'max'])('`%s` redirects to the invariant tool by name', (key) => {
    const doc = fieldDoc(key);
    expect(doc).toContain('validations[]');
    expect(doc).toContain('`script`');
  });

  it.each(['minLength', 'maxLength'])(
    '`%s` places itself in the `min`/`max` class rather than restating it',
    (key) => {
      expect(fieldDoc(key)).toContain('`min`/`max` transition-gate class');
    },
  );
});

describe('#13879 — the inline-grid column `requiredWhen` says it enforces nothing', () => {
  // The trap this closes: the grid column mirrors objectui's renderer and has
  // no write-path reader at all (`inlineColumns` is classified `presentation`
  // by driver-sql). An author who writes the requirement only here gets no
  // server enforcement — not a weaker one, none.
  const doc = ((InlineGridColumnSchema.shape as Record<string, { description?: string }>)
    .requiredWhen?.description) ?? '';

  it('says presentation only, and that nothing on the write path reads it', () => {
    expect(doc).toContain('PRESENTATION ONLY');
    expect(doc).toContain('nothing on the write path reads it');
  });

  it('points at the child FIELD predicate as the enforced contract', () => {
    expect(doc).toContain('`Field.requiredWhen`');
    expect(doc).toContain('enforces nothing');
  });
});

describe('#13879 — the `script` rule states its INVARIANT semantics', () => {
  const doc = ((ScriptValidationSchema.shape as Record<string, { description?: string }>)
    .condition?.description) ?? '';

  it('names the class, the scope and the cadence', () => {
    expect(doc).toContain('TRUE INVARIANT');
    expect(doc).toContain('merged record');
    expect(doc).toContain('on every write');
    expect(doc).toContain('no exemption');
  });

  it('states the frozen-not-bricked consequence for a pre-existing violation', () => {
    expect(doc).toContain('refused on ANY edit');
    expect(doc).toContain('repairing write');
    expect(doc).toContain('frozen, not bricked');
  });

  it('redirects to the transition-gate tools by name', () => {
    expect(doc).toContain('`Field.requiredWhen`');
    expect(doc).toContain('field bound');
  });

  it('does NOT claim transition-gate semantics (the control)', () => {
    expect(doc).toContain('not a transition gate');
  });
});
