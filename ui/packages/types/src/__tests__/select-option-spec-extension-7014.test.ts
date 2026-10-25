// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where the authoring boundary actually runs for the select-option and
 * multiline-editor keys — pinned so the comments that describe it cannot rot
 * (objectui#7014, re-pointed for `@objectstack/spec` 17.3.0).
 *
 * ## What this file was, and what moved
 *
 * objectui#7014 measured three doc comments in `packages/types/src/field-types.ts`
 * that claimed the installed `@objectstack/spec` DECLARED the keys beside them:
 *
 *   "Aligns `@objectstack/spec` `SelectOptionSchema.description`"
 *   "`@objectstack/spec` `FieldSchema.rows` (a positive integer, authorable …)"
 *
 * Against `@objectstack/spec@17.2.0` those claims were false — the spec had no
 * such keys and refused them BY NAME — and a false canonical claim is a planted
 * premise for the next agent, not stale documentation. So this file pinned the
 * BOUNDARY rather than removing anything.
 *
 * ⭐ At `@objectstack/spec` **17.3.0** the boundary MOVED, and it moved to where
 * those original comments said it was. The maintainer's 2026-08-25 ruling on
 * objectui#6140 / objectui#6153 (Option A) declared both keys, and 17.3.0
 * implements it: `SelectOptionSchema.description` and a `rows` gated to the four
 * multiline editor types are now authorable. Re-pointing these assertions
 * EXECUTES that ruling; it does not make a new one.
 *
 * ## The boundary moved, it did not disappear — and that is the point
 *
 * Two of the three keys #7014 measured are now declared. The third is not, and
 * neither are the keys around them. Everything below is written as a PAIR, so
 * this file keeps failing loudly in whichever direction the contract next moves:
 *
 *   - `description` and `rows` are DECLARED, each with a value-level assertion
 *     so "the key is admitted" is not confused with "anything may be written
 *     into it" (a key that were merely tolerated would pass the first and fail
 *     the second).
 *   - `icon` and `disabled` remain OUTSIDE the option vocabulary, refused BY
 *     NAME, and they are the control that proves the schema still refuses
 *     anything at all rather than having gone permissive.
 *   - `rows` is TYPE-GATED: declared on `textarea` / `markdown` / `html` /
 *     `richtext` and refused on the field types that do not take it. "Declared"
 *     does not mean "declared everywhere", and the refusal there arrives as a
 *     cross-field refinement rather than `unrecognized_keys`.
 *   - The four inert rich-text keys (`toolbar` / `preview` / `minHeight` /
 *     `maxHeight`) are STILL undeclared. The ruling's expansion stops at `rows`
 *     (objectui#7635 records this explicitly: ⛔ do not widen), so they are
 *     pinned as refused — that door has to be seen to stay shut.
 *
 * ⚠️ The prose in `packages/types/src/field-types.ts` and
 * `packages/types/src/select-option.ts` described the 17.2.0 boundary and was
 * false in the other direction for as long as this note stood. objectui#7635
 * corrected those sites, so both halves now read the same boundary — this file
 * asserts it, and their docblocks point here instead of restating it. ⭐ The
 * repair also moved two of them INTO the reach of
 * `scripts/check-installed-spec-pin-claims.mjs`: written as a claim about the
 * installed pin on one line, they are now re-derived by that gate at every
 * bump, rather than sitting in its ledger as known-stale debt.
 *
 * Every assertion pairs its verdict with a CONTROL that changes exactly one
 * thing, so a red here reads "the key's status changed" and never "the fixture
 * drifted".
 */

import { describe, it, expect } from 'vitest';
import { SelectOptionSchema as SpecSelectOptionSchema, FieldSchema } from '@objectstack/spec/data';

/** Keys of the spec's select option, as installed. */
const SPEC_OPTION_KEYS = Object.keys(SpecSelectOptionSchema.shape).sort();

/** A valid option — `value` is a system identifier, min length 2. */
const validOption = { label: 'High', value: 'high' } as const;

/** Pull the `unrecognized_keys` issue naming `key`, or undefined. */
const refusedByName = (result: { success: boolean; error?: { issues: readonly any[] } }, key: string) =>
  result.success
    ? undefined
    : result.error!.issues.find(
        (i) => i.code === 'unrecognized_keys' && (i.keys ?? []).includes(key)
      );

/** Pull any issue whose `path` ends at `key`, whatever its code. */
const issueAtPath = (result: { success: boolean; error?: { issues: readonly any[] } }, key: string) =>
  result.success
    ? undefined
    : result.error!.issues.find((i) => (i.path ?? []).at(-1) === key);

describe('spec SelectOptionSchema — `description` is inside the vocabulary, `icon`/`disabled` are not', () => {
  it('declares exactly the seven keys 18.0.0-next.3 leaves it with', () => {
    // If this list changes again, the comments in field-types.ts and
    // select-option.ts must be re-pointed with it rather than left stale.
    // 17.3.0 added `description`; 18.0.0-next.3 added `kind`, the option's
    // lifecycle category (objectstack `adad73f`).
    expect(SPEC_OPTION_KEYS).toEqual([
      'color',
      'default',
      'description',
      'kind',
      'label',
      'value',
      'visibleWhen',
    ]);
  });

  it('accepts the control option', () => {
    expect(SpecSelectOptionSchema.safeParse(validOption).success).toBe(true);
  });

  it('ADMITS `description` — the key ruled authorable on 2026-08-25', () => {
    const res = SpecSelectOptionSchema.safeParse({ ...validOption, description: 'Blocks the release' });
    expect(res.success).toBe(true);
    // …and it is admitted as a DECLARATION, not as tolerance: a wrongly-typed
    // value is refused AT the key. A merely-ignored key would pass this too,
    // which is what makes the pair a reading.
    const wrongType = SpecSelectOptionSchema.safeParse({ ...validOption, description: 42 });
    expect(wrongType.success).toBe(false);
    expect(issueAtPath(wrongType, 'description')?.code).toBe('invalid_type');
  });

  for (const key of ['icon', 'disabled'] as const) {
    it(`still refuses the objectui-only key \`${key}\` BY NAME`, () => {
      const res = SpecSelectOptionSchema.safeParse({ ...validOption, [key]: key === 'disabled' ? true : 'x' });
      expect(res.success).toBe(false);
      expect(refusedByName(res, key), `expected unrecognized_keys naming '${key}'`).toBeDefined();
      // Control, per fixture: the key is the only difference.
      expect(SpecSelectOptionSchema.safeParse(validOption).success).toBe(true);
    });
  }
});

describe('FieldSchema routes options through that schema', () => {
  const field = (options: unknown[]) => ({ name: 'status', type: 'select', label: 'Status', options });

  it('accepts a field whose options carry only spec keys', () => {
    expect(FieldSchema.safeParse(field([validOption])).success).toBe(true);
  });

  it('accepts the WHOLE field when an option carries `description`', () => {
    const res = FieldSchema.safeParse(field([{ ...validOption, description: 'help' }]));
    expect(res.success).toBe(true);
  });

  it('still fails the WHOLE field when an option carries `icon`, naming it at its path', () => {
    const res = FieldSchema.safeParse(field([{ ...validOption, icon: 'flame' }]));
    expect(res.success).toBe(false);
    const named = refusedByName(res, 'icon');
    expect(named, "expected unrecognized_keys naming 'icon'").toBeDefined();
    // The refusal is reported AT the option, not at the field — this is what
    // "routes options through that schema" means, and it is the half that would
    // silently disappear if options were ever parsed loosely.
    expect((named as { path?: unknown[] }).path).toEqual(['options', 0]);
  });
});

describe('FieldSchema declares `rows` on the four multiline editor types', () => {
  const base = (type: string) => ({ name: 'body', type, label: 'Body' });

  for (const type of ['textarea', 'markdown', 'html', 'richtext'] as const) {
    it(`control: \`${type}\` without \`rows\` is accepted`, () => {
      expect(FieldSchema.safeParse(base(type)).success).toBe(true);
    });

    it(`\`${type}\` ADMITS \`rows\`, and enforces it as a positive integer`, () => {
      expect(FieldSchema.safeParse({ ...base(type), rows: 4 }).success).toBe(true);
      // The value half: declared does not mean unchecked.
      const zero = FieldSchema.safeParse({ ...base(type), rows: 0 });
      expect(zero.success).toBe(false);
      expect(issueAtPath(zero, 'rows')?.code).toBe('too_small');
      const stringy = FieldSchema.safeParse({ ...base(type), rows: '4' });
      expect(stringy.success).toBe(false);
      expect(issueAtPath(stringy, 'rows')?.code).toBe('invalid_type');
    });

    for (const key of ['toolbar', 'preview', 'minHeight', 'maxHeight'] as const) {
      it(`\`${type}\` still refuses the inert rich-text key \`${key}\` BY NAME`, () => {
        const value = key === 'toolbar' ? ['bold'] : key === 'preview' ? true : 200;
        const res = FieldSchema.safeParse({ ...base(type), [key]: value });
        expect(res.success).toBe(false);
        expect(refusedByName(res, key), `expected unrecognized_keys naming '${key}' on ${type}`).toBeDefined();
        // Control, per fixture: the key is the only difference.
        expect(FieldSchema.safeParse(base(type)).success).toBe(true);
      });
    }
  }
});

describe('`rows` is TYPE-GATED — declared is not the same as declared everywhere', () => {
  // A `select` carries one option: since `@objectstack/spec` 17.7.0 a `select`
  // with no option source is refused at `options` (objectstack#21390), and this
  // block's control is about `rows` alone, so the document is otherwise legal
  // (objectui#11717).
  const base = (type: string) => ({
    name: 'body',
    type,
    label: 'Body',
    ...(type === 'select' ? { options: [{ label: 'Open', value: 'open' }] } : {}),
  });

  for (const type of ['text', 'select'] as const) {
    it(`control: \`${type}\` without \`rows\` is accepted`, () => {
      expect(FieldSchema.safeParse(base(type)).success).toBe(true);
    });

    it(`\`${type}\` refuses \`rows\` — and as a cross-field refinement, not \`unrecognized_keys\``, () => {
      const res = FieldSchema.safeParse({ ...base(type), rows: 4 });
      expect(res.success).toBe(false);
      const at = issueAtPath(res, 'rows');
      expect(at, `expected an issue at 'rows' on ${type}`).toBeDefined();
      // The distinction matters: `rows` IS a declared key of the field
      // vocabulary, so the schema does not report it as unrecognized. It is the
      // TYPE that does not take it, which arrives as a refinement.
      expect(at?.code).toBe('custom');
      expect(refusedByName(res, 'rows')).toBeUndefined();
    });
  }
});
