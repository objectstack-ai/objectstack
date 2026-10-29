/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use client"

/**
 * The one ISO 4217 code picker (ADR-0144 D2, D8 rule 3): a searchable select
 * grouped "available" (home + rated + used) and "all".
 *
 * Two faces draw it: the record-currency code field (`CurrencyCodeField` in
 * `@object-ui/fields`, which depends on this package) and the filter row of a
 * `record`-mode amount (`FilterBuilder` here). One component, so the two
 * offer the same codes in the same order under the same labels.
 */

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { isValueDomainMember } from "@objectstack/spec/shared"

import { cn } from "../lib/utils"
import { Button } from "../ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"

/**
 * The `valueDomain` a record-currency code field declares (ADR-0144 D2): a
 * `text` field whose value is an ISO 4217 code, checked on write against the
 * spec's `iso_4217_currency` membership table.
 */
export const CURRENCY_CODE_VALUE_DOMAIN = "iso_4217_currency"

let isoCodesCache: readonly string[] | undefined

/**
 * Every code the `iso_4217_currency` value domain accepts, sorted. The
 * candidates are ICU's (`Intl.supportedValuesOf('currency')`), kept only where
 * the spec's own membership test agrees, so the list offers exactly what the
 * write path accepts and never a code it would refuse. A runtime without
 * `Intl.supportedValuesOf` offers no "all" group; the picker keeps its
 * "available" group and its current value.
 */
export function isoCurrencyCodes(): readonly string[] {
  if (isoCodesCache) return isoCodesCache
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
  const candidates = typeof supported === "function" ? supported("currency") : []
  isoCodesCache = candidates.filter((c) => isValueDomainMember(CURRENCY_CODE_VALUE_DOMAIN, c)).sort()
  return isoCodesCache
}

export interface CurrencyCodeGroups {
  /** ADR-0144 D8 rule 3 — home + rated + used, in that order, deduplicated. */
  available: string[]
  /** Every other ISO 4217 code. */
  all: string[]
}

/**
 * Split the ISO 4217 codes into the "available" group — the derived enabled
 * currencies of ADR-0144 D8 rule 3: the home currency, then every rated
 * currency, then every code already used — and "all" the rest. The current
 * value counts as used: a record that holds a code has used it. A code the
 * domain does not accept is never offered.
 */
export function currencyCodeGroups(input: {
  home?: string | null
  rated?: readonly string[]
  used?: readonly string[]
  current?: string | null
  iso?: readonly string[]
}): CurrencyCodeGroups {
  const iso = input.iso ?? isoCurrencyCodes()
  const available: string[] = []
  const seen = new Set<string>()
  for (const code of [input.home, ...(input.rated ?? []), ...(input.used ?? []), input.current]) {
    if (typeof code !== "string" || seen.has(code) || !isValueDomainMember(CURRENCY_CODE_VALUE_DOMAIN, code)) continue
    seen.add(code)
    available.push(code)
  }
  return { available, all: iso.filter((c) => !seen.has(c)) }
}

/** `USD — US Dollar` in `locale`, or the bare code when ICU has no name. */
export function currencyCodeLabel(code: string, locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: "currency" }).of(code)
    return name && name !== code ? `${code} — ${name}` : code
  } catch {
    return code
  }
}

export interface CurrencyCodePickerProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value" | "onChange"> {
  value?: string
  /** Called with the code the user picked — never with a blank. */
  onChange: (code: string) => void
  /** The organization currency, first in "available". */
  home?: string | null
  /** Rated codes (the exchange-rate table), after home. */
  rated?: readonly string[]
  /** Codes stored on the object's records, after rated. */
  used?: readonly string[]
  locale: string
  labels: {
    placeholder: string
    search: string
    noResults: string
    available: string
    all: string
  }
  invalid?: boolean
}

/**
 * The picker. Re-selecting the selected code keeps it — there is no "click
 * again to clear", because a blank code is what the server refuses and what
 * a record-mode filter cannot compare under.
 */
export function CurrencyCodePicker({
  value,
  onChange,
  home,
  rated,
  used,
  locale,
  labels,
  invalid,
  className,
  disabled,
  ...triggerProps
}: CurrencyCodePickerProps) {
  const [open, setOpen] = React.useState(false)
  const current = typeof value === "string" && value !== "" ? value : undefined
  const groups = currencyCodeGroups({ home, rated, used, current })
  const item = (code: string) => (
    <CommandItem
      key={code}
      value={code}
      keywords={[currencyCodeLabel(code, locale)]}
      onSelect={() => {
        onChange(code)
        setOpen(false)
      }}
    >
      <Check className={cn("mr-2 h-4 w-4", current === code ? "opacity-100" : "opacity-0")} />
      {currencyCodeLabel(code, locale)}
    </CommandItem>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          {...triggerProps}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          className={cn("w-full min-w-0 justify-between font-normal", className)}
          disabled={disabled}
        >
          <span className="truncate">{current ? currencyCodeLabel(current, locale) : labels.placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0">
        <Command>
          <CommandInput placeholder={labels.search} />
          <CommandList>
            <CommandEmpty>{labels.noResults}</CommandEmpty>
            {groups.available.length > 0 && (
              <CommandGroup heading={labels.available}>{groups.available.map(item)}</CommandGroup>
            )}
            {groups.all.length > 0 && <CommandGroup heading={labels.all}>{groups.all.map(item)}</CommandGroup>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
