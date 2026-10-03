// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21565 — the D3 entry for `HookSchema`'s refusal of a hook body bound to a
// stored-metadata table: the authoring half of #21520's ruling A (record
// 5965059068), whose runtime half refuses the same hook at bind. It narrows the
// hook's accept set; no key is removed, so there is no tombstone and no
// RETIRED_KEYS_BY_MAJOR row. There is no D2 conversion either: a refused hook
// carries no intent the chain could rewrite into one the runtime runs.
export const entry: SemanticMigration = {
  id: 'hook-body-stored-metadata-target-refused',
  // No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
  // inside a code span and a table cell.
  surface:
    'hook.object naming sys_metadata or sys_metadata_history, as the string or as any member of the '
    + 'list, on a hook that carries a body',
  replacement:
    'Change metadata through the metadata API (`PUT /api/v1/meta/:type/:name`, the metadata protocol), '
    + 'where it is validated and its provenance is recorded. Delete the hook, or point its `object` at '
    + 'the tables the logic really concerns. Elevation (`runAs`, a system context) does not change this.',
  reason:
    '`HookSchema` accepted a hook whose `body` targets `sys_metadata` or `sys_metadata_history`, the '
    + 'tables that hold stored metadata. The maintainer ruled (2026-10-03) that an app-authored body may '
    + 'not touch those tables: for a body, the metadata protocol is their only writer, where a change is '
    + 'validated and its provenance recorded. The runtime enforces that where a body hook becomes a '
    + 'handler, refusing such a hook at registration so that it never runs, but every authoring door '
    + 'still accepted it: the metadata save door answered 200, and the author learned otherwise only '
    + 'from a server log. The parse now refuses it too, with the runtime\'s own prescription, so '
    + '`objectstack validate`, `defineStack`, compile, an artifact\'s parse and the metadata save door '
    + '(a 422) each name the target at `object`, or at the list member. The refused set is exactly the '
    + 'runtime\'s: a hook carrying a `body`, in any form, whose `object` names a stored-metadata table, '
    + 'as the string or as any member of the list, and one such member refuses the whole hook. A hook '
    + 'with no `body` (a code `handler`, which is how the platform writes its own hooks) and the '
    + 'wildcard `\'*\'` are outside it, as they are at registration: a wildcard names no stored-metadata '
    + 'table, so it binds, and the runtime never runs its body for those tables\' events. No authored '
    + 'hook targeting either table was measured in this repository, its examples or hotcrm. There is no '
    + 'mechanical rewrite: retargeting the hook, dropping its body or deleting it each changes what the '
    + 'author wrote, and the runtime already never ran it. A stored hook row of this shape still loads, '
    + 'now with a `[metadata_spec_invalid]` warning and a `_diagnostics` badge, and is still never bound.',
  acceptanceCriteria:
    '`objectstack validate` reports no issue at a hook\'s `object` path: no hook that carries a `body` '
    + 'names `sys_metadata` or `sys_metadata_history` in its `object`, as the string or in the list. '
    + 'Every change those hooks made to metadata is made through the metadata API instead. Saving each '
    + 'formerly affected hook through the metadata API succeeds instead of answering a 422 that names '
    + '`object`, and boot logs no binding refusal naming one of those tables for a hook.',
};
