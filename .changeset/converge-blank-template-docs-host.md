---
"create-objectstack": patch
---

Converge the blank scaffold template's `README.md` docs links on the ruled
canonical origin, `https://objectstack.ai` (maintainer ruling, 2026-08-21:
「这个仓的文档站规范 URL 是 https://objectstack.ai」; enforced by
`CANONICAL_DOCS_ORIGIN` in `scripts/check-published-readme-links.mjs`). The
template previously linked the accepted-but-unratified `docs.objectstack.ai`
alias in three places, which disagreed with the root `README.md`'s already-
canonical spelling — so a single `npm create objectstack@latest` run handed
the user two different hostnames for the same docs site.
