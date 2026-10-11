// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #22573 (ruling A on #22505, as amended) — a platform-object COLUMN
// retirement, not a spec-key retirement: no authorable spec key moves, so
// nothing lands in RETIRED_KEYS_BY_MAJOR and no D2 conversion exists to pair
// with (the ups-delegated-from-column-retired shape). The data door's own
// refusal of an undeclared field is the enforced channel; this entry carries
// the prescription. By the maintainer's word there is no data migration.
export const entry: SemanticMigration = {
  id: 'sys-comment-reactions-column-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'sys_comment.reactions — the JSON textarea column that held every emoji reaction to a comment '
    + 'as one map of emoji to user ids, on the comment row itself, left the platform comment table '
    + 'declared by plugin-audit (packages/plugins/plugin-audit/src/objects/sys-comment.object.ts), '
    + 'together with its label in the four generated translation bundles',
  replacement:
    'a reaction is its reactor\'s own `sys_comment_reaction` record (`comment_id`, `emoji`, '
    + '`user_id`): a member reacts by creating that row and un-reacts by deleting it. Nothing takes '
    + 'the column\'s place on the comment row, neither a stored aggregate nor a block computed on '
    + 'read. A screen that showed reactions reads the `sys_comment_reaction` rows of the comments it '
    + 'shows in one request (`comment_id` `$in` their ids) and groups them by comment and emoji; a '
    + 'client that rewrote the column writes the member\'s own reaction row instead. An application '
    + 'that shows reactions grants `sys_comment_reaction` read, create and delete beside its '
    + '`sys_comment` grant',
  reason:
    'Maintainer ruling 2026-10-10: a reaction is the reactor\'s own record, the column retires, and '
    + 'reactions stored in it are not migrated; the delegated judgment on the same day: no read-only '
    + 'aggregate replaces it. The column made every reaction an update of the comment\'s row, so a '
    + 'member reacting to another member\'s comment needed a write the author-only edit rule on '
    + '`sys_comment` refuses, and two members reacting at once overwrote each other\'s whole map. '
    + 'One row per reaction settles both by construction. An aggregate column was not kept because '
    + 'no declared field type holds the grouped map (a summary roll-up is scalar), so keeping one '
    + 'current would need a privileged writer on the author\'s row; a block computed on read has no '
    + 'seam, because comments are served by the generic data door. Census of the column\'s users: in '
    + 'this repository the field declaration and its four translation labels were the only '
    + 'references; the one client that read and wrote it was the console\'s record chatter, which '
    + 'reads and writes `sys_comment_reaction` rows wherever the deployment declares that object, as '
    + 'this framework does. Existing databases: schema sync is additive, so the physical column '
    + 'stays with the values it holds, the boot drift report names it orphaned, and the boot is '
    + 'otherwise clean; the data door neither returns nor accepts it. Those stored reactions are not '
    + 'converted into records and do not reappear. The operator drops the column with os migrate '
    + 'apply --allow-destructive, the remedy the drift report names.',
  acceptanceCriteria:
    'No client write and no authored seed row, filter or list-view column names `reactions` on '
    + '`sys_comment`: the data door answers a create or an update that carries it, and a list filter '
    + 'on it, with 400 INVALID_FIELD naming the field, and a read of a comment no longer returns it. '
    + 'A screen that shows reactions reads `sys_comment_reaction` rows, and its users hold read, '
    + 'create and delete on that object. After os migrate apply --allow-destructive, run with the '
    + 'audit plugin composed (an auth secret resolves), the boot no longer reports the orphaned '
    + 'column.',
};
