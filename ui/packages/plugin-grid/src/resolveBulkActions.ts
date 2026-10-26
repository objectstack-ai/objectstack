/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Resolve a list view's `bulkActions: string[]` against the object's declared
 * actions, folding each resolvable name into the rich `BulkActionDef` list the
 * selection bar renders.
 *
 * This is the selection-scoped twin of {@link resolveLegacyRowActions}
 * (objectui#2960 / #2996), and it closes the same `{type: <name>}` dead end on
 * the bulk path (objectui#3002): dispatching `bulkActions: ['push_down']` put
 * the action's NAME in the runner's `type` slot, which resolves to nothing —
 * zero requests, and (since #2996) a loud failure instead of a green toast.
 *
 * ## Where a bulk action is declared
 *
 * **In the VIEW's `bulkActions`, naming an action the object declares.** That
 * is the whole vocabulary. `ActionSchema.bulkEnabled` looked like an
 * object-level alternative and this module briefly derived from it, but spec
 * 17.0.0 retired the key (objectstack-ai/objectstack#3896 close-out / framework#4054) — it is now a
 * `retiredKey()` tombstone, so authoring it is a HARD parse rejection whose
 * own prescription is: *"the multi-select toolbar is driven by the LIST VIEW's
 * `bulkActions` / `bulkActionDefs`, never by this flag … declare the action in
 * the view's `bulkActions` instead."* Do not reintroduce a `bulkEnabled` read
 * here: `defineStack` refuses to compile a config that sets it, so the branch
 * can never run.
 *
 * `locations` stays orthogonal — it places an action's SINGLE-record entry
 * (toolbar / row kebab / record header). One action can be both: declared
 * `locations: ['list_item']` AND named in `bulkActions`, it runs on one row
 * from the kebab and on N rows from the selection bar.
 *
 * ## Two vocabularies reach the selection bar
 *
 *  1. `bulkActionDefs` — rich defs authored inline in the view JSON. Left
 *     as-authored, with ONE narrowly-scoped exception: a def carrying
 *     `execution: 'aggregate'` and no inline `actionDef` resolves its `name`
 *     against `objectDef.actions` and gets the matched action attached (see
 *     below). They own their names and win every collision either way.
 *  2. `bulkActions: string[]` — bare action names, resolved against
 *     `objectDef.actions` and PROMOTED to that def, so they carry the action's
 *     label, icon, `visible` predicate, `requiredPermissions` gate, confirm text
 *     and params instead of a bare humanized name. The bare-string form always promotes to the
 *     per-record dispatch — it has nowhere to carry an `execution` flag, so
 *     aggregate mode (objectui#3139) requires the authored-def form above.
 *
 * ## A promoted def's params are its ACTION's, resolved when its dialog opens
 *
 * A promoted def carries no `params` of its own out of this fold. Its params
 * are the source action's (`actionDef.params`, spec `ActionParamSchema`), and
 * {@link resolvePromotedBulkParams} resolves them at DISPATCH time through
 * `resolveActionParam` — the one resolver the single-record dialog uses, which
 * lives in `@object-ui/fields` so this package can reach it (objectui#12105).
 * That is what lets a field-backed param (`{ field, objectOverride }`) inherit
 * its type, label, options and picker target from the field definition here
 * exactly as it does on the record page.
 *
 * Until objectui#12105 this module mapped those params by hand (`toBulkParam`
 * renamed `field` onto `name`, defaulted `type` to `'text'`, and read `object`
 * only off an inline `reference`), so every field-backed param drew a raw text
 * box on the selection bar and the confirm step listed raw ids. Resolving at
 * dispatch rather than here, during render, mirrors the record path's timing
 * too: the grid awaits the session's object metadata first, so an
 * `objectOverride` target that has not loaded yet is a wait, not a refusal.
 *
 * A promoted def carries `operation: 'custom'` plus the source action under
 * {@link BulkActionDef.actionDef}: it is NOT a data-plane mass update, it is
 * one action run over N records through the action runner. `useBulkExecutor`
 * routes on exactly that key — a `custom` def WITHOUT `actionDef` keeps its
 * historical no-op-per-row meaning (callout handled by the consumer's
 * `onComplete`).
 *
 * Names that resolve to nothing stay in `unresolved` and are still dispatched
 * by name: consumers may have registered a runner handler under exactly that
 * name (`runner.registerHandler('my_action', …)`), and that path must keep
 * working. When no such handler exists the runner reports the dead end rather
 * than toasting success (#2996).
 */

import type { BulkActionDef, BulkActionParam } from '@object-ui/types';
import type { ActionParamDef } from '@object-ui/core';
// The ONE action-param resolver, shared with app-shell's single-record dialog
// (objectui#12105). ⛔ Never re-implement any of its field lookup here.
import {
  resolveActionParams,
  type RawActionParam,
  type ResolveActionParamsContext,
} from '@object-ui/fields';
// One authority for `NamedActionDef` (objectui#6349): `resolveLegacyRowActions.ts`
// declares the `ActionDef` subset both folds read, and this module re-exports
// it so the name stays reachable from here exactly as before. A re-export, not
// a second declaration — the one-authority gate counts declarations only.
import type { NamedActionDef } from './resolveLegacyRowActions';
export type { NamedActionDef } from './resolveLegacyRowActions';

/**
 * Concurrency for a promoted action's per-record fan-out. Well below the
 * `BulkActionDef` default (200) because each record here is a distinct runner
 * dispatch — typically an HTTP call to a custom endpoint or a flow run, not a
 * single batched data-API write. 200 in flight would be a thundering herd
 * against an endpoint that never opted into bulk traffic.
 */
export const PROMOTED_BULK_BATCH_SIZE = 25;

/** Action `variant`s that have no `BulkActionDef` counterpart are dropped. */
const BULK_VARIANTS = new Set(['primary', 'secondary', 'danger', 'ghost']);

/**
 * The plugin-grid-local hand-off key a promoted param carries when the shared
 * resolver could NOT find its backing field (`ActionParamDef.unresolvedField`,
 * `<object>.<field>`). Written only by {@link toBulkParam} and read only by
 * `BulkActionDialog`, which refuses the param on it exactly as the
 * single-record dialog does, instead of drawing an input from the placeholder
 * type the resolver fell back to.
 *
 * Deliberately NOT a declared `BulkActionParam` member: that interface is also
 * the AUTHORING face of `bulkActionDefs[].params`, and a key only the host
 * writes at runtime does not belong there (AGENTS.md #0.1). It rides the
 * interface's catch-all, and {@link unresolvedFieldOf} is its one reader.
 */
const UNRESOLVED_FIELD_KEY = 'unresolvedField';

/** The `<object>.<field>` a promoted param could not be resolved against, if any. */
export function unresolvedFieldOf(param: BulkActionParam): string | undefined {
  const value = param[UNRESOLVED_FIELD_KEY];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Map ONE resolved param onto the bulk dialog's `BulkActionParam` vocabulary.
 *
 * The input is the shared resolver's output, never the authored param: the
 * field lookup, the label (i18n via `fieldLabel`, inline per-locale maps via
 * `locale`), the option labels and the picker target were all settled there.
 * This function only RENAMES onto the bulk spelling — `helpText` → `help`,
 * `defaultValue` → `default`, `referenceTo` → `object`, `displayField` →
 * `labelField` — and carries `dependsOn`, which the bulk param declares.
 * `accept` / `maxSize` ride along because the file widgets read them and a
 * promoted param always delivered them (the hand-mapper spread the raw param).
 *
 * The rest of the resolved picker config (`descriptionField`, `lookupColumns`,
 * `lookupFilters`, …) is NOT forwarded: the bulk adapter (`bulkParamToField`)
 * has no rename for those widget keys, and growing one is a convergence of the
 * two param adapters, not this card. Named in objectui#12105's PR.
 *
 * Collecting the values ONCE in the bulk dialog is the whole point, so the
 * runner must not be handed the param defs again (it would re-prompt per
 * record) — see `stripCollectedActionKeys` in `ObjectGrid`.
 */
function toBulkParam(resolved: ActionParamDef): BulkActionParam | null {
  // An inline param with neither `name` nor `field` resolves to `name: ''`: it
  // has no body key to collect a value under, so it is not offered.
  if (!resolved.name) return null;
  return {
    name: resolved.name,
    label: resolved.label,
    type: resolved.type,
    ...(resolved.required !== undefined && { required: resolved.required }),
    ...(resolved.helpText !== undefined && { help: resolved.helpText }),
    ...(resolved.defaultValue !== undefined && { default: resolved.defaultValue }),
    ...(resolved.options !== undefined && { options: resolved.options }),
    ...(resolved.placeholder !== undefined && { placeholder: resolved.placeholder }),
    ...(resolved.multiple !== undefined && { multiple: resolved.multiple }),
    ...(resolved.referenceTo !== undefined && { object: resolved.referenceTo }),
    ...(resolved.displayField !== undefined && { labelField: resolved.displayField }),
    ...(resolved.dependsOn !== undefined && { dependsOn: resolved.dependsOn }),
    ...(resolved.accept !== undefined && { accept: resolved.accept }),
    ...(resolved.maxSize !== undefined && { maxSize: resolved.maxSize }),
    ...(resolved.unresolvedField !== undefined && { [UNRESOLVED_FIELD_KEY]: resolved.unresolvedField }),
  };
}

/**
 * Resolve a promoted def's params for its dialog, through the ONE resolver
 * (objectui#12105). Called by `ObjectGrid` when the user opens the def, after
 * it has asked the session for its object metadata — the single-record
 * dialog's order exactly (`useConsoleActionRuntime`'s param handler).
 *
 * Returned unchanged (by reference):
 *  - an authored def with no attached action — its `params` are already in the
 *    bulk vocabulary and are used as authored;
 *  - a def whose author wrote `params` itself (an `execution: 'aggregate'` def
 *    naming an action): authored keys win every collision, as they do in the
 *    fold below;
 *  - an action that declares no params.
 *
 * `ctx` is the resolver's own context, unchanged: the owning object
 * (`objectName`), every object known to the caller (`objects` — union the
 * grid's own schema with the session's via `withKnownObjects`, caller first),
 * and the label translators.
 */
export function resolvePromotedBulkParams(
  def: BulkActionDef,
  ctx: ResolveActionParamsContext,
): BulkActionDef {
  const source = def.actionDef;
  if (!source || Array.isArray(def.params)) return def;
  const declared = Array.isArray(source.params) ? source.params : [];
  const raw = declared.filter(
    (p): p is RawActionParam => !!p && typeof p === 'object',
  );
  if (raw.length === 0) return def;
  const params = resolveActionParams(raw, ctx)
    .map(toBulkParam)
    .filter((p): p is BulkActionParam => p !== null);
  return params.length > 0 ? { ...def, params } : def;
}

/** Resolves an action's display label through the app's i18n bundle. */
export type ActionLabelResolver = (actionName: string, fallback: string) => string;

/** Build the selection-bar def for an object action. */
function toBulkActionDef(action: NamedActionDef, localize?: ActionLabelResolver): BulkActionDef {
  const name = String(action.name);
  // No `params` here: the action's params are resolved when its dialog opens
  // (`resolvePromotedBulkParams`, objectui#12105) — see the module header.
  const variant = typeof action.variant === 'string' && BULK_VARIANTS.has(action.variant)
    ? (action.variant as BulkActionDef['variant'])
    : undefined;
  // `confirmText` only. The structured `confirm.message` fallback that used to
  // sit here is retired (objectui#4314): spec's action surface carries no
  // structured confirm, so the branch read a key `objectDef.actions` can never
  // deliver — and tolerating it kept a second confirm dialect alive (#0.1).
  const confirmText = typeof action.confirmText === 'string' ? action.confirmText : undefined;
  // A non-string `I18nLabel` (the `{ en, zh }` map form) is dropped rather than
  // forwarded: the bar renders `def.label` as a React child, so an object here
  // would take the page down. Falling through to `formatActionLabel(name)`
  // matches how the grid treats a non-string column label.
  const rawLabel = typeof action.label === 'string' ? action.label : undefined;
  const label = localize ? localize(name, rawLabel ?? name) : rawLabel;

  return {
    name,
    ...(label !== undefined && { label }),
    ...(typeof action.icon === 'string' && { icon: action.icon }),
    ...(variant && { variant }),
    // Not an `update`/`delete` mass mutation — the source action owns what it
    // does. `actionDef` below is what makes this run (see useBulkExecutor).
    operation: 'custom',
    ...(confirmText !== undefined && { confirmText }),
    ...(action.visible != null && { visible: action.visible as BulkActionDef['visible'] }),
    // [ADR-0066 D4 / objectui#3492] The capability gate travels with the action.
    // Dropping it here is what let a `requiredPermissions` action that the row
    // kebab hides reappear in the selection bar: the bar has no other route to
    // the declaration, since it renders defs, not `ActionDef`s.
    ...(Array.isArray(action.requiredPermissions) && {
      requiredPermissions: action.requiredPermissions as string[],
    }),
    batchSize: PROMOTED_BULK_BATCH_SIZE,
    actionDef: action,
  };
}

/**
 * Is this authored `bulkActionDefs` member a def the selection bar can render?
 *
 * "Usable" is defined by WHAT THE RENDERER READS, not by a fresh opinion about
 * what a def ought to carry: `BulkActionBar` uses `def.name` twice — as the
 * React `key` of the button it maps to, and as the argument to
 * `formatActionLabel` when the def declares no `label`. A member without a
 * non-empty string `name` therefore has no identity and no label, and
 * `formatActionLabel(undefined)` threw `TypeError: Cannot read properties of
 * undefined (reading 'replace')` DURING RENDER — taking the whole selection bar
 * down on the author's first multi-row selection (objectui#8730).
 *
 * Every other `BulkActionDef` key is optional at the read site (an absent
 * `operation` falls through to the button's default treatment, an absent
 * `visible` means ungated), so `name` is the whole predicate. It covers the
 * reported bare string and, by the same test, `null`, a number, `{}` and
 * `{ name: '' }`.
 *
 * ⛔ NOT a coercion. A bare `'approve'` is NOT lifted into `{ name: 'approve' }`
 * and resolved the way `bulkActions` is: that would make the two vocabularies
 * interchangeable, which is a product change to what a `bulkActionDefs` member
 * MEANS (objectui#3002 / objectui#3139 established them as two vocabularies
 * deliberately), not a crash fix. The member is skipped, and said out loud.
 */
export function isUsableBulkActionDef(member: unknown): member is BulkActionDef {
  if (!member || typeof member !== 'object') return false;
  const name = (member as { name?: unknown }).name;
  return typeof name === 'string' && name.length > 0;
}

/** Where the offending block lives, for the first line of the message. */
export interface BulkActionDefsAddress {
  /** The schema node's `type` — `object-grid`, or the `view:grid` alias. */
  blockType?: unknown;
  /** The object the grid queries, when it names one. */
  objectName?: unknown;
  /** The grid's authored label, when it has one — often the only human name. */
  label?: unknown;
}

function quote(value: unknown): string {
  return typeof value === 'string' ? `'${value}'` : String(value);
}

function describeAddress({ blockType, objectName, label }: BulkActionDefsAddress): string {
  const block = typeof blockType === 'string' && blockType.length > 0 ? blockType : 'object-grid';
  const parts: string[] = [];
  if (typeof objectName === 'string' && objectName.length > 0) parts.push(`objectName: '${objectName}'`);
  else parts.push('no objectName');
  if (typeof label === 'string' && label.length > 0) parts.push(`label: '${label}'`);
  return `${block} (${parts.join(', ')})`;
}

/**
 * Describe ONE skipped member: what it spells, and what to write instead.
 *
 * Each branch reports only what it checked. The string arm carries the extra
 * sentence because a bare action name is not nonsense — it is the OTHER key's
 * vocabulary, and naming that key is the whole fix for the author.
 */
function describeMember(member: unknown): string {
  if (member === null || member === undefined) {
    return `the entry is ${String(member)}, not a def object`;
  }
  if (typeof member !== 'object') {
    const rewrite = typeof member === 'string' && member.length > 0
      ? ` Write \`{ name: '${member}', operation: 'custom' }\` here, or move the bare name to `
        + '`bulkActions`, which resolves it against the object\'s declared actions and promotes the match.'
      : '';
    return `the entry is a ${typeof member} (${quote(member)}), not a def object — this key's `
      + `members are full \`BulkActionDef\` objects, used as authored.${rewrite}`;
  }
  const entry = member as Record<string, unknown>;
  const keys = Object.keys(entry);
  const seen = keys.length > 0
    ? `keys seen: ${keys.map((k) => `\`${k}\``).join(', ')}`
    : 'the entry is empty `{}`';
  if (!('name' in entry)) {
    return `${seen} — no \`name\` key, so the def has no identity.`;
  }
  const name = entry.name;
  if (typeof name !== 'string') {
    return `${seen} — \`name\` is a ${name === null ? 'null' : typeof name} (${quote(name)}), `
      + 'and only a non-empty string names an action.';
  }
  return `${seen} — \`name\` is an empty string, so the button would carry no key and no label.`;
}

/**
 * The message for a `bulkActionDefs` array carrying members the bar cannot
 * render, or `null` when every authored member is usable.
 *
 * Naming the ADDRESS is the whole point: which block, which object, which
 * index, what was seen, and what to write instead. A message that only said
 * something went wrong would leave the author exactly where the crash did.
 *
 * The channel is `ObjectGrid`'s existing one for "you declared it, the renderer
 * dropped it" — a `useEffect` keyed on the schema slice and one `console.warn`
 * prefixed `[ObjectUI] ObjectGrid <topic>:`, the same shape as the columns
 * diagnostic and the export-format warning, rather than a third differently
 * shaped one beside them.
 */
export function describeUnusableBulkActionDefs(
  members: unknown,
  address: BulkActionDefsAddress,
): string | null {
  if (!Array.isArray(members) || members.length === 0) return null;
  const skipped = members
    .map((member, index) => ({ index, member }))
    .filter(({ member }) => !isUsableBulkActionDef(member));
  if (skipped.length === 0) return null;

  const survivors = members.length - skipped.length;
  const subject = `${skipped.length} of ${members.length} authored bulk-action `
    + `def${members.length === 1 ? '' : 's'} cannot be rendered and `
    + `${skipped.length === 1 ? 'is' : 'are'} skipped`;
  const headline = survivors === 0
    ? `${subject}, so this selection bar offers NO bulk-action buttons`
    : `${subject} (${survivors} still render)`;
  const lines = skipped.map(({ index, member }) => `  • bulkActionDefs[${index}]: ${describeMember(member)}`);

  return `[ObjectUI] ObjectGrid bulkActionDefs: ${describeAddress(address)} — ${headline}.\n`
    + `${lines.join('\n')}\n`
    + '  A `bulkActionDefs` member must be an object with a non-empty string `name`: the selection '
    + 'bar uses it as the button\'s React key AND as the source of its label.';
}

export function resolveBulkActions(opts: {
  /**
   * The view's `bulkActions` names, already stripped of the canonical
   * `'delete'` entry (it routes to the grid's `onBulkDelete`, not the runner —
   * same carve-out the row fold makes for `'edit'` / `'delete'`).
   */
  bulkActions?: readonly string[] | null;
  /** Rich defs authored inline in the view/list JSON. */
  bulkActionDefs?: readonly BulkActionDef[] | null;
  /** Every action declared on the object (`objectDef.actions`). */
  objectActions?: readonly NamedActionDef[] | null;
  /**
   * Resolves a promoted def's label through the app's i18n bundle, so a bulk
   * action reads the same in the selection bar as its row entry does in the
   * kebab. Omit to use the authored label verbatim.
   */
  localizeLabel?: ActionLabelResolver;
}): {
  /**
   * Authored defs, then the promoted names in `bulkActions` order. Returned by
   * REFERENCE when nothing was promoted, so a view with no names to fold keeps
   * its identity across renders.
   */
  defs: readonly BulkActionDef[];
  /** Names that matched no declared action; dispatched by name. */
  unresolved: string[];
} {
  // [objectui#8730] THE GUARD SITE. This is the one place where the authored
  // `bulkActionDefs` array becomes the list the selection bar maps over, so the
  // React `key` and the label are read off the SAME validated def. A member the
  // bar cannot render is dropped here rather than refused, coerced, or defended
  // against again downstream — `BulkActionBar` keeps reading `def.name`
  // unconditionally, because by this line it can.
  //
  // Referential identity is preserved when nothing is dropped (`every` before
  // `filter`): the `defs` contract below promises the authored array BY
  // REFERENCE when nothing folds in, and an always-allocating filter would
  // break that for every clean view — see `resolveBulkActions.test.ts`'s
  // "returns the authored array by reference when nothing folds in".
  const authoredMembers = Array.isArray(opts.bulkActionDefs) ? opts.bulkActionDefs : [];
  const rawAuthored = authoredMembers.every(isUsableBulkActionDef)
    ? authoredMembers
    : authoredMembers.filter(isUsableBulkActionDef);
  const names = Array.isArray(opts.bulkActions) ? opts.bulkActions : [];
  const objectActions = Array.isArray(opts.objectActions) ? opts.objectActions : [];

  // [#3139] An authored def opting into the aggregate dispatch usually just
  // NAMES a declared object action (`{ name, operation: 'custom', execution:
  // 'aggregate' }`) instead of duplicating it inline. Resolve that name and
  // attach the action as `actionDef` — merged so authored keys win — because
  // `useBulkExecutor` dispatches nothing without one. Scoping the merge to an
  // EXPLICIT `execution: 'aggregate'` (with no inline `actionDef`) is what
  // keeps it safe: a plain authored `custom` def that happens to share a name
  // with an object action keeps its historical no-op/callout meaning. The
  // promoted `batchSize` is dropped — an aggregate run is one call by
  // contract, never chunked.
  const wantsAggregateResolve = (def: BulkActionDef | undefined | null): boolean =>
    !!def
    && def.execution === 'aggregate'
    && def.operation === 'custom'
    && !def.actionDef
    && typeof def.name === 'string'
    && def.name !== '';
  // Mapped only when at least one def qualifies, so the common case keeps the
  // authored array's referential identity (see the `defs` return doc).
  const authored = rawAuthored.some(wantsAggregateResolve)
    ? rawAuthored.map((def) => {
        if (!wantsAggregateResolve(def)) return def;
        const match = objectActions.find(a => a?.name === def.name);
        if (!match) return def;
        const { batchSize: _batchSize, ...promoted } = toBulkActionDef(match, opts.localizeLabel);
        return { ...promoted, ...def };
      })
    : rawAuthored;

  const claimed = new Set(
    authored.map(d => d?.name).filter((n): n is string => typeof n === 'string' && n !== ''),
  );

  const promoted: BulkActionDef[] = [];
  const unresolved: string[] = [];
  for (const name of names) {
    if (typeof name !== 'string' || name === '') continue;
    // Already surfaced (an authored def of the same name, or an earlier pass
    // over a repeated entry) — drop the duplicate rather than render a twin.
    // Both outcomes claim the name: the bar keys its buttons on it, so even
    // two dead-name entries would collide.
    if (claimed.has(name)) continue;
    claimed.add(name);
    const match = objectActions.find(a => a?.name === name);
    if (match) {
      promoted.push(toBulkActionDef(match, opts.localizeLabel));
    } else {
      unresolved.push(name);
    }
  }

  return {
    defs: promoted.length > 0 ? [...authored, ...promoted] : authored,
    unresolved,
  };
}
