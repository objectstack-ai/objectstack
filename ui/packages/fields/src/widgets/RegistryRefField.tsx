/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Combobox, EmptyValue, Input, cn } from '@object-ui/components';
import { SchemaRendererContext } from '@object-ui/react';
import { AUDIENCE_ANCHOR_POSITIONS } from '@objectstack/spec';
import type { DataSource } from '@object-ui/types';
import type { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { useFieldTranslation } from './useFieldTranslation.js';

/**
 * RegistryRefField — a record-form field that names ONE item of ONE metadata
 * registry type by its machine name (objectui#7611, ruling B2 on
 * objectstack#22865).
 *
 * The record-form face of the mechanism the metadata forms already have
 * (`ref-multi:permission`, objectui#12126): the registry's items are listed by
 * name, with the author's label beside the name, and the value written is the
 * NAME — one string, never an id, never a row. A grant names its position or
 * its permission set that way (ADR-0131 D4), and the server refuses a name the
 * registry does not hold, so this widget only has to make the right name easy
 * to pick.
 *
 * Reached through a field's `widget:` hint, which the form renderer looks up as
 * `field:<widget>` (the spec's `FieldSchema.widget`). One registration per
 * registry type, with the type in the key, as `object-ref` carries `object`:
 *
 *   position-ref    → `GET /api/v1/meta/position`
 *   permission-ref  → `GET /api/v1/meta/permission`
 *
 * The catalog comes from `DataSource.listMetadataItems`, which rejects on a
 * failure rather than answering `[]`, so its four arms are told apart the way
 * the metadata forms' `ref:dataset` / `ref-multi:<type>` pickers tell them
 * apart:
 *
 *  - IDLE — no data source, or one that cannot enumerate a registry: a text
 *    box that writes the typed name;
 *  - LOADING — the stored name in a disabled box;
 *  - FAILED — a notice naming the failure and its cause, beside a text box that
 *    stays enabled, so a failed catalog does not also block the edit;
 *  - LOADED — nothing a grant can name: the same text box as IDLE; otherwise
 *    a searchable picker. A stored name the catalog does not list stays
 *    selectable as its own option, flagged "not found", so it is neither
 *    dropped nor read as a listed item. The flag is a claim about the
 *    registry's answer, so it is made only once the catalog has answered.
 *
 * The picker OFFERS only what a grant can name (objectui#12200). A position
 * grant cannot name an audience anchor — `everyone` or `guest` (ADR-0090
 * D5/D9), held implicitly by every authenticated or anonymous principal — and
 * the server refuses a `sys_user_position` row that does. So `position-ref`
 * leaves the anchors out of its options ({@link nonGrantableNames}). A stored
 * anchor is still the row's value: it stays on screen as its own option, by its
 * label beside its name, and it is not flagged "not found", because the
 * registry does list it.
 *
 * ⛔ No arm writes anything but a name the person picked or typed: no label,
 * no id, no first-item default.
 */

/** One listed item of a registry: the name stored, the label shown beside it. */
export interface RegistryItemHeader {
  name: string;
  label?: string;
}

/** The catalog, in whichever of its four states the load is actually in. */
export type RegistryCatalogState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; items: RegistryItemHeader[] };

const IDLE: RegistryCatalogState = { status: 'idle' };
const LOADING: RegistryCatalogState = { status: 'loading' };

type RegistryLister = Required<Pick<DataSource, 'listMetadataItems'>>;

/**
 * The data source's registry list, when it has one. The widget contract keeps
 * `dataSource` structural (`unknown`, see `FieldWidgetComponentProps`), so the
 * member is narrowed here, by the name the `DataSource` contract declares.
 */
function registryLister(dataSource: unknown): RegistryLister | null {
  const candidate = dataSource as Partial<RegistryLister> | null | undefined;
  return candidate && typeof candidate.listMetadataItems === 'function'
    ? (candidate as RegistryLister)
    : null;
}

function failureMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : '';
}

const AUDIENCE_ANCHORS: ReadonlySet<string> = new Set(AUDIENCE_ANCHOR_POSITIONS);
const NO_EXCLUSIONS: ReadonlySet<string> = new Set();

/**
 * The names of a registry type that a grant cannot name, which the picker
 * therefore does not offer. For `position`, the audience anchors: the list is
 * the spec's own `AUDIENCE_ANCHOR_POSITIONS`, read and never copied, so an
 * anchor the spec adds is left out with no change here. Every other type
 * excludes nothing: a permission set named like an anchor is an ordinary set.
 *
 * Imported statically from the spec's ROOT entry, as `@object-ui/auth` imports
 * `BUILTIN_MEMBERSHIP_ROLES`, and not from `@objectstack/spec/identity`. The
 * console builds this widget into an eager chunk (`ui-components`), so a
 * static `/identity` import would carry that subpath's whole module into every
 * page load; `pnpm check:eager-closure` is the instrument that weighs it. A
 * lazy `import()` keeps that module out of the eager closure, but out of
 * `pnpm check:spec-floors` too: that gate judges the `@objectstack/spec` floor
 * from static imports only, and on the publish lane it reports a subpath it
 * cannot judge as a finding.
 */
function nonGrantableNames(type: string): ReadonlySet<string> {
  return type === 'position' ? AUDIENCE_ANCHORS : NO_EXCLUSIONS;
}

/** A settled answer, with the inputs it answers for. */
interface SettledCatalog {
  dataSource: unknown;
  type: string;
  state: RegistryCatalogState;
}

/**
 * Load one registry type's catalog. Keyed on the data source and the type it
 * reads — the inputs the request is made from — and nothing memoised.
 *
 * The arm is DERIVED from those inputs on every render rather than written
 * into state ahead of the request: no lister is IDLE, and a lister whose
 * answer for exactly these inputs has not settled is LOADING. So an answer to
 * an older data source or type can never be shown as the current one, and the
 * effect only ever writes a settled answer.
 */
function useRegistryCatalog(dataSource: unknown, type: string): RegistryCatalogState {
  const [settled, setSettled] = React.useState<SettledCatalog | null>(null);

  React.useEffect(() => {
    const source = registryLister(dataSource);
    if (!source) return;
    let cancelled = false;
    source.listMetadataItems(type).then(
      (items) => {
        if (!cancelled) setSettled({ dataSource, type, state: { status: 'loaded', items } });
      },
      (err: unknown) => {
        if (!cancelled) {
          setSettled({ dataSource, type, state: { status: 'error', message: failureMessage(err) } });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [dataSource, type]);

  if (!registryLister(dataSource)) return IDLE;
  return settled && settled.dataSource === dataSource && settled.type === type ? settled.state : LOADING;
}

/** What one item reads as: its label beside its name, or the name alone. */
function itemText(item: RegistryItemHeader): string {
  return item.label && item.label !== item.name ? `${item.label} (${item.name})` : item.name;
}

export interface RegistryRefFieldProps extends FieldWidgetComponentProps<string> {
  /** The registry type whose items this field names (`position`, `permission`). */
  registryType: string;
}

export function RegistryRefField({
  registryType,
  value,
  onChange,
  readonly,
  className,
  error,
  ...props
}: RegistryRefFieldProps) {
  const ctx = React.useContext(SchemaRendererContext);
  const { t } = useFieldTranslation();
  const dataSource = props.dataSource ?? ctx?.dataSource ?? null;
  const catalog = useRegistryCatalog(dataSource, registryType);
  const excluded = nonGrantableNames(registryType);
  const current = typeof value === 'string' ? value : '';
  const testId = `registry-ref-${registryType}`;

  const listed = catalog.status === 'loaded' ? catalog.items : null;
  const entry = listed?.find((item) => item.name === current);
  const notFound = listed !== null && current !== '' && !entry;
  const notFoundText = t('fields.registryRef.notFound', { name: current });

  if (readonly) {
    if (!current) return <EmptyValue />;
    return (
      <span className={cn('text-sm', className)} data-testid={testId} data-not-found={notFound || undefined}>
        {notFound ? notFoundText : entry ? itemText(entry) : current}
      </span>
    );
  }

  const domProps = toDomProps(props);
  const disabled = props.disabled;
  const typedName = (
    <Input
      {...domProps}
      data-testid={`${testId}-input`}
      value={current}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={className}
      aria-invalid={!!error}
    />
  );

  if (catalog.status === 'error') {
    return (
      <div className="space-y-1.5">
        <div
          role="status"
          data-testid={`${testId}-load-failed`}
          className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p>{t('fields.registryRef.loadFailed')}</p>
            {catalog.message ? (
              <p data-testid={`${testId}-load-failed-cause`} className="break-words font-mono text-[10px]">
                {catalog.message}
              </p>
            ) : null}
          </div>
        </div>
        {typedName}
      </div>
    );
  }

  if (catalog.status === 'loading') {
    return (
      <Input
        {...domProps}
        data-testid={`${testId}-input`}
        value={current}
        disabled
        readOnly
        placeholder={t('common.loading')}
        className={className}
        aria-invalid={!!error}
      />
    );
  }

  // What the picker offers: the listed items a grant can name.
  const offered = (listed ?? []).filter((item) => !excluded.has(item.name));
  if (offered.length === 0) return typedName;

  const options = offered
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => ({ value: item.name, label: itemText(item) }));
  // A stored name the picker does not offer stays its own option, so it is
  // neither dropped nor replaced: a listed name a grant cannot name by its
  // label beside its name, a name the registry lacks flagged "not found".
  if (entry && excluded.has(entry.name)) options.unshift({ value: current, label: itemText(entry) });
  if (notFound) options.unshift({ value: current, label: notFoundText });

  // DOM pass-through onto the combobox trigger, the widget's focusable control
  // (objectui#3318). `name` is withheld: the trigger is a button, not a
  // submission control (the `ObjectRefField` reasoning).
  const { name: _domName, ...triggerDomProps } = domProps;
  return (
    <Combobox
      {...triggerDomProps}
      data-testid={testId}
      data-not-found={notFound || undefined}
      options={options}
      value={current}
      onValueChange={(next) => onChange(next)}
      placeholder={t('common.select')}
      searchPlaceholder={t('table.search')}
      emptyText={t('common.noResults')}
      disabled={disabled}
      className={cn('w-full', className)}
      aria-invalid={!!error}
    />
  );
}

/** `position-ref`: names one position of the position registry. */
export function PositionRefField(props: FieldWidgetComponentProps<string>) {
  return <RegistryRefField {...props} registryType="position" />;
}

/** `permission-ref`: names one permission set of the `permission` registry. */
export function PermissionRefField(props: FieldWidgetComponentProps<string>) {
  return <RegistryRefField {...props} registryType="permission" />;
}

export default RegistryRefField;
