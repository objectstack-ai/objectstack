/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { AlertTriangle, Check, ChevronsUpDown } from 'lucide-react';
import {
  Button,
  Combobox,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  EmptyValue,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from '@object-ui/components';
import { SchemaRendererContext, type ApiFetch } from '@object-ui/react';
import { AUDIENCE_ANCHOR_POSITIONS } from '@objectstack/spec';
import { MCP_AGENT_PERMISSION_SETS } from '@objectstack/spec/ai';
import type { FieldWidgetComponentProps } from './types.js';
import { registryLister, type RegistryItemHeader, type RegistryLister } from './registryCatalog.js';
import { loadPreferenceOptions, type PreferenceList, type PreferenceOptionItem } from './preferenceOptions.js';
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
 * leaves the anchors out of its options ({@link nonGrantableNames}). A
 * permission grant names a set for a PERSON, and the MCP agent ceiling sets
 * (ADR-0090 D10) are an AI assistant's own grants, which the runtime injects
 * onto the agent principal directly rather than through any grant row; so
 * `permission-ref` leaves them out. A stored name left out is still the row's value: it stays on screen as
 * its own option, by its label beside its name, and it is not flagged "not
 * found", because the registry does list it.
 *
 * ⛔ No arm writes anything but a name the person picked or typed: no label,
 * no id, no first-item default.
 *
 * ## The fillable arm — `notification-topic` / `notification-channel`
 *
 * A notification preference's `topic` and `channel`, and a template's `topic`,
 * are free text the server stores as written (#30208 row 6, ruling E on
 * #30527): the list is a suggestion, never a closed set. So the same four-arm
 * machinery reads a different catalog — the preference options door
 * (`./preferenceOptions.ts`), through the host's authenticated fetch — and
 * differs from the registry arm in exactly what an open list needs:
 *
 *  - FAILED, IDLE or an empty list: the plain text box, with no notice;
 *  - LOADED: a picker that lists the served values in the door's order (`*`
 *    first) and ALSO commits whatever the person types, verbatim;
 *  - a stored or typed value the list does not hold is kept, marked "not in
 *    the list" — never refused, never rewritten;
 *  - a channel the door marks not configured is listed, labelled so, and
 *    selectable.
 */

export type { RegistryItemHeader };

/** The catalog, in whichever of its four states the load is actually in. */
export type RegistryCatalogState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; items: RegistryItemHeader[] };

const IDLE: RegistryCatalogState = { status: 'idle' };
const LOADING: RegistryCatalogState = { status: 'loading' };

function failureMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : '';
}

const AUDIENCE_ANCHORS: ReadonlySet<string> = new Set(AUDIENCE_ANCHOR_POSITIONS);
const AGENT_CEILING_SETS: ReadonlySet<string> = new Set(MCP_AGENT_PERMISSION_SETS);
const NO_EXCLUSIONS: ReadonlySet<string> = new Set();

/**
 * The names of a registry type that a grant cannot name, which the picker
 * therefore does not offer. For `position`, the audience anchors: the list is
 * the spec's own `AUDIENCE_ANCHOR_POSITIONS`, read and never copied, so an
 * anchor the spec adds is left out with no change here. For `permission`, the
 * MCP agent ceiling sets, read the same way from the spec's
 * `MCP_AGENT_PERMISSION_SETS`. Every other type excludes nothing, and each list
 * applies to its own type only: a permission set named like an anchor is an
 * ordinary set.
 *
 * The anchors are imported statically from the spec's ROOT entry, as
 * `@object-ui/auth` imports `BUILTIN_MEMBERSHIP_ROLES`, and not from
 * `@objectstack/spec/identity`. The
 * console builds this widget into an eager chunk (`ui-components`), so a
 * static `/identity` import would carry that subpath's whole module into every
 * page load; `pnpm check:eager-closure` is the instrument that weighs it. A
 * lazy `import()` keeps that module out of the eager closure, but out of
 * `pnpm check:spec-floors` too: that gate judges the `@objectstack/spec` floor
 * from static imports only, and on the publish lane it reports a subpath it
 * cannot judge as a finding.
 *
 * The agent sets have no root export, so they come from `@objectstack/spec/ai`,
 * statically for the same `check:spec-floors` reason. That subpath's
 * `mcp.zod` module already reaches the eager closure through the console's
 * OAuth consent page, which imports its scope constants statically;
 * `pnpm check:eager-closure` weighs what this import adds.
 */
function nonGrantableNames(type: string): ReadonlySet<string> {
  if (type === 'position') return AUDIENCE_ANCHORS;
  if (type === 'permission') return AGENT_CEILING_SETS;
  return NO_EXCLUSIONS;
}

/**
 * Where a catalog is read from: whether an origin can answer at all, and the
 * read. One module-level reader per arm, so the read's identity never moves
 * between renders.
 */
interface CatalogReader<Origin> {
  readerOf(origin: unknown): Origin | null;
  read(origin: Origin, list: string): Promise<RegistryItemHeader[]>;
}

/** The registry arm: `DataSource.listMetadataItems(type)`. */
const REGISTRY_READER: CatalogReader<RegistryLister> = {
  readerOf: registryLister,
  read: (source, type) => source.listMetadataItems(type),
};

/** The fillable arm: the preference options door, through the host's fetch. */
const PREFERENCE_READER: CatalogReader<ApiFetch> = {
  readerOf: (origin) => (typeof origin === 'function' ? (origin as ApiFetch) : null),
  read: (doFetch, list) => loadPreferenceOptions(doFetch).then((options) => options[list as PreferenceList]),
};

/** A settled answer, with the inputs it answers for. */
interface SettledCatalog {
  origin: unknown;
  list: string;
  state: RegistryCatalogState;
}

/**
 * Load one catalog. Keyed on the origin it is read from (the data source, or
 * the host's fetch) and the list it reads — the inputs the request is made
 * from — and nothing memoised.
 *
 * The arm is DERIVED from those inputs on every render rather than written
 * into state ahead of the request: an origin that cannot answer is IDLE, and
 * one whose answer for exactly these inputs has not settled is LOADING. So an
 * answer to an older origin or list can never be shown as the current one, and
 * the effect only ever writes a settled answer.
 */
function useCatalog<Origin>(reader: CatalogReader<Origin>, origin: unknown, list: string): RegistryCatalogState {
  const [settled, setSettled] = React.useState<SettledCatalog | null>(null);

  React.useEffect(() => {
    const source = reader.readerOf(origin);
    if (!source) return;
    let cancelled = false;
    reader.read(source, list).then(
      (items) => {
        if (!cancelled) setSettled({ origin, list, state: { status: 'loaded', items } });
      },
      (err: unknown) => {
        if (!cancelled) {
          setSettled({ origin, list, state: { status: 'error', message: failureMessage(err) } });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reader, origin, list]);

  if (!reader.readerOf(origin)) return IDLE;
  return settled && settled.origin === origin && settled.list === list ? settled.state : LOADING;
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
  const catalog = useCatalog(REGISTRY_READER, dataSource, registryType);
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

/** What one listed preference value reads as. */
function preferenceText(
  item: PreferenceOptionItem,
  list: PreferenceList,
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  if (item.wildcard) {
    return t(list === 'topics' ? 'fields.preferenceOption.allTopics' : 'fields.preferenceOption.allChannels', {
      value: item.name,
    });
  }
  if (!item.configured) return t('fields.preferenceOption.notConfigured', { value: item.name });
  return item.name;
}

interface FillableOption {
  value: string;
  label: string;
  notConfigured: boolean;
}

function matchesSearch(option: FillableOption, needle: string): boolean {
  if (!needle) return true;
  const q = needle.toLowerCase();
  return option.value.toLowerCase().includes(q) || option.label.toLowerCase().includes(q);
}

export interface PreferenceOptionFieldProps extends FieldWidgetComponentProps<string> {
  /** Which of the preference options door's two lists this field offers. */
  preferenceList: PreferenceList;
}

/**
 * The fillable arm (see the file header): a value from the preference options
 * list, or whatever the person types.
 */
export function PreferenceOptionField({
  preferenceList,
  value,
  onChange,
  readonly,
  className,
  error,
  ...props
}: PreferenceOptionFieldProps) {
  const ctx = React.useContext(SchemaRendererContext);
  const { t } = useFieldTranslation();
  const doFetch: ApiFetch | undefined = ctx?.apiFetch ?? (typeof fetch === 'function' ? fetch : undefined);
  const catalog = useCatalog(PREFERENCE_READER, doFetch, preferenceList);
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const current = typeof value === 'string' ? value : '';
  const testId = `preference-option-${preferenceList}`;

  const listed = catalog.status === 'loaded' ? (catalog.items as PreferenceOptionItem[]) : null;
  const entry = listed?.find((item) => item.name === current);
  const notInList = listed !== null && listed.length > 0 && current !== '' && !entry;
  const notInListText = t('fields.preferenceOption.notInList', { value: current });

  if (readonly) {
    if (!current) return <EmptyValue />;
    return (
      <span className={cn('text-sm', className)} data-testid={testId} data-not-in-list={notInList || undefined}>
        {notInList ? notInListText : entry ? preferenceText(entry, preferenceList, t) : current}
      </span>
    );
  }

  const domProps = toDomProps(props);
  const disabled = props.disabled;

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

  // A failed or empty answer is no list at all: the plain text box, with no
  // notice, writing exactly what is typed.
  if (!listed || listed.length === 0) {
    return (
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
  }

  const options: FillableOption[] = listed.map((item) => ({
    value: item.name,
    label: preferenceText(item, preferenceList, t),
    notConfigured: !item.configured,
  }));
  // A stored value the list does not hold stays its own option, marked.
  if (notInList) options.unshift({ value: current, label: notInListText, notConfigured: false });

  const filtered = options.filter((option) => matchesSearch(option, search.trim()));
  // The typed text is offered as written whenever it is not already a value.
  const offerTyped = search.trim() !== '' && !options.some((option) => option.value === search);
  const commit = (next: string) => {
    onChange(next);
    setOpen(false);
    setSearch('');
  };

  // DOM pass-through onto the trigger, the widget's focusable control
  // (objectui#3318). `name` is withheld: the trigger is a button, not a
  // submission control (the `ObjectRefField` reasoning).
  const { name: _domName, ...triggerDomProps } = domProps;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          {...triggerDomProps}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={!!error}
          data-testid={testId}
          data-not-in-list={notInList || undefined}
          disabled={disabled}
          className={cn('w-full min-w-0 justify-between font-normal', className)}
        >
          <span className={cn('truncate', !current && 'text-muted-foreground')}>
            {current ? (options.find((option) => option.value === current)?.label ?? current) : t('common.select')}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[200px] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={t('table.search')}
            data-testid={`${testId}-search`}
          />
          <CommandList>
            {!offerTyped && filtered.length === 0 ? <CommandEmpty>{t('common.noResults')}</CommandEmpty> : null}
            {offerTyped ? (
              <CommandGroup>
                <CommandItem
                  value={`typed:${search}`}
                  onSelect={() => commit(search)}
                  data-testid={`${testId}-use-typed`}
                >
                  {t('fields.preferenceOption.useTyped', { value: search })}
                </CommandItem>
              </CommandGroup>
            ) : null}
            {filtered.length > 0 ? (
              <CommandGroup>
                {filtered.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`listed:${option.value}`}
                    onSelect={() => commit(option.value)}
                    data-not-configured={option.notConfigured || undefined}
                  >
                    <Check
                      className={cn('mr-2 h-4 w-4', current === option.value ? 'opacity-100' : 'opacity-0')}
                    />
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** `notification-topic`: a notification topic, from the list or typed. */
export function NotificationTopicField(props: FieldWidgetComponentProps<string>) {
  return <PreferenceOptionField {...props} preferenceList="topics" />;
}

/** `notification-channel`: a notification channel, from the list or typed. */
export function NotificationChannelField(props: FieldWidgetComponentProps<string>) {
  return <PreferenceOptionField {...props} preferenceList="channels" />;
}

export default RegistryRefField;
