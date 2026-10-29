import React from 'react';
import {
  CurrencyCodePicker,
  CURRENCY_CODE_VALUE_DOMAIN,
  currencyCodeGroups,
  currencyCodeLabel,
  isoCurrencyCodes,
  EmptyValue,
} from '@object-ui/components';
import { useLocalization, useDisplayLocale } from '@object-ui/i18n';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { useFieldTranslation } from './useFieldTranslation.js';

// The picker and its code lists live in `@object-ui/components`, which the
// filter row of a record-mode amount draws too; re-exported here so this
// widget's module keeps naming them.
export { CURRENCY_CODE_VALUE_DOMAIN, currencyCodeGroups, isoCurrencyCodes };
export type { CurrencyCodeGroups } from '@object-ui/components';

/** Whether `field` is a text field the `iso_4217_currency` domain governs. */
export function isCurrencyCodeField(field: unknown): boolean {
  return (field as { valueDomain?: unknown } | null | undefined)?.valueDomain === CURRENCY_CODE_VALUE_DOMAIN;
}

/**
 * The organization's rated currencies: every code with a row in the
 * organization's exchange-rate table. ⛔ Not served yet — the rate table
 * (`sys_exchange_rate`, ADR-0144 D3) ships in the next multi-currency release,
 * and this is the seam its reader plugs into. Until then the "available"
 * group is the home currency plus the used codes.
 */
export function ratedCurrencyCodes(): readonly string[] {
  return [];
}

/**
 * The codes already stored on the object's records, as the form renderer
 * hands them down on the field's own metadata (`usedCurrencyCodes`, read once
 * per object by `useUsedCurrencyCodes` in `@object-ui/components`). Absent
 * when the form has no object or its data source cannot answer a grouped
 * query; the record's own code still counts as used.
 */
export function usedCurrencyCodesOf(field: unknown): readonly string[] {
  const used = (field as { usedCurrencyCodes?: unknown } | null | undefined)?.usedCurrencyCodes;
  return Array.isArray(used) ? used.filter((c): c is string => typeof c === 'string') : [];
}

/**
 * CurrencyCodeField — the control a record-currency code field renders
 * (ADR-0144 D2): a searchable select of ISO 4217 codes, grouped "available"
 * (home + rated + used, D8 rule 3) and "all".
 *
 * The value it emits is always the explicit code the user sees selected
 * (D8 rule 4): picking the selected code again keeps it — there is no
 * "click again to clear" here, because a blank code is what the server
 * refuses. A create form opens it on the organization's currency through the
 * form's seeding (`schemaDefaultValues`), never through this widget, so an
 * edit form never rewrites a stored code just by being opened.
 */
export function CurrencyCodeField({ value, onChange, field, readonly, error, className, ...props }: FieldWidgetComponentProps<string>) {
  const { t } = useFieldTranslation();
  const { currency: home } = useLocalization();
  const locale = useDisplayLocale();
  const current = typeof value === 'string' && value !== '' ? value : undefined;

  if (readonly) {
    return current ? <span className="text-sm">{currencyCodeLabel(current, locale)}</span> : <EmptyValue />;
  }

  const domProps = toDomProps(props);
  return (
    <CurrencyCodePicker
      {...domProps}
      value={current}
      onChange={onChange}
      home={home}
      rated={ratedCurrencyCodes()}
      used={usedCurrencyCodesOf(field)}
      locale={locale}
      labels={{
        placeholder: field?.placeholder || t('fields.currencyCode.placeholder'),
        search: t('fields.currencyCode.search'),
        noResults: t('fields.currencyCode.noResults'),
        available: t('fields.currencyCode.available'),
        all: t('fields.currencyCode.all'),
      }}
      invalid={!!error}
      className={className}
      disabled={domProps.disabled}
    />
  );
}
