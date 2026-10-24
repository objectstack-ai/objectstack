// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Turn a publish response's per-draft failures into a FIELD-ANCHORED message.
// A publish carries per-draft failures in `data.failed[]`, each with its own
// spec-validation `issues`. This formatter heads each failed draft and lists
// its issues in the one issue-line grammar.
//
// The single-error reader (`formatMetadataError`) and that line grammar
// (`formatMetadataIssue`) moved to `@object-ui/data-objectstack` beside the
// `MetadataError.issues` they read (objectui#11302), so `plugin-designer`'s
// `MetadataFieldsPage` — which cannot import from app-shell — renders a refused
// save through the same reader. Callers import them from there directly.
//
// Below the publish formatter sits the strips' view of a refused save
// (`StudioRefusal`, objectui#11785): an author sentence, the input it is about,
// and that same reader's text behind a disclosure.

import {
  assertObjectMetadataWritable,
  CHOICE_TYPES_REQUIRING_OPTIONS,
  formatMetadataError,
  formatMetadataIssue,
  OBJECT_METADATA_TYPE,
  RELATIONSHIP_TYPES_REQUIRING_REFERENCE,
  type MetadataError,
  type MetadataValidationIssue,
} from '@object-ui/data-objectstack';
import { FlowSchema, resolveFlowTriggerKind } from '@objectstack/spec/automation';
import { DashboardWidgetSchema, resolveI18nLabel, type I18nLabel } from '@objectstack/spec/ui';
import type { RegisteredErrorCode } from '@objectstack/spec/api';
import type { NavTargetLabelResolver } from '@object-ui/layout';
import type { MetadataSelection } from '../metadata-admin/preview-registry.js';
import { t, tFormat, translateValidationMessage } from '../metadata-admin/i18n.js';
import {
  fieldsForNodeType,
  getFieldValue,
  isFieldVisible,
  localizeFlowFields,
  type FlowConfigField,
} from '../metadata-admin/inspectors/flow-node-config.js';
import { specRequiresField } from '../metadata-admin/inspectors/flow-required-keys.js';
import { navEntryLabelText, type NavEntryLike } from '../metadata-admin/previews/navItemLabel.js';

/** A single failed draft from a publish response's `data.failed[]`. */
export interface PublishFailure {
  type: string;
  name: string;
  error: string;
  /** Machine code — `BATCH_ABORTED` marks a draft rolled back with the batch (ADR-0067 D2). */
  code?: string;
  issues?: MetadataValidationIssue[];
}

/**
 * framework 15.1+ (ADR-0067 D2): package publishes are ALL-OR-NOTHING. A
 * failed batch reports every draft in `failed[]` — the causal item with its
 * real error, the rest with this code — and `publishedCount: 0`.
 *
 * Spelled exactly as `publishPackageDrafts` emits it and as the spec's
 * error-code ledger registers it, and compared exactly: ⛔ no case-folding
 * (objectui#11985). The `satisfies` ties the literal to the ledger at compile
 * time, so a code the spec does not register does not compile; the import is
 * type-only and adds no runtime bytes.
 */
export const BATCH_ABORTED_CODE = 'BATCH_ABORTED' satisfies RegisteredErrorCode;

/**
 * Format the `failed[]` from a publish response (the server returns 200 with
 * the drafts that didn't go live).
 *
 * Two server generations produce two shapes (both handled):
 * - **15.1+ all-or-nothing** (ADR-0067 D2): the batch rolled back atomically —
 *   render ONE rolled-back banner anchored on the causal item(s), not N
 *   parallel errors (`BATCH_ABORTED` entries are consequences, not causes).
 * - **pre-15.1 partial publish**: each failed draft gets a heading and, when
 *   the failure was a validation error, its field-anchored issues indented
 *   below.
 */
export function formatPublishFailures(failed: PublishFailure[]): string {
  const line = (f: PublishFailure): string => {
    const head = `${f.type}/${f.name}: ${f.error}`;
    const issues = Array.isArray(f.issues) ? f.issues : [];
    return [head, ...issues.map((i) => `  ${formatMetadataIssue(i)}`)].join('\n');
  };
  const aborted = failed.filter((f) => f.code === BATCH_ABORTED_CODE);
  if (aborted.length > 0) {
    const causal = failed.filter((f) => f.code !== BATCH_ABORTED_CODE);
    return [
      'Nothing was published — the batch rolled back (all-or-nothing).',
      ...(causal.length > 0 ? causal.map(line) : aborted.slice(0, 1).map(line)),
      `(${aborted.length} other draft${aborted.length === 1 ? '' : 's'} aborted with it — fix the cause and publish again.)`,
    ].join('\n');
  }
  return failed.map(line).join('\n');
}

// ---------------------------------------------------------------------------
// objectui#11785 — a refusal the author can act on.
//
// Studio's strips used to print `formatMetadataError(e)` verbatim: the object
// write guard's prose, and the server's issue lines with raw paths such as
// `nodes.2.config.title`. Each strip now shows a `StudioRefusal`: one sentence
// in the designer's own words, naming the input it is about in the terms the
// editor shows (a field's label, a step's label and its inspector input, a
// navigation item), the selection that opens that input, and the raw text
// behind a "Details" disclosure.
//
// ⛔ `formatMetadataError` is not changed. It is the one reader of a failed save
// for every other surface, and its text is exactly what Details holds here, so
// nothing the strip printed before is lost: a path this module cannot place on
// the open editor keeps its line under Details, and the sentence says so.
//
// Everything here reads the body the save SENT, never the editor's buffer: an
// issue path indexes the document the server received, and the Interfaces nav
// save sends fewer entries than the editor holds (objectui#11776), so the same
// index can name a different entry in each.
// ---------------------------------------------------------------------------

/** One save failure as a Studio strip shows it (objectui#11785). */
export interface StudioRefusal {
  /** The sentence the strip shows. */
  message: string;
  /** The selection that opens the input the refusal is about, when the open editor has it. */
  target?: MetadataSelection;
  /**
   * The raw refusal, behind the disclosure: `formatMetadataError`'s text, what
   * the strip printed before. Absent when `message` already is that text.
   */
  detail?: string;
}

/** Where an issue's input sits on the open editor. */
export interface LocatedInput {
  /** The author's words for the input, e.g. `the field “Status”`. */
  where: string;
  selection: MetadataSelection;
}

/** Places one issue path, split on `.`, on the body that was sent; `null` when it cannot. */
export type IssueLocator = (path: readonly string[]) => LocatedInput | null;

type SentBody = Record<string, unknown>;

function isSentBody(value: unknown): value is SentBody {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** The declared `MetadataError.issues`, or none. */
function issuesOf(e: unknown): MetadataValidationIssue[] {
  const issues = (e as Partial<MetadataError> | null | undefined)?.issues;
  return Array.isArray(issues) ? issues : [];
}

/** A failure with nothing to rewrite (a read, a transport failure): shown as it was. */
export function plainRefusal(e: unknown): StudioRefusal {
  return { message: formatMetadataError(e) };
}

/**
 * A server refusal that carries issues: the first issue a locator can place
 * becomes the sentence and the target; every issue stays in Details. With no
 * issues the failure is shown as it was ({@link plainRefusal}).
 */
export function issueRefusal(e: unknown, locale: string, locate?: IssueLocator): StudioRefusal {
  const detail = formatMetadataError(e);
  const issues = issuesOf(e);
  if (issues.length === 0) return { message: detail };
  for (const issue of issues) {
    const path = String(issue.path ?? '').split('.').filter((seg) => seg !== '');
    const at = locate?.(path);
    if (!at) continue;
    const sentence = tFormat('engine.studio.refusal.issue', locale, {
      where: at.where,
      problem: translateValidationMessage(issue.message, locale),
    });
    const more = issues.length - 1;
    return {
      message: more > 0 ? `${sentence} ${tFormat('engine.studio.refusal.more', locale, { count: more })}` : sentence,
      target: at.selection,
      detail,
    };
  }
  return { message: t('engine.studio.refusal.unlocated', locale), detail };
}

/** A field's label as the editor shows it, its API name when it has none. */
function fieldLabelOf(name: string, def: SentBody): string {
  return typeof def.label === 'string' && def.label.trim() !== '' ? def.label.trim() : name;
}

/**
 * The fields of an object body in the order and under the names the write
 * guard reads them (`fieldEntries` in `object-metadata-write-guard.ts`): a
 * record's keys, or an array entry's `name` (`[index]` without one). `named`
 * says whether the editor can select it.
 */
function guardFieldEntries(fields: unknown): Array<{ name: string; def: SentBody; named: boolean }> {
  if (Array.isArray(fields)) {
    return fields.flatMap((raw, index) => {
      if (!isSentBody(raw)) return [];
      const named = typeof raw.name === 'string' && raw.name !== '';
      return [{ name: named ? (raw.name as string) : `[${index}]`, def: raw, named }];
    });
  }
  if (isSentBody(fields)) {
    return Object.entries(fields).flatMap(([name, def]) => (isSentBody(def) ? [{ name, def, named: true }] : []));
  }
  return [];
}

const GUARD_PROBE = 'studio-refusal-probe';

/** The message the write guard throws for `body`, or `null` when it lets it through. */
function guardMessageFor(body: SentBody): string | null {
  try {
    assertObjectMetadataWritable(OBJECT_METADATA_TYPE, body, GUARD_PROBE);
    return null;
  } catch (probe) {
    return probe instanceof Error ? probe.message : String(probe);
  }
}

/**
 * The object write guard's refusal of `sent`, in the author's words, or `null`
 * when `e` is not that refusal.
 *
 * Told apart without reading the prose: the guard throws before any request, so
 * its error carries no status and no issues, and its message is a function of
 * the body alone (it names no door). So the guard is run again on the body that
 * was sent; `e` is its refusal only if the two messages are identical, and the
 * field is the first one the guard refuses on its own, by the same equality.
 * Anything else falls through, and the strip shows the failure as it was.
 */
function guardRefusalOf(e: unknown, sent: SentBody, locale: string): StudioRefusal | null {
  if (!(e instanceof Error)) return null;
  if ((e as Partial<MetadataError>).status !== undefined || issuesOf(e).length > 0) return null;
  if (guardMessageFor(sent) !== e.message) return null;
  for (const { name, def, named } of guardFieldEntries(sent.fields)) {
    const own = guardMessageFor({ fields: { [name]: def } });
    if (own === null) continue;
    if (own !== e.message || !named) return null;
    const type = String(def.type);
    const key = CHOICE_TYPES_REQUIRING_OPTIONS.includes(type)
      ? 'engine.studio.refusal.choiceWithoutOptions'
      : RELATIONSHIP_TYPES_REQUIRING_REFERENCE.includes(type)
        ? 'engine.studio.refusal.relationshipWithoutTarget'
        : null;
    if (!key) return null;
    return {
      message: tFormat(key, locale, { field: fieldLabelOf(name, def) }),
      target: { kind: 'field', id: name },
      detail: e.message,
    };
  }
  return null;
}

/**
 * Data pillar: `fields.NAME…` on the object body that was sent (a record keyed
 * by name, or an array addressed by index or by `name`), placed on that field.
 */
export function objectFieldLocator(sent: SentBody, locale: string): IssueLocator {
  return (path) => {
    if (path[0] !== 'fields' || path.length < 2) return null;
    const key = path[1];
    const fields = sent.fields;
    let name: string | null = null;
    let def: SentBody | null = null;
    if (Array.isArray(fields)) {
      const raw = /^\d+$/.test(key) ? fields[Number(key)] : fields.find((f) => isSentBody(f) && f.name === key);
      if (isSentBody(raw) && typeof raw.name === 'string' && raw.name !== '') {
        name = raw.name;
        def = raw;
      }
    } else if (isSentBody(fields) && isSentBody(fields[key])) {
      name = key;
      def = fields[key] as SentBody;
    }
    if (name === null || def === null) return null;
    return {
      where: tFormat('engine.studio.refusal.field', locale, { field: fieldLabelOf(name, def) }),
      selection: { kind: 'field', id: name },
    };
  };
}

/** A refused save of an object body, as the Data pillar's strip shows it. */
export function objectSaveRefusal(e: unknown, sent: SentBody, locale: string): StudioRefusal {
  return guardRefusalOf(e, sent, locale) ?? issueRefusal(e, locale, objectFieldLocator(sent, locale));
}

/**
 * The inspector label of the input a node path below the node names, e.g.
 * `['config', 'title']` on a `notify` node → its Title. The node's field table
 * is the one the inspector renders offline; the longest declared path that the
 * issue path starts with wins.
 */
function flowInputLabel(type: unknown, rest: readonly string[], locale: string): string | null {
  if (typeof type !== 'string' || rest.length === 0) return null;
  let best: { label: string; depth: number } | null = null;
  for (const field of localizeFlowFields(type, fieldsForNodeType(type), locale)) {
    const depth = field.path.length;
    if (depth > rest.length || !field.path.every((seg, i) => seg === rest[i])) continue;
    if (!best || depth > best.depth) best = { label: field.label, depth };
  }
  return best ? best.label : null;
}

/**
 * Automations pillar: `nodes.INDEX…` on the flow body that was sent, placed on
 * that node (the step), and on its inspector input when the node's table
 * declares one at the rest of the path.
 */
export function flowNodeLocator(sent: SentBody, locale: string): IssueLocator {
  return (path) => {
    if (path[0] !== 'nodes' || !/^\d+$/.test(path[1] ?? '')) return null;
    const node = Array.isArray(sent.nodes) ? sent.nodes[Number(path[1])] : undefined;
    if (!isSentBody(node) || typeof node.id !== 'string' || node.id === '') return null;
    const step = typeof node.label === 'string' && node.label.trim() !== '' ? node.label.trim() : node.id;
    const input = flowInputLabel(node.type, path.slice(2), locale);
    return {
      where: input
        ? tFormat('engine.studio.refusal.stepInput', locale, { input, step })
        : tFormat('engine.studio.refusal.step', locale, { step }),
      selection: { kind: 'node', id: node.id },
    };
  };
}

/** A refused save of a flow body, as the Automations pillar's strip shows it. */
export function flowSaveRefusal(e: unknown, sent: SentBody, locale: string): StudioRefusal {
  return issueRefusal(e, locale, flowNodeLocator(sent, locale));
}

/** The nav inspector's own label for a top-level entry key it edits. */
const NAV_INPUT_KEYS: Readonly<Record<string, string>> = {
  label: 'engine.studio.nav.label',
  objectName: 'engine.studio.nav.linkObject',
};

/**
 * Interfaces pillar nav: `navigation.INDEX…` on the navigation that was SENT,
 * mapped back to the editor's entry of the same object or `id` (the save sends
 * the editor's entries less the unbound ones, objectui#11776), and placed on it
 * with the nav selection the editor uses (`navigation[i]`). Only top-level
 * entries: the Studio nav inspector edits no nested entry, so a `children`
 * path stays under Details.
 */
export function navEntryLocator(opts: {
  sent: readonly unknown[];
  editor: readonly unknown[];
  locale: string;
  targetLabel?: NavTargetLabelResolver;
}): IssueLocator {
  const { sent, editor, locale, targetLabel } = opts;
  return (path) => {
    if (path[0] !== 'navigation' || !/^\d+$/.test(path[1] ?? '') || path[2] === 'children') return null;
    const entry = sent[Number(path[1])];
    if (!isSentBody(entry)) return null;
    const index = editor.findIndex(
      (e) => e === entry || (isSentBody(e) && typeof e.id === 'string' && e.id !== '' && e.id === entry.id),
    );
    if (index < 0) return null;
    const own = editor[index] as NavEntryLike;
    const item = navEntryLabelText(own, locale, targetLabel) || String(own.id ?? '');
    const inputKey = path[2] !== undefined ? NAV_INPUT_KEYS[path[2]] : undefined;
    return {
      where: inputKey
        ? tFormat('engine.studio.refusal.navItemInput', locale, { input: t(inputKey, locale), item })
        : tFormat('engine.studio.refusal.navItem', locale, { item }),
      selection: { kind: 'nav', id: `navigation[${index}]` },
    };
  };
}

// ---------------------------------------------------------------------------
// objectui#11786 — an edit held, not refused.
//
// The ordinary path through Studio passes through incomplete shapes: a field
// switched to a choice type before its options exist, or to a relationship
// before its target is picked, and a flow step added before its required inputs
// are filled. Sent, each is refused: the object write guard throws before any
// request, and the flow parse answers 422. Studio's autosave therefore HOLDS
// such a body: the edit stays on screen, dirty and unsent, the pillar shows a
// neutral line naming what it still needs, and Publish refuses while it is held.
//
// Each predicate asks the judge that would refuse the body, ⛔ never a list kept
// here: the object write guard itself, on the body that would be sent; and, per
// flow step, `specRequiresField` (the spec's own flow judges) over the inputs
// the step's inspector shows. A body neither predicate holds is sent, and any
// refusal it draws is shown as before ({@link StudioRefusal}): errors are for
// what the author finished.
// ---------------------------------------------------------------------------

/** An edit a pillar holds unsent because its body is incomplete (objectui#11786). */
export interface StudioHeld {
  /**
   * What the edit still needs, as a clause the held line and the Publish
   * refusal both build on, e.g. `the field “Status” needs at least one option`.
   */
  clause: string;
  /** The selection that opens the input the edit needs. */
  target: MetadataSelection;
}

/** What the write guard asks of a field it refuses: its options, its target, or nothing it names. */
function guardNeedOf(def: SentBody): 'options' | 'target' | null {
  const type = String(def.type);
  if (CHOICE_TYPES_REQUIRING_OPTIONS.includes(type)) return 'options';
  if (RELATIONSHIP_TYPES_REQUIRING_REFERENCE.includes(type)) return 'target';
  return null;
}

/**
 * The edit the Data pillar holds for `body`, the object document its autosave
 * would send, or `null` when the write guard lets it through.
 *
 * The field is the first one the guard refuses on its own, in the guard's own
 * order, as {@link guardRefusalOf} finds it. A field the editor cannot select
 * (an array entry with no name) or a refusal naming neither options nor target
 * is not held: the save is sent, and its refusal shows as it always did.
 */
export function objectHeldEdit(body: SentBody, locale: string): StudioHeld | null {
  if (guardMessageFor(body) === null) return null;
  for (const { name, def, named } of guardFieldEntries(body.fields)) {
    if (guardMessageFor({ fields: { [name]: def } }) === null) continue;
    const need = guardNeedOf(def);
    if (!named || !need) return null;
    return {
      clause: tFormat(
        need === 'options' ? 'engine.studio.held.needsOptions' : 'engine.studio.held.needsTarget',
        locale,
        { field: fieldLabelOf(name, def) },
      ),
      target: { kind: 'field', id: name },
    };
  }
  return null;
}

/**
 * Whether `value` is a BLANK text (objectui#12343): a string with nothing in it
 * but whitespace, by the notion of blank the spec's own text-slot judge applies
 * (its `NON_BLANK_STRING` rule, `source.trim().length > 0`, not exported). Only
 * asked of a value the flow parse already refuses at its input, so this only
 * sorts a refusal into "unfinished" or "finished but wrong"; it never adds one.
 */
function isBlankText(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === '';
}

/** The path below the node that holds `field`'s value: its own, else its `fallbackPath`. */
function valuePathOf(node: SentBody, field: FlowConfigField): readonly string[] {
  if (!field.fallbackPath) return field.path;
  return getFieldValue(node, { ...field, fallbackPath: undefined }) !== undefined ? field.path : field.fallbackPath;
}

/**
 * The first input of `node`'s inspector table that holds no value while the
 * installed spec refuses the node without it, or `null`.
 *
 * "No value" is the key's absence (its `fallbackPath` read too): that is the
 * state the spec's judges refuse, and what `specRequiresField` asks about. An
 * input it shows only in another configuration is not asked, so a step is held
 * only for an input its inspector offers to fill.
 *
 * objectui#12343 — "no value" is also a BLANK text the flow parse refuses at
 * that input (`refusedAt`), as objectui#11951 ruled for a widget's emptied
 * binding: `@objectstack/spec` 18 refuses a blank Notify `title`. The parse's
 * refusal at the input is the condition, so a blank the contract accepts (a
 * Screen's `title`) is sent as before, and a non-blank value the parse
 * refuses is finished but wrong: its refusal shows.
 */
function heldInputOf(
  node: SentBody,
  flowKind: ReturnType<typeof resolveFlowTriggerKind>,
  refusedAt: (path: readonly string[]) => boolean,
) {
  if (typeof node.type !== 'string') return null;
  const fields = fieldsForNodeType(node.type);
  for (const field of fields) {
    const value = getFieldValue(node, field);
    if (value !== undefined && !isBlankText(value)) continue;
    if (!isFieldVisible(field, node, fields, flowKind)) continue;
    if (value === undefined ? specRequiresField(node, field) : refusedAt(valuePathOf(node, field))) return field;
  }
  return null;
}

/**
 * The edit the Automations pillar holds for `draft`, the flow its autosave
 * would send, or `null`: the first top-level step one of whose inspector inputs
 * the spec requires and the step leaves out, or holds blank where the flow
 * parse refuses a blank. A step inside a container region is not asked; its
 * refusal shows as the server words it.
 */
export function flowHeldEdit(draft: SentBody, locale: string): StudioHeld | null {
  if (!Array.isArray(draft.nodes)) return null;
  const flowKind = resolveFlowTriggerKind(draft);
  // The flow parse's issue paths, read once and only when a blank asks.
  let refused: ReadonlySet<string> | null = null;
  const refusedPaths = (): ReadonlySet<string> => {
    if (!refused) {
      const result = FlowSchema.safeParse(draft);
      refused = new Set(result.success ? [] : result.error.issues.map((issue) => issue.path.map(String).join('.')));
    }
    return refused;
  };
  for (const [index, node] of draft.nodes.entries()) {
    if (!isSentBody(node) || typeof node.id !== 'string' || node.id === '') continue;
    const field = heldInputOf(node, flowKind, (path) => refusedPaths().has(['nodes', index, ...path].join('.')));
    if (!field) continue;
    const step = typeof node.label === 'string' && node.label.trim() !== '' ? node.label.trim() : node.id;
    const input = flowInputLabel(node.type, field.path, locale) ?? field.label;
    return {
      clause: tFormat('engine.studio.held.needsInput', locale, { input, step }),
      target: { kind: 'node', id: node.id },
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// objectui#11910 — a dashboard widget held until it is bound.
//
// *Add widget* births `{ id, type, title }`, and the installed spec's
// `DashboardWidgetSchema` refuses every type the picker offers until it names a
// `dataset` and its `values` (ADR-0021: every widget is dataset-bound). A widget
// cannot be born valid without a dataset the author has not chosen, so the
// Interfaces pillar holds such a dashboard as the Data and Automations pillars
// hold theirs (objectui#11786): unsent, with a neutral line naming the input,
// and Publish refusing while it is held.
//
// ⛔ No list of required keys lives here. The judge is the spec's own widget
// schema, asked of each widget as it stands. What is kept here is only which
// inputs the widget inspector's dataset binding offers to fill, so a widget is
// held only for an input the author can reach.
//
// objectui#11951 — an input the author EMPTIED is unset too. Removing a
// widget's last measure is the normal way to change its measure, so the
// `values: []` it leaves is held like an absent `values`, not sent to draw the
// spec's refusal before the author can pick another.
// ---------------------------------------------------------------------------

/**
 * The inputs of the widget inspector's dataset binding, in the order it shows
 * them. `list` is the shape the inspector writes: a list of member names, or
 * one dataset name.
 */
const WIDGET_BINDING_INPUTS: ReadonlyArray<{ key: string; labelKey: string; list: boolean }> = [
  { key: 'dataset', labelKey: 'engine.inspector.widget.dataset', list: false },
  { key: 'dimensions', labelKey: 'engine.inspector.widget.dimensions', list: true },
  { key: 'values', labelKey: 'engine.inspector.widget.values', list: true },
];

type WidgetBindingInput = (typeof WIDGET_BINDING_INPUTS)[number];

/**
 * Whether `value` leaves `input` unset (objectui#11951): absent, a list
 * emptied of its last member, or a name cleared to `''`. Anything else, a
 * list holding a blank member or a name of spaces included, is a value, and
 * the spec's verdict on it stands.
 */
function bindingUnset(input: WidgetBindingInput, value: unknown): boolean {
  if (value === undefined) return true;
  return input.list ? Array.isArray(value) && value.length === 0 : value === '';
}

/**
 * A stand-in name for {@link unsetInputBehind}'s question. Never written
 * anywhere: the spec checks a dataset name's shape and a member name not at
 * all, so it only asks whether SOME value in that input would do.
 */
const BINDING_PROBE = 'probe';

/**
 * The unset binding input behind the spec's refusal at the filled input `key`,
 * or `null`. Some refusals of a filled input turn on an unset sibling: two
 * measures on a `scatter` with no dimension are refused at `values`. So the
 * spec is asked again with each unset sibling set, and the one whose value
 * clears every issue at `key` is the input the widget still needs.
 */
function unsetInputBehind(widget: SentBody, key: string): string | null {
  for (const input of WIDGET_BINDING_INPUTS) {
    if (input.key === key || !bindingUnset(input, widget[input.key])) continue;
    const again = DashboardWidgetSchema.safeParse({
      ...widget,
      [input.key]: input.list ? [BINDING_PROBE] : BINDING_PROBE,
    });
    if (again.success || !again.error.issues.some((issue) => String(issue.path[0]) === key)) return input.key;
  }
  return null;
}

/**
 * The binding inputs `widget` leaves unset that the installed spec refuses it
 * without, in the inspector's order, or none when the widget is not merely
 * unfinished.
 *
 * Unfinished means the spec's `DashboardWidgetSchema` refuses the widget, and
 * every issue it names is on one of those inputs, either unset itself
 * ({@link bindingUnset}: absent, emptied or cleared) or refused only for want
 * of an unset sibling ({@link unsetInputBehind}). A widget the spec refuses for
 * anything else (a value it holds that is wrong, a type outside the spec's, a
 * missing key the inspector does not offer) answers none: it is finished but
 * wrong, or not the inspector's to finish, so it is sent, and the refusal it
 * draws shows as before.
 */
export function widgetMissingInputs(widget: unknown): string[] {
  if (!isSentBody(widget)) return [];
  const result = DashboardWidgetSchema.safeParse(widget);
  if (result.success) return [];
  const missing = new Set<string>();
  for (const issue of result.error.issues) {
    const key = issue.path.length === 1 ? String(issue.path[0]) : null;
    const input = WIDGET_BINDING_INPUTS.find((entry) => entry.key === key);
    if (!input) return [];
    const needed = bindingUnset(input, widget[input.key]) ? input.key : unsetInputBehind(widget, input.key);
    if (needed === null) return [];
    missing.add(needed);
  }
  return WIDGET_BINDING_INPUTS.filter((input) => missing.has(input.key)).map((input) => input.key);
}

/**
 * The edit the Interfaces pillar holds for `draft`, the dashboard its leaf
 * autosave would send, or `null`: the first widget the spec refuses only for a
 * binding input it leaves out ({@link widgetMissingInputs}), named by its title
 * in the designer locale and selected as the canvas selects it.
 */
export function dashboardHeldEdit(draft: SentBody, locale: string): StudioHeld | null {
  if (!Array.isArray(draft.widgets)) return null;
  for (const widget of draft.widgets) {
    if (!isSentBody(widget) || typeof widget.id !== 'string' || widget.id === '') continue;
    const [key] = widgetMissingInputs(widget);
    const input = WIDGET_BINDING_INPUTS.find((entry) => entry.key === key);
    if (!input) continue;
    // The spec has judged `title` an `I18nLabel` here: its only issues are unset inputs.
    const title = resolveI18nLabel(widget.title as I18nLabel | undefined, locale)?.trim();
    return {
      clause: tFormat('engine.studio.held.widgetNeedsInput', locale, {
        input: t(input.labelKey, locale),
        widget: title || widget.id,
      }),
      target: { kind: 'widget', id: widget.id },
    };
  }
  return null;
}
