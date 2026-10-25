/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Declaration pin — the two trigger-button keys the `toast` renderer reads that
 * `ToastSchema` did not declare (objectui#6496).
 *
 * ## What was wrong
 *
 * `renderers/feedback/toast.tsx` renders a `<Button>` that raises the toast:
 * `variant={schema.buttonVariant}` on :30, `{schema.buttonLabel || 'Show Toast'}`
 * on :31. The registration's own `inputs` offered `buttonLabel` as an authoring
 * control (with `defaultValue: 'Show Toast'`), and `ToastSchema` declared
 * NEITHER key — on the TS face or in the zod mirror. So the designer offered a
 * control for a key the shipped type did not have, and `buttonVariant` was read
 * by the renderer and named by nothing at all.
 *
 * `SonnerSchema` — the sibling component with the same trigger mechanism —
 * declared both all along. objectui#6496 was the declare-what-runs half only;
 * `action` / `onDismiss` (declared-but-unread, the other direction the finding
 * recorded) were left to the objectui#6124 / objectui#6182 handler-dialect
 * family, and `onDismiss` did land there.
 *
 * ## `action` came back here, and NOT to the handler family (objectui#8338)
 *
 * ⚠️ The sentence above used to say `action` was deliberately untouched here.
 * That is no longer true, and the reason it moved is worth stating: `action` is
 * ⛔ NOT a handler key. It is a VALUE key whose NESTED member was a function,
 * which is exactly why objectui#6124's sweep — over TOP-LEVEL function-valued
 * keys — walked past it and retired only `onDismiss`, four lines down. So it
 * takes `retirementTombstone()` (an ADR-0049 retirement from the contract on
 * both faces: `invalid_type`, `?: never`) and ⛔ not `handlerKeyRefusal()` (the
 * #6124 named-refusal arm: `custom`, and a TS twin that stays callable for a
 * runtime slot). `handler-keys-json-refusal-6124.test.ts` pins that family and
 * its census asserts 45 runtime slots + 22 retired `on*` sites; a non-handler
 * key has no seat in it. This file — the `ToastSchema` declaration pin — is the
 * home, and the two helpers are pinned APART there, deliberately.
 *
 * What was wrong with `action`, measured before the retirement: the TS face
 * declared `{ label: string; onClick: () => void }` with BOTH members required,
 * so no JSON value satisfied it, while the mirror admitted
 * `z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)])`. Disjoint accept
 * sets, one of them empty — a green `safeParse` and a `tsc` refusal for the
 * same document, and no spelling that satisfied both. The renderer read
 * neither. ⛔ There is NO replacement spelling: objectui#6250 moved the toast
 * demos off an in-toast action entirely and the capability was never fulfilled.
 *
 * ## Why `buttonVariant` is an enum and not `z.string()`
 *
 * The two faces of `SonnerSchema` disagree — `z.string()` in the mirror,
 * a six-member union in TS — so "match the sibling" does not pick a shape. The
 * ground truth is what the value REACHES: the renderer passes it straight to
 * `<Button variant={…}>`, whose prop type is
 * `VariantProps<typeof buttonVariants>['variant']`. Measured, `cva` contributes
 * NO variant class for an unrecognised key and falls back to `defaultVariants`
 * only when the value is ABSENT:
 *
 *     buttonVariants({ variant: undefined }) -> "base … bg-primary …"
 *     buttonVariants({ variant: 'ghost'   }) -> "base … hover:bg-accent …"
 *     buttonVariants({ variant: 'primary' }) -> "base …"          (no colour)
 *
 * So an open `string` does not merely under-validate — it admits values that
 * render a button with no background and no text colour, silently. The TS face
 * is the correct one and both faces here carry it. That the six ARE exactly the
 * Button's own vocabulary is pinned where the Button is visible, in
 * `components/src/__tests__/toast-button-variant-parity.test.ts`; this package
 * has zero deps and cannot see it.
 *
 * ## What this pin has teeth against, and what it does not
 *
 * Same ceiling as objectui#6170's timeline pin and objectui#5903's gantt pin.
 * `BaseSchema` is `.passthrough()` on the zod side and carries `[key: string]:
 * any` on the TS side, so:
 *
 *   - an UNDECLARED key is still ACCEPTED by both halves. Declaring these two
 *     did not buy rejection of a misspelling, and the pin below says so;
 *   - a DECLARED key IS validated. `buttonVariant: 'primary'` parsed green
 *     before this card and is refused now — that narrowing is the whole change.
 *
 * That asymmetry is also what makes this file a real reverse-verification and
 * not a round-trip that would have passed anyway: a pin asserting `safeParse`
 * SUCCEEDS on `{ buttonLabel, buttonVariant }` passes against the undeclared
 * tree too, because passthrough keeps the keys rather than refusing them. The
 * assertions with teeth are the REFUSALS (`itRefuses…`) and the
 * `@ts-expect-error` block; both were run against the undeclared tree and both
 * fail there. See the PR for the recorded red.
 */

import { describe, it, expect } from 'vitest';
import { ToastSchema } from '../zod/feedback.zod.js';
import type { ToastSchema as ToastSchemaTS } from '../feedback';

const MINIMAL = { type: 'toast' } as const;

/** The six the Button accepts, in the order `SonnerSchema`'s TS face spells them. */
const BUTTON_VARIANTS = ['default', 'secondary', 'destructive', 'outline', 'ghost', 'link'] as const;

/** Each declared key with a value its declared type refuses. */
const DECLARED: ReadonlyArray<readonly [string, unknown]> = [
  ['buttonLabel', 42],
  ['buttonVariant', 'primary'],
];

describe('ToastSchema — the two trigger-button keys are declared (objectui#6496)', () => {
  it('the mirror declares both of them', () => {
    const shape = Object.keys(ToastSchema.shape);
    for (const [key] of DECLARED) expect(shape, `mirror is missing ${key}`).toContain(key);
  });

  it('declares them OPTIONAL — a bare `{ type: "toast" }` still parses', () => {
    // Requiredness is the half the zod-mirror-parity ratchet compares against
    // `../feedback.ts`, where both are `?:`. A mirror that required one would
    // reject every toast already published, including the seven fixtures in
    // `examples/schema-catalog/src/schemas/components-feedback-toast/`.
    const result = ToastSchema.safeParse(MINIMAL);
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('materialises NO defaults — an omitted key stays absent after parse', () => {
    // `buttonLabel` defaults IN THE RENDERER, by `||` (`schema.buttonLabel ||
    // 'Show Toast'`), and `buttonVariant` defaults inside `cva`. A `.default()`
    // here would arrive downstream as an explicit author choice; the spellings
    // are not interchangeable.
    const result = ToastSchema.safeParse(MINIMAL);
    expect(result.success).toBe(true);
    if (!result.success) return;
    for (const [key] of DECLARED) expect(key in result.data, `${key} must stay absent`).toBe(false);
  });

  it('refuses a wrong-typed value on each declared key (declared-key validation under passthrough)', () => {
    // ⚠️ THE reverse-verifiable assertion. Against the undeclared tree both keys
    // are stripped by passthrough and `.success` stays `true`, so this block is
    // red there and green here.
    for (const [key, bad] of DECLARED) {
      const result = ToastSchema.safeParse({ ...MINIMAL, [key]: bad });
      expect(result.success, `${key} accepted ${JSON.stringify(bad)}`).toBe(false);
      if (result.success) continue;
      const issue = result.error.issues.find((i) => i.path[0] === key);
      expect(issue, `${key} failed, but not on the ${key} path`).toBeTruthy();
    }
  });

  it('accepts a well-typed value on each declared key', () => {
    // Counter-probe for the assertion above: it must be the VALUE being refused,
    // not the key. A pin that only ever sees red proves nothing.
    const result = ToastSchema.safeParse({ ...MINIMAL, buttonLabel: 'Undo', buttonVariant: 'outline' });
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('`buttonVariant` accepts exactly the Button vocabulary and nothing else', () => {
    for (const value of BUTTON_VARIANTS) {
      const result = ToastSchema.safeParse({ ...MINIMAL, buttonVariant: value });
      expect(result.success, `refused real Button variant '${value}'`).toBe(true);
    }
    // Plausible misspellings. `primary` is the likeliest — the default variant's
    // own class is `bg-primary`, so the name reads correct and is not; it and
    // the next three render an UNSTYLED button today. `''` is the one that does
    // not look wrong: `cva`'s falsy fallback silently resolves it to `default`,
    // so under an open `z.string()` it would render correctly and mean nothing.
    // Both behaviours are measured in the components parity pin.
    for (const value of ['primary', 'danger', 'warning', 'Default', '']) {
      const result = ToastSchema.safeParse({ ...MINIMAL, buttonVariant: value });
      expect(result.success, `accepted non-variant '${value}'`).toBe(false);
    }
  });

  it('is NOT `z.string()` — the shape `SonnerSchema`’s mirror used for the same key', () => {
    // Stated as a pin because the obvious way to write this card was to copy the
    // sibling mirror verbatim, and at the time Sonner's two faces disagreed with
    // each other (`z.string()` vs the six-member union). That disagreement was
    // filed as objectui#6541 rather than fixed here, and #6541 has since
    // narrowed Sonner's mirror to this same enum — so the two nodes now agree,
    // and this pin keeps guarding the shape rather than the sibling.
    expect(ToastSchema.safeParse({ ...MINIMAL, buttonVariant: 'anything-at-all' }).success).toBe(false);
  });

  it('does NOT reject an undeclared key — objectui#5155’s ceiling, measured not assumed', () => {
    // Declaring the two bought validation of DECLARED keys, not rejection of
    // undeclared ones: `BaseSchema` is `.passthrough()`. Anyone reading this
    // card as "misspellings now fail" is reading it wrong, and this pin says so
    // in the one place that cannot rot.
    const misspelled = ToastSchema.safeParse({ ...MINIMAL, buttonlabel: 'Undo', buttonVarient: 'ghost' });
    expect(misspelled.success).toBe(true);
  });
});

describe('ToastSchema (TS) — compile-time pin on the same keys', () => {
  it('accepts the authoring form the renderer has always supported', () => {
    const toastSchema: ToastSchemaTS = {
      type: 'toast',
      title: 'Saved',
      variant: 'success',
      buttonLabel: 'Save record',
      buttonVariant: 'outline',
    };
    expect(toastSchema.buttonLabel).toBe('Save record');
  });

  it('refuses a wrong-typed value on every declared key', () => {
    // Each directive below failed the build (TS2578, "unused '@ts-expect-error'")
    // the moment its key stopped being declared, while the member resolved to
    // `any` through `BaseSchema`'s index signature. Since objectui#8347 a removal
    // makes the indexed access itself an error, which its directive swallows, so
    // the deletion signal comes from the well-typed counter-probe below; each
    // directive still fails the build if its member is widened, and it is real
    // enforcement rather than decoration because `tsconfig.test.json` compiles
    // this file (objectui#3009).

    // @ts-expect-error — `buttonLabel` is declared `string | undefined`.
    const buttonLabel: ToastSchemaTS['buttonLabel'] = 42;
    // @ts-expect-error — `buttonVariant` is declared as the six Button variants.
    const buttonVariant: ToastSchemaTS['buttonVariant'] = 'primary';

    expect([buttonLabel, buttonVariant]).toHaveLength(2);
  });

  it('accepts the well-typed value on every declared key', () => {
    // Counter-probe for the directives above: without this, a declaration
    // narrowed to `never` would satisfy both of them.
    const buttonLabel: ToastSchemaTS['buttonLabel'] = 'Show Toast';
    const buttonVariant: ToastSchemaTS['buttonVariant'] = 'ghost';
    expect([buttonLabel, buttonVariant]).toEqual(['Show Toast', 'ghost']);
  });

  it('offers every one of the six, and only those six', () => {
    const every: NonNullable<ToastSchemaTS['buttonVariant']>[] = [...BUTTON_VARIANTS];
    // @ts-expect-error — the type is closed; a seventh look is not authorable.
    const extra: ToastSchemaTS['buttonVariant'] = 'primary';
    expect([...every, extra]).toHaveLength(7);
  });
});

/* ── `action` is RETIRED on both faces (objectui#8338, ADR-0049) ──────────── */

/** The shape the TS face declared: the one no JSON document could ever hold. */
const RETIRED_TS_SHAPE = { label: 'Undo', onClick: () => undefined };
/** What the MIRROR admitted: `SchemaNodeSchema | SchemaNodeSchema[]` — and that
 *  node union is `z.union([BaseSchemaCore, z.string(), z.number(), z.boolean(),
 *  z.null(), z.undefined()])` (`../zod/base.zod.ts`), so BARE PRIMITIVES parsed
 *  green here too, not just node objects. Re-derived by re-forming the old union
 *  around the SHIPPED `SchemaNodeSchema`; the primitive arms are the larger half
 *  of the narrowing and were missing from the first reading of it.
 *  ⚠️ This list must stay MIXED — vitest spreads an `it.each` case only when
 *  `cases.every(Array.isArray)`, and the list arm has to arrive as ONE argument.
 *  Pinned below: it is a property of the DATA that nothing else here would miss. */
const RETIRED_MIRROR_SHAPES = [{ type: 'button', label: 'Undo' }, [{ type: 'button' }], 'Undo', 1, null];

describe('ToastSchema — `action` is retired, not deleted (objectui#8338)', () => {
  it('the mirror still DECLARES the key — a deletion would be a silent accept', () => {
    // `BaseSchema` is `.passthrough()`, so removing the member would KEEP an
    // authored value unvalidated instead of refusing it. The tombstone is the
    // whole point: the key stays declared and is unwritable.
    expect(Object.keys(ToastSchema.shape)).toContain('action');
  });

  it('refuses the object the TS face used to declare, at the `action` path', () => {
    const result = ToastSchema.safeParse({ ...MINIMAL, action: RETIRED_TS_SHAPE });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => String(i.path[0]) === 'action');
    expect(issue, 'no issue addressed to `action`').toBeDefined();
    // `invalid_type`, the tombstone's code — ⛔ not `custom`, which is what
    // `handlerKeyRefusal()` (the neighbour on `onDismiss`) reports.
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.path).toEqual(['action']);
  });

  it('the shape list stays MIXED, so `it.each` hands each case over whole', () => {
    expect(RETIRED_MIRROR_SHAPES.every(Array.isArray)).toBe(false);
  });

  it.each(RETIRED_MIRROR_SHAPES)('refuses the shape the mirror used to admit: %j', (authored) => {
    // ⚠️ THE breaking assertion. Every one of these parsed GREEN before this
    // card, so a document already authored this way stops parsing. Ablate the
    // tombstone back to `z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)])`
    // and this block goes green again — which is what makes it a pin.
    const result = ToastSchema.safeParse({ ...MINIMAL, action: authored });
    expect(result.success, `still accepts ${JSON.stringify(authored)}`).toBe(false);
  });

  it('carries its guidance in BOTH author-facing channels, as ONE string', () => {
    // The `retirementTombstone()` invariant: the parse-time message and the
    // `.describe()` metadata are the same argument, so they cannot drift.
    const result = ToastSchema.safeParse({ ...MINIMAL, action: RETIRED_TS_SHAPE });
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = result.error.issues.find((i) => String(i.path[0]) === 'action')!.message;
    const described = (ToastSchema.shape.action as { description?: string }).description;
    expect(message).toBe(described);
    expect(message).toContain('RETIRED (objectui#8338');
    // The remedy is that there ISN'T one — ⛔ not "not yet supported", and ⛔ not
    // a future shape. The tombstone says the capability was never fulfilled and
    // points at the keys that DO run.
    expect(message).toContain('NO replacement spelling');
    expect(message).toContain('buttonLabel');
  });

  it('a toast without `action` still parses — the refusal is about the key, not the node', () => {
    // Counter-probe. Without it a mirror broken outright would satisfy every
    // refusal above. The seven published fixtures in
    // `examples/schema-catalog/src/schemas/components-feedback-toast/` are this
    // shape, and objectui#6250 already moved them off in-toast action.
    const result = ToastSchema.safeParse({ ...MINIMAL, title: 'Saved', buttonLabel: 'Undo' });
    expect(result.success ? null : result.error.issues).toBe(null);
  });
});

describe('ToastSchema (TS) — `action` is a `?: never` tombstone (objectui#8338)', () => {
  it('refuses the object the declaration used to carry', () => {
    // Compiled by `tsconfig.test.json` (objectui#3009), so this directive is
    // real enforcement. It failed the build with TS2578 the moment the member was
    // DELETED rather than tombstoned, while the key resolved to `any` through
    // `BaseSchema`'s index signature. Since objectui#8347 a deletion makes the
    // indexed access itself an error, which this directive swallows, so the
    // `Equal` row below catches it instead.
    // @ts-expect-error — `action` is retired; the type is `never`.
    const action: ToastSchemaTS['action'] = { label: 'Undo', onClick: () => undefined };
    // @ts-expect-error — and the node shape the mirror used to admit is not it either.
    const node: ToastSchemaTS['action'] = { type: 'button' };
    expect([action, node]).toHaveLength(2);
  });

  it('reads as exactly `undefined` off the interface', () => {
    // The type-level half runs at `tsc`; this body only keeps the assertion
    // reachable from a test name. `Equal`, ⛔ not `extends`: a DELETED member
    // read `any` through the index signature until objectui#8347 and a one-way
    // check would accept it — the same trap `handler-keys-json-refusal-6124.test.ts` names.
    const absent: ToastSchemaTS = { type: 'toast' };
    expect('action' in absent).toBe(false);
  });
});

/* ── The TypeScript face, judged by `tsc -p tsconfig.test.json` ──────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

export type assertionToastActionIsTombstoned = [
  Expect<Equal<ToastSchemaTS['action'], undefined>>,
];
