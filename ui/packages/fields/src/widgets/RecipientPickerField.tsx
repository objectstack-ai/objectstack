import React from 'react';
import { Combobox, EmptyValue, cn } from '@object-ui/components';
import { MetadataCtx, SchemaRendererContext } from '@object-ui/react';
import type { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { useFieldTranslation } from './useFieldTranslation.js';
// The kind table is shared with the read cell (objectui#12613), so a kind
// reads the same in the list and in this picker.
import {
  FIELD_RECIPIENT_TYPE,
  RECIPIENT_RECORD_KINDS,
  RECIPIENT_REGISTRY_KINDS,
  recipientCandidateLabel,
} from './recipientKinds.js';

/**
 * RecipientPickerField — dependent record picker for a polymorphic recipient
 * reference (e.g. `sys_sharing_rule.recipient_id`), whose target object is
 * decided by a sibling `recipient_type` select.
 *
 * Reached via the field `widget: 'recipient-picker'` hint (resolves as
 * `field:recipient-picker`). Reads the live `recipient_type` from
 * `dependentValues` (the form record), loads candidate records of the mapped
 * object via `dataSource.find(...)`, and stores the value the sharing evaluator
 * expects for that type:
 *
 *   user                  → sys_user, store `id`
 *   team                  → sys_team, store `id`
 *   business_unit         → sys_business_unit, store `id`
 *   unit_and_subordinates → sys_business_unit, store `id`
 *
 * One kind lists CATALOG ITEMS instead of records (objectui#7611, ADR-0131
 * D3/D7): its candidates are the `position` items of the environment registry,
 * read through the console's metadata store, and the picker stores the item's
 * `name` (matched against `sys_user_position.position` at evaluation time):
 *
 *   position              → the `position` registry, store `name`
 *
 * One kind is NOT a record picker and therefore has no row above:
 *
 *   field                 → a user-valued COLUMN of the shared object, store
 *                           the column's `name` (see FIELD_RECIPIENT_TYPE)
 *
 * When `recipient_type` changes after mount the stored id is reset (an id valid
 * for one type is meaningless for another). Unknown types degrade to a plain
 * text input so nothing breaks.
 */
/** A user-valued column offered by the `field` recipient mode. */
interface UserFieldDef {
  /** The machine name — this is what gets stored in `recipient_id`. */
  name: string;
  label: string;
}

/**
 * Does this declared field hold USERS?
 *
 * ⭐ This predicate is the picker's half of a two-sided agreement with the
 * sharing evaluator, which asks the same question of the same two spellings:
 * the `user` type (whose target is fixed to `sys_user` by the type itself —
 * `Field.user()` takes no target), and a `lookup` / `master_detail` whose
 * `reference` is `sys_user`.
 *
 * ⛔ The two must not drift apart. The evaluator treats a column that is not
 * user-typed as "grants nobody" and warns once per rule, so a picker that
 * OFFERED a wider set would let an admin save a rule that looks configured and
 * authorises nobody — worse than the hand-typed name this mode replaces,
 * because it has a credible appearance.
 *
 * `reference` is the only spelling the protocol declares (objectui#6837):
 * `FieldSchema` refuses `reference_to` by name, and the evaluator reads
 * `reference` as well.
 *
 * @internal exported for tests
 */
export function fieldHoldsUsers(def: unknown): boolean {
  if (!def || typeof def !== 'object') return false;
  const d = def as { type?: unknown; reference?: unknown };
  return (
    d.type === 'user' ||
    ((d.type === 'lookup' || d.type === 'master_detail') && d.reference === 'sys_user')
  );
}

/**
 * The user-valued columns of an object schema, in declaration order.
 *
 * Accepts both shapes an object schema spells `fields` in — a name-keyed map
 * and an array of definitions carrying their own `name`.
 *
 * ⛔ `hidden` is deliberately NOT filtered here, unlike the filter builder's
 * own field derivation: the evaluator honours a hidden user column exactly
 * like a visible one, and withholding it would break the agreement above in
 * the other direction — an authorable, working configuration the picker
 * refuses to offer.
 *
 * @internal exported for tests
 */
export function deriveUserFields(schema: any): UserFieldDef[] {
  const raw = schema?.fields;
  const entries: Array<[string, any]> = Array.isArray(raw)
    ? raw.map((f: any) => [f?.name, f])
    : raw && typeof raw === 'object'
      ? Object.entries(raw)
      : [];
  const out: UserFieldDef[] = [];
  for (const [name, f] of entries) {
    if (!name || !fieldHoldsUsers(f)) continue;
    out.push({ name: String(name), label: f.label ? String(f.label) : String(name) });
  }
  return out;
}

export function RecipientPickerField({
  value,
  onChange,
  readonly,
  className,
  error,
  ...props
}: FieldWidgetComponentProps<string>) {
  const ctx = React.useContext(SchemaRendererContext);
  const { t } = useFieldTranslation();
  // Cast-free context read (objectui#7912); the local stays `any` for the
  // `FieldWidgetProps.dataSource?: unknown` channel it merges with.
  const dataSource: any = props.dataSource ?? ctx?.dataSource ?? null;
  const disabled = props.disabled;
  const dependentValues: Record<string, any> = (props as any).dependentValues ?? {};
  const recipientType = String(dependentValues.recipient_type ?? '');
  const recordMapping = RECIPIENT_RECORD_KINDS[recipientType];
  // The console's metadata store, or `null` outside a `<MetadataProvider>`.
  // Read raw rather than through `useMetadata()`, whose no-provider fallback
  // answers every type with `[]`: an empty registry and an absent reader are
  // different facts, and only the second degrades to the text input below.
  const metadataStore = React.useContext(MetadataCtx);
  const registryMapping = metadataStore ? RECIPIENT_REGISTRY_KINDS[recipientType] : undefined;
  const mapping: { storeField: 'id' | 'name'; labelFields: string[]; placeholderKey: string } | undefined =
    recordMapping ?? registryMapping;
  const objectName = String(dependentValues.object_name ?? '');
  const isFieldRecipient = recipientType === FIELD_RECIPIENT_TYPE;
  // Only this data source can answer "which columns does that object declare?".
  // Without it the mode falls through to the degraded text input below rather
  // than rendering a list that can never fill — the same "nothing breaks"
  // promise the header makes for an unknown type.
  const canListObjectFields =
    isFieldRecipient && !!dataSource && typeof dataSource.getObjectSchema === 'function';

  const [records, setRecords] = React.useState<any[] | null>(null);
  const [userFields, setUserFields] = React.useState<UserFieldDef[] | null>(null);

  // Reset the stored recipient when the admin PICKS a different type (an id for
  // a user is not a valid team/business-unit id).
  //
  // "Different type" means one non-empty type replacing another. The empty
  // string is not a type — it is the edit form before the record has hydrated,
  // and treating `'' → 'user'` as a change wiped the saved recipient the moment
  // an existing rule was opened for editing (objectstack#3821): the picker went
  // blank, and saving persisted the blank. Only a non-empty predecessor can
  // invalidate the stored id.
  const prevType = React.useRef<string>('');
  React.useEffect(() => {
    if (prevType.current && recipientType && prevType.current !== recipientType && value) {
      onChange('' as any);
    }
    prevType.current = recipientType;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientType]);

  React.useEffect(() => {
    setRecords(null);
    if (!dataSource || !recordMapping || typeof dataSource.find !== 'function') return;
    let cancelled = false;
    (async () => {
      try {
        // Object form, not the 'name asc' clause string: the clause string is
        // supported again (objectstack#3821 fixed ApiDataSource walking it
        // character by character), but the structured form can't regress that
        // way for any data source.
        const res = await dataSource.find(recordMapping.object, { $top: 500, $orderby: { name: 'asc' } });
        const list: any[] = res?.data ?? res?.records ?? (Array.isArray(res) ? res : []);
        if (!cancelled) setRecords(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setRecords([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataSource, recordMapping?.object]);

  // The registry kinds' load (objectui#7611): the type's catalog items, from
  // the metadata store. Sorted by machine name, the order the record kinds
  // ask the server for. Keyed on the TYPE alone: the store's context value is
  // rebuilt whenever any type it caches settles, and AGENTS.md #10 forbids an
  // effect that keys on that identity, so the store is read through a ref.
  const metadataStoreRef = React.useRef(metadataStore);
  metadataStoreRef.current = metadataStore;
  const registryType = registryMapping?.type;
  React.useEffect(() => {
    const store = metadataStoreRef.current;
    if (!registryType || !store) return;
    setRecords(null);
    let cancelled = false;
    store
      .ensureType(registryType)
      .then((items) => {
        if (cancelled) return;
        const list = (Array.isArray(items) ? items : []).filter(
          (it: any) => typeof it?.name === 'string' && it.name,
        );
        setRecords([...list].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))));
      })
      .catch(() => {
        if (!cancelled) setRecords([]);
      });
    return () => {
      cancelled = true;
    };
  }, [registryType]);

  // The `field` mode's own load: the SHARED object's schema, keyed on the
  // sibling `object_name`. Re-run when the admin switches object, so the
  // offered columns always belong to the object the rule actually names.
  React.useEffect(() => {
    setUserFields(null);
    if (!canListObjectFields || !objectName) return;
    let cancelled = false;
    (async () => {
      try {
        const schema = await dataSource.getObjectSchema(objectName);
        if (!cancelled) setUserFields(deriveUserFields(schema));
      } catch {
        if (!cancelled) setUserFields([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataSource, objectName, canListObjectFields]);

  const labelOf = (r: any): string => recipientCandidateLabel(mapping?.labelFields, r);
  const valueOf = (r: any): string => String(r?.[mapping?.storeField ?? 'id'] ?? '');

  const options = React.useMemo(() => {
    const opts = (records ?? [])
      .map((r) => ({ value: valueOf(r), label: labelOf(r) }))
      .filter((o) => o.value);
    if (value && !opts.some((o) => o.value === value)) opts.unshift({ value, label: value });
    return opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, value, mapping]);

  const userFieldOptions = React.useMemo(
    () => (userFields ?? []).map((f) => ({ value: f.name, label: f.label })),
    [userFields],
  );

  // DOM pass-through onto the combobox trigger — the widget's real focusable
  // control (objectui#3318). `name` is withheld: the trigger is a button, not
  // a submission control (same reasoning as #3306's SelectTrigger).
  //
  // NOTE this widget stays on the #3318 ledger regardless: its dependency-
  // gated state (no `recipient_type` chosen yet — the state a fresh form and
  // the registry sweep render) is a plain hint paragraph with no focusable
  // control, so there is nothing there to carry the attribute.
  const { name: _domName, ...triggerDomProps } = toDomProps(props);

  if (!recipientType) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        {t('fields.recipient.selectTypeFirst')}
      </p>
    );
  }

  if (canListObjectFields) {
    if (!objectName) {
      // Deliberately the SAME key the criteria builder's gate sentence uses,
      // not a `fields.recipient.*` twin: it is the same sentence, in the same
      // role, on the same form, gating on the same sibling field — and a
      // second spelling is precisely how two copies of one deliberately
      // shared sentence come to read differently in a locale.
      return (
        <p className={cn('text-sm text-muted-foreground', className)}>
          {t('fields.filterCondition.selectObjectFirst')}
        </p>
      );
    }

    // The stored name stays VISIBLE even when it is not on the offered list —
    // a column deleted or retyped since the rule was saved. Dropping it would
    // leave the control looking empty while the rule still names that column;
    // the evaluator grants NOBODY for it, so the option says so instead of
    // reading like any other choice.
    const fieldOpts =
      value && !userFieldOptions.some((o) => o.value === value)
        ? [{ value, label: t('fields.recipient.fieldNotUserTyped', { name: value }) }, ...userFieldOptions]
        : userFieldOptions;

    if (readonly) {
      if (!value) return <EmptyValue />;
      return (
        <span className={className}>{fieldOpts.find((o) => o.value === value)?.label ?? value}</span>
      );
    }

    return (
      <Combobox
        {...triggerDomProps}
        options={fieldOpts}
        value={value ?? ''}
        onValueChange={(v) => onChange(v as any)}
        placeholder={
          userFields === null ? t('fields.recipient.loading') : t('fields.recipient.selectField')
        }
        searchPlaceholder={t('fields.recipient.search')}
        emptyText={
          userFields === null ? t('fields.recipient.loading') : t('fields.recipient.noUserFields')
        }
        disabled={disabled}
        className={cn('w-full', className)}
        // AFTER the spread so this widget's own computation wins (#3222).
        aria-invalid={!!error}
      />
    );
  }

  if (!mapping) {
    // Unknown / unsupported recipient type — keep a plain text input so the
    // field is never un-editable. `field` reaches here too when the data
    // source cannot enumerate an object's columns: a hand-typed name is worse
    // than a list, and better than a list that can never fill.
    return (
      <input
        // DOM pass-through onto the real focusable control (objectui#3318).
        {...toDomProps(props)}
        className={cn(
          'w-full rounded border bg-background px-2 py-1 text-sm',
          className,
        )}
        value={value ?? ''}
        disabled={disabled || readonly}
        onChange={(e) => onChange(e.target.value as any)}
        aria-invalid={!!error}
      />
    );
  }

  if (readonly) {
    if (!value) return <EmptyValue />;
    return <span className={className}>{options.find((o) => o.value === value)?.label ?? value}</span>;
  }

  return (
    <Combobox
      {...triggerDomProps}
      options={options}
      value={value ?? ''}
      onValueChange={(v) => onChange(v as any)}
      placeholder={
        records === null
          ? t('fields.recipient.loading')
          : t(mapping.placeholderKey ?? 'fields.recipient.select')
      }
      searchPlaceholder={t('fields.recipient.search')}
      emptyText={records === null ? t('fields.recipient.loading') : t('fields.recipient.empty')}
      disabled={disabled}
      className={cn('w-full', className)}
      // AFTER the spread so this widget's own computation wins (#3222).
      aria-invalid={!!error}
    />
  );
}

export default RecipientPickerField;
