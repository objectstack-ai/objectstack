// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// Registered as D3 SEMANTIC only: there is no D2 conversion because no stack
// source can carry `ragPipelines` — `ObjectStackDefinitionSchema` never declared
// the key, so a stack that wrote it was already refused at parse before this
// retirement. What changes for an upgrader is the `/meta` door, which used to
// accept the type through the URL-spelling contract's manifest limb.
export const entry: SemanticMigration = {
  id: 'meta-type-rag-pipeline-retired',
  surface:
    'the `rag_pipeline` metadata type (`ragPipelines` in `PLURAL_TO_SINGULAR` and the engine, '
    + 'metadata-plugin and runtime collection lists; `/meta/rag_pipeline`)',
  replacement:
    'nothing replaces it: a RAG pipeline was never a declarable metadata collection. Delete any '
    + '`ragPipelines` key from a stack source or artifact, and stop addressing `/meta/rag_pipeline`. '
    + 'Retrieval sources are described by the knowledge-source schemas (`@objectstack/spec/ai`) '
    + 'and indexed by the knowledge service the deployment installs, not by a stack collection.',
  reason:
    'ADR-0049 enforce-or-remove. Four registries listed `ragPipelines` as a metadata collection '
    + '(spec `PLURAL_TO_SINGULAR`, the engine\'s registered-collection list, the metadata plugin\'s '
    + 'artifact map, and the runtime\'s app-payload probe), yet the stack schema never declared the '
    + 'key, so `defineStack` refused it, and no producer wrote a `rag_pipeline` item. The only '
    + 'readers were the platform\'s generic doors: the URL-spelling contract (derived from the '
    + 'spelling row), which let `PUT /meta/rag_pipeline/:name` store any JSON with no schema, and '
    + 'the `/meta/types` listing that advertised the type as creatable. A declared collection no '
    + 'author can reach misleads every reader of those registries into believing the platform has '
    + 'a RAG-pipeline metadata kind.',
  acceptanceCriteria:
    'No stack source or artifact carries `ragPipelines` (the stack schema refuses it as an '
    + 'unrecognized key, as it always did). `PUT /meta/rag_pipeline/:name` gets the '
    + 'unrecognised-type refusal (a `/meta` type name the platform does not have is refused, never '
    + 'minted as a namespace) instead of the store-anything branch, and `GET /meta/types` no longer '
    + 'lists `rag_pipeline` as creatable. `scripts/check-stack-collection-maps.mjs` holds every '
    + 'collection map to the stack schema with no waiver for the key, and a stack that writes '
    + '`ragPipelines` is refused with a prescription. Legacy stored `rag_pipeline` rows, if a '
    + 'deployment wrote any through the old door, are not rewritten: `/meta` reads still answer and '
    + 'DELETE still works, so the residue is removable; a new write is refused, and a package export '
    + 'no longer carries the rows (it builds its collections from `PLURAL_TO_SINGULAR`), so delete '
    + 'them rather than rely on an export.',
};
