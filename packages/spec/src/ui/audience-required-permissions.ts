// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The audience gate of a list view and of a dashboard, declared once: the ONE
 * describe of `ListViewSchema.requiredPermissions` and
 * `DashboardSchema.requiredPermissions` (#22611, ruling of record 6095014058,
 * letter A).
 *
 * The ruling, verbatim: "`ListViewSchema` and `DashboardSchema` each gain
 * `requiredPermissions` with the same shape and semantics as the app,
 * navigation-item, action (ADR-0066 D4) and record-block (#18159) keys: a list
 * of capabilities, all required." So the shape is the one those four carry —
 * `z.array(z.string()).optional()`, no default (an unauthored key never
 * materializes) — and the two keys share this text word for word;
 * `audience-required-permissions.test.ts` holds both declarations identical to
 * each other and shape-identical to `AppSchema.requiredPermissions`.
 *
 * Three clauses, each load-bearing:
 *
 * 1. ALL OF THEM. Several names are AND-ed, as on the app and the navigation
 *    item (`filterAppForUserWithReason`, `every`). Absent or empty is no gate.
 * 2. NO ANY-OF FORM. The ruling did not take an `anyOf` shape (its letter B):
 *    "or" is one capability the application declares and grants to each
 *    audience's permission set, the way a capability is already composed for
 *    every other carrier of this key. Saying so here is what keeps an author
 *    from reaching for a disjunction the schema refuses.
 * 3. NOT ENFORCED YET — and the text says so, because declared is enforced.
 *    This is the spec half; the `/meta` read gate that serves a gated item
 *    only to a holder is the rest half (#22639, `Blocked-by: #22611`). Until
 *    it lands no server reads either key, the liveness rows are `planned` with
 *    `authorWarn` (`liveness/view.json` `list.requiredPermissions`,
 *    `liveness/dashboard.json` `requiredPermissions`), and this sentence is
 *    the one channel that reaches every door — the lint's warning reaches a
 *    container's `list` and a dashboard, never a named `listViews` entry. The
 *    change that enforces the gate deletes the clause in the same edit that
 *    flips both rows to `live`.
 *
 * A module of its own, and outside the `ui` barrel, so the two carriers share
 * one declaration without it becoming published API (the `./view-history.ts`
 * and `./list-view-export-options.ts` precedent). Nothing here names a
 * tracker number an author would read: the describe is runtime text.
 */
export const AUDIENCE_REQUIRED_PERMISSIONS_DESCRIPTION =
  '[ADR-0066] Capabilities a user must ALL hold for this list view or dashboard to be served to them — names that '
  + 'permission sets grant through `systemPermissions`, the same list as `requiredPermissions` on an app, a navigation '
  + 'item or an action. Absent or empty: no audience gate. There is no any-of form: to serve one item to several '
  + 'audiences (legal OR admin), declare one capability and grant it to each of their permission sets. '
  + '[PLANNED — not enforced yet] No server reads this key today, so the item is still served to every user who can '
  + 'read it; do not rely on it to keep a view or a dashboard from an audience until the `/meta` read gate applies it.';
