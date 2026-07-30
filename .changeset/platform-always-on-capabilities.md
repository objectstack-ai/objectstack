---
"@objectstack/spec": minor
"@objectstack/cli": patch
---

feat(spec,cli): publish the foundational capability slate so every runtime reads one list (#3786, cloud#925)

`Serve.ALWAYS_ON_CAPABILITIES` — the capabilities auto-added to every app's
`requires` outside `--preset minimal` — was declared in the CLI, under a comment
noting that "cloud / multi-environment hosts (which live in a separate
distribution) mirror this list on their per-project kernels."

Nothing made that true, and they had already diverged. Cloud's per-tenant slate
was missing **`sms`, `messaging` and `analytics`**, so an app that worked under
`objectstack serve` could lose `notify` deliveries and dataset previews once
hosted — silently, with no error anywhere. The framework's own comment on
`analytics` spells out the failure mode it was made always-on to prevent:
"Without it the dataset preview + dashboard/report analytics widgets silently
no-op."

**New export: `PLATFORM_ALWAYS_ON_CAPABILITIES`** (`@objectstack/spec`, and
`@objectstack/spec/kernel`). The slate and its per-entry rationale now live
beside `PLATFORM_CAPABILITY_PROVIDERS` — the map published for exactly this
reason one release earlier, "so cloud's objectos-runtime and the framework CLI
classify a `requires` token identically". `Serve.ALWAYS_ON_CAPABILITIES` is now
a re-export of it, kept as a stable handle for existing callers rather than
deleted: one declaration, two readers.

Four assertions make the single declaration trustworthy for both of them — the
slate is frozen, deduped and non-empty; its foundational prefix
(`queue, job, cache, settings, email, storage`) is pinned, because mount order
matters when services bind to each other during `kernel:ready`; every member is
a real `PLATFORM_CAPABILITY_TOKENS` entry; every member has a declared provider;
and every member is `edition: 'open'`, since a floor the open distribution
cannot mount is not a floor. Verified by mutation: an unknown token, an
enterprise-edition token, and a reordered prefix each turn the gate red.

**No behaviour change.** The published slate is byte-identical to the list the
CLI already had, and `serve-defaults.test.ts` / `serve-capability-vocabulary.test.ts`
pass unchanged. What changes is that there is now something to derive from:
cloud's hosted runtime can drop its copy and read this instead, which is the
follow-up cloud#925 left open — it lands there once the `.objectstack-sha` pin
moves past this release.
