// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio nav item inspector and the pickers it draws with: moved out of
 * `StudioDesignSurface.tsx` unchanged by objectstack#29988 (slice 1 of the
 * move-only split). `StudioDesignSurface.tsx` re-exports the inspector.
 */

import * as React from 'react';
import { extractDraftBody } from '@object-ui/data-objectstack';
import type { MetadataClient } from '@object-ui/data-objectstack';
import type { I18nLabel } from '@objectstack/spec/ui';
import { isPlainRecord } from '@objectstack/spec/data';
import {
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import { Trash2 } from 'lucide-react';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
import { t, tFormat, useMetadataLocale } from '../metadata-admin/i18n.js';
import { IconPickerWidget } from '../metadata-admin/widgets.js';
import { navPayloadOf } from '../metadata-admin/previews/AppNavCanvas.js';
import {
  clearedLabel,
  inheritedNavEntryText,
  navItemLabelText,
  renamedLabel,
  type NavEntryLike,
} from '../metadata-admin/previews/navItemLabel.js';
import { useNavTargetLabel } from '../../hooks/useNavTargetLabel.js';
import { listAppComponents } from '../../services/componentRegistry.js';
import {
  NAV_ENTRY_TYPES,
  OBJECT_MODE_FIELDS,
  OBJECT_TARGET_MODES,
  deriveObjectTargetMode,
  isNavEntryType,
  isStaticPageOption,
  navEntryOffersField,
  navTypeAcceptsChildren,
  retypedNavEntry,
  type ObjectTargetMode,
} from '../metadata-admin/inspectors/nav-target.js';
import { FiltersEditor } from '../metadata-admin/inspectors/NavFiltersEditor.js';
import { CelPredicateField } from '../metadata-admin/CelPredicateField.js';
import type { CelLintIssue } from '../metadata-admin/celAuthoring.js';
import type { NavigationEntryItem, NavigationItemType } from '@object-ui/types';

/** The keys an `object` entry's landings own besides its `objectName` (`OBJECT_MODE_FIELDS`). */
const OBJECT_LANDING_KEYS = ['viewName', 'recordId', 'recordMode', 'filters'] as const;

/**
 * A nav entry's `visible` as editable CEL text: the bare string, or a CEL
 * envelope's `source`, and `''` when absent. `null` for an envelope with no
 * CEL `source`, which the inspector shows read-only.
 */
function navVisibleText(visible: unknown): string | null {
  if (visible === undefined) return '';
  if (typeof visible === 'string') return visible;
  if (isPlainRecord(visible) && (visible.dialect === undefined || visible.dialect === 'cel') && typeof visible.source === 'string') {
    return visible.source;
  }
  return null;
}

type NavBadgeVariant = NonNullable<NavigationEntryItem['badgeVariant']>;

/**
 * The badge variants the spec declares, keyed by the spec-derived type, so a
 * variant it adds or drops stops this file compiling until the table follows.
 */
const NAV_BADGE_VARIANT_TABLE: Record<NavBadgeVariant, true> = {
  default: true,
  secondary: true,
  destructive: true,
  outline: true,
};
const NAV_BADGE_VARIANTS = Object.keys(NAV_BADGE_VARIANT_TABLE) as ReadonlyArray<NavBadgeVariant>;

/** Interfaces pillar — real App nav · live canvas · inspector. */
/**
 * StudioNavItemInspector — right-panel editor for the selected nav item while
 * editing an app's navigation. The Studio adds flat top-level items
 * (`navigation[i]`), so binding is a business-friendly picker per type (below,
 * objectui#11790) rather than the raw path field of the generic
 * AppNavInspector. For an `object` entry, picking an object
 * writes `{ type: 'object', objectName }` (which the runtime resolves to that
 * object's record list) and leaves the label as it is (objectui#11196, the
 * shape `AppNavInspector`'s picker has). A label-less entry stays label-less,
 * a standard one (objectui#11201, ruling B): its absent label inherits the
 * object's current label at render time, in the viewer's language. It used to
 * adopt the object's label here, stored as a copy (the machine name for a
 * draft or unlabelled object), and then to remove a "New item" placeholder
 * label; the canvas now births an entry label-less (`AppNavCanvas`), so there
 * is no placeholder left to recognise. A present label renders verbatim, so a
 * label the author typed, a locale map, and a legacy stored "New item" are all
 * kept as authored.
 * The comment used to say it writes `{ object }` — the bare
 * spelling `AppSchema` answers with `unrecognized_keys`; the code has always
 * written the canonical key and cleared `object` (objectui#4881).
 *
 * The Label input edits the item's `label`, an `I18nLabel` (a plain string or
 * an inline locale map), through the same `navItemLabel` module as the canvas
 * card beside it (objectui#11148) and `AppNavInspector`'s Label field
 * (objectui#11196), so the three cannot disagree. Its VALUE is the authored
 * text in the designer locale, and its PLACEHOLDER the text the entry inherits
 * (`inheritedNavEntryText`, the runtime's rule with the console's resolver),
 * never a stored value. Typing writes an author label; an edit of a map writes
 * only that locale's entry and keeps every other one. Emptying the field
 * restores inheritance: `clearedLabel` answers what is left, and when that is
 * nothing the `label` key is REMOVED, never written as `''`. It used to read
 * `String(label ?? title ?? name)`, so a map showed as `[object Object]`, and
 * one keystroke wrote a string over the whole map; until objectui#11196 an
 * emptied field wrote `label: ''`, an entry that then showed nothing instead of
 * inheriting. `title` / `name` are not nav-item keys and are not read as the
 * label.
 *
 * Every type the spec declares (objectui#11790). The nav editor's *Add nav
 * item* births an `object` entry and selects it; this inspector's Type choice
 * then offers exactly the members of the spec's `NavigationItemSchema`
 * (`NAV_ENTRY_TYPES`, keyed by the spec-derived `NavigationItemType`). A change
 * of type keeps what describes the entry and drops what it opened
 * (`retypedNavEntry`), so every write is a shape the spec's strict member for
 * that type takes. Each target-bearing type then picks its target from what the
 * package already has — its pages, dashboards, reports, actions, docs and
 * books, published and draft alike, as the object picker reads the pillar's
 * objects — or, for a `component`, from the screens registered with this
 * console; a `url` is typed. A `group` made here is born with no children
 * (this editor edits top-level entries only, so nothing is nested under it
 * from here), and a `separator` carries no label. An entry holding children
 * changes only to a type that keeps them. An
 * entry whose target is not picked yet, or is cleared, stays in the editor and
 * is left out of what a save sends (`navPayloadOf`, objectui#11776).
 *
 * The keys the spec declares beyond the target (objectstack#26740), each
 * offered on exactly the members that declare it, so nothing typed here is a
 * key a strict member refuses. An `object` entry's landing is ONE choice — the
 * object's default, a named view (`viewName`), a record (`recordId`, with
 * `recordMode`) or a URL-filtered slice (`filters`, through the rows editor
 * Setup's `AppNavInspector` mounts) — because the spec refuses `filters`
 * beside either of the others; a change of landing removes the other
 * landings' keys, and `runAction` with them when the landing becomes a record,
 * which the spec refuses it beside. The landing is read off the keys the entry
 * holds (`deriveObjectTargetMode`, the runtime's precedence); one just chosen
 * holds no key until its value is entered, so that choice is kept for this
 * entry meanwhile. The shared base's `badge` / `badgeVariant`, `order` and
 * `visible` are offered on every member that declares them
 * (`navEntryOffersField`; a separator takes only its `order`). Each field
 * writes its key as the spec spells it — an `order` as a number — and an
 * emptied one REMOVES the key, never writes `''`.
 *
 * `visible` is a CEL condition, authored in the `CelPredicateField` every
 * other Studio predicate is authored in (the Data pillar's, the page block
 * inspector's). Its text reaches the entry only while its lint finds no
 * error: an unparseable condition is never written, so the nav autosave can
 * never send one; the entry keeps its previous condition meanwhile, and the
 * field says so. A `visible` this field cannot edit (an envelope with no CEL
 * `source`) is shown as authored, read-only, as before.
 *
 * Exported for tests (`StudioDesignSurface.navItemInspector.test.tsx`) — the
 * object picker's canonical-key binding is pinned there directly rather than
 * by driving the whole pillar. Not re-exported from the package index.
 */
export function StudioNavItemInspector({
  navId,
  appDraft,
  objects,
  packageId,
  pairId = null,
  onNavPatch,
  onClear,
}: {
  navId: string;
  appDraft: Record<string, unknown>;
  /**
   * The object picker's choices. objectstack#30059 — `pair` marks an object
   * only the base's paired customization package holds.
   */
  objects: Array<{ name: string; label: string; pair?: true }>;
  /** The package whose items the non-object pickers offer (objectui#11790). */
  packageId: string;
  /**
   * objectstack#30059 — on a read-only base, its paired customization package:
   * the non-object pickers offer its items too, after the base's, as the
   * pillar's object list offers its objects (`withPairItems`).
   */
  pairId?: string | null;
  onNavPatch: (patch: Record<string, unknown>) => void;
  onClear: () => void;
}): React.ReactElement {
  const locale = useMetadataLocale();
  // The console's own resolver for what a label-less entry inherits.
  const targetLabel = useNavTargetLabel();
  const typeGroupName = React.useId();
  const iconFieldId = React.useId();
  const objectFieldId = React.useId();
  const labelFieldId = React.useId();
  const landingFieldId = React.useId();
  const recordIdFieldId = React.useId();
  const recordModeFieldId = React.useId();
  const badgeFieldId = React.useId();
  const badgeVariantFieldId = React.useId();
  const orderFieldId = React.useId();
  const visibleFieldId = React.useId();
  const idx = React.useMemo(() => {
    const m = /^navigation\[(\d+)\]$/.exec(navId);
    return m ? Number(m[1]) : -1;
  }, [navId]);
  const nav = React.useMemo(
    () => (Array.isArray(appDraft.navigation) ? (appDraft.navigation as Array<Record<string, unknown>>) : []),
    [appDraft],
  );
  const node = idx >= 0 ? nav[idx] : null;
  // A type the spec declares, else `null`: an untyped entry (what an object
  // unbind leaves) or a spelling no member declares.
  const kind: NavigationItemType | null = node && isNavEntryType(node.type) ? node.type : null;
  // Hooks run before the not-found return below; `undefined` fetches nothing.
  const targets = usePackageNavTargets(packageId, kind ? NAV_TARGET_METADATA[kind] : undefined, pairId);
  const books = usePackageNavTargets(packageId, kind === 'doc' ? 'book' : undefined, pairId);
  // objectstack#26740 — an `object` entry's landing, read off the keys it
  // holds; a landing chosen but not yet given its value is kept here, for this
  // entry and this object only.
  const landingKey = `${navId}:${node && kind === 'object' ? String(node.objectName ?? '') : ''}`;
  const [landingChoice, setLandingChoice] = React.useState<{ key: string; mode: ObjectTargetMode } | null>(null);
  const heldLanding: ObjectTargetMode = node && kind === 'object' ? deriveObjectTargetMode(node) : 'default';
  const landing: ObjectTargetMode =
    heldLanding !== 'default' ? heldLanding : landingChoice?.key === landingKey ? landingChoice.mode : 'default';
  const views = usePackageNavTargets(packageId, kind === 'object' && landing === 'view' ? 'view' : undefined, pairId);
  // The `visible` condition as editable CEL text: the bare string, or an
  // envelope's CEL `source`; `null` for an envelope this field cannot edit.
  const heldVisible: string | null = node ? navVisibleText(node.visible) : '';
  // Text typed into the condition that has not reached the entry (its lint
  // found an error), stamped with the entry and the condition it was typed
  // over, so it expires when either changes.
  const visibleKey = JSON.stringify([navId, heldVisible]);
  const [visibleTyped, setVisibleTyped] = React.useState<{ key: string; text: string; errors: number } | null>(null);
  const typed = visibleTyped?.key === visibleKey ? visibleTyped : null;
  if (!node) {
    return (
      <div className="px-2 py-10 text-center text-xs text-muted-foreground">{t('engine.studio.nav.selectItem', locale)}</div>
    );
  }
  const patch = (updates: Record<string, unknown>) => {
    onNavPatch({ navigation: nav.map((n, i) => (i === idx ? { ...n, ...updates } : n)) });
  };
  /** Replace the entry whole: a write that must leave no key behind. */
  const replace = (next: Record<string, unknown>) => {
    onNavPatch({ navigation: nav.map((n, i) => (i === idx ? next : n)) });
  };
  /**
   * Set the entry's target `key`, or remove it when `value` is empty. ⛔ Never
   * written as `''`: a key holding a string is a target the save sends
   * (`navPayloadOf`), and an emptied picker means the entry is unbound again.
   */
  const setTarget = (key: string, value: string) => {
    const next = { ...node };
    if (value) next[key] = value;
    else delete next[key];
    replace(next);
  };
  /** An `action` entry's target is the action it runs: `actionDef.actionName`. */
  const setAction = (actionName: string) => {
    const next = { ...node };
    if (actionName) next.actionDef = { actionName };
    else delete next.actionDef;
    replace(next);
  };
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  // Canonical key FIRST (objectui#4881). `object` is a spelling `AppSchema`
  // rejects with `unrecognized_keys`, so it can only ever appear on a draft
  // that cannot be saved; when a draft carries both, the picker must show the
  // key the schema accepts, never the one it refuses. Whether the fallback
  // read should exist at all — a draft carrying `object` ALONE still displays
  // as bound — is a follow-up card's question, deliberately left out of #4881's scope.
  const boundObject = String(node.objectName ?? node.object ?? '');
  const label = node.label as I18nLabel | undefined;
  /**
   * The Label field's edit (objectui#11196). Typing writes an author label
   * (`renamedLabel`: a map changes only the designer locale's entry). Emptying
   * the field restores inheritance: `clearedLabel` answers what is left, and
   * when that is nothing the `label` key is REMOVED, never written as `''`.
   */
  const editLabel = (value: string) => {
    const next = value === '' ? clearedLabel(label, locale) : renamedLabel(label, value, locale);
    onNavPatch({
      navigation: nav.map((n, i) => {
        if (i !== idx) return n;
        if (next !== undefined) return { ...n, label: next };
        const rest = { ...n };
        delete rest.label;
        return rest;
      }),
    });
  };
  /**
   * Binding an object to this entry. The label is not touched: a label-less
   * entry stays label-less and inherits the object's label (objectui#11201),
   * and a present one renders verbatim (objectui#11196).
   */
  const bindObject = (objName: string) => {
    // Emit a spec-complete ObjectNavItem: the app schema's nav is a
    // discriminated union on `type` and BaseNavItem requires a snake_case
    // `id`. Missing either fails "navigation.0: Invalid input" at save.
    // `object`/`path` are cleared so no stray keys linger from an off-spec
    // draft.
    patch({
      id: (node.id as string) || `nav_${objName}`,
      type: 'object',
      objectName: objName,
      object: undefined,
      path: undefined,
      ...gatePatch(objName),
    });
  };
  /**
   * objectstack#30059 — the `requiresObject` an entry bound to `objName`
   * carries. An object only the pair holds can be removed while the copied
   * navigation still names it, so the entry gates on it and the runtime hides
   * it then instead of linking to a missing object. A gate this binding wrote
   * (it names the object bound before) is removed when the entry binds to an
   * object the base ships or is unbound; an author's own gate is kept.
   */
  const gatePatch = (objName: string): { requiresObject?: unknown } => {
    if (objName && objects.some((o) => o.name === objName && o.pair === true)) return { requiresObject: objName };
    // No key at all unless a gate this binding wrote is to be removed: an entry
    // with no gate, or the author's own, is left as it was.
    return boundObject !== '' && node.requiresObject === boundObject ? { requiresObject: undefined } : {};
  };
  const optionsOf = (rows: ReadonlyArray<NavTargetRow>) =>
    rows.map((row) => {
      const text = navItemLabelText(row.label, locale).trim();
      return { value: row.name, label: text && text !== row.name ? `${text} (${row.name})` : row.name };
    });
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const actionDef = node.actionDef as { actionName?: unknown } | undefined;
  /**
   * objectstack#26740 — choose an `object` entry's landing: keep the keys that
   * landing owns (`OBJECT_MODE_FIELDS`) and remove the other landings' keys,
   * which the spec refuses beside it; a record landing also removes
   * `runAction`, which auto-runs on the LIST surface and is refused beside a
   * `recordId`. A filtered slice starts with no conditions.
   */
  const chooseLanding = (mode: ObjectTargetMode) => {
    const keep: ReadonlyArray<string> = OBJECT_MODE_FIELDS[mode];
    const next = { ...node };
    for (const key of OBJECT_LANDING_KEYS) if (!keep.includes(key)) delete next[key];
    if (mode === 'record') delete next.runAction;
    if (mode === 'filters' && !isPlainRecord(next.filters)) next.filters = {};
    setLandingChoice({ key: landingKey, mode });
    replace(next);
  };
  /** `order` as the number the spec declares; an emptied field removes the key, and a non-number writes nothing. */
  const setOrder = (value: string) => {
    if (value.trim() === '') return setTarget('order', '');
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    replace({ ...node, order: n });
  };
  /**
   * The condition the author typed. It is written when its lint finds no error
   * (`onVisibleLint`), so until then it is held here; an emptied field is
   * written at once, as the removal of `visible`.
   */
  const editVisible = (text: string) => {
    setVisibleTyped({ key: visibleKey, text, errors: 0 });
  };
  /** Write `text` as the entry's `visible`, in the form the entry holds it: a bare string, or the envelope's `source`. */
  const writeVisible = (text: string) => {
    const next = { ...node };
    if (text.trim() === '') delete next.visible;
    else if (isPlainRecord(node.visible)) next.visible = { ...node.visible, source: text };
    else next.visible = text;
    replace(next);
  };
  const onVisibleLint = (issues: CelLintIssue[]) => {
    if (!typed) return;
    const errors = issues.filter((i) => i.severity === 'error').length;
    if (errors === 0) {
      if (typed.text !== heldVisible) writeVisible(typed.text);
      return;
    }
    if (errors !== typed.errors) setVisibleTyped({ ...typed, errors });
  };
  const visibleShown = typed ? typed.text : (heldVisible ?? '');
  const visibleHeldBack = !!typed && typed.errors > 0 && typed.text !== heldVisible;
  // Whether the entry names a target for its type yet (a group and a
  // separator name none, and are never unbound). A `report` entry is never
  // unbound: with no `reportName` it opens the app's report index
  // (objectstack#27525).
  const unbound =
    (kind === 'page' && !str(node.pageName)) ||
    (kind === 'dashboard' && !str(node.dashboardName)) ||
    (kind === 'url' && !str(node.url)) ||
    (kind === 'component' && !str(node.componentRef)) ||
    (kind === 'action' && !str(actionDef?.actionName)) ||
    (kind === 'doc' && !str(node.doc) && !str(node.book));
  // objectui#11862 — an entry that names no target yet inherits only its
  // minted `id`; the field offers the editor's untitled wording instead, as the
  // rail names that entry, never `nav_item_N`. "No target" is the save's own
  // rule (`navPayloadOf`).
  const placeholderText =
    navPayloadOf([node]).length === 0
      ? tFormat('engine.appNav.item', locale, { n: idx + 1 })
      : inheritedNavEntryText(node as NavEntryLike, targetLabel);
  const labelField = (
    <div>
      <label htmlFor={labelFieldId} className="mb-1 block text-[11px] font-medium text-muted-foreground">
        {t('engine.studio.nav.label', locale)}
      </label>
      <input
        id={labelFieldId}
        value={navItemLabelText(label, locale)}
        onChange={(e) => editLabel(e.target.value)}
        placeholder={placeholderText}
        className="w-full rounded border bg-background px-2 py-1 text-xs"
      />
    </div>
  );
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-1 block text-[11px] font-medium text-muted-foreground">
          {t('engine.inspector.appNav.typeField', locale)}
        </legend>
        <div className="flex flex-wrap gap-1">
          {NAV_ENTRY_TYPES.map((type) => {
            // An entry holding children changes only to a type that keeps them.
            const disabled = hasChildren && !navTypeAcceptsChildren(type);
            return (
              <label key={type} className={cn('relative', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}>
                <input
                  type="radio"
                  name={typeGroupName}
                  value={type}
                  checked={kind === type}
                  disabled={disabled}
                  onChange={() => replace(retypedNavEntry(node, type))}
                  className="peer sr-only"
                />
                <span className="inline-flex rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-foreground peer-focus-visible:ring-1 peer-focus-visible:ring-ring">
                  {t(`engine.inspector.appNav.type.${type}`, locale)}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {(kind === 'object' || kind === null) && (
        <div>
          <label htmlFor={objectFieldId} className="mb-1 block text-[11px] font-medium text-muted-foreground">
            {t('engine.studio.nav.linkObject', locale)}
          </label>
          <StudioPicker
            id={objectFieldId}
            value={boundObject}
            options={[
              { value: '', label: t('engine.studio.nav.chooseObject', locale) },
              ...objects.map((o) => ({ value: o.name, label: `${o.label} (${o.name})` })),
            ]}
            onPick={(objName) => {
              if (!objName) {
                // Unbind → back to an (invalid, dropped-on-save) placeholder.
                patch({ type: undefined, objectName: undefined, object: undefined, ...gatePatch('') });
                return;
              }
              bindObject(objName);
            }}
            className={PICKER_XS}
            testId="nav-link-object"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {boundObject ? t('engine.studio.nav.boundHint', locale) : t('engine.studio.nav.unboundHint', locale)}
          </p>
          {objects.length === 0 && (
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
              {t('engine.studio.nav.noObjects', locale)}
            </p>
          )}
        </div>
      )}
      {kind === 'object' && boundObject && (
        // objectstack#26740 — where the entry lands on its object: one choice
        // (`chooseLanding`), then that landing's own keys.
        <div className="space-y-2">
          <div>
            <label htmlFor={landingFieldId} className="mb-1 block text-[11px] font-medium text-muted-foreground">
              {t('engine.inspector.appNav.targetMode', locale)}
            </label>
            <StudioPicker
              id={landingFieldId}
              value={landing}
              options={OBJECT_TARGET_MODES.map((mode) => ({ value: mode, label: t(`engine.inspector.appNav.mode.${mode}`, locale) }))}
              onPick={(mode) => chooseLanding(mode as ObjectTargetMode)}
              className={PICKER_XS}
              testId="nav-landing"
            />
          </div>
          {landing === 'view' && (
            // The package's views of THIS object: a view item is named `<object>.<key>`.
            <NavTargetSelect
              label={t('engine.inspector.appNav.view', locale)}
              value={str(node.viewName)}
              options={optionsOf(views.rows.filter((row) => row.name.startsWith(`${boundObject}.`)))}
              loading={views.loading}
              onPick={(v) => setTarget('viewName', v)}
              locale={locale}
            />
          )}
          {landing === 'record' && (
            <>
              <div>
                <label htmlFor={recordIdFieldId} className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  {t('engine.inspector.appNav.recordId', locale)}
                </label>
                <input
                  id={recordIdFieldId}
                  value={str(node.recordId)}
                  onChange={(e) => setTarget('recordId', e.target.value)}
                  className="w-full rounded border bg-background px-2 py-1 font-mono text-xs"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">{t('engine.inspector.appNav.recordIdHint', locale)}</p>
              </div>
              <div>
                <label htmlFor={recordModeFieldId} className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  {t('engine.inspector.appNav.recordMode', locale)}
                </label>
                {/* An absent `recordMode` opens the record in view mode, the spec's default. */}
                <StudioPicker
                  id={recordModeFieldId}
                  value={str(node.recordMode) || 'view'}
                  options={[
                    { value: 'view', label: t('engine.inspector.appNav.recordModeView', locale) },
                    { value: 'edit', label: t('engine.inspector.appNav.recordModeEdit', locale) },
                  ]}
                  onPick={(v) => setTarget('recordMode', v)}
                  className={PICKER_XS}
                />
              </div>
            </>
          )}
          {landing === 'filters' && (
            <FiltersEditor
              objectName={boundObject}
              filters={isPlainRecord(node.filters) ? (node.filters as Record<string, string>) : {}}
              onCommit={(next) => replace({ ...node, filters: next })}
              locale={locale}
            />
          )}
        </div>
      )}
      {(kind === 'page' || kind === 'dashboard' || kind === 'report') && (
        <NavTargetSelect
          label={t(`engine.inspector.appNav.type.${kind}`, locale)}
          value={str(node[NAV_TARGET_KEY[kind]])}
          options={optionsOf(targets.rows)}
          loading={targets.loading}
          onPick={(v) => setTarget(NAV_TARGET_KEY[kind], v)}
          // objectstack#27525 — a `report` entry with no `reportName` is the
          // app's report index: its empty face says so, and picking it
          // removes the key.
          {...(kind === 'report'
            ? {
                emptyLabel: t('engine.inspector.appNav.reportIndex', locale),
                hint: str(node.reportName) ? undefined : t('engine.inspector.appNav.reportIndexHint', locale),
              }
            : {})}
          locale={locale}
        />
      )}
      {kind === 'action' && (
        <NavTargetSelect
          label={t('engine.inspector.appNav.type.action', locale)}
          value={str(actionDef?.actionName)}
          options={optionsOf(targets.rows)}
          loading={targets.loading}
          onPick={setAction}
          hint={t('engine.inspector.appNav.actionHint', locale)}
          locale={locale}
        />
      )}
      {kind === 'component' && (
        <NavTargetSelect
          label={t('engine.inspector.appNav.type.component', locale)}
          value={str(node.componentRef)}
          options={listAppComponents().map((c) => ({
            value: c.ref,
            label: c.label && c.label !== c.ref ? `${c.label} (${c.ref})` : c.ref,
          }))}
          loading={false}
          onPick={(v) => setTarget('componentRef', v)}
          locale={locale}
        />
      )}
      {kind === 'doc' && (
        <>
          <NavTargetSelect
            label={t('engine.inspector.appNav.docPage', locale)}
            value={str(node.doc)}
            options={optionsOf(targets.rows)}
            loading={targets.loading}
            onPick={(v) => setTarget('doc', v)}
            locale={locale}
          />
          <NavTargetSelect
            label={t('engine.inspector.appNav.book', locale)}
            value={str(node.book)}
            options={optionsOf(books.rows)}
            loading={books.loading}
            onPick={(v) => setTarget('book', v)}
            hint={t('engine.inspector.appNav.docHint', locale)}
            locale={locale}
          />
        </>
      )}
      {kind === 'url' && (
        <NavUrlFields
          url={str(node.url)}
          target={str(node.target) || '_self'}
          onUrl={(v) => setTarget('url', v)}
          onTarget={(v) => setTarget('target', v)}
          locale={locale}
        />
      )}
      {unbound && <p className="text-[11px] text-muted-foreground">{t('engine.inspector.appNav.unboundHint', locale)}</p>}
      {kind === 'group' && <p className="text-[11px] text-muted-foreground">{t('engine.inspector.appNav.groupHint', locale)}</p>}
      {navEntryOffersField(kind, 'label') ? (
        labelField
      ) : (
        <p className="text-[11px] text-muted-foreground">{t('engine.inspector.appNav.separatorHint', locale)}</p>
      )}
      {navEntryOffersField(kind, 'icon') && (
        // objectui#12455 — the entry's own `icon`, a Lucide name, as the rail
        // and the running sidebar draw it, picked from the catalog with the
        // console's icon picker (a preview beside the name). Clearing it
        // removes the key (the rail then falls back to the target's icon),
        // never writes `''`.
        <div>
          <label htmlFor={iconFieldId} className="mb-1 block text-[11px] font-medium text-muted-foreground">
            {t('engine.studio.nav.icon', locale)}
          </label>
          <IconPickerWidget
            id={iconFieldId}
            schema={{ type: 'string' }}
            value={str(node.icon)}
            onChange={(v) => setTarget('icon', typeof v === 'string' ? v : '')}
          />
        </div>
      )}
      {navEntryOffersField(kind, 'badge') && (
        // objectstack#26740 — the spec's `badge` (text or a count) and its
        // `badgeVariant`, drawn as the rail and the running sidebar draw them;
        // an absent variant is `Badge`'s own default.
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={badgeFieldId} className="mb-1 block text-[11px] font-medium text-muted-foreground">
              {t('engine.inspector.appNav.badge', locale)}
            </label>
            <input
              id={badgeFieldId}
              value={node.badge == null ? '' : String(node.badge)}
              onChange={(e) => setTarget('badge', e.target.value)}
              className="w-full rounded border bg-background px-2 py-1 text-xs"
            />
          </div>
          <div>
            <label htmlFor={badgeVariantFieldId} className="mb-1 block text-[11px] font-medium text-muted-foreground">
              {t('engine.inspector.appNav.badgeVariant', locale)}
            </label>
            <StudioPicker
              id={badgeVariantFieldId}
              value={str(node.badgeVariant) || 'default'}
              options={NAV_BADGE_VARIANTS.map((v) => ({ value: v, label: t(`engine.inspector.appNav.badgeVariant.${v}`, locale) }))}
              onPick={(v) => setTarget('badgeVariant', v)}
              className={PICKER_XS}
            />
          </div>
          <p className="col-span-2 text-[11px] text-muted-foreground">{t('engine.inspector.appNav.badgeHint', locale)}</p>
        </div>
      )}
      {navEntryOffersField(kind, 'order') && (
        // objectstack#26740 — the spec's `order`, which the running menu sorts
        // each level by (lower first, an absent one as 0).
        <div>
          <label htmlFor={orderFieldId} className="mb-1 block text-[11px] font-medium text-muted-foreground">
            {t('engine.inspector.appNav.order', locale)}
          </label>
          <input
            id={orderFieldId}
            type="number"
            value={typeof node.order === 'number' ? String(node.order) : ''}
            onChange={(e) => setOrder(e.target.value)}
            className="w-24 rounded border bg-background px-2 py-1 text-xs"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">{t('engine.inspector.appNav.orderHint', locale)}</p>
        </div>
      )}
      {navEntryOffersField(kind, 'visible') &&
        (heldVisible === null ? (
          // objectui#12455 — a `visible` with no CEL `source` to edit, shown as authored.
          <div>
            <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{t('engine.studio.nav.visibleWhen', locale)}</span>
            <p className="break-all rounded border bg-muted/40 px-2 py-1.5 font-mono text-xs" data-testid="nav-visible-when">
              {JSON.stringify(node.visible)}
            </p>
          </div>
        ) : (
          // objectstack#26740 — the entry's `visible` condition, linted as every
          // Studio predicate is; written only once its lint finds no error.
          // The roots offered are the ones the console binds for it (`data`
          // only on an entry that declares the `dataSource` it reads).
          <div>
            <CelPredicateField
              id={visibleFieldId}
              label={t('engine.studio.nav.visibleWhen', locale)}
              value={visibleShown}
              onChange={editVisible}
              onLintChange={onVisibleLint}
              roots={node.dataSource ? ['current_user', 'data'] : ['current_user']}
              placeholder="'org_admin' in current_user.positions"
              t={(key) => t(key, locale)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{t('engine.inspector.appNav.visibleHint', locale)}</p>
            {visibleHeldBack && (
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400" data-testid="nav-visible-held">
                {t('engine.inspector.appNav.visibleNotSaved', locale)}
              </p>
            )}
          </div>
        ))}
      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <button
          type="button"
          data-testid="nav-remove-item"
          onClick={() => {
            onNavPatch({ navigation: nav.filter((_, i) => i !== idx) });
            onClear();
          }}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-destructive/40 px-2.5 text-xs text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          {t('engine.appNav.removeItem', locale)}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        >
          {t('engine.studio.deselect', locale)}
        </button>
      </div>
    </div>
  );
}

/** A nav target the package holds: its machine name and, when published, its label. */
interface NavTargetRow {
  name: string;
  label?: I18nLabel;
}

/**
 * The metadata type each target-bearing nav type picks its target from
 * (objectui#11790). `object` reads the pillar's own object list, `component`
 * the component registry, and a `url` is typed; a `doc` entry also picks a
 * `book`.
 */
const NAV_TARGET_METADATA: Partial<Record<NavigationItemType, string>> = {
  page: 'page',
  dashboard: 'dashboard',
  report: 'report',
  action: 'action',
  doc: 'doc',
};

/** The key a `page` / `dashboard` / `report` entry names its target with — the spec member's own key. */
const NAV_TARGET_KEY = {
  page: 'pageName',
  dashboard: 'dashboardName',
  report: 'reportName',
} as const;

/**
 * Whether a listed row can be a nav target. A record page needs a record id a
 * `page` entry cannot pass (`isStaticPageOption`), and an action bound to an
 * object is not addressable from the nav, which runs GLOBAL actions only
 * (`useNavActionDispatch`). Only a CONFIRMED one is left out, as
 * `isStaticPageOption` keeps a row with no `type`.
 *
 * objectstack-ai/objectstack#26743 — a `_drafts` header names the METADATA
 * type (`page`), never the body's own `type` (`record`), so a draft-only row
 * is judged on its draft body instead ({@link NAV_TARGET_BODY_KEYED}). A draft
 * record page is still a record page once it is published with the app.
 */
function isNavTargetRow(metaType: string, row: Record<string, unknown>): boolean {
  if (metaType === 'page') return isStaticPageOption(row as { type?: string });
  if (metaType === 'action') return !row.objectName;
  return true;
}

/** The types whose {@link isNavTargetRow} verdict reads a body key, so a draft-only row's body is read for it. */
const NAV_TARGET_BODY_KEYED: ReadonlySet<string> = new Set(['page', 'action']);

/**
 * Whether a draft-only row can be a nav target, judged on its draft body. A
 * body that cannot be read (no draft served, a failed read) leaves the row in,
 * as a published row with no `type` is left in: only a confirmed non-target
 * is dropped.
 */
async function isDraftNavTarget(
  client: MetadataClient,
  metaType: string,
  name: string,
  packageId: string,
): Promise<boolean> {
  if (!NAV_TARGET_BODY_KEYED.has(metaType)) return true;
  let body: Record<string, unknown> | null;
  try {
    body = extractDraftBody(await client.getDraft(metaType, name, { packageId }));
  } catch {
    return true;
  }
  return !body || isNavTargetRow(metaType, body);
}

/**
 * The package's items of `metaType`, published ∪ draft by name (the published
 * row wins, for its label), as the pillar's object list is read
 * (objectui#11790). `undefined` reads nothing. A failed read leaves the
 * picker empty, as the object picker's does. objectstack#30059 — with a
 * `pairId`, that package's items follow, each one whose name the package's
 * own list does not hold; a failed read of the pair leaves the package's.
 */
function usePackageNavTargets(
  packageId: string,
  metaType: string | undefined,
  pairId: string | null = null,
): { rows: ReadonlyArray<NavTargetRow>; loading: boolean } {
  const client = useMetadataClient();
  const key = metaType ? JSON.stringify([metaType, packageId, pairId]) : '';
  const [state, setState] = React.useState<{ key: string; rows: NavTargetRow[] } | null>(null);
  React.useEffect(() => {
    if (!metaType) return;
    let cancelled = false;
    (async () => {
      const [own, pair] = await Promise.all([
        readNavTargets(client, metaType, packageId),
        pairId ? readNavTargets(client, metaType, pairId) : Promise.resolve([] as NavTargetRow[]),
      ]);
      const held = new Set(own.map((row) => row.name));
      if (!cancelled) setState({ key, rows: [...own, ...pair.filter((row) => !held.has(row.name))] });
    })();
    return () => {
      cancelled = true;
    };
  }, [client, packageId, pairId, metaType, key]);
  if (!metaType) return { rows: [], loading: false };
  return state?.key === key ? { rows: state.rows, loading: false } : { rows: [], loading: true };
}

/** One package's nav targets of `metaType` ({@link usePackageNavTargets}); a failed read is none. */
async function readNavTargets(client: MetadataClient, metaType: string, packageId: string): Promise<NavTargetRow[]> {
  const byName = new Map<string, NavTargetRow>();
  try {
    const [published, drafts] = await Promise.all([
      client.list(metaType, { packageId }) as Promise<Array<Record<string, unknown>> | null | undefined>,
      client.listDrafts({ packageId, type: metaType }).catch(() => [] as Array<{ name?: string | null }>),
    ]);
    for (const row of published ?? []) {
      const name = typeof row?.name === 'string' ? row.name : '';
      if (!name || byName.has(name) || !isNavTargetRow(metaType, row)) continue;
      byName.set(name, { name, label: row.label as I18nLabel | undefined });
    }
    // objectui#11862 — a draft-only target carries the label its `_drafts`
    // row serves (objectstack-ai/objectstack#22200), so the picker offers
    // it by that label, as it offers a published one.
    const draftOnly: NavTargetRow[] = [];
    for (const draft of (drafts ?? []) as Array<{ name?: string | null; label?: I18nLabel | null }>) {
      const name = typeof draft?.name === 'string' ? draft.name : '';
      if (name && !byName.has(name) && !draftOnly.some((row) => row.name === name)) {
        draftOnly.push({ name, label: draft.label ?? undefined });
      }
    }
    const verdicts = await Promise.all(
      draftOnly.map((row) => isDraftNavTarget(client, metaType, row.name, packageId)),
    );
    draftOnly.forEach((row, i) => {
      if (verdicts[i]) byName.set(row.name, row);
    });
  } catch {
    /* non-fatal — the picker just stays empty */
  }
  return [...byName.values()];
}

/** The item a value none of a picker's options carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/** The classes a nav-inspector picker takes, at the size the native control had. */
const PICKER_XS = 'h-auto rounded px-2 py-1 text-xs';

/**
 * objectui#11865 — one of the design surface's own pickers, drawn with the
 * shared `Select`, the control the rest of Studio picks with: the nav-item
 * inspector's object, target and *Open in* pickers, and the record sharing
 * and trigger pickers of the *New object* and *New automation* dialogs. They
 * used to be browser-native select elements. What a pick writes is unchanged:
 * `onPick` receives the picked option's own `value`, the string the native
 * control's `change` carried, and re-picking the current option writes
 * nothing, as it did there.
 *
 * - Items carry their option's INDEX, not its value. The object, target and
 *   trigger pickers open on an option whose value is `''` ("Choose object",
 *   "Choose", "Choose later on the Start node"), which `SelectItem` refuses;
 *   an index cannot collide with an object's or a target's name, as any
 *   stand-in string could.
 * - A value none of the options carries gets an item of its own, labelled
 *   with the value, so the trigger shows what the entry holds. The native
 *   control showed its first option there ("Choose object", "Same tab").
 *   Picking that item writes nothing. A nav target picker never needs it: it
 *   lists the entry's own target already ({@link NavTargetSelect}).
 * - Read-only has no state here: a read-only package closes nav editing, which
 *   unmounts the inspector, and offers neither *New* entry, so neither dialog
 *   opens there.
 * - Each caller keeps the name its native control had: a `<label htmlFor>`
 *   names the trigger by `id`, and a wrapping `<label>` names it as it named
 *   the native control. The nav-item inspector's object picker is named by
 *   its *Link to object* label the same way.
 */
export function StudioPicker({
  id,
  value,
  options,
  onPick,
  className,
  testId,
}: {
  id?: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onPick: (value: string) => void;
  className: string;
  testId?: string;
}): React.ReactElement {
  const at = options.findIndex((o) => o.value === value);
  const outside = at === -1 && value !== '';
  return (
    <Select
      value={at !== -1 ? String(at) : outside ? OUTSIDE_OPTIONS : ''}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the stored value, so there is nothing to write.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
    >
      <SelectTrigger id={id} data-testid={testId} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {outside && <SelectItem value={OUTSIDE_OPTIONS}>{value}</SelectItem>}
        {options.map((o, i) => (
          <SelectItem key={`${i}:${o.value}`} value={String(i)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * One nav target picker: the package's items of one type, plus the entry's own
 * target when the list does not hold it (a target another package owns, or a
 * list still loading), so a bound entry never reads as unbound.
 */
function NavTargetSelect({
  label,
  value,
  options,
  loading,
  onPick,
  hint,
  emptyLabel,
  locale,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  loading: boolean;
  onPick: (value: string) => void;
  hint?: string;
  /** The face of the empty value, where an absent target means something; else "Choose…". */
  emptyLabel?: string;
  locale: string;
}): React.ReactElement {
  const id = React.useId();
  const shown = value && !options.some((o) => o.value === value) ? [{ value, label: value }, ...options] : options;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-muted-foreground">
        {label}
      </label>
      <StudioPicker
        id={id}
        value={value}
        options={[{ value: '', label: emptyLabel ?? t('engine.inspector.appNav.choose', locale) }, ...shown]}
        onPick={onPick}
        className={PICKER_XS}
      />
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
      {!loading && options.length === 0 && (
        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{t('engine.inspector.appNav.noTargets', locale)}</p>
      )}
    </div>
  );
}

/** A `url` entry's address, typed, and the window it opens in. */
function NavUrlFields({
  url,
  target,
  onUrl,
  onTarget,
  locale,
}: {
  url: string;
  target: string;
  onUrl: (value: string) => void;
  onTarget: (value: string) => void;
  locale: string;
}): React.ReactElement {
  const urlId = React.useId();
  const targetId = React.useId();
  return (
    <div className="space-y-2">
      <div>
        <label htmlFor={urlId} className="mb-1 block text-[11px] font-medium text-muted-foreground">
          {t('engine.inspector.appNav.url', locale)}
        </label>
        <input
          id={urlId}
          type="url"
          value={url}
          onChange={(e) => onUrl(e.target.value)}
          placeholder="https://"
          className="w-full rounded border bg-background px-2 py-1 font-mono text-xs"
        />
      </div>
      <div>
        <label htmlFor={targetId} className="mb-1 block text-[11px] font-medium text-muted-foreground">
          {t('engine.inspector.appNav.urlTarget', locale)}
        </label>
        <StudioPicker
          id={targetId}
          value={target}
          options={[
            { value: '_self', label: t('engine.inspector.appNav.urlTargetSelf', locale) },
            { value: '_blank', label: t('engine.inspector.appNav.urlTargetBlank', locale) },
          ]}
          onPick={onTarget}
          className={PICKER_XS}
        />
      </div>
    </div>
  );
}
