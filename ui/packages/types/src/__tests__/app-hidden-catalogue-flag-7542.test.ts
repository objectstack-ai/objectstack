// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `AppComponentSchema.hidden` is the spec's APP-CATALOGUE boolean on both
 * faces, not the renderer's hide predicate (objectui#7542, direction 1).
 *
 * ## The collision
 *
 * Two keys share one name on the `app` node and mean different things:
 *
 *   - `BaseSchema.hidden` is the renderer's hide predicate,
 *     `boolean | ExpressionWire`, evaluated by `SchemaRenderer`'s `shouldHide`
 *     chain (objectui#7455 widened it to the string, objectui#7530 to the CEL
 *     envelope object) — every other node inherits it;
 *   - `@objectstack/spec/ui` `AppSchema.hidden` is the app-catalogue flag
 *     ("Hide from the App Switcher"), `z.boolean().optional()`.
 *
 * The zod mirror is `BaseSchema.extend(SpecAppFields.shape).extend({…})` and
 * `SpecAppFields` does not exclude `hidden`, so the spec's boolean lands AFTER
 * the base's key and overrides it: the validator has always refused a predicate
 * on an `app` document. The TS interface restated nothing and inherited the
 * base's union, so the published declaration invited a spelling the published
 * validator refused — `declared !== enforced`, seeded into `KnownDrift` by
 * objectui#7455 as the one pair that widening moved on one face only.
 *
 * ## Measured before the change (red-first, on `origin/main` 669d71bf)
 *
 *   • spec — `AppSchema.shape.hidden` is `optional(boolean)`; `visible` and
 *     `disabled` are not in the shape (`@objectstack/spec@17.2.0`, resolved
 *     through the installed pin). `AppSchema.safeParse({ …, hidden: 'user.role
 *     == "admin"' })` → `invalid_type` at `hidden`, expected boolean.
 *   • zod — `AppComponentSchema.safeParse({ type: 'app', …, hidden: STRING })`
 *     → `invalid_type` at path `hidden`; `safeValidateSchema` on the same
 *     document → root `invalid_union` whose `app` arm carries that same issue.
 *     The CEL envelope object was refused the same way. `hidden: true` / `false`
 *     parsed on both entry paths.
 *   • TS — `AppComponentSchema['hidden']` read `boolean | ExpressionWire |
 *     undefined`, inherited; a predicate string on a typed `app` document
 *     compiled.
 *
 * ## What this file pins, and why in this shape
 *
 *   1. Type level — `AppComponentSchema['hidden']` is EXACTLY
 *      `boolean | undefined`, and a predicate string on a typed `app` document
 *      is a compile error (`@ts-expect-error`, which fails the build with
 *      TS2578 the moment the restatement is deleted and the member widens back
 *      to the inherited union). `Equal`, not `extends`: `boolean` is assignable
 *      to the wide union, so a one-way check stays green on the very
 *      inheritance this card removes.
 *   2. Runtime — the mirror accepts `true` / `false` and refuses the string and
 *      the envelope AT PATH `hidden`, on BOTH entry paths (`AppComponentSchema`
 *      directly and `safeValidateSchema`, whose union arm is where an author's
 *      document actually meets the validator).
 *   3. Controls — `BaseSchema` and one ordinary node (`ButtonSchema`) still
 *      accept the string and the envelope on `hidden`, on both faces. If those
 *      go red the failure is about the predicate, not about the app node, and
 *      the refusals above would be passing for the wrong reason.
 *   4. The spec reading, live through the installed pin, with a control key —
 *      so a spec release that renames or widens the catalogue flag (direction 2
 *      of the card) turns this file red here instead of drifting silently.
 *   5. The `KnownDrift` row objectui#7455 seeded is ABSENT from the ledger, read
 *      off disk, beside a control that the reader can see the ledger and that
 *      the pair is still registered. ⛔ The row may only be absent because the
 *      face moved: `zod-mirror-parity.test.ts` re-derives the drift and turns
 *      red naming the pair if the declaration ever widens again with no entry.
 *
 * The in-repo reader agrees with the boolean: `filterActiveApps`
 * (`packages/app-shell/src/utils/appRoute.ts`) keeps an app out of the launcher
 * on `hidden !== true` and never evaluates the value, so a predicate string on
 * this node would have read as "not hidden" without a sound.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppSchema as SpecAppSchema } from '@objectstack/spec/ui';

import type { AppComponentSchema } from '../app';
import type { BaseSchema } from '../base';
import type { ButtonSchema } from '../form';
import type { ExpressionWire } from '../expression';
import { AppComponentSchema as AppMirror } from '../zod/app.zod';
import { BaseSchema as BaseMirror } from '../zod/base.zod';
import { ButtonSchema as ButtonMirror } from '../zod/form.zod';
import { safeValidateSchema } from '../zod/index.zod';

/* ── Type-level helpers ──────────────────────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/* ── The declared type is the spec's boolean, and only on this node ──────── */

/** The app node: the catalogue flag, exactly `boolean | undefined`. */
export type assertionAppHiddenIsCatalogueBoolean = Expect<
  Equal< AppComponentSchema['hidden'], boolean | undefined >
>;

/** Control: the base still declares the renderer's predicate union. */
export type assertionBaseHiddenStillPredicate = Expect<
  Equal< BaseSchema['hidden'], boolean | ExpressionWire | undefined >
>;

/** Control: an ordinary node still inherits that union unchanged. */
export type assertionButtonHiddenStillPredicate = Expect<
  Equal< ButtonSchema['hidden'], BaseSchema['hidden'] >
>;

/* ── Authorable fixtures ─────────────────────────────────────────────────── */

/** The catalogue flag, authored on a typed app document. */
export const appHiddenFromSwitcher: AppComponentSchema = {
  type: 'app',
  name: 'personal-settings',
  hidden: true,
};

/** Control: the predicate spelling is still authorable on an ordinary node. */
export const buttonHiddenByPredicate: ButtonSchema = {
  type: 'button',
  hidden: 'user.role == "admin"',
};

/* ── Runtime companions ──────────────────────────────────────────────────── */

const PREDICATE = 'user.role == "admin"';
const ENVELOPE = { dialect: 'cel', source: 'user.role == "admin"' } as const;

const appDoc = (hidden: unknown) => ({ type: 'app', name: 'crm', label: 'CRM', hidden });

/** zod 4 issue, with the per-arm `errors` an `invalid_union` carries. */
interface Issue {
  code?: string;
  path?: readonly (string | number)[];
  message?: string;
  errors?: readonly (readonly Issue[])[];
}

/**
 * Every issue as `path` + `message`, with the nested arm errors of an
 * `invalid_union` flattened in: `AnyComponentSchema` is a plain `z.union`, so a
 * refusal inside the `app` arm surfaces as one root `invalid_union` issue whose
 * `errors` carry the per-arm paths.
 */
function issueEntries(issues: readonly Issue[], prefix: readonly (string | number)[] = []): Array<{ path: string; message: string }> {
  const out: Array<{ path: string; message: string }> = [];
  for (const issue of issues) {
    const path = [...prefix, ...(issue.path ?? [])];
    out.push({ path: path.join('.'), message: issue.message ?? '' });
    for (const nested of issue.errors ?? []) out.push(...issueEntries(nested, path));
  }
  return out;
}

/**
 * `true` when some issue (any arm) refuses at path `hidden` expecting a boolean.
 * Takes the structural shape of a `safeParse` result rather than zod's own
 * `ZodSafeParseResult`, whose issue `path` admits `symbol`; the cast narrows to
 * the two members read here and nothing else.
 */
function refusesHiddenExpectingBoolean(result: { success: boolean; error?: { issues: readonly unknown[] } }): boolean {
  if (result.success || !result.error) return false;
  return issueEntries(result.error.issues as readonly Issue[]).some(
    (entry) => entry.path === 'hidden' && /expected boolean/.test(entry.message),
  );
}

describe('AppComponentSchema.hidden is the app-catalogue boolean (objectui#7542)', () => {
  it('type-level: hidden is boolean | undefined on the app node, pinned invariantly', () => {
    // Erased at runtime; `tsc -p tsconfig.test.json` is the checker, chained
    // from this package's `type-check` script. The runtime case exists so a
    // green vitest run is not mistaken for the proof.
    expect(appHiddenFromSwitcher.hidden).toBe(true);
    expect(buttonHiddenByPredicate.hidden).toBe(PREDICATE);
  });

  it('type-level: a predicate string on a typed app document does not compile', () => {
    // This directive fails the build (TS2578, "unused '@ts-expect-error'") the
    // moment the restatement in `app.ts` is deleted, because the member then
    // inherits `boolean | ExpressionWire` and the assignment starts succeeding.
    // That failure is the signal this card exists to create.

    // @ts-expect-error — on the app node `hidden` is the spec's boolean, not a predicate.
    const doc: AppComponentSchema = { type: 'app', name: 'crm', hidden: PREDICATE };

    expect(doc.hidden).toBe(PREDICATE);
  });

  it('zod mirror: the boolean form parses in full on both entry paths', () => {
    for (const value of [true, false]) {
      expect(AppMirror.safeParse(appDoc(value)).success, `direct, hidden: ${value}`).toBe(true);
      expect(safeValidateSchema(appDoc(value)).success, `union, hidden: ${value}`).toBe(true);
    }
  });

  it('zod mirror: a predicate string is refused at path `hidden` on both entry paths', () => {
    const direct = AppMirror.safeParse(appDoc(PREDICATE));
    expect(direct.success).toBe(false);
    expect(refusesHiddenExpectingBoolean(direct)).toBe(true);

    const union = safeValidateSchema(appDoc(PREDICATE));
    expect(union.success).toBe(false);
    expect(refusesHiddenExpectingBoolean(union)).toBe(true);
  });

  it('zod mirror: the CEL envelope object is refused at path `hidden` on both entry paths', () => {
    const direct = AppMirror.safeParse(appDoc(ENVELOPE));
    expect(direct.success).toBe(false);
    expect(refusesHiddenExpectingBoolean(direct)).toBe(true);

    const union = safeValidateSchema(appDoc(ENVELOPE));
    expect(union.success).toBe(false);
    expect(refusesHiddenExpectingBoolean(union)).toBe(true);
  });

  it('control: BaseSchema and an ordinary node still accept the predicate on `hidden`, both faces', () => {
    // If these go red, the failure is NOT about the app node, and the refusals
    // above would have been passing for the wrong reason.
    expect(BaseMirror.safeParse({ type: 'probe', hidden: PREDICATE }).success).toBe(true);
    expect(BaseMirror.safeParse({ type: 'probe', hidden: ENVELOPE }).success).toBe(true);
    expect(ButtonMirror.safeParse({ type: 'button', hidden: PREDICATE }).success).toBe(true);
    expect(ButtonMirror.safeParse({ type: 'button', hidden: ENVELOPE }).success).toBe(true);
    // The union entry path, same document, ordinary node: green — so the app
    // refusal above is the app ARM's, not the union's.
    expect(safeValidateSchema({ type: 'button', hidden: PREDICATE }).success).toBe(true);
    expect(safeValidateSchema({ type: 'button', hidden: ENVELOPE }).success).toBe(true);
  });

  it('spec: AppSchema declares `hidden` as a boolean and neither `visible` nor `disabled` — live through the pin', () => {
    const shape = (SpecAppSchema as unknown as { shape: Record<string, unknown> }).shape;
    // Control key first: an empty or mis-resolved shape must not pass the
    // absence checks below vacuously.
    expect(Object.keys(shape)).toContain('active');
    expect(Object.keys(shape)).toContain('hidden');
    expect(Object.keys(shape)).not.toContain('visible');
    expect(Object.keys(shape)).not.toContain('disabled');

    const specDoc = (hidden: unknown) => ({ name: 'crm', label: 'CRM', hidden });
    expect(SpecAppSchema.safeParse(specDoc(true)).success).toBe(true);
    expect(SpecAppSchema.safeParse(specDoc(false)).success).toBe(true);
    expect(refusesHiddenExpectingBoolean(SpecAppSchema.safeParse(specDoc(PREDICATE)))).toBe(true);
    expect(refusesHiddenExpectingBoolean(SpecAppSchema.safeParse(specDoc(ENVELOPE)))).toBe(true);
  });

  it('ledger: the `KnownDrift` row objectui#7455 seeded for this pair is gone, and only that row', () => {
    const HERE = dirname(fileURLToPath(import.meta.url));
    const parity = readFileSync(join(HERE, 'zod-mirror-parity.test.ts'), 'utf8');

    const start = parity.indexOf('interface KnownDrift {');
    expect(start, 'the reader cannot see the KnownDrift ledger').toBeGreaterThan(-1);
    const end = parity.indexOf('\n}\n', start);
    const ledger = parity.slice(start, end);

    // Control: the reader sees a populated ledger, not an empty slice.
    expect(ledger).toContain("'complex.zod.ts#CalendarViewSchema'");
    // The row itself: absent from the KnownDrift block.
    expect(ledger).not.toContain("'app.zod.ts#AppComponentSchema'");
    // Control: the pair is still registered — the drift census still covers it,
    // so a future widening of the declared face reddens the parity file by name.
    expect(parity).toContain("'app.zod.ts#AppComponentSchema': AppComponentSchema,");
  });
});
