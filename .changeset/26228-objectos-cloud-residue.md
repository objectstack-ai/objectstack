---
'@objectstack/spec': patch
'@objectstack/runtime': patch
'@objectstack/service-settings': patch
---

fix(spec,service-settings): the AI 501 remedy and the AI / knowledge settings hints name the hosted product "ObjectOS Cloud"

Clause-②: no
Metadata-protocol: none

ObjectOS is the product, in Community, Cloud and Enterprise editions; ObjectStack is the protocol, SDK, CLI and framework. Three runtime sentences still named the hosted product "ObjectStack Cloud":

- **`@objectstack/spec`.** `REMEDY_DETAIL['ai']` — the message every `/ai/*` route's 501 body carries and `/discovery` reports as `services.ai.message` on an open-edition boot — now reads "Provided by @objectstack/service-ai in ObjectOS Cloud/Enterprise — no implementation ships in the open framework".
- **`@objectstack/service-settings`.** The AI live-call hint ("realized only by an ObjectOS Cloud tier") and the knowledge `turso` adapter's "Test connection" hint ("built in the ObjectOS Cloud monorepo") on Settings → AI & Embedder.
- **`@objectstack/runtime`.** A doc comment on the kernel-resolver seam; no behaviour change.

What to do: a client that string-matches the old 501 / discovery message updates the product name in its expected text. Nothing else changes: package names, `OS_CLOUD_*` env vars, `~/.objectstack/cloud.json` and the `os cloud …` commands keep their names.
