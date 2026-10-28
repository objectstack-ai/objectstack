// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The last two declarations of a read's projection that admitted an empty
// list. No D2 conversion: the only mechanical rewrite of `fields: []` is to
// drop the key, which reads every column, the widening the rule refuses.
export const entry: SemanticMigration = {
  id: 'query-and-get-record-empty-projection-refused',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span already, and a nested backtick would close it.
  surface:
    'QuerySchema.fields (the QueryAST projection, and so every nested expand entry, including '
    + 'EngineQueryOptionsSchema.expand and the canonical fields of a POST /data/:object/query body) and '
    + 'a flow get_record node\'s config.fields (GetRecordConfigSchema), authored as an EMPTY list or a '
    + 'list with a blank or whitespace-only name',
  replacement:
    'name the fields to read (`fields: [\'title\', \'status\']`), or omit `fields` to read every '
    + 'field. On an `expand` entry the same holds for the related record: name its fields, or omit '
    + '`fields` on that entry. ⛔ There is no replacement that can be derived from what was written: '
    + 'an empty list names no field, and reading it as every field is exactly the widening the rule '
    + 'refuses, so the platform must not pick for the author.',
  reason:
    'One rule for every published declaration of a read\'s projection: a projection names at least '
    + 'one field, none blank, and an empty one is refused rather than read as every column. The REST '
    + 'doors, the transport spellings (select, $select) and the engine-side declarations '
    + '(EngineQueryOptionsSchema.fields and its RPC and legacy siblings) already refused it, and the '
    + 'in-process engine refuses it at its find / findOne entry, top level and at any expand depth. Two '
    + 'declarations still admitted it: the QueryAST\'s own fields, which is the value type of every '
    + 'expand entry, and the get_record node\'s fields, which the executor hands to the engine as '
    + 'written. So a get_record node with fields: [] saved clean and failed at its first run with the '
    + 'engine\'s refusal, and an expand entry with fields: [] validated against the declaration the '
    + 'engine then refused. Both now take the same array arm, with the same sentence ("Name at least '
    + 'one field"; "A field name cannot be blank" for a blank member). A side effect at the REST door: '
    + 'a POST /data/:object/query body whose canonical fields is empty is now refused by the body '
    + 'schema (400 VALIDATION_FAILED at query.fields), the answer its $select alias already got, '
    + 'instead of by the normalizer (400 VALIDATION_ERROR). Either way it was refused; only the code '
    + 'moves. Stored flows are not rewritten and there is no D2 conversion: the only mechanical '
    + 'rewrite is dropping the key, which reads every column. ADR-0049 / ADR-0087.',
  acceptanceCriteria:
    'Search flow definitions (metadata files and stored sys_metadata flow rows) for a get_record node '
    + 'whose config.fields is an empty list or carries a blank name, and every query you build in code '
    + '(engine.find / findOne options, an expand entry at any depth, a POST /data/:object/query body) '
    + 'for the same. Name the fields, or remove the key. The sweep is mechanical for authored '
    + 'metadata: os validate and defineStack refuse such a node at flows.N.nodes.M.config.fields '
    + '(STACK_SCHEMA_INVALID), registerFlow refuses it when the flow is registered, and '
    + 'QuerySchema.safeParse / GetRecordConfigSchema.safeParse answer one issue at the fields path '
    + '(or fields.N for a blank member) reading "Name at least one field". An absent fields and a '
    + 'non-empty list parse unchanged. The repository carried no authored empty projection on either '
    + 'shape at the time of the change, outside the one test that pinned the old run-time failure.',
};
