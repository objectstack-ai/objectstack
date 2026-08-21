---
'@objectstack/docs': patch
---

docs site: drop `output: 'standalone'` so the production build stops failing

The production build of the docs site died at the end of `next build` with
`ENOENT: no such file or directory, open '.../apps/docs/.next/next-server.js.nft.json'`,
so nothing merged to `main` reached the site.

That file is opened by the standalone packer (`writeStandaloneDirectory` ->
`copyTracedFiles`), which Next calls **only** when `output === 'standalone'`.
Nothing in this repo consumes `.next/standalone` — no Dockerfile, workflow,
script or config references it, and `docker/Dockerfile` does not build
`apps/docs` at all — and Vercel does its own serverless packaging. The setting
served no consumer and was the sole reason that read happened, so removing it
removes the only code path that can raise this error.
