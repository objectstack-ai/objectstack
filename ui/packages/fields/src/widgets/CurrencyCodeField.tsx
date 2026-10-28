import React from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  EmptyValue,
  cn,
} from '@object-ui/components';
import { isValueDomainMember } from '@objectstack/spec/shared';
import { useLocalization, useDisplayLocale } from '@object-ui/i18n';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { useFieldTranslation } from './useFieldTranslation.js';

/**
 * The `valueDomain` a record-currency code field declares (ADR-0144 D2): a
 * `text` field whose value is an ISO 4217 code, checked on write against the
 * spec's `iso_4217_currency` membership table.
 */
export const CURRENCY_CODE_VALUE_DOMAIN = 'iso_4217_currency';

/** Whether `field` is a text field the `iso_4217_currency` domain governs. */
export function isCurrencyCodeField(field: unknown): boolean {
  return (field as { valueDomain?: unknown } | null | undefined)?.valueDomain === CURRENCY_CODE_VALUE_DOMAIN;
}

let isoCodesCache: readonly string[] | undefined;

/**
 * Every code the `iso_4217_currency` value domain accepts, sorted. The
 * candidates are ICU's (`Intl.supportedValuesOf('currency')`), kept only where
 * the spec's own membership test agrees, so the list offers exactly what the
 * write path accepts and never a code it would refuse. A runtime without
 * `Intl.supportedValuesOf` offers no "all" group; the field keeps its
 * "available" group and its current value.
 */
export function isoCurrencyCodes(): readonly string[] {
  if (isoCodesCache) return isoCodesCache;
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const candidates = typeof supported === 'function' ? supported('currency') : [];
  isoCodesCache = candidates.filter((c) => isValueDomainMember(CURRENCY_CODE_VALUE_DOMAIN, c)).sort();
  return isoCodesCache;
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

export interface CurrencyCodeGroups {
  /** ADR-0144 D8 rule 3 — home + rated + used, in that order, deduplicated. */
  available: string[];
  /** Every other ISO 4217 code. */
  all: string[];
}

/**
 * Split the ISO 4217 codes into the "available" group — the derived enabled
 * currencies of ADR-0144 D8 rule 3: the home currency, then every rated
 * currency, then every code already used — and "all" the rest. The current
 * value counts as used: a record that holds a code has used it. A code the
 * domain does not accept is never offered.
 */
export function currencyCodeGroups(input: {
  home?: string | null;
  rated?: readonly string[];
  used?: readonly string[];
  current?: string | null;
  iso?: readonly string[];
}): CurrencyCodeGroups {
  const iso = input.iso ?? isoCurrencyCodes();
  const available: string[] = [];
  const seen = new Set<string>();
  for (const code of [input.home, ...(input.rated ?? []), ...(input.used ?? []), input.current]) {
    if (typeof code !== 'string' || seen.has(code) || !isValueDomainMember(CURRENCY_CODE_VALUE_DOMAIN, code)) continue;
    seen.add(code);
    available.push(code);
  }
  return { available, all: iso.filter((c) => !seen.has(c)) };
}

/** `USD — US Dollar` in the display locale, or the bare code when ICU has no name. */
function currencyLabel(code: string, locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'currency' }).of(code);
    return name && name !== code ? `${code} — ${name}` : code;
  } catch {
    return code;
  }
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
  const [open, setOpen] = React.useState(false);
  const current = typeof value === 'string' && value !== '' ? value : undefined;

  if (readonly) {
    return current ? <span className="text-sm">{currencyLabel(current, locale)}</span> : <EmptyValue />;
  }

  const groups = currencyCodeGroups({ home, rated: ratedCurrencyCodes(), current });
  const domProps = toDomProps(props);
  const item = (code: string) => (
    <CommandItem
      key={code}
      value={code}
      keywords={[currencyLabel(code, locale)]}
      onSelect={() => {
        onChange(code);
        setOpen(false);
      }}
    >
      <Check className={cn('mr-2 h-4 w-4', current === code ? 'opacity-100' : 'opacity-0')} />
      {currencyLabel(code, locale)}
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          {...domProps}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={!!error}
          className={cn('w-full min-w-0 justify-between font-normal', className)}
          disabled={readonly || domProps.disabled}
        >
          <span className="truncate">
            {current ? currencyLabel(current, locale) : (field?.placeholder || t('fields.currencyCode.placeholder'))}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0">
        <Command>
          <CommandInput placeholder={t('fields.currencyCode.search')} />
          <CommandList>
            <CommandEmpty>{t('fields.currencyCode.noResults')}</CommandEmpty>
            {groups.available.length > 0 && (
              <CommandGroup heading={t('fields.currencyCode.available')}>{groups.available.map(item)}</CommandGroup>
            )}
            {groups.all.length > 0 && (
              <CommandGroup heading={t('fields.currencyCode.all')}>{groups.all.map(item)}</CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
