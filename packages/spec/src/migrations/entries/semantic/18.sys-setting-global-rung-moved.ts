// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #15207 (ADR-0131 D7, C6 item 3) — the settings cascade's global rung leaves
// the tenant-scoped sys_setting for the tenant-less sys_platform_setting, and
// the `global` option of sys_setting.scope retires with it. A platform-object
// storage move, not a spec-key retirement: SpecifierScopeSchema and the
// `source: 'global'` resolution value name the cascade rung and stay, so
// nothing lands in RETIRED_KEYS_BY_MAJOR and no D2 conversion exists to pair
// with. Existing rows move in the v18 operator ceremony (ADR-0131 D14), which
// this entry does not perform.
export const entry: SemanticMigration = {
  id: 'sys-setting-global-rung-moved',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'sys_setting.scope global — the settings cascade global rung left the tenant-scoped settings '
    + 'table: a value for a key declared at global scope is stored in the new tenant-less object '
    + 'sys_platform_setting (packages/platform-objects/src/system/sys-platform-setting.object.ts), '
    + 'and the global option of sys_setting.scope is retired',
  replacement:
    '`sys_platform_setting`, one row per `(namespace, key)` for the deployment, with the same '
    + '`value`, `value_enc`, `encrypted`, `locked`, `locked_reason` and `updated_by` columns and no '
    + '`scope`, `user_id` or `organization_id`. Write it only through the settings door '
    + '(`/api/settings/:namespace`), which routes a global-scope key there. Reading it through the '
    + 'generic data API requires the `manage_platform_settings` capability. Delete any authored '
    + 'filter, list-view column or seed that names `scope = global` on `sys_setting`',
  reason:
    'ADR-0131 D7: deployment-level runtime settings leave the tenant-scoped table, and a tenant-less '
    + 'object holds the values an operator must change without a restart. A census of every '
    + 'manifest at commit 51290bca2c of this repository\'s main branch found seven namespaces whose '
    + 'keys sit at the global rung (ai, auth, knowledge, mail, sms, storage and the ObjectQL lifecycle '
    + 'defaults), every one edited live in Setup, so none of them moves to boot configuration. The '
    + 'settings service is the only writer of a global row, it writes under a system context, and the '
    + 'row names no organization, so on sys_setting the injected organization column only ever held '
    + 'NULL there and a walled posture hid the row from every reader. The resolver reads the rung '
    + 'from the new object alone and excludes scope global from its sys_setting reads, so a row a '
    + 'pre-v18 database still holds there is not a second source; no write path produces one any '
    + 'more, which is why the select option retires rather than staying a declared value no write can '
    + 'reach. The cascade order, the lock semantics, SpecifierScopeSchema and the global resolution '
    + 'source are unchanged. An encrypted value moves without re-encryption: the ADR-0128 AAD binds '
    + 'the settings scope, namespace and key, never the holder object or an organization, so a '
    + 'sys_secret handle copied into the new row opens as it did. Existing databases: nothing moves '
    + 'automatically (ADR-0131 D14). The v18 upgrade ceremony moves each sys_setting row at scope '
    + 'global into sys_platform_setting by namespace and key, value_enc handle included; until it '
    + 'runs, those values read as their next rung or the manifest default.',
  acceptanceCriteria:
    'A write of a global-scope settings key creates or updates exactly one `sys_platform_setting` '
    + 'row for its `(namespace, key)` and no `sys_setting` row, and a read of the key answers that '
    + 'value with source `global`. A `sys_setting` row still at `scope = global` is not answered by '
    + 'any read. An encrypted global value keeps its `sys_secret` handle in '
    + '`sys_platform_setting.value_enc` and opens. On every tenancy posture a principal without '
    + '`manage_platform_settings` is refused 403 PERMISSION_DENIED on a generic data read of '
    + '`sys_platform_setting`, while the settings door keeps answering it for a holder of the '
    + 'manifest capability. After the v18 ceremony no `sys_setting` row is at `scope = global`.',
};
