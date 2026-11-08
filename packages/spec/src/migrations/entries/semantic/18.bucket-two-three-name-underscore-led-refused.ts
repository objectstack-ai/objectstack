// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'bucket-two-three-name-underscore-led-refused',
  surface: 'the `name` of a tool, skill, agent, flow, hook, connector, sharing rule, job, '
    + 'analytics cube or api endpoint (`ToolSchema`, `SkillSchema`, `AgentSchema`, '
    + '`FlowSchema`, `HookSchema`, `ConnectorSchema` and `DeclarativeConnectorEntrySchema`, '
    + '`SharingRuleSchema`, `JobSchema`, `CubeSchema`, `ApiEndpointSchema`) — a value that '
    + 'starts with `_`',
  replacement: 'the same name without the leading underscores, starting with a lowercase '
    + 'letter: `_send_welcome` becomes `send_welcome`. The grammar is now '
    + '`/^[a-z][a-z0-9_]*$/` (`ROUTER_ADDRESSABLE_NAME_PATTERN`, `kernel/address-grammar.ts`), '
    + 'the one every other bucket 2/3 type already spelled with `SnakeCaseIdentifierSchema`. '
    + 'Rename the item and every reference to it in the same change; a letter-led name, '
    + 'namespace-prefixed or not, is unchanged.',
  reason:
    'ADR-0150 D5 (accepted by merge, #31586): a by-name door reads a `_`-led segment as the '
    + 'router\'s own — `_env` addresses an environment item, and `_status`, `_activation` '
    + 'and `_drafts` are literals the router reads before any namespace. A namespace can '
    + 'never start with `_` (`^[a-z][a-z0-9_]{1,19}$`), but these ten name schemas admitted '
    + 'a leading `_` (`^[a-z_][a-z0-9_]*$`), so an item could be named like a router segment '
    + 'and become unreachable, or shadow one, on the qualified address. The refusal is '
    + 'raised at `defineStack`, `os validate` and the save door, and its message names the '
    + 'reserved prefix. It binds every row of those types, an environment-authored one '
    + 'included. This is the one narrowing ADR-0150 child P declares (the D7 table row P); '
    + 'it ships at once, with no deprecation window, as every refusal under the 2026-08-27 '
    + 'maintainer ruling 「短期不考虑渐进」 does.',
  acceptanceCriteria:
    'A stack or a saved item of one of the ten types whose `name` starts with `_` is refused, '
    + 'with an issue at its `name` that says a leading `_` is reserved for the router\'s own '
    + 'address segments (ADR-0150 D5). Every letter-led name parses byte-identically to '
    + 'before. Measured before the change: no first-party item of the ten types is `_`-led '
    + '— the 33 `name: \'_…\'` literals in this repo outside changelogs are a flow variable '
    + '(`_selectedIds`), field and section keys, engine stubs and negative test fixtures '
    + '— and none in HotCRM. The save door\'s item-name grammar '
    + '(`METADATA_ITEM_NAME_PATTERN`) already refused a `_`-led name in the URL, so only a row '
    + 'saved before that grammar landed, or an item a package boots from its stack, can '
    + 'still carry one; the stack is refused at its next build.',
};
