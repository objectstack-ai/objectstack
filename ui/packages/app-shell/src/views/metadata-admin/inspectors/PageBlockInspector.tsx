// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PageBlockInspector — scoped editor for the selected page block /
 * component subtree.
 *
 * Selection shape:  { kind: 'block', id: 'children[i]' | 'children[i].children[j]' | … }
 *
 * A Page schema is a SDUI tree; "blocks" are children nodes. The id
 * is a dotted path of `children[i]` hops, identical in spirit to
 * AppNavInspector but always rooted at top-level `children`.
 */

import * as React from 'react';
import type { MetadataInspectorProps } from '../inspector-registry.js';
import type { ExpressionInput } from '@objectstack/spec/shared';
import { t, type SupportedLocale } from '../i18n.js';
import {
  InspectorShell,
  InspectorReorderButtons,
  InspectorTextField,
  InspectorNumberField,
  InspectorSelectField,
  InspectorCheckboxField,
  InspectorRemoveButton,
  InspectorEmptyState,
  moveArray,
} from './_shared.js';
import {
  BLOCK_CONFIG,
  blockHasConfig,
  stripRetiredBlockProps,
  type BlockPropField,
  type PlaceholderSpec,
} from '../previews/block-config.js';
import { ColorVariantPicker } from '../color-variant-field.js';
import { ConditionBuilder } from './ConditionBuilder.js';
import { expressionSource, writeExpressionSource } from './expression-envelope.js';
import { useObjectOptions } from '../previews/useObjectOptions.js';
import { useObjectFields } from '../previews/useObjectFields.js';
import {
  Button, Input, Label,
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@object-ui/components';
import { Plus, X, Trash2 } from 'lucide-react';

// ── Schema-driven picker fields ──────────────────────────────────────────────

/** Field options for an object (visible fields), as {value,label}. */
function useFieldOptions(objectName: string | undefined): Array<{ value: string; label: string }> {
  const { fields } = useObjectFields(objectName);
  return React.useMemo(
    () =>
      fields
        .filter((f) => !f.hidden)
        .map((f) => ({ value: f.name, label: f.label && f.label !== f.name ? `${f.label} (${f.name})` : f.name })),
    [fields],
  );
}

/** Object dropdown; falls back to a free-text input when the list is empty. */
function ObjectPickerField({ label, value, onCommit, disabled, locale }: {
  label: string; value: string | undefined; onCommit: (v: string) => void; disabled?: boolean;
  locale: SupportedLocale;
}) {
  const { options } = useObjectOptions();
  if (options.length === 0) {
    return <InspectorTextField label={label} value={value ?? ''} placeholder={t('engine.inspector.pageBlock.objectPlaceholder', locale)} onCommit={onCommit} disabled={disabled} mono />;
  }
  return <InspectorSelectField label={label} value={value || undefined} options={options} onCommit={onCommit} disabled={disabled} />;
}

/** Field dropdown for `objectName`; falls back to free text when unresolved. */
function FieldPickerField({ label, objectName, value, onCommit, disabled }: {
  label: string; objectName: string | undefined; value: string | undefined; onCommit: (v: string) => void; disabled?: boolean;
}) {
  const options = useFieldOptions(objectName);
  if (!objectName || options.length === 0) {
    return <InspectorTextField label={label} value={value ?? ''} onCommit={onCommit} disabled={disabled} mono />;
  }
  return <InspectorSelectField label={label} value={value || undefined} options={options} onCommit={onCommit} disabled={disabled} />;
}

/** Editable list of field names — each row a field dropdown (or text fallback). */
function FieldListField({ label, objectName, value, onChange, disabled, locale }: {
  label: string; objectName: string | undefined; value: unknown; onChange: (v: string[]) => void; disabled?: boolean;
  locale: SupportedLocale;
}) {
  const options = useFieldOptions(objectName);
  const arr: string[] = Array.isArray(value) ? (value as string[]) : [];
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {arr.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {options.length > 0 ? (
            <div className="flex-1">
              <Select value={s ? String(s) : ''} onValueChange={(v) => { const n = [...arr]; n[i] = v; onChange(n); }} disabled={disabled}>
                <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <Input className="h-8 text-sm" value={String(s ?? '')} placeholder={t('engine.inspector.pageBlock.fieldPlaceholder', locale)} disabled={disabled}
              onChange={(e) => { const n = [...arr]; n[i] = e.target.value; onChange(n); }} />
          )}
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={disabled}
            aria-label={t('engine.inspector.pageBlock.list.remove', locale)}
            onClick={() => onChange(arr.filter((_, j) => j !== i))}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      {!disabled && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...arr, ''])}>
          <Plus className="mr-1 h-3.5 w-3.5" /> {t('engine.inspector.pageBlock.list.add', locale)}
        </Button>
      )}
    </div>
  );
}

/** Pretty-print a value for the JSON editor; undefined → empty string. */
function safeStringify(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

/** Editable JSON field for object/array properties — commits on blur so a
 *  half-typed value never trips the parser. Empty clears the property. */
function InspectorJsonField({ label, value, onCommit, disabled, placeholder, locale }: {
  label: string; value: unknown; onCommit: (v: unknown) => void; disabled?: boolean;
  /** Shown while the property is unset — the expected shape, since an empty
   *  JSON textarea tells an author nothing about what to type. */
  placeholder?: string;
  locale: SupportedLocale;
}) {
  const initial = React.useMemo(() => safeStringify(value), [value]);
  const [text, setText] = React.useState(initial);
  // State holds the FACT (the text does not parse), not the wording — so the
  // message is resolved at render and follows a locale switch instead of
  // freezing whatever language was active when the parse failed.
  const [invalid, setInvalid] = React.useState(false);
  React.useEffect(() => { setText(initial); setInvalid(false); }, [initial]);
  const commit = () => {
    if (disabled) return;
    const trimmed = text.trim();
    if (trimmed === '') { setInvalid(false); onCommit(undefined); return; }
    try {
      const parsed = JSON.parse(trimmed);
      setInvalid(false);
      onCommit(parsed);
    } catch {
      setInvalid(true);
    }
  };
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        disabled={disabled}
        placeholder={placeholder}
        spellCheck={false}
        rows={Math.min(12, Math.max(2, text.split('\n').length))}
        className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs font-mono outline-none focus:ring-1 focus:ring-primary resize-y disabled:opacity-60"
      />
      {/* Reuses the catalog's existing `engine.form.invalidJson` — the same key
          the shared `translateValidationMessage()` already maps `'invalid
          json'` onto — rather than minting a second wording for one fact. */}
      {invalid && <div className="text-[11px] text-destructive">{t('engine.form.invalidJson', locale)}</div>}
    </div>
  );
}

/** Renders one arbitrary block property by inferring an editor from its
 *  runtime type. Guarantees the inspector can edit anything visible in the
 *  source, even block types with no curated BLOCK_CONFIG entry. */
function GenericPropField({ name, value, onCommit, disabled, locale }: {
  name: string; value: unknown; onCommit: (v: unknown) => void; disabled?: boolean;
  locale: SupportedLocale;
}) {
  if (typeof value === 'boolean') {
    return <InspectorCheckboxField label={name} value={value} onCommit={onCommit} disabled={disabled} />;
  }
  if (typeof value === 'number') {
    return <InspectorNumberField label={name} value={value} onCommit={(v) => onCommit(v)} disabled={disabled} />;
  }
  if (value === null || typeof value === 'string') {
    return <InspectorTextField label={name} value={value == null ? '' : value} onCommit={onCommit} disabled={disabled} mono />;
  }
  return <InspectorJsonField label={name} value={value} onCommit={onCommit} disabled={disabled} locale={locale} />;
}

/**
 * A `color` block property: the swatch row plus the visible label that names it
 * (objectui#4010).
 *
 * Its own component, and not three lines inside `renderField`, for the id:
 * `role="radiogroup"` is not a labelable element, so the label has to name the
 * group by IDREF (`aria-labelledby`) rather than by `for`, and that id is minted
 * with `React.useId()` HERE because `renderField` runs in a LOOP over array
 * items (`keyPrefix`). A caller-derived id — the field name, the `keyPrefix`ed
 * key — is exactly what repeats across two array rows carrying the same
 * property, and a duplicated id resolves silently to the FIRST group
 * (objectui#3994's reasoning for minting inside the atoms, and hooks cannot be
 * called from `renderField` itself: it is a function run in a loop, not a
 * component).
 *
 * Unlike `DashboardWidgetInspector`'s `widget-color` this label never carried a
 * `for` at all, so nothing dangled here — the group was simply anonymous, with
 * the visible text beside it owned by no one.
 */
function ColorPropField({ label, value, onChange, disabled, options }: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  disabled?: boolean;
  options?: Array<{ value: string; label?: string }>;
}) {
  const labelId = React.useId();
  return (
    <div className="space-y-1">
      <Label id={labelId} className="text-xs text-muted-foreground">{label}</Label>
      <ColorVariantPicker
        ariaLabelledBy={labelId}
        value={value}
        onChange={onChange}
        disabled={disabled}
        options={options}
      />
    </div>
  );
}

/** Block `properties` keys whose values are nested block trees — these are
 *  edited visually on the canvas, so they are excluded from the generic
 *  property editor to avoid two conflicting editors for the same data.
 *
 *  ⚠️ `body` STAYS through objectui#6771's retirement: this is the inspector
 *  half of a stored `properties.body`, whose canvas half is in
 *  `previews/PageBlockCanvas.tsx`. Dropping it would hand a stored card's
 *  child tree to the generic property editor as raw JSON, beside the canvas
 *  editing the same data — the two conflicting editors this set exists to
 *  prevent. ⛔ Not an authorable key on either face; escalation objectui#9916. */
const STRUCTURAL_PROP_KEYS = new Set(['children', 'body']);

interface Block {
  type?: string;
  id?: string;
  className?: string;
  /**
   * Conditional visibility, SHOW-when-truthy (ADR-0089). This is the only key
   * `PageComponentSchema` (`.strict()`) accepts for it — `hidden` is not in the
   * key set at all, so a block carrying it is a loud parse failure on save
   * (objectui#3229). `ExpressionInput`, not `string`: the spec normalizes an
   * authored string into `{ dialect, source }`, so a persisted block carries
   * the envelope — read/write it through the shared pair.
   */
  visibleWhen?: ExpressionInput;
  children?: Block[];
  [k: string]: unknown;
}

/**
 * A path hop. `index < 0` means a plain object-property access (e.g.
 * `properties`); `index >= 0` adds an array index after the key (e.g.
 * `items[0]`). Supporting object hops lets us address nested container
 * children at `…components[0].properties.items[0].children[0]` (issue #1499).
 */
type Hop = { key: string; index: number };

export type PathSeg = string | number;
const REMOVE: unique symbol = Symbol('remove');

/** A segment is `key` (object) or `key[i]` (array). */
export function parsePath(id: string): Hop[] | null {
  const segs = id.split('.');
  const hops: Hop[] = [];
  for (const s of segs) {
    const m = /^([a-zA-Z_]\w*)(?:\[(\d+)\])?$/.exec(s);
    if (!m) return null;
    hops.push({ key: m[1], index: m[2] != null ? Number(m[2]) : -1 });
  }
  return hops.length > 0 ? hops : null;
}

/** Flatten hops to a JSON-pointer-like path: object key, then index if any. */
export function hopsToPath(hops: Hop[]): PathSeg[] {
  const p: PathSeg[] = [];
  for (const h of hops) {
    p.push(h.key);
    if (h.index >= 0) p.push(h.index);
  }
  return p;
}

export function getByPath(root: any, path: PathSeg[]): any {
  let node = root;
  for (const seg of path) {
    if (node == null) return null;
    node = node[seg as any];
  }
  return node ?? null;
}

/** Immutable set/remove along a path. `value === REMOVE` deletes the leaf. */
export function setByPath(root: any, path: PathSeg[], value: any): any {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (typeof head === 'number') {
    const arr = Array.isArray(root) ? [...root] : [];
    if (rest.length === 0) {
      if (value === REMOVE) arr.splice(head, 1);
      else arr[head] = value;
    } else arr[head] = setByPath(arr[head], rest, value);
    return arr;
  }
  const obj = { ...(root || {}) };
  if (rest.length === 0) {
    if (value === REMOVE) delete (obj as any)[head];
    else (obj as any)[head] = value;
  } else (obj as any)[head] = setByPath((obj as any)[head], rest, value);
  return obj;
}

export function readAt(root: Record<string, unknown>, hops: Hop[]): Block | null {
  return getByPath(root, hopsToPath(hops)) as Block | null;
}

/** Returns a shallow patch `{ [topKey]: newValue }` for onPatch. */
export function writeAt(root: Record<string, unknown>, hops: Hop[], replacement: Block | null): Record<string, unknown> {
  const path = hopsToPath(hops);
  const next = setByPath(root, path, replacement === null ? REMOVE : replacement);
  const topKey = path[0] as string;
  return { [topKey]: next[topKey] };
}

export function readSiblings(root: Record<string, unknown>, hops: Hop[]): { siblings: Block[]; index: number } | null {
  const path = hopsToPath(hops);
  const last = path[path.length - 1];
  if (typeof last !== 'number') return null;
  const siblings = getByPath(root, path.slice(0, -1));
  if (!Array.isArray(siblings)) return null;
  return { siblings: siblings as Block[], index: last };
}

export function writeSiblings(root: Record<string, unknown>, hops: Hop[], nextSiblings: Block[]): Record<string, unknown> {
  const path = hopsToPath(hops);
  const next = setByPath(root, path.slice(0, -1), nextSiblings);
  const topKey = path[0] as string;
  return { [topKey]: next[topKey] };
}

export function PageBlockInspector({ selection, draft, onPatch, onClearSelection, onSelectionChange, onBlockingIssuesChange, locale, readOnly }: MetadataInspectorProps) {
  // Slotted record page: selection ids are `slot:<name>:<index>` and address
  // `draft.slots.<name>` (a single component is normalised to a 1-element array).
  // `slot:<name>:<idx>` optionally followed by a nested sub-path within the
  // slot's block (e.g. `slot:tabs:0.properties.items[0].children[0]`), so a
  // block inside a slotted container is addressable too (issue #1499).
  const slotMatch = /^slot:([a-zA-Z_]+):(\d+)(?:\.(.+))?$/.exec(selection.id);
  const hops = slotMatch ? null : parsePath(selection.id);

  const slotName = slotMatch ? slotMatch[1] : '';
  const slotIdx = slotMatch ? Number(slotMatch[2]) : -1;
  const slotSub = slotMatch ? slotMatch[3] : undefined;
  const subHops = slotSub ? parsePath(slotSub) : null;
  const slotsObj: Record<string, any> =
    (draft as any).slots && typeof (draft as any).slots === 'object' ? ((draft as any).slots as Record<string, any>) : {};
  const slotArr: Block[] = slotMatch
    ? Array.isArray(slotsObj[slotName])
      ? (slotsObj[slotName] as Block[])
      : slotsObj[slotName] != null
        ? [slotsObj[slotName] as Block]
        : []
    : [];
  const slotBase: Block | null = slotMatch ? (slotArr[slotIdx] ?? null) : null;
  // Write the slot's whole array back (delete the base block when null).
  const writeSlot = (nextArr: Block[]) => onPatch({ slots: { ...slotsObj, [slotName]: nextArr } });
  const writeSlotBase = (nextBase: Block | null) =>
    writeSlot(nextBase === null ? slotArr.filter((_, i) => i !== slotIdx) : slotArr.map((b, i) => (i === slotIdx ? nextBase : b)));

  const block: Block | null = slotMatch
    ? subHops
      ? readAt((slotBase || {}) as any, subHops)
      : slotBase
    : hops
      ? readAt(draft, hops)
      : null;
  const sibInfo = slotMatch
    ? subHops
      ? readSiblings((slotBase || {}) as any, subHops)
      : { siblings: slotArr, index: slotIdx }
    : hops
      ? readSiblings(draft, hops)
      : null;

  /* ─── Blocking CEL verdicts → the host's Save gate (objectui#4527) ─────
   *
   * The visibility builder below authors `visibleWhen` through a
   * `CelPredicateField`; a predicate that does not parse must not be
   * saveable, let alone publishable as the live page definition (#4306's
   * defect, one inspector over).
   *
   * The count is STAMPED with the block it describes and the mismatch is
   * read as 0 at aggregation time, so a verdict that lands after the
   * selection moved cannot gate the block now on screen. Declared above the
   * `!block` early return — these are hooks, and their order must not depend
   * on the selection resolving to a live block. */
  const [celErrors, setCelErrors] = React.useState<{ block: string; count: number }>({
    block: selection.id,
    count: 0,
  });
  const reportCel = React.useCallback(
    (count: number) => {
      setCelErrors((prev) => {
        // A verdict that arrives after the selection moved describes the block
        // now on screen, not the one it was queued for.
        if (prev.block !== selection.id) return { block: selection.id, count };
        if (prev.count === count) return prev;
        return { block: selection.id, count };
      });
    },
    [selection.id],
  );
  const blockingIssues = celErrors.block === selection.id ? celErrors.count : 0;
  // Held in a ref so an unmemoized host callback cannot re-fire the effect.
  const onBlockingIssuesChangeRef = React.useRef(onBlockingIssuesChange);
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current = onBlockingIssuesChange;
  });
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current?.(blockingIssues);
  }, [blockingIssues]);

  if ((!slotMatch && !hops) || !block) {
    return (
      <InspectorShell kindLabel={t('engine.inspector.pageBlock.kind', locale)} title={selection.label ?? selection.id} onClose={onClearSelection} closeLabel={t('engine.inspector.pageBlock.close', locale)}>
        <InspectorEmptyState message={selection.id} />
      </InspectorShell>
    );
  }

  const patch = (updates: Partial<Block>) => {
    if (!slotMatch) return onPatch(writeAt(draft, hops!, { ...block, ...updates }));
    if (subHops) return writeSlotBase({ ...(slotBase as Block), ...writeAt((slotBase || {}) as any, subHops, { ...block, ...updates }) });
    return writeSlotBase({ ...block, ...updates });
  };

  // Per-block configurable properties (spec `properties`). The renderer hoists
  // `properties.*` to the top level, so we read from either and always write
  // back to `properties` (the canonical shape).
  //
  // Read through `stripRetiredBlockProps` (objectui#7772): a key a released
  // designer build wrote that the block's node schema now refuses BY NAME is
  // dropped HERE, which is the only place it can be dropped without a migration
  // pass. This is the single value every property write spreads from
  // (`patchProp` below), and it is also what `advancedKeys` enumerates — so a
  // retired key neither rides back out on the next save nor shows up in the
  // generic "Advanced" editor, which can set a value but never delete one. The
  // criterion for membership, and why this is a strip rather than a migration,
  // are on the constant itself.
  const blockProps = stripRetiredBlockProps(
    block.type as string | undefined,
    (block.properties as Record<string, unknown>) || {},
  );
  // The node-level `dataSource` binding (objectui#11880): a field marked
  // `at: 'dataSource'` reads and writes its member, patched at node level the
  // way `visibleWhen` is below, never under `properties`.
  const binding: Record<string, unknown> =
    block.dataSource && typeof block.dataSource === 'object' && !Array.isArray(block.dataSource)
      ? (block.dataSource as Record<string, unknown>)
      : {};
  const readBinding = (name: string): unknown => binding[name];
  const patchBinding = (name: string, value: unknown) =>
    patch({ dataSource: { ...binding, [name]: value } } as Partial<Block>);
  // The record page's bound object — drives `field-picker`/`field-list` with
  // objectFrom:'page'. (objectFrom:'self' reads a sibling block property, and
  // objectFrom:'dataSource' the binding's object.)
  const pageObject = typeof (draft as any)?.object === 'string' ? ((draft as any).object as string) : undefined;
  const resolveObject = (src: BlockPropField & { objectFrom?: string; objectProp?: string }): string | undefined =>
    src.objectFrom === 'page'
      ? pageObject
      : src.objectFrom === 'dataSource'
        ? (typeof binding.object === 'string' ? binding.object : undefined)
        : src.objectProp != null && blockProps[src.objectProp] != null
          ? String(blockProps[src.objectProp])
          : undefined;
  const readProp = (name: string): unknown => blockProps[name] ?? (block as any)[name];
  const patchProp = (name: string, value: unknown) =>
    patch({ properties: { ...blockProps, [name]: value } } as Partial<Block>);

  // Properties already handled by curated fields — excluded from the generic
  // "Advanced" section so each property has exactly one editor. A field homed
  // in the binding edits no `properties` key, so a stored `properties.<name>`
  // of the same name stays visible there rather than hidden behind it.
  const curatedNames = new Set(
    (blockHasConfig(block.type) ? BLOCK_CONFIG[block.type as string] : [])
      .filter((f) => f.at !== 'dataSource')
      .map((f) => f.name),
  );
  const advancedKeys = Object.keys(blockProps).filter(
    (key) => !curatedNames.has(key) && !STRUCTURAL_PROP_KEYS.has(key),
  );

  // Curated labels are translation KEYS, not display text (#3913). The panel's
  // chrome went through `t()` from the start while its contents did not, so a
  // zh-CN admin read 「属性」 over a stack of English field names. `t()` returns
  // the key unchanged when it is missing, so an untranslated field is loud in
  // every locale rather than silently English in one.
  const fieldLabel = (key: string) => t(key, locale);
  /** Option labels are keys too — translate before handing them to a picker. */
  const optionLabels = <T extends { value: string; label: string }>(options: T[]) =>
    options.map((o) => ({ ...o, label: t(o.label, locale) }));
  /**
   * Placeholders are a MIXED column (#3979) and the table says which kind each
   * one is: `{ key }` is prose about the value and goes through `t()`, `{ literal }`
   * is the value itself (a number, `https://…`, a JSON sample) and must reach the
   * DOM untouched. Resolving in one place is what keeps the four `placeholder=`
   * sites below from drifting apart — the panel's contents were English in a
   * zh-CN panel precisely because one column skipped the accessor.
   */
  const placeholderText = (p: PlaceholderSpec | undefined): string | undefined =>
    p === undefined ? undefined : p.key !== undefined ? t(p.key, locale) : p.literal;

  // Generic, recursive field renderer. `read`/`write` abstract the value source
  // (the block's `properties` at the top level, or an item object inside an
  // `array` field), so the same code drives nested array-item editors.
  const renderField = (
    f: BlockPropField,
    read: (name: string) => unknown,
    write: (name: string, value: unknown) => void,
    keyPrefix = '',
  ): React.ReactNode => {
    const k = `${keyPrefix}${f.name}`;
    switch (f.kind) {
      case 'number':
        return (
          <InspectorNumberField key={k} label={fieldLabel(f.label)}
            value={typeof read(f.name) === 'number' ? (read(f.name) as number) : undefined}
            placeholder={placeholderText(f.placeholder)} onCommit={(v) => write(f.name, v)} disabled={readOnly} />
        );
      case 'boolean':
        return (
          <InspectorCheckboxField key={k} label={fieldLabel(f.label)} value={!!read(f.name)}
            onCommit={(v) => write(f.name, v)} disabled={readOnly} />
        );
      case 'color':
        return (
          <ColorPropField
            key={k}
            label={fieldLabel(f.label)}
            value={read(f.name) != null ? String(read(f.name)) : undefined}
            onChange={(v) => write(f.name, v)}
            disabled={readOnly}
            options={f.options ? optionLabels(f.options) : undefined}
          />
        );
      case 'select':
        return (
          <InspectorSelectField key={k} label={fieldLabel(f.label)}
            value={read(f.name) != null ? String(read(f.name)) : undefined}
            options={optionLabels(f.options)} onCommit={(v) => write(f.name, v)} disabled={readOnly} />
        );
      case 'json':
        // Same editor the "Advanced" section uses, but reachable for a prop the
        // block does not have yet — Advanced enumerates existing keys only, so
        // without this a curated JSON prop could be edited and never added.
        return (
          <InspectorJsonField key={k} label={fieldLabel(f.label)} value={read(f.name)}
            placeholder={placeholderText(f.placeholder)} locale={locale}
            onCommit={(v) => write(f.name, v)} disabled={readOnly} />
        );
      case 'string-list': {
        const arr = Array.isArray(read(f.name)) ? (read(f.name) as unknown[]) : [];
        return (
          <div key={k} className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{fieldLabel(f.label)}</Label>
            {arr.map((s, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Input className="h-8 text-sm" value={String(s ?? '')} placeholder={placeholderText(f.placeholder)} disabled={readOnly}
                  onChange={(e) => { const next = [...arr]; next[i] = e.target.value; write(f.name, next); }} />
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={readOnly}
                  aria-label={t('engine.inspector.pageBlock.list.remove', locale)}
                  onClick={() => write(f.name, arr.filter((_, j) => j !== i))}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {!readOnly && (
              <Button type="button" variant="outline" size="sm" onClick={() => write(f.name, [...arr, ''])}>
                <Plus className="mr-1 h-3.5 w-3.5" /> {t('engine.inspector.pageBlock.list.add', locale)}
              </Button>
            )}
          </div>
        );
      }
      case 'array': {
        const arr = Array.isArray(read(f.name)) ? (read(f.name) as unknown[]) : [];
        return (
          <div key={k} className="space-y-2">
            <Label className="text-xs text-muted-foreground">{fieldLabel(f.label)}</Label>
            {arr.map((item, i) => {
              const itemObj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
              return (
                <div key={i} className="space-y-2 rounded-md border border-border p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">#{i + 1}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={readOnly}
                      aria-label={t('engine.inspector.pageBlock.list.removeItem', locale)}
                      onClick={() => write(f.name, arr.filter((_, j) => j !== i))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {f.itemFields.map((itf) =>
                    renderField(
                      itf,
                      (n) => itemObj[n],
                      (n, v) => { const next = [...arr]; next[i] = { ...itemObj, [n]: v }; write(f.name, next); },
                      `${k}-${i}-`,
                    ),
                  )}
                </div>
              );
            })}
            {!readOnly && (
              <Button type="button" variant="outline" size="sm" onClick={() => write(f.name, [...arr, {}])}>
                <Plus className="mr-1 h-3.5 w-3.5" /> {fieldLabel(f.addLabel)}
              </Button>
            )}
          </div>
        );
      }
      case 'object-picker':
        return (
          <ObjectPickerField key={k} label={fieldLabel(f.label)} locale={locale}
            value={read(f.name) != null ? String(read(f.name)) : undefined}
            onCommit={(v) => write(f.name, v)} disabled={readOnly} />
        );
      case 'field-picker':
        return (
          <FieldPickerField key={k} label={fieldLabel(f.label)} objectName={resolveObject(f)}
            value={read(f.name) != null ? String(read(f.name)) : undefined}
            onCommit={(v) => write(f.name, v)} disabled={readOnly} />
        );
      case 'field-list':
        return (
          <FieldListField key={k} label={fieldLabel(f.label)} objectName={resolveObject(f)} locale={locale}
            value={read(f.name)} onChange={(v) => write(f.name, v)} disabled={readOnly} />
        );
      default:
        return (
          <InspectorTextField key={k} label={fieldLabel(f.label)}
            value={read(f.name) != null ? String(read(f.name)) : ''}
            placeholder={placeholderText((f as { placeholder?: PlaceholderSpec }).placeholder)}
            onCommit={(v) => write(f.name, v)} disabled={readOnly} />
        );
    }
  };
  const remove = () => {
    if (slotMatch) {
      if (subHops) writeSlotBase({ ...(slotBase as Block), ...writeAt((slotBase || {}) as any, subHops, null) });
      else writeSlotBase(null);
    } else onPatch(writeAt(draft, hops!, null));
    onClearSelection();
  };
  // Re-serialise hops to an id, honouring object hops (index < 0 → no `[i]`).
  const fmtHops = (hs: Hop[]) => hs.map((h) => (h.index >= 0 ? `${h.key}[${h.index}]` : h.key)).join('.');
  const move = (to: number) => {
    if (!sibInfo) return;
    if (slotMatch) {
      if (subHops) {
        const next = moveArray(sibInfo.siblings, sibInfo.index, to);
        writeSlotBase({ ...(slotBase as Block), ...writeSiblings((slotBase || {}) as any, subHops, next) });
        const newSub = fmtHops([...subHops.slice(0, -1), { key: subHops[subHops.length - 1].key, index: to }]);
        onSelectionChange?.({ kind: 'block', id: `slot:${slotName}:${slotIdx}.${newSub}`, label: String(block.id || block.type || to) });
      } else {
        writeSlot(moveArray(slotArr, slotIdx, to));
        onSelectionChange?.({ kind: 'block', id: `slot:${slotName}:${to}`, label: String(block.id || block.type || to) });
      }
      return;
    }
    const next = moveArray(sibInfo.siblings, sibInfo.index, to);
    onPatch(writeSiblings(draft, hops!, next));
    const newId = fmtHops([...hops!.slice(0, -1), { key: hops![hops!.length - 1].key, index: to }]);
    onSelectionChange?.({ kind: 'block', id: newId, label: String(block.id || block.type || newId) });
  };

  return (
    <InspectorShell
      kindLabel={t('engine.inspector.pageBlock.kind', locale)}
      title={String(block.id || block.type || selection.id)}
      onClose={onClearSelection}
      closeLabel={t('engine.inspector.pageBlock.close', locale)}
      headerActions={sibInfo ? (
        <InspectorReorderButtons
          index={sibInfo.index}
          total={sibInfo.siblings.length}
          onMove={move}
          upLabel={t('engine.inspector.reorder.up', locale)}
          downLabel={t('engine.inspector.reorder.down', locale)}
          disabled={readOnly}
        />
      ) : undefined}
      footer={<InspectorRemoveButton label={t('engine.inspector.pageBlock.remove', locale)} onClick={remove} disabled={readOnly} />}
    >
      <InspectorTextField label={t('engine.inspector.pageBlock.type', locale)} value={block.type ?? ''} onCommit={(v) => patch({ type: v })} disabled={readOnly} mono />
      <InspectorTextField label={t('engine.inspector.pageBlock.id', locale)} value={block.id ?? ''} onCommit={(v) => patch({ id: v })} disabled={readOnly} mono />
      <InspectorTextField label={t('engine.inspector.pageBlock.className', locale)} value={block.className ?? ''} onCommit={(v) => patch({ className: v })} disabled={readOnly} mono />
      {/* Conditional visibility. The key is `visibleWhen` and the label says
          "Visible when" — the two must move together (objectui#3229). This
          control used to author `hidden`, a key `PageComponentSchema`
          (`.strict()`) does not have: the designer was mass-producing drafts
          the spec rejects on save, naming a key the author never typed.
          Renaming the key alone would have been worse than leaving it — a
          "hide when" label over a show-when-truthy key makes authors write
          the predicate backwards, i.e. metadata that PARSES and means the
          opposite (the objectui#3276 class, which #3257's parse guard is
          structurally blind to). No value is migrated: negating an arbitrary
          CEL predicate textually is unsound (`!(a && b)` is not `!a && !b`),
          and the spec's parse error already names `visibleWhen` as the fix.
          `visibleWhen` is `ExpressionInputSchema`, so it goes through the same
          envelope read/write pair as the hook / action guards (#3218). */}
      {/* ── This mount passes NO `scope`, and that is a measured verdict
          ────────────────────────────────────────────────────────────────────
          objectui#8167's ruling settled the RULE — a mount's lint scope is
          decided by what the evaluator binds at RUNTIME — and left this mount
          to a reading. The reading was taken, and its answer is that NEITHER
          lint scope expresses what this surface binds.

          What the renderer binds. A page block is a SDUI node: the designer
          canvas and the page preview both hand each block to `SchemaRenderer`
          (`previews/PageBlockCanvas.tsx` renders one per block), and
          `visibleWhen` is enforced once and generically inside it — its
          `shouldHide` short-circuits on `if (newSchema.visibleWhen !==
          undefined)` ahead of every other visibility leg. The evaluator that
          answers it is built in `@object-ui/react`'s `SchemaRenderer.tsx` as

              new ExpressionEvaluator({ ...predicateScope,
                current_user: …, ...( … ? { record: boundRecord } : null),
                page: pageVariables })

          ⇒ three roots: `record`, `current_user` AND `page.<var>`. That is
          also exactly what `@objectstack/spec` promises — `page.zod.ts`
          describes `visibleWhen` as *"Contract-bound roots: `record`,
          `current_user` … and page state as `page.<var>`"*, and its own worked
          example is `page.selectedProjectId != ''`.

          Why neither scope fits, measured on the installed
          `@objectstack/formula`, both directions:

            scope 'flattened' · "status == 'done'"                 -> clean
            scope 'flattened' · "page.selectedProjectId != ''"     -> clean
            scope 'record'    · "status == 'done'"                 -> error (right)
            scope 'record'    · "page.selectedProjectId != ''"     -> ERROR,
              "bare reference `page` … Write `record.page`."

          `flattened` accepts the bare-field shorthand this card is about — the
          row IS bound as `record` here, so `status == 'done'` never matches.
          But `record` refuses `page.<var>`: at that scope the validator runs
          its strict environment declaring exactly the engine's `SCOPE_ROOTS`,
          and `page` is not in that list, so a contract-bound predicate becomes
          a hard error prescribing the nonsense fix `record.page`. Worse than
          cosmetic: this inspector reports blocking CEL issues upward, and the
          host counts them, so that error would disable Save and auto-save
          while the block is selected.

          ⛔ So this mount deliberately passes nothing, and `flattened` is the
          less-wrong of two wrong answers here — an editor that over-accepts,
          rather than one that refuses what the spec documents. This is the
          objectui#8155 shape (`app` refused although bound), and the fix is
          not at this mount: `@objectstack/formula` needs either `page` among
          its scope roots or a per-surface root allowlist on
          `validateExpression`. Until then, ⛔ do not "settle" this mount by
          passing `'record'` — `ConditionBuilder.mountScope.test.tsx` holds a
          case that reddens if you do. */}
      <ConditionBuilder
        label={t('engine.inspector.pageBlock.visibleWhen', locale)}
        value={expressionSource(block.visibleWhen)}
        onCommit={(v) => patch({ visibleWhen: writeExpressionSource(block.visibleWhen, v) })}
        objectName={pageObject}
        disabled={readOnly}
        onBlockingIssuesChange={reportCel}
      />

      {blockHasConfig(block.type) && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('engine.inspector.pageBlock.properties', locale)}
          </div>
          {BLOCK_CONFIG[block.type as string].map((f) =>
            f.at === 'dataSource' ? renderField(f, readBinding, patchBinding) : renderField(f, readProp, patchProp),
          )}
        </div>
      )}

      {/* Generic fallback: any property present in the source but not covered
          by a curated field above. Without this, selecting a block with no (or
          partial) BLOCK_CONFIG left the inspector blank while source showed a
          full `properties` object — the "config panel ⇄ source" disconnect. */}
      {advancedKeys.length > 0 && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('engine.inspector.pageBlock.advanced', locale)}
          </div>
          {advancedKeys.map((key) => (
            <GenericPropField
              key={key}
              name={key}
              value={blockProps[key]}
              onCommit={(v) => patchProp(key, v)}
              disabled={readOnly}
              locale={locale}
            />
          ))}
        </div>
      )}
    </InspectorShell>
  );
}
