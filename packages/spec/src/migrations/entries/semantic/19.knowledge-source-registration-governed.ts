// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0161 K4 (points 1 and 3) and K6 — the D3 entry of what changes for a
// knowledge source registered in code once the same shape is a governed
// metadata type. The D2 conversion `knowledge-source-id-to-name` renames the
// one key the door's identity turned on; the rest is a narrowing of what the
// door accepts and of what a second registration does, which no conversion
// over one stack can repair. The holder of a code registration and the reading
// of a name in code are ruling 7192063608 on #37304 (ADR-0150 addendum of
// 2026-11-25, points 4 and 6).
//
// One source is outside "nothing is rebuilt": one whose 18 `id` began with an
// underscore. `name` refuses the underscore (`ROUTER_ADDRESSABLE_NAME_PATTERN`),
// an adapter keys what it holds by the source's name
// (`AdapterContext.source.name`), and the service drops an index only for a
// metadata item it stops serving (`KnowledgeService.dropMetadataSource`;
// `unregisterSource` leaves the index with its adapter). So the entry says what
// the rename leaves behind and how it is dropped.
export const entry: SemanticMigration = {
  id: 'knowledge-source-registration-governed',
  surface:
    'A knowledge source registered in code: `KnowledgeServicePlugin({ sources })` and '
    + '`IKnowledgeService.registerSource(source)`; the source ids code passes to `getSource`, '
    + '`unregisterSource`, `reindexSource` and `search`\'s `sourceIds`; and the `sourceId` on the hits '
    + '`search` returns',
  replacement:
    'Write the source in the shape of the `knowledge_source` type: `name` where `id` stood, a name that '
    + 'starts with a letter, and no key the type does not declare. Prefer shipping it as metadata, in the '
    + 'stack\'s `knowledgeSources`. Give a source registered in code a name no source authored in the '
    + 'environment uses. Where a package ships a source of the same name, name the package\'s source by its '
    + 'face `NAMESPACE-NAME` and the one registered in code by its bare name. A source whose `id` began with '
    + 'an underscore takes a new name; once it has been built under that name, drop the index its adapter '
    + 'still holds under the old id: call `dropSource({ source })` on that adapter '
    + '(`IKnowledgeService.getAdapter`), where `source` is the source with its `name` set to the old id. An '
    + 'adapter without `dropSource` keeps that index until it is removed in the adapter\'s own store.',
  reason:
    'Before this release the code door stored what it was given: a key the schema did not declare was '
    + 'kept and ignored, an id could start with an underscore, and a second registration of an id replaced '
    + 'the first with a warning. The door now parses with the type\'s one schema, so each of those is '
    + 'refused when the source is registered, with the parse\'s own prescription; the D2 conversion renames '
    + '`id` in a stack, and a TypeScript registration that still writes it does not compile. A source '
    + 'registered in code belongs to no package: it is read as the environment\'s own source and keeps its '
    + 'name, its index and its documents, so nothing is rebuilt. One source is the exception: one whose `id` '
    + 'began with an underscore. Its name has to change, and an adapter keys everything it holds for a source '
    + 'by the source\'s name. So the renamed source is built from nothing, at the next boot or by '
    + '`os knowledge rebuild` where `buildAtBoot` is `false`; on an adapter that embeds, that build sends its '
    + 'content fields to the embedding provider again for every record. The adapter also keeps the index it '
    + 'built under the old id. No source '
    + 'holds that key any more: nothing searches that index or keeps it in step with the records, and nothing '
    + 'drops it, because the service drops the index of a `knowledge_source` item it stops serving and never '
    + 'that of a registration in code. A source registered in code shares one slot with a source of the same '
    + 'name authored in the environment, and whichever of the two arrives second is refused (409 '
    + 'RESOURCE_CONFLICT, naming both doors) instead of replacing the first; registering the same name again '
    + 'through the code door still replaces the earlier registration. A package may ship a source of that '
    + 'name too, and both are kept: a bare name then means the one registered in code, and the package\'s is '
    + 'named by its face. A hit\'s `sourceId` is that same spelling, so it is no longer always the bare name. '
    + 'Whether a key the door used to ignore stated something the author still wants, which of two '
    + 'same-named sources a caller meant, and when an index left under an old id may be dropped, only the '
    + 'application\'s author knows.',
  acceptanceCriteria:
    'Every source the application registers in code parses with `KnowledgeSourceSchema` and the application '
    + 'boots with no refusal from the knowledge service. No source registered in code shares its name with a '
    + 'source authored in the environment. Code that compares a hit\'s `sourceId`, or passes a source id to '
    + 'the knowledge service, uses the spelling `search_knowledge` lists for that source. A search that '
    + 'answered before the upgrade answers the same records after it, without a rebuild. For a source whose '
    + '`id` began with an underscore, it answers them once the one build under the new name is complete, and '
    + 'the adapter holds nothing under the old id.',
  conversionIds: ['knowledge-source-id-to-name'],
};
