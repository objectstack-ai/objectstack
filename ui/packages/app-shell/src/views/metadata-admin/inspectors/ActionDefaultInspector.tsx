// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ActionDefaultInspector — type-aware authoring panel for an Action.
 *
 * Replaces the flat, everything-at-once SchemaForm for `action` with a
 * progressively-disclosed editor organised around how an action is actually
 * designed (mirroring Salesforce Quick Actions / ServiceNow UI Actions):
 *
 *   1. Basics       — label / name / object scope / icon / variant
 *   2. Behavior     — type-FIRST, then only the fields that `type` needs
 *                     (script → body editor; api → method + endpoint;
 *                      url/flow/modal/form → a single target binding)
 *   3. Inputs       — the params dialog the user fills before it runs
 *                     (field-backed picks reuse the object's field metadata)
 *   4. Placement    — where the button surfaces + object-vs-global scope hint
 *   5. Feedback     — confirm / success / error / refresh / undo / mode
 *   6. Conditions   — visible / disabled CEL predicates
 *   7. AI exposure  — opt-in tool exposure (ADR-0011)
 *
 * Rare/advanced props (resultDialog, bodyExtra, recordId mapping, new-tab,
 * timeout, aria, …) are NOT hand-curated here — they fall through to a
 * collapsed "More fields" SchemaForm fed the live server schema, with the
 * curated keys hidden so nothing is double-edited and nothing is lost.
 *
 * AI exposure uses the flattened `aiExposed` / `aiDescription` keys (the
 * objectui/server convention that ActionPreview reads), not the nested `ai`
 * block, so the curated control and the runtime/preview agree.
 */

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { ActionLocation } from '@objectstack/spec/ui';
import {
  ACTION_PARAM_FIELD_TYPES,
  OBJECTUI_LOCAL_PARAM_FIELD_TYPES,
  type ActionParam,
  type ResolvableParamFieldType,
} from '@object-ui/types';
import {
  Button, Label, Textarea,
} from '@object-ui/components';
import { usePermissions } from '@object-ui/permissions';
import type { MetadataDefaultInspectorProps } from '../default-inspector-registry.js';
import { SchemaForm } from '../SchemaForm.js';
import { t, tFormat, type SupportedLocale } from '../i18n.js';
import {
  InspectorShell,
  InspectorTextField,
  InspectorSelectField,
  InspectorCheckboxField,
  appendArray,
  moveArray,
  spliceArray,
} from './_shared.js';
import { useObjectOptions } from '../previews/useObjectOptions.js';
import { useObjectFields } from '../previews/useObjectFields.js';
import { useMetaOptions } from '../previews/useMetaOptions.js';
import { ConditionBuilder, CLIENT_CONDITION_ROOTS } from './ConditionBuilder.js';
import { expressionSource, writeExpressionSource } from './expression-envelope.js';
import { IconPickerWidget } from '../widgets.js';

/* ─────────────── constants ─────────────── */

/**
 * An option whose label is a catalogue key, resolved in the designer locale at
 * render (objectui#10586). The stored `value` never moves.
 */
type KeyedOption = { value: string; labelKey: string };

function localizeOptions(options: ReadonlyArray<KeyedOption>, locale: SupportedLocale): Array<{ value: string; label: string }> {
  return options.map((o) => ({ value: o.value, label: t(o.labelKey, locale) }));
}

/**
 * Render a catalogue sentence whose `{token}` slots are React nodes (a code
 * span, a capability list) — the split-and-interleave `ResourceEditPage`
 * already uses for `engine.edit.readOnlyBanner`. Where a slot sits, and the
 * words around it, belong to the locale rather than to this JSX.
 */
function withSlots(template: string, slots: Record<string, React.ReactNode>): React.ReactNode {
  return template.split(/\{(\w+)\}/).map((part, i) =>
    i % 2 === 1 ? <React.Fragment key={i}>{part in slots ? slots[part] : `{${part}}`}</React.Fragment> : part,
  );
}

const ACTION_TYPES: KeyedOption[] = [
  { value: 'script', labelKey: 'engine.inspector.action.type.script' },
  { value: 'api', labelKey: 'engine.inspector.action.type.api' },
  { value: 'flow', labelKey: 'engine.inspector.action.type.flow' },
  { value: 'modal', labelKey: 'engine.inspector.action.type.modal' },
  { value: 'form', labelKey: 'engine.inspector.action.type.form' },
  { value: 'url', labelKey: 'engine.inspector.action.type.url' },
];

const VARIANT_OPTS: KeyedOption[] = [
  { value: 'primary', labelKey: 'engine.inspector.action.variant.primary' },
  { value: 'secondary', labelKey: 'engine.inspector.action.variant.secondary' },
  { value: 'danger', labelKey: 'engine.inspector.action.variant.danger' },
  { value: 'ghost', labelKey: 'engine.inspector.action.variant.ghost' },
  { value: 'link', labelKey: 'engine.inspector.action.variant.link' },
];

const COMPONENT_OPTS: KeyedOption[] = [
  { value: 'action:button', labelKey: 'engine.inspector.action.component.button' },
  { value: 'action:icon', labelKey: 'engine.inspector.action.component.icon' },
  { value: 'action:menu', labelKey: 'engine.inspector.action.component.menu' },
  { value: 'action:group', labelKey: 'engine.inspector.action.component.group' },
];

const MODE_OPTS: KeyedOption[] = [
  { value: 'create', labelKey: 'engine.inspector.action.mode.create' },
  { value: 'edit', labelKey: 'engine.inspector.action.mode.edit' },
  { value: 'delete', labelKey: 'engine.inspector.action.mode.delete' },
  { value: 'custom', labelKey: 'engine.inspector.action.mode.custom' },
];

// HTTP methods are protocol tokens, the same in every locale: plain labels.
const METHOD_OPTS = [
  { value: 'POST', label: 'POST' },
  { value: 'PATCH', label: 'PATCH' },
  { value: 'PUT', label: 'PUT' },
  { value: 'DELETE', label: 'DELETE' },
];

/**
 * objectui#11921 — the language a body this inspector SEEDS is written in.
 *
 * `@objectstack/spec` declares no default for it: `language` is the
 * discriminator of `HookBodySchema`, a bare literal on each side, so a body
 * that names none is refused at `body.language` whatever else it holds. This
 * is therefore the inspector's own offer — the first entry of the picker
 * below, and the value that picker already SHOWED for a body naming no
 * language. Picker and writer read this one constant, so the language the
 * author sees selected is the language that is stored.
 */
const SEEDED_BODY_LANGUAGE = 'expression';

const BODY_LANG_OPTS: KeyedOption[] = [
  { value: SEEDED_BODY_LANGUAGE, labelKey: 'engine.inspector.action.bodyLang.expression' },
  { value: 'js', labelKey: 'engine.inspector.action.bodyLang.js' },
];

/**
 * The keys each body language admits: the two shapes of the spec's
 * `HookBodySchema` union, keyed by their `language` literal.
 *
 * Listed here rather than read off the spec at runtime. That read imported the
 * schema into the console's first load, which only the parity pin in
 * `ActionDefaultInspector.scriptBodyLanguage-11921.test.tsx` needs. That pin
 * compares this list with `HookBodySchema.options` both ways, so a key the spec
 * adds to or retires from either shape fails it, and so does a language.
 *
 * Exported for that pin alone, the way `PARAM_TYPE_OPTS` is for objectui#6538's:
 * no barrel re-exports this module, so it is not package surface. The cost is
 * this panel's fast refresh, which the directive below accepts by name.
 */
// eslint-disable-next-line react-refresh/only-export-components -- see above
export const BODY_KEYS_BY_LANGUAGE: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['expression', new Set(['language', 'source'])],
  ['js', new Set(['language', 'source', 'capabilities', 'timeoutMs', 'memoryMb'])],
]);

/** A body's authored language, or `undefined` when it names none. */
function bodyLanguageOf(body: Record<string, unknown>): string | undefined {
  return typeof body.language === 'string' && body.language !== '' ? body.language : undefined;
}

/**
 * objectui#11921 — the ONE writer of a script action's `body` in this
 * inspector. Every path that writes a body goes through it: the "What it does"
 * switch to *Run a script*, each keystroke in the body editor, and a language
 * change.
 *
 * - It guarantees `language`. The body editor used to write `{ source }` alone,
 *   which the spec refuses at `body.language` (`Invalid discriminator value`),
 *   so the first keystroke into a fresh body drew a refusal no amount of typing
 *   could clear. A language the body already names is kept as written; only an
 *   absent one is seeded, with {@link SEEDED_BODY_LANGUAGE}.
 * - A language change writes the NEW language's shape: a key only the old
 *   language admits (an L2 grant or limit — `capabilities`, `timeoutMs`,
 *   `memoryMb` — on a switch to an expression) is refused by name beside the
 *   new one, so it goes with the switch. A key neither language admits is the
 *   author's to fix, and the spec's refusal names it; this writer never drops
 *   it.
 *
 * `source` is never seeded. The spec requires a non-empty one, and it is the
 * one input only the author can supply — so a body seeded by the switch is
 * refused at `body.source` alone until the author types, which is the input
 * the editor puts in front of them.
 */
function writeScriptBody(body: Record<string, unknown>, change: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...body, ...change };
  const from = bodyLanguageOf(body);
  const to = bodyLanguageOf(next) ?? SEEDED_BODY_LANGUAGE;
  next.language = to;
  const left = from === undefined ? undefined : BODY_KEYS_BY_LANGUAGE.get(from);
  const kept = BODY_KEYS_BY_LANGUAGE.get(to);
  if (left && kept && from !== to) {
    for (const key of left) if (!kept.has(key)) delete next[key];
  }
  return next;
}

/*
 * `satisfies`, not a bare literal: every spelling this dropdown offers must be
 * one the published `ActionParam.type` admits. The eight below are spec
 * `FieldType` members, and the check is what stops a ninth from being added in
 * a dialect the server's `.strict()` `ActionParamSchema` would reject on save —
 * the way `long_text` reached `ActionPreview` while the local `type?: string`
 * was still in force (objectui#6329).
 */
/*
 * Exported for objectui#6538's pin, which compares what this dropdown OFFERS
 * against what `ActionPreview` draws — and reads the eight from here by
 * reference rather than restating them, so a ninth entry has to fail that pin.
 * A hand-kept copy of the vocabulary could not. The cost is this panel's fast
 * refresh, which the directive below accepts by name.
 */
// eslint-disable-next-line react-refresh/only-export-components -- see above
export const PARAM_TYPE_OPTS = [
  { value: 'text', labelKey: 'engine.inspector.action.paramType.text' },
  { value: 'textarea', labelKey: 'engine.inspector.action.paramType.textarea' },
  { value: 'number', labelKey: 'engine.inspector.action.paramType.number' },
  { value: 'boolean', labelKey: 'engine.inspector.action.paramType.boolean' },
  { value: 'select', labelKey: 'engine.inspector.action.paramType.select' },
  { value: 'date', labelKey: 'engine.inspector.action.paramType.date' },
  { value: 'datetime', labelKey: 'engine.inspector.action.paramType.datetime' },
  { value: 'lookup', labelKey: 'engine.inspector.action.paramType.lookup' },
] satisfies { value: ResolvableParamFieldType; labelKey: string }[];

/**
 * Every `type` spelling an authored param may carry, as a runtime set — the
 * spec's `FieldType` members plus objectui's three declared param aliases,
 * both taken BY REFERENCE from the witnesses `@object-ui/types` exports for
 * exactly this (a hand-listed copy is what the drift guard in that package
 * fails on).
 */
const RESOLVABLE_PARAM_TYPES: ReadonlySet<string> = new Set<string>([
  ...ACTION_PARAM_FIELD_TYPES,
  ...OBJECTUI_LOCAL_PARAM_FIELD_TYPES,
]);

/**
 * Narrow a dropdown commit — a DOM string — onto the published vocabulary.
 *
 * Returns `undefined` rather than coercing, so an unrecognised spelling clears
 * the key instead of being written into metadata the server would refuse. This
 * is a boundary check, not a lenient fallback: nothing off-spec gets accepted.
 */
function asParamFieldType(value: string): ResolvableParamFieldType | undefined {
  return RESOLVABLE_PARAM_TYPES.has(value) ? (value as ResolvableParamFieldType) : undefined;
}

/**
 * Friendly labels for the spec's action locations, as catalogue keys read in
 * the designer locale (objectui#10586).
 *
 * The vocabulary belongs to `ActionLocation` (spec `ACTION_LOCATIONS`). This
 * used to restate all seven values under a "mirrors spec ACTION_LOCATIONS"
 * comment with nothing enforcing it (objectui#3017). Typing the map as a TOTAL
 * `Record<ActionLocation, string>` makes the compiler the mechanism: a location
 * the spec ADDS is a missing-key error here rather than a silently absent
 * dropdown entry, and one it REMOVES is an excess-property error.
 *
 * That mechanism is what fired here: `@objectstack/spec` 17.0.0-rc.6 retired
 * `global_nav` from `ACTION_LOCATIONS` (objectstack#6888), and the entry that
 * used to sit at the end of this map — `'Global nav / command palette'` —
 * became a TS2353 excess property the moment the resolved vocabulary dropped to
 * six. It is removed rather than re-typed; the six below are the whole
 * vocabulary.
 *
 * Insertion order is the display order — an authoring-friendly grouping
 * (record → list), deliberately not the spec's declaration order.
 */
const LOCATION_LABELS: Record<ActionLocation, string> = {
  record_header: 'engine.inspector.action.location.record_header',
  record_more: 'engine.inspector.action.location.record_more',
  record_section: 'engine.inspector.action.location.record_section',
  record_related: 'engine.inspector.action.location.record_related',
  list_toolbar: 'engine.inspector.action.location.list_toolbar',
  list_item: 'engine.inspector.action.location.list_item',
};

const LOCATIONS: Array<{ value: ActionLocation; labelKey: string }> = (
  Object.keys(LOCATION_LABELS) as ActionLocation[]
).map((value) => ({ value, labelKey: LOCATION_LABELS[value] }));

/**
 * Per-type binding hints for the single `target` field, as catalogue keys. A
 * placeholder is a key when it carries words, and a literal when it is only a
 * sample value (a dotted view key, an API path), which reads the same in every
 * locale (objectui#10586).
 */
const TARGET_FIELD: Record<string, { labelKey: string; placeholderKey?: string; placeholder?: string; hintKey: string }> = {
  url: { labelKey: 'engine.inspector.action.target.url.label', placeholderKey: 'engine.inspector.action.target.url.placeholder', hintKey: 'engine.inspector.action.target.url.hint' },
  flow: { labelKey: 'engine.inspector.action.target.flow.label', placeholderKey: 'engine.inspector.action.target.flow.placeholder', hintKey: 'engine.inspector.action.target.flow.hint' },
  modal: { labelKey: 'engine.inspector.action.target.modal.label', placeholderKey: 'engine.inspector.action.target.modal.placeholder', hintKey: 'engine.inspector.action.target.modal.hint' },
  form: { labelKey: 'engine.inspector.action.target.form.label', placeholder: 'object.viewKey', hintKey: 'engine.inspector.action.target.form.hint' },
  api: { labelKey: 'engine.inspector.action.target.api.label', placeholder: '/api/v1/…', hintKey: 'engine.inspector.action.target.api.hint' },
};

/** Action types whose `target` names another metadata record — render a picker
 *  of real names instead of free text (flow → flow, modal → page, form → view). */
const TARGET_META_TYPE: Record<string, string> = { flow: 'flow', modal: 'page', form: 'view' };

/** Target binding: a reference picker for flow/modal/form (names come from the
 *  matching metadata type), else a free-text input (url/api). An out-of-catalog
 *  value is preserved as a synthesized option so it is never silently dropped —
 *  `InspectorSelectField` owns that rule now (objectui#8488); this call site
 *  used to hand-roll it, in the same `VALUE (not found)` wording the primitive
 *  defaults to, so deleting the copy changes no text. */
function ActionTargetField({ type, value, onCommit, cfg, readOnly }: {
  type: string;
  value: string;
  onCommit: (v: string) => void;
  cfg: { label: string; placeholder: string; hint: string };
  readOnly?: boolean;
}) {
  const metaType = TARGET_META_TYPE[type] ?? null;
  const { options } = useMetaOptions(metaType);
  const usePicker = !!metaType && options.length > 0;
  return (
    <div className="space-y-1">
      {usePicker ? (
        <InspectorSelectField label={`${cfg.label} *`} value={value || undefined} options={options} onCommit={onCommit} disabled={readOnly} />
      ) : (
        <InspectorTextField label={`${cfg.label} *`} value={value} onCommit={onCommit} placeholder={cfg.placeholder} disabled={readOnly} mono />
      )}
      <div className="text-[11px] text-muted-foreground/70">{cfg.hint}</div>
    </div>
  );
}

/**
 * What `@objectstack/spec` REFUSES beside `operation: 'update'`.
 *
 * The write is performed on the platform action route as the caller, so every
 * key here describes a DIFFERENT execution surface — a request this action does
 * not make (`target`, `body`, `method`, `bodyExtra`, `bodyShape`), a record
 * selector the route resolves itself (`recordIdParam`, `recordIdField`), or a
 * navigation the write has no business doing (`onSuccess`, `opensInNewTab`,
 * `newTabUrl`). Pairing any of them with `patch` is a hard parse rejection, so
 * the form clears them when the author switches into an update action rather
 * than letting a draft be composed that cannot be saved.
 *
 * Mirrored from the contract, not restated as a judgement: the spec is what
 * enforces this, and `ActionSchema.safeParse` is what proves it.
 */
const UPDATE_OPERATION_REFUSES = [
  'target', 'body', 'method', 'bodyExtra', 'bodyShape',
  'recordIdParam', 'recordIdField', 'onSuccess', 'opensInNewTab', 'newTabUrl',
] as const;

/**
 * `list_toolbar` is refused in `locations` beside `operation: 'update'`: the
 * bar is a MULTI-record surface and this write is single-record by contract.
 * A list view's `bulkActionDefs` is that bar's home for the same intent.
 */
const UPDATE_OPERATION_REFUSED_LOCATION = 'list_toolbar';

/** What a script action DOES — `operation` is authored beside `type`, not in it. */
const SCRIPT_OPERATIONS: KeyedOption[] = [
  { value: '', labelKey: 'engine.inspector.action.scriptOp.run' },
  { value: 'update', labelKey: 'engine.inspector.action.scriptOp.update' },
];

/** Keys this inspector edits with its own controls — hidden from the fallback. */
const CURATED_FIELDS = [
  'name', 'label', 'objectName', 'icon', 'variant', 'component',
  'type', 'target', 'execute', 'body', 'method',
  // The declarative single-record write, edited by the Behavior section's
  // "What it does" control and its field-value editor. Curated — and therefore
  // hidden from the fallback form — because the spec's refusal set around
  // `operation` cannot be expressed by an independent field: the fallback would
  // happily let an author pair `patch` with `target` and produce a draft that
  // cannot be saved.
  'operation', 'patch',
  'params', 'locations',
  'confirmText', 'successMessage', 'errorMessage', 'refreshAfter', 'undoable', 'mode',
  'visible', 'disabled', 'aiExposed', 'aiDescription',
];

/**
 * Keys hidden from the fallback form for the OPPOSITE reason: not because this
 * inspector edits them, but because `@objectstack/spec` 17 retired them as
 * `retiredKey()` tombstones — authoring either one is a hard PARSE REJECTION,
 * so a draft carrying it cannot be saved at all.
 *
 * They stay listed because the fallback renders from the server's live schema,
 * which still advertises both; dropping them here would put the inputs back.
 * This inspector used to offer its own controls for them (a "Bulk — apply to
 * multiple selected rows" checkbox and a "Shortcut" text field), which is how
 * the designer let an author build a draft the platform would then refuse.
 *
 * Do not add controls back. `bulkEnabled`'s replacement is the LIST VIEW's
 * `bulkActions` / `bulkActionDefs`; `shortcut` has none — register the key in
 * the Console keyboard stack and have its handler invoke the action by name.
 */
const RETIRED_FIELDS = ['bulkEnabled', 'shortcut'];

/* ─────────────── small helpers ─────────────── */

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      {hint && <div className="text-[11px] text-muted-foreground/70">{hint}</div>}
    </div>
  );
}

function localize(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as Record<string, string>;
    return o.en ?? o['en-US'] ?? Object.values(o)[0] ?? '';
  }
  return String(v);
}

/** Object dropdown (falls back to free text when no objects are resolvable). */
function ObjectPicker({ label, value, onCommit, disabled, hint, locale }: {
  label: string; value: string | undefined; onCommit: (v: string) => void; disabled?: boolean; hint?: string; locale: SupportedLocale;
}) {
  const { options } = useObjectOptions();
  return (
    <div className="space-y-1">
      {options.length === 0 ? (
        <InspectorTextField label={label} value={value ?? ''} placeholder={t('engine.inspector.action.objectPlaceholder', locale)} onCommit={onCommit} disabled={disabled} mono />
      ) : (
        <InspectorSelectField label={label} value={value || undefined} options={[{ value: '', label: t('engine.inspector.action.objectNone', locale) }, ...options]} onCommit={onCommit} disabled={disabled} />
      )}
      {hint && <div className="text-[11px] text-muted-foreground/70">{hint}</div>}
    </div>
  );
}

/** Field dropdown bound to an object (free text when unresolved). */
function FieldPicker({ label, objectName, value, onCommit, disabled }: {
  label: string; objectName: string | undefined; value: string | undefined; onCommit: (v: string) => void; disabled?: boolean;
}) {
  const { fields } = useObjectFields(objectName);
  const options = React.useMemo(
    () => fields.filter((f) => !f.hidden).map((f) => ({ value: f.name, label: f.label && f.label !== f.name ? `${f.label} (${f.name})` : f.name })),
    [fields],
  );
  if (!objectName || options.length === 0) {
    return <InspectorTextField label={label} value={value ?? ''} onCommit={onCommit} disabled={disabled} mono />;
  }
  return <InspectorSelectField label={label} value={value || undefined} options={[{ value: '', label: '—' }, ...options]} onCommit={onCommit} disabled={disabled} />;
}

/** One entry of `ActionParam.options`, read off the published type. */
type ActionParamOption = NonNullable<ActionParam['options']>[number];

/**
 * Options editor for a `select` param — the choices the dialog will offer.
 *
 * ## Why this exists (objectui#6538)
 *
 * `PARAM_TYPE_OPTS` offers `Select`, and `ActionPreview` draws the picker the
 * dialog will render — but until this card the per-param editor had controls
 * for `field`, `name`, `label`, `type`, `placeholder`, `required` and
 * `defaultFromRow`, and none for `options`. The panel that offered the type
 * could not produce the data the type needs.
 *
 * Triage allowed either a real control or a visible POINTER to wherever options
 * are authored. The pointer lost on measurement: `params` is listed in
 * {@link CURATED_FIELDS}, so the collapsed "More fields" `SchemaForm` hides the
 * whole array too. The only surface that could author `options` was the raw
 * JSON source tab — i.e. the pointer would have had to say "leave the
 * designer", which is the designer conceding it cannot author its own offered
 * type. So: a control.
 *
 * ## Scoped to `select`, deliberately
 *
 * `select` is the only spelling among the eight whose runtime widget reads
 * `options` (`SelectField`). A `text` param carrying `options` is not an
 * author's mistake to be enabled here — `TextField` ignores them, which is
 * exactly what the preview now shows.
 *
 * Localised labels: an option label committed here is written as a plain
 * string, flattening an authored `{ en, fr-FR }` map — the same trade the
 * param's own "Label" control above has always made. Locale maps stay
 * authorable through the JSON source tab.
 */
function ParamOptionsEditor({ options, onCommit, disabled, locale }: {
  options: ActionParamOption[] | undefined;
  onCommit: (next: ActionParamOption[]) => void;
  disabled?: boolean;
  /** The designer locale this editor's own words read in (objectui#10586). */
  locale: SupportedLocale;
}) {
  const opts = Array.isArray(options) ? options : [];
  return (
    <div role="group" aria-label={t('engine.inspector.action.options', locale)} className="space-y-1.5 rounded-md border border-dashed border-border p-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('engine.inspector.action.options', locale)}</div>
      {opts.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/80">
          {t('engine.inspector.action.optionsEmpty', locale)}
        </p>
      ) : (
        opts.map((o, j) => (
          <div key={j} className="flex items-start gap-1">
            <div className="grid flex-1 grid-cols-2 gap-2">
              <InspectorTextField
                label={t('engine.inspector.action.optionLabel', locale)}
                value={localize(o.label)}
                onCommit={(v) => onCommit(spliceArray(opts, j, { ...o, label: v }))}
                disabled={disabled}
              />
              <InspectorTextField
                label={t('engine.inspector.action.optionValue', locale)}
                value={o.value ?? ''}
                onCommit={(v) => onCommit(spliceArray(opts, j, { ...o, value: v }))}
                disabled={disabled}
                mono
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-[22px] h-6 w-6"
              disabled={disabled}
              aria-label={tFormat('engine.inspector.action.removeOption', locale, { index: j + 1 })}
              onClick={() => onCommit(spliceArray(opts, j, null))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))
      )}
      {!disabled && (
        <Button type="button" variant="outline" size="sm" onClick={() => onCommit(appendArray(opts, { label: '', value: '' }))}>
          <Plus className="mr-1 h-3.5 w-3.5" /> {t('engine.inspector.action.addOption', locale)}
        </Button>
      )}
    </div>
  );
}

/*
 * No local `ActionParam` here (objectui#6329). `@object-ui/types` publishes the
 * authoring shape, derived from the spec's `ActionParamSchema` input; this
 * panel WRITES that shape, so it reads the authority by reference.
 *
 * The copy that used to sit here carried `[k: string]: unknown`, which is the
 * member that mattered: an index signature admits every key at type `unknown`,
 * so `patchParam(i, { referenceTo: 'account' })` type-checked while
 * `ActionParamSchema` — `.strict()` — rejects that key BY NAME on save. It is
 * the same defect `FlowNodeInspector.specKeys.test.tsx` records for
 * `description`, and it also made the copy look compatible with the preview's
 * (which declared `options` / `helpText` / `defaultValue` outright) when the
 * two were simply describing different authoring surfaces.
 */

/* ─────────────── inspector ─────────────── */

/**
 * The CEL editors this inspector mounts, as aggregation keys. Errors are
 * counted PER SITE rather than into one running total: the two predicate
 * editors lint independently and asynchronously, so a single shared counter
 * would let whichever reported last overwrite the other — fixing "Visible
 * when" would hand back a writable Save while "Disabled when" was still
 * malformed (objectui#4527, the shape ObjectFieldInspector uses for its four).
 */
type ActionCelSite = 'visible' | 'disabled';

export function ActionDefaultInspector({
  draft,
  onPatch,
  readOnly,
  locale,
  serverSchema,
  onBlockingIssuesChange,
}: MetadataDefaultInspectorProps) {
  const tr = React.useCallback((key: string) => t(key, locale), [locale]);
  // objectui#12510 — the Icon label names the icon picker (the shape objectui#12531
  // gave the object and app-nav icon fields): the picker is a combobox, which
  // takes no name from its content.
  const iconFieldId = React.useId();

  const str = (k: string): string => (typeof draft[k] === 'string' ? (draft[k] as string) : '');
  const type = str('type') || 'script';
  const objectName = str('objectName');
  const body = (draft.body && typeof draft.body === 'object' ? draft.body : {}) as Record<string, unknown>;
  const params: ActionParam[] = Array.isArray(draft.params) ? (draft.params as ActionParam[]) : [];
  const locations: string[] = Array.isArray(draft.locations) ? (draft.locations as string[]) : [];

  /* ─── objectui#7551 — `operation` is authored BESIDE `type`, not inside it ──
   *
   * `ActionType` gained no member for the declarative write: the spec
   * materializes `type: 'script'` on an `operation: 'update'` action, because
   * the write is performed on the platform action route — which is the script
   * type's own route. So this is a second axis on the Behavior section, not a
   * seventh entry in the Type list, and the Type control is pinned while it is
   * set (every other `type` is a parse rejection beside this key).
   */
  const operation = str('operation');
  const isUpdateOperation = operation === 'update';
  const hasPatch = !!draft.patch && typeof draft.patch === 'object' && !Array.isArray(draft.patch);
  const patch: Record<string, unknown> = hasPatch ? (draft.patch as Record<string, unknown>) : {};
  const patchRows = Object.entries(patch);

  /**
   * Switching INTO an update action clears the keys the spec refuses beside it
   * and the placement it refuses, so the draft the author is holding stays
   * saveable. Switching OUT drops `patch`, which the spec refuses without its
   * `operation` (it would be silently dropped on the way to the runtime).
   *
   * objectui#11921 — each direction also writes what the spec requires of the
   * shape it lands on. Into an update action: a `patch`, since the spec refuses
   * an update action with none ("nothing to write"); the empty one is the
   * skeleton Studio's create flow starts every new action from (objectui#11820),
   * and a `patch` the draft already holds is kept. Out, to *Run a script*: a
   * `body` naming its language, through {@link writeScriptBody}, so the first
   * keystroke lands in a body the spec can parse — unless the action already
   * runs a registered function through `target`, which the spec accepts in
   * place of a body.
   */
  const commitOperation = (next: string) => {
    if (next === 'update') {
      const cleared: Record<string, unknown> = { operation: 'update', type: 'script' };
      for (const key of UPDATE_OPERATION_REFUSES) cleared[key] = undefined;
      if (locations.includes(UPDATE_OPERATION_REFUSED_LOCATION)) {
        cleared.locations = locations.filter((l) => l !== UPDATE_OPERATION_REFUSED_LOCATION);
      }
      if (!hasPatch) cleared.patch = {};
      onPatch(cleared);
      return;
    }
    const out: Record<string, unknown> = { operation: undefined, patch: undefined };
    if (!str('target')) out.body = writeScriptBody(body, {});
    onPatch(out);
  };

  const commitPatch = (rows: Array<[string, unknown]>) => {
    const next: Record<string, unknown> = {};
    for (const [key, value] of rows) if (key.trim() !== '') next[key.trim()] = value;
    onPatch({ patch: next });
  };

  /* ─── objectui#7234 — the OTHER way a correctly-placed action never appears ──
   *
   * `requiredPermissions` (ADR-0066 D4, `action.requiredPermissions`: "Enforced
   * with 403 on the platform action route … and mirrored as a UI hide") filters
   * the action out of every ticked surface at once — no button, no greyed-out
   * control, no message, no 4xx. The card was opened by an admin who had
   * configured the buttons, saw none of them anywhere, and read it as a broken
   * feature; nothing in the product said otherwise.
   *
   * Maintainer ruling 2026-09-08 (option B): end-user behaviour is UNCHANGED —
   * the action stays hidden — and the REASON becomes visible where the person
   * who configures the app looks. This panel is that channel; the sibling
   * notice below it (the empty-`locations` case) is the same idea for the other
   * way an action never surfaces.
   *
   * The held set comes from `MePermissionsProvider` via `usePermissions()` —
   * the same signal `useCanAuthorMetadata` reads, NOT a second client-side
   * permission derivation. `undefined` there means the host reported nothing
   * (no provider, or a backend predating ADR-0066), which the gate itself
   * treats as unknown and fails OPEN on, so the "you do not hold it" half stays
   * silent rather than guessing. */
  const requiredPermissions: string[] = Array.isArray(draft.requiredPermissions)
    ? (draft.requiredPermissions as unknown[]).filter((c): c is string => typeof c === 'string')
    : [];
  const { systemPermissions: heldCapabilities } = usePermissions();
  const unheldCapabilities = Array.isArray(heldCapabilities)
    ? requiredPermissions.filter((c) => !heldCapabilities.includes(c))
    : [];

  // AI exposure — flattened keys (objectui/server convention, read by ActionPreview).
  const aiExposed = draft.aiExposed === true;
  const aiDescription = typeof draft.aiDescription === 'string' ? (draft.aiDescription as string) : '';

  /* ─── Blocking CEL verdicts → the host's Save gate (objectui#4527) ─────
   *
   * Per-site map (see {@link ActionCelSite}), STAMPED with the action it
   * describes so a verdict that lands after the panel switched actions cannot
   * gate the one now on screen. Mismatch is read as 0 at aggregation time
   * rather than repaired by a reset effect. */
  const actionKey = str('name');
  const [celErrors, setCelErrors] = React.useState<{
    action: string;
    sites: Partial<Record<ActionCelSite, number>>;
  }>({ action: actionKey, sites: {} });
  const reportCel = React.useCallback(
    (site: ActionCelSite, count: number) => {
      setCelErrors((prev) => {
        if (prev.action !== actionKey) return { action: actionKey, sites: { [site]: count } };
        if (prev.sites[site] === count) return prev;
        return { action: actionKey, sites: { ...prev.sites, [site]: count } };
      });
    },
    [actionKey],
  );
  const blockingIssues = React.useMemo(() => {
    if (celErrors.action !== actionKey) return 0;
    let total = 0;
    for (const count of Object.values(celErrors.sites)) total += count ?? 0;
    return total;
  }, [celErrors, actionKey]);
  // Held in a ref so an unmemoized host callback cannot re-fire the effect.
  const onBlockingIssuesChangeRef = React.useRef(onBlockingIssuesChange);
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current = onBlockingIssuesChange;
  });
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current?.(blockingIssues);
  }, [blockingIssues]);

  // objectui#11921 — every body write goes through the one writer.
  const patchBody = (p: Record<string, unknown>) => onPatch({ body: writeScriptBody(body, p) });
  const patchParam = (i: number, p: Partial<ActionParam>) =>
    onPatch({ params: params.map((it, j) => (j === i ? { ...it, ...p } : it)) });

  const toggleLocation = (loc: string, on: boolean) => {
    const next = on ? [...new Set([...locations, loc])] : locations.filter((l) => l !== loc);
    onPatch({ locations: next });
  };

  // The target binding's words, resolved in the designer locale. A sample
  // value placeholder (no words) passes through as it is.
  const targetKeys = TARGET_FIELD[type];
  const targetCfg = targetKeys && {
    label: tr(targetKeys.labelKey),
    placeholder: targetKeys.placeholderKey ? tr(targetKeys.placeholderKey) : (targetKeys.placeholder ?? ''),
    hint: tr(targetKeys.hintKey),
  };

  const fallbackSchema = serverSchema as Record<string, unknown> | undefined;

  return (
    <InspectorShell
      kindLabel={tr('engine.inspector.action.kind')}
      title={String(localize(draft.label) || draft.name || tr('engine.inspector.action.kind'))}
      onClose={() => {}}
      closeLabel={tr('engine.inspector.action.close')}
      hideClose
    >
      {/* 1 ─ Basics */}
      <SectionHeader title={tr('engine.inspector.action.basics')} />
      <InspectorTextField label={tr('engine.inspector.action.label')} value={localize(draft.label)} onCommit={(v) => onPatch({ label: v })} placeholder={tr('engine.inspector.action.labelPlaceholder')} disabled={readOnly} />
      <InspectorTextField label={tr('engine.inspector.action.name')} value={str('name')} onCommit={(v) => onPatch({ name: v })} placeholder={tr('engine.inspector.action.namePlaceholder')} disabled={readOnly} mono />
      <ObjectPicker
        label={tr('engine.inspector.action.object')}
        value={objectName}
        onCommit={(v) => onPatch({ objectName: v || undefined })}
        disabled={readOnly}
        hint={objectName ? tr('engine.inspector.action.objectBoundHint') : tr('engine.inspector.action.objectGlobalHint')}
        locale={locale}
      />
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={iconFieldId} className="text-xs text-muted-foreground">{tr('engine.inspector.action.icon')}</Label>
          <IconPickerWidget id={iconFieldId} schema={{ type: 'string' }} value={str('icon')} onChange={(v) => onPatch({ icon: (v as string) || undefined })} readOnly={readOnly} />
        </div>
        <InspectorSelectField label={tr('engine.inspector.action.variant')} value={str('variant') || undefined} options={localizeOptions(VARIANT_OPTS, locale)} onCommit={(v) => onPatch({ variant: v })} disabled={readOnly} />
      </div>

      {/* 2 ─ Behavior (type-first) */}
      <div className="border-t pt-3 space-y-3">
        <SectionHeader title={tr('engine.inspector.action.behavior')} hint={tr('engine.inspector.action.behaviorHint')} />
        <InspectorSelectField label={tr('engine.inspector.action.type')} value={type} options={localizeOptions(ACTION_TYPES, locale)} onCommit={(v) => onPatch({ type: v })} disabled={readOnly || isUpdateOperation} />
        {isUpdateOperation && (
          <div className="text-[11px] text-muted-foreground/70">
            {withSlots(tr('engine.inspector.action.pinnedScript'), { script: <code>script</code> })}
          </div>
        )}

        {type === 'script' ? (
          <>
            <InspectorSelectField
              label={tr('engine.inspector.action.whatItDoes')}
              value={operation}
              options={localizeOptions(SCRIPT_OPERATIONS, locale)}
              onCommit={commitOperation}
              disabled={readOnly}
            />
            {isUpdateOperation ? (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">{tr('engine.inspector.action.fieldValues')}</Label>
                {patchRows.length === 0 ? (
                  <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2.5 text-center text-[11px] text-muted-foreground">
                    {tr('engine.inspector.action.fieldValuesEmpty')}
                  </p>
                ) : (
                  patchRows.map(([key, value], i) => (
                    <div key={i} className="flex items-end gap-2">
                      <div className="flex-1">
                        <InspectorTextField
                          label={tr('engine.inspector.action.fieldValueField')}
                          value={key}
                          onCommit={(v) => commitPatch(patchRows.map((row, j) => (j === i ? [v, row[1]] : row)))}
                          placeholder="status"
                          disabled={readOnly}
                          mono
                        />
                      </div>
                      <div className="flex-1">
                        <InspectorTextField
                          label={tr('engine.inspector.action.fieldValueValue')}
                          value={typeof value === 'string' ? value : JSON.stringify(value ?? '')}
                          onCommit={(v) => commitPatch(patchRows.map((row, j) => (j === i ? [row[0], v] : row)))}
                          placeholder="done"
                          disabled={readOnly}
                          mono
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        disabled={readOnly}
                        aria-label={tr('engine.inspector.action.removeFieldValue')}
                        onClick={() => commitPatch(patchRows.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={readOnly}
                  onClick={() => commitPatch([...patchRows, ['', '']])}
                >
                  <Plus className="mr-1 h-3 w-3" /> {tr('engine.inspector.action.addFieldValue')}
                </Button>
                <div className="text-[11px] text-muted-foreground/70">
                  {tr('engine.inspector.action.updateHint')}
                </div>
              </div>
            ) : (
              <>
            <InspectorSelectField
              label={tr('engine.inspector.action.scriptLanguage')}
              value={bodyLanguageOf(body) ?? SEEDED_BODY_LANGUAGE}
              options={localizeOptions(BODY_LANG_OPTS, locale)}
              onCommit={(v) => patchBody({ language: v })}
              disabled={readOnly}
            />
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{tr('engine.inspector.action.scriptBody')}</Label>
              <Textarea
                value={typeof body.source === 'string' ? (body.source as string) : ''}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => patchBody({ source: e.target.value })}
                disabled={readOnly}
                spellCheck={false}
                rows={5}
                placeholder={'// (input, ctx) => result\nreturn { ok: true }'}
                className="text-xs font-mono"
              />
              <div className="text-[11px] text-muted-foreground/70">
                {withSlots(tr('engine.inspector.action.scriptBodyHint'), { signature: <code>(input, ctx) =&gt; Promise&lt;output&gt;</code> })}
              </div>
            </div>
              </>
            )}
          </>
        ) : (
          <>
            {type === 'api' && (
              <InspectorSelectField label={tr('engine.inspector.action.method')} value={str('method') || 'POST'} options={METHOD_OPTS} onCommit={(v) => onPatch({ method: v })} disabled={readOnly} />
            )}
            {targetCfg && (
              <ActionTargetField
                type={type}
                value={str('target')}
                onCommit={(v) => onPatch({ target: v })}
                cfg={targetCfg}
                readOnly={readOnly}
              />
            )}
          </>
        )}
      </div>

      {/* 3 ─ Inputs (params) */}
      <div className="border-t pt-3 space-y-2">
        <SectionHeader title={tr('engine.inspector.action.inputs')} hint={tr('engine.inspector.action.inputsHint')} />
        {params.length === 0 ? (
          <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2.5 text-center text-[11px] text-muted-foreground">{tr('engine.inspector.action.inputsEmpty')}</p>
        ) : (
          params.map((p, i) => (
            <div key={i} className="space-y-2 rounded-md border border-border p-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">#{i + 1}</span>
                <div className="flex items-center gap-0.5">
                  <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={readOnly || i === 0} aria-label={tr('engine.inspector.reorder.up')} onClick={() => onPatch({ params: moveArray(params, i, i - 1) })}>↑</Button>
                  <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={readOnly || i === params.length - 1} aria-label={tr('engine.inspector.reorder.down')} onClick={() => onPatch({ params: moveArray(params, i, i + 1) })}>↓</Button>
                  <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={readOnly} aria-label={tr('engine.inspector.action.removeInput')} onClick={() => onPatch({ params: spliceArray(params, i, null) })}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              {objectName ? (
                <FieldPicker label={tr('engine.inspector.action.bindToField')} objectName={objectName} value={p.field} onCommit={(v) => patchParam(i, { field: v || undefined })} disabled={readOnly} />
              ) : null}
              {!p.field && (
                <InspectorTextField label={tr('engine.inspector.action.paramName')} value={p.name ?? ''} onCommit={(v) => patchParam(i, { name: v })} placeholder={tr('engine.inspector.action.paramNamePlaceholder')} disabled={readOnly} mono />
              )}
              <InspectorTextField label={tr('engine.inspector.action.paramLabel')} value={localize(p.label)} onCommit={(v) => patchParam(i, { label: v })} disabled={readOnly} />
              {!p.field && (
                <InspectorSelectField label={tr('engine.inspector.action.paramTypeLabel')} value={p.type || undefined} options={localizeOptions(PARAM_TYPE_OPTS, locale)} onCommit={(v) => patchParam(i, { type: asParamFieldType(v) })} disabled={readOnly} />
              )}
              {/* `select` is the one offered spelling whose runtime widget reads
                  `options` — see ParamOptionsEditor for why this is a control
                  and not a pointer (objectui#6538). */}
              {!p.field && p.type === 'select' && (
                <ParamOptionsEditor
                  options={p.options}
                  onCommit={(next) => patchParam(i, { options: next.length > 0 ? next : undefined })}
                  disabled={readOnly}
                  locale={locale}
                />
              )}
              <InspectorTextField label={tr('engine.inspector.action.paramPlaceholder')} value={p.placeholder ?? ''} onCommit={(v) => patchParam(i, { placeholder: v })} disabled={readOnly} />
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <InspectorCheckboxField label={tr('engine.inspector.action.paramRequired')} value={!!p.required} onCommit={(v) => patchParam(i, { required: v })} disabled={readOnly} />
                <InspectorCheckboxField label={tr('engine.inspector.action.paramPrefill')} value={!!p.defaultFromRow} onCommit={(v) => patchParam(i, { defaultFromRow: v })} disabled={readOnly} />
              </div>
            </div>
          ))
        )}
        {!readOnly && (
          <Button type="button" variant="outline" size="sm" onClick={() => onPatch({ params: appendArray(params, {} as ActionParam) })}>
            <Plus className="mr-1 h-3.5 w-3.5" /> {tr('engine.inspector.action.addInput')}
          </Button>
        )}
      </div>

      {/* 4 ─ Placement & scope */}
      <div className="border-t pt-3 space-y-2">
        <SectionHeader title={tr('engine.inspector.action.placement')} hint={tr('engine.inspector.action.placementHint')} />
        <div className="grid grid-cols-1 gap-1">
          {/* `list_toolbar` is not OFFERED on an update action — the spec refuses
              it there, and a placement an author can tick but not save is worse
              than one that is absent. A list view's `bulkActionDefs` is that
              bar's home for the same intent. */}
          {LOCATIONS
            .filter((loc) => !(isUpdateOperation && loc.value === UPDATE_OPERATION_REFUSED_LOCATION))
            .map((loc) => (
              <InspectorCheckboxField key={loc.value} label={tr(loc.labelKey)} value={locations.includes(loc.value)} onCommit={(v) => toggleLocation(loc.value, v)} disabled={readOnly} />
            ))}
        </div>
        {/* [#3142] No placement = renders in no located surface. Saying so
            here is the difference between an author seeing an empty list and
            an author hunting for a button that was never going to appear.
            Not an error: a selection-only action is placed by a view's
            `bulkActions` / `bulkActionDefs` instead, which is legitimate. */}
        {locations.length === 0 && (
          <div className="text-[11px] text-destructive">
            {tr('engine.inspector.action.noPlacement')}
          </div>
        )}
        {/* [#7234] The capability gate, stated where the person configuring the
            app looks. Deliberately NOT an error: the hide is correct behaviour
            under ADR-0066 D4 and the maintainer ruled it stays. What was
            missing is that it was the one kind of disappearance nothing
            anywhere explained. See the decode block above for the ruling. */}
        {requiredPermissions.length > 0 && (
          <div className="text-[11px] text-amber-700" data-testid="action-capability-gate-note">
            {withSlots(tr('engine.inspector.action.capabilityGate'), {
              capabilities: <span className="font-mono">{requiredPermissions.join(' + ')}</span>,
              whom: tr(requiredPermissions.length > 1 ? 'engine.inspector.action.capabilityGateAll' : 'engine.inspector.action.capabilityGateOne'),
            })}
            {unheldCapabilities.length > 0 && (
              <>
                {' '}
                <span data-testid="action-capability-gate-self">
                  {withSlots(tr('engine.inspector.action.capabilityGateSelf'), {
                    capabilities: <span className="font-mono">{unheldCapabilities.join(' + ')}</span>,
                  })}
                </span>
              </>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <InspectorSelectField label={tr('engine.inspector.action.component')} value={str('component') || undefined} options={localizeOptions(COMPONENT_OPTS, locale)} onCommit={(v) => onPatch({ component: v })} disabled={readOnly} />
        </div>
        {/* No "Bulk" checkbox here: `action.bulkEnabled` is a spec-17
            tombstone (see RETIRED_FIELDS). Selection placement is declared on
            the LIST VIEW, in `bulkActions` / `bulkActionDefs`. */}
      </div>

      {/* 5 ─ Feedback */}
      <div className="border-t pt-3 space-y-2">
        <SectionHeader title={tr('engine.inspector.action.feedback')} hint={tr('engine.inspector.action.feedbackHint')} />
        <InspectorTextField label={tr('engine.inspector.action.confirmText')} value={localize(draft.confirmText)} onCommit={(v) => onPatch({ confirmText: v })} placeholder={tr('engine.inspector.action.confirmTextPlaceholder')} disabled={readOnly} />
        <InspectorTextField label={tr('engine.inspector.action.successMessage')} value={localize(draft.successMessage)} onCommit={(v) => onPatch({ successMessage: v })} disabled={readOnly} />
        <InspectorTextField label={tr('engine.inspector.action.errorMessage')} value={localize(draft.errorMessage)} onCommit={(v) => onPatch({ errorMessage: v })} disabled={readOnly} />
        {/* No "Shortcut" field beside Mode: `action.shortcut` is a spec-17
            tombstone (see RETIRED_FIELDS) — nothing ever read it, and
            authoring it now fails the parse. */}
        <div className="grid grid-cols-2 gap-2">
          <InspectorSelectField label={tr('engine.inspector.action.mode')} value={str('mode') || undefined} options={localizeOptions(MODE_OPTS, locale)} onCommit={(v) => onPatch({ mode: v })} disabled={readOnly} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <InspectorCheckboxField label={tr('engine.inspector.action.refreshAfter')} value={!!draft.refreshAfter} onCommit={(v) => onPatch({ refreshAfter: v })} disabled={readOnly} />
          <InspectorCheckboxField label={tr('engine.inspector.action.undoable')} value={!!draft.undoable} onCommit={(v) => onPatch({ undoable: v })} disabled={readOnly} />
        </div>
      </div>

      {/* 6 ─ Conditions */}
      <div className="border-t pt-3 space-y-3">
        <SectionHeader title={tr('engine.inspector.action.conditions')} hint={tr('engine.inspector.action.conditionsHint')} />
        {/* Both are `ExpressionInputSchema` in the spec (`disabled` as
            `boolean | ExpressionInput`), so a persisted action carries the
            ADR-0089 envelope — same read/write pair as the hook guard (#3218). */}
        {/* `scope="record"` is CONFORMANCE, not taste (objectui#8167). The
            row-predicate canon in `@object-ui/core` (`rowPredicateCanon.ts`)
            names an action renderer's `visible` / `disabled` as a row surface
            in its own words, and `usePredicateRecordContext` binds `record`
            and nothing else — so a bare `status == 'done'` can never match.
            Without the scope these two editors linted it CLEAN: the default is
            `celAuthoring`'s `hint.scope ?? 'flattened'`, which is right for RLS
            and wrong here. It also ends a disagreement inside this very
            control — the row builder was already emitting `record.<field>`
            while its own raw editor accepted the retired bare spelling. */}
        {/* `roots` is the second declaration this pair owes, and it answers a
            different question than `scope` does (objectui#9856). `scope` says
            how the CEL is LINTED; `roots` says what the HOST binds, and
            objectui#9645 could not derive the second from the first — so a
            `scope="record"` mount that declares nothing inherits
            `RECORD_CONDITION_ROOTS`, the set every host of a record-scoped
            condition binds. These two are evaluated in the BROWSER, where
            `buildExpressionScope` binds more than that, and
            `CONDITION_HOST_BY_METADATA_TYPE` rules the `action` tier `client`
            from a reading taken at that evaluator. Declared here rather than
            defaulted, for the reason `RECORD_CONDITION_ROOTS` gives: the
            component cannot see which host is on the other end. */}
        <ConditionBuilder label={tr('engine.inspector.action.visibleWhen')} value={expressionSource(draft.visible)} onCommit={(v) => onPatch({ visible: writeExpressionSource(draft.visible, v) })} objectName={objectName} disabled={readOnly} scope="record" roots={CLIENT_CONDITION_ROOTS} onBlockingIssuesChange={(n) => reportCel('visible', n)} />
        <ConditionBuilder label={tr('engine.inspector.action.disabledWhen')} value={expressionSource(draft.disabled)} onCommit={(v) => onPatch({ disabled: writeExpressionSource(draft.disabled, v) })} objectName={objectName} disabled={readOnly} scope="record" roots={CLIENT_CONDITION_ROOTS} onBlockingIssuesChange={(n) => reportCel('disabled', n)} />
      </div>

      {/* 7 ─ AI exposure */}
      <div className="border-t pt-3 space-y-2">
        <SectionHeader title={tr('engine.inspector.action.ai')} hint={tr('engine.inspector.action.aiHint')} />
        <InspectorCheckboxField label={tr('engine.inspector.action.aiExposed')} value={aiExposed} onCommit={(v) => onPatch({ aiExposed: v })} disabled={readOnly} />
        {aiExposed ? (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{tr('engine.inspector.action.aiDescription')}</Label>
            <Textarea
              value={aiDescription}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onPatch({ aiDescription: e.target.value })}
              disabled={readOnly}
              rows={3}
              placeholder={tr('engine.inspector.action.aiDescriptionPlaceholder')}
              className="text-xs"
            />
            {aiDescription.length < 40 && (
              <div className="text-[11px] text-destructive">{tr('engine.inspector.action.aiDescriptionTooShort')}</div>
            )}
          </div>
        ) : null}
      </div>

      {/* Advanced — everything not curated above, from the live schema */}
      {fallbackSchema && (
        <div className="border-t pt-3 space-y-1.5">
          <SectionHeader title={tr('engine.inspector.moreFields')} hint={tr('engine.inspector.action.moreFieldsHint')} />
          <SchemaForm
            schema={fallbackSchema}
            value={draft}
            hiddenFields={[...CURATED_FIELDS, ...RETIRED_FIELDS]}
            readOnly={readOnly}
            onChange={(next) => onPatch(next)}
          />
        </div>
      )}
    </InspectorShell>
  );
}
