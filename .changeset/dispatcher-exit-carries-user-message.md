---
'@objectstack/runtime': patch
---

fix(runtime): carry the producer's `userMessage` to the wire at the dispatcher's throw-transparent exit (#13241)

`errorResponseBase` (`packages/runtime/src/dispatcher-plugin.ts`) resolved every
throw through `resolveThrownHttpError` — whose result already carries
`userMessage` — and then did not read the field. Of the ADR-0112 error
boundaries it was the only one that dropped it: `/data` carries it via
`boundedDeclaredUserMessage`, and the caught-path sibling `errorFromThrown`
carries it as a declared sibling of `code`/`message` through the same `extra`
bag used here. `ApiErrorSchema.userMessage` has declared the slot all along, and
`contract.zod.ts` states the invariant directly — *"`userMessage` on the thrown
error; the boundaries carry it to the wire"* — so this is `declared ≠ enforced`
at one door, not a new field.

**Why it matters.** The 2026-08-27 ruling on #12509 (option D), propagated to
#12281, made this exit withhold the message of every **declared** 5xx, and names
the compensation in the same sentence: *"the author-facing text channel is
`userMessage` (#9934), never the raw message."* That compensation did not exist
here — a declared-5xx producer at this exit had the diagnostic channel withheld
and the author channel unplumbed, so it had no way to address the caller at all.

**Wider than the 5xx band.** `userMessage` is status-agnostic by ruling (#9934:
"a 400, 403, 409 or 503 refusal may all carry it"), so the gap was never confined
to the declared 5xx that motivated it — a marked 4xx refusal reaching this exit
lost the field too, with no withhold anywhere in the picture. The new plumbing is
deliberately not gated on the withhold limb.

**No behaviour change on today's tree.** The population of producers that mark
text on the throw-transparent routes is empty: the only two in-repo producers are
the sandbox (`quickjs-runner`, reached via `/actions`, which `domains/actions.ts`
catches and answers through `errorFromThrown`) and `metadata-protocol`'s
`markedApplicationRefusalError` (reached via the REST `/meta` and `/data` doors).
Neither reaches this exit. An unmarked throw's envelope is byte-identical to
before, and the mark never moves the status, the `code`, or the withheld prose.

Both fields now share **one** `extra` object rather than two conditional
`{ extra: … }` spreads, which do not merge — the later would have replaced the
earlier, silently shipping only one of `declaredCode` / `userMessage` for a throw
carrying both. This mirrors `errorFromThrown`'s expression, so the two runtime
doors agree by construction.

Not addressed here, and recorded rather than closed: a throw spelling
`PERMISSION_DENIED` never reaches this exit — `HttpDispatcher.dispatch`'s foot
catch intercepts it and answers from `http-dispatcher.ts` — so that door still
drops the mark. It is a trigger file of on-hold decision #7898 and out of this
change's surface.
