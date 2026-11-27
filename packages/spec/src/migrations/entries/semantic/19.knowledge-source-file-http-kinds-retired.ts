// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0161 K1, K4 (point 1, as merged) and K6 — the D3 entry of the `file` and
// `http` source kinds. No D2 conversion: nothing read either arm, so there is
// nothing to convert one to. The family is the two arms
// (`ai/FileKnowledgeSource`, `ai/HttpKnowledgeSource`) and the union they sat
// in (`ai/KnowledgeSourceKind`), all in RETIRED_DEFS_BY_MAJOR[19], with the
// push door they were served by: `IKnowledgeService.indexDocument` and
// `deleteDocument`, a published TypeScript interface with no metadata surface,
// which ADR-0087 D7 calls compiler-carried.
export const entry: SemanticMigration = {
  id: 'knowledge-source-file-http-kinds-retired',
  surface:
    'A knowledge source whose `source.kind` is `file` or `http`, with its keys `prefix`, `mimeTypes`, `urls` '
    + 'and `userAgent`; and host code that calls `IKnowledgeService.indexDocument` or `deleteDocument`',
  replacement:
    'A source indexes the records of one object: `source: { kind: \'object\', object, content: [...] }`. Text '
    + 'that lives in files or behind URLs is searchable once it is in records: load it into an object (an '
    + 'import, a flow or a connector) and declare a source over that object. The knowledge service then '
    + 'assembles, splits and embeds each record, keeps the index in step with record changes, and re-reads '
    + 'every hit as the asking user. There is no call that hands the service a document.',
  reason:
    'The schema accepted three kinds of source and the service built an index from one. A `file` or `http` '
    + 'source registered without error and indexed nothing by itself: no loader read `prefix` or `urls`, and '
    + 'its documents existed only if host code pushed each one through `indexDocument`. Documents pushed that '
    + 'way had no record behind them, so a hit could not be re-read as the asking user, which is how every '
    + 'other answer is permission-checked. The two kinds, their four keys and the two push members are '
    + 'removed together: the parse refuses the kinds and the keys and names the fix, and a call to either '
    + 'member no longer compiles. An index that host code filled through the push door is not rebuilt by the '
    + 'platform, because the platform never knew where its documents came from. Where those documents should '
    + 'live as records, and who may read them there, is the application author\'s decision.',
  acceptanceCriteria:
    'No knowledge source has `source.kind` other than `object` or carries `prefix`, `mimeTypes`, `urls` or '
    + '`userAgent`, and no code calls `indexDocument` or `deleteDocument` on the knowledge service. For each '
    + 'retired source whose content still has to be searchable: the content is held in records of an object, a '
    + 'source over that object lists the fields to embed, a search finds it, and a user who may not read a '
    + 'record does not get it as a hit. Whatever an adapter still holds under a retired source\'s name is '
    + 'removed from its store.',
};
