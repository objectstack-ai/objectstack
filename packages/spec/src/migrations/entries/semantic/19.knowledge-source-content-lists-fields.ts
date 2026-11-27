// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0161 K5 and K6 — the D3 entry of the `contentFields` → `content` rename.
// The rename is lossless for a list of field names and the D2 conversion
// `knowledge-source-content-fields-to-content` does it. The `'*'` member is the
// part no conversion can do: it has no mapping, because which fields leave the
// deployment for the embedding provider is the author's decision.
export const entry: SemanticMigration = {
  id: 'knowledge-source-content-lists-fields',
  surface:
    'A knowledge source\'s `source.contentFields`, and the `\'*\'` member that list accepted: in a '
    + '`knowledgeSources` entry and in a source registered in code (`KnowledgeServicePlugin({ sources })`, '
    + '`IKnowledgeService.registerSource`)',
  replacement:
    '`source.content`: a non-empty list of field names of the object the source indexes. Where the list held '
    + '`\'*\'`, write the names of the fields whose text should be searchable. A field with `secret: true`, a '
    + 'credential-class field and an `internal` field are never embedded, named or not.',
  reason:
    'The D2 conversion renames the key and moves a list of field names unchanged, so no document and no index '
    + 'changes. `\'*\'` asked the service to embed every non-system field of the object, the ones added after '
    + 'the source was written included. Each field in `content` is sent, for every record the source selects, '
    + 'to the embedding provider the deployment configures, so the list is a statement of what leaves the '
    + 'deployment, and a wildcard states nothing. The parse now refuses the member and names the fix; '
    + 'it refuses an empty-string member too, which named no field and indexed nothing: remove it. '
    + 'the chain replay renames the key, keeps the member and reports the site as a hand edit. '
    + 'Which fields to list is known only to the source\'s author: the ones users search by, and none that '
    + 'should not be sent to the provider.',
  acceptanceCriteria:
    'No knowledge source writes `contentFields`, and none lists `\'*\'` in `content`; the parse refuses both. For '
    + 'each source that used `\'*\'`, the fields now listed are the ones its searches should match, a search '
    + 'that found a record through a field left off the list is known and accepted, and a reindex has run: the '
    + 'changed list is a changed content recipe, which the service rebuilds inside the index generation at the '
    + 'next boot or source reload.',
  conversionIds: ['knowledge-source-content-fields-to-content'],
};
