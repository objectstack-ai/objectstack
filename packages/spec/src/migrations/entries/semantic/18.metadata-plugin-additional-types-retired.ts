// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'metadata-plugin-additional-types-retired',
  surface: 'metadata plugin `config.additionalTypes` (on `MetadataPluginConfig`)',
  replacement:
    'nothing to re-declare — delete the key. There is no declared-kind channel: a kind '
    + 'enters the live metadata-type set as a side effect of registering an ITEM of that '
    + 'kind (`SchemaRegistry.registerItem` during app/manifest registration, or '
    + '`MetadataManager.register` at runtime). Bind the kind\'s schema with '
    + '`registerMetadataTypeSchema(type, schema)` from the plugin\'s `init(ctx)` so '
    + '`GET /api/v1/meta` serves a real JSON Schema for it',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-08-14 on #8586. The key was '
    + 'declared, authorable, on the published authorable surface, and documented on four '
    + 'docs pages as THE way a plugin registers a custom metadata type — and read by '
    + 'NOTHING. The only production writer of the manager\'s type registry is '
    + '`setTypeRegistry(DEFAULT_METADATA_TYPE_REGISTRY)` (`packages/metadata/src/'
    + 'plugin.ts`), called exactly once outside tests, and it REPLACES the array outright; '
    + 'nothing ever merged `additionalTypes` into it. Measured against the real '
    + '`MetadataManager`: declared count == live count (27 == 27), '
    + '`getRegisteredTypes()` sorted equals the built-in registry sorted. So an author '
    + 'who followed the published instructions wrote the key, got no error, and nothing '
    + 'happened — the same silence trap as #4212\'s `onInstall` (a documented hook with '
    + 'no invocation site), one level down, in exactly the AI-authoring path (ADR-0033). '
    + 'Joint consequence recorded with #8421: with this plugin-declared channel removed, '
    + 'the static registry is the total universe of legal metadata kinds, which makes '
    + 'refuse-by-static-registry at the /meta boundary safe by construction. '
    + 'Why D3 semantic and not a D2 conversion: the chain walks a normalized STACK and '
    + '`applyConversionsToStoredItem` maps a metadata type onto one of its collections. '
    + 'A metadata-plugin config is neither — `PLURAL_TO_SINGULAR` has no `plugins` '
    + 'entry, so it is not a stack collection member and a conversion would be a '
    + 'transform with no seam that ever runs (the `kernel/Manifest:loading` precedent).',
  acceptanceCriteria:
    'No `MetadataPluginConfig` — inline in TypeScript or embedded at the manifest\'s '
    + '`config` key — carries `additionalTypes`. TypeScript authors get the refusal at '
    + 'compile time (`additionalTypes` is typed `never`); a value reaching the parse is '
    + 'refused with the prescription (`invalid_type` at path `additionalTypes`). '
    + '⚠️ Runtime behaviour is deliberately UNCHANGED and must be verified as such: '
    + 'nothing ever read the key, so removing it removes no behaviour — the live type '
    + 'set stays exactly `DEFAULT_METADATA_TYPE_REGISTRY` plus item-population growth, '
    + 'before and after.',
};
