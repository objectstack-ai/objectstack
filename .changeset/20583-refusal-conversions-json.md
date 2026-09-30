---
"@objectstack/cli": patch
---

**When a `defineStack` or `composeStacks` call converts a deprecated spelling and then refuses the config, `objectstack validate --json`, `objectstack build --json` and `objectstack lint --json` now report both the refusal and the ADR-0087 conversions it applied.**

`defineStack` rewrites a deprecated metadata spelling to its canonical shape when the config loads, such as `description` on a `page:header` component (canonical `subtitle`). When the same call then refused the config, for example on an unknown `requires` token (`STACK_CAPABILITY_UNKNOWN`), each of the three commands exited 1 with the refusal's `error` and `code` and with `conversions: []`. The conversion reached stderr only, as a warn-once line.

The refusal now carries the conversions the producer applied before it refused (`stackConversionsOf(error)` in `@objectstack/spec`), and each command adds them to the `conversions` list of its failure payload, beside the refusal. Each conversion is listed once. A refusal whose source needed no conversion, and any other failure at load, still answers `conversions: []`.

Nothing is accepted or refused differently: the exit code, `error`, `code` and every other key of each payload are unchanged, and no key is added. The text face is unchanged.

Clause-②: no
