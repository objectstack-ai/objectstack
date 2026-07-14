---
"create-objectstack": patch
---

Scaffolded projects now install the current framework release instead of a stale major. The bundled `blank` template had `^6.0.0` ranges frozen in while the registry was publishing 14.x, so `npm create objectstack` produced a project eight majors behind the docs — and the template's code no longer compiled against 14.x anyway (`Field.longText` removed, `api.rest` no longer a `defineStack` key, `sharingModel` now required by the ADR-0090 security gate). The template is updated to the current API, and the scaffolder now rewrites every `@objectstack/*` range in the generated `package.json` to `^<its own version>` (all packages version in lockstep), so generated projects track the release even if the committed template drifts again. A consistency test ratchets the template's major and the README's template table against the registry. The template README also documents the seeded dev-admin sign-in that data-API curls need.
