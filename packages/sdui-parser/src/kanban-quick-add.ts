/**
 * The inert `quickAdd` on the `ObjectKanbanRenderer` tag (objectui#8285,
 * director-seat ruling of 2026-09-08, decision batch #91)
 *
 * ## WHY THIS MODULE EXISTS HERE
 *
 * Two copies of this parser exist: objectui's `packages/sdui-parser` (which the
 * browser RENDERER runs) and this one (which the SAVE GATE runs). Everything
 * from the `import` line below to end of file is the port of objectui's copy.
 * The two copies must agree on the accepted grammar AND on diagnostic codes —
 * if they drift, the save gate and the renderer speak different dialects and a
 * page can save clean and render inert. Change this only together with the
 * objectui copy, and re-record `pnpm gen:sdui-lockstep` when you do.
 *
 * ## What is wrong, measured rather than argued
 *
 * `@objectstack/spec`'s `ComponentPropsMap['object-kanban']` publishes
 * `quickAdd: z.boolean().optional()`, and the board does not honour it.
 * `KanbanImpl` gates the Quick Add control on BOTH halves of a pair —
 * `quickAdd && onQuickAdd`, at the in-column button and again at
 * `QuickAddForm` — and `onQuickAdd` is a RUNTIME SLOT: a host-supplied
 * FUNCTION, refused by name in `complex.zod.ts` because JSON has no function
 * value. `ObjectKanban` substitutes its own `onCardMove` and `onCardClick` and
 * stops there; it supplies no `onQuickAdd`.
 *
 * On THIS tier the second half is not merely absent, it is unwritable: a
 * handler attribute on a parsed page draws `forbidden-attr`, because this tier
 * parses and never executes. So `quickAdd` is inert for every author who can
 * reach it here — there is no out-of-band consumer to protect, which is the
 * fact that makes the diagnostic below unconditional rather than escape-hatched
 * the way `unconsumed-widget-option` is.
 *
 * ## What this replaces, and why the previous reading was WRONG rather than absent
 *
 * `quickAdd` is deliberately absent from the kanban registrations' declared
 * inputs (objectui#8201 escalated it rather than declaring it), so
 * `validateTree` already reported it — as `unknown-prop`, "has no prop
 * quickAdd".
 *
 * That message is a MISDIAGNOSIS. objectui#8201's pin header records the same
 * shape from the other direction: a tier telling an author that spellings which
 * WORK are unknown "trains authors (AI authors included) to delete working
 * metadata". Here the falsehood runs the other way and is worse for it — the
 * spec DOES publish this prop, so an author who checks the contract finds the
 * warning contradicted, concludes the manifest is behind the spec, and keeps a
 * key that will never do anything. It also cannot be told apart from a typo, so
 * nothing anywhere records WHY the key is refused.
 *
 * This module says the true thing instead: the pair, the missing half, and
 * where the pair does work.
 *
 * ## Severity — WARNING, and the escalation is deliberately not taken
 *
 * The ruling's word is "diagnosed", not "refused", and every diagnostic in this
 * family is a warning: `unknown-prop` (what this replaces, so nothing hardens),
 * `inert-expression`, and `unconsumed-widget-option`, whose objectui#5709
 * ruling states the constraint directly — "no gate weakening and no new red
 * gates were ruled". `validate.ts`'s `inert-expression` note records that
 * escalating an inert authored key to `error` is a SEPARATE question
 * (objectui#6614 Q2) belonging at the save gate, and it is not answered here:
 * an error would stop a page that saves today from saving, which is a cost, and
 * costs are the maintainer's to impose.
 *
 * The contract-side refusal is where the hardening belongs, and it is already
 * ruled: option B retires `object-kanban.quickAdd` from the spec's
 * `ComponentPropsMap` (ADR-0049 enforce-or-remove), after which a strict parse
 * refuses the key BY NAME and this module is deleted along with the interim it
 * names. ⚠️ THIS FILE IS THAT INTERIM.
 *
 * ## Scope — the three places this deliberately does not fire
 *
 *   - `KanbanRenderer`, the component. The ruling keeps the `quickAdd` /
 *     `onQuickAdd` pair there untouched: it forwards both halves by identity,
 *     and a React host mounting it CAN pass the function. ⚠️ It is no longer
 *     reachable as a TAG — objectui#8257 retired the `kanban-ui` registration,
 *     so `<kanban-ui>` is now an `unknown-component` ERROR, not a block with a
 *     working pair. The component stays exported from
 *     `@object-ui/plugin-kanban`, which is the surviving way to get the pair,
 *     and is what this module's message names.
 *   - `quickAdd: false`, and any other falsy value. The renderer's own gate is
 *     `quickAdd && onQuickAdd`, so a falsy value asks for no control and gets
 *     none — the author got what they wrote, and nothing was dropped. The
 *     ruling names `quickAdd: true`.
 *   - A braced value this tier never evaluates (the parser's `$expr` marker).
 *     It is opaque here, so "the author asked for the control" is not a reading
 *     this module can make; the value's own inertness is `inert-expression`'s
 *     subject, not this one's.
 */
import type { Diagnostic } from './types.js';

/** The diagnostic `code` this module emits. */
export const INERT_QUICK_ADD = 'inert-quick-add';

/** The authored key it is about. */
export const QUICK_ADD_KEY = 'quickAdd';

/**
 * The tags served by `ObjectKanbanRenderer` — the registrations in objectui's
 * `packages/plugin-kanban/src/index.tsx`, which is where another one would
 * appear. Restated here as data because this package is deliberately free of
 * any dependency on the registry or on a plugin (see `RegistryConfigLike` in
 * `index.ts`).
 *
 * ⚠️ **`kanban` left this set with its registration** (objectui#8802, ruled
 * 2026-09-09; `kanban-ui` and `kanban-enhanced` went the same way under
 * objectui#8257). Keeping it would have been dead data, MEASURED and not
 * assumed: `checkKanbanQuickAdd` has exactly one call site, inside
 * `validate.ts`'s prop walk, and that walk runs only in the branch where
 * `manifest.components[node.type]` RESOLVED. A tag no registration produces is
 * answered one level up, by `unknown-component`, and its props are never walked
 * at all — so on a manifest built from the live registry a `<kanban quickAdd>`
 * node draws `error/unknown-component` and nothing else, against a firing
 * control on `<object-kanban quickAdd>` that draws `warning/inert-quick-add`.
 * ⛔ Nothing is silently dropped by the narrowing: the retired spelling is
 * refused BY NAME at the tag, which is a louder answer than this warning, and
 * stacking both would be the two-diagnostics-for-one-mistake shape
 * `checkMemberTypes` already refuses (objectui#8067). The one path that could
 * still reach a `kanban` entry is a HAND-BUILT manifest declaring a component
 * of that name — which, after the retirement, is somebody else's component, and
 * the message below asserts things about `ObjectKanban` that would be false of
 * it.
 */
export const QUICK_ADD_HOST_TYPES: ReadonlySet<string> = new Set(['object-kanban']);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The parser's deferred-expression marker — opaque here, never evaluated. */
const isExpr = (v: unknown): boolean => isPlainObject(v) && '$expr' in v;

/**
 * The diagnostic for ONE authored prop, or `null` when this module has nothing
 * to say about it.
 *
 * Per-prop rather than per-node — unlike `checkDashboardWidgetOptions`, which
 * runs after the prop walk — because this diagnostic REPLACES the one the walk
 * would otherwise emit for the same key. Two diagnostics for one mistake is the
 * shape `validate.ts` already refuses at `checkMemberTypes` (objectui#8067).
 *
 * Deliberately independent of whether the registration DECLARES the key: the
 * claim is about the render path, which a declaration cannot change. Reading it
 * out of the `!input` branch would make declaring `quickAdd` silently disarm
 * this — the one edit that must instead leave the warning standing.
 */
export function checkKanbanQuickAdd(tag: string, key: string, value: unknown): Diagnostic | null {
  if (key !== QUICK_ADD_KEY) return null;
  if (!QUICK_ADD_HOST_TYPES.has(tag)) return null;
  if (isExpr(value)) return null;
  if (!value) return null;
  return {
    severity: 'warning',
    // DIVERGENCE FROM OBJECTUI, and the only one below this file's header:
    // objectui writes `code: INERT_QUICK_ADD` here. This repo runs
    // `check:dispatcher-error-vocabulary`, whose `objlitconst` shape reads the
    // SCREAMING_SNAKE constant NAME at a `code:` position and then must reduce
    // it to a literal — and its literal grammar is `[A-Za-z][A-Za-z0-9_]*`,
    // which a KEBAB-case value cannot satisfy. So the constant form is reported
    // as an unresolvable code constant, and that finding cannot be declared
    // away. `inert-quick-add` is a parser DIAGNOSTIC code, not an ADR-0112 wire
    // code, and an inline quoted literal is the form both vocabulary gates
    // already accept for the sibling diagnostic codes in `validate.ts` and for
    // `unconsumed-widget-option` next door. The emitted VALUE is unchanged, and
    // the test next door pins it equal to `INERT_QUICK_ADD` so the two
    // spellings cannot drift apart. ⛔ This does NOT weaken the lockstep: that
    // gate resolves an identifier at a code position through the package's own
    // module-level constants, so both spellings reduce to the same code and the
    // two copies still agree on all 26.
    code: 'inert-quick-add',
    message:
      `<${tag}> prop "${QUICK_ADD_KEY}" reaches no control — the Quick Add button is gated on ` +
      `BOTH "${QUICK_ADD_KEY}" and an "onQuickAdd" handler, and this block supplies neither half ` +
      `of the pair: "onQuickAdd" takes a FUNCTION, which no page on this tier can write (this tier ` +
      `parses, never executes) and which this board substitutes none of its own for. Drop the key, ` +
      `or mount KanbanRenderer from "@object-ui/plugin-kanban" in a React host that passes "onQuickAdd".`,
    tag,
  };
}
