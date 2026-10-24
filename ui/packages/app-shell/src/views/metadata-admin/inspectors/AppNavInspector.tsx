// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AppNavInspector — scoped editor for the selected app navigation item.
 *
 * Apps accept nav under several keys (nav / navigation / tabs / items
 * / menu). The preview emits selection id as a dotted path
 * `<rootKey>[i]` for top-level items, `<rootKey>[i].children[j]` for
 * nested. This inspector walks the same path to read/write.
 *
 * Target editing is contract-first (#2245): a `type` selector plus
 * per-type typed-target pickers replacing the old off-spec `path` /
 * `kind` free-text fields the runtime never read. `object` items expose
 * the four landing modes matching resolveHref precedence (default /
 * named view / record deep-link / filters slice on `/data`, ADR-0055);
 * the mode is derived from field presence — never persisted — and every
 * edit clears the other modes' fields plus all legacy keys, so touching
 * a legacy item migrates it to spec shape. A live href preview renders
 * the REAL runtime landing via resolveHref, making "declared =
 * enforced" visible while editing.
 *
 * The item's name (objectui#11196). `label` is optional in the spec: an item
 * with none shows, at render time, the CURRENT label of what it opens. The
 * inspector's title and its Label field read the label through the shared
 * `navItemLabel` module, with the console's own target resolver, so a
 * label-less item is named here as the console's sidebar names it. The Label
 * field shows the AUTHORED label as its value and the inherited text as its
 * PLACEHOLDER, never as a stored value: typing writes an author label (a
 * locale map keeps every other language), and emptying the field restores
 * inheritance by removing the key — never by writing `''`. `title` / `name`
 * are not nav-item keys and are not read as the label.
 *
 * The describing fields an entry is offered (objectui#11847) are the ones its
 * spec member declares, answered by `navEntryOffersField`, the rule the
 * Studio's nav inspector reads too. A separator declares neither a `label` nor
 * an `icon`, so it is offered neither field: a value typed there used to write
 * a key the save refused (`unrecognized_keys`).
 */

import * as React from 'react';
import { resolveHref } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';
import type { I18nLabel } from '@objectstack/spec/ui';
import { Plus, X } from 'lucide-react';
import { Label } from '@object-ui/components';
import type { MetadataInspectorProps } from '../inspector-registry.js';
import { t } from '../i18n.js';
import { useMetadataClient } from '../useMetadata.js';
import { useObjectFields } from '../previews/useObjectFields.js';
import { useNavTargetLabel } from '../../../hooks/useNavTargetLabel.js';
import {
  clearedLabel,
  inheritedNavEntryText,
  navEntryLabelText,
  navItemLabelText,
  renamedLabel,
} from '../previews/navItemLabel.js';
import {
  InspectorShell,
  InspectorReorderButtons,
  InspectorTextField,
  InspectorSelectField,
  InspectorRemoveButton,
  InspectorEmptyState,
  spliceArray,
  moveArray,
} from './_shared.js';
import { InspectorComboField } from './InspectorComboField.js';
import { IconPickerWidget } from '../widgets.js';
import {
  NAV_ITEM_TYPES,
  NAV_TYPE_TARGETS,
  OBJECT_TARGET_MODES,
  OBJECT_MODE_FIELDS,
  type NavItemType,
  type ObjectTargetMode,
  inferNavItemType,
  deriveObjectTargetMode,
  clearedTargetPatch,
  ensureNavId,
  isNavEntryType,
  isStaticPageOption,
  navEntryOffersField,
} from './nav-target.js';

interface NavItem {
  id?: string;
  /** The spec's `I18nLabel`: a plain string or an inline locale map. Optional — absent ⇒ inherited. */
  label?: I18nLabel;
  icon?: string;
  children?: NavItem[];
  [k: string]: unknown;
}

type Hop = { key: string; index: number };

/** Parse "nav[0].children[2]" → [{key:'nav', index:0}, {key:'children', index:2}]. */
function parsePath(id: string): Hop[] | null {
  const segs = id.split('.');
  const hops: Hop[] = [];
  for (const s of segs) {
    const m = /^([a-zA-Z_]\w*)\[(\d+)\]$/.exec(s);
    if (!m) return null;
    hops.push({ key: m[1], index: Number(m[2]) });
  }
  return hops.length > 0 ? hops : null;
}

function readAt(draft: Record<string, unknown>, hops: Hop[]): { parent: NavItem[]; node: NavItem | null; index: number } {
  let arr = (draft as any)[hops[0].key] as NavItem[] | undefined;
  if (!Array.isArray(arr)) return { parent: [], node: null, index: -1 };
  let node = arr[hops[0].index] ?? null;
  for (let h = 1; h < hops.length; h++) {
    if (!node) return { parent: arr, node: null, index: hops[h].index };
    arr = (node as any)[hops[h].key] as NavItem[] | undefined;
    if (!Array.isArray(arr)) return { parent: [], node: null, index: -1 };
    node = arr[hops[h].index] ?? null;
  }
  return { parent: arr, node, index: hops[hops.length - 1].index };
}

function writeAt(draft: Record<string, unknown>, hops: Hop[], replacement: NavItem | null): Record<string, unknown> {
  // Walk down cloning, then splice at the leaf.
  const rootKey = hops[0].key;
  const root = Array.isArray((draft as any)[rootKey]) ? [...(draft as any)[rootKey] as NavItem[]] : [];
  if (hops.length === 1) {
    return { [rootKey]: spliceArray(root, hops[0].index, replacement) };
  }
  // Walk + clone.
  let arr: NavItem[] = root;
  const stack: Array<{ arr: NavItem[]; index: number; node: NavItem }> = [];
  for (let h = 0; h < hops.length - 1; h++) {
    const node = { ...(arr[hops[h].index] ?? {}) } as NavItem;
    stack.push({ arr, index: hops[h].index, node });
    const nextKey = hops[h + 1].key;
    const childArr = Array.isArray((node as any)[nextKey]) ? [...(node as any)[nextKey] as NavItem[]] : [];
    (node as any)[nextKey] = childArr;
    arr[hops[h].index] = node;
    arr = childArr;
  }
  // Splice at leaf:
  const leafSpliced = spliceArray(arr, hops[hops.length - 1].index, replacement);
  // Re-attach.
  stack[stack.length - 1].node[hops[hops.length - 1].key as keyof NavItem] = leafSpliced as any;
  return { [rootKey]: root };
}

/**
 * Replace the sibling array of the leaf hop with `nextSiblings`.
 * Mirrors `writeAt`'s clone-down strategy but operates on the
 * containing array rather than a single index.
 */
function writeSiblings(draft: Record<string, unknown>, hops: Hop[], nextSiblings: NavItem[]): Record<string, unknown> {
  const rootKey = hops[0].key;
  if (hops.length === 1) {
    return { [rootKey]: nextSiblings };
  }
  const root = Array.isArray((draft as any)[rootKey]) ? [...(draft as any)[rootKey] as NavItem[]] : [];
  let arr: NavItem[] = root;
  for (let h = 0; h < hops.length - 2; h++) {
    const node = { ...(arr[hops[h].index] ?? {}) } as NavItem;
    const nextKey = hops[h + 1].key;
    const childArr = Array.isArray((node as any)[nextKey]) ? [...(node as any)[nextKey] as NavItem[]] : [];
    (node as any)[nextKey] = childArr;
    arr[hops[h].index] = node;
    arr = childArr;
  }
  const parentHop = hops[hops.length - 2];
  const leafKey = hops[hops.length - 1].key;
  const parentCopy = { ...(arr[parentHop.index] ?? {}) } as NavItem;
  (parentCopy as any)[leafKey] = nextSiblings;
  arr[parentHop.index] = parentCopy;
  return { [rootKey]: root };
}

type MetadataOptionRow = { name?: string; label?: string; type?: string };

/** Fetch a metadata type's items as combobox options (name → label (name)). */
function useMetadataOptions(
  type: string | undefined,
  rowFilter?: (row: MetadataOptionRow) => boolean,
): { options: Array<{ value: string; label: string }>; loading: boolean } {
  const client = useMetadataClient();
  const [state, setState] = React.useState<{ options: Array<{ value: string; label: string }>; loading: boolean }>({
    options: [],
    loading: !!type,
  });
  React.useEffect(() => {
    if (!type) {
      setState({ options: [], loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    client
      .list<MetadataOptionRow>(type)
      .then((rows) => {
        if (cancelled) return;
        const options = (Array.isArray(rows) ? rows : [])
          .filter((r) => r && typeof r.name === 'string' && r.name)
          .filter((r) => (rowFilter ? rowFilter(r) : true))
          .map((r) => ({
            value: String(r.name),
            label: typeof r.label === 'string' && r.label && r.label !== r.name ? `${r.label} (${r.name})` : String(r.name),
          }));
        setState({ options, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ options: [], loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [client, type, rowFilter]);
  return state;
}

/** Preview template context that keeps template vars VISIBLE in the href. */
const PREVIEW_CTX = {
  currentUserId: '{current_user_id}',
  currentOrgId: '{current_org_id}',
};

/** Key/value rows editor for the `filters` landing mode (ADR-0055). */
function FiltersEditor({
  objectName,
  filters,
  onCommit,
  disabled,
  locale,
}: {
  objectName: string;
  filters: Record<string, string>;
  onCommit: (next: Record<string, string>) => void;
  disabled?: boolean;
  locale: MetadataInspectorProps['locale'];
}) {
  const { fields } = useObjectFields(objectName || undefined);
  const fieldOptions = React.useMemo(
    () => fields.map((f) => ({ value: f.name, label: f.label && f.label !== f.name ? `${f.label} (${f.name})` : f.name })),
    [fields],
  );
  const entries = Object.entries(filters);

  const update = (index: number, key: string, value: string) => {
    const next = entries.slice();
    next[index] = [key, value];
    onCommit(Object.fromEntries(next.filter(([k]) => k !== '')));
  };
  const remove = (index: number) => {
    const next = entries.slice();
    next.splice(index, 1);
    onCommit(Object.fromEntries(next));
  };

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium text-muted-foreground">
        {t('engine.inspector.appNav.filters', locale)}
      </div>
      {entries.map(([field, value], i) => (
        <div key={`${field}-${i}`} className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <InspectorComboField
              // No visible per-row label — the `field = value` shape is read
              // from the row itself — so the trigger carries its own name
              // instead of being an anonymous combobox (objectui#3997).
              ariaLabel={t('engine.inspector.appNav.filtersField', locale)}
              value={field}
              onCommit={(v) => update(i, v, value)}
              options={fieldOptions}
              placeholder={t('engine.inspector.appNav.filtersField', locale)}
              disabled={disabled}
              mono
            />
          </div>
          <span className="text-xs text-muted-foreground">=</span>
          <input
            value={value}
            onChange={(e) => update(i, field, e.target.value)}
            placeholder={t('engine.inspector.appNav.filtersValue', locale)}
            disabled={disabled}
            className="h-7 w-0 min-w-0 flex-1 rounded border bg-background px-2 font-mono text-xs"
            data-testid={`nav-filter-value-${field || 'new'}`}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            disabled={disabled}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            aria-label={t('engine.inspector.appNav.filtersRemove', locale)}
            data-testid={`nav-filter-remove-${field || 'new'}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onCommit({ ...filters, '': '' })}
        disabled={disabled || Object.prototype.hasOwnProperty.call(filters, '')}
        className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
        data-testid="nav-filter-add"
      >
        <Plus className="h-3 w-3" />
        {t('engine.inspector.appNav.filtersAdd', locale)}
      </button>
      <p className="text-[11px] text-muted-foreground">{t('engine.inspector.appNav.filtersHint', locale)}</p>
    </div>
  );
}

export function AppNavInspector({ selection, draft, name, onPatch, onClearSelection, onSelectionChange, locale, readOnly }: MetadataInspectorProps) {
  const hops = parsePath(selection.id);
  const { node, parent, index } = hops ? readAt(draft, hops) : { node: null, parent: [] as NavItem[], index: -1 };

  const navType = node ? inferNavItemType(node) : null;
  const objectMode: ObjectTargetMode = node ? deriveObjectTargetMode(node) : 'default';
  const objectName = String(node?.objectName ?? node?.object ?? '');

  // Hooks run unconditionally (before the not-found early return) to keep
  // the Rules of Hooks satisfied; `undefined` type disables the fetch.
  const objectOptions = useMetadataOptions(navType === 'object' ? 'object' : undefined);
  const targetMeta = navType && navType !== 'object' ? NAV_TYPE_TARGETS[navType].metaType : undefined;
  const targetOptions = useMetadataOptions(targetMeta, targetMeta === 'page' ? isStaticPageOption : undefined);
  const viewOptionsRaw = useMetadataOptions(navType === 'object' && objectMode === 'view' ? 'view' : undefined);
  // The console's own resolver for what a label-less item inherits.
  const targetLabel = useNavTargetLabel();
  const iconFieldId = React.useId();
  // Views are named `<object>.<key>` (MetadataProvider) — scope the picker
  // to the bound object instead of offering the whole workspace's views.
  const viewOptions = React.useMemo(
    () =>
      objectName
        ? viewOptionsRaw.options.filter((o) => o.value.startsWith(`${objectName}.`) || !o.value.includes('.'))
        : viewOptionsRaw.options,
    [viewOptionsRaw.options, objectName],
  );

  if (!hops || !node) {
    return (
      <InspectorShell kindLabel={t('engine.inspector.appNav.kind', locale)} title={selection.label ?? selection.id} onClose={onClearSelection} closeLabel={t('engine.inspector.appNav.close', locale)}>
        <InspectorEmptyState message={selection.id} />
      </InspectorShell>
    );
  }

  // Authored label, else the inherited text; the positional id only for an
  // item the runtime's rule cannot name either.
  const labelOf = navEntryLabelText(node, locale, targetLabel).trim() || selection.id;

  // The spec member the entry IS decides which describing fields it is
  // offered (objectui#11847), not `navType`: that is the six-type picker's
  // reading and answers `null` for a separator, whose member declares no
  // `label` and no `icon` — a value typed there is refused at save.
  const entryType = isNavEntryType(node.type) ? node.type : null;

  /**
   * Every write enforces the spec invariants: snake_case `id`, an explicit
   * `type`, and the caller-provided field clears — editing a legacy item
   * IS its migration to spec shape. `omit` names keys the write REMOVES.
   */
  const patch = (updates: Record<string, unknown>, omit: ReadonlyArray<string> = []) => {
    const nextType = (updates.type ?? node.type ?? navType ?? undefined) as string | undefined;
    const next: Record<string, unknown> = {
      ...node,
      id: ensureNavId(node, parent),
      ...(nextType ? { type: nextType } : {}),
      ...updates,
    };
    for (const key of omit) delete next[key];
    onPatch(writeAt(draft, hops, next as NavItem));
  };

  /**
   * The Label field's edit. Typing writes an author label (`renamedLabel`: a
   * locale map changes only the designer locale's entry). Emptying the field
   * restores inheritance: `clearedLabel` answers what is left, and when that is
   * nothing the `label` key is REMOVED, never written as `''`.
   */
  const commitLabel = (value: string) => {
    const next = value === '' ? clearedLabel(node.label, locale) : renamedLabel(node.label, value, locale);
    if (next === undefined) patch({}, ['label']);
    else patch({ label: next });
  };

  const switchType = (nextType: NavItemType) => {
    const targetKey = NAV_TYPE_TARGETS[nextType].targetKey;
    const keep = nextType === 'object' ? OBJECT_MODE_FIELDS.default : targetKey ? [targetKey] : [];
    patch({ type: nextType, ...clearedTargetPatch(keep) });
  };

  const switchObjectMode = (mode: ObjectTargetMode) => {
    const cleared = clearedTargetPatch(OBJECT_MODE_FIELDS[mode]);
    if (mode === 'filters') patch({ ...cleared, objectName, filters: (node.filters as Record<string, string>) ?? {} });
    else patch({ ...cleared, objectName });
  };

  const remove = () => {
    onPatch(writeAt(draft, hops, null));
    onClearSelection();
  };

  const move = (to: number) => {
    const next = moveArray(parent, index, to);
    onPatch(writeSiblings(draft, hops, next));
    const prefix = hops.slice(0, -1).map((h) => `${h.key}[${h.index}]`).join('.');
    const leafKey = hops[hops.length - 1].key;
    const newId = prefix ? `${prefix}.${leafKey}[${to}]` : `${leafKey}[${to}]`;
    onSelectionChange?.({ kind: 'nav', id: newId, label: labelOf });
  };

  // Live landing preview — the REAL runtime URL for the current config
  // (resolveHref is the single source of truth), template vars kept
  // visible. `#` reads as "no target yet".
  const previewHref = navType && navType !== 'group'
    ? resolveHref({ ...(node as Record<string, unknown>), type: navType } as unknown as NavigationItem, `/apps/${name || 'app'}`, PREVIEW_CTX).href
    : null;

  const target = NAV_TYPE_TARGETS[navType ?? 'group'];

  return (
    <InspectorShell
      kindLabel={t('engine.inspector.appNav.kind', locale)}
      title={labelOf}
      onClose={onClearSelection}
      closeLabel={t('engine.inspector.appNav.close', locale)}
      headerActions={
        <InspectorReorderButtons
          index={index}
          total={parent.length}
          onMove={move}
          upLabel={t('engine.inspector.reorder.up', locale)}
          downLabel={t('engine.inspector.reorder.down', locale)}
          disabled={readOnly}
        />
      }
      footer={<InspectorRemoveButton label={t('engine.inspector.appNav.remove', locale)} onClick={remove} disabled={readOnly} />}
    >
      {navEntryOffersField(entryType, 'label') ? (
        <InspectorTextField
          label={t('engine.inspector.appNav.label', locale)}
          value={navItemLabelText(node.label, locale)}
          placeholder={inheritedNavEntryText(node, targetLabel)}
          onCommit={commitLabel}
          disabled={readOnly}
        />
      ) : (
        <p className="text-[11px] text-muted-foreground">{t('engine.inspector.appNav.separatorHint', locale)}</p>
      )}
      {navEntryOffersField(entryType, 'icon') && (
        // objectui#12531 — the entry's icon is picked from the catalog the
        // console ships, with the picker the Studio's nav inspector mounts.
        // Clearing writes `''`, as the text field this replaced did.
        <div className="space-y-1">
          <Label htmlFor={iconFieldId} className="text-xs text-muted-foreground">{t('engine.inspector.appNav.icon', locale)}</Label>
          <IconPickerWidget
            id={iconFieldId}
            schema={{ type: 'string' }}
            value={String(node.icon ?? '')}
            onChange={(v) => patch({ icon: typeof v === 'string' ? v : '' })}
            readOnly={readOnly}
          />
        </div>
      )}

      <InspectorSelectField
        label={t('engine.inspector.appNav.typeField', locale)}
        value={navType ?? ''}
        options={NAV_ITEM_TYPES.map((v) => ({ value: v, label: t(`engine.inspector.appNav.type.${v}`, locale) }))}
        onCommit={(v) => switchType(v as NavItemType)}
        disabled={readOnly}
      />

      {navType === 'object' && (
        <>
          <InspectorComboField
            label={t('engine.inspector.appNav.object', locale)}
            value={objectName}
            options={objectOptions.options}
            loading={objectOptions.loading}
            onCommit={(v) => patch({ objectName: v, object: undefined })}
            disabled={readOnly}
            mono
          />
          <InspectorSelectField
            label={t('engine.inspector.appNav.targetMode', locale)}
            value={objectMode}
            options={OBJECT_TARGET_MODES.map((m) => ({ value: m, label: t(`engine.inspector.appNav.mode.${m}`, locale) }))}
            onCommit={(v) => switchObjectMode(v as ObjectTargetMode)}
            disabled={readOnly || !objectName}
          />
          {objectMode === 'view' && (
            <InspectorComboField
              label={t('engine.inspector.appNav.view', locale)}
              value={String(node.viewName ?? '')}
              options={viewOptions}
              loading={viewOptionsRaw.loading}
              onCommit={(v) => patch({ viewName: v })}
              disabled={readOnly}
              mono
            />
          )}
          {objectMode === 'record' && (
            <>
              <InspectorTextField
                label={t('engine.inspector.appNav.recordId', locale)}
                value={String(node.recordId ?? '')}
                onCommit={(v) => patch({ recordId: v })}
                disabled={readOnly}
                mono
              />
              <p className="text-[11px] text-muted-foreground">{t('engine.inspector.appNav.recordIdHint', locale)}</p>
              <InspectorSelectField
                label={t('engine.inspector.appNav.recordMode', locale)}
                value={String(node.recordMode ?? 'view')}
                options={[
                  { value: 'view', label: t('engine.inspector.appNav.recordModeView', locale) },
                  { value: 'edit', label: t('engine.inspector.appNav.recordModeEdit', locale) },
                ]}
                onCommit={(v) => patch({ recordMode: v })}
                disabled={readOnly}
              />
            </>
          )}
          {objectMode === 'filters' && (
            <FiltersEditor
              objectName={objectName}
              filters={(node.filters as Record<string, string>) ?? {}}
              onCommit={(next) => patch({ filters: next })}
              disabled={readOnly}
              locale={locale}
            />
          )}
        </>
      )}

      {navType && navType !== 'object' && navType !== 'group' && target.targetKey && (
        target.metaType ? (
          <InspectorComboField
            label={t(`engine.inspector.appNav.type.${navType}`, locale)}
            value={String((node as Record<string, unknown>)[target.targetKey] ?? '')}
            options={targetOptions.options}
            loading={targetOptions.loading}
            onCommit={(v) => patch({ [target.targetKey as string]: v })}
            disabled={readOnly}
            mono
          />
        ) : (
          <>
            <InspectorTextField
              label={t('engine.inspector.appNav.url', locale)}
              value={String(node.url ?? node.href ?? '')}
              onCommit={(v) => patch({ url: v, href: undefined })}
              disabled={readOnly}
              mono
            />
            <InspectorSelectField
              label={t('engine.inspector.appNav.urlTarget', locale)}
              value={String(node.target ?? '_self')}
              options={[
                { value: '_self', label: t('engine.inspector.appNav.urlTargetSelf', locale) },
                { value: '_blank', label: t('engine.inspector.appNav.urlTargetBlank', locale) },
              ]}
              onCommit={(v) => patch({ target: v })}
              disabled={readOnly}
            />
          </>
        )
      )}

      {previewHref && (
        <div className="rounded border bg-muted/30 px-2 py-1.5" data-testid="nav-target-preview">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('engine.inspector.appNav.preview', locale)}
          </div>
          <div className="break-all font-mono text-[11px]">{previewHref}</div>
        </div>
      )}
    </InspectorShell>
  );
}
