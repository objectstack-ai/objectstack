---
"@objectstack/cli": patch
---

`os init` scaffolds now stamp `engines: { protocol: '^<current major>' }` into the
generated `objectstack.config.ts` (all three templates), so newly authored packages
participate in the ADR-0087 load-time protocol handshake instead of being admitted
under the "no-range" grandfathering warning. The bundled example apps (`app-todo`,
`app-crm`, `app-showcase`) now declare the same range. (#4097)
