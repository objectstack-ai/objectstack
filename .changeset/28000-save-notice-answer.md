---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/objectql': minor
'@objectstack/client': minor
---

feat(spec): a hook can tell the person who saved a record what the save set in motion

Clause-②: yes
Metadata-protocol: added

A `beforeInsert` / `beforeUpdate` / `afterInsert` / `afterUpdate` hook had no way to tell the person saving what the save started, such as sending a deal for approval. The single-record write answer carried `warnings` (advisory validation-rule hits) and nothing else a save could say. Now a hook can attach one message to the save's answer.

- **Spec.** `CreateDataResponseSchema` and `UpdateDataResponseSchema` declare an optional, response-only `notice`: one author-written message, info severity, separate from `warnings`. When more than one call sets it, the last one wins. The key is omitted when no hook set one, and it is never stored on the record. `WriteObservabilityOptions` declares the in-process listener a hook calls to set it, `onNotice(message)`, beside `onFieldsDropped`, `onValidationAdvisory` and `onMentionsWithheld`. Like them it never crosses the wire.
- **metadata-protocol.** `createData` and `updateData` pass the listener and answer the last non-empty message as `notice`. A nested write that a hook or a flow makes inside this one carries its own options, so its notice never reaches this answer.
- **client.** `CreateDataResult` and `UpdateDataResult` declare `notice?: string`, mirroring the two schemas.
- **objectql.** `engine.update` accepts the `onNotice` option. The engine never calls it; it carries it to the hooks with the rest of the caller's bag.

How a hook sets it: read the write's own options bag off `ctx.input.options` and call the listener when it is there.

```ts
const opts = ctx.input.options as WriteObservabilityOptions | undefined;
opts?.onNotice?.('Sent to your manager for approval');
```

A hook whose handler runs as code in the server process (registered with `registerHook`, or a declarative `handler` bound as a function) can call it today. A hook that runs in the sandbox (a `body`, including a `handler` the build lowers into one) cannot yet, and neither can a record-triggered flow: both are follow-up work.

Nothing to do for existing clients: a client that does not read `notice` sees the same answer as before.
