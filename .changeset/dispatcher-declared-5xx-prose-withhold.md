---
"@objectstack/runtime": patch
---

fix(runtime): withhold the message of EVERY declared 5xx at the dispatcher exit, aligning to `/data` (#12281)

**Clause-②: yes** — this changes an answer on a public REST door.

`errorResponseBase` (`packages/runtime/src/dispatcher-plugin.ts`) serves the
dispatcher's mounted routes: `/analytics`, `/auth`, `/i18n`, `/automation`,
`/notifications`, `/mcp`, `/packages`. It gated its 5xx message withhold on
`declaresServerFault` — `status >= 500` **and** a non-empty string `code` — while
`/data` gates on `declaredHttpStatus`, which reads `status ?? statusCode` and
never consults `code`. Two bands of declared 5xx were therefore withheld at
`/data` and legible here.

FROM → TO, on the wire, for a route served by the dispatcher plugin:

| thrown by the producer | before | after |
|---|---|---|
| `{ status: 503 }`, no `code` | `{"error":{"message":"<producer prose>","httpStatus":503,…}}` | `{"error":{"message":"Internal server error","httpStatus":503,…}}` |
| `{ statusCode: 503, code: 'SERVICE_UNAVAILABLE' }` | `{"error":{"message":"<producer prose>",…}}` | `{"error":{"message":"Internal server error",…}}` |
| `{ statusCode: 503 }`, no `code` | `{"error":{"message":"<producer prose>",…}}` | `{"error":{"message":"Internal server error",…}}` |
| `{ status: 503, code: 'SERVICE_UNAVAILABLE' }` | `Internal server error` | `Internal server error` (unchanged) |
| a bare `Error` (declares nothing) | `<producer prose>` | `<producer prose>` (**unchanged**) |
| any declared 4xx | `<producer prose>` | `<producer prose>` (**unchanged**) |

Only the `message` field changes. `code`, `httpStatus`, `declaredCode` and
`details` are untouched, so nothing a machine branches on moves, and the
untouched error still reaches the operator through the `__obsRecordedError`
side-channel and the log.

Maintainer ruling 2026-08-27 on #12509 (option D), propagated to #12281:
`errorResponseBase` adopts the structural withhold for every declared 5xx
message, aligning to `/data`'s rule; the author-facing text channel is
`userMessage` (#9934), never the raw message. The judgement is **inherited**,
not re-derived: the door now reads `serverFaultProvenance` from
`@objectstack/types` — the same function `demotedDeclaredCode` already reads for
the code channel — so "one rule, every door inherits" (#12509) holds by
construction rather than by three doors agreeing.

⛔ The gate is the **declared** status, never the resolved `httpStatus` (which
falls back to 500 for a throw that declared nothing). #5667's undeclared-5xx
tiering is preserved exactly: a bare `Error` from our own code stays legible and
still goes through the `looksLikeInternalErrorLeak` heuristic alone.

Measured before the change and unchanged by it: the population that changes
hands at this door today is **empty** — `metadata-protocol`'s `deleteMetaItem`
reaches only the REST `/meta` door (the dispatcher plugin mounts neither `/meta`
nor `/data`), and `action-execution.ts`'s seven `statusCode` throws are all
caught before this exit. The alignment is a no-op on today's tree, which is why
now was the cheapest moment to make it: it costs no legibility that exists and
buys the invariant forward.
