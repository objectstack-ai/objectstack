---
"@objectstack/runtime": patch
"@objectstack/hono": patch
"@objectstack/plugin-security": patch
"@objectstack/service-package": patch
---

docs: repair the dead repo-relative targets in four published READMEs (#10813)

A published README ships inside the npm tarball, so a dead relative link in one
is shipped to every reader who installs the package. Nine of them were measured
across four packages, and nothing read them: `check:published-readme-links`
checked docs-site URLs, `check:published-readme-exports` checked fenced import
lines, and the lychee lane never sees `packages/**/README.md`.

`@objectstack/runtime` carried six dead targets. Each was traced to where the
content actually went rather than deleted:

- `MINI_KERNEL_GUIDE.md`, `MINI_KERNEL_ARCHITECTURE.md` and
  `MINI_KERNEL_IMPLEMENTATION.md` were deleted from the repo root in January as
  "redundant markdown files" (d709ecce68 — 14 files, 5051 deletions, nothing
  added). The kernel reference they described is the docs site now, so the
  Documentation section is the same footer eight sibling READMEs already use.
- `examples/host/` was renamed to `examples/app-host`, then `apps/server`, then
  `apps/objectos`, and finally split out to `objectstack-ai/cloud`. In-repo, an
  HTTP server in front of the runtime is `@objectstack/plugin-hono-server` plus
  the `@objectstack/hono` adapter, so the bullet points there.
- `examples/msw-react-crud/` became `examples/app-react-crud`, then
  `apps/console`, and now ships as `@object-ui/console` from another repo.
- `test-mini-kernel.ts` was a root-level scratch script; this package's suite is
  179 test files under `src/`.
- The section also ended on a truncated bullet with an unterminated backtick
  (`` - `packages/runtime/src/ ``), which is now a real pointer to that suite.

The other three packages: `@objectstack/hono` and `@objectstack/service-package`
still spelled `@objectstack/driver-sql` as `../../plugins/driver-sql`, stale
since the driver moved to `packages/drivers/` (#5618). `@objectstack/plugin-security`
and `@objectstack/service-package` linked three packages that are in no directory
of this repo (`plugin-org-scoping`, `service-tenant`, `service-marketplace`);
those links are dropped and the names kept as code spans, which is the spelling
those same files already use for a package they cannot point at in-tree. Whether
those three packages exist at all is a separate question, filed separately.
