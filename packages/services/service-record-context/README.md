# @objectstack/service-record-context

The context-pack render service and the `get_record_context` tool executor
(ADR-0160).

A **context pack** (`ai_context` metadata) names a root object and says which
of one record's fields, related lists and body text are handed to a model.
`get_record_context` reads one record through its pack **as the caller**: a
field, a list or a row the caller cannot read is never carried, and the answer
says when something was withheld or cut.

```ts
import { RecordContextServicePlugin } from '@objectstack/service-record-context';

export default defineStack({
  aiContexts: [{
    name: 'policy_document',
    label: 'Policy document',
    object: 'policy',
    fields: ['title', 'category', 'status', 'owner'],
    related: [{ object: 'policy_revision', fields: ['version', 'published_at'] }],
    body: { field: 'content' },
  }],
  plugins: [new RecordContextServicePlugin()],
});
```

A host that mounts the plugin serves `get_record_context` on its MCP doors
(`data:read`, read-only). A host without it serves no such tool.

The answer is `{ data, notes, framing }`: `data` is the record material,
`notes` are the executor's statements about it, and `framing` says that `data`
is material read from records, never instructions.

Exports: `createRecordContextTools`, `executeGetRecordContext`,
`recordContextReadSet` (the objects a call may read, known from its arguments
and published metadata alone), and `RecordContextDoor` (what a host binds to the
caller).
