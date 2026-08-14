---
"@objectstack/platform-objects": patch
---

fix(platform-objects): remove the System Overview board's permanently-empty "Permission Changes" tile (#8148, #7675)

<!-- adr-0087: not-required (no-migration-prescription) A widget is removed from
a platform-shipped dashboard, and four hand-authored locale bundles drop the
matching `dashboards.system_overview.widgets.widget_permission_changes` subtree.
No authorable KEY changes: `DashboardWidgetSchema` is untouched, nothing is
renamed or tombstoned, and the retirement of the `sys_audit_log.action` VALUE
this tile filtered was registered by #8147 as a SEMANTIC entry
(`17.audit-log-action-enum-retired`). This change is the UI half of that already
registered retirement, so it prescribes no migration of its own. -->

The System Overview dashboard shipped a "Permission Changes" metric tile
filtering `sys_audit_log.action = 'permission_change'`. **The tile could never
report anything but `0`, on any deployment that has ever existed** — the value
had no writer anywhere in the repo. There are exactly two `sys_audit_log`
writers: `plugin-audit`'s generic hook writer, whose `actionFor` maps
afterInsert/afterUpdate/afterDelete to `create`/`update`/`delete` and nothing
else, and `plugin-auth`'s admin user-import. Neither has ever emitted
`permission_change`. #8147 then retired the value from the action enum outright,
so the tile's filter now names a value the platform does not even declare.

**An empty tile on a compliance surface is worse than a missing one.** A
permanently-`0` "Permission Changes" count does not read as "this platform does
not track permission changes" — it reads as a *negative finding*: an auditor
concludes the platform watched for permission changes over the selected window
and found none. The number was live and the query was real; the question it
answered was one no row could ever be an answer to. 审计面宁窄勿谎 — a narrow
audit surface beats a lying one.

**Removed rather than refiltered onto a live action.** Permission and role edits
*are* captured today, as ordinary `create` / `update` rows written by the generic
hook against the permission objects — so the honest lens on them is `object_name`
on the audit list view, a row-level question rather than a single-number KPI.
Approximating one as a tile would have put a second not-quite-true number on the
same board. The two surviving Row 2 tiles ("Login Events", "Config Changes")
split the 12-column row in half instead of leaving a gap where the removed tile
sat.

The by-action tile's description stops naming `permission` among its example
actions, in the source **and in all four locale bundles** — the translations are
the strings actually served, so correcting only the source would not have reached
a single user.

⚠️ **`import` is deliberately untouched.** It was named in the same ruling as
`permission_change`, but its retirement premise was falsified during #8147: it
has a live writer (`plugin-auth`'s admin user-import writes a run-level row) and
a shipped list view that filters it. Removing it from the dashboard while the
platform still emits it would produce the exact inverse defect — an audit action
that can be written but cannot be found.

Both directions are pinned. A tombstone refuses any board widget filtering a
retired action value, with a live-action control so it cannot pass on a board
that has no widgets or whose predicates moved. The app/dashboard translation
parity test gains the **reverse direction it was missing** for dashboard widgets
— it asserted every declared widget has a translation, but nothing stopped a
translation outliving its widget, which is precisely what these four locale
entries would have done.
