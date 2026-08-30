---
"@objectstack/cli": minor
---

feat(cli): `--format json` failure envelopes carry the ADR-0112 `code` and `httpStatus` (#13347)

Every machine-readable failure this CLI emits was built the same way — 48 sites
under `packages/cli/src/commands/`:

```ts
await emitJson({ success: false, error: error.message });
```

The payload carried the human sentence and nothing else. The error reaching
those `catch` blocks from `@objectstack/client` is not a bare `Error`: the SDK's
`fetch` wrapper attaches `err.code` (the semantic ADR-0112 string, normalized to
the same spelling across the flat `@objectstack/rest` envelope and the wrapped
runtime-dispatcher one) and `err.httpStatus`. Both were discarded at the CLI
boundary, so the one outcome a script most needs to branch on — *someone else
edited it, re-read and retry* vs *you are not allowed* vs *the server is down* —
was separable only by substring-matching an English sentence that no contract
pins.

A stale-pin refusal from `os meta delete --if-match` used to read:

```json
{
  "success": false,
  "error": "[metadata_conflict] view/race_probe has been modified since you loaded it. …"
}
```

and now reads:

```json
{
  "success": false,
  "error": "[metadata_conflict] view/race_probe has been modified since you loaded it. …",
  "code": "METADATA_CONFLICT",
  "httpStatus": 409
}
```

Maintainer ruling 2026-08-30 (option **A** of three):

- The payload stays **FLAT**. Nesting into `{ error: { code, message, httpStatus } }`
  was considered and declined as breaking.
- `success` and `error` keep their current meaning **and spelling**.
- The two keys are emitted **only when the thrown error carries them**, and are
  **absent** — not `undefined` — otherwise. No fallback code is invented for a
  locally-thrown plain `Error`: this CLI's own input refusals get no code,
  deliberately, because ADR-0112's ledger is the authority on who may mint one.

Human (`table`) output is untouched.

**Why `minor` and not `patch`.** Maintainer-set, and it overrides the obvious
reading: this is a shape change to an **already-published error envelope**, and
that makes it minor even though it is purely additive.

**Migration.** Nothing is required — no key is removed, renamed or re-typed, and
every payload this CLI emitted before is still emitted, byte-for-byte, minus the
two new keys. Two things are worth knowing before you rely on the new ones:

- **The envelope is polymorphic, by design.** `code` and `httpStatus` are absent
  whenever the failure did not carry them, which a consumer cannot distinguish
  from an older CLI. Branch on presence (`if (payload.code === 'METADATA_CONFLICT')`),
  never on absence meaning "success" or "unsupported version". This cost was
  weighed against breaking every existing consumer, and the non-breaking side won.
- **Stop substring-matching the sentence.** `error` is prose and no contract pins
  its wording; the bracketed `[metadata_conflict]` tag some messages carry today
  is a property of one producer, not a contract, and a separate card argues for
  removing it. Code that reads the sentence to classify a failure should move to
  `code` (with `httpStatus` as the coarse fallback).
