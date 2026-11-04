// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The top-level helpers of `conversions/registry.ts` that two
// or more conversions read, moved out whole by
// `scripts/codemod-split-conversions-registry.mjs` (lever (b) of ruling
// 6591753301).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor any conversion's module, so it is evaluated
// before every conversion that reads it.

import type { ConversionApplication } from '../types.js';
import {
  mapCollection,
  mapFlowNodes,
  mapPageComponents,
  mapPages,
  mapViewPayloads,
  renameConfigKey,
  renameKey,
} from '../walk.js';

/** Rename a visibility alias key on a dict, emitting with the given path. */
function renameVisibilityAlias(
  dict: Record<string, unknown>,
  alias: string,
  path: string,
  emit: (detail: { from: string; to: string; path: string }) => void,
): Record<string, unknown> {
  const renamed = renameKey(dict, alias, 'visibleWhen');
  if (!renamed) return dict;
  emit({ from: alias, to: 'visibleWhen', path: `${path}.visibleWhen` });
  return renamed;
}

/* ── Protocol 17: the three fold-and-drop aliases retire (#3855) ───────────────
 *
 * `execute`, `conditionalRequired` and `topics` were each folded into their
 * canonical key by a schema transform and dropped from the parsed output. They
 * are now removed from the spec outright, and each schema TOMBSTONES its key
 * with a fix-it error (`retiredKey`, `shared/retired-key.ts`) so the loader
 * cannot quietly accept it — the same shape the retired
 * `object-compactLayout-to-highlightFields` conversion had (a ≤16.x kit,
 * removed with its region on #25767).
 *
 * All three are therefore `retiredFromLoadPath: true` from the day they land:
 * there is no alias window, deliberately. What the entries buy is the two
 * things a consumer actually needs, neither of which is an error message:
 *
 *   - they appear in `CONVERSIONS_BY_MAJOR[17]`, so `spec-changes.json` (D4)
 *     carries them — and the generated upgrade guide and the `spec_changes` MCP
 *     tool are projections of that record, composed across however many majors
 *     the consumer is jumping;
 *   - the step-17 chain entry references them by id, so
 *     `os migrate meta --from 16` REWRITES the consumer's source mechanically
 *     instead of asking them to hand-edit.
 *
 * The tombstone error is the backstop for someone who did neither, and it says
 * so by pointing at `migrate meta`.
 */

// `Dict` / `isDict` are module-private in `walk.ts`. Re-declared locally rather
// than widening that module's exports, which would grow the package API surface
// for an internal one-line type guard.
type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);
type Emit = (detail: ConversionApplication) => void;

/** Rename each `[from, to]` config pair on flow nodes of the given types. */
function renameFlowConfigAliases(
  stack: Dict,
  nodeTypes: ReadonlySet<string>,
  pairs: ReadonlyArray<readonly [string, string]>,
  emit: Emit,
): Dict {
  return mapFlowNodes(stack, (node, path) => {
    if (typeof node.type !== 'string' || !nodeTypes.has(node.type)) return node;
    let next = node;
    for (const [from, to] of pairs) {
      const renamed = renameConfigKey(next, from, to);
      if (!renamed) continue;
      emit({ from, to, path: `${path}.config.${to}` });
      next = renamed;
    }
    return next;
  });
}

/**
 * ⛔ WITHDRAWN — there is deliberately NO `field-required-notnull-explicit`
 * conversion in this registry, and re-adding one is the mistake this comment
 * exists to stop (#16693; maintainer ruling, decision batch #85, 2026-09-08,
 * option A).
 *
 * It read `required: true` and wrote `storage: { notNull: true }` beside it,
 * on the argument that pre-17 `field.required` bound three meanings to one
 * knob — the write contract, the physical NOT NULL, and the drift
 * expectation — so writing the constraint down preserved an old source's
 * full meaning. ADR-0113 split those axes, and two facts retired the argument:
 *
 * 1. Adding `storage.notNull` wherever `required: true` appears IS the
 *    implication ADR-0113 abolished. `required` is the write-time contract;
 *    `storage.notNull` alone binds the column. A conversion cannot be what
 *    decides a column constraint — that is the author's explicit act.
 * 2. `retiredFromLoadPath: true` did NOT hold the transform to
 *    `os migrate meta`, whatever this entry's docblock used to claim. The
 *    artifact-ingestion door replays the whole chain with `includeRetired:
 *    true` (`applyArtifactForwardConversions`, `@objectstack/metadata-core`),
 *    keyed off the artifact's declared `engines.protocol` FLOOR rather than
 *    its age — and `^17.0.0` is the range `create-objectstack` stamps. So
 *    every scaffolded app was handed NOT NULL columns it never asked for, plus
 *    a boot warning telling its author to write the same tightening into the
 *    source. On a populated database that instruction is a `tighten_not_null`
 *    / `severity: error` / `category: destructive` migration, prescribed as
 *    the remedy for a deprecation notice.
 *
 * No migration is owed to anyone: genuinely pre-ADR-0113 artifacts are not
 * measured to exist, and an app that wants NOT NULL columns declares
 * `storage.notNull` deliberately. Existing columns are left exactly as they
 * are.
 *
 * ⚠️ Fact 2 is about the MECHANISM, not about this entry, and it outlived the
 * entry: `retiredFromLoadPath` still holds nothing back at three runtime seams
 * (ADR-0087's 2026-09-13 addendum names all three). Before setting that flag on a DEFAULT FLIP — as opposed to a
 * lossless delete or a rename — read that addendum, because the flag does not mean
 * what its name says: its own docblock (`RetiredConversionState` in `types.ts`) has
 * stated the authoring-only reach since commit 29dd1a6dd.
 */

/**
 * The #3896 close-out sweep, part 2 (protocol 17): the remaining inert
 * authoring keys leave the surface, one conversion per metadata type. All are
 * pure lossless deletes — none of these keys ever had a runtime effect to
 * lose — and all are retired from the load path: each schema tombstones its
 * keys with the prescription (`retiredKey`), so the loader rejects loudly and
 * only `os migrate meta` lists the mechanical edits for existing sources.
 */
const stripKeys = (
  item: Record<string, unknown>,
  keys: readonly string[],
  emit: (n: { from: string; to: string; path: string }) => void,
  path: string,
): Record<string, unknown> => {
  let touched = false;
  const next: Record<string, unknown> = { ...item };
  for (const key of keys) {
    if (!(key in next)) continue;
    delete next[key];
    emit({ from: key, to: '(removed)', path: `${path}.${key}` });
    touched = true;
  }
  return touched ? next : item;
};

/**
 * The inline grid column's one mechanical respelling, shared by both of its
 * carriers — a relationship field's `inlineColumns`
 * ({@link fieldColumnListsCanonicalized}) and a form view's `subforms[].columns`
 * ({@link formViewSubformColumnsCanonicalized}) — so the two conversions cannot
 * drift on what they rewrite, as the two carriers cannot on what they accept
 * (both reference `InlineGridColumnSchema`).
 *
 * `{ field: 'x' }` → `{ name: 'x' }`, every other key kept. An entry already
 * carrying `name` is left alone — rewriting a live key on the strength of a
 * stale one would guess; the parse refuses the mixed shape loudly instead.
 * Returns the same array when nothing was respelled (copy-on-write).
 */
function respellInlineGridColumns(
  columns: readonly unknown[],
  path: string,
  emit: (detail: ConversionApplication) => void,
): readonly unknown[] {
  let changed = false;
  const next = columns.map((entry, i) => {
    if (!isDict(entry) || typeof entry.field !== 'string' || 'name' in entry) return entry;
    const renamed = renameKey(entry, 'field', 'name');
    if (!renamed) return entry;
    emit({ from: 'field', to: 'name', path: `${path}[${i}].name` });
    changed = true;
    return renamed;
  });
  return changed ? next : columns;
}

/**
 * The two page blocks that hand their props to objectui's action runner as an
 * action — the rows whose `endpoint` {@link actionBlockEndpointToTarget}
 * rewrites.
 */
const ACTION_RUNNER_BLOCK_TYPES = new Set(['action:button', 'action:icon']);

/**
 * Every `addRecord` block a stack can carry, mapped immutably (#24692).
 *
 * `AddRecordConfigSchema` is reached from three doors, and this walks all three:
 *
 * - every list payload in `stack.views[]`, in all three persisted spellings
 *   ({@link mapViewPayloads}: the ViewItem record's `config`, a container's
 *   `list` / `listViews.*`, the flattened list overlay);
 * - every object's `listViews.*` in `stack.objects[]` (`ObjectListViewSchema`
 *   carries the block too, and a stored object row is replayed as
 *   `{ objects: [row] }`);
 * - every page's `interfaceConfig.addRecord` in `stack.pages[]`
 *   (`InterfacePageConfigSchema`, the list page's own configuration), and
 *   every page `list-view` node's `properties` ({@link mapPageComponents},
 *   every position a component can sit in — its props row is built from
 *   `ListViewSchema`'s shape).
 *
 * `mapper` receives the block and the path of the KEY that holds it
 * (`….addRecord`) and returns the same reference (no change) or a new dict;
 * every container above it is copied only when the block changed. A non-dict
 * `addRecord` is not this walker's: it passes through untouched, and the
 * parse refuses it.
 */
function mapAddRecordBlocks(stack: Dict, mapper: (block: Dict, path: string) => Dict): Dict {
  const inPayload = (payload: Dict, path: string): Dict => {
    const block = payload.addRecord;
    if (!isDict(block)) return payload;
    const mapped = mapper(block, `${path}.addRecord`);
    return mapped === block ? payload : { ...payload, addRecord: mapped };
  };

  let next = mapViewPayloads(stack, (payload, kind, path) => (kind === 'list' ? inPayload(payload, path) : payload));

  next = mapCollection(next, 'objects', (obj, path) => {
    const listViews = obj.listViews;
    if (!isDict(listViews)) return obj;
    let changed = false;
    const rebuilt: Dict = { ...listViews };
    for (const [name, entry] of Object.entries(listViews)) {
      if (!isDict(entry)) continue;
      const mapped = inPayload(entry, `${path}.listViews.${name}`);
      if (mapped === entry) continue;
      rebuilt[name] = mapped;
      changed = true;
    }
    return changed ? { ...obj, listViews: rebuilt } : obj;
  });

  next = mapPages(next, (page, path) => {
    const cfg = page.interfaceConfig;
    if (!isDict(cfg)) return page;
    const mapped = inPayload(cfg, `${path}.interfaceConfig`);
    return mapped === cfg ? page : { ...page, interfaceConfig: mapped };
  });

  return mapPageComponents(next, (component, path) => {
    if (component.type !== 'list-view' || !isDict(component.properties)) return component;
    const props = component.properties;
    const mapped = inPayload(props, `${path}.properties`);
    return mapped === props ? component : { ...component, properties: mapped };
  });
}

/**
 * The two containers whose members a page action row's executor `type`
 * lives on — the members {@link pageActionRowNavigationExecutorToUrl}
 * rewrites, beside the {@link ACTION_RUNNER_BLOCK_TYPES} nodes.
 */
const ACTION_CONTAINER_BLOCK_TYPES = new Set(['action:group', 'action:menu']);

/** How a TODO names the page component a filter sits on: its type, and its `id` when it has one. */
function describeBlock(component: Dict): string {
  const type = typeof component.type === 'string' ? `the \`${component.type}\` block` : 'this component';
  const id = typeof component.id === 'string' && component.id.length > 0 ? ` \`${component.id}\`` : '';
  return `${type}${id}`;
}

// [#29987 codemod] Declared above without `export`, and read by the conversions' modules.
export {
  ACTION_CONTAINER_BLOCK_TYPES,
  ACTION_RUNNER_BLOCK_TYPES,
  type Dict,
  type Emit,
  describeBlock,
  isDict,
  mapAddRecordBlocks,
  renameFlowConfigAliases,
  renameVisibilityAlias,
  respellInlineGridColumns,
  stripKeys,
};
