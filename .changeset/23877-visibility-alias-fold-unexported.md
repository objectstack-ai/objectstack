---
'@objectstack/spec': minor
---

feat(spec)!: `@objectstack/spec/shared` no longer exports `normalizeVisibleWhen` or `VISIBILITY_ALIAS_KEYS`; read `visibleWhen` directly

Clause-②: yes (narrowing)

**BREAKING (TS/API surface):** two exports of `@objectstack/spec/shared` are gone — the function `normalizeVisibleWhen`, which folded the retired `visibleOn` / `visibility` keys onto the canonical `visibleWhen`, and the const `VISIBILITY_ALIAS_KEYS`, which listed those two keys. Use `visibleWhen` directly instead: it is the one conditional-visibility key, and since 18 every schema that carries it refuses `visibleOn` and `visibility` by name. No schema used the fold after those keys retired, and no caller of either export was found in this repository or in the pinned renderer.

## FROM → TO

| you wrote | write instead |
| --- | --- |
| `import { normalizeVisibleWhen } from '@objectstack/spec/shared'`, then `normalizeVisibleWhen(node)` | read and write `node.visibleWhen`; there is no alias left to fold |
| `import { VISIBILITY_ALIAS_KEYS } from '@objectstack/spec/shared'` | nothing — the two keys it named are refused by the schemas; to reject them yourself, parse with the schema |

**The one-line fix:** delete the import and the call, and read `visibleWhen`.

**What an author who still imports them sees:** `tsc` fails with TS2305 (`Module '"@objectstack/spec/shared"' has no exported member …`); a plain-JS import resolves to `undefined`.

**Nothing to migrate in metadata.** No authored document ever carried either export, so `os migrate meta` has nothing to visit. The stored-row conversions `view-visibleOn-to-visibleWhen` and `page-component-visibility-to-visibleWhen` are unchanged: a pre-18 `sys_metadata` view or page row that still carries an old key keeps loading with `visibleWhen`.

<!-- adr-0087: registered visibility-alias-fold-unexported -->
