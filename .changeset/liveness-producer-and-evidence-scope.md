---
"@objectstack/spec": patch
---

feat(spec): a liveness `live` verdict can now cite its PRODUCER, and an entry can declare how wide its last look was (#4837, #4895)

Two fields on liveness ledger entries, both optional, both validated, each
closing a way a `live` verdict has been measurably wrong.

**`producer` — a consumer is only half the call graph (#4837).** `seed.json`
marked `Seed.env` **live**, evidence `seed-loader.ts:91`, note *"filterByEnv
drops datasets whose env list excludes the running environment."* Every word was
checkable against the file and the verdict was still false: line 91 really did
call `filterByEnv(request.seeds, config.env)`, but none of the **six** call sites
that build a `SeedLoaderRequest` passed `env` — so `config.env` was permanently
`undefined`, the filter returned its input on its first line, and `dataset.env`
was never read at all. The evidence pointed at the consumer; the property was
dead at the producer. `seed-loader.test.ts` passed throughout, because the test
supplies `config.env` itself: it exercised a mechanism nothing fed.

So the criterion, now written in `liveness/README.md`: when a property's runtime
effect depends on a **second input somebody must supply**, `live` requires
evidence on the producer side too. `producer` carries it, and resolves through
the same resolver as `evidence` — a repo-local path that does not exist fails
CI, because a call-site claim nothing can falsify is exactly what the field
exists to remove. Absence never fails (the ledger predates the field);
`check:liveness --producer-gap` prints the worklist, and the README's table says
which shapes actually need one — the risk class is optional config with a
default, which always "has a value" in the type system and can still be
`undefined` at runtime.

**`evidenceScope` — how wide the last look was (#4895).** Four measured verdicts
were reached by searching this repo alone and published as if they covered every
consumer: `app.homePageId` ("no shell ever read it" — objectui's
`resolveLandingRoute()` had been reading it all along), `flow.…position` (marked
live on a designer that wrote its own `ui:{x,y}` — a false *live*, the opposite
direction), `HttpMethod` (a scan matching only `import … from`), and
`Notification` (objectui re-exported it with `export … from` and the real
consumers imported from `@object-ui/types` — two hops, which no specifier match
can see). `"evidenceScope": "in-repo" | "cross-repo"` records what was actually
done. Absent is a worklist row; a value outside the vocabulary fails, the same
asymmetry `verifiedAt` uses.

**Entries re-verified while landing this** (not a mass re-grade — six entries
whose call graph was closed by hand):

- `seed.env` — the specimen. Evidence restamped to the live line and a `producer`
  added: since #4704, `load()` resolves the comparison environment itself at the
  one funnel every seeding path goes through, so call site seven cannot reopen
  the hole.
- `job.timeout`, `hook.retryPolicy` / `timeout` / `onError` — the same
  "consumer reads it out of an options object built elsewhere" shape, checked
  and **holding**: the job scheduler threads `{ retryPolicy, timeout }` into
  `svc.schedule`, and the hook binder hands the authored hook straight to
  `wrapDeclarativeHook`. Cited, not assumed.
- `app.homePageId` and `book.groups[].translations` — the two surviving
  tombstones from the #4667 retirement batch, re-verified **cross-repo** against
  objectui `@c2fd1223` and confirmed. objectui now rejects `homePageId` in its
  own schema with a pin test, and its book-spine interfaces declare no
  `translations`. (The other four keys in that batch were strict-removed, so
  they have no ledger row to date; their re-verification is recorded in the PR.)

`cloud` is not reachable from an open-source checkout, so `cross-repo` means "the
realms named in the evidence", never "everywhere" — the README says so where the
value is defined.

`producer.mts` is pure and unit-tested for the reason `orphans.mts` and
`drill.mts` are: on the shipped ledgers these checks are almost entirely quiet,
so a green gate proves nothing about whether they can fire.
