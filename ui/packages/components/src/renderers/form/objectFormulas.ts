/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The object's `formula` fields, recomputed from the live inputs for the
 * form's field rules (objectstack#35033).
 *
 * A required field whose `visibleWhen` reads a formula is judged by the server
 * on the value a read of the written record would serve. The form judged the
 * value it last read (an edit) or nothing at all (a create), so it hid a field
 * the server then required, or refused every submit on the missing key. The
 * renderer reads the object's formula definitions here, once per object,
 * through the data source it already has (the read `usePatchingUpdateActions`
 * makes, served from the adapter's schema cache), and computes them over its
 * rule record with `@object-ui/core`'s `planObjectFormulas`, for the acting
 * user its predicate scope holds (`current_user`, bound as the server binds
 * it: `id` and `positions`).
 *
 * A `visibleWhen` that reads a formula the form cannot compute (unservable:
 * a hop, `label()`, `current_user.can()`, the acting user when the scope
 * holds none, another root but `record`, an expression not served, or a
 * formula reading one) is dropped from that field row, with one warning: the
 * field is SHOWN and keeps its static `required`, and the form does not refuse
 * the submit for it (no ADR-0137 D2 fault), so the server, which judges the
 * write, decides.
 */

import * as React from "react"
import { planObjectFormulas, type ObjectFormulaPlan } from "@object-ui/core"
import { usePredicateScope } from "@object-ui/react"
import type { DataSource } from "@object-ui/types"

const RULE_KEYS = ["visibleWhen", "requiredWhen", "readonlyWhen", "visibleOn"] as const

/** Does any field row declare a field rule a formula could feed? */
export function declaresFieldRule(fields: readonly unknown[]): boolean {
  return fields.some((f) => {
    const row = f as Record<string, unknown> | null | undefined
    return !!row && RULE_KEYS.some((key) => row[key] != null)
  })
}

/**
 * The object's formula plan, read once per object while `enabled`, for the
 * acting user of the predicate scope. A data source without
 * `getObjectSchema`, a failed read, or an object declaring no formula yields
 * `undefined`, and the form computes nothing.
 */
export function useObjectFormulaPlan(
  dataSource: DataSource | null | undefined,
  objectName: string | undefined,
  enabled: boolean,
): ObjectFormulaPlan | undefined {
  // Kept beside the source it was read from, so a change of data source or
  // object computes nothing until its own read lands.
  const [answer, setAnswer] = React.useState<{
    dataSource: DataSource | null | undefined
    objectName: string | undefined
    fields: unknown
  }>({ dataSource: undefined, objectName: undefined, fields: undefined })
  const canAsk = enabled && !!objectName && typeof dataSource?.getObjectSchema === "function"

  React.useEffect(() => {
    if (!canAsk || !dataSource || !objectName) return
    let cancelled = false
    Promise.resolve()
      .then(() => dataSource.getObjectSchema(objectName))
      .then(
        (schema) => (schema as { fields?: unknown } | null | undefined)?.fields,
        () => undefined,
      )
      .then((fields) => {
        if (!cancelled) setAnswer({ dataSource, objectName, fields })
      })
    return () => {
      cancelled = true
    }
  }, [canAsk, dataSource, objectName])

  // The acting user as a key: re-planned when its id or positions change, not
  // on every new scope object.
  const user = usePredicateScope()?.current_user as { id?: unknown; positions?: unknown } | null | undefined
  const userKey = JSON.stringify([user?.id ?? null, user?.positions ?? null])
  const current = canAsk && answer.dataSource === dataSource && answer.objectName === objectName
  return React.useMemo(() => {
    if (!current) return undefined
    const [id, positions] = JSON.parse(userKey) as [unknown, unknown]
    return planObjectFormulas(answer.fields, { current_user: { id, positions } })
  }, [current, answer.fields, userKey])
}

const warned = new Set<string>()

/**
 * `fields` with the `visibleWhen` of every field row that reads an unservable
 * formula dropped, each drop warned once. A `section-divider` row keeps its
 * slot: it carries its section's layout gate, not a field rule. Returns
 * `fields` itself when nothing is dropped.
 */
export function withoutUnservableVisibleWhen<T>(fields: readonly T[], plan: ObjectFormulaPlan | undefined): readonly T[] {
  if (!plan || plan.unservable.size === 0) return fields
  let out: T[] | undefined
  fields.forEach((f, i) => {
    const row = f as { name?: unknown; type?: unknown; visibleWhen?: unknown } | null | undefined
    if (!row || row.visibleWhen == null || row.type === "section-divider") return
    const reads = plan.unservableReadsOf(row.visibleWhen as Parameters<ObjectFormulaPlan["unservableReadsOf"]>[0])
    if (reads.length === 0) return
    out ??= fields.slice()
    const { visibleWhen: _dropped, ...rest } = row as Record<string, unknown>
    out[i] = rest as T
    const why = reads.map(([name, reason]) => `'${name}' ${reason}`).join("; ")
    const key = JSON.stringify([String(row.name), why])
    if (!warned.has(key)) {
      warned.add(key)
      console.warn(
        `[object-ui] The visibleWhen of field '${String(row.name)}' reads a formula the form cannot compute ` +
          `(${why}), so the field is shown and keeps its required flag; the server decides on save.`,
      )
    }
  })
  return out ?? fields
}
