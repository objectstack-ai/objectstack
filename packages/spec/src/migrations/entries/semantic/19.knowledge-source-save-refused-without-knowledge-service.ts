// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of the save refusal for a `knowledge_source` on a
// deployment that registers no knowledge service (ADR-0161 K4, ADR-0078 §1).
// Notice only: the schema is unchanged, no key is removed and no D2 conversion
// exists, because the fix is the deployment's composition, never the item.
export const entry: SemanticMigration = {
  id: 'knowledge-source-save-refused-without-knowledge-service',
  surface:
    'A `knowledge_source` saved by an author (Studio and REST `PUT /meta/knowledge_source/:name`, the runtime '
    + 'dispatcher\'s `/meta` save, the MCP `save_metadata_draft` tool, and a package duplicate that copies one) on a '
    + 'deployment whose stack neither declares `requires: [\'knowledge\']` nor ships a `knowledgeSources` entry, and '
    + 'whose host mounts no `KnowledgeServicePlugin`',
  replacement:
    'Add `requires: [\'knowledge\']` to the stack (or, on a host that composes its own kernel, '
    + '`KnowledgeServicePlugin` from `@objectstack/service-knowledge` and a knowledge store), restart the server, '
    + 'then save the source',
  reason:
    'On a deployment with no knowledge service nothing loads, indexes or searches a knowledge source, and nothing '
    + 'mounts the service while the server runs: it is composed at boot. Such a save used to be accepted and was '
    + 'never served, and only a boot log line said so, which a Studio, REST or MCP author does not see. It is now '
    + 'refused at the save, 503 SERVICE_UNAVAILABLE, naming the reason and the fix; nothing is written. The '
    + 'engine\'s own writes (a package install, a seed, a migration) are not refused, a knowledge service a host '
    + 'registers itself answers for its own sources as before, and stored items are not rewritten or refused at boot.',
  acceptanceCriteria:
    'On a deployment that should serve knowledge sources, the stack declares requires: [\'knowledge\'] or ships a '
    + 'knowledgeSources entry (either mounts the service; or the host mounts KnowledgeServicePlugin), and the boot '
    + 'logs no line naming knowledge_source items with no knowledge service registered; a source saved there is '
    + 'accepted as before. On a deployment that should not, no author saves a knowledge_source, and one a package '
    + 'brings is reported once at boot with the same fix.',
};
