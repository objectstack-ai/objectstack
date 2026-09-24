---
'@objectstack/client': minor
---

fix(client)!: every `limit` query-parameter emitter sends what the caller wrote, so `{ limit: 0 }` is no longer silently swapped for the server's default window on three methods (#19567)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a runtime behaviour change in the SDK's query-string building: no spec key, export, type or stored shape is added, removed or renamed, so objectstack migrate meta has nothing to rewrite, and the one caller-side adjustment is to leave limit out rather than pass 0 or null -->

**BREAKING** — a narrowing, shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA; the breaking-ness is carried by
this banner and the ADR-0087 disposition above, not by the level). A call that used
to answer `200` can now answer `400`.

**What changed.** The SDK set the `limit` query parameter behind three different
guards, so one input got a different answer depending on the method. Seven methods
already sent every value except `undefined`. Three used a truthy test, so `0` and
`NaN` never left the client and the server answered `200` with its default window —
rows the caller did not ask for. Four used `!= null`, so an untyped `null` was dropped
there while the other ten sent it as the text `null`. All fourteen emitters now leave
only an absent (`undefined`) `limit` off the wire and send everything else as written;
the door that declares the bound decides. The SDK itself still does not validate
`limit`.

| method | what changes on the wire |
|:--|:--|
| `automation.runs.list` | `0`, `NaN` and `null` are now sent; the door declares `1..100` and refuses all three with `400 VALIDATION_FAILED` |
| `notifications.list` | `0`, `NaN` and `null` are now sent; the inbox clamps `0` to one row (its declared clamp into `1..200`) and refuses `NaN` / `null` with `400` |
| `environments.listRevisions` | `0`, `NaN` and `null` are now sent to the control-plane door |
| `automation.listRuns`, `environment(id).automation.listRuns` | an untyped `null` is now sent and refused with `400` (`0` and `NaN` were already sent) |
| `data.listImportJobs`, `environment(id).data.listImportJobs` | an untyped `null` is now sent; the door reads it as its default of 50, so the answer does not move |

`meta.getHistory`, `meta.getAudit`, `search`, `ai.conversations.list`,
`ai.pendingActions.list`, `data.export` and `environment(id).meta.getHistory`
already sent every value except `undefined`, and are unchanged.

**If you relied on the old behaviour:** a call that passed `limit: 0` (or `null`) to
mean "the server's default window" should leave `limit` out instead. Every `limit`
here is typed `number | undefined`, so `null` only reaches these methods through an
untyped caller.
