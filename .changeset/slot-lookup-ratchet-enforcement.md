---
---

ci(tooling): enforce the #4251 slot-lookup sweep ratchet with a counted baseline

The grandfather list shipped as paths in `eslint.config.mjs` under a comment
reading "NEVER add an entry" — a promise nothing checked. ESLint cannot express
a ratchet: an ignored file is ignored completely, so a NEW `getService<any>(…)`
added to an already-listed file rode the old entry with `pnpm lint` green.

The list moves to `scripts/slot-lookup-baseline.json` (file → site count) and
becomes the single source: its keys are the config's `ignores`, its values are
what `pnpm check:slot-lookup` enforces. The script re-runs ESLint with the
grandfathering lifted and matches reports by the rule's exact message, so the
counter cannot drift from the rule. It fails on a new file, a grown count, a
stale entry, and — via a key-set comparison against the merge base with main —
on a file being ADDED to the list, which no count check can see.

Tooling and CI only; releases nothing.
