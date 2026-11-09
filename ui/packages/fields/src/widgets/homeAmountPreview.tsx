/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useContext, useEffect, useState } from 'react';
import { SchemaRendererContext, classifyLoadError } from '@object-ui/react';
import { useLocalization, useDisplayLocale, formatDisplayNumber, type FieldCurrencyConfig } from '@object-ui/i18n';
import { formatDate } from '@object-ui/core';
import { toScaledDecimal, divideToPlaces, formatScaledDecimal, documentDateOf } from '@objectstack/formula';
import { CURRENCY_FRACTION_DIGITS } from '@objectstack/spec/data';
import { isValueDomainMember } from '@objectstack/spec/shared';
import { useFieldTranslation } from './useFieldTranslation.js';
import { formatCurrency } from './number-format.js';

/** The object the engine reads rates from (ADR-0144 D3). */
const EXCHANGE_RATE_OBJECT = 'sys_exchange_rate';

/** What one rate read answered: a row, no row in force, or a read the caller may not make. */
type RateRead = { readonly kind: 'rate'; readonly rate: unknown } | { readonly kind: 'none' } | { readonly kind: 'refused' };

interface RateSource {
  find(resource: string, params?: Record<string, unknown>): Promise<unknown>;
}

/**
 * One read per adapter, currency and document date, kept for the session: the
 * engine's memo key (`memoizeHomeAmountServing`) minus the organization, which
 * the adapter's session already fixes. A failed read other than a refusal is
 * dropped so the next render asks again.
 */
const RATE_READS = new WeakMap<object, Map<string, Promise<RateRead>>>();

/**
 * The `currency` row with the latest `effective_date` on or before `date`:
 * the engine's own query (`rateOn` in `@objectstack/objectql`), never "the
 * most recent row". A 403 is `refused`, which is not "no rate".
 */
export function readRateOn(source: RateSource, currency: string, date: string): Promise<RateRead> {
  let byKey = RATE_READS.get(source);
  if (!byKey) {
    byKey = new Map();
    RATE_READS.set(source, byKey);
  }
  const key = `${currency}\u0000${date}`;
  const held = byKey.get(key);
  if (held) return held;
  const reads = byKey;
  const read = source
    .find(EXCHANGE_RATE_OBJECT, {
      $filter: { currency, effective_date: { $lte: date } },
      $orderby: [{ field: 'effective_date', order: 'desc' }],
      $top: 1,
      $select: ['rate', 'effective_date'],
    })
    .then(
      (answer): RateRead => {
        const rows = Array.isArray(answer) ? answer : (answer as { data?: unknown } | null)?.data;
        const row = Array.isArray(rows) ? (rows[0] as { rate?: unknown } | undefined) : undefined;
        return row ? { kind: 'rate', rate: row.rate } : { kind: 'none' };
      },
      (err: unknown): RateRead => {
        if (classifyLoadError(err) === 'forbidden') return { kind: 'refused' };
        reads.delete(key);
        throw err;
      },
    );
  byKey.set(key, read);
  return read;
}

/** What the line under a record-mode amount says while it is edited. */
export type HomeAmountPreviewState =
  | { readonly kind: 'same'; readonly amount: string; readonly home: string }
  | { readonly kind: 'converted'; readonly amount: string; readonly home: string; readonly rate: unknown; readonly date: string }
  | { readonly kind: 'awaitingDate' }
  | { readonly kind: 'awaitingRate'; readonly currency: string; readonly date: string }
  | { readonly kind: 'refused' };

const blank = (v: unknown): boolean => v == null || (typeof v === 'string' && v.trim() === '');
const isIsoCurrency = (code: string): boolean => isValueDomainMember('iso_4217_currency', code);

/**
 * The engine's projection (`projectHomeAmounts`) over the live form record,
 * with the same arithmetic imported from `@objectstack/formula`, so the
 * previewed number is the number the save stores. `undefined` means no line:
 * no `homeAmount`, a blank or unreadable amount or code, no home currency, no
 * adapter, or a read still in flight.
 */
export function useHomeAmountPreview(
  field: { currencyConfig?: FieldCurrencyConfig } | null | undefined,
  amountValue: unknown,
  record: Readonly<Record<string, unknown>> | null | undefined,
  dataSource: unknown,
): HomeAmountPreviewState | undefined {
  const { currency: homeSetting, timezone } = useLocalization();
  const ctx = useContext(SchemaRendererContext);
  const source = (dataSource ?? ctx?.dataSource) as RateSource | null | undefined;
  const config = field?.currencyConfig;
  const home = config?.currencyMode === 'record' ? config.homeAmount : undefined;

  const amount = home && !blank(amountValue) ? toScaledDecimal(amountValue) : undefined;
  const codeValue = home && typeof config?.currencyField === 'string' ? record?.[config.currencyField] : undefined;
  const code = typeof codeValue === 'string' ? codeValue.trim() : '';
  const homeCode = typeof homeSetting === 'string' ? homeSetting.trim() : '';
  const live = amount !== undefined && isIsoCurrency(code) && isIsoCurrency(homeCode);
  const places = live ? CURRENCY_FRACTION_DIGITS[homeCode] : undefined;
  const dateValue = live && code !== homeCode && typeof home?.rateDate === 'string' ? record?.[home.rateDate] : undefined;
  // A `YYYY-MM-DD` value is its own day whatever zone is passed; an instant
  // (a `datetime`) takes the organization's day, as the engine takes it.
  const date = blank(dateValue) ? undefined : documentDateOf(dateValue, timezone);
  const canRead = live && code !== homeCode && date !== undefined && typeof source?.find === 'function';

  const [answer, setAnswer] = useState<{ key: string; read: RateRead } | undefined>(undefined);
  const key = canRead ? `${code}\u0000${date}` : '';
  useEffect(() => {
    if (!canRead || !source) return;
    let current = true;
    readRateOn(source, code, date!).then(
      (read) => { if (current) setAnswer({ key, read }); },
      () => { if (current) setAnswer(undefined); },
    );
    return () => { current = false; };
  }, [canRead, source, code, date, key]);

  if (!live || places === undefined || amount === undefined) return undefined;
  if (code === homeCode) {
    return { kind: 'same', amount: formatScaledDecimal(divideToPlaces(amount, { digits: 1n, scale: 0 }, places)), home: homeCode };
  }
  if (blank(dateValue)) return { kind: 'awaitingDate' };
  if (!canRead || answer?.key !== key) return undefined;
  const read = answer.read;
  if (read.kind === 'refused') return { kind: 'refused' };
  const rate = read.kind === 'rate' ? toScaledDecimal(read.rate) : undefined;
  if (rate === undefined || rate.digits <= 0n) return { kind: 'awaitingRate', currency: code, date: date! };
  return {
    kind: 'converted',
    amount: formatScaledDecimal(divideToPlaces(amount, rate, places)),
    home: homeCode,
    rate: read.kind === 'rate' ? read.rate : undefined,
    date: date!,
  };
}

/** The "≈ home amount" line under a `record`-mode amount declaring `homeAmount` (ADR-0144 D5). */
export function HomeAmountPreview({
  field,
  amount,
  record,
  dataSource,
}: {
  field: { currencyConfig?: FieldCurrencyConfig } | null | undefined;
  amount: unknown;
  record: Readonly<Record<string, unknown>> | null | undefined;
  dataSource?: unknown;
}): React.ReactElement | null {
  const { t } = useFieldTranslation();
  const locale = useDisplayLocale();
  const state = useHomeAmountPreview(field, amount, record, dataSource);
  if (!state) return null;
  const line = (text: string) => (
    <p className="text-xs text-muted-foreground" data-testid="home-amount-preview" data-state={state.kind}>{text}</p>
  );
  switch (state.kind) {
    case 'same':
      return line(t('fields.currencyHome.previewSame', { amount: formatCurrency(Number(state.amount), state.home, locale) }));
    case 'converted':
      return line(t('fields.currencyHome.preview', {
        amount: formatCurrency(Number(state.amount), state.home, locale),
        rate: formatDisplayNumber(Number(state.rate), { locale, maximumFractionDigits: 12 }),
        date: formatDate(state.date, undefined, { alwaysShowYear: true }),
      }));
    case 'awaitingDate':
      return line(t('fields.currencyHome.awaitingDate'));
    case 'awaitingRate':
      return line(t('fields.currencyHome.awaitingRate', {
        currency: state.currency,
        date: formatDate(state.date, undefined, { alwaysShowYear: true }),
      }));
    case 'refused':
      return line(t('fields.currencyHome.rateUnreadable'));
  }
}
