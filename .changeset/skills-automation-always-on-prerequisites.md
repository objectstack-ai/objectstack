---
'@objectstack/skills': patch
---

docs(skills): the automation skill lists `job`, `queue` and `messaging` only under `--preset minimal`, and the platform skill names the `mcp` and `pinyin-search` host defaults

Clause-②: no
Metadata-protocol: none

`objectstack-automation`'s prerequisite table marks `job`, `queue` and `messaging` with ° and says they are always-on, so they need listing in `requires:` only under `--preset minimal`; the symptoms in their rows are what a minimal boot shows without them. The `timeRelative` example and the Stripe and carrier-callback recipes no longer put `'job'` or `'queue'` in `requires:`. `objectstack-platform`'s `### requires:` lead now says the host defaults are mounted under every preset: `mcp` unless `OS_MCP_SERVER_ENABLED=false`, and `pinyin-search` when the stack's `i18n` names a `zh-*` locale, with `OS_SEARCH_PINYIN_ENABLED` overriding that. The automation evals for inbox notifications and the nightly Stripe sync no longer expect those tokens in `requires:`. The platform behaviour already shipped; this release only teaches it.
