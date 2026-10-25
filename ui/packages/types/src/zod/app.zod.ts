/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - Application Schema Zod Validators
 * 
 * Zod validation schemas for top-level application configuration.
 * Following @objectstack/spec UI specification format.
 * 
 * @module zod/app
 * @packageDocumentation
 */

import { z } from 'zod';
import {
  AppSchema as SpecAppSchema,
  AppContextSelectorSchema as SpecAppContextSelectorSchema,
  ElementApiDataSourceSchema as SpecElementApiDataSourceSchema,
  I18nLabelSchema as SpecI18nLabelSchema,
  NavigationAreaSchema as SpecNavigationAreaSchema,
  // ⚠️ NOT a crossing, so it stays RAW — see THE IMPORT BOUNDARY below. This is
  // the spec's own refinement FUNCTION, not a schema: `stripImportedDefaults`
  // walks a Zod graph and a refinement has none, and a check that only calls
  // `ctx.addIssue` cannot write a default into an author's document. Declared
  // as such in `../__tests__/imported-defaults-8317.test.ts` rather than left
  // to this paragraph.
  objectNavTargetExclusivity,
  // RAW for the same reason: the spec's own refinement function, chained on
  // every navigation arm below (objectui#13076).
  navItemVisibleDataNeedsDataSource,
} from '@objectstack/spec/ui';
import {
  EvaluatedExpressionInputSchema as SpecEvaluatedExpressionInputSchema,
  EvaluatedExpressionSchema as SpecEvaluatedExpressionSchema,
} from '@objectstack/spec/shared';
import { BaseSchema, specFieldsExcept } from './base.zod.js';
import { aliasKeyRefusal, retirementTombstone } from './tombstone.zod.js';
import type { AppMenuItem, NavigationItemType } from '../app.js';
import { stripImportedDefaults } from './imported-defaults.js';

/**
 * ⭐ THE IMPORT BOUNDARY (objectui#8317, decision batch #90, 2026-09-08).
 *
 * **This mirror authors no default, imported subschemas included.** Batch #69
 * (objectui#7735) ruled that a validator validates and does not write values
 * into an author's document; batch #90 ruled that this holds for EVERY key
 * `safeValidateSchema` answers, not only the sites this repository wrote. So a
 * schema arriving from `@objectstack/spec` crosses into a mirror shape only
 * through `stripImportedDefaults`, which removes each reachable `ZodDefault`
 * with `.removeDefault()` and keeps the key omissible. Keys, types, checks and
 * the accept set are untouched, and a subtree carrying no default comes back
 * reference-equal — so this is a no-op the day the spec adopts the same
 * principle.
 *
 * ⛔ Spelled at every crossing rather than once per file, deliberately: a local
 * `const Spec… = stripImportedDefaults(…)` would put the spec's provenance one
 * hop away from every declaration that reads it, and `check:spec-symbols`
 * (rule 1) reads exactly one hop — a mirror export under a spec-owned name has
 * to show the spec binding in its OWN initializer. The verbosity is the
 * provenance.
 *
 * ⚠️ A read that is NOT a crossing stays unwrapped and is declared as such: a
 * value VOCABULARY (`./views.zod.ts`'s `SpecListViewTypeEnum` and
 * `./objectql.zod.ts`'s `ViewKindEnum`, which unwrap the spec's own
 * `.default('grid')` to reach its enum) and a TYPE position — neither puts a
 * default into a parsed document. `../__tests__/imported-defaults-8317.test.ts`
 * re-derives that exception list from the source rather than trusting this
 * paragraph, and fails if an entry stops matching a real read.
 */


// ============================================================================
// Unified NavigationItem Schema
// ============================================================================

/** A node of `@objectstack/spec`'s nav-item graph, as the walks below read it. */
type SpecNavNode = z.ZodType & {
  unwrap?: () => SpecNavNode;
  element?: SpecNavNode;
  options?: readonly SpecNavNode[];
  shape?: Record<string, SpecNavNode & { value?: unknown }>;
};

/**
 * The arms of `@objectstack/spec`'s nav-item union, read off the spec `AppSchema`'s
 * own `navigation` element (optional → array → lazy → the discriminated union).
 * Reading it through `AppSchema`, which this mirror already crosses, keeps the
 * read inside the objectui#8317 import boundary's measured population instead of
 * adding a lazy root that population cannot walk (the objectui#10867 route).
 * `undefined` when the walk finds no union; each caller throws its own refusal.
 */
let specNavigationArms: readonly SpecNavNode[] | undefined;
function readSpecNavigationArms(): readonly SpecNavNode[] | undefined {
  if (specNavigationArms) return specNavigationArms;
  let node = (stripImportedDefaults(SpecAppSchema) as unknown as SpecNavNode).shape?.navigation as SpecNavNode | undefined;
  for (let hop = 0; node && !node.options && hop < 8; hop++) node = node.element ?? node.unwrap?.();
  if (!node?.options?.length) return undefined;
  specNavigationArms = Object.freeze([...node.options]);
  return specNavigationArms;
}

/** The spec arm whose `type` literal is `type`, or `undefined`. */
function readSpecNavigationArm(type: string): (SpecNavNode & { shape: NonNullable<SpecNavNode['shape']> }) | undefined {
  const arm = readSpecNavigationArms()?.find((option) => option.shape?.type?.value === type);
  return arm?.shape ? (arm as SpecNavNode & { shape: NonNullable<SpecNavNode['shape']> }) : undefined;
}

/**
 * The discriminator of `@objectstack/spec`'s nav-item union: every arm's `type`
 * literal, in the spec's order. Throws when an arm carries no string literal —
 * an enum that silently lost a member is the objectui#11197 defect itself.
 */
function readSpecNavigationItemTypes(): [NavigationItemType, ...NavigationItemType[]] {
  const types = (readSpecNavigationArms() ?? []).map((arm) => arm.shape?.type?.value);
  if (types.length === 0 || types.some((type) => typeof type !== 'string')) {
    throw new Error(
      "objectui#11197: could not read a `type` literal off every arm of @objectstack/spec's AppSchema.navigation union",
    );
  }
  return types as [NavigationItemType, ...NavigationItemType[]];
}

/**
 * Navigation item type — READ OFF the discriminator of `@objectstack/spec`'s
 * nav-item union at module load (objectui#11197), never hand-listed.
 *
 * The hand list this replaces had nine members after spec 17.5.0 added `doc`,
 * so `objectui validate` refused `{ type: 'doc', book }` — an entry the spec's
 * own docblock example spells — with `invalid_value` at `type`, while the
 * TypeScript twin `NavigationItemType` (`../app.ts`), derived from the spec's
 * union, already carried `doc`: the two faces of one package disagreed.
 * `../__tests__/navigation-spec-parity.test.ts` fails the next time the spec's
 * discriminator and this enum part.
 */
export const NavigationItemTypeSchema = z.enum(readSpecNavigationItemTypes());

/**
 * Navigation Item Schema — unified model aligned with @objectstack/spec.
 *
 * MEMOISED (objectui#7918): the getter returns a module-level constant, so the
 * PUBLIC `NavigationItemSchema.unwrap()` is reference-stable. (`ZodLazy` spells
 * `unwrap` as `() => _zod.def.getter()`, going around the cache zod keeps on
 * `def._cachedInner`, so an un-memoised lazy hands out a fresh schema per call.)
 * Safe here for a reason specific to THIS schema — its self-reference is already
 * deferred by the inner `z.lazy(() => NavigationItemSchema)` on `children` below,
 * so the body itself names nothing that is still uninitialised when it is built.
 *
 * ⚠️ Seven of the other nine `z.lazy` exports of this face CANNOT take this
 * shape — `MenuItemSchema` further down this very file among them. Those bodies
 * name the const being declared DIRECTLY (`children: z.array(MenuItemSchema)`,
 * no inner `z.lazy`), so building the body eagerly throws `ReferenceError:
 * Cannot access '<name>' before initialization` at module load. Their `z.lazy`
 * is buying a TDZ dodge, not a style. Measured one schema at a time in
 * `../__tests__/zod-lazy-getter-identity-7918.test.ts` — read that before
 * "fixing" any of them to match this one.
 */
/**
 * The keys `@objectstack/spec`'s separator branch declares — `type`, `id` and
 * `order` on the installed pin — READ OFF the spec rather than restated
 * (objectui#10867). The spec does not export its `SeparatorNavItemSchema`, so
 * this takes the arm whose `type` literal is `'separator'` from
 * {@link readSpecNavigationArms}, the walk of the spec `AppSchema`'s own
 * `navigation` element.
 *
 * Computed on first use and memoised. It throws when no such arm exists: a
 * separator check that silently allowed nothing, or everything, would read as
 * enforcement, and a thrown error is what the pin file sees.
 */
let specSeparatorKeys: readonly string[] | undefined;
function getSpecSeparatorKeys(): readonly string[] {
  if (specSeparatorKeys) return specSeparatorKeys;
  const arm = readSpecNavigationArm('separator');
  if (!arm) {
    throw new Error(
      "objectui#10867: @objectstack/spec's AppSchema.navigation has no `type: 'separator'` arm to read the separator's keys from",
    );
  }
  specSeparatorKeys = Object.freeze(Object.keys(arm.shape));
  return specSeparatorKeys;
}

/**
 * A PRESENT empty label is not "no label": it renders verbatim, i.e. as empty
 * text, and silently opts the entry out of inheritance (objectui#9868). Refused
 * as it was while `label` was required. ⚠️ A divergence from the spec, stated:
 * the spec's base accepts `''`, so the platform's save door does not catch it —
 * this mirror (what `objectui validate` answers) is where it is caught. Shared
 * by both arms, so a `doc` entry answers exactly as its siblings do.
 */
function refuseEmptyNavLabel(item: { type: string; label?: unknown }, ctx: z.RefinementCtx): void {
  if (item.label !== '') return;
  ctx.addIssue({
    code: 'custom',
    path: ['label'],
    message:
      `\`label\` is empty on a navigation item of type '${item.type}': omit the key to inherit ` +
      "the target's label at render time, or write the text to show",
  });
}

/**
 * A navigation entry's `visible`: the spec's `EvaluatedExpressionInputSchema`,
 * by reference, beside the one pinned objectui arm, `boolean` (objectui#13075).
 *
 * The spec types every nav branch's `visible` as `EvaluatedExpressionInputSchema`:
 * a non-blank predicate string, or the `{ dialect, source }` envelope its own
 * parse produces (`defineApp` returns the parsed app, so a string authored there
 * comes back as the envelope). Until objectui#13075 this slot was
 * `boolean | string`: it refused the envelope the spec accepts, and accepted a
 * blank string the spec refuses. Both are the spec's verdicts now.
 *
 * Spelled the way `visibleWhen`'s wire is in `./base.zod.ts`, and for the same
 * reason: the accept set is the spec's input type (a string, or the spec's own
 * `EvaluatedExpressionSchema` read by reference), and every verdict on a
 * non-boolean value is the spec's — the value is handed to
 * `EvaluatedExpressionInputSchema` and its issues are the refusal, so a blank
 * string is refused with the spec's code and sentence. The judge runs only on a
 * value an arm already took, so one fault is never reported twice. What is NOT taken is the
 * spec's transform, which rewrites a bare string into `{ dialect: 'cel', source }`:
 * this mirror writes nothing into an author's document (decision batches #69 /
 * #90), so a string stays a string.
 *
 * `boolean` is the stated divergence: the spec admits it at neither tier, and
 * `menuItemToNavigationItem` manufactures one when it inverts legacy
 * `AppMenuItem.hidden`. `../__tests__/navigation-spec-parity.test.ts` pins all
 * three rows: the envelope and the blank string agree with the spec, the boolean
 * does not.
 */
function specVisibleRefusal(visible: unknown): z.core.$ZodIssue[] {
  const verdict = stripImportedDefaults(SpecEvaluatedExpressionInputSchema).safeParse(visible);
  return verdict.success ? [] : verdict.error.issues;
}
const NavigationVisibleSchema = z
  .union([z.boolean(), z.string(), stripImportedDefaults(SpecEvaluatedExpressionSchema)], {
    // A value no arm takes (`{ dialect: 'cel' }`, a number) is refused with the
    // spec's own sentence for it, not zod's generic one.
    error: (issue) => specVisibleRefusal(issue.input)[0]?.message,
  })
  .superRefine((visible, ctx) => {
    if (typeof visible === 'boolean') return;
    for (const issue of specVisibleRefusal(visible)) ctx.addIssue({ ...issue, message: issue.message });
  }, { when: (payload) => payload.issues.length === 0 });

/** `a`, `b` and `c` — the separator refusal's list of what a separator may carry. */
function codeList(keys: readonly string[]): string {
  const quoted = keys.map((key) => `\`${key}\``);
  return quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}` : quoted.join('');
}

const NavigationItemObject = z.object({
  // Declared optional so a bare `{ type: 'separator' }` — which the spec
  // accepts, and which carries no identity or text by definition — validates
  // here too (objectstack#4115). Every OTHER type still requires `id`; that is
  // re-imposed by the refinement below rather than by the field declarations,
  // because this is one flat shape and not the spec's discriminated union.
  // `label` is optional for every type since objectui#9868 (inherited when
  // absent); the refinement refuses only an EMPTY one.
  id: z.string().optional().describe('Unique identifier'),
  // Every type but `doc`, which is judged by its own arm below (objectui#11197).
  type: NavigationItemTypeSchema.exclude(['doc']).describe('Navigation item type'),
  // The spec's `I18nLabelSchema` BY REFERENCE (objectui#11299): a plain string,
  // or an inline locale map (`{ en, 'zh-CN' }`) — exactly what the spec's
  // shared nav-item base declares, so `objectui validate` and the platform's
  // save door judge an entry label alike. Until objectui#11299 this was
  // `z.string()` and refused a map the spec accepts. `refuseEmptyNavLabel`
  // below still refuses an empty STRING — the one stated divergence.
  label: stripImportedDefaults(SpecI18nLabelSchema).optional().describe("Display label: a plain string, or an inline locale map ({ en, 'zh-CN' }) rendered in the viewer's locale. Optional: absent ⇒ the entry inherits its target's current label at render time (view, else object / dashboard, else the target's machine name); present ⇒ rendered as authored. Never an empty string"),
  icon: z.string().optional().describe('Icon name (Lucide)'),

  // Type-specific target fields
  objectName: z.string().optional().describe('Target object name (type: object)'),
  viewName: z.string().optional().describe('Target view name (type: object) — named list view e.g. calendar, pipeline'),
  recordId: z.string().optional().describe('Target record id (type: object) — opens a single record. Supports template variables {current_user_id}, {current_org_id}.'),
  recordMode: z.enum(['view', 'edit']).optional().describe('Record opening mode when recordId is set (default: view)'),
  filters: z.record(z.string(), z.string()).optional().describe('URL filter conditions (type: object) — targets the /:objectName/data bare surface via filter[<field>]=<value> params instead of a saved view. Values support {current_user_id}/{current_org_id}. Mutually exclusive with recordId/viewName.'),
  // Declared here for the same reason `requiresObject` / `actionDef` are: this
  // schema STRIPS unknown keys, so an entry deep-linking into an action would
  // have validated clean through `objectui validate` with the deep link thrown
  // away (the objectstack#4115 failure class). Spec: `ObjectNavItemSchema.runAction`.
  runAction: z.string().optional().describe('Auto-run deep link (type: object) — name of an action on the target object that the list surface runs once on arrival. Not combinable with recordId (a record detail page has no list toolbar to auto-run); composes with viewName or filters. Encoded as the reserved ?runAction= search param.'),
  dashboardName: z.string().optional().describe('Target dashboard name (type: dashboard)'),
  pageName: z.string().optional().describe('Target page name (type: page)'),
  reportName: z.string().optional().describe('Target report name (type: report)'),
  url: z.string().optional().describe('Target URL (type: url)'),
  target: z.enum(['_blank', '_self']).optional().describe('Link target (type: url)'),
  componentRef: z.string().optional().describe('Target component reference (type: component) — colon-joined ComponentRegistry key e.g. metadata:resource, routed to /component/<ns>/<name>'),
  params: z.record(z.string(), z.unknown()).optional().describe('Extra parameters (type: component | page) — serialised as querystring; string values support {current_user_id}/{current_org_id}'),

  // Grouping
  children: z.array(z.lazy(() => NavigationItemSchema)).optional().describe('Child items (type: group)'),

  // Action payload (type: 'action'). Undeclared until objectstack#4115: the
  // schema strips unknown keys, so an action item validated clean while its
  // entire payload was thrown away.
  actionDef: z.object({
    actionName: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
  }).optional().describe('Action payload (type: action)'),

  // Visibility & Permissions
  visible: NavigationVisibleSchema.optional().describe("Visibility predicate: a non-blank CEL string or the spec's `{ dialect, source }` envelope (`@objectstack/spec` `EvaluatedExpressionInputSchema`), or a boolean"),
  // objectui#12971: the spec's shared nav-item base declares one API data source
  // (objectstack#24332, `ElementApiDataSourceSchema` by reference), whose bound
  // value an entry's `visible` reads as `data`. Taken by reference for the
  // reason `runAction` is declared above: this schema strips unknown keys, so an
  // authored binding would have validated clean and been thrown away. The
  // console reads it (objectui#13029): the shell's navigation `visible`
  // evaluator (`useNavVisibility` in `@object-ui/app-shell`) reads the binding
  // and hides the entry until it answers.
  dataSource: stripImportedDefaults(SpecElementApiDataSourceSchema).optional().describe("One API data source whose bound value the entry's `visible` reads as `data` (`@objectstack/spec` `ElementApiDataSourceSchema`). The console reads it with the signed-in fetch; the entry stays hidden while the read is pending or after it fails. Only `visible` reads `data`; the label, the target and `children` do not"),
  requiredPermissions: z.array(z.string()).optional().describe('Required permissions'),
  // Runtime capability gates. `NavigationRenderer` has always honoured these
  // and `NavigationItem` has always declared them — only this schema lagged,
  // so `objectui validate` silently dropped them (objectstack#4115).
  requiresObject: z.string().optional().describe('Object that must be registered for this entry to render'),
  requiresService: z.string().optional().describe('Kernel service that must be registered for this entry to render'),

  // UX Enhancements
  badge: z.union([z.string(), z.number()]).optional().describe('Badge text or count'),
  badgeVariant: z.enum(['default', 'secondary', 'destructive', 'outline']).optional().describe('Badge variant'),
  expanded: z.boolean().optional().describe('Group default expanded state (spec field name)'),
  /** @deprecated legacy objectui spelling of `expanded`; the renderer honours either. */
  defaultOpen: z.boolean().optional().describe('Group default expanded state (legacy alias of `expanded`)'),
  pinned: z.boolean().optional().describe('Pinned item'),
  order: z.number().optional().describe('Sort order weight'),
}).superRefine((item, ctx) => {
  // Identity and text are required for every real destination; only the
  // separator — a rule, not an entry — is exempt. Declaring the fields
  // optional above is what lets `{ type: 'separator' }` through, so without
  // this an id-less `type: 'object'` item would validate too. Since
  // objectui#9868 the TEXT half is met by inheritance when `label` is absent
  // (see below); identity is still required here.
  //
  // The separator carries exactly what the spec's separator declares
  // (objectui#10867). This shape is flat, so it declares `label`, `icon` and
  // the rest for every type; without this branch refusing them, `objectui
  // validate` passed a separator `label` the platform's save door refuses with
  // `unrecognized_keys`. The allowed set is read off the spec, not restated.
  if (item.type === 'separator') {
    const allowed = getSpecSeparatorKeys();
    for (const [key, value] of Object.entries(item)) {
      if (allowed.includes(key) || value === undefined) continue;
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `a separator carries only ${codeList(allowed)}; drop \`${key}\``,
      });
    }
    return;
  }
  // Identity is required; TEXT may be inherited (objectui#9868, the cloud#2021
  // letter-A ruling, matching `@objectstack/spec` 17.5.0, whose shared nav-item
  // base declares `label` optional for every entry type). An ABSENT `label`
  // means "inherit the target's current label at render time" —
  // `resolveNavItemLabel` in `@object-ui/layout` resolves it; this validator
  // fills nothing in, so the parsed item keeps no `label` key. The rule above
  // still holds: identity is the target, text is inherited.
  if (typeof item.id !== 'string' || item.id === '') {
    ctx.addIssue({
      code: 'custom',
      path: ['id'],
      message: `\`id\` is required for navigation items of type '${item.type}'`,
    });
  }
  refuseEmptyNavLabel(item, ctx);

  // The spec's OWN target-exclusivity rule, CHAINED rather than restated
  // (objectui#8563). This schema is hand-written — it is not `.shape`-derived —
  // so no other mechanism carries the spec's checks across, and a local copy of
  // the rule body would drift the day the spec's own moves. `@objectstack/spec`
  // mounts this same function on the `type: 'object'` branch of ITS
  // `NavigationItemSchema`, so an item the spec door refuses is refused here too
  // instead of passing here and failing at publish.
  //
  // ⚠️ The rule is deliberately NOT pairwise-exclusive over the target fields,
  // and chaining is what keeps that from being re-derived wrongly from prose:
  // `recordId` + `viewName` is TOLERATED, and `runAction` is refused with
  // `recordId` ONLY — it composes with `viewName` or `filters`. Both asymmetries,
  // and the identity of the chained function, are pinned in
  // `../__tests__/nav-target-exclusivity-8563.test.ts`.
  if (item.type === 'object') {
    objectNavTargetExclusivity(item, ctx);
  }

  // The spec's own `visible`-reads-`data` rule, CHAINED for EVERY type
  // (objectui#13076, objectstack#24534): an entry whose `visible` reads `data`
  // must declare the `dataSource` that binds it. `@objectstack/spec` mounts this
  // function on its whole navigation union, not on one branch, so it is called
  // here outside the `object` branch above, and again on the `doc` arm below.
  // `visible` is handed over as authored: the function reads the bare string
  // and the `{ dialect, source }` envelope alike, and a boolean judges nothing.
  navItemVisibleDataNeedsDataSource(item, ctx);
});

/**
 * The spec's own `doc` arm (`DocNavItemSchema`, ADR-0046) as the walk above
 * reads it off `AppSchema`. Read once at module load: the `doc` arm below is
 * built from it. It throws when the spec has no such arm, because a `doc` arm
 * judged by nothing would accept every `doc` entry.
 */
function readSpecDocNavArm(): SpecNavNode & { shape: NonNullable<SpecNavNode['shape']> } {
  const arm = readSpecNavigationArm('doc');
  if (!arm) {
    throw new Error("objectui#11197: @objectstack/spec's AppSchema.navigation has no `type: 'doc'` arm to judge a doc entry by");
  }
  return arm;
}
const specDocNavArm = readSpecDocNavArm();

/**
 * The `doc` arm (objectui#11197) — a documentation entry: `{ type: 'doc', book }`
 * opens a book, `{ type: 'doc', doc }` opens one page, both opens that page in
 * that book's context.
 *
 * ⭐ It accepts NOTHING the spec's `doc` arm refuses, because that arm is the
 * JUDGE: every entry this arm parses is handed, whole, to the spec's own
 * `DocNavItemSchema`, and each issue it raises is raised here. So the target
 * rule (at least one of `book` / `doc`), the doc-name shape (a filename or a path
 * is refused), the non-empty `book`, the snake_case `id` and the closed key set
 * — `pinned`, `defaultOpen` and a sibling's target key included — are the spec's
 * words, not a restatement that drifts. Chained, never copied: the objectui#8563
 * posture this file already takes for `objectNavTargetExclusivity`.
 *
 * Why a SEPARATE arm, not a branch of the flat object above: that object strips
 * unknown keys before any refinement sees them, so an unknown key on a `doc`
 * entry would have been dropped here while the platform's save door refused it.
 * This arm passes unknown keys through to the judge instead, and only the judge
 * can refuse them — so nothing unknown survives a successful parse.
 *
 * The judge's OUTPUT is never used, only its verdict: the spec parse turns a
 * `visible` string into an expression envelope, and this validator does not
 * write values into an author's document (decision batches #69 / #90). The
 * parsed entry is this arm's own — the flat object's schemas for the base keys
 * the spec's arm spreads (so `label` is the spec's `I18nLabel` here as on every
 * sibling, and an empty string is refused the same way), and the spec arm's own
 * `book` / `doc` members for the two targets.
 *
 * The judge runs only on an entry whose keys already parsed, so one fault is
 * never reported twice.
 */
const NavigationDocItemObject = z.looseObject({
  ...Object.fromEntries(
    Object.keys(specDocNavArm.shape)
      .filter((key) => key !== 'type' && key in NavigationItemObject.shape)
      .map((key) => [key, NavigationItemObject.shape[key as keyof typeof NavigationItemObject.shape]]),
  ),
  type: z.literal('doc').describe('Navigation item type'),
  book: specDocNavArm.shape.book,
  doc: specDocNavArm.shape.doc,
}).superRefine((item, ctx) => {
  const verdict = specDocNavArm.safeParse(item);
  if (!verdict.success) {
    for (const issue of verdict.error.issues) ctx.addIssue({ ...issue, message: issue.message });
  }
  refuseEmptyNavLabel(item, ctx);
  // The judge above is the spec's `doc` ARM, which does not carry the rule the
  // spec mounts on its whole union, so it is chained here as on the flat arm
  // (objectui#13076).
  navItemVisibleDataNeedsDataSource(item, ctx);
}, { when: (payload) => payload.issues.length === 0 });

/**
 * Both arms, discriminated on `type`: `doc` goes to its own arm, every other
 * type to the flat object. An unknown `type` is refused at `type` with the
 * discriminator's own "expected one of" message — the spec's union answers it
 * the same way (`invalid_union` at `type`).
 */
const NavigationItemArms = z.discriminatedUnion('type', [NavigationItemObject, NavigationDocItemObject]);

export const NavigationItemSchema: z.ZodType<any> = z.lazy(() => NavigationItemArms);

/**
 * Navigation Area Schema — business-domain partition of navigation, DERIVED
 * from `@objectstack/spec/ui` (objectstack#4115).
 *
 * `icon` and `description` flow in **by reference** through
 * {@link specFieldsExcept}; `id` and `label` are taken from the spec's own
 * shape too, re-stated only to keep them required (the helper `.partial()`s
 * what it carries, deliberately, so a future spec field cannot become required
 * and invalidate stored objectui apps). `objectui validate` silently dropped
 * `order` and `description` until objectui#3088 — restating this shape by hand
 * is what let that happen.
 *
 * One key is pinned locally, matching the TS twin in `app.ts`:
 *  - `navigation` — objectui's `NavigationItemSchema`. ⚠️ The reason is NO LONGER
 *    "the spec's is `z.ZodType<any>` and would validate nothing". That was true
 *    when this was written and is false now: objectstack#4171 landed, and spec
 *    17.2.0 declares `NavigationItemSchema: z.ZodType<NavigationItem,
 *    NavigationItemInput>` — measured precise in the BUILT dist, not just in
 *    source (objectui#3162 batch 8).
 *
 *    What blocks the burn-down now is SHAPE, not precision. The spec models
 *    navigation as a discriminated union of `.strict()` variants; objectui keeps
 *    one flat, all-optional object that deliberately accepts more. Measured
 *    against spec 17.2.0, referencing the spec's schema would make `objectui
 *    validate` REJECT metadata this renderer accepts today: `pinned` and
 *    `defaultOpen` fail `unrecognized_keys`, `visible: boolean` fails
 *    `invalid_union`, and a one-character `id` fails `too_small`. (`visible`'s
 *    other arms are the spec's own `EvaluatedExpressionInputSchema` since
 *    objectui#13075, so its envelope and its blank-string refusal agree; only
 *    the boolean parts.) Pinned by
 *    `__tests__/navigation-spec-parity.test.ts`. (A separator carrying `label`
 *    was a fifth until objectui#10867, which made the mirror refuse it too.)
 *
 *    Converging on the union is a breaking change for every consumer that reads
 *    fields off `NavigationItem` without narrowing — tracked separately, and
 *    deliberately not smuggled into a ledger burn-down.
 *
 * `order`, `visible` and `requiredPermissions` were AREA-level keys until
 * `@objectstack/spec` 17.0.0 retired them (`AREA_VISIBLE_RETIRED` /
 * `AREA_REQUIRED_PERMISSIONS_RETIRED`): an area is a layout grouping, not an
 * access boundary, so gating belongs on the navigation ITEM (`visible` /
 * `requiredPermissions`, both still there) or on the app.
 *
 * Note the retirement's rationale ("an area carries no gate of its own") did
 * NOT hold here: `AppSchemaRenderer`'s area switcher filtered areas by
 * `visible` / `requiredPermissions`. That filter is gone and the gating moved
 * down to `NavigationRenderer` — see objectui#3311 for the premise mismatch.
 * Following the spec is still right: its area object is `.strict()`, so a
 * v17-valid app cannot carry these keys, and keeping them locally would have
 * meant accepting areas the platform rejects.
 *
 * Drift guard: `__tests__/page-nav-misc-spec-parity.test.ts`.
 */
export const NavigationAreaSchema = specFieldsExcept(stripImportedDefaults(SpecNavigationAreaSchema).shape, [
  'id',
  'label',
  'navigation',
] as const).extend({
  id: stripImportedDefaults(SpecNavigationAreaSchema).shape.id.describe('Unique identifier'),
  label: stripImportedDefaults(SpecNavigationAreaSchema).shape.label.describe('Display label'),
  navigation: z.array(NavigationItemSchema).describe('Navigation items within area'),
});

// ============================================================================
// Legacy MenuItem Schema (backward compat)
// ============================================================================

/**
 * Menu Item Schema - Navigation menu item
 * @deprecated Use NavigationItemSchema instead.
 *
 * INPUT FACE: both type arguments carry this mirror's existing TypeScript
 * declaration (objectui#7760, maintainer ruling, decision batch #69) — the annotation
 * still breaks the recursion in the initializer below, but it no longer publishes
 * `unknown` as what an author may write here. ⛔ Runtime accept set unchanged; ⛔ the
 * declaration unchanged. The reasoning lives once, on `SchemaNodeSchema` in
 * `base.zod.ts` — read it there before changing this line.
 */
export const MenuItemSchema: z.ZodType<AppMenuItem, AppMenuItem> = z.lazy(() => z.object({
  type: z.enum(['item', 'group', 'separator']).optional().describe('Item type'),
  label: z.string().optional().describe('Display label'),
  icon: z.string().optional().describe('Icon name (Lucide)'),
  path: z.string().optional().describe('Target path (route)'),
  href: z.string().optional().describe('External link'),
  children: z.array(MenuItemSchema).optional().describe('Child items (submenu)'),
  badge: z.union([z.string(), z.number()]).optional().describe('Badge or count'),
  hidden: z.union([z.boolean(), z.string()]).optional().describe('Visibility condition'),
  // REFUSED (objectui#7719, director seat decision batch #70 of 2026-09-07,
  // maintainer verbatim 「同意」). The ruling refused a `shortcut` member on this
  // deprecated type and changed the DIAGNOSTIC instead: an authored value used
  // to be stripped here in silence, and is refused by name now. It was taken on
  // the app action items (`AppAction.items`); objectui#7469 retired that array,
  // so `AppComponentSchema.menu` is where an author meets it now.
  //
  // WHY `retirementTombstone` and not `handlerKeyRefusal`: that helper's
  // message says JSON has no function value, which is false of a string-valued
  // key, and its `z.custom` primitive makes `z.toJSONSchema` THROW. Nor
  // `aliasKeyRefusal`, which would have to name a canonical sibling key; the
  // remedy here is a different TYPE. Pinned in
  // `../__tests__/app-menu-item-shortcut-refusal-7719.test.ts`.
  shortcut: retirementTombstone(
    'REFUSED (objectui#7719, director seat decision batch #70, 2026-09-07; ADR-0049) — `shortcut` '
    + 'is not authorable on a legacy `AppMenuItem` (an app\'s `menu` item), which is deprecated in '
    + 'favour of `NavigationItem`, and no renderer reads a shortcut here. Until this refusal an '
    + 'authored value was STRIPPED in silence by this mirror, which is the outcome the ruling '
    + 'closed; growing the deprecated type instead was refused. A keyboard shortcut on a '
    + 'navigation entry is a capability of the `NavigationItem` line: author the menu as '
    + '`NavigationItem`, and file the capability there if it is wanted.',
  ),
}));

// ============================================================================
// App Schema
// ============================================================================

/**
 * App Context Selector Schema — sidebar/topbar scope dropdown whose selected
 * value is injected into nav items as a `{<id>}` template var.
 *
 * DERIVED from `@objectstack/spec/ui` (objectstack#4115): every spec key
 * (`id`/`icon`/`optionsSource`/`includeAll`/`allValue`/`persist`/`placement`,
 * including its defaults) flows in **by reference**, so a key the spec adds or
 * retypes cannot silently diverge here. Before this derivation the local hand
 * copy was a full restatement carrying the spec's own symbol name.
 *
 * One pinned divergence, kept deliberately:
 *  - `label` is widened to accept objectui's i18n label envelope
 *    (`{ default, translations }` / any record) as well as the spec's plain
 *    string. `AppContextSelectors` (@object-ui/app-shell) renders it through
 *    `resolveI18nLabel`, so narrowing to the spec's `z.string()` would reject
 *    localized selectors the renderer already supports.
 *
 * Drift guard: `__tests__/report-chart-query-spec-parity.test.ts`.
 */
export const AppContextSelectorSchema = stripImportedDefaults(SpecAppContextSelectorSchema).extend({
  label: z.union([z.string(), z.record(z.string(), z.any())])
    .describe('Dropdown label — plain string or objectui i18n label envelope'),
});

/**
 * App Schema - Top-level application configuration
 */
/**
 * Spec-owned App fields, flowing in **by reference** (objectstack#4115).
 *
 * `BaseSchema` is `.passthrough()` while the spec's `AppSchema` is strict, so
 * before this derivation 23 spec-only keys rode through objectui completely
 * unvalidated — `branding`, `sharing`, `embed`, `objects`, `apis`,
 * `requiredPermissions`, `homePageId` (itself retired in spec 17.0.0),
 * `protection` and the whole
 * `_lock*`/`_package*`/`_provenance` package-lock envelope. A typo in any of
 * them (`brading: {…}`) was invisible, and a packaged app round-tripped
 * through this schema lost nothing only by luck.
 *
 * Omitted, each for a stated reason:
 *  - `name`/`label`/`description` — component-envelope keys owned by BaseSchema;
 *  - `navigation`/`areas`/`contextSelectors` — objectui's element schemas are
 *    their own ledger entries (they drift from the spec's on `badgeVariant`,
 *    `expanded`/`defaultOpen`, `visible` and target-field requiredness);
 *    migrating them is a separate, larger decision.
 *
 * `.partial()` guarantees no *future* spec field can become required and
 * silently invalidate stored objectui apps.
 */
export const APP_SPEC_EXCLUDED = [
  'name',
  'label',
  'description',
  'navigation',
  'areas',
  'contextSelectors',
] as const;

// One list, two readers (objectui#9736): this call and the `AppComponentSchema`
// TypeScript twin in `../app.ts`, which extends `Omit< App, … >` over the same
// array — so the published validator and the published type project one spec
// surface and cannot drift apart again.
const SpecAppFields = specFieldsExcept(stripImportedDefaults(SpecAppSchema).shape, APP_SPEC_EXCLUDED);

/**
 * The `actions` REFUSAL on the `app` node (objectui#7469, maintainer ruling C,
 * ADR-0049 enforce-or-remove) — the free-form header-button / user-menu array
 * and its `AppActionSchema` element are retired on both faces.
 *
 * Kept DECLARED and unwritable rather than deleted: `BaseSchema` is
 * `.passthrough()`, so a deleted arm would KEEP an authored array in silence
 * instead of refusing it. The platform's strict `@objectstack/spec` `AppSchema`
 * has never declared the key and refuses it too (`unrecognized_keys`), so the
 * two doors now give one answer. The remedy names the ONE channel the ruling
 * keeps for app-level actions — a `navigation` item of `type: 'action'` — with
 * a spec-valid spelling. The TS twin is `actions?: never` in `../app.ts`; the
 * pin is `../__tests__/app-actions-retired-7469.test.ts`.
 */
const APP_ACTIONS_REFUSAL =
  'RETIRED (objectui#7469, ADR-0049) — `actions` is not a key of the `app` node: the free-form '
  + 'header-button and user-menu array (`AppAction`) is retired, and the platform\'s `AppSchema` '
  + 'never declared it. App-level actions are `navigation` items of `type: \'action\'` that name a '
  + 'declared action — `navigation: [{ id: \'quick_create\', type: \'action\', label: \'Quick Create\', '
  + 'actionDef: { actionName: \'quick_create\' } }]`. The signed-in user\'s menu belongs to the host, '
  + 'not to app metadata.';

/**
 * The `mobileNavMode` REFUSAL on the app document (objectui#11363). The mode is
 * read in exactly two places, and the app document is neither: the
 * `mobileNavMode` prop of `AppSchemaRenderer` (`@object-ui/layout`), and the
 * `mobileNavMode` key of an `app-schema-renderer` node, which `SchemaRenderer`
 * hands to that component as the prop and `sdui-parser` checks against the
 * registration's enum. `@objectstack/spec`'s strict `AppSchema` refuses the key
 * (`unrecognized_keys`, with no alias), and `AppSchemaRenderer` never reads it
 * from `schema`, so before this arm `BaseSchema`'s `.passthrough()` kept it here
 * unread, a misspelt value included, and the shell drew no bottom bar.
 *
 * `retirementTombstone`, NOT the `aliasKeyRefusal` that `logo` / `favicon` use:
 * that helper composes "Did you mean `mobileNavMode` → CANONICAL?", and no member
 * of this document means a mobile navigation mode. The remedy is a different
 * channel, not a sibling spelling, so the alias sentence could only say
 * something untrue (the reasoning `MenuItemSchema.shortcut` records). Same
 * `z.never` primitive, same `invalid_type` at the key's own path. The guidance
 * opens with the sentence the spec answers this key with, so both doors lead
 * with one answer. The TS twin is `mobileNavMode?: never` in `../app.ts`; the
 * pin is `../__tests__/app-mobile-nav-mode-refusal-11363.test.ts`.
 */
const APP_MOBILE_NAV_MODE_REFUSAL =
  'Unrecognized key(s) on this app: `mobileNavMode`. The mobile navigation mode is not a key of the '
  + 'app document (objectui#11363): `@objectstack/spec`\'s `AppSchema` refuses it, and `AppSchemaRenderer` '
  + 'never reads it from the document. Set it where it is read: the `mobileNavMode` prop of '
  + '`AppSchemaRenderer` (`@object-ui/layout`), or the `mobileNavMode` key of an `app-schema-renderer` '
  + 'node, which `sdui-parser` checks against `\'drawer\'` | `\'bottom_nav\'`.';

/**
 * App Schema — the objectui app-shell renderer node, derived from
 * `@objectstack/spec/ui` `AppSchema` (see {@link SpecAppFields}). The drift
 * guard is `__tests__/page-app-dashboard-spec-parity.test.ts`.
 */
export const AppComponentSchema = BaseSchema.extend(SpecAppFields.shape).extend({
  type: z.literal('app'),
  name: z.string().optional().describe('Application name (system ID)'),
  title: z.string().optional().describe('Display title'),
  description: z.string().optional().describe('Application description'),
  // The app logo has ONE spelling, `branding.logo` (objectui#10827). A
  // top-level `logo` was an objectui-only second one: `@objectstack/spec`'s
  // `AppSchema` never declared it and its alias table answers it with "did you
  // mean `branding`?". Declared as a named refusal rather than deleted, because
  // `BaseSchema` is `.passthrough()`: a deleted arm would KEEP the key in
  // silence. The TS twin is `logo?: never` in `../app.ts`.
  logo: aliasKeyRefusal(
    'logo',
    'branding',
    'this app',
    'The app logo is `branding.logo`, the URL `@objectstack/spec`\'s `AppBrandingSchema` declares '
    + '(objectui#10827): write `branding: { logo: \'/logo.svg\' }`. The top-level `logo` was an '
    + 'objectui-only second spelling that the platform never accepted, and the console\'s mounted '
    + 'chrome reads only `branding.logo`. For an icon NAME, use `icon`.',
  ),
  // The favicon has ONE spelling too, `branding.favicon` (objectui#10842, the
  // objectui#10827 rule). `@objectstack/spec`'s `AppSchema` refuses a top-level
  // `favicon` (`unrecognized_keys`). A named refusal for the same
  // `.passthrough()` reason as `logo`; the TS twin is `favicon?: never`.
  favicon: aliasKeyRefusal(
    'favicon',
    'branding',
    'this app',
    'The app favicon is `branding.favicon`, the URL `@objectstack/spec`\'s `AppBrandingSchema` declares '
    + '(objectui#10842): write `branding: { favicon: \'/favicon.ico\' }`. The top-level `favicon` was an '
    + 'objectui-only second spelling that the platform refuses, and the console reads only `branding.favicon`.',
  ),
  // Not a key of the app document; the reason and the remedy are on
  // `APP_MOBILE_NAV_MODE_REFUSAL` above.
  mobileNavMode: retirementTombstone(APP_MOBILE_NAV_MODE_REFUSAL),
  layout: z.enum(['sidebar', 'header', 'empty']).optional().describe('Global layout strategy'),
  menu: z.array(MenuItemSchema).optional().describe('Legacy navigation menu (deprecated, use navigation)'),
  navigation: z.array(NavigationItemSchema).optional().describe('Unified navigation tree'),
  areas: z.array(NavigationAreaSchema).optional().describe('Navigation areas (business-domain partitions)'),
  contextSelectors: z.array(AppContextSelectorSchema).optional().describe('App-level scope dropdowns injected into nav items as {<id>} vars'),
  actions: retirementTombstone(APP_ACTIONS_REFUSAL),
});

/**
 * objectui#11440 — ONE refusal string for both content channels of
 * {@link AppSchemaRendererNodeSchema}. The registration declares
 * `isContainer: true`, but the parser tier's containment check reads the
 * `children` INPUT, never `isContainer` (objectui#9910), and the registration
 * declares no such input, so the `not-a-container` clause holds here too.
 */
const APP_SCHEMA_RENDERER_NEITHER_CHANNEL =
  'REFUSED (objectui#9256, ADR-0049) — `app-schema-renderer` reads NEITHER content channel: `SchemaRenderer` '
  + 'strips `children` and `body` out of the props it hands `AppSchemaRenderer`, and the component reads no '
  + '`schema.children` / `schema.body`. Measured through the real `SchemaRenderer` and registry (objectui#11440): '
  + 'a node carrying `children` drew none of them. An authored value therefore rendered NOTHING — no render-time '
  + 'error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it '
  + '(the registration declares no `children` input). What it renders instead: the shell — its sidebar and, with '
  + '`mobileNavMode: \'bottom_nav\'`, the bottom bar — around an empty main area. Page content reaches the shell '
  + 'only as React `children`, when a host renders `AppSchemaRenderer` itself.';

/**
 * `app-schema-renderer` — the whole-shell node `@object-ui/layout` registers
 * (objectui#11440, under the seat's amendment `5945583855` on objectui#10859:
 * "declaring the node from its registration inputs").
 *
 * ## The defect this closes
 *
 * objectui#4841's ruling (`5307574602`) keeps `app-schema-renderer` "the one
 * JSON door for 'render a whole shell from a schema'", and the governed guide
 * `skills/objectui/guides/mobile.md` teaches the `mobileNavMode` key of this
 * node (as does {@link APP_MOBILE_NAV_MODE_REFUSAL} above). No arm claimed the
 * literal, so `objectui validate` refused that node with `invalid_union` at
 * `type`.
 *
 * ## The members
 *
 * The registration declares three `inputs`: `schema` (object), `basePath`
 * (string) and `mobileNavMode` (the enum `'drawer'` | `'bottom_nav'`). All
 * three are declared here:
 *  - `schema` — the app document the shell draws, as {@link AppComponentSchema}
 *    itself, by reference (objectui#11494, triage ruling A `5958227972`).
 *  - `mobileNavMode` — the two modes the renderer implements; `'bottom_nav'`
 *    adds the fixed bottom bar.
 *  - `basePath` — the prefix of every href the shell generates.
 *
 * ## `schema` is the document, nested: one spelling (objectui#11494)
 *
 * `SchemaRenderer` strips the `schema` key out of the props it spreads and
 * hands every registered component the NODE as its `schema` prop. Registered
 * directly, `AppSchemaRenderer` therefore read the document's keys off the node
 * itself, and objectui#11440 measured through the real `SchemaRenderer` and
 * registry that a node with its navigation nested under `schema` drew none of
 * it. `@object-ui/layout` now registers the node through an adapter that hands
 * `node.schema` to `AppSchemaRenderer`, so the nested document is what draws.
 *
 * The member is `AppComponentSchema` and not a copy of its members, so the
 * document keeps its own refusals here: `mobileNavMode` inside `schema` is
 * refused by {@link APP_MOBILE_NAV_MODE_REFUSAL}, while the same key on the node
 * is the mode. The document is the `app` document, so its `type` is `'app'`.
 * The document's keys written flat on the node are not declared, so the strict
 * face refuses them as unrecognized keys, and the adapter does not read them:
 * the document has one spelling. The member is optional, as the registration's
 * input is: a node without it draws the shell with no document (no branding,
 * no navigation), which is what the mobile guide's node draws.
 *
 * Neither content channel is read (see
 * {@link APP_SCHEMA_RENDERER_NEITHER_CHANNEL}), so both are refused by name.
 */
export const AppSchemaRendererNodeSchema: AppSchemaRendererNodeSchemaType = BaseSchema.extend({
  type: z.literal('app-schema-renderer'),
  schema: AppComponentSchema.optional().describe(
    'The app document the shell draws (branding, `navigation`, `areas`), nested: `{ "type": "app", ... }`',
  ),
  basePath: z.string().optional().describe('URL prefix for the hrefs the shell generates (e.g. "/apps/crm")'),
  mobileNavMode: z
    .enum(['drawer', 'bottom_nav'])
    .optional()
    .describe(
      'Mobile navigation mode: "drawer" (the default) puts the sidebar in the mobile sheet overlay; "bottom_nav" '
      + 'additionally renders a fixed bottom bar. These are the only two modes the renderer implements.',
    ),
  body: retirementTombstone(APP_SCHEMA_RENDERER_NEITHER_CHANNEL),
  children: retirementTombstone(APP_SCHEMA_RENDERER_NEITHER_CHANNEL),
});

/**
 * The TYPE of {@link AppSchemaRendererNodeSchema}, written out BY REFERENCE to
 * {@link AppComponentSchema} for its `schema` member, on the precedent of
 * `PageKindNodeSchemaType` in `layout.zod.ts` (objectui#11440). Without it,
 * declaration emit re-serializes the whole app document a second time inside
 * `AnyComponentSchema`, beside the `app` arm, and `tsc` refuses that union with
 * TS7056 ("The inferred type of this node exceeds the maximum length the
 * compiler will serialize"), measured on objectui#11494 against
 * `@objectstack/spec` built from objectstack `main` (the `Spec Main Shape
 * Gate`). A named type is emitted by name. It is a type only: the schema above
 * and what it accepts are unchanged.
 */
export type AppSchemaRendererNodeSchemaType = z.ZodObject<
  Omit<(typeof BaseSchema)['shape'], 'type' | 'body' | 'children'> & {
    type: z.ZodLiteral<'app-schema-renderer'>;
    schema: z.ZodOptional<typeof AppComponentSchema>;
    basePath: z.ZodOptional<z.ZodString>;
    mobileNavMode: z.ZodOptional<z.ZodEnum<{ drawer: 'drawer'; bottom_nav: 'bottom_nav' }>>;
    body: ReturnType<typeof retirementTombstone>;
    children: ReturnType<typeof retirementTombstone>;
  },
  z.core.$loose
>;

/**
 * Export type inference helpers
 */
export type NavigationItemSchemaType = z.infer<typeof NavigationItemSchema>;
export type NavigationAreaSchemaType = z.infer<typeof NavigationAreaSchema>;
export type MenuItemSchemaType = z.infer<typeof MenuItemSchema>;
export type AppSchemaType = z.infer<typeof AppComponentSchema>;
