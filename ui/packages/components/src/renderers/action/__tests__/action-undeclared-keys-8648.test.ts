/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8648 — the four keys the two action renderers read off
 * `UIActionSchema` without a declaration: `disabled`, `recordIdField`,
 * `resultDialog`, `undoable` (the objectui#8327 family's `components` card).
 *
 * This file is the instrument for every claim the ruling rests on, so each is
 * re-derived on every run instead of being written down once (AGENTS.md #9).
 *
 * ## The rule that chose the exit, and why it chose the same one four times
 *
 * `@object-ui/types` is a MIRROR of `@objectstack/spec`, not an authority, so
 * declaring a key the platform does not declare would make this repo accept
 * what the platform refuses. The question per key is therefore: does the
 * contract declare it, and on WHICH schema? Both halves matter — a token that
 * exists somewhere under the UI contract is not a declaration on the schema a
 * given read's node maps to.
 *
 * All four came back DECLARED on `@objectstack/spec`'s `ActionSchema`, which is
 * the schema `UIActionSchema` mirrors and the one both renderers annotate their
 * `schema` prop with. ⇒ ALIGN THE MIRROR, four times, each on its own reading.
 * The four verdicts agreeing is a RESULT here, not a shortcut: the census below
 * asks the question once per key, and its inline sibling — where two of the
 * four are absent — is what proves the question can come back "no".
 *
 * ## What each leg can and cannot prove
 *
 *   - The `Equal` legs are compiled by `tsc -p tsconfig.test.json` and by
 *     nothing else — vitest strips types. They are the ONLY half that can
 *     observe the declaration itself, because what was wrong before this card
 *     was a TypeScript-only absence: the reads compiled through an `as any`
 *     cast and behaved identically at runtime.
 *   - The census legs read the INSTALLED `@objectstack/spec` artifact, over the
 *     contract's own action schemas. They are the PREMISE of the alignment,
 *     never its evidence: they were green before this card and are green after.
 *     They earn their place by going RED the day the platform retires one of
 *     the four — which is the signal that this mirror owes an update.
 *   - The source-text legs read the two renderers through the shared comment
 *     mask, so a re-introduced `as any` is caught by a run that never
 *     type-checks. ⭐ That negative is load-bearing and is the lesson
 *     objectui#8649 paid for: a cast at the read site defeats a declaration
 *     that a MEMBERSHIP instrument (`getPropertyOfType` on the binding, which
 *     unwraps the cast) still reports as present. Declaring without un-casting
 *     is an inert declaration that pins green.
 *   - Every negative leg carries a control that varies ONLY the claim.
 *   - The last block WAS a ledger and is not one any more. Un-casting the
 *     `resultDialog` READ made the compiler name a second, separate defect the
 *     `as any` had been hiding: `@object-ui/core`'s `ResultDialogSpec` was a
 *     hand copy of the contract's block whose `title` / `description` /
 *     `acknowledge` read `string` where the contract says `I18nLabel`. That
 *     repair was filed as objectui#9542 and has LANDED — the mirror derives
 *     those members from the contract now — so the narrowing assertion the
 *     WRITE carried meanwhile is deleted, and the ledger entry pinning it with
 *     it. What replaces the block pins the two things that outlive a
 *     workaround: the write arriving with nothing asserted between it and
 *     `ActionDef`, and the `as any` it must never become.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// ⛔ NOT `import * as` from '@objectstack/spec/ui' — the repo's
// `no-restricted-imports` rule refuses the namespace form by name, and named
// imports make the census population a DECLARED set rather than "whatever the
// module happens to export".
import { ActionSchema, InlineActionSchema, type Action } from '@objectstack/spec/ui';
import type { UIActionSchema } from '@object-ui/types';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

/** Rooted at THIS file, never at `process.cwd()` — the two differ per invocation. */
const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERERS = join(HERE, '..');

/** The four keys this card rules on, and the renderer files each is read in. */
const CARD_KEYS = {
  disabled: ['action-button.tsx', 'action-icon.tsx'],
  recordIdField: ['action-button.tsx'],
  resultDialog: ['action-button.tsx', 'action-icon.tsx'],
  undoable: ['action-button.tsx'],
} as const;

/* ── Type-level pins (compiled by `tsc -p tsconfig.test.json`) ─────────────── */

/** Invariant type equality. `A extends B` is NOT this: `never` and `any` pass that. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The only assertion form used here — its constraint is what refuses `false`. */
type Expect<T extends true> = T;

/* Direction proofs: a broken instrument makes THIS file red. */

// @ts-expect-error objectui#8648 — `Expect` must refuse `false`. Widen its constraint and this directive goes unused (TS2578).
type _ExpectRefusesFalse = Expect<false>;

// @ts-expect-error objectui#8648 — `never` must NOT read as equal to `true`. An `extends`-shaped comparison would let it through.
type _EqualRefusesNever = Expect<Equal<never, true>>;

// @ts-expect-error objectui#8648 — `any` must NOT read as equal to `true`. `any` is exactly what the `as any` casts produced at all eight read sites.
type _EqualRefusesAny = Expect<Equal<any, true>>;

/*
 * Exit "align the mirror", all four keys. Each was RED before objectui#8648
 * with `TS2339` — the member did not exist on this face at all.
 *
 * Derived against the contract rather than spelled out, so the pin cannot
 * outlive a spec change: if `@objectstack/spec` moves one of these types, this
 * goes red here instead of drifting silently.
 */
export type _DisabledMirrorsSpec = Expect<Equal<UIActionSchema['disabled'], Action['disabled']>>;
export type _RecordIdFieldMirrorsSpec = Expect<
  Equal<UIActionSchema['recordIdField'], Action['recordIdField']>
>;
export type _ResultDialogMirrorsSpec = Expect<
  Equal<UIActionSchema['resultDialog'], Action['resultDialog']>
>;
export type _UndoableMirrorsSpec = Expect<Equal<UIActionSchema['undoable'], Action['undoable']>>;

/**
 * Spelled out as well as derived for the two keys with a simple type. `Equal`
 * against the contract alone would also be satisfied if BOTH faces drifted to
 * the same wrong type.
 */
export type _RecordIdFieldIsOptionalString = Expect<
  Equal<UIActionSchema['recordIdField'], string | undefined>
>;
export type _UndoableIsOptionalBoolean = Expect<
  Equal<UIActionSchema['undoable'], boolean | undefined>
>;

/**
 * `disabled` accepts all three arms the contract accepts — literal boolean, raw
 * CEL string, and a `{ dialect, source }` envelope. Written as assignments
 * rather than as an `Equal` against a hand-spelled union, because the envelope
 * arm's own spelling is the contract's to change.
 */
const _disabledAcceptsBoolean: UIActionSchema['disabled'] = true;
const _disabledAcceptsCel: UIActionSchema['disabled'] = 'record.locked';
const _disabledAcceptsEnvelope: UIActionSchema['disabled'] = {
  dialect: 'cel',
  source: 'record.locked',
};

/**
 * The card's repro as a literal: a spec-valid, renderer-honoured action that
 * `tsc` refused with `TS2353` before this card, on all four keys at once.
 */
const _allFourAccepted: UIActionSchema = {
  name: 'regenerate_secret',
  label: 'Regenerate secret',
  type: 'api',
  disabled: 'record.locked',
  recordIdField: 'external_id',
  resultDialog: { title: 'New secret', description: 'Copy it now — it is shown once.' },
  undoable: true,
};

/* ── Runtime legs ─────────────────────────────────────────────────────────── */

/**
 * Every key name declared on `schema`, unwrapping the wrappers a published zod
 * artifact uses, or `null` when no object shape is reachable at all.
 *
 * ⚠️ Written as a bounded BREADTH-first walk, and that is not incidental. Both
 * action schemas are `z.ZodPipe` whose `_def` holds `{ type, in, out }`, and the
 * two put the object on OPPOSITE sides: `ActionSchema` reaches it through `in`,
 * `InlineActionSchema` — a `preprocess` — through `out`, because its `in` is the
 * transform. A walker that follows one edge reads the other schema as
 * unwalkable, which is a silent census cut, not an error: every absence reading
 * taken through it would be vacuous. The calibration leg below is what turns
 * that into a red run, and it is why `_def.type` is NOT a hop candidate — in
 * zod 4 it is the type NAME (`'pipe'`), a string.
 */
function objectShapeKeys(schema: unknown): string[] | null {
  type Node = {
    shape?: unknown;
    _def?: { shape?: unknown; in?: unknown; out?: unknown; innerType?: unknown };
  };
  let frontier: unknown[] = [schema];
  for (let depth = 0; depth < 6 && frontier.length > 0; depth += 1) {
    const next: unknown[] = [];
    for (const raw of frontier) {
      // ⚠️ zod 4 schemas are CALLABLE, so a `typeof !== 'object'` guard here is
      // not a type check — it is another silent census cut (objectui#8649
      // measured that one dropping 96 of 115 schemas).
      if (!raw || (typeof raw !== 'object' && typeof raw !== 'function')) continue;
      const node = raw as Node;
      let shape: unknown;
      try {
        shape = node.shape ?? node._def?.shape;
      } catch {
        shape = undefined;
      }
      const resolved = typeof shape === 'function' ? (shape as () => object)() : shape;
      if (resolved && typeof resolved === 'object') return Object.keys(resolved);
      next.push(node._def?.in, node._def?.out, node._def?.innerType);
    }
    frontier = next;
  }
  return null;
}

/** The contract's own action schemas, by the name each is published under. */
const CONTRACT_SCHEMAS = { ActionSchema, InlineActionSchema } as const;

/** Which of the contract's action schemas declare `key`. Derived every run. */
function declaringActionSchemasOf(key: string): string[] {
  return Object.entries(CONTRACT_SCHEMAS)
    .filter(([, schema]) => objectShapeKeys(schema)?.includes(key))
    .map(([name]) => name)
    .sort();
}

const maskedSource = (file: string): string => mask(readFileSync(join(RENDERERS, file), 'utf8'));

/** A cast standing between `schema` and one of the four keys. */
const castBefore = (key: string): RegExp =>
  new RegExp(String.raw`\(\s*schema\s+as\s+\w+\s*\)\s*\.\s*${key}\b`);

/**
 * The write, forwarded with NOTHING between it and `ActionDef` — the state
 * objectui#9542 left behind when it deleted this card's write-side narrowing.
 */
const UNNARROWED_WRITE = /resultDialog:\s*schema\.resultDialog\s*,/;

/** The spelling it must never regress to. */
const WRITE_SIDE_ANY = /resultDialog:\s*schema\.resultDialog as any/;

/** The un-cast read, which must still be there — a declaration over a dead read is a hole. */
const uncastRead = (key: string): RegExp => new RegExp(String.raw`(?<![.\w])schema\.${key}\b`);

describe('objectui#8648 — the census the alignment rests on (PREMISE, re-derived every run)', () => {
  it('walks both contract schemas and discriminates, so the readings below are readings', () => {
    // Calibration in both directions: an unwalkable schema would make every
    // "declared" reading vacuous, and an everything-set would make them
    // unfalsifiable.
    for (const [name, schema] of Object.entries(CONTRACT_SCHEMAS)) {
      expect(objectShapeKeys(schema), `${name} could not be walked`).not.toBeNull();
      expect(objectShapeKeys(schema)!.length).toBeGreaterThan(2);
    }
    expect(declaringActionSchemasOf('label')).toEqual(['ActionSchema', 'InlineActionSchema']);
    // ⛔ A negative control must be verified zero in the corpus being searched,
    // never inherited: the token triage used for this family is in use as two
    // other tests' own negative control in this tree, so it is nonsense no more.
    expect(declaringActionSchemasOf('wwvv_nonexistent_key_8648')).toEqual([]);
  });

  for (const key of Object.keys(CARD_KEYS)) {
    it(`\`${key}\` IS declared by the contract, on \`ActionSchema\``, () => {
      // The reading that put "declare" ON the table for this key — and the one
      // that goes RED the day the platform retires it.
      expect(declaringActionSchemasOf(key)).toContain('ActionSchema');
    });
  }

  it('the contract answers "no" on the inline sibling — the census is per-SCHEMA, not per-token', () => {
    // ⭐ Why a word-frequency screen over the contract cannot decide this card.
    // `recordIdField` and `undoable` are absent from the inline pick list while
    // present on `ActionSchema`, and spec's own `inline-action.test.ts` asserts
    // that exclusion from the other side. A token screen reads "present" for
    // both surfaces and is wrong about exactly this.
    const inlineKeys = objectShapeKeys(InlineActionSchema)!;
    expect(inlineKeys).not.toContain('recordIdField');
    expect(inlineKeys).not.toContain('undoable');
    // Calibration of the inline reading itself, so the two absences above are
    // not an empty-set artefact.
    expect(inlineKeys).toContain('label');
  });
});

describe('objectui#8648 — the mirror declaration reaches the read sites (NOT inert)', () => {
  it('the cast matcher can fire, so the negative legs below are readings', () => {
    // The controls vary ONLY the claim: the same read, re-cast and un-cast.
    expect(castBefore('disabled').test('toPredicateInput((schema as any).disabled)')).toBe(true);
    expect(castBefore('disabled').test('toPredicateInput(schema.disabled)')).toBe(false);
    expect(uncastRead('resultDialog').test('resultDialog: schema.resultDialog,')).toBe(true);
    expect(uncastRead('resultDialog').test('resultDialog: (schema as any).resultDialog,')).toBe(false);
  });

  for (const [key, files] of Object.entries(CARD_KEYS)) {
    for (const file of files) {
      it(`${file} reads \`${key}\` UN-CAST, so the declaration is enforced there`, () => {
        const source = maskedSource(file);
        // Proof the file was read and masked, so the absence below is about the
        // spelling and not about an empty string.
        expect(source).toMatch(/UIActionSchema/);
        // Liveness: the read is still here at all. A declaration guarding a
        // read that has gone is a stale entry, not a pass.
        expect(source).toMatch(uncastRead(key));
        // The guard, and the load-bearing half. Comments are masked before this
        // runs, so the spelling quoted in this file's own prose — and in the
        // renderers' — cannot satisfy or defeat it.
        expect(source).not.toMatch(castBefore(key));
      });
    }
  }
});

/*
 * The LEDGER entry this card left behind is GONE, and this block is what it
 * became. objectui#9542 made `@object-ui/core`'s `ResultDialogSpec` DERIVE its
 * label members from the contract instead of hand-writing them as `string`, so
 * the narrowing assertion that stood at both write sites had nothing left to
 * narrow and was deleted — the workaround did not outlive its cause.
 *
 * ⭐ What survives is the half that was never a workaround: the `as any`
 * negative. `castBefore` matches a cast between `schema` and the key, which a
 * cast on the WRITE side — `schema.resultDialog as any` — walks straight past,
 * so this is the only leg that refuses it. It is also the spelling that hid two
 * defects at once, which is why the guard outlives the entry.
 */
describe('objectui#9542 — the `resultDialog` write reaches `ActionDef` with nothing between', () => {
  it('both matchers can fire, so the legs below are readings', () => {
    // The controls vary ONLY the claim: the same write, asserted and plain.
    const narrowed = "resultDialog: schema.resultDialog as ActionDef['resultDialog'],";
    expect(UNNARROWED_WRITE.test('resultDialog: schema.resultDialog,')).toBe(true);
    expect(UNNARROWED_WRITE.test(narrowed)).toBe(false);
    expect(WRITE_SIDE_ANY.test('resultDialog: schema.resultDialog as any,')).toBe(true);
    expect(WRITE_SIDE_ANY.test('resultDialog: schema.resultDialog,')).toBe(false);
  });

  for (const file of CARD_KEYS.resultDialog) {
    it(`${file} forwards \`resultDialog\` unasserted, and never as \`any\``, () => {
      const source = maskedSource(file);
      // Proof the file was read and masked, so the reading below is about the
      // spelling and not about an empty string.
      expect(source).toMatch(/UIActionSchema/);
      expect(source).toMatch(UNNARROWED_WRITE);
      // ⛔ The spelling that hid two defects at once must not come back. `as
      // any` here would re-swallow a future `ResultDialogSpec` drift AND make
      // the mirror declaration inert at this site in one stroke.
      expect(source).not.toMatch(WRITE_SIDE_ANY);
    });
  }
});
