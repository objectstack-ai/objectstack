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
 *    `currencyField` points at.
 *
 * The pointer is picked from the object's own record-currency code fields —
 * `text` fields declaring `valueDomain: 'iso_4217_currency'`, the only fields
 * the spec accepts there — and "Create currency field" writes one such field
 * with explicit metadata and points at it, so the author never has to know the
 * convention to get a valid declaration. Nothing here guesses a code or a
 * pointer: an unpicked pointer stays absent and the spec's own refusal says so
 * on save.
 */

import * as React from 'react';
import { Button } from '@object-ui/components';
import { Plus } from 'lucide-react';
import { InspectorSelectField, InspectorTextField } from './_shared.js';
import type { FieldEntry } from '../previews/object-fields-io.js';

/** The record-currency code field's value domain (ADR-0144 D2). */
export const CURRENCY_CODE_VALUE_DOMAIN = 'iso_4217_currency';

/** The naming convention for a record-currency code field (guidance, never a contract — ADR-0144 D8 rule 2). */
export const CURRENCY_CODE_FIELD_NAME = 'currency_code';

export type CurrencyMode = 'dynamic' | 'fixed' | 'record';

export interface CurrencyConfigDraft {
  currencyMode?: CurrencyMode;
  defaultCurrency?: string;
  currencyField?: string;
}

/** Whether a field def is a record-currency code field: `text` + the ISO 4217 domain. */
export function isCurrencyCodeFieldDef(def: Record<string, unknown> | undefined): boolean {
  return def?.type === 'text' && def.valueDomain === CURRENCY_CODE_VALUE_DOMAIN;
}

/** The fields of `entries` (other than `self`) a `record`-mode pointer may name. */
export function currencyCodeFieldCandidates(entries: readonly FieldEntry[], self: string): string[] {
  return entries.filter((e) => e.name !== self && isCurrencyCodeFieldDef(e.def)).map((e) => e.name);
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
    return { currencyMode: 'record', ...(prev?.currencyField ? { currencyField: prev.currencyField } : {}) };
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
  onCommit,
  onCreateCodeField,
  disabled,
  tr,
}: {
  config: CurrencyConfigDraft | undefined;
  /** {@link currencyCodeFieldCandidates} of the object this field belongs to. */
  candidates: readonly string[];
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
            onCommit={(v) => onCommit(v ? { currencyMode: 'record', currencyField: v } : { currencyMode: 'record' })}
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
        </>
      )}
    </div>
  );
}
