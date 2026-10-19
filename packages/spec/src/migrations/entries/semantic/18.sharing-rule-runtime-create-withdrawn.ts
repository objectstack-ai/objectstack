// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'sharing-rule-runtime-create-withdrawn',
  surface:
    'PUT /api/v1/meta/sharing_rule/{name} (a runtime-authored `sharing_rule` metadata item, draft and '
    + 'active alike) and the `sharing_rule` entry of GET /api/v1/meta/types. FROM `200` with an '
    + 'environment-wide item stored in `sys_metadata` and served by `GET /api/v1/sharing/rules`, and '
    + '`allowRuntimeCreate: true` advertised, TO `403 NOT_CREATABLE` for a name nothing declares and '
    + '`403 NOT_OVERRIDABLE` for a declared rule\'s name, nothing stored, and `allowRuntimeCreate: false` '
    + 'advertised',
  replacement:
    'author an organization rule (POST /api/v1/sharing/rules, or Setup > Sharing Rules), or clone the '
    + 'declared one: copy it to an organization rule under a new name and switch the declared rule off '
    + '(POST /api/v1/security/_activation/sharing_rule/{name}, body {enabled: false}). A package declares '
    + 'its rules in the stack\'s `sharingRules`',
  reason:
    'ADR-0131 D6 charts `sharing_rule` under regime C: a sharing rule is either a sealed declaration, '
    + 'switched through the activation ledger, or a rule an organization authors in `sys_sharing_rule`. '
    + 'The type had no metadata-type registry entry, so both `/meta` doors read its absence as '
    + '"runtime-creatable": the type listing advertised `allowRuntimeCreate: true`, and the save door '
    + 'stored the item and wrote it through to the registry, where the sharing service serves and '
    + 'enforces declared rules. That is a third source, and it bypasses what the organization door '
    + 'holds: the refusal of a row taking a declared rule\'s name, and the organization wall (the item '
    + 'belongs to the whole deployment). The type now has a code-only registry entry '
    + '(`allowRuntimeCreate: false`, `allowEnvironmentOverlay: false`), the `capability` pair, so the '
    + 'listing and the save door read one answer. No authored source spells anything that moves: a '
    + 'stack\'s `sharingRules` reaches the registry through artifact ingest, never through '
    + '`saveMetaItem`, and is valid before and after byte for byte, so there is no D2 conversion — '
    + 'the change is a runtime HTTP verdict, one semantic TODO for Studio and API callers. ADR-0131 D6, '
    + 'ADR-0126 §2, ADR-0049.',
  acceptanceCriteria:
    'No caller creates or updates a `sharing_rule` item through the runtime metadata API: '
    + '`PUT /api/v1/meta/sharing_rule/{name}` answers 403 `NOT_CREATABLE` (in `?mode=draft` too) naming '
    + 'POST /api/v1/sharing/rules, or 403 `NOT_OVERRIDABLE` over a declared rule, and stores nothing; '
    + '`GET /api/v1/meta/types` lists `sharing_rule` with `allowRuntimeCreate: false`. Verify the two '
    + 'sanctioned sources are UNAFFECTED: a stack declaring `sharingRules` still loads and its rules '
    + 'still grant, and `POST /api/v1/sharing/rules` still creates an organization rule. An item stored '
    + 'through the old door is still served until it is removed: delete it with '
    + '`DELETE /api/v1/meta/sharing_rule/{name}` (on an environment kernel with '
    + '`OS_METADATA_WRITABLE=sharing_rule` set for that one operation, which is also the operator '
    + 'escape hatch that re-opens the create), then author it again as an organization rule.',
};
