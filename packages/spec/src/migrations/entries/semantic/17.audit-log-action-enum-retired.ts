// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'audit-log-action-enum-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    "sys_audit_log.action — the values 'export' and 'permission_change' left the select "
    + 'enum declared by plugin-audit (packages/plugins/plugin-audit/src/objects/'
    + 'sys-audit-log.object.ts). The same two values also left the shipped list-view '
    + "filters on that object: 'permission_change' from the auth_events view and 'export' "
    + 'from the config_changes view',
  replacement:
    'nothing, for either value — both are removed rather than renamed, because neither '
    + 'named an event this platform records. For permission changes, read the ordinary '
    + '`create` / `update` rows on the permission objects themselves: a grant or binding '
    + 'write is an ordinary record write and the generic audit writer already ledgers it, '
    + 'so a second semantically-duplicate row was never minted. For `export` there is no '
    + 'replacement and nothing is lost: no export feature ever wrote an audit row. A '
    + 'consumer filtering `sys_audit_log` on either value was reading an empty result set '
    + 'on every deployment, and still is — what changed is that the contract no longer '
    + 'promises otherwise',
  reason:
    'Maintainer ruling 2026-08-12 (#7675), the retirement half of a two-half verdict: the '
    + 'cheap writers get built (#8144 login/logout, #8145 config_change) and the enum '
    + 'values with no feature behind them are retired. 原则记录:空 widget + 永远查不到东西的'
    + '过滤器是可见产品缺陷;审计面宁窄勿谎. '
    + 'The defect was false compliance on a COMPLIANCE surface, which is the sharpest form '
    + 'of ADR-0049 declared-≠-enforced: an auditor reading the action enum believed the '
    + 'platform captured permission changes and data exports, and the shipped list views '
    + 'and dashboard widgets showed them a filter and a tile for exactly those events. '
    + 'Both were permanently empty. Measured by enumerating every `sys_audit_log` writer '
    + 'in the repo — there are exactly two: plugin-audit`s generic hook writer, whose '
    + '`actionFor` maps afterInsert/Update/Delete to create/update/delete and nothing '
    + 'else, and plugin-auth`s admin user-import. Neither has ever emitted `export` or '
    + '`permission_change`. '
    + 'This is an enum-VALUE retirement, so the bookkeeping differs from a key retirement '
    + 'in the two ways `hook-body-crypto-hash-removed`, '
    + '`dataset-measure-array-string-agg-removed` and `action-global-nav-location-removed` '
    + 'already record: nothing lands in RETIRED_KEYS_BY_MAJOR (no authorable KEY changed) '
    + 'and the four surface ratchets are expected to be byte-identical (no def changed). '
    + 'It differs from all three in being a SEMANTIC entry rather than a D2 conversion, '
    + 'and the reason is that there is no source to rewrite: `sys_audit_log` is a '
    + 'platform-owned, append-only object whose every field is `readonly: true`. Nobody '
    + 'authors an audit row and nobody authors this enum — the values appear only in rows '
    + 'the runtime writes and in queries consumers send. A conversion rewrites authored '
    + 'metadata or a stored `sys_metadata` row; this surface is neither, so the '
    + 'disposition is the one `BatchOptions.validateOnly` and the notification cursor '
    + 'already take in this major. '
    + '⚠️ Historical ROWS are deliberately untouched. A deployment that somehow holds a '
    + 'row with either value keeps it, and keeps reading it back: the enum is not enforced '
    + 'on this object at all (`validateRecord` skips `readonly` fields, and every field '
    + 'here is readonly), so nothing rejects stored history and no backfill is required or '
    + 'wanted. Deleting audit history to satisfy a schema narrowing would be the one '
    + 'genuinely destructive reading of this change. ADR-0049 / ADR-0087, #8147.',
  acceptanceCriteria:
    'No consumer filters `sys_audit_log` on `action = "export"` or '
    + '`action = "permission_change"` expecting rows: both were empty everywhere before '
    + 'this change, so a query that returned data has not been identified and a query that '
    + 'returned nothing behaves identically. Concretely, check three places. (1) Saved '
    + 'queries, dashboards and reports over `sys_audit_log`: a filter naming either value '
    + 'should be deleted, not re-pointed — for permission auditing, filter the permission '
    + 'objects` own `create`/`update` rows by `object_name` instead. (2) Any code branching '
    + 'on the action string (a badge map, a label switch, an `if (row.action === ...)`): '
    + 'the arms for these two values are now unreachable and should go, and a `switch` with '
    + 'an exhaustiveness check over the enum type will now fail to compile if they stay — '
    + 'that compile error is the enforced channel for TypeScript consumers. (3) Custom '
    + 'objects or plugins inserting `sys_audit_log` rows with either value: this is the '
    + 'only case that needs a real decision, because the write will NOT be refused '
    + '(readonly fields are not validated) — it will simply be a row whose action the '
    + 'object no longer declares. Pick a declared value or open an issue for the action '
    + 'you actually need. ⚠️ Do NOT migrate or delete existing rows: audit history is '
    + 'append-only and stays exactly as written.',
};
