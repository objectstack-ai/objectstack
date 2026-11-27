// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0161 K4 — a knowledge source's `adapter` names the store that holds its
// index, resolved at run time to an adapter the deployment mounts. Saved at
// run time (the `/meta` save door, Studio, the MCP draft save, a package
// duplicate), a source naming no mounted adapter is now refused at the save,
// where it used to be stored and then named only by the boot's error line and
// by the 503 its index and search answered. Semantic-only: which store the
// author meant is theirs to say, so no D2 conversion rewrites the value.
export const entry: SemanticMigration = {
  id: 'knowledge-source-unmounted-adapter-refused-at-save',
  surface:
    'knowledge_source.adapter on a source saved at run time (`PUT /meta/knowledge_source/:name`, Studio, '
    + 'the MCP `save_metadata_draft` tool, a package duplicate), when it names an adapter id the running '
    + 'deployment does not mount: a retired store such as `ragflow`, or a mistyped id',
  replacement:
    'An adapter id the deployment mounts (the refusal lists them), or no `adapter` at all, so the '
    + 'deployment\'s store holds the source; or mount the named store before saving the source.',
  reason:
    'Such a source was stored, and then every index and search of it answered SERVICE_UNAVAILABLE (503) and '
    + 'the boot logged it at error. The save now refuses it, VALIDATION_ERROR (400), naming the source, the '
    + 'adapter and the mounted adapters, and nothing is written. A source already stored is not touched: it '
    + 'keeps answering 503 until it is saved again with a mounted adapter. A package install, a source '
    + 'registered in code and objectstack validate are not judged by this check. No D2 conversion exists: '
    + 'only the author knows which store the source belongs in.',
  acceptanceCriteria:
    'The boot logs no error naming a knowledge source whose adapter is not mounted, and saving each of the '
    + 'application\'s knowledge sources in Studio answers success.',
};
