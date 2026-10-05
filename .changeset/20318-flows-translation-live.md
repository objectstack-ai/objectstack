---
"@objectstack/spec": patch
---

Liveness ledger: the `flows` translation group is `live`, and so are both its children. The console's screen-flow runner now names the flow by `flows.<flow>.label` in the active language, in the runner's header and in its completion toast. A locale the bundle does not cover shows the label authored on the flow, and then the flow's API name. `screens` was already `live`.

Clause-②: no

- The `flows` row drops `authorWarn` and its `authorHint`. `os lint` and `os validate` no longer warn `liveness-planned-property` on a bundle that authors `flows`. A warning is not a refusal, so the accept set is unchanged.
- Dropping that bit switches on the CLI's i18n coverage demand for `flows.*`. `os lint` now reports a `flows.<flow>.*` key that a supported locale is missing as `i18n/missing-flow`, and `os i18n extract` scaffolds the group into the bundle. The flow's own `label` is demanded only for a flow with a screen node (see the `@objectstack/cli` entry). Under `--i18n-strict` a missing key is an error: translate it, or run `os i18n extract` to scaffold it.
- The `flows` TSDoc in `translation.zod.ts` and the translations guide's boundary note now say that both halves are applied.
- ⛔ No schema, parse, export or accept-set change.
