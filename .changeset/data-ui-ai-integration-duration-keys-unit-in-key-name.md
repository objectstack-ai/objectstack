---
"@objectstack/spec": minor
---

feat(spec)!: the last seven `data/` · `ui/` · `ai/` · `integration/` duration keys carry their unit in the key name (#15680, ruling B on #14478)

<!-- adr-0087: registered dashboard-refresh-interval-to-refresh-interval-seconds, connector-health-and-trigger-durations-unit-in-key, memory-persistence-auto-save-interval-to-ms, turso-config-timeout-to-timeout-ms, ai-conversation-analytics-duration-unit-in-key, data-nosql-query-options-timeout-unit-in-key -->

**BREAKING** — eight published duration keys are renamed and tombstoned. Shipped
as `minor` under the repo's launch-window convention for breaking changes; the
hand-migration prescriptions are registered under protocol major 18. Maintainer
ruling B on #14478 (2026-09-02, decision batch #43, 「同意」).

`check:duration-unit-keys` makes a duration-shaped `z.number()` carry its unit in
the key NAME, never only in its `.describe()` prose, and grandfathers no existing
offender. Card 1/6 (#15676) landed the rule's two structural exemptions, card 2/6
(#15677) cleared `api/`, card 3/6 (#15678) cleared `kernel/` and card 4/6
(#15679) cleared `system/`. This card clears the remainder, and is the first
where the gate itself reads **`zero offenders`** and exits `0`.

⚠️ That is green **for the gate's currently declared population**
(`packages/spec/src/**`), not for the epic. Card 6/6 widens the population and has
already measured an offender outside this subtree, so the gate is expected to go
red again by design. This changeset does not claim #14478 is finished.

## FROM → TO

| key | replacement | unit |
|:--|:--|:--|
| `dashboard.refreshInterval` | `refreshIntervalSeconds` | seconds |
| `CircuitBreakerConfig.monitoringWindow` | `monitoringWindowMs` | milliseconds |
| `ConnectorTrigger.interval` | `intervalSeconds` | seconds |
| `FilePersistenceConfig.autoSaveInterval` | `autoSaveIntervalMs` | milliseconds |
| `AutoPersistenceConfig.autoSaveInterval` | `autoSaveIntervalMs` | milliseconds |
| `TursoConfig.timeout` | `timeoutMs` | milliseconds |
| `NoSQLQueryOptions.timeout` | `timeoutMs` | milliseconds |
| `ConversationAnalytics.duration` | `durationSeconds` | seconds |

**Every value is unchanged** — only key names move. The two keys that carried a
default keep it (`CircuitBreakerConfig.monitoringWindowMs` still defaults to
60000, `FilePersistenceConfig.autoSaveIntervalMs` to 2000); the other six declare
none. Bounds move with their keys, so `autoSaveIntervalMs` still refuses anything
under 100 on both persistence arms, `NoSQLQueryOptions.timeoutMs` and
`TursoConfig.timeoutMs` still refuse a zero or negative integer, and
`ConversationAnalytics.durationSeconds` still refuses a negative length. Every old
spelling is a `retiredKey()` tombstone, so it fails `tsc` at the authoring site
(input type `never`) and fails the parse with the rename prescription rather than
a bare unrecognized-key error.

`dashboard`'s three rename-hint aliases — `refresh`, `autoRefresh`, `pollInterval`
— were repointed to `refreshIntervalSeconds` in the same edit. A hint left naming
the tombstone would have prescribed a key the shape refuses, which is the one
failure this rename could have introduced silently; a pin asserts all three.

## ⚠️ `dashboard.refreshInterval` crosses a repository boundary

This is the only rename in the whole stack whose consumer is in **another
repository**, so its reader could not move in this PR the way every other reader
in this card did. objectui's dashboard renderer reads the key, multiplies by
1000 to drive a `setInterval`, and republishes it as an authoring input the
console offers. Those sites move in a follow-up objectui card, sequenced behind
a release that actually ships this rename.

Until that lands the renderer sees an absent key and simply does not start its
refresh timer — a dashboard still renders, and still refreshes when the user
asks. The ADR-0087 conversion in this changeset is what keeps stored dashboards
and `os migrate meta` correct in the meantime.

## ⚠️ An eighth key moves that the gate did not list

`AutoPersistenceConfig.autoSaveInterval` is not a gate offender: its `.describe()`
named no unit at all, and the predicate judges prose against name.

It moves anyway because it is not a second key. `persistence: { type: 'auto' }`
resolves to the same Node.js file adapter as `type: 'file'`, and this value is
forwarded to the same `FileSystemPersistenceAdapter` field, in the same
milliseconds, under the same `min(100)` bound. Renaming one arm and not the other
would have left one value with two spellings across sibling arms of one union,
and the driver reading both — the consumer-side dialect Prime Directive #12
forbids. Its describe now names the unit too, and a pin asserts the refusal on
the arm the gate never listed, so a later reader cannot "restore" the bare
spelling as an over-application of the rule.

## Dispositions — four D2 conversions, two semantic entries

Judged per key from `stack.zod.ts`'s collection roots rather than defaulted, and
unlike card 4/6 this card's answer is split.

**D2 conversions** (six keys). `dashboards:`, `connectors:` and `datasources:`
are each a stack collection whose members are stored whole as `sys_metadata`
rows, so the conversion chain has a seam that sees them:
`dashboard-refresh-interval-to-refresh-interval-seconds`,
`connector-health-and-trigger-durations-unit-in-key` (both connector keys in one
pass, emitting separately),
`memory-persistence-auto-save-interval-to-ms` (both persistence arms) and
`turso-config-timeout-to-timeout-ms`. The two datasource conversions are
driver-aware for the reason `datasource-config-driver-key-aliases` records: a
bare `config.timeout` under another driver is that driver's own key and must not
be touched.

**Semantic entries** (two keys). `ConversationAnalytics` is computed at runtime
and handed to a consumer, and `NoSQLQueryOptions` is a per-call driver argument
reached only through `AggregationPipeline.options`. Neither is a stack collection
member or a stored row, so the chain has no seam — the disposition every
runtime-emitted measurement in this stack has taken.

All eight are registered by exact key in `RETIRED_KEYS_BY_MAJOR`.

## A retirement tombstone is no longer read as a secret

`refusedCredentialKeys` derives a driver's refused inline credentials by finding
`z.never()` keys in its config contract. A `retiredKey()` tombstone is also a
`z.never()`, and until this card no driver contract carried one — so "never ⇒
credential" held by accident of population rather than by construction. The first
tombstone to arrive (`TursoConfig.timeout`) made the derivation answer that a
millisecond budget was a secret: it was redacted off the datasource read path and
dragged a non-credential name into the fallback list every unrecognised driver is
scrubbed by.

The derivation now skips keys carrying the `[REMOVED] ` prefix `retiredKey()`
itself stamps. The exclusion is deliberately **negative** — skip declared
tombstones — rather than positive (keep only keys marked `format: 'password'`),
even though every credential slot in every builtin contract does carry that
marker today: under-redacting is the dangerous direction, so a future credential
key whose author forgets the marker is still scrubbed, and only a key that has
explicitly declared itself retired may drop out. Both directions are pinned.

## Keys deliberately left alone

`TursoConfig.sync.intervalSeconds` and `CircuitBreakerConfig.resetTimeoutMs`
already carried their unit — they are the same-shape neighbours that made the
bare `timeout` and `monitoringWindow` collisions visible, and pins assert they
did not move. `NoSQLQueryOptions.batchSize` is a COUNT of documents and every
number on `ConversationAnalytics` other than the duration is a count of messages,
tokens or events: a count has no unit to carry. The turso schema shipped by
`@objectstack/driver-turso` is a separate declaration outside this gate's
declared population and is not touched here; card 6/6 owns it, so the two
declarations disagree by design until that lands.
