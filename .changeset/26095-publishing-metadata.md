---
'@objectstack/account': patch
'@objectstack/cli': patch
'@objectstack/client': patch
'@objectstack/client-react': patch
'@objectstack/cloud-connection': patch
'@objectstack/connector-imap': patch
'@objectstack/connector-mcp': patch
'@objectstack/connector-openapi': patch
'@objectstack/connector-rest': patch
'@objectstack/connector-slack': patch
'@objectstack/console': patch
'@objectstack/core': patch
'@objectstack/driver-memory': patch
'@objectstack/driver-mongodb': patch
'@objectstack/driver-sql': patch
'@objectstack/driver-sqlite-wasm': patch
'@objectstack/driver-turso': patch
'@objectstack/embedder-openai': patch
'@objectstack/formula': patch
'@objectstack/hono': patch
'@objectstack/knowledge-memory': patch
'@objectstack/knowledge-ragflow': patch
'@objectstack/lint': patch
'@objectstack/mcp': patch
'@objectstack/metadata': patch
'@objectstack/metadata-core': patch
'@objectstack/metadata-fs': patch
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
'@objectstack/observability': patch
'@objectstack/organizations': patch
'@objectstack/platform-objects': patch
'@objectstack/plugin-approvals': patch
'@objectstack/plugin-audit': patch
'@objectstack/plugin-auth': patch
'@objectstack/plugin-dev': patch
'@objectstack/plugin-email': patch
'@objectstack/plugin-hono-server': patch
'@objectstack/plugin-pinyin-search': patch
'@objectstack/plugin-security': patch
'@objectstack/plugin-sharing': patch
'@objectstack/plugin-webhooks': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/sdui-parser': patch
'@objectstack/service-analytics': patch
'@objectstack/service-automation': patch
'@objectstack/service-cache': patch
'@objectstack/service-cluster': patch
'@objectstack/service-cluster-redis': patch
'@objectstack/service-datasource': patch
'@objectstack/service-i18n': patch
'@objectstack/service-job': patch
'@objectstack/service-knowledge': patch
'@objectstack/service-mailbox': patch
'@objectstack/service-messaging': patch
'@objectstack/service-package': patch
'@objectstack/service-print': patch
'@objectstack/service-queue': patch
'@objectstack/service-realtime': patch
'@objectstack/service-settings': patch
'@objectstack/service-sms': patch
'@objectstack/service-storage': patch
'@objectstack/setup': patch
'@objectstack/skills': patch
'@objectstack/spec': patch
'@objectstack/studio': patch
'@objectstack/trigger-api': patch
'@objectstack/trigger-record-change': patch
'@objectstack/trigger-schedule': patch
'@objectstack/types': patch
'@objectstack/verify': patch
'create-objectstack': patch---

chore(packages): publishing metadata — per-format types in `exports`, declared `sideEffects`, and a README for the 18 published packages without one

Clause-②: no
Metadata-protocol: none

Measured on a fresh `origin/main` build of all 73 published packages outside `ui/`, each staged as `npm pack` would ship it, with publint 0.3.25 and @arethetypeswrong/cli 0.18.5. Before: 73 of 73 packages carried at least one publint message and 48 carried an attw problem. After: 2 publint messages remain (`@objectstack/console` and `@objectstack/skills` ship no JavaScript, so neither declares a module `type`) and 15 packages carry an attw problem, all three remaining classes needing an export-map shape change that this change deliberately does not make.

- **Types per module format.** On 39 manifests one `types` entry served both formats, so a TypeScript consumer importing the ESM build was handed the CJS declarations — attw's 38 `FalseCJS`, plus `FalseESM` on `@objectstack/core`, which had it the other way round. Each `{types, import, require}` entry becomes `{import: {types, default}, require: {types, default}}` pointing at the declaration file the same tsup run already emits for that format. No subpath is added or removed, and no JavaScript target moves.
- **`sideEffects` on the 72 manifests that declared none**, read per package rather than set in bulk: `@objectstack/service-cluster-redis` registers its `redis` cluster driver at module load and `create-objectstack`'s bin reaches its program through a bare import, so both declare their entry files side-effectful; everything else is `false`.
- **`publishConfig: { access: 'public' }`** on the 17 that had none, the value the other 56 already declare.
- **`type`** on the 39 that shipped `.js` without declaring a format — every `.js` under their `dist/` was read first and is CommonJS, which is what the absent field already meant — **`engines.node >= 22.0.0`** on the 22 that had no `engines`, and **`repository.url`** as the full `git+https://` git URL on 71.
- **A README for 18 published packages that had none**: one paragraph, the first import a reader writes, and a link to the package's docs page. They are the pages npm renders, and for these 18 npm rendered nothing.
