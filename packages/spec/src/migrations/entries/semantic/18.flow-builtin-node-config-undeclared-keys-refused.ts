// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21982 — the D3 entry for the build doors refusing an UNDECLARED KEY on the
// builtin node types whose undeclared keys only `registerFlow` judged until
// now: `get_record`, `create_record`, `update_record`, `delete_record`,
// `notify`, `http`, `screen`, `map`, `loop` and `parallel`. It completes the
// key half of the executor-contract arm of `flowNodeConfigRefusals` that
// `flow-script-subflow-config-undeclared-keys-refused` opened for `script` and
// `subflow`, and makes that arm the one judge of a builtin's undeclared key:
// `registerFlow`'s descriptor walk stands aside for these types. It narrows the
// build doors' accept set to what registration already refused; no key is
// removed, so there is no tombstone and no RETIRED_KEYS_BY_MAJOR row, and no D2
// conversion exists: the platform cannot know what an undeclared key was meant
// to be.
//
// No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
// inside a code span and a table cell.
export const entry: SemanticMigration = {
  id: 'flow-builtin-node-config-undeclared-keys-refused',
  surface:
    'a get_record, create_record, update_record, delete_record, notify, http, screen, map, loop or parallel '
    + 'flow node whose config carries a key its executor contract does not declare — a typo (titl), a key '
    + 'the walk at registration already named (fieldValues on a write node, bulk on update_record, visibleIf '
    + 'on a screen field), a key copied from another node type (outputVariable on an http node, flowName on a '
    + 'loop), or a key nothing reads (bogusKey) — at the config itself, or on a screen field or one of its '
    + 'options, a body-less legacy loop included. Never a key inside a free-form map (a filter, fields, '
    + 'headers, defaults, input, payload or templateData key is author data), never a key on a region object '
    + '(a loop body, a parallel branch) or on its nodes and edges (the region check at registration owns '
    + 'those), and never a '
    + 'try_catch key, which registration keeps judging against its descriptor. Reachable wherever a flow is '
    + 'authored or stored: defineStack({ flows }) sources, defineFlow(), an exported stack passed to '
    + 'objectstack validate or objectstack compile, a flow saved from the Studio flow designer, and a flow row '
    + 'already sitting in sys_metadata',
  replacement:
    'the key the contract declares, or no key: rename a typo to the declared key it meant (the refusal '
    + 'carries the contract\'s did-you-mean for a near miss), follow the contract\'s own prescription for a '
    + 'known slip (`fieldValues` → `fields`, `bulk` / `all` / `multiple` → `multi: true`, `options: { multi }` → '
    + 'a top-level `multi`, a screen field\'s `visibleIf` → `visibleWhen`, a loop\'s `itemVariable` → '
    + '`iteratorVariable`), and delete a key nothing reads (an `http` node\'s `outputVariable` among them: the '
    + 'http executor binds no output variable)',
  reason:
    'Each of these executors (`service-automation` `builtin/crud-nodes.ts`, `notify-node.ts`, '
    + '`http-nodes.ts`, `screen-nodes.ts`, `map-node.ts`, `loop-node.ts`, `parallel-node.ts`) parses the '
    + 'node\'s `config` against a strict contract before it acts. Until now the build doors\' executor-contract '
    + 'arm held key membership back on these types, on the premise that registration judges it: '
    + '`registerFlow`\'s undeclared-key walk (`validateNodeConfigKeys`) refuses such a key against the node '
    + 'type descriptor\'s `configSchema`. So a `notify` node carrying `bogusKey` passed `FlowSchema.parse`, '
    + '`objectstack validate` and `objectstack compile` (which copied it into the artifact), and then '
    + 'registration refused the whole flow: at boot it was skipped with a warn, and a flow saved from Studio '
    + 'was stored and then silently not registered. The one judge `FlowSchema.parse`, '
    + '`AutomationEngine.registerFlow` (which parses first), `objectstack validate` and the metadata save door '
    + 'share (`flowNodeConfigRefusals`) now refuses such a key on these types as `node-config-refused-by-contract`, '
    + 'anchored at the key, one refusal per key, in the contract\'s own words and closed with the '
    + 'rename-or-remove remedy, and the descriptor walk stands aside for every type that judge covers '
    + '(`builtinNodeConfigKeysJudged`), so each type has one judge. Measured before the move: on each of '
    + 'these types the descriptor\'s declared key sets, at every position the walk descends to, equal the '
    + 'keys the contract accepts there, so registration refuses exactly what it refused before. ⚠️ '
    + '`try_catch` is the one builtin not moved: its contract\'s `retry` is the shared `RetryPolicySchema`, '
    + 'which strips an unknown key, while its descriptor closes `retry` to five keys, so its undeclared keys '
    + 'stay registration\'s. ⚠️ A body-less legacy `loop` is not parsed at run time, and it is judged here on '
    + 'key membership alone, which is what registration refused there already. ⚠️ A spelling an ADR-0087 D2 '
    + 'conversion still rewrites at load (`object` and `filters` on a CRUD node, `to` / `subject` / `body` / '
    + '`url` on a `notify`, `flow` on a `map`) is converted before the judge at every door that converts '
    + 'first; met by a direct `FlowSchema.parse` or `defineFlow()` it is refused like any other undeclared '
    + 'key. ⚠️ No D2 conversion: the platform cannot know what an undeclared key was meant to be. ⚠️ Where '
    + 'such a node already sits the whole flow is refused, as registration already refused it: from the '
    + 'metadata registry or `sys_metadata` at boot it is skipped with a `warn` naming it, its trigger not '
    + 'armed, while the flows beside it register; a `defineStack({ flows })` source throws '
    + '`StackSchemaInvalidError` for the whole stack; an artifact file is refused whole at load; a save from '
    + 'Studio answers 422 naming the key. ADR-0087, ADR-0031.',
  acceptanceCriteria:
    'Run `objectstack validate` over every stack authored in config files, and boot every deployed '
    + 'stack. Each refusal names the node and the key: `FlowSchema.parse` anchors a `custom` issue at '
    + '`nodes.N.config.<key>` (`nodes.N.config.bogusKey`, `nodes.N.config.fields.0.visibleIf`, or the region '
    + 'path `nodes.N.config.body.nodes.M.config…`), `objectstack validate` prints the same path, and '
    + '`validateStackExpressions` phrases it as `node \'n\' (notify) config.bogusKey`. For each hit rename or '
    + 'delete the key per the replacement. Two proofs. (1) For a stack authored in config files, '
    + '`objectstack validate` is clean. (2) Boot the stack and confirm each flow REGISTERS: no `failed to '
    + 'register flow` warn for it — that warn line is the locator for a row that exists only in '
    + '`sys_metadata`. A node of these types whose keys its contract declares parses and registers '
    + 'byte-identically to before.',
};
