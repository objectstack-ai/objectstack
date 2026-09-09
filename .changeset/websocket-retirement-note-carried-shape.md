---
"@objectstack/spec": patch
---

`websocket.zod.ts`'s retirement note now names the subscription shape the transports actually carry.

The note recording the deletion of the `FilterOperator` / `EventFilterCondition` / `EventFilterSchema` vocabulary stated, as a positive fact, that "the subscription shape the transports actually carry" is the deliberately unvalidated `filters: z.unknown()` on `SubscriptionEventSchema` (`api/realtime.zod.ts`). Measured, no transport parses that schema at all — nothing outside `packages/spec` imports it — so the sentence read as evidence that the schema *has* a consumer, and it was the only prose in the repo connecting the two.

The shipped subscription path carries a plain TypeScript interface one directory over: `contracts/realtime-service.ts#RealtimeSubscriptionOptions`, whose `object` and `eventTypes` are the only two fields `matchesSubscription` (`service-realtime/src/in-memory-realtime-adapter.ts`) reads.

- **Only the sentence's second half moved.** Its first half — `matchesSubscription` matches on object name and event type only — was already exact, and is untouched.
- **`SubscriptionEventSchema.filters` keeps its place in the note**, as the sibling declaration of the same unenforced kind. That is what it is; it is simply no longer described as a shape anything transports.
- **The correction anchors on a symbol** — not a bare name, and not a line number. Four same-ish spellings of a realtime subscription exist and only one is executed, so a bare name would re-plant the ambiguity the sentence exists to remove, and a line-number citation would rot out of date.

**What moves for consumers.** Comment text only, and it is genuinely shipped: `@objectstack/spec` publishes `src/**/*.zod.ts`, so `src/api/websocket.zod.ts` reaches the npm tarball verbatim, comments included. Nothing else moves — no key, type, export, tombstone or accept set, no `.describe()` string, and no generated artifact.
