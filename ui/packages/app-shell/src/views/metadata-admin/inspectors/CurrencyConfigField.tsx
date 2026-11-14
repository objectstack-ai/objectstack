/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The Studio field editor's currency section: a currency amount's
 * `currencyConfig` (ADR-0144 D2), in its three modes —
 *
 *  - `dynamic` (the default): no currency of its own; the organization
 *    currency displays;
 *  - `fixed`: one currency, `defaultCurrency`;
 *  - `record`: each record names its own, in the sibling code field
 *    `currencyField` points at, or a master-detail child takes its parent's,
 *    through a `currencyField` path `<master_detail>.<parent code field>`.
 *
 * The pointer is picked from the object's own record-currency code fields —
 * `text` fields declaring `valueDomain: 'iso_4217_currency'`, the only fields
 * the spec accepts there — or from those of a parent reached through one of
 * the object's `master_detail` fields; and "Create currency field" writes one such field
 * with explicit metadata and points at it, so the author never has to know the
 * convention to get a valid declaration. Nothing here guesses a code or a
 * pointer: an unpicked pointer stays absent and the spec's own refusal says so
 * on save.
 *
 * A stored `record`-mode amount may also declare `homeAmount` (ADR-0144 D5):
 * the home field, document date and rate field the engine writes the amount's
 * home-currency conversion into. The three pickers list what the spec's object
 * judge accepts; the judge stays the authority, and the tests hold every
 * offered pick to it by parsing the object.
 */

import * as React from 'react';
import { Button } from '@object-ui/components';
import { Plus } from 'lucide-react';
import { InspectorSelectField, InspectorTextField } from './_shared.js';
import { readFields, type FieldEntry } from '../previews/object-fields-io.js';
import { useMetadataClient } from '../useMetadata.js';

/** The record-currency code field's value domain (ADR-0144 D2). */
export const CURRENCY_CODE_VALUE_DOMAIN = 'iso_4217_currency';

/** The naming convention for a record-currency code field (guidance, never a contract — ADR-0144 D8 rule 2). */
export const CURRENCY_CODE_FIELD_NAME = 'currency_code';

export type CurrencyMode = 'dynamic' | 'fixed' | 'record';

/** `homeAmount` as authored: each pointer absent until picked (the spec refuses a partial one on save). */
export interface HomeAmountDraft {
  field?: string;
  rateDate?: string;
  rateField?: string;
}

export interface CurrencyConfigDraft {
  currencyMode?: CurrencyMode;
  defaultCurrency?: string;
  currencyField?: string;
  homeAmount?: HomeAmountDraft;
}

/** The fields each `homeAmount` pointer may name, from {@link homeAmountCandidates}. */
export interface HomeAmountCandidates {
  field: string[];
  rateDate: string[];
  rateField: string[];
}

/** The scale an exchange rate carries; a rate field declaring less would show it rounded. */
const RATE_SCALE = 12;

/** Written by the engine alone: `readonly: true` and no `expression` (ADR-0144 D5). */
const isEngineWritten = (def: Record<string, unknown> | undefined): boolean =>
  def?.readonly === true && def.expression === undefined;

const homeAmountOf = (def: Record<string, unknown> | undefined): HomeAmountDraft | undefined => {
  const config = def?.currencyConfig as CurrencyConfigDraft | undefined;
  return config?.currencyMode === 'record' && config.homeAmount && typeof config.homeAmount === 'object'
    ? config.homeAmount
    : undefined;
};

/**
 * The fields of `entries` each `homeAmount` pointer of the amount `self` may
 * name: a stored `dynamic` `currency` field no other amount stores its home
 * amount in; a `date` / `datetime` document date; a `number` rate field with
 * scale 12 or none, not shared with an amount in another code field or on
 * another document date. The home and rate fields are engine-written.
 */
export function homeAmountCandidates(entries: readonly FieldEntry[], self: string): HomeAmountCandidates {
  const own = entries.find((e) => e.name === self)?.def;
  const ownConfig = own?.currencyConfig as CurrencyConfigDraft | undefined;
  const others = entries.filter((e) => e.name !== self && homeAmountOf(e.def));
  const homeTaken = new Set(others.map((e) => homeAmountOf(e.def)!.field));
  const rateDate = ownConfig?.homeAmount?.rateDate;
  const rateTaken = new Set(
    others
      .filter((e) => {
        const config = e.def.currencyConfig as CurrencyConfigDraft;
        return config.currencyField !== ownConfig?.currencyField || config.homeAmount!.rateDate !== rateDate;
      })
      .map((e) => homeAmountOf(e.def)!.rateField),
  );
  const rest = entries.filter((e) => e.name !== self);
  return {
    field: rest
      .filter((e) => e.def.type === 'currency' && isEngineWritten(e.def) && !homeTaken.has(e.name))
      .filter((e) => ((e.def.currencyConfig as CurrencyConfigDraft | undefined)?.currencyMode ?? 'dynamic') === 'dynamic')
      .map((e) => e.name),
    rateDate: rest.filter((e) => e.def.type === 'date' || e.def.type === 'datetime').map((e) => e.name),
    rateField: rest
      .filter((e) => e.def.type === 'number' && isEngineWritten(e.def) && !rateTaken.has(e.name))
      .filter((e) => typeof e.def.scale !== 'number' || e.def.scale >= RATE_SCALE)
      .map((e) => e.name),
  };
}

/**
 * `config` with one `homeAmount` pointer set, or deleted when `value` is
 * empty; `homeAmount` itself is deleted once no pointer is left.
 */
export function setHomeAmountPointer(
  config: CurrencyConfigDraft,
  key: keyof HomeAmountDraft,
  value: string,
): CurrencyConfigDraft {
  const { homeAmount, ...rest } = config;
  const next: HomeAmountDraft = { ...homeAmount };
  if (value) next[key] = value;
  else delete next[key];
  return Object.keys(next).length > 0 ? { ...rest, homeAmount: next } : rest;
}

/** Whether a field def is a record-currency code field: `text` + the ISO 4217 domain. */
export function isCurrencyCodeFieldDef(def: Record<string, unknown> | undefined): boolean {
  return def?.type === 'text' && def.valueDomain === CURRENCY_CODE_VALUE_DOMAIN;
}

/** The fields of `entries` (other than `self`) a `record`-mode pointer may name. */
export function currencyCodeFieldCandidates(entries: readonly FieldEntry[], self: string): string[] {
  return entries.filter((e) => e.name !== self && isCurrencyCodeFieldDef(e.def)).map((e) => e.name);
}

/** A `master_detail` field of this object and the parent object it names. */
export interface MasterDetailParent {
  via: string;
  reference: string;
}

/**
 * The `master_detail` fields of `entries` (other than `self`) with the parent
 * object each names: the relations a `record`-mode pointer may follow to the
 * parent's code field (ADR-0144 D2 as amended, `MASTER_DETAIL.CODE`). A
 * `lookup` is not one; only a master-detail child takes its parent's currency.
 */
export function masterDetailParents(entries: readonly FieldEntry[], self: string): MasterDetailParent[] {
  return entries.flatMap((e) =>
    e.name !== self && e.def.type === 'master_detail' && typeof e.def.reference === 'string' && e.def.reference
      ? [{ via: e.name, reference: e.def.reference }]
      : [],
  );
}

/**
 * The parent paths a `record`-mode pointer may name, `<master_detail>.<code
 * field>`, one per code field of each parent in `parentFields` (keyed by
 * object name). A parent not read yet offers nothing.
 */
export function parentCurrencyCodeFieldCandidates(
  parents: readonly MasterDetailParent[],
  parentFields: Readonly<Record<string, readonly FieldEntry[]>>,
): string[] {
  return parents.flatMap(({ via, reference }) =>
    (parentFields[reference] ?? []).filter((e) => isCurrencyCodeFieldDef(e.def)).map((e) => `${via}.${e.name}`),
  );
}

/**
 * Every pointer the `record`-mode picker of `self` offers: this object's own
 * code fields, then the parent code fields reached through its `master_detail`
 * fields, read from each parent object (draft-overlaid, as every Studio picker
 * reads an object). A stored parent path through one of those relations is
 * kept while its parent is unread or the read failed, so it reads as the
 * author's pick rather than as missing; once the parent is read, a path to a
 * field it does not have is left out and reads as not found.
 */
export function useCurrencyCodeFieldCandidates(entries: readonly FieldEntry[], self: string, stored?: string): string[] {
  const client = useMetadataClient();
  const parents = masterDetailParents(entries, self);
  const references = [...new Set(parents.map((p) => p.reference))].sort().join('\u0000');
  const [parentFields, setParentFields] = React.useState<Readonly<Record<string, readonly FieldEntry[]>>>({});
  React.useEffect(() => {
    if (!references) return;
    let cancelled = false;
    for (const reference of references.split('\u0000')) {
      client
        .withPreviewDrafts(true)
        .get<Record<string, unknown>>('object', reference)
        .then((obj) => {
          if (cancelled || !obj) return;
          const read = readFields((obj as { fields?: unknown }).fields).entries;
          setParentFields((prev) => ({ ...prev, [reference]: read }));
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [client, references]);
  const own = currencyCodeFieldCandidates(entries, self);
  const viaParent = parentCurrencyCodeFieldCandidates(parents, parentFields);
  const out = [...own, ...viaParent];
  const dot = stored ? stored.indexOf('.') : -1;
  if (stored && dot > 0 && !out.includes(stored)) {
    const parent = parents.find((p) => p.via === stored.slice(0, dot));
    if (parent && !parentFields[parent.reference]) out.push(stored);
  }
  return out;
}

/** `currency_code`, or `currency_code_2`, `_3`, … when the name is taken. */
export function nextCurrencyCodeFieldName(entries: readonly FieldEntry[]): string {
  const taken = new Set(entries.map((e) => e.name));
  if (!taken.has(CURRENCY_CODE_FIELD_NAME)) return CURRENCY_CODE_FIELD_NAME;
  let n = 2;
  while (taken.has(`${CURRENCY_CODE_FIELD_NAME}_${n}`)) n += 1;
  return `${CURRENCY_CODE_FIELD_NAME}_${n}`;
}

/**
 * The config a mode switch writes. Each mode keeps only the keys it reads, so
 * the spec's own pairing rule holds by construction: `currencyField` exists
 * only under `record`, and `defaultCurrency` is carried only under `fixed`. A
 * key the author already wrote for the target mode is kept; none is invented.
 */
export function switchCurrencyMode(prev: CurrencyConfigDraft | undefined, mode: CurrencyMode): CurrencyConfigDraft {
  if (mode === 'fixed') {
    return { currencyMode: 'fixed', ...(prev?.defaultCurrency ? { defaultCurrency: prev.defaultCurrency } : {}) };
  }
  if (mode === 'record') {
    return {
      currencyMode: 'record',
      ...(prev?.currencyField ? { currencyField: prev.currencyField } : {}),
      // `homeAmount` is read only under `record`, so only a record config carries one over.
      ...(prev?.currencyMode === 'record' && prev.homeAmount ? { homeAmount: prev.homeAmount } : {}),
    };
  }
  return { currencyMode: 'dynamic' };
}

/**
 * The explicit metadata "Create currency field" writes: a required `text`
 * field in the ISO 4217 domain. Required because a record-mode amount without
 * a code has no currency, and the server refuses a blank code at write.
 */
export function newCurrencyCodeFieldDef(label: string): Record<string, unknown> {
  return { type: 'text', label, valueDomain: CURRENCY_CODE_VALUE_DOMAIN, required: true };
}

export function CurrencyConfigField({
  config,
  candidates,
  homeCandidates,
  onCommit,
  onCreateCodeField,
  disabled,
  tr,
}: {
  config: CurrencyConfigDraft | undefined;
  /** {@link useCurrencyCodeFieldCandidates} of the object this field belongs to. */
  candidates: readonly string[];
  /**
   * {@link homeAmountCandidates} of the object; absent where `homeAmount` is
   * refused (a `formula` amount, never written, is never converted at write).
   */
  homeCandidates?: HomeAmountCandidates;
  /** Write the whole config. */
  onCommit: (next: CurrencyConfigDraft) => void;
  /** Append a record-currency code field and point this amount at it, in one write. */
  onCreateCodeField: () => void;
  disabled?: boolean;
  tr: (key: string) => string;
}) {
  const mode: CurrencyMode = config?.currencyMode ?? 'dynamic';
  const pointer = config?.currencyField;
  return (
    <div className="space-y-2" data-testid="currency-config-field">
      <InspectorSelectField
        label={tr('designer.field.currency.mode')}
        value={mode}
        options={[
          { value: 'dynamic', label: tr('designer.field.currency.modeDynamic') },
          { value: 'fixed', label: tr('designer.field.currency.modeFixed') },
          { value: 'record', label: tr('designer.field.currency.modeRecord') },
        ]}
        onCommit={(v) => onCommit(switchCurrencyMode(config, v as CurrencyMode))}
        disabled={disabled}
      />
      {mode === 'fixed' && (
        <InspectorTextField
          label={tr('designer.field.currency.defaultCurrency')}
          value={config?.defaultCurrency ?? ''}
          // A three-letter code, written upper-case as ISO 4217 spells it.
          onCommit={(v) => {
            const code = v.trim().toUpperCase();
            onCommit(code ? { currencyMode: 'fixed', defaultCurrency: code } : { currencyMode: 'fixed' });
          }}
          placeholder="USD"
          disabled={disabled}
        />
      )}
      {mode === 'record' && (
        <>
          <InspectorSelectField
            label={tr('designer.field.currency.currencyField')}
            value={pointer ?? ''}
            options={[
              { value: '', label: tr('designer.field.currency.currencyFieldNone') },
              ...candidates.map((name) => ({ value: name, label: name })),
            ]}
            // Unpicking DELETES the pointer: the spec refuses a `record` config
            // without one on save, which is the honest answer, rather than a
            // pointer at a field the author never chose.
            // Re-picking the code field keeps an authored `homeAmount`: it
            // names other fields, which the new pointer does not move.
            onCommit={(v) =>
              onCommit({
                currencyMode: 'record',
                ...(v ? { currencyField: v } : {}),
                ...(config?.homeAmount ? { homeAmount: config.homeAmount } : {}),
              })
            }
            required
            disabled={disabled}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCreateCodeField}
            disabled={disabled}
            data-testid="currency-config-create-code-field"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {tr('designer.field.currency.createCodeField')}
          </Button>
          <p className="text-xs text-muted-foreground">{tr('designer.field.currency.recordHint')}</p>
          {homeCandidates && (
            <div className="space-y-2 pt-2" data-testid="currency-config-home-amount">
              <p className="text-xs font-medium">{tr('designer.field.currency.homeAmount')}</p>
              {(
                [
                  ['field', 'homeField', 'homeFieldNone'],
                  ['rateDate', 'rateDate', 'rateDateNone'],
                  ['rateField', 'rateField', 'rateFieldNone'],
                ] as const
              ).map(([key, label, none]) => (
                <InspectorSelectField
                  key={key}
                  label={tr(`designer.field.currency.${label}`)}
                  value={config?.homeAmount?.[key] ?? ''}
                  options={[
                    { value: '', label: tr(`designer.field.currency.${none}`) },
                    ...homeCandidates[key].map((name) => ({ value: name, label: name })),
                  ]}
                  onCommit={(v) => onCommit(setHomeAmountPointer(config ?? { currencyMode: 'record' }, key, v))}
                  disabled={disabled}
                />
              ))}
              <p className="text-xs text-muted-foreground">{tr('designer.field.currency.homeAmountHint')}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * {@link CurrencyConfigField} for the field `self` of an object whose fields
 * are `entries`: the pointer picker offers {@link useCurrencyCodeFieldCandidates}.
 */
export function ObjectCurrencyConfigField({
  entries,
  self,
  ...rest
}: Omit<React.ComponentProps<typeof CurrencyConfigField>, 'candidates'> & {
  entries: readonly FieldEntry[];
  self: string;
}) {
  const candidates = useCurrencyCodeFieldCandidates(entries, self, rest.config?.currencyField);
  return <CurrencyConfigField {...rest} candidates={candidates} />;
}
