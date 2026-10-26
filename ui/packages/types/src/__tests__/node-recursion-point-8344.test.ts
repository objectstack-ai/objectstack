// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The node recursion point resolves per-type, at every depth (objectui#8344).
 *
 * ## What was wrong
 *
 * Every child slot (`body`, `children`, and every per-component redeclaration of
 * them) is `z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)])`, and
 * `SchemaNodeSchema`'s component arm was `BaseSchemaCore` — the ~21 base keys and
 * NOTHING type-specific. ⇒ per-type enforcement was ROOT-ONLY, at every depth, for
 * every component type. objectui#7869 recorded it as an ASYMMETRY, measured there:
 * an off-spec node was refused standing alone and ACCEPTED one slot down, inside
 * any parent. #8344 points the arm at `AnyComponentSchema` instead.
 *
 * ## What this file pins, and why each leg is here
 *
 * The headline is one behaviour — "the same node gets the same verdict at every
 * depth" — and a single assertion cannot state it, because BOTH halves of an
 * asymmetry have to be read to say the asymmetry is gone. So #7869's reproduction
 * is pinned in both directions (refused alone AND refused nested), against a
 * NON-VACUITY leg (the legal twin of the same node, accepted at both depths) that
 * would catch the way this could pass while being broken — a recursion point that
 * refuses everything reads as a fixed asymmetry and is a dead contract.
 *
 * The fourth leg is what makes it a test of the REDIRECT rather than of `icon`:
 * a node whose `type` resolves in no arm of `AnyComponentSchema`. `BaseSchemaCore`
 * accepts any object with a string `type`, so that node is the one input the two
 * candidate recursion points disagree about MOST — it separates "the arm is the
 * component union" from "the arm is the base shape" without reading a single zod
 * internal.
 *
 * ⚠️ Recognising the recursion point by IDENTITY is pinned on the EXPORTED WRAPPER,
 * ⛔ never through `.unwrap()` or a re-invoked `z.lazy` getter. That is objectui#7918
 * consequence ①: the exported wrapper identity is stable and survives through a
 * declared slot, and it is the ONE reading that holds for all ten recursive mirrors.
 *
 * ⚠️ ⛔ Do not read that as "`unwrap()` and the getter are unstable HERE". On `main` they are
 * — measured on the built face, `S.unwrap() === S.unwrap()` and `getter() === getter()` are
 * both FALSE. On THIS head both are TRUE for this one const, because the redirect builds the
 * node union once below `BaseSchemaCore` and the getter returns it: the row moves to
 * `MEMOISED` in `zod-lazy-getter-identity-7918.test.ts`, as a byproduct rather than a goal.
 * The `fill is LIVE` leg below works BECAUSE of that.
 *
 * ⇒ the discipline stands unchanged and for an unchanged reason: it must hold for
 * the seven mirrors that are still TDZ_BOUND, so a pin written through `.unwrap()`
 * or a re-invoked getter would compare two fresh objects THERE and fail for a
 * reason that has nothing to do with this contract. Pinning the wrapper is what
 * makes this file portable to them; it is not a claim about this const's getter.
 */

import { describe, it, expect } from 'vitest';

import { AnyComponentSchema, CardSchema, IconSchema, SchemaNodeSchema, safeValidateSchema } from '../zod/index.zod.js';
import type { RetiredKanbanNodeSchema } from '../zod/complex.zod.js';
import type { SchemaNode } from '../base.js';
import type { z } from 'zod';

type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/**
 * #7869's own node, in the spelling `IconSchema` declares: `ui:icon` names its
 * glyph with `icon` and sizes it with a NUMBER, so `size: 'huge'` is off-spec by
 * value and `size: 24` is the legal twin of the same node.
 */
const OFF_SPEC_ICON = { type: 'icon', icon: 'check', size: 'huge' } as const;
const LEGAL_ICON = { type: 'icon', icon: 'check', size: 24 } as const;

/** The same node one slot down — the depth #7869 measured as the shielded one. */
const nested = (child: unknown) => ({ type: 'card', title: 'Parent', children: [child] });

describe('objectui#7869 — the off-spec node gets the same verdict at both depths', () => {
  it('is refused STANDING ALONE (unchanged — this half was never the defect)', () => {
    expect(AnyComponentSchema.safeParse(OFF_SPEC_ICON).success).toBe(false);
  });

  it('is refused NESTED — the half objectui#8344 moved', () => {
    expect(AnyComponentSchema.safeParse(nested(OFF_SPEC_ICON)).success).toBe(false);
  });

  it('names the offending VALUE, not merely "some arm did not match"', () => {
    // A recursion point that refused the child for the wrong reason — because the
    // parent no longer matches any arm at all, say — would satisfy the two legs
    // above while saying nothing about the child. Read the leaf issue.
    const result = IconSchema.safeParse(OFF_SPEC_ICON);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((i) => i.path.join('.') === 'size' && i.code === 'invalid_type')).toBe(true);
  });

  it('NON-VACUITY: the legal twin is accepted at BOTH depths', () => {
    // Without this leg, a recursion point that refuses everything passes the two
    // legs above. It is the assertion that says the redirect narrowed rather than
    // closed the slot.
    expect(AnyComponentSchema.safeParse(LEGAL_ICON).success).toBe(true);
    expect(AnyComponentSchema.safeParse(nested(LEGAL_ICON)).success).toBe(true);
  });
});

describe('the arm IS the component union, and not the base shape', () => {
  /**
   * A REGISTERED RENDERER with no mirror in `AnyComponentSchema` — the input the
   * two candidate recursion points answer differently: `BaseSchemaCore` takes any
   * object with a string `type`, the component union takes none it does not
   * declare.
   *
   * ⚠️ This was `h1` until objectui#8499. That card was the one objectui#8344
   * routed the widening into, and it LANDED: `h1` is now an arm
   * (`zod/layout.zod.ts#HtmlElementSchema`), so the old example stopped
   * discriminating and this leg went green for the wrong reason. ⛔ The remedy was
   * NOT to weaken the leg — it is re-pointed at an input whose absence from the
   * union is RULED rather than merely pending: `metric-card` is objectui's closed
   * dashboard-widget-slot component extension, admitted by the 2026-08-14 ruling
   * (objectstack#8593) and, in `zod/complex.zod.ts`'s own words, "DELIBERATELY not
   * an arm of `AnyComponentSchema`". So this example cannot rot the way `h1` did
   * without a maintainer reversing that ruling.
   *
   * ⛔ Do not "fix" a future failure here by adding an arm to make some other test
   * green: an arm is a public-surface widening and belongs to its own card, which
   * is what objectui#8344 said and what objectui#8499 then did properly.
   */
  const UNMIRRORED = { type: 'metric-card', title: 'Sales Dashboard' } as const;

  it('refuses an unmirrored node nested in a declared child slot', () => {
    expect(AnyComponentSchema.safeParse(nested(UNMIRRORED)).success).toBe(false);
  });

  it('refuses the same node standing alone (the control — this was already true)', () => {
    expect(AnyComponentSchema.safeParse(UNMIRRORED).success).toBe(false);
  });
});

describe('the late-binding wiring, read by IDENTITY on the exported wrapper', () => {
  it('the exported wrapper is one stable object', () => {
    // objectui#7918 consequence ①: the EXPORTED wrapper is the stable handle, and it is the
    // one reading that holds for all ten recursive mirrors. ⛔ Never write this pin through
    // `.unwrap()` or a re-invoked getter — on the seven mirrors that are still `TDZ_BOUND`
    // those return a fresh object per call, and a pin written through them would compare two
    // fresh objects and fail for a reason that has nothing to do with this contract.
    expect(SchemaNodeSchema).toBe(SchemaNodeSchema);
  });

  it('that identity survives through a declared child slot', () => {
    // Read off `children`: objectui#6771 retired `card`'s `body` spelling, so
    // the declared child slot whose union must hold the recursion point is
    // this one. `body` on this mirror is now an alias refusal with no union.
    const slot = (CardSchema.shape.children as unknown as { _zod: { def: { innerType: { _zod: { def: { options: unknown[] } } } } } });
    expect(slot._zod.def.innerType._zod.def.options).toContain(SchemaNodeSchema);
  });

  it('the holder is FILLED by importing the barrel — the module-cycle break works', () => {
    // The behavioural read of the fill, and the only one that cannot pass vacuously: BEFORE
    // the fill the arm is `BaseSchemaCore`, which accepts the unmirrored node below. This
    // module imports the barrel and nothing else, so a break in `index.zod.ts`'s
    // `defineNodeComponentUnion(...)` initializer lands here rather than in whichever suite
    // happened to run second.
    expect(AnyComponentSchema.safeParse(nested({ type: 'metric-card' })).success).toBe(false);
    expect(AnyComponentSchema.safeParse(nested(LEGAL_ICON)).success).toBe(true);
  });

  it('the fill is LIVE, and slot 0 holds the COMPONENT UNION, not the pre-objectui#8344 base shape', () => {
    // `z.union` re-reads its option array on every parse, so the recursion point is whatever
    // slot 0 holds NOW — not whatever it held when some other file in this worker first
    // parsed something (the unit project runs `isolate: false`, one module graph per worker).
    //
    // ⭐ RE-POINTED at the INSTALLATION by objectui#9659, carrying a contract-review residual
    // on objectui#9639. This leg used to read the wrapper's SHAPE — `not.toBe` the bare union,
    // plus `checks` of length exactly 1 — because `defineNodeComponentUnion` installed a
    // `superRefine` clause narrowing objectui#8344's `chatbot` `body`. Ruling A on
    // objectui#8572 retired the arm that clause narrowed, and objectui#9659 measured the
    // consequence: the clause could no longer FIRE for any input, so those two assertions had
    // become a pin on the shape of an inert clause. The clause is retired at its source and
    // this leg now reads what it was always really for — that the fill TOOK.
    //
    // ⚠️ The old warning here — "⛔ do not assert `toBe(AnyComponentSchema)`, it would go green
    // the moment the wrapper stopped being installed" — was correct WHILE a wrapper existed,
    // and it retires with the wrapper. It is not a licence to reintroduce one: with nothing
    // wrapped, identity with the component union is the strongest reading available, and it
    // FAILS on the failure this leg exists for — an unfilled holder still answers
    // `BaseSchemaCore`, which is a different object.
    const arm = (SchemaNodeSchema as unknown as {
      _zod: { def: { getter: () => { _zod: { def: { options: readonly { _zod: { propValues?: Record< string, unknown >; def: { checks?: unknown[] } } }[] } } } } };
    })._zod.def.getter()._zod.def.options[0];
    expect(arm).toBe(AnyComponentSchema as unknown as typeof arm);
    // and it is still the discriminated union objectui#8498 built, which is what keeps a
    // nested refusal costing one arm instead of 106.
    expect(Object.keys(arm._zod.propValues ?? {})).toContain('type');
  });

});

/**
 * The EXACT bound on the one assertion `base.zod.ts` needs to make.
 *
 * `SchemaNodeSchema` keeps its objectui#7760 annotation `z.ZodType< SchemaNode,
 * SchemaNode >`, and this reads back which arms of `AnyComponentSchema` are NOT
 * assignable to it.
 *
 * ⭐ INVERTED by ruling A on objectui#8572, ⛔ not deleted. It read `'chatbot'` for as long
 * as `complex.zod.ts#ChatbotSchema` mirrored the chat API body params under the key `body`,
 * which is `BaseSchema`'s CHILDREN slot — that collision WAS the whole exclusion, the parity
 * ledger carried it under `KnownDrift`, and objectui#8344 was not allowed to decide it. The
 * ruling retires the record arm on both faces, so every arm's output is assignable and the
 * honest bound is `never`.
 *
 * ⇒ the fill site takes a loose bound and this states the real one instead. A SECOND arm
 * drifting the same way turns this red — where a wide bound would have said nothing.
 * ⛔ Do not repair such a red by adding the new name to the union below: that records a
 * declaration defect as if it were a contract. ⛔ And do not delete this pin now that it
 * reads `never`: an empty exclusion set nothing asserts is indistinguishable from an
 * exclusion set nobody has looked at since.
 *
 * ⚠️ The `[…] extends [never]` guard is not decoration, and ⛔ it may not be simplified
 * away. The bare projection `Exclude< … > extends { type: infer K } ? K : never` does NOT
 * resolve to `never` on an EMPTY exclusion set: `never` is assignable to the probe shape,
 * so the true branch is taken and `K` is inferred from nothing — measured on this branch,
 * the bare spelling resolves to `unknown`. Written that way the pin can only ever be red,
 * which reads as drift where there is none. The guard answers the empty case first and
 * leaves the projection to do exactly what it did before: NAME the arm when there is one.
 */
type ArmsNotAssignableToSchemaNode = Exclude< z.output< typeof AnyComponentSchema >, SchemaNode >;

/**
 * ⚠️ Dated note, 2026-10-02 (objectui#11466). The bound above was `never` while `SchemaNode`'s
 * object arm was `BaseSchema`, whose `type: string` and index signature admitted every arm's
 * output, drifted or not. objectui#11466 made that arm `DeclaredNode`, the union of the
 * declared node types, so this reads the real exclusion set for the first time. Measured at
 * that change, nine `type` literals and one arm typed `string`, each a DECLARATION matter
 * between the two faces that the `BaseSchema` arm hid, ⛔ not a contract:
 *
 *   - `app`: the zod arm is the app-level document (`AppComponentSchema`'s mirror), while a
 *     node slot's `app` is the page KIND `ComponentRegistry` renders (`DeclaredNode` leaves
 *     the app document out, objectui#11466). Two vocabularies on one token; `./registry.ts`
 *     names them at its `'page'` entry.
 *   - `record`, `home`, `utility`: the zod page-kind arm (objectui#11440) leaves `name` and
 *     `label` optional; the TypeScript `PageDocumentNode` is the spec's `PageSchema` input,
 *     which requires them.
 *   - `page`: `PageNodeSchema`'s `slots` differ between the faces.
 *   - `dashboard`: the widget slot's component arm differs between the faces.
 *   - `detail-section`, `app-schema-renderer`, `cloud:plan-status`: zod arms with no
 *     TypeScript declaration at all, so no node slot admits them.
 *   - the arm typed `string`: the retired `kanban` tombstone (`RetiredKanbanNodeSchema`),
 *     which parses nothing; its output type is not a node.
 *
 * Of these, only `detail-section`, `app-schema-renderer` and `cloud:plan-status` got a card of
 * their own, objectui#11515 (the dated note below). `app`, `record`, `home`, `utility`, `page`
 * and `dashboard` have none: they are recorded for objectui#8347's family, which reads them
 * before the signature removal. The list is written out so this stays a
 * ratchet in BOTH directions: a new arm drifting turns it red, and so does a listed one being
 * reconciled, which then deletes its name here. ⛔ Do not add a name to make a red go away.
 * The `[…] extends [never]` guard the paragraph above describes belonged to the
 * non-distributive projection this replaced: `LiteralArmType` and `WideArm` distribute over
 * the arms, so an empty exclusion set answers `never` by construction.
 *
 * ⚠️ Dated note, 2026-10-03 (objectui#11466, on merging objectui#11515). Reconciled, so their
 * names left the list below: `detail-section`, `app-schema-renderer` and `cloud:plan-status`.
 * objectui#11515 gave each its TypeScript twin and joined it to `AnySchema`, so a node slot
 * admits them and their zod output is assignable. The bullet above that names them is kept as
 * the reading at objectui#11466's first measurement.
 *
 * ⚠️ objectui#12163 (ruling C): reconciled, so its name left the list below: `dashboard`. The
 * widget slot's component arm now carries one accept set on both faces (the `metric-card` arm
 * alone, the zod slot refusing every other node by name), so the `dashboard` arm's output is
 * assignable. The `dashboard` bullet above is kept as the reading at objectui#11466.
 */
type LiteralArmType< Arm > = Arm extends { type: infer K } ? (string extends K ? never : K) : never;
type WideArm< Arm > = Arm extends { type: infer K } ? (string extends K ? Arm : never) : never;
type MeasuredArmDrift11466 =
  | 'app'
  | 'record'
  | 'home'
  | 'utility'
  | 'page';

export type NodeRecursionPointDeclarationDrift = [
  Expect< Equal< LiteralArmType< ArmsNotAssignableToSchemaNode >, MeasuredArmDrift11466 > >,
  Expect< Equal< WideArm< ArmsNotAssignableToSchemaNode >, z.output< typeof RetiredKanbanNodeSchema > > >,
];


/**
 * The one arm the redirect would have WIDENED — retired at the source by objectui#8572.
 *
 * `ChatbotSchema.body` mirrored the chat API's body params as a record: the one
 * redeclaration across the union's arms that was WIDER than the base key it restated.
 * objectui#8344 was not allowed to move the published mirror, so it carried the narrowing on
 * the INSTALLED arm (`defineNodeComponentUnion`'s `superRefine` in `../zod/base.zod.ts`) and
 * this suite pinned the asymmetry that left behind: refused one slot down, still accepted at
 * the root.
 *
 * ⭐ Maintainer ruling A on objectui#8572 (decision batch #137, item 4, 2026-09-15) retired
 * that arm — `retirementTombstone` on the mirror, `?: never` on the declaration — so the ROOT
 * leg below is INVERTED, ⛔ not deleted: it is the only assertion in this file that reads the
 * published face at the depth the retirement is about, and an inverted pin keeps the history
 * of the key readable where a deleted one would leave the ROOT unwatched.
 *
 * ⛔ Both directions stay load-bearing, for a reason that OUTLIVED the asymmetry. The nested
 * refusal is now produced by the ARM itself rather than by the wrapper clause, and the root
 * refusal is the only one that can see the published mirror move; a repair that satisfies one
 * and not the other is exactly the failure this suite exists to catch.
 */
describe('objectui#8572 — the `chatbot` record `body` is refused at the ROOT and one slot down alike', () => {
  const CHATBOT = {
    type: 'chatbot',
    messages: [{ id: '1', role: 'assistant', content: 'hi' }],
  } as const;
  const withRecordBody = { ...CHATBOT, body: { model: 'gpt-4', temperature: 0.2 } };

  it('is REFUSED one slot down, where the base arm refused it before this card', () => {
    expect(AnyComponentSchema.safeParse(nested(withRecordBody)).success).toBe(false);
    expect(AnyComponentSchema.safeParse({ type: 'div', children: [withRecordBody] }).success).toBe(false);
  });

  it('is REFUSED at the ROOT too — objectui#8572 retired the published record arm', () => {
    // INVERTED by ruling A on objectui#8572. Until that ruling this leg read `toBe(true)`,
    // and the `superRefine` clause on the installed arm was the only thing narrowing the
    // nested form. ⛔ Do not read a failure here as "the wrapper leaked to the root": the
    // refusal below comes from the ARM, and its path and code say so.
    const result = AnyComponentSchema.safeParse(withRecordBody);
    expect(result.success).toBe(false);
    if (result.success) return;
    const bodyIssue = result.error.issues.find((issue) => issue.path.join('.') === 'body');
    expect(bodyIssue?.code).toBe('invalid_type');
    // The REMEDY reaches the author by name — `retirementTombstone` writes one string into
    // both the parse-time message and the published `.describe()`, so this asserts the named
    // replacement key rather than the sentence carrying it.
    expect(bodyIssue?.message).toContain('requestBody');
  });

  it('NON-VACUITY: the same node without `body` is accepted at both depths', () => {
    expect(AnyComponentSchema.safeParse(CHATBOT).success).toBe(true);
    expect(AnyComponentSchema.safeParse(nested(CHATBOT)).success).toBe(true);
  });

  it('names `body` AT ITS OWN PATH one slot down, and carries the remedy there too', () => {
    // ⭐ RE-POINTED by objectui#9659, carrying a contract-review residual on objectui#9639.
    // This leg used to read `JSON.stringify(issues)` for the substring naming the
    // parent's child slot and was VACUOUS: that slot is in the issue path for ANY
    // refused child, so the old assertion held whether or not the `chatbot` arm
    // named anything. Measured on this head — three documents with nothing wrong
    // at the child's own `body`, all three satisfying the old assertion, none of
    // them carrying an issue at that path:
    //
    //   nested off-spec `icon` (size: 'huge')  → blob contains the slot name: true,
    //                                            issues at `<slot>.0.body`: 0
    //   nested unmirrored `metric-card`        → true / 0
    //   nested `chatbot` missing `messages`    → true / 0
    //   nested `chatbot` with a record `body`  → true / 1   ← the only one about `body`
    //
    // ⚠️ The parent slot is spelled `children` since objectui#6771 retired `body`;
    // the child's own refused key is still `body`, so the two halves of the path
    // no longer read alike and the reading is easier to see, not different.
    //
    // ⇒ the reading that discriminates is the child's OWN path, not the serialized blob. The
    // controls above are kept as assertions below so the discrimination is pinned rather than
    // recorded in prose.
    const result = AnyComponentSchema.safeParse(nested(withRecordBody));
    expect(result.success).toBe(false);
    if (result.success) return;
    const at = (issues: readonly unknown[], path: string): { code?: string; message?: string }[] => {
      const out: { code?: string; message?: string }[] = [];
      const walk = (node: unknown, prefix: readonly (string | number)[]): void => {
        if (Array.isArray(node)) { for (const child of node) walk(child, prefix); return; }
        const issue = node as { path?: readonly (string | number)[]; errors?: readonly unknown[]; code?: string; message?: string };
        const here = [...prefix, ...(issue.path ?? [])];
        if (here.join('.') === path) out.push({ code: issue.code, message: issue.message });
        for (const bucket of issue.errors ?? []) walk(bucket, here);
      };
      walk(issues, []);
      return out;
    };
    const named = at(result.error.issues, 'children.0.body');
    expect(named.length).toBeGreaterThan(0);
    // the refusal one slot down is the ARM's tombstone, and the REMEDY reaches the author at
    // depth and not only at the root — the root leg above reads the same string at depth 0.
    expect(named.some((i) => i.code === 'invalid_type')).toBe(true);
    expect(named.some((i) => (i.message ?? '').includes('requestBody'))).toBe(true);
  });

  it.each([
    ['off-spec `icon`', { type: 'icon', icon: 'check', size: 'huge' }],
    ['unmirrored `metric-card`', { type: 'metric-card', title: 'x' }],
    ['`chatbot` missing `messages`', { type: 'chatbot' }],
  ])('CONTROL — a nested %s is refused with NOTHING at the child\'s `body` path', (_label, child) => {
    // These are the documents that made the old leg vacuous. Each is refused for a reason that
    // has nothing to do with `body`, so the leg above must find nothing at `children.0.body`.
    // ⛔ Do not "repair" a future failure by widening the path: a refusal that starts naming
    // `body` for an off-spec `icon` is a defect in the recursion point, not in this control.
    const result = AnyComponentSchema.safeParse(nested(child));
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths: string[] = [];
    const walk = (node: unknown, prefix: readonly (string | number)[]): void => {
      if (Array.isArray(node)) { for (const c of node) walk(c, prefix); return; }
      const issue = node as { path?: readonly (string | number)[]; errors?: readonly unknown[] };
      const here = [...prefix, ...(issue.path ?? [])];
      paths.push(here.join('.'));
      for (const bucket of issue.errors ?? []) walk(bucket, here);
    };
    walk(result.error.issues, []);
    expect(paths).not.toContain('children.0.body');
    // and the old assertion holds anyway — which is the whole reason it was replaced.
    // (It reads the PARENT's slot name, which is what made it vacuous; that name is
    // `children` since objectui#6771, and the vacuity is unchanged.)
    expect(JSON.stringify(result.error.issues)).toContain('"children"');
  });
});

/**
 * Depth on the REDIRECTED path, which objectui#8544 could not pin.
 *
 * That card's fan-out pin is built on `MenuItemSchema` because, on its tree, a nested
 * document was simply ACCEPTED — the recursion point had not moved yet. Here it is refused,
 * so this is the first pin that exercises a refusal at depth through the node union.
 *
 * ⛔ The number that matters is not the exact length, it is that the message stays LINEAR.
 * Before objectui#8498 the refused subtree was re-embedded per level by a flat 106-arm
 * union and grew about 25x per level, reaching `RangeError: Invalid string length` at depth
 * 4; discriminating selects one arm, so each level adds a bounded frame. A ceiling well
 * under the old growth is therefore the honest assertion: a regression that restores the
 * fan-out blows through it, while ordinary wording changes do not.
 */
describe('objectui#8344 + objectui#8498 — a refusal at depth 4 stays bounded and never throws', () => {
  const deep = (levels: number): unknown =>
    levels === 0
      ? { type: 'badge', variant: 'not-a-variant' }
      : { type: 'card', title: 'p', children: [deep(levels - 1)] };

  it('refuses at every depth 0 through 4 without throwing', () => {
    for (const depth of [0, 1, 2, 3, 4]) {
      const result = safeValidateSchema(deep(depth));
      expect(result.success).toBe(false);
    }
  });

  it('keeps the depth-4 diagnostic linear, not exponential', () => {
    const result = safeValidateSchema(deep(4));
    expect(result.success).toBe(false);
    if (result.success) return;
    // Measured on this head: 276 / 3,626 / 8,404 / 14,610 / 22,244 chars at depths 0-4.
    // The pre-objectui#8498 shape reached 428,269,086 chars at depth 3 and threw at 4.
    expect(result.error.message.length).toBeLessThan(200_000);
  });

  it('NON-VACUITY: the same shape with a LEGAL leaf is accepted at depth 4', () => {
    const legal = (levels: number): unknown =>
      levels === 0
        ? { type: 'badge', variant: 'default' }
        : { type: 'card', title: 'p', children: [legal(levels - 1)] };
    expect(safeValidateSchema(legal(4)).success).toBe(true);
  });
});
