/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The fields an update action would require, named before it is pressed
 * (objectstack#28382).
 *
 * A declarative update action — `operation: 'update'` with a static `patch`
 * (`@objectstack/spec` `ActionSchema.patch`) — writes its patch to the current
 * record on the data plane, so the object's `requiredWhen` rules run over the
 * record AS THE ACTION LEAVES IT. The edit form evaluates them over the record
 * as it stands, so a field that only the action makes required (the showcase
 * invoice's "Issued On" under "Submit for Sign-off" → `status: 'sent'`) drew
 * no mark, and the first press was always refused.
 *
 * The form renderer reads the object's declared actions here, once per object,
 * through the data source it already has (the same read the form hosts make,
 * served from the adapter's schema cache), and keeps the ones whose writes are
 * all in `patch`: no `params` (a dialog value is not known before the press),
 * and a placement (`locations`) so the action is one a person can see. The
 * renderer then evaluates each field's `requiredWhen` over
 * `{ ...record, ...patch }`.
 *
 * It is a heads-up only. Nothing here blocks a save, and the server's refusal
 * stays the source of truth for the action itself.
 */

import * as React from "react"
import type { DataSource } from "@object-ui/types"

/** One declarative update action, reduced to what the mark needs. */
export interface PatchingUpdateAction {
  /** The action's machine name — its identity for de-duplication. */
  name: string
  /** What the mark calls it: the declared label, or the name when none. */
  label: string
  /** The static field values the action writes. */
  patch: Record<string, unknown>
  /** The declared `visible` predicate, if any (evaluated by the form). */
  visible?: unknown
  /** The declared capability gate, if any (checked by the form). */
  requiredPermissions?: unknown
  /** The action as declared, for `isActionSwitchedOff`. */
  source: object
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

/**
 * The declared actions whose whole write is a static `patch`.
 *
 * Kept: `operation: 'update'`, a non-empty `patch` object, no `params` (or an
 * empty list), and at least one declared location. Everything else is left
 * out, because what it writes cannot be known before it runs: an action that
 * collects `params` writes the dialog's values over the patch, and any other
 * action type writes through a body this side does not see. A locationless
 * action is placed nowhere (`actionRendersAt`), so nobody can press it.
 */
export function patchingUpdateActions(actions: unknown): PatchingUpdateAction[] {
  if (!Array.isArray(actions)) return []
  const out: PatchingUpdateAction[] = []
  const seen = new Set<string>()
  for (const action of actions) {
    if (!isPlainRecord(action)) continue
    if (action.operation !== "update") continue
    const patch = action.patch
    if (!isPlainRecord(patch) || Object.keys(patch).length === 0) continue
    if (action.params != null && !(Array.isArray(action.params) && action.params.length === 0)) continue
    if (!Array.isArray(action.locations) || action.locations.length === 0) continue
    const name = typeof action.name === "string" ? action.name : ""
    if (!name || seen.has(name)) continue
    seen.add(name)
    const label = typeof action.label === "string" && action.label.trim() ? action.label : name
    out.push({
      name,
      label,
      patch,
      visible: action.visible,
      requiredPermissions: action.requiredPermissions,
      source: action,
    })
  }
  return out
}

const NONE: PatchingUpdateAction[] = []

/**
 * The object's declarative update actions, read once per object while
 * `enabled` (an EDIT form: on an insert there is no record for an action to
 * run on). A data source without `getObjectSchema`, or a failed read, yields
 * none, and the form draws no mark.
 */
export function usePatchingUpdateActions(
  dataSource: DataSource | null | undefined,
  objectName: string | undefined,
  enabled: boolean,
): PatchingUpdateAction[] {
  const [actions, setActions] = React.useState<PatchingUpdateAction[]>(NONE)
  const canAsk = enabled && !!objectName && typeof dataSource?.getObjectSchema === "function"

  React.useEffect(() => {
    if (!canAsk || !dataSource || !objectName) {
      setActions(NONE)
      return
    }
    let cancelled = false
    Promise.resolve()
      .then(() => dataSource.getObjectSchema(objectName))
      .then(
        (schema) => patchingUpdateActions((schema as { actions?: unknown } | null | undefined)?.actions),
        () => NONE,
      )
      .then((found) => {
        if (!cancelled) setActions(found.length > 0 ? found : NONE)
      })
    return () => {
      cancelled = true
    }
  }, [canAsk, dataSource, objectName])

  return actions
}
