// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The third and last value retired from `sys_audit_log.action` in this major,
// and a separate entry from `audit-log-action-enum-retired` on purpose: two
// cards registering DIFFERENT entries merge clean, two cards editing the SAME
// entry collide in git — which is the layout `entries/README.md` chose on a
// registry where a dropped entry produces no error anywhere.
export const entry: SemanticMigration = {
  id: 'audit-log-action-restore-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    "sys_audit_log.action — the value 'restore' left the select enum declared by "
    + 'plugin-audit (packages/plugins/plugin-audit/src/objects/sys-audit-log.object.ts). '
    + 'It also left the shipped writes_only list-view filter on that object, and the '
    + 'generated option label in all four plugin-audit translation bundles',
  replacement:
    'nothing — the value is removed rather than renamed, because it never named an event '
    + 'this platform records. There is no undelete or restore capability to point at: '
    + 'deletes are hard deletes, and the record-level audit writer maps the ObjectQL '
    + 'lifecycle to `create` / `update` / `delete` only. A consumer filtering '
    + '`sys_audit_log` on this value was reading an empty result set on every deployment, '
    + 'and still is — what changed is that the contract no longer promises otherwise. If '
    + 'you were counting on a restore trail, the capability itself is the missing piece '
    + '(#1883, #3146), not this enum row',
  reason:
    'The same maintainer ruling as `audit-log-action-enum-retired`, carried to the one '
    + "value #7675's own survey did not name (#8315, triage 2026-08-13). 原则记录:空 "
    + 'widget + 永远查不到东西的过滤器是可见产品缺陷;审计面宁窄勿谎. '
    + '`restore` is the least ambiguous member of the family: the record-level writer '
    + "could not have produced it even by accident, because `actionFor()` in "
    + "audit-writers.ts is typed `'create' | 'update' | 'delete' | null` and its caller "
    + 'early-returns on null. A tree-wide search finds no other producer. '
    + 'What made it a card rather than a tidy-up is that TWO shipped declarations '
    + 'asserted the opposite, so a declaration-reading audit scored the action as '
    + 'covered: the `writes_only` list view offered it as a filter value, and the module '
    + 'docblock of auth-event-audit.ts named it among the actions the writer emits. The '
    + 'comment is the ADR-0049 declared-≠-enforced shape in its purest form (#8011) — a '
    + 'sentence next to a mechanism, contradicted by the type signature of that very '
    + 'mechanism, with nothing in CI able to tell. Both declarations are corrected in one '
    + 'change, and the invariant behind the comment (every declared action has a writer) '
    + 'now has a pin test under it rather than prose. '
    + 'Bookkeeping is identical to the sibling entry, for the same reasons: an '
    + 'enum-VALUE retirement puts nothing in RETIRED_KEYS_BY_MAJOR (no authorable KEY '
    + 'changed) and leaves the four surface ratchets byte-identical (no def changed), and '
    + 'it is a SEMANTIC entry rather than a D2 conversion because there is no source to '
    + 'rewrite — `sys_audit_log` is a platform-owned, append-only object whose every '
    + 'field is `readonly: true`, so nobody authors an audit row and nobody authors this '
    + 'enum. '
    + '⚠️ This is a statement about the WRITER, not a product stance against undelete. '
    + 'Soft delete/restore is parked, not rejected (#1883 pm:on-hold, #3146 '
    + 'status:parked). If that capability lands, this value returns WITH its writer — the '
    + 'emission point, its tests, and the view that surfaces it — never as a bare enum '
    + 'row again. '
    + '⚠️ Historical ROWS are deliberately untouched, exactly as for the sibling entry: '
    + 'the enum is not enforced on this object at all (`validateRecord` skips `readonly` '
    + 'fields), so any stored row keeps parsing and reading back, and no backfill is '
    + 'required or wanted. Deleting audit history to satisfy a schema narrowing would be '
    + 'the one genuinely destructive reading of this change. ADR-0049 / ADR-0087, #8315, '
    + '#7675, #8147.',
  acceptanceCriteria:
    'No consumer filters `sys_audit_log` on `action = "restore"` expecting rows: it was '
    + 'empty on every deployment before this change and behaves identically after it. '
    + 'Concretely, check three places. (1) Saved queries, dashboards and reports over '
    + '`sys_audit_log`: a filter naming `restore` should be deleted, not re-pointed — '
    + 'there is no action that carries the meaning, because the platform records no '
    + 'restore event. (2) Any code branching on the action string (a badge map, a label '
    + 'switch, an option list in an audit-log filter UI): the `restore` arm is '
    + 'unreachable and should go, and a `switch` with an exhaustiveness check over the '
    + 'enum type will now fail to compile if it stays — that compile error is the '
    + 'enforced channel for TypeScript consumers. An option in a FILTER dropdown is the '
    + 'user-visible half and matters most: it offers an operator a choice that returns '
    + 'nothing. (3) Custom objects or plugins inserting `sys_audit_log` rows with this '
    + 'value: the write will NOT be refused (readonly fields are not validated), so it '
    + 'silently becomes a row whose action the object no longer declares. Pick a declared '
    + 'value, or open an issue for the action you actually need. ⚠️ Do NOT migrate or '
    + 'delete existing rows: audit history is append-only and stays exactly as written.',
};
