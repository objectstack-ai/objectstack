/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Base Schema Types
 * 
 * The foundational type definitions for the Object UI schema protocol.
 * These types define the universal interface for all UI components.
 * 
 * @module base
 * @packageDocumentation
 */

import type { I18nLabel } from '@objectstack/spec/ui';
import type { EvaluatedExpressionInput } from '@objectstack/spec/shared';
import type { AuthoringNode } from './authoring-nodes.js';
import type { ExpressionWire } from './expression.js';
import type { AnySchema } from './index.js';

/**
 * A KEYED i18n label — a reference INTO a translation bundle (objectui#4581).
 *
 * This is objectui's own label vocabulary, and it is NOT the spec's
 * `I18nLabel`. The two are structurally confusable and answer wrongly for each
 * other's input, silently — objectui#4167 is the card that names the hazard,
 * and PR #4169 the one that had to alias five imports by hand because neither
 * shape had a name that said which it was:
 *
 * - KEYED (this type): `{ key, defaultValue?, params? }`, resolved against a
 *   translation bundle by `resolveKeyedI18nLabel`
 *   (`packages/react/src/utils/i18n.ts`, and the `t`-taking twin in
 *   `packages/app-shell/src/utils/index.ts`).
 * - INLINE (`I18nLabel`, re-exported from `@objectstack/spec/ui`):
 *   `string | Record<string, string>`, with `key?: never; defaultValue?:
 *   never` on the map arm — a locale MAP like `{ en: 'Owner' }`, resolved
 *   against a BCP-47 locale by the spec's own `resolveI18nLabel(label,
 *   locale)`. Those two exclusions are what keep the KEYED shape out of an
 *   inline slot; {@link BaseSchema.ariaLabel} states both crossings.
 *
 * The shape below is the census of the three inline copies that existed before
 * this type was minted — `packages/react/src/utils/i18n.ts`,
 * `packages/layout/src/NavigationRenderer.tsx` and
 * `packages/app-shell/src/utils/index.ts` — which were verified identical in
 * their object half first. It is a NAME for what was already there, not a new
 * capability.
 */
export type KeyedI18nLabel = {
  /** Translation-bundle key, e.g. `dialog.close`. */
  key: string;
  /** Rendered when the key is missing from the bundle, or no `t` is available. */
  defaultValue?: string;
  /** Interpolation values for the key's placeholders, e.g. `{{name}}`. */
  params?: Record<string, any>;
};

/**
 * Base schema interface that all component schemas extend.
 * This is the fundamental building block of the Object UI protocol.
 *
 * ⭐ It declares NO index signature (objectui#8347, executing the
 * objectui#7927 ruling: the TypeScript face is a contract). A node literal
 * written against a node type is excess-property checked, so a key no
 * declaration names, a misspelling included, stops type-checking at the
 * authoring site. When a key you need is refused, declare it on the node
 * type that reads it, by reference to the spec row, or fix the producer
 * (AGENTS.md #0.1); ⛔ do not cast past it or put the signature back.
 * The bound: TypeScript checks excess keys only on a FRESH object literal, so
 * a value that reached its annotation through a wider variable is not
 * re-checked. `__tests__/base-schema-closed-face-8347.test.ts` pins both
 * directions. Renderer props keep their tolerance: {@link ComponentRendererProps}
 * still carries its own signature, and the zod mirror is still
 * `.passthrough()` on the rendering face.
 *
 * @example
 * ```typescript
 * const schema: BaseSchema = {
 *   type: 'text',
 *   id: 'greeting',
 *   className: 'text-lg font-bold',
 *   data: { message: 'Hello World' }
 * }
 * ```
 */
export interface BaseSchema {
  /**
   * Component type identifier. Determines which renderer to use.
   * @example 'input', 'button', 'form', 'grid'
   */
  type: string;

  /**
   * Unique identifier for the component instance.
   * Used for state management, event handling, and React keys.
   */
  id?: string;

  /**
   * Human-readable name for the component.
   * Used for form field names, labels, and debugging.
   */
  name?: string;

  /**
   * Display label for the component.
   * Often used in forms, cards, and other UI elements.
   *
   * Accepts the spec's INLINE LOCALE MAP as well as a plain string
   * (objectui#4580, revised Q1 ruling — option A), because `ListView`'s own
   * `label` is the spec's `I18nLabel`: under the old `string` declaration that
   * assignment was a type error the moment `SchemaNode` stopped being core's
   * index-signature interface — the defect this widening resolves, not a
   * capability being invented here.
   *
   * The instrument that re-derives the widening is
   * `inline-locale-declared-face-9092.test.ts` in this package's `__tests__`:
   * it assigns the map to this slot and to {@link BaseSchema.description}, each
   * paired with a `@ts-expect-error` control on a genuinely plain-`string`
   * sibling, and it runs under both `tsc -p packages/types/tsconfig.test.json`
   * and vitest. ⛔ Read that file rather than any figure written here.
   *
   * ## ⚠️ The producer evidence this slot was widened on is DEAD
   *
   * It is quoted and dated rather than deleted, because it is the rationale
   * objectui#4580 was decided on and overwriting it would erase that the ruling
   * ever had one. As written on 2026-08-13 (#4580, PR #4608) this paragraph
   * said, and the tree at that commit bore it out:
   *
   * > that is what a spec producer already writes into this slot:
   * > `bridgeListView` assigns `node.label = spec.label` at
   * > `packages/react/src/spec-bridge/bridges/list-view.ts:180`
   *
   * ⛔ FALSIFIED on 2026-08-29 by objectui#6366 (PR #6632), which removed the
   * WHOLE spec-bridge — `SpecBridge`, `bridgeListView`, `bridgeFormView` — from
   * `@object-ui/react` as a declared BREAKING CHANGE. That producer, the module
   * it lived in and the address it is cited at are all gone, and ⛔ nothing
   * re-derives the sentence — which is why it is quoted here instead of left
   * reading as live (AGENTS.md #9). The RULING is not in question: its live
   * basis is the declared-face pin named above, the spec's own `I18nLabel`
   * declaration this file imports, and the read-site pins in
   * `@object-ui/components` and `@object-ui/plugin-dashboard`. Reading the dead
   * sentence as live already cost objectui#9092 a premise-falsification round.
   *
   * ## Which vocabulary this is, and who resolves it
   *
   * This slot — and {@link BaseSchema.description} two lines down — carries the
   * spec's INLINE form: `I18nLabel` = `string | Record<string, string>` with
   * `key` and `defaultValue` excluded from the map arm, a locale MAP like
   * `{ en: 'Owner', 'zh-CN': '负责人' }`, resolved against a
   * BCP-47 locale by the spec's own `resolveI18nLabel(label, locale)` from
   * `@objectstack/spec/ui`. Its documented fallback order is exact match →
   * base/region (`zh-CN` ↔ `zh`) → last resort (any remaining entry), and it
   * returns `undefined` when nothing matched, so read sites pair it with
   * `?? someDefault`.
   *
   * ⚠️ {@link BaseSchema.ariaLabel}, two properties below, carries the OTHER
   * vocabulary — the KEYED form {@link KeyedI18nLabel} (`{ key, defaultValue?,
   * params? }`), a reference INTO a translation bundle, resolved by
   * `resolveKeyedI18nLabel`. One interface now carries both, two properties
   * apart, and they stay confusable to a READER — but NOT to the compiler or
   * the parser: a keyed ref written into this slot is REFUSED, because the
   * installed pin types the inline arm with `key?: never; defaultValue?:
   * never` and its `INLINE_LOCALE_KEY` pattern excludes both names.
   * {@link BaseSchema.ariaLabel} carries the full statement — both crossings,
   * both faces, and what a wrong slot actually costs. That confusability is
   * objectui#4167's hazard, inherent to the spec's `I18nLabel` design and
   * present on every spec surface using it; naming both shapes with
   * cross-referenced docs is the accepted mitigation (#4580's revised Q1
   * ruling states this cost and accepts it).
   *
   * ## Resolution happens at READ time, not at the bridge
   *
   * The renderer resolves this against the display locale — `useDisplayLocale()`
   * where the read site is in an i18n-reachable package, a locale threaded
   * through props/context where it is not (`packages/layout` carries no i18n
   * dependency). Resolving at the spec bridge was ruled out and measured
   * unimplementable in PR #4603: the bridge is a plain class method that cannot
   * call a hook, `BridgeContext` declares no locale, and `updateContext()` has
   * zero callers — so a bridge-resolved label would freeze one audience's
   * language into the node tree with no re-translation channel, the defect the
   * spec's own resolver doc records as objectstack-ai/objectstack#6761.
   *
   * @example "Submit"
   * @example { en: 'Submit', 'zh-CN': '提交' }
   */
  label?: string | I18nLabel;

  /**
   * Descriptive text providing additional context.
   * Typically rendered as help text below the component.
   *
   * Accepts the spec's INLINE LOCALE MAP as well as a plain string on exactly
   * the {@link BaseSchema.label} evidence one slot over (objectui#4580, revised
   * Q1 ruling), where the spec's `ListView.description` is an `I18nLabel`. Same
   * vocabulary, same resolver (`resolveI18nLabel` against the display locale),
   * same confusability warning against {@link BaseSchema.ariaLabel}'s keyed
   * form — see {@link BaseSchema.label} for the full statement, and for the
   * instrument that re-derives this widening.
   *
   * ⚠️ The producer half of that evidence is DEAD, quoted and dated. As
   * written on 2026-08-13 (#4580, PR #4608), and true of the tree at that
   * commit:
   *
   * > `bridgeListView` assigns `node.description = spec.description` at
   * > `packages/react/src/spec-bridge/bridges/list-view.ts:224`
   *
   * ⛔ FALSIFIED on 2026-08-29 by objectui#6366 (PR #6632), which removed
   * `SpecBridge` / `bridgeListView` / `bridgeFormView` from `@object-ui/react`
   * as a declared BREAKING CHANGE. Nothing re-derives it; see
   * {@link BaseSchema.label} for why it is quoted rather than deleted.
   *
   * @example "Shown below the field"
   * @example { en: 'Shown below the field', 'zh-CN': '显示在字段下方' }
   */
  description?: string | I18nLabel;

  /**
   * Placeholder text for input components.
   * Provides hints about expected input format or content.
   */
  placeholder?: string;

  /**
   * Tailwind CSS classes to apply to the component.
   * This is the primary styling mechanism in Object UI.
   * @example 'bg-blue-500 text-white p-4 rounded-lg'
   */
  className?: string;

  /**
   * Inline CSS styles as a JavaScript object.
   * Use sparingly - prefer className with Tailwind.
   * @example { backgroundColor: '#fff', padding: '16px' }
   */
  style?: Record<string, string | number>;

  /**
   * Arbitrary data attached to the component.
   * Can be used for custom properties, state, or context.
   */
  data?: any;

  /**
   * Data-scope path this node draws its rows/value from — the SDUI data-binding
   * vocabulary, resolved by `useDataScope()` (`@object-ui/react`).
   *
   * The path is resolved against the AMBIENT SCOPE a host publishes through
   * `PredicateScopeProvider` — the channel app-shell's `ExpressionProvider`
   * already feeds — and ⛔ not against the injected `DataSource` adapter
   * (objectui#9308, maintainer ruling 2026-09-13 option B). An adapter answers
   * no member a `bind` path names, so the old walk resolved `undefined` for
   * every conformant host and each reader below ran its fallback.
   *
   * ```json
   * { "type": "list", "bind": "customerNames" }   // → scope.customerNames
   * { "type": "object-kanban", "bind": "app.settings.users" }
   * ```
   *
   * ## Why it is declared HERE and not on each reader (objectui#6357)
   *
   * `bind` was read by ten production sites and declared by NO schema shape —
   * it rode `BaseSchema`'s index signature as `any`, while three separate
   * documents taught it as an authorable key of EVERY node: this repo's own
   * `AGENTS.md` §4 ("Every node in the UI tree follows this shape
   * (`@object-ui/types`)" — `bind?: string`), the published agent-facing
   * `skills/objectui/rules/protocol.md` ("Every UI component node MUST follow
   * this shape"), and `content/docs/fields/grid.mdx`.
   *
   * Per-component declaration was measured and rejected: it costs nine copies
   * of one key and buys NOTHING extra, because neither half can refuse the key
   * on a non-reader either way (see the ceiling below). The class had already
   * generated FOUR local declarations before this one existed — three spelled
   * `string`, one spelled `unknown` — which is exactly the "two copies of one
   * key list is how a list becomes two disagreeing lists" hazard that
   * `plugin-dashboard/src/schemaHostProps.ts`'s own header warns about. Only
   * one of the four was a true duplicate of a base member (`ObjectPivotTable`'s,
   * removed with this card); the other three are load-bearing because their
   * containing types never reference `BaseSchema` at all, and that disconnection
   * is objectui#5155 / objectui#6269's defect, not this card's. They are held as
   * a ratchet in `__tests__/base-bind-declared.test.ts`.
   *
   * Precedent for a cross-cutting key honoured by a SUBSET living here:
   * {@link BaseSchema.placeholder}, declared for every node and read only by
   * input components.
   *
   * ## Readers, and the one documented silent failure
   *
   * Only a component that calls `useDataScope` honours it. Measured readers:
   * `list` and `tree-view` (`@object-ui/components`), and the `object-*`
   * widgets in `plugin-charts` / `plugin-dashboard` (×2) / `plugin-grid` /
   * `plugin-kanban` / `plugin-list` / `plugin-timeline`. ⚠️ `data-table` does
   * NOT: a `bind` on it is ignored and the table renders its header over an
   * empty body, with no render-time error; nothing on the page says why. The
   * one signal is a render-time console warning
   * (`[ObjectUI] DataTable bind:`, objectui#6575; pinned in
   * `components/src/__tests__/skill-guide-data-table-binding.test.tsx`). The
   * parser tier stays silent on it: `validateTree` counts `bind` among the base
   * props every node may carry (objectui#11008), so a `bind` draws no
   * `unknown-prop` there, on `data-table` or on any other node (pinned in
   * `components/src/renderers/__tests__/bind-base-prop-parser-tier-11008.test.tsx`).
   * Declaring the key here does not change that, and does not bless it — the
   * key was already accepted on every node before this declaration existed.
   *
   * ## What declaring it buys, and what it does not (objectui#5155 / #6269)
   *
   * Same ceiling as the gantt and timeline pins. `BaseSchema` is
   * `.passthrough()` on the zod side (and carried an index signature on the TS
   * side until objectui#8347), so an UNDECLARED key is still accepted by the
   * zod half — this did NOT buy rejection of a misspelling such as `bindTo`
   * there. What it DOES buy is the VALUE:
   * `bind: 42` type-checked and parsed green before this declaration and is
   * refused by both halves now. That narrowing only refuses what already
   * crashed — `useDataScope` is `(path?: string)` and resolves via
   * `path.split('.')`, so a non-string `bind` threw a TypeError at render.
   *
   * @example "customerNames"
   * @example "app.settings.users"
   */
  bind?: string;

  /**
   * RETIRED (objectui#6771, maintainer ruling 2026-09-01, ADR-0049) — the
   * second spelling of {@link BaseSchema.children}. Author `children`.
   *
   * ## Why it is refused by name rather than merely deleted
   *
   * `BaseSchemaCore` ends `.passthrough()` on the zod side, so DELETING a
   * member does not refuse it there — it makes it silently acceptable and
   * silently inert, which is the state this retirement exists to leave. (The
   * TS side carried an index signature with the same effect when this was
   * written; objectui#8347 removed it, so a deleted member is refused at the
   * authoring site now, but the parse still needs the tombstone.) The
   * `?: never` twin of the mirror's `aliasKeyRefusal` is what turns the
   * removal into an answer: `tsc` refuses the key at the authoring site and
   * the parse names `children` as the remedy.
   *
   * ## What it used to be
   *
   * A declared twin of `children`, and for a dozen registrations — `badge`,
   * `alert`, the `sidebar-*` family, `tooltip` — the ONLY child-list key
   * their renderer read, while `div` / `card` / `page` / `button` /
   * `aspect-ratio` / the sectioning tags read `children || body` and took
   * either. One concept with two spellings is the lenient-fallback shape
   * AGENTS.md #0.1 names, and the parser tier only ever knew `children`, so
   * the one spelling that resolved drew the warning a typo draws. The
   * ruling retired the spelling rather than blessing it: the registrations
   * converged on `children` and this repository's own corpus and teaching
   * moved in the same change.
   *
   * @deprecated Retired spelling of `children` — author `children`.
   */
  body?: never;

  /**
   * Child components or content — THE child-list key, and since
   * objectui#6771 the only one. Can be a single component, an array of
   * components, or primitive values.
   *
   * This docblock used to read "alternative name for children" and admit
   * that "some components use 'children' instead of 'body'" without saying
   * which — a sentence that was itself load-bearing evidence on three
   * separate cards, because it told an author both spellings were live and
   * left them to guess per component.
   *
   * The keys OTHER than this one through which a renderer hands nodes back
   * to `SchemaRenderer` — a dialog's `trigger`, a tab item's `content`, a
   * page's `regions[].components` — are per-type and declared once, in
   * `NODE_SLOT_DECLARATIONS` / `nodeSlotsFor` (`./node-slots.ts`,
   * objectui#11170); every walk that judges a document follows `children`
   * unconditionally and those positions by the node's type.
   */
  children?: SchemaNode | SchemaNode[];

  /**
   * Controls whether the component is visible.
   * When false, the component is NOT RENDERED: `SchemaRenderer` returns `null`
   * for the node. Nothing emits `display: none` — the element never reaches the
   * DOM at all, and `hidden: true` one slot below takes this exact same path
   * (`c1fe272ad`).
   *
   * Accepts a PREDICATE STRING as well as a boolean (objectui#4581): the
   * renderer does not read this key as a boolean, it evaluates it —
   * `SchemaRenderer.tsx:382` calls `evaluator.evaluateCondition(schema.visible)`,
   * and `evaluateCondition` is declared
   * `(condition: string | boolean | undefined, context?) => boolean`. The
   * sibling keys `visibleWhen` and the deprecated `visibleOn` are `string` for
   * the same reason; this one simply under-reported the capability, and
   * fixtures exercising it had to cast past the declaration.
   *
   * Accepts the CEL ENVELOPE OBJECT as well (objectui#7530, ruled 2026-09-04,
   * option A -- on all three of `visible` / `hidden` / `disabled` at once):
   * `evaluateCondition` routes `{ dialect: 'cel', source }` to the canonical
   * `@objectstack/formula` engine and unwraps any other envelope onto the
   * legacy path, so the envelope was already an evaluated input here.
   * `ExpressionWire` (`./expression.ts`) is the string-or-envelope union
   * `visibleWhen` on form fields already carried, reused rather than spelled a
   * second time; its zod twin is `ExpressionWireSchema`.
   *
   * @default true
   * @example true
   * @example "${data.role === 'admin'}"
   * @example { dialect: 'cel', source: "record.status == 'open'" }
   */
  visible?: boolean | ExpressionWire;

  /**
   * Canonical conditional-visibility predicate (ADR-0089) — the element is shown
   * when this evaluates truthy. The spec folds the deprecated `visibleOn` /
   * `visibility` aliases into this key at parse.
   *
   * Typed BY REFERENCE as the spec's own input type for an evaluated slot,
   * `EvaluatedExpressionInput` (objectui#8347, ruled Q6 = B): a predicate
   * string, or the `{ dialect, source }` envelope the spec's parse of
   * `PageComponentSchema.visibleWhen` produces and `SchemaRenderer` evaluates.
   * It read `string` before, which refused the envelope the spec's own parse
   * writes into this key. ⚠️ Narrower than
   * `ExpressionWire` (`visible` / `hidden` / `disabled`, objectui#7530): the
   * spec refuses a dialect-less envelope and an unknown dialect, and so does
   * this key. Its zod twin is the same accept set without the spec's string
   * transform (`../zod/base.zod.ts`).
   *
   * @example "${data.role === 'admin'}"
   * @example { dialect: 'cel', source: "record.status == 'open'" }
   */
  visibleWhen?: EvaluatedExpressionInput;

  /**
   * Expression for conditional visibility.
   * Evaluated against the current data context.
   * @deprecated ADR-0089 — use `visibleWhen`.
   * @example "${data.role === 'admin'}"
   */
  visibleOn?: string;

  /**
   * Controls whether the component is hidden.
   * When true, the component is NOT RENDERED: the renderer sets its internal
   * `_hidden` flag and returns `null` for the node — exactly what
   * `visible: false` does. No node is kept in the tree and nothing emits
   * `visibility: hidden`.
   *
   * ⚠️ `hidden` and `visible` are DELIBERATELY SYNONYMOUS — one hide path, not
   * two behaviours (`c1fe272ad`, ruled 2026-09-01). This comment used to
   * promise "rendered but not visible (visibility: hidden)", which the renderer
   * has never done: `_hidden` has exactly one consumer, the `return null` in
   * `SchemaRenderer.tsx`, and by the time it is read the key that set it is no
   * longer distinguishable. The other reading — keep the node, hide it visually
   * — was considered and DECLINED: it is a behaviour change on a published prop
   * with zero named consumers, so a real accessibility or animation use-case
   * reopens it as its own feature card rather than being inferred from this
   * declaration. Corollary for whoever edits the docs next: the schema-reference
   * row "Inverse of `visible`" is the half that describes shipped behaviour —
   * do not "correct" it toward a promise this key does not keep. Pinned by
   * `SchemaRenderer.hiddenVisibleSynonymy.test.tsx`.
   *
   * Synonymous in OUTCOME, not in PRECEDENCE: the renderer's `shouldHide` chain
   * consults every `visible*` leg first, so a declared `visible` — an empty one
   * included — short-circuits this key and it is never evaluated
   * (`SchemaRenderer.expressions.test.tsx`,
   * `SchemaRenderer.hiddenDeclaredGate.test.tsx`).
   *
   * Accepts a PREDICATE STRING as well as a boolean (objectui#7455, ruled
   * 2026-09-03), on exactly the evidence that widened `visible` (#4581) and
   * `disabled` (#4580 ruling Q3-A): the renderer does not read this key as a
   * boolean, it evaluates it. The `shouldHide` chain asks core's one definition
   * of "declared" and then evaluates the value --
   * `hasDeclaredPredicate(newSchema.hidden)` then
   * `evaluateVisibilityPredicate(newSchema.hidden, 'hidden')` in
   * `SchemaRenderer.tsx` (the `hidden` leg, :1236 as of d04e79a80 -- re-derive
   * the line, do not trust it) -- and the evaluator underneath is declared
   * `(condition: string | boolean | undefined, ...) => boolean`. The sibling
   * key `hiddenOn` is `string` for the same reason, and its existence was NOT
   * taken to mean this key should stay boolean -- exactly as it was not taken
   * that way for `visibleWhen` / `visibleOn` beside `visible`, or `disabledOn`
   * beside `disabled`. The declaration simply under-reported a shipped, pinned
   * capability (`SchemaRenderer.hiddenDeclaredGate.test.tsx`), and the fixtures
   * exercising it had to cast past it.
   *
   * ADR-0089 -- "The boolean `visible` (Tab on/off) is a different type and
   * concept and is explicitly out of scope" -- governs `packages/spec`'s keys,
   * NOT this surface: `BaseSchema` is objectui's own declaration. The ADR is
   * evidence of intent about the same concept, which is why this widening was
   * ruled rather than applied mechanically.
   *
   * The CEL ENVELOPE OBJECT form is declared too (objectui#7530, ruled
   * 2026-09-04, option A -- on all three keys at once, never on one alone).
   * `hasDeclaredPredicate` had accepted `{ dialect: 'cel', source }` on this
   * key all along, pinned through a `Record` cast in
   * `SchemaRenderer.hiddenDeclaredGate.test.tsx`; `ExpressionWire`
   * (`./expression.ts`) is the string-or-envelope union `visibleWhen` on form
   * fields already carried, reused here rather than spelled a second time. The
   * ruling rejected the alternative -- a per-key `stringOnly` branch in the
   * shared evaluator -- because it would split the platform into two
   * expression vocabularies.
   *
   * @default false
   * @example true
   * @example "${data.status === 'draft'}"
   * @example { dialect: 'cel', source: "record.status == 'draft'" }
   */
  hidden?: boolean | ExpressionWire;

  /**
   * Expression for conditional hiding.
   * @example "${!data.isActive}"
   */
  hiddenOn?: string;

  /**
   * Controls whether the component is disabled.
   * Applies to interactive components like buttons and inputs.
   *
   * Accepts a PREDICATE STRING as well as a boolean (objectui#4581), on exactly
   * the `visible` evidence one slot over: the renderer does not read this key
   * as a boolean, it evaluates it — `SchemaRenderer.tsx:466` calls
   * `evaluator.evaluateCondition(newSchema.disabled)`, and `evaluateCondition`
   * is declared
   * `(condition: string | boolean | undefined, context?) => boolean`. The
   * sibling key `disabledOn` is `string` for the same reason. The asymmetry
   * with `visible` was accidental rather than deliberate (#4580 ruling Q3-A);
   * the two fixtures exercising it had been casting past the declaration.
   *
   * Accepts the CEL ENVELOPE OBJECT as well (objectui#7530, ruled 2026-09-04,
   * option A -- on all three of `visible` / `hidden` / `disabled` at once). The
   * `disabled` leg asks `hasDeclaredPredicate(newSchema.disabled)` and then
   * evaluates the value, and both already honoured `{ dialect: 'cel', source }`
   * (pinned through a `Record` cast in
   * `SchemaRenderer.disabledDeclaredGate.test.tsx`). `ExpressionWire`
   * (`./expression.ts`) is the one string-or-envelope union, shared with
   * `visible`, `hidden` and the form predicate keys.
   *
   * @default false
   * @example false
   * @example "${data.status === 'locked'}"
   * @example { dialect: 'cel', source: "record.status == 'locked'" }
   */
  disabled?: boolean | ExpressionWire;

  /**
   * Expression for conditional disabling.
   * @example "${data.status === 'locked'}"
   */
  disabledOn?: string;

  /**
   * Test ID for automated testing.
   * Rendered as the `data-testid` attribute.
   *
   * `SchemaRenderer` strips this key from the props it spreads and re-emits it
   * beside `data-obj-id` / `data-obj-type`, so `screen.getByTestId(...)` and a
   * `[data-testid=...]` selector both find the node.
   *
   * ⚠️ That emission is what makes this sentence true, and it did not exist
   * until objectui#8268. Before it, the key was not in the metadata strip list:
   * it fell through into the spread, React refused it as an unknown DOM prop,
   * and the author got a non-standard lowercase `testid` attribute that no
   * query helper looks for — while React's own dev warning told them to spell it
   * `testid`, steering them further from the documented attribute. The other
   * direction was considered and DECLINED: retiring the promise would have left
   * `content/docs/api/schema-reference.md`'s "rendered as `data-testid`" row,
   * that page's own base-schema example authoring `testId`, `@object-ui/cli`'s
   * `OBJECTUI_STRUCTURAL_KEYS` — which identifies a file as a schema node by
   * this key — and `SchemaBuilder.testId()` all pointing at a key with no
   * behaviour, and it runs against ADR-0054 C4 ("the renderer emits
   * `data-testid` ... derived from metadata"), which shipped.
   *
   * ⚠️ The attribute reaches the DOM only where the registered renderer
   * forwards the props it is handed — the same condition `data-obj-id` has
   * always been under, not a new one. A renderer that drops unknown props drops
   * this one too.
   *
   * Pinned by `SchemaRenderer.testIdEmission.test.tsx`.
   */
  testId?: string;

  /**
   * Accessibility label for screen readers.
   * Rendered as aria-label attribute.
   *
   * Accepts the KEYED i18n form as well as a plain string (objectui#4581),
   * because that is what the renderer resolves:
   * `packages/react/src/SchemaRenderer.tsx` reads
   * `aria['aria-label'] = resolveKeyedI18nLabel(schema.ariaLabel)`, and
   * `resolveKeyedI18nLabel` accepts `{ key, defaultValue?, params? }` — the
   * shape now named {@link KeyedI18nLabel}.
   *
   * NOT `I18nLabel`. The original #4581 text asked for `string | I18nLabel`,
   * and PR #4593 measured that spelling wrong in three ways before the ruling
   * withdrew it (#4580 Q2-B). ⚠️ Read those three as HISTORY, against the
   * `I18nLabel` of that release — `string | Record<string, string>`, a map
   * with no name excluded from it: the shipped keyed fixture was accepted
   * *vacuously*, as a locale map whose "locales" are named `key` and
   * `defaultValue`; the same label carrying `params` was REJECTED
   * (`Type '{ name: string; }' is not assignable to type 'string'`); and a
   * genuine `{ en: 'Owner' }` type-checked while `resolveKeyedI18nLabel`
   * returns `undefined` for it, rendering an EMPTY aria-label. The pin has
   * since closed the vacuous half — see below. What survives is that the two
   * vocabularies are structurally confusable to a READER — objectui#4167's
   * exact hazard.
   *
   * ⚠️ That hazard is LIVE ON THIS INTERFACE, not just adjacent to it: since
   * #4580's revised Q1 ruling, {@link BaseSchema.label} and
   * {@link BaseSchema.description} declare the spec's INLINE map (`I18nLabel`,
   * resolved by `resolveI18nLabel(label, locale)`), while this slot declares
   * the KEYED ref (resolved by `resolveKeyedI18nLabel`). Two properties apart,
   * both spelled `string | {object}` — but NEITHER SLOT ADMITS THE OTHER'S
   * SHAPE. The installed pin types the inline arm with `key?: never;
   * defaultValue?: never` and its `INLINE_LOCALE_KEY` pattern excludes both
   * names, so a keyed ref written into `label` / `description`, and an inline
   * map written into this slot, are each REFUSED — at `tsc` on the declaration
   * and at `safeParse` on the zod mirror. The cross-vocabulary block of
   * `__tests__/inline-locale-declared-face-9092.test.ts` re-derives that on
   * every run, in both directions and with the accepting control beside each
   * refusal; read it rather than this sentence.
   *
   * ⚠️ So what a wrong slot costs is a WRONG ANSWER rather than a silent
   * acceptance, and it is paid by metadata that reaches a resolver without
   * having passed either face — the normal case for server-driven JSON. A
   * keyed ref handed to `resolveI18nLabel` comes back as its own `key` string,
   * so the KEY is what renders; an inline map handed to `resolveKeyedI18nLabel`
   * comes back `undefined`, so the aria-label renders EMPTY. Check which
   * resolver owns a slot before writing an object into it; the ruling accepted
   * this cost with exactly this naming + cross-referencing as the mitigation.
   *
   * @example "Close dialog"
   * @example { key: 'dialog.close', defaultValue: 'Close dialog' }
   */
  ariaLabel?: string | KeyedI18nLabel;
}

/**
 * The registry an application augments to declare its OWN node types: the
 * types it registers with `ComponentRegistry` that this package does not
 * declare (objectui#11466).
 *
 * Each entry's key is the node's `type` string and its value is the node's
 * schema type. An entry joins {@link DeclaredNode}, so a node of that type is
 * authorable in every node slot and at `SchemaRenderer`'s `schema` prop:
 *
 * ```typescript
 * interface MyWidgetSchema extends BaseSchema {
 *   type: 'my-widget';
 *   customProp?: string;
 * }
 *
 * declare module '@object-ui/types' {
 *   interface CustomNodeRegistry {
 *     'my-widget': MyWidgetSchema;
 *   }
 * }
 * ```
 *
 * ## Why a custom type must be declared here
 *
 * A node slot takes the union of the declared node types, discriminated by
 * the literal `type`, so each inline child is checked against its own type's
 * keys and a misspelled key is refused where it is written. An undeclared
 * `type` string has no arm, so it is refused too, the same way the strict zod
 * face refuses an unregistered type. The entry is what declares it.
 *
 * ⛔ An entry is joined under its KEY: the arm is the entry's type intersected
 * with `{ type: KEY }`. So an entry cannot add a `type: string` arm, which
 * would make every declared type's literal a candidate for that arm and let
 * the arm's keys through on every node. An entry whose own `type` is a
 * different literal than its key intersects to `never` and adds nothing.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- empty by design: applications fill it by declaration merging.
export interface CustomNodeRegistry {}

/** One arm per {@link CustomNodeRegistry} entry, discriminated by the entry's key. */
type RegisteredCustomNode = {
  [K in keyof CustomNodeRegistry & string]: CustomNodeRegistry[K] & { type: K };
}[keyof CustomNodeRegistry & string];

/**
 * The arms of a union whose `type` is a literal (or a union of literals). An
 * arm whose `type` is `string` matches every discriminant, so it is dropped:
 * from `AnySchema`, that is `BaseSchema` alone, which
 * `__tests__/node-slot-union-11466.test.ts` pins.
 */
type LiteralTypedArm<T> = T extends { type: infer K } ? (string extends K ? never : T) : never;

/**
 * A node of a declared type: the object arm of {@link SchemaNode}, and what
 * `SchemaRenderer`'s `schema` prop takes beside a string (objectui#11466).
 *
 * It is the discriminated union, keyed by the literal `type`, of
 *
 *   - every component schema this package declares (`AnySchema` without its
 *     `BaseSchema` arm, whose `type` is `string`, and without the app-level
 *     document, below);
 *   - every spec-declared node `AuthoringNode` types by reference;
 *   - every custom type an application declares in {@link CustomNodeRegistry}.
 *
 * Inside the union TypeScript discriminates on `type`, so an inline child
 * literal is checked against its own type's keys and value types, wherever
 * it is nested. ⛔ No arm is open: there is no index signature and no
 * `type: string` arm here. A node built at runtime whose `type` is not known
 * to the compiler is not a `DeclaredNode`; narrow it to one, or declare its
 * type in {@link CustomNodeRegistry}.
 *
 * ⛔ The app-level document (`./app.ts`, the `app.json` shape: navigation,
 * areas, the `AnySchema` member whose `type` is `'app'`) is not a node:
 * `AppSchemaRenderer` (`@object-ui/layout`) reads it structurally and
 * `ComponentRegistry` never dispatches it. It is left out by that `type`
 * (`Exclude<AnySchema, { type: 'app' }>`), which removes it alone, because
 * no other `AnySchema` member's `type` is `'app'` (the `'app'` pin in
 * `__tests__/node-slot-union-11466.test.ts` holds that). The registry's
 * `app` key serves the page KIND `app`, so as a
 * node `type: 'app'` is a stored page document, `AuthoringNode`'s
 * `PageDocumentNode`. Kept out, `app` is one arm here, not two that would let
 * each other's keys through (`./registry.ts` names the two vocabularies at its
 * `'page'` entry). The node that renders an app through the registry is
 * `app-schema-renderer`.
 */
export type DeclaredNode =
  | LiteralTypedArm<Exclude<AnySchema, { type: 'app' }>>
  | AuthoringNode
  | RegisteredCustomNode;

/**
 * A schema node: a node of a declared type, or a primitive rendered as
 * content. Every node slot (`children`, `trigger`, `content`, a view's
 * `schema`) takes it, so an inline child is checked against its own type.
 *
 * @example
 * ```typescript
 * const nodes: SchemaNode[] = [
 *   { type: 'text', content: 'Hello' },
 *   'Plain string',
 *   { type: 'button', label: 'Click' }
 * ]
 * ```
 */
export type SchemaNode = DeclaredNode | string | number | boolean | null | undefined;

/**
 * Component renderer function type.
 * Accepts a schema and returns a rendered component.
 * Framework-agnostic - can be React, Vue, or any other renderer.
 */
export interface ComponentRendererProps<TSchema extends BaseSchema = BaseSchema> {
  /**
   * The schema object to render
   */
  schema: TSchema;

  /**
   * Additional properties passed to the renderer
   */
  [key: string]: any;
}

/**
 * One coarse control kind a {@link ComponentInput} may declare.
 *
 * Named and exported (objectui#3832) because an input's `type` is no longer a
 * single one of these: it is one OR an array of them, and both the declaration
 * sites and the consumers that read it need the arm vocabulary by name rather
 * than re-spelling the eleven literals. Widening it is a contract change — see
 * `ComponentInputSchema` in `zod/base.zod.ts`, which enforces the same set.
 */
export type ComponentInputControlType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'array'
  | 'object'
  | 'color'
  | 'date'
  | 'code'
  | 'file'
  | 'slot';

/**
 * Input field configuration for component metadata.
 * Describes what properties a component accepts in the designer/editor.
 *
 * `binding` is deliberately NOT a member. The manifest serializer forwards it
 * and `validateTree` reads it, but no registration authors it: the key is set
 * by the framework's injected input, {@link InjectedComponentInput}, at the
 * one seam that splices it in (`9e37d9b39`, maintainer ruling of
 * 2026-09-07). Writing it here is therefore an excess-property `tsc` error,
 * on purpose — see that declaration for the ruling and the measurement.
 */
export interface ComponentInput {
  /**
   * Property name (must match schema property)
   */
  name: string;

  /**
   * Input control type — ONE coarse kind, or an ARRAY of them when the key's
   * contract is a union (objectui#3832).
   *
   * The array form exists because a spec key is often a union while this field
   * used to be a single kind, so a declaration had to pick one arm and the
   * repo's own manifest gate then reported the other arm's legal values:
   * `sdui-parser`'s `checkType` warned `type-mismatch` on the inline
   * translation maps (`{ en, "zh-CN" }`) that the very same inputs' own
   * `description` teaches an author to write. One platform authority
   * contradicting itself on the write it just recommended, at warning severity
   * — which is worse than it sounds, because noise on legal writes trains
   * authors (AI authors included) to dismiss the `unknown-prop` and
   * `type-mismatch` reports that ARE real.
   *
   * Semantics of the array form: the arms are alternatives, and a value passes
   * validation when ANY arm accepts it. That is the only leniency — a value
   * matching none of the declared arms is still reported, so a union is not a
   * way to opt out of the gate. Declare only arms the contract accepts AND the
   * renderer resolves; an arm the renderer drops advertises a shape that never
   * reaches the screen. `element:record_picker.emptyText` was held at a single
   * `'string'` arm for exactly that reason until objectui#5590 taught its render
   * site to resolve the inline locale map, and the second arm was declared in
   * that same change — which is the order this rule prescribes, not an
   * exception to it.
   *
   * The single-kind form stays valid and unchanged, and it is the canonical
   * spelling for a key with one arm: the manifest serializer collapses a
   * one-element array back to the bare string, so the published
   * `sdui.manifest.json` gains arrays only where a union was really declared.
   *
   * ## The arms are COARSE KINDS — and that is the ceiling (objectui#5006)
   *
   * An arm names a value's *kind*, never its *domain*. `'number'` is the only
   * numeric arm and `ComponentInput` has no `integer` / `min` / `max` slot to
   * pair with it, so a key whose contract is narrower than "some number" has
   * no way to say so here. Worked example — `page:header.maxVisible`, whose
   * spec type is a POSITIVE SAFE INTEGER: `@objectstack/spec` rejects `0`,
   * `-1` and `1.5`, while this declaration's `'number'` arm admits all three
   * and `checkType` raises no diagnostic on any of them.
   *
   * **Ruled (maintainer, 2026-08-17): the coarse arm plus `description` IS the
   * publication face's expression ceiling today, and SPEC IS THE SOLE JUDGE OF
   * VALUES.** So spell the domain out in `description`, in the author's own
   * terms ("A positive integer — the contract rejects 0 and fractional
   * values"), and let `os validate` / `os build` be the gate that enforces it.
   * `description` documents, it does not check: objectui deliberately raises
   * no authoring-time diagnostic on an out-of-domain value. A *renderer*
   * reading such a key should therefore agree with spec rather than tolerate
   * what spec rejects — `page:header`'s `readMax` was tightened to exactly the
   * contract for this reason, so the loosest layer stops deciding behaviour.
   *
   * Two directions were **deferred**, not rejected on merit: giving
   * `ComponentInput` real constraint slots (two sources of truth, free to
   * drift), and binding `checkType` to spec's Zod member when a
   * `ComponentPropsMap` entry exists (one truth, but couples `sdui-parser` to
   * spec). The ruling names the reopen condition: **a measured case of an
   * author — human or agent — shipping a spec-rejected value that objectui's
   * silence let through.** Until that is measured, do not widen this field.
   *
   * @example 'string'
   * @example ['string', 'object']   // a string or an inline translation map
   * @example ['string', 'number']   // element:text_input.defaultValue
   */
  type: ComponentInputControlType | ComponentInputControlType[];

  /**
   * The coarse kind(s) of this input's MEMBERS — one level down from `type`
   * (objectui#8067).
   *
   * Meaningful on an input whose `type` declares `array` or `object`, and it
   * means the same thing on each: the ELEMENTS of the array, and the VALUES of
   * an object used as a MAP. One kind, or an array of them for a member
   * contract that is a union, with exactly `type`'s semantics — a member passes
   * when ANY declared arm accepts it, and a member matching none is reported.
   *
   * ## Why the slot exists
   *
   * `type: 'array'` says a value is a list and stops there, so a member key
   * that drifts from the contract is invisible to every layer that reads a
   * declaration. `page:header.actions` is the measured cost: `@objectstack/spec`
   * declares `z.array(z.string())` (action IDs), the renderer read the members
   * as `ActionDef` OBJECTS, and the repo-wide parity gate
   * (`apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`) stayed
   * green for the whole life of the drift because it could only compare
   * top-level key names — the `inputs` side had nothing to compare with. What
   * finally settled it was a maintainer ruling, and even after the fix the
   * fact "these are ids" lived only in `description` PROSE. `of: 'string'` is
   * that same fact, in a form a machine reads.
   *
   * ## What it is NOT — and why the 2026-08-17 ceiling is untouched
   *
   * `of` is a KIND, exactly like `type`, and it stops one level down. It is NOT
   * a nested schema: it names no object keys, no element field types, no
   * per-member `required`. It is deliberately not called `items` / `element` /
   * `shape`, all of which promise a sub-schema this does not carry.
   *
   * It therefore adds NO value-domain slot, so the maintainer ruling quoted on
   * `type` above — "the coarse arm plus `description` IS the publication face's
   * expression ceiling today, and SPEC IS THE SOLE JUDGE OF VALUES" — stands
   * unchanged. `of` extends the one axis that ruling already blessed (a coarse
   * KIND) to the one position that had no way to state it; it does not reopen
   * the constraint slots (`min` / `max` / `step`) that ruling deferred, and it
   * is not the `integer`-style narrowing that ruling declined. `of: 'string'`
   * says the members are strings; which strings is still spec's question alone.
   *
   * ## It has readers on day one — the standard this slot had to meet
   *
   * objectui#5905 is the cautionary precedent: five `ComponentInput` keys were
   * declared and read by NOTHING, and the manifest serializer forwarded six
   * keys of which it read none. So `of` ships with three readers, all in the
   * same change that adds it:
   *
   *   1. the repo-wide parity gate compares every declared `of` arm against the
   *      member kind `ComponentPropsMap[type]` actually accepts, and reds on an
   *      arm the contract refuses — the same one-directional widening question
   *      the ARM DIRECTION asks of `type` (objectui#4971);
   *   2. `sdui-parser`'s `validateTree` reports a member whose kind fits no
   *      declared arm, at the member's own position;
   *   3. `sdui-parser`'s codegen types the generated `sdui-intrinsics.d.ts`
   *      surface from it — `string[]` rather than `unknown[]`.
   *
   * DECLARE IT ONLY WHERE THE CONTRACT FORCES ONE ANSWER. Every `of` in this
   * repository was derived by probing `ComponentPropsMap`'s member position
   * with one value of each coarse kind and taking the result only where exactly
   * ONE kind was accepted. A member contract that accepts several kinds (spec's
   * `record:highlights.fields` takes a string OR an object) is left undeclared
   * on purpose: picking one arm there would be the NARROWING this repo treats
   * as noise, and picking all of them would advertise shapes the renderer may
   * not resolve — which is per-block discipline, not a repo-wide derivation.
   *
   * @example { name: 'actions', type: 'array', of: 'string' }
   * @example { name: 'sections', type: 'array', of: 'object' }
   */
  of?: ComponentInputControlType | ComponentInputControlType[];

  /**
   * ADR-0049 RETIREMENT TOMBSTONES — `label` / `defaultValue` / `advanced`
   * (objectui#7493 item ①, objectui#7781; maintainer ruling A of 2026-09-06).
   * The three keys the manifest serializer does not forward, retired together
   * on both faces in the shape the five tombstones at the bottom of this block
   * established (objectui#5905): `?: never` here, so authoring one is a `tsc`
   * error at the registration site, and `retirementTombstone()` on the Zod
   * twin (`zod/base.zod.ts` `ComponentInputSchema`), so an authored value is a
   * NAMED parse refusal carrying its own remedy. Deleting the members outright
   * was measured and NOT taken: the mirror is a non-strict `z.object`, and on
   * the built face an undeclared key parses green and is silently STRIPPED —
   * one silent no-op traded for another.
   *
   * What was measured (re-measured on the retiring PR's merge-base, not
   * inherited from the cards): every non-test consumer of
   * `ComponentMeta.inputs` was enumerated and none reads any of the three —
   * the serializer (`packages/sdui-parser/src/index.ts`) forwards a fixed key
   * list per input, `of` included since objectui#8067 (`name`, `type`, `of`,
   * `required`, `enum`, `binding`, `description` — `binding` among them is
   * not an authored key but the framework's, forwarded from
   * {@link InjectedComponentInput}, `9e37d9b39`), its boundary type has no slot for these, the registry's
   * data-source seam reads `name` only, and neither the designer nor the
   * app-shell inspectors consult registry `inputs` at all. The one
   * non-test touch was a WRITE (`WidgetRegistry` copying the widget-manifest
   * values across), deleted with this retirement. A depth-1 bracket-balanced
   * census over every `inputs:` array in the repository counted the
   * authorship: `label` 908, `defaultValue` 245, `advanced` 9 — against
   * `name` 951 and `type` 951 in the same pass over the same regions, so the
   * instrument was not blind. Written on nearly every registration, read by
   * nothing. Authorship from OUTSIDE the repository is not measurable from here
   * (the objectui#5674 limit); converting such a write from a silent drop into
   * a named refusal is what the tombstones buy.
   *
   * What an author writes instead: NOTHING. An input is identified by its
   * `name` on every path that reaches it, and no consumer ever rendered a
   * label for it; the renderer's own fallback read IS the default, and the
   * place to tell an author about it is `description`, which is published;
   * and no designer surface ever hid an "advanced" input. Options B (tighten
   * `defaultValue` to `unknown` — closes no error class), C (teach the
   * serializer to forward the keys — refused on record for `inputType` in
   * objectui#5905: a write nothing reads is not demand for a feature) and D
   * (keep as documentation) were each ruled out.
   *
   * RETIRED (objectui#7493, ADR-0049) — never read, and never published. Delete
   * the key; the input's `name` is what every consumer identifies it by.
   * @deprecated Not part of `ComponentInput`'s contract — the value was inert.
   */
  label?: never;

  /**
   * RETIRED (objectui#7493, ADR-0049) — never read, and never published: the
   * manifest serializer forwards a fixed key list and this is not one of them, and no
   * renderer, registry or designer surface ever read a declared default. Delete
   * the key; the renderer's own fallback read is the default, and `description`
   * — which IS published — is where to state it for an author. The 245 values
   * this carried were shadow copies of renderer fallbacks that only test pins
   * ever compared; those pins now read the renderer's ACTUAL default.
   * @deprecated Not part of `ComponentInput`'s contract — the value was inert.
   */
  defaultValue?: never;

  /**
   * Whether this property is required
   */
  required?: boolean;

  /**
   * Enum options (for type='enum')
   */
  enum?: string[] | { label: string; value: any }[];

  /**
   * Help text or description
   */
  description?: string;

  /**
   * RETIRED (objectui#7493 / objectui#7781, ADR-0049) — never read, and never
   * published: the manifest serializer forwards a fixed key list and this is
   * not one of them, and no designer surface ever hid an "advanced" input (nine
   * registrations wrote it; nothing consumed it). Delete the key; there is
   * nothing to write instead.
   * @deprecated Not part of `ComponentInput`'s contract — the value was inert.
   */
  advanced?: never;

  /**
   * RETIRED (objectui#5905, ADR-0049) — never read, and never published: the
   * manifest serializer forwards a fixed key list and this is not one of them. Put the
   * control hint in `description`, which IS published.
   *
   * The LAST of the five to be retired, and by its own ruling, because its
   * defect was a different one. The four below were declared-and-UNREAD; this
   * key was declared-and-DROPPED — the repository really did author it, on
   * `packages/plugin-markdown`'s `content` input — so retiring it had to decide
   * what that registration should say instead, which is why it was held back
   * as a fork rather than retired alongside them.
   *
   * Maintainer ruling 2026-08-31 (objectui#5905, director seat summon 6,
   * decision batch #14) took option B: DELETE the write. It was measured as a
   * no-op — the serializer dropped it, and a structural census over every
   * `inputs:` array in the repository found no reader — so deleting it costs
   * zero capability. Option A, teaching `sdui-parser` to forward the key, is
   * REFUSED on record: a write nothing reads is not demand for a feature. The
   * 2026-08-17 expression-ceiling ruling quoted on `type` above is untouched
   * by this and stays deferred, reopen condition unchanged.
   *
   * @deprecated Not part of `ComponentInput`'s contract — the value was inert.
   */
  inputType?: never;

  /**
   * ADR-0049 RETIREMENT TOMBSTONES — `min` / `max` / `step` / `placeholder`
   * (objectui#5905). `inputType`, declared directly above, is a FIFTH tombstone
   * of exactly this shape; it carries its own block because it was retired
   * later, by its own ruling, out of a different defect.
   *
   * `?: never` is this package's tombstone convention (see `crud.ts` `confirm`
   * and {@link StaticTableColumn} in `data-display.ts`): the key stays
   * DECLARED and becomes UNWRITABLE, so authoring one is a `tsc` error here and
   * a named parse refusal in the Zod twin (`zod/base.zod.ts`
   * `ComponentInputSchema`, via `retirementTombstone()`). Deleting the members
   * outright would have been the quiet option — an undeclared key is silently
   * stripped by the non-strict mirror, which trades one silent no-op for
   * another.
   *
   * What was measured (objectui#5905, re-measured on the merge-base of the
   * retiring PR): no consumer reads any of the four, and the manifest
   * serializer (`packages/sdui-parser/src/index.ts`) forwards a fixed key list
   * per input — `name`, `type`, `of`, `required`, `enum`, `binding`,
   * `description`, the last of them added by objectui#8067; `binding` is the
   * framework's key, forwarded from {@link InjectedComponentInput} rather
   * than authored (`9e37d9b39`) —
   * so a value authored here could not reach the published
   * `sdui.manifest.json` even in principle. A structural census over every
   * `inputs:` array in the repository found ZERO authoring sites for the four
   * (the same pass counted 926 `name`, 926 `type` and 161 `description` sites,
   * so the instrument was not blind). Authorship from OUTSIDE the repository is
   * not measurable from here — the limit objectui#5674 recorded for
   * `PluginComponentInput` — and converting such a write from a silent drop
   * into a NAMED REFUSAL is exactly what these tombstones buy.
   *
   * ⚠️ Why a future reader must NOT read this as "these keys were a mistake":
   * the neighbouring `type` field carries a maintainer ruling of 2026-08-17
   * (quoted in full above) recording that giving `ComponentInput` real
   * constraint slots was **DEFERRED, NOT REJECTED** — two sources of truth,
   * free to drift, was the stated cost. `min` / `max` / `step` read exactly
   * like the slots that ruling declined to add. What is retired is this inert
   * spelling of them, not the idea; the ruling's own reopen condition (a
   * measured case of an author shipping a spec-rejected value objectui's
   * silence let through) is still the route back.
   *
   * RETIRED (objectui#5905, ADR-0049) — never read, and never published: the
   * manifest serializer forwards a fixed key list and this is not one of them. Spell
   * the numeric domain out in `description`, which IS published.
   * @deprecated Not part of `ComponentInput`'s contract — the value was inert.
   */
  min?: never;
  /**
   * RETIRED (objectui#5905, ADR-0049) — never read, and never published: the
   * manifest serializer forwards a fixed key list and this is not one of them. Spell
   * the numeric domain out in `description`, which IS published.
   * @deprecated Not part of `ComponentInput`'s contract — the value was inert.
   */
  max?: never;
  /**
   * RETIRED (objectui#5905, ADR-0049) — never read, and never published: the
   * manifest serializer forwards a fixed key list and this is not one of them. Spell
   * the numeric domain out in `description`, which IS published.
   * @deprecated Not part of `ComponentInput`'s contract — the value was inert.
   */
  step?: never;
  /**
   * RETIRED (objectui#5905, ADR-0049) — never read, and never published: the
   * manifest serializer forwards a fixed key list and this is not one of them. Put the
   * hint in `description`, which IS published. `BaseSchema.placeholder` — the
   * node-level prop a renderer does read — is a DIFFERENT key and is
   * unaffected.
   * @deprecated Not part of `ComponentInput`'s contract — the value was inert.
   */
  placeholder?: never;
}

/**
 * The input the FRAMEWORK injects into a registration: a {@link ComponentInput}
 * plus the `binding` marker — which is why `binding` is not a member of
 * `ComponentInput` itself (`9e37d9b39`; maintainer ruling of 2026-09-07,
 * director decision batch #69: `binding` is framework-set, not
 * author-declared).
 *
 * ## What the marker is, and who writes it
 *
 * `binding: 'object'` tells a consumer that the input names an OBJECT: the
 * manifest serializer (`packages/sdui-parser/src/index.ts`) forwards it into
 * `sdui.manifest.json`, `validateTree` records the prop as a binding site the
 * server must resolve, and the designer offers an object picker. It is
 * unrelated to `type: 'object'`, the coarse control KIND that sits one line
 * above it in the same declaration — a record-shaped value and an
 * object-naming input are two different facts, and the one writer states both.
 *
 * That writer is the framework: `ELEMENT_DATA_SOURCE_INPUT` in
 * `@object-ui/core` (`data-scope/element-data-source.ts`), spliced into a
 * registration's `inputs` by `Registry.register` for every renderer that
 * passed through `elementDataSourceBlock()`. No registration authors the key.
 * Measured before the ruling and re-measured at the retiring PR's merge-base:
 * every `binding:` literal in `packages/`, `apps/` and `examples/` is
 * `'object'` (7 of 7), and every one of them is either that constant or a
 * fixture in `sdui-parser`'s own tests. The ruling answered the product
 * question the card asked — may an ordinary registration declare a binding
 * input? — with **no**, so `ComponentInput` refuses the key the ordinary way
 * (an excess-property `tsc` error at the registration site) and the ONE place
 * that may write it is typed by this declaration. Until `9e37d9b39` it was
 * typed by a hand-written inline literal and reached the `inputs` array
 * through an `as ComponentMeta` cast — a cast at the only write site is
 * exactly what would have hidden any later drift between the constant and
 * the type.
 *
 * ## Why `extends` and not the ruling's `&` sketch
 *
 * The ruling's example was `ComponentInput & { binding: 'object' }`. An
 * `interface … extends` says the same thing and is checked at ITS declaration:
 * if `ComponentInput` ever gains a `binding` member this one cannot extend
 * (a `?: never` tombstone, say), that is a TS2430 on this line, where the
 * relationship is stated — not a `never` quietly folded into a type expression
 * that only surfaces at whichever use site first trips over it. Diagnostics
 * also name `InjectedComponentInput` instead of an anonymous intersection.
 * The reopen route the ruling names — a measured need for author-declared
 * bindings, filed as a WIDENING of `ComponentInput` with the vocabulary
 * decided then — lands on the parent, and this declaration follows it.
 *
 * The vocabulary is exactly `'object'`. The serializer's boundary type once
 * also admitted `'field'`; that arm had zero writers and was retired with
 * this declaration (ADR-0049 enforce-or-remove, `9e37d9b39`) — see
 * `RegistryConfigLike` in `packages/sdui-parser/src/index.ts`.
 */
export interface InjectedComponentInput extends ComponentInput {
  /** The framework-set binding marker: this input names an object. */
  binding: 'object';
}

/**
 * Component metadata for registration and designer integration.
 * Describes the component's capabilities, defaults, and documentation.
 */
export interface ComponentMeta {
  /**
   * Display name in designer/palette
   */
  label?: string;

  /**
   * Icon name or SVG string
   */
  icon?: string;

  /**
   * Category for grouping (e.g., 'Layout', 'Form', 'Data Display')
   */
  category?: string;

  /**
   * Configurable properties
   */
  inputs?: ComponentInput[];

  /**
   * Default property values for new instances
   */
  defaultProps?: Record<string, any>;

  /**
   * Example configurations for documentation
   */
  examples?: Record<string, any>;

  /**
   * LAYOUT containment (objectui#6804, objectui#9910 Q2-A): the component is
   * a layout region — skipped by the react-page JSX scope builder and listed
   * in the public layout ledger.
   *
   * ⛔ Not "can have children". Whether a renderer puts `schema.children` on
   * the page is declared in `inputs` as `{ name: 'children', type: 'slot' }`,
   * and that input — never this flag — is what `sdui-parser`'s
   * `not-a-container` diagnostic reads (objectui#9910 Q1-A). A layout
   * container that renders a child list declares both; a label-fallback
   * reader such as `button` or `badge` declares only the slot.
   */
  isContainer?: boolean;

  /**
   * Whether the component can be resized in the designer
   */
  resizable?: boolean;

  /**
   * Resize constraints (which dimensions can be resized)
   */
  resizeConstraints?: {
    width?: boolean;
    height?: boolean;
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
  };

  /**
   * Tags for search/filtering
   */
  tags?: string[];

  /**
   * Description for documentation
   */
  description?: string;
}

/**
 * Complete component configuration combining renderer and metadata — the ONE
 * declaration of this name (objectui#6298).
 *
 * ## Why it carries a type parameter
 *
 * `@object-ui/core` used to declare a SECOND `ComponentConfig` in
 * `src/registry/Registry.ts`, and after objectui#6067 / PR #6297 single-sourced
 * the `ComponentMeta` half, GENERICITY AND THE `component` SLOT was the whole
 * of what still made the two same-named PUBLISHED exports genuinely different
 * types: core's was `<T = any>` with a parameterised renderer slot, this one was
 * non-generic with `component: any`. Core now RE-EXPORTS this declaration, so
 * the parameter has to live here for that re-export to be lossless.
 *
 * The parameter is DEFAULTED, so every existing spelling keeps its meaning
 * exactly: bare `ComponentConfig` is `ComponentConfig<any>`, whose `component`
 * is `any` — the same slot this declaration has always published. Nothing that
 * compiled against it before has to change.
 *
 * ⚠️ `T` is the RENDERER ITSELF, not a props type. Core's `ComponentRenderer<T>`
 * is the IDENTITY alias (`export type ComponentRenderer<T = any> = T`), which is
 * why `component: T` here says exactly what `component: ComponentRenderer<T>`
 * said there — and why this convergence needed no `@object-ui/types` →
 * `@object-ui/core` dependency edge, which would have been a cycle in the wrong
 * direction (this package is the bottom layer; core depends on it). That
 * identity is not assumed: it is pinned in
 * `packages/core/src/registry/__tests__/component-config-single-declaration.test.ts`,
 * and if `ComponentRenderer` ever stops being the identity this slot stops
 * matching it and that pin goes red.
 *
 * @typeParam T - The renderer this configuration carries. Defaults to `any`,
 *   the framework-agnostic slot this package published before it was named.
 */
export interface ComponentConfig<T = any> extends ComponentMeta {
  /**
   * Unique component type identifier
   */
  type: string;

  /**
   * The component renderer (framework-specific)
   */
  component: T;
}

/**
 * Common HTML attributes that can be applied to components
 */
export interface HTMLAttributes {
  id?: string;
  className?: string;
  style?: Record<string, any>;
  title?: string;
  role?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'data-testid'?: string;
}

/**
 * Event handler types
 */
export interface EventHandlers {
  onClick?: (event?: any) => void | Promise<void>;
  onChange?: (value: any, event?: any) => void | Promise<void>;
  onSubmit?: (data: any, event?: any) => void | Promise<void>;
  onFocus?: (event?: any) => void;
  onBlur?: (event?: any) => void;
  onKeyDown?: (event?: any) => void;
  onKeyUp?: (event?: any) => void;
  onMouseEnter?: (event?: any) => void;
  onMouseLeave?: (event?: any) => void;
}

/**
 * Common style properties using Tailwind's semantic naming
 */
export interface StyleProps {
  /**
   * Padding (Tailwind scale: 0-96)
   */
  padding?: number | string;

  /**
   * Margin (Tailwind scale: 0-96)
   */
  margin?: number | string;

  /**
   * Gap between flex/grid items (Tailwind scale: 0-96)
   */
  gap?: number | string;

  /**
   * Background color
   */
  backgroundColor?: string;

  /**
   * Text color
   */
  textColor?: string;

  /**
   * Border width
   */
  borderWidth?: number | string;

  /**
   * Border color
   */
  borderColor?: string;

  /**
   * Border radius
   */
  borderRadius?: number | string;
}
