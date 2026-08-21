---
'@objectstack/spec': patch
---

Retarget four `roles` → `positions` action-session provenance strings from "v11" to
"v16" — the release that actually shipped the `#3280` deprecate → `#3290` remove
session-alias precedent they cite (`content/docs/releases/v16.mdx` is the only release
page citing `#3290`).

Text-only provenance correction, no schema shape or acceptance change:

- `ActionSessionSchema`'s `positions` and `roles` `.describe()` strings
  (`packages/spec/src/ui/action-params.zod.ts`) — regenerates
  `content/docs/references/ui/action-params.mdx`.
- The `action-session-roles-to-positions` migration rationale
  (`packages/spec/src/migrations/registry.ts` and
  `packages/spec/src/migrations/entries/semantic/17.action-session-roles-to-positions.ts`)
  — regenerates `spec-changes.json` and `docs/protocol-upgrade-guide.md`.
