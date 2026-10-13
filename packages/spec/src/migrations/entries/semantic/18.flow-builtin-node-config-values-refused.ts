// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21898 — the D3 entry for the build doors refusing a VALUE a builtin flow
// node's executor contract refuses: the value half of the executor-contract arm
// of `flowNodeConfigRefusals` (`flow-node-config-refusals.ts`), beside the
// presence half (`flow-node-config-required-keys-refused`) and the approval
// contract judged whole (`flow-approval-node-config-contract-refused`). It
// narrows a flow's accept set; no key is removed, so there is no tombstone and
// no RETIRED_KEYS_BY_MAJOR row. There is no D2 conversion either: the platform
// cannot know the value the author meant, and the runtime never ran such a node.
//
// No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
// inside a code span and a table cell.
export const entry: SemanticMigration = {
  id: 'flow-builtin-node-config-values-refused',
  surface:
    'a builtin flow node (get_record, create_record, update_record, delete_record, notify, http, screen, '
    + 'script, subflow, map, loop, parallel, try_catch) whose config carries a value its executor '
    + 'contract refuses — a value of the wrong type (create_record outputVariable 42, a screen field min '
    + 'written as the string 1, get_record limit as a string, update_record multi as a string), a value '
    + 'outside the declared set or range (notify severity loud, screen mode view, loop maxIterations 0, '
    + 'try_catch retry.maxRetries above 10), an empty script function or subflow flowName, or a rule '
    + 'finding on present keys (a notify template beside an inline title). A value carrying a token in '
    + 'braces is judged like any other (get_record limit written as a token, refused as the wrong type), '
    + 'and at a key its executor reads as written (a notify sourceObject, actorId or payload; an http '
    + 'method, durable, timeoutMs or whole headers map) the refusal is the literal\'s own. Never a value or '
    + 'text slot whose own judge refuses its token, an undeclared or retired key, a region slot, or an '
    + 'http signingSecret. '
    + 'Reachable wherever a flow is authored or stored: defineStack({ flows }) sources, defineFlow(), an '
    + 'exported stack passed to objectstack validate or objectstack compile, a flow saved from the Studio '
    + 'flow designer, and a flow row already sitting in sys_metadata',
  replacement:
    'the value the contract declares, written at the key the refusal names: a string where it wants a '
    + 'string (`outputVariable: \'taskId\'`), a number where it wants a number (`min: 1`, `limit: 10`, '
    + '`maxIterations: 5`, `timeoutMs: 5000`), a boolean where it wants a boolean (`multi: true`, '
    + '`durable: true`), one of the declared values (`severity: \'warning\'`, `mode: \'edit\'`), or a value '
    + 'inside the declared range. A number or boolean slot takes a LITERAL only: every builtin executor '
    + 'parses the config as authored, so a `{token}` template there (`limit: \'{page.size}\'`, '
    + '`maxIterations: \'{cap}\'`) is refused at the build doors as the wrong type, as every run refused '
    + 'it — and at an `http` node\'s `durable` and `timeoutMs`, which `http` once interpolated before it '
    + 'parsed, so a sole-token template there resolved to the declared type, with the literal\'s remedy '
    + '(`timeoutMs: 5000`, `durable: true`). For a rule '
    + 'finding, follow the rule\'s own sentence (keep `template` or the inline `title` / `message`, not both)',
  reason:
    'Every builtin executor (`service-automation` `builtin/`) parses its node\'s `config` against the '
    + 'contract `getBuiltinNodeConfigContracts()` names before it acts, and refuses the node on any '
    + 'finding. The build doors judged only the keys that contract requires, left out, so a present value '
    + 'it refuses — `create_record` `outputVariable: 42`, a screen field `min: \'1\'` (the shape the Studio '
    + 'designer used to store for a field\'s Min / Max) — passed `FlowSchema.parse`, `objectstack '
    + 'validate` and `objectstack compile`, registered, and then failed every run that reached the node: '
    + 'the config is metadata, and no rerun could succeed. The one judge `FlowSchema.parse`, '
    + '`AutomationEngine.registerFlow` (which parses first) and `objectstack validate` share '
    + '(`flowNodeConfigRefusals`) now refuses such a value as `node-config-refused-by-contract`, anchored '
    + 'at the key, in the contract\'s own words — the code the approval contract already uses. It judges '
    + 'only what the build can know the run will parse — a value carrying a `{token}` included: every '
    + 'builtin parses its config as authored, so the run\'s contract sees the token the build\'s sees, and '
    + 'a token in a number or boolean slot is refused as the wrong type (`get_record` `limit: \'{x}\'`). At '
    + 'a key its executor reads as written (a notify node\'s `sourceObject`, `actorId` and `payload`, an '
    + '`http` node\'s `method`, `durable`, `timeoutMs` and whole `headers` map) the contract refuses the '
    + 'token itself, and the build doors report that refusal, once, in the literal\'s words. A value or '
    + 'text slot whose own judge refuses its token is that judge\'s, which `registerFlow` and `objectstack '
    + 'validate` call. `http` once parsed after interpolating its whole config, so only '
    + 'token-free values were judged there; its executor interpolates nothing now. Its `signingSecret` is '
    + 'never judged, since the credential channel may supply it; a '
    + '`loop` with no `body` is not parsed by its executor and is judged for nothing; the region slots of '
    + '`loop`, `parallel` and `try_catch` are judged as graphs of their own and by `validateControlFlow`. '
    + 'An undeclared or retired key, a `predicate` ledger slot (a screen field `visibleWhen`) and a `value` '
    + 'ledger slot (a CRUD `fields` value) keep the judges they had. ⚠️ No D2 conversion: the platform '
    + 'cannot know the value the author meant. ⚠️ Where such a node already sits the whole flow is '
    + 'refused: registered from the metadata registry or `sys_metadata` at boot it is skipped with a '
    + '`warn` naming it, its trigger not armed, while the flows beside it register; a '
    + '`defineStack({ flows })` source throws `StackSchemaInvalidError` for the whole stack; an artifact '
    + 'file is refused whole at load. ADR-0087, ADR-0031.',
  acceptanceCriteria:
    'Run `objectstack validate` over every stack authored in config files, and boot every deployed '
    + 'stack. Each refusal names the node and the key: `FlowSchema.parse` anchors a `custom` issue at '
    + '`nodes.N.config.<key>` (`nodes.N.config.outputVariable`, `nodes.N.config.fields.0.min`, or the '
    + 'region path `nodes.N.config.body.nodes.M.config…`), `objectstack validate` prints the same path, '
    + 'and `validateStackExpressions` phrases it as `node \'mk\' (create_record) config.outputVariable`. '
    + 'For each hit write the value the contract declares, per the replacement. Two proofs. (1) For a '
    + 'stack authored in config files, `objectstack validate` is clean. (2) Boot the stack and confirm '
    + 'each flow REGISTERS: no `failed to register flow` warn for it — that warn line is the locator for '
    + 'a row that exists only in `sys_metadata`. A node whose values its contract accepts parses and '
    + 'registers byte-identically to before. A `{token}` template at a plain string key (an '
    + '`outputVariable`, a `flowName`) parses and registers as before; in a number or boolean slot, or '
    + 'one with a declared set, it is refused at the key like any wrong-typed literal — at a key read as '
    + 'written (a notify or http literal, above), with the literal\'s remedy — where it used to register '
    + 'and fail at its first run, so write a literal there.',
};
