# @objectstack/docs

## 4.2.2

### Patch Changes

- 72d75eb: docs site: drop `output: 'standalone'` so the production build stops failing
  
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

## 4.2.1

### Patch Changes

- 04a29c7: docs: add `concepts/metadata-lifecycle.mdx` documenting the Repository →
  Change Log → Cache → Registry data path (ADR-0008), the overlay whitelist
  invariant (ADR-0005), and end-to-end HMR semantics. Cross-linked from
  `concepts/metadata-driven` and `guides/contracts/metadata-service`. Closes
  M0 PR-11.

## 4.2.0

## 4.1.1

## 4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release

## 4.0.4

## 4.0.3

## 4.0.2

## 4.0.0

## 3.3.1

## 3.3.0

## 3.2.9

## 3.2.8

## 3.2.7

## 3.2.6

## 3.2.5

## 3.2.4

## 3.2.3

## 3.2.2

## 3.2.1

## 3.2.0

## 3.1.1

## 3.1.0

## 3.0.11

## 3.0.10

## 3.0.9

## 3.0.8

## 3.0.7

## 3.0.6

## 3.0.5

## 3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.

## 3.0.2

## 3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

## 2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.0

## 1.0.12

## 1.0.11

## 1.0.10

## 1.0.9

## 1.0.8

## 1.0.7

## 1.0.6

## 1.0.5

## 1.0.4

## 1.0.3

## 1.0.2

### Patch Changes

- a0a6c85: Infrastructure and development tooling improvements

  - Add changeset configuration for automated version management
  - Add comprehensive GitHub Actions workflows (CI, CodeQL, linting, releases)
  - Add development configuration files (.cursorrules, .github/prompts)
  - Add documentation files (ARCHITECTURE.md, CONTRIBUTING.md, workflows docs)
  - Update test script configuration in package.json
  - Add @objectstack/cli to devDependencies for better development experience

- 109fc5b: Unified patch release to align all package versions.

## 1.0.1

## 1.0.0

## 0.9.2

## 0.9.1

### Patch Changes

- Patch release for maintenance and stability improvements. All packages updated with unified versioning.

## 0.8.2

## 0.8.1

## 1.0.0

## 0.7.2

## 0.7.1

### Patch Changes

- Patch release for maintenance and stability improvements

## 0.6.1

## 0.6.0

### Minor Changes

- b2df5f7: Unified version bump to 0.5.0

  - Standardized all package versions to 0.5.0 across the monorepo
  - Fixed driver-memory package.json paths for proper module resolution
  - Ensured all packages are in sync for the 0.5.0 release

## 0.4.2

### Patch Changes

- Unify all package versions to 0.4.2

## 0.1.1

### Patch Changes

- Patch release for maintenance and stability improvements
