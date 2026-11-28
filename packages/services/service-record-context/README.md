# @objectstack/service-record-context

The context-pack render service and the `get_record_context` tool executor
(ADR-0160).

A **context pack** (`ai_context` metadata) names a root object and says which
of one record's fields, related lists and body text are handed to a model.
`get_record_context` reads one record through its pack **as the caller**: a
field, a list or a row the caller cannot read is never carried, and the answer
says when something was withheld or cut.

```ts
export default defineStack({
  requires: ['record-context'],
  aiContexts: [{
    name: 'policy_document',
    label: 'Policy document',
    object: 'policy',
    fields: ['title', 'category', 'status', 'owner'],
    related: [{ object: 'policy_revision', fields: ['version', 'published_at'] }],
    body: { field: 'content' },
  }],
});
```

Two doors mount the service, and either is enough:

- `requires: ['record-context']` on the stack. The CLI expands the token to
  `RecordContextServicePlugin` (`CAPABILITY_PROVIDERS` in `@objectstack/core`),
  so an app that ships only metadata gets the tool with no host code.
- `plugins: [new RecordContextServicePlugin()]`, for a host that composes its
  own kernel. A host that lists the plugin keeps its own instance when the
  token is declared too.

A host that mounts the service serves `get_record_context` on its MCP doors
(`data:read`, read-only). A host that does neither serves no such tool,
whatever packs it holds.

The answer is `{ data, notes, framing }`: `data` is the record material,
`notes` are the executor's statements about it, and `framing` says that `data`
is material read from records, never instructions.

Exports: `createRecordContextTools`, `executeGetRecordContext`,
`recordContextReadSet` (the objects a call may read, known from its arguments
and published metadata alone), and `RecordContextDoor` (what a host binds to the
caller).
