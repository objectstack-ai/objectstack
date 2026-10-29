/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The "used" half of a record-currency code field's "available" group
 * (ADR-0144 D8 rule 3): the codes already stored on the object's records.
 *
 * The form renderer reads them ONCE per object and code field — one grouped
 * header query (`DataSource.queryGroupHeaders`, grouped by the code field),
 * whose rows are exactly the distinct stored codes — and hands them down on
 * the field's own metadata (`usedCurrencyCodes`), the carrier the code field
 * already receives. No widget-contract key: a widget written against
 * `FieldWidgetPropsSchema` sees one more fact on `field`, and nothing else.
 *
 * A form with no object, or over a data source that cannot answer a grouped
 * query, asks nothing and hands nothing down: the code field then offers home
 * + rated + the record's own code. `aggregate` is not asked instead — it may
 * degrade to fetching every row, which is no price for a dropdown.
 */

import * as React from "react"
import { compileListViewGroupQuery } from "@objectstack/spec/ui"
import { isValueDomainMember } from "@objectstack/spec/shared"
import type { DataSource } from "@object-ui/types"
import { CURRENCY_CODE_VALUE_DOMAIN } from "../../custom/currency-code-picker"

/** The metadata key the code field reads its used codes from. */
export const USED_CURRENCY_CODES_KEY = "usedCurrencyCodes"

/** Names of the fields in `fields` that are record-currency code fields. */
export function currencyCodeFieldNames(fields: readonly unknown[]): string[] {
  const out: string[] = []
  for (const f of fields as Array<{ name?: unknown; field?: { valueDomain?: unknown } } | null | undefined>) {
    const def = f?.field ?? (f as { valueDomain?: unknown } | null | undefined)
    if (typeof f?.name === "string" && def?.valueDomain === CURRENCY_CODE_VALUE_DOMAIN) out.push(f.name)
  }
  return out
}

/** The one header query whose rows are the distinct codes of `codeField`. */
export function usedCurrencyCodesQuery(codeField: string) {
  return compileListViewGroupQuery({ grouping: { fields: [{ field: codeField }] } } as never, { depth: 1 })
}

/** The distinct, domain-valid codes of `codeField` in a header answer, sorted. */
export function readUsedCurrencyCodes(rows: readonly Record<string, unknown>[] | undefined, codeField: string): string[] {
  const codes = new Set<string>()
  for (const row of rows ?? []) {
    const code = row?.[codeField]
    if (typeof code === "string" && isValueDomainMember(CURRENCY_CODE_VALUE_DOMAIN, code)) codes.add(code)
  }
  return [...codes].sort()
}

/** `def` carrying its used codes, or `def` itself when there are none to carry. */
export function withUsedCurrencyCodes<T>(def: T, codes: readonly string[] | undefined): T {
  if (!codes || codes.length === 0 || def == null || typeof def !== "object") return def
  return { ...(def as object), [USED_CURRENCY_CODES_KEY]: codes } as T
}

/**
 * Code field name → the codes its object's records hold. Asked once per
 * (object, code fields) — keyed on content, so a host that rebuilds its field
 * list every render does not re-ask. A failed read leaves that field's entry
 * out; the picker still works.
 */
export function useUsedCurrencyCodes(
  dataSource: DataSource | null | undefined,
  objectName: string | undefined,
  codeFields: readonly string[],
): Record<string, string[]> {
  const [used, setUsed] = React.useState<Record<string, string[]>>({})
  const fieldsKey = codeFields.join("\u0000")
  const canAsk = !!objectName && codeFields.length > 0 && typeof dataSource?.queryGroupHeaders === "function"

  React.useEffect(() => {
    if (!canAsk || !dataSource || !objectName) {
      setUsed((prev) => (Object.keys(prev).length === 0 ? prev : {}))
      return
    }
    let cancelled = false
    const names = fieldsKey.split("\u0000")
    Promise.all(
      names.map((name) =>
        Promise.resolve()
          .then(() => dataSource.queryGroupHeaders!(objectName, usedCurrencyCodesQuery(name)))
          .then(
            (rows) => [name, readUsedCurrencyCodes(rows as Record<string, unknown>[], name)] as const,
            () => [name, [] as string[]] as const,
          ),
      ),
    ).then((entries) => {
      if (!cancelled) setUsed(Object.fromEntries(entries.filter(([, codes]) => codes.length > 0)))
    })
    return () => {
      cancelled = true
    }
  }, [canAsk, dataSource, objectName, fieldsKey])

  return used
}
