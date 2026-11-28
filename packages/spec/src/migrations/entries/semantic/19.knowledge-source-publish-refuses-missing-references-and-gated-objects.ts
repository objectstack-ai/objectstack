// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0161 K4 (row 4) — the D3 entry of the author-time rule that judges a
// `knowledge_source` against the objects it names, at publish and in
// `os validate` / `build` / `lint`. Notice only: no key is removed and no D2
// conversion exists, because each fix is a choice only the author can make
// (which object or field the source meant, whether to serve the object for
// search or opt a system object into AI reads, or which object to index).
export const entry: SemanticMigration = {
  id: 'knowledge-source-publish-refuses-missing-references-and-gated-objects',
  surface:
    'Four author-time errors on a knowledge source (`knowledgeSources`, the `knowledge_source` type), run by the '
    + 'runtime publish gate and by `os validate` / `lint` / `compile` / `build`: `source.object` names an object that '
    + 'does not exist (`knowledge-source-object-unknown`; on the CLI a warning for a platform-prefixed name no known '
    + 'package registers, and while the manifest declares a dependency the artifact does not carry); a '
    + '`source.content` or `source.metadataFields` member names no field of the object, declared or '
    + 'injected (`knowledge-source-field-unknown`); the object\'s API exposure does not serve `search` '
    + '(`knowledge-source-object-not-searchable`); the object is a system object without `enable.aiReadable: true` '
    + '(`knowledge-source-system-object-not-ai-readable`). And one warning: a member names a credential-class or '
    + '`internal` field, which the index never carries (`knowledge-source-field-never-indexed`)',
  replacement:
    'Point `source.object` at an object the stack, its artifact or the host defines; an object a dependency defines '
    + 'clears at publish once the package\'s manifest declares that dependency in `dependencies` (on the CLI it stays '
    + 'a warning while the artifact does not carry the dependency). Name fields the object defines, or `id` and the '
    + 'injected system columns, in `content` and `metadataFields`. Serve the object for `search`: keep '
    + '`enable.apiEnabled` true and, where it declares `enable.apiMethods`, include `list` with `enable.searchable` '
    + 'not false (`search` is a retired list value the parse strips); or index another object. Index a business '
    + 'object, or a system object whose definition declares `enable.aiReadable: true`',
  reason:
    'Each one parses and publishes, then fails at search: an object nothing defines leaves nothing to index, a field '
    + 'it does not define indexes no text for that member on any record, and the knowledge service never searches a '
    + 'source whose object the API does not serve for search or a system object that does not opt into AI reads, for '
    + 'any caller it judges. The save door already '
    + 'refused the last two for an author it judges; a publish no author judgement reaches (where no knowledge '
    + 'service is mounted) is now refused too, and so is a missing object or field. Stored metadata is '
    + 'not rewritten or refused at boot. The next publish of a source that carries one of these is refused with the '
    + 'fix named.',
  acceptanceCriteria:
    'os validate reports none of the four errors; a publish of every knowledge source the package carries succeeds.',
  // The surface is the `knowledgeSources` collection alone (a source registered
  // in code is not judged by this rule), so a stack that declares none is proven
  // clear of it. The sibling knowledge-source entries also name code
  // registrations or host calls, which no stack key can prove absent.
  relevantWhen: { kind: 'stack-declares', keys: ['knowledgeSources'] },
};
