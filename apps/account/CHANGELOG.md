# @objectstack/account

## 7.3.0

## 7.2.1

## 7.2.0

## 7.1.0

### Patch Changes

- 89771d4: Account: fix post-login redirect to `/organizations/new` in single-tenant
  mode when the freshly-authenticated user has no organization yet.

  The auth-redirect effect in `login.tsx` / `register.tsx` decided where to
  send the user as soon as `session` populated, but `features` (from
  `GET /api/v1/auth/config`) could still be `null` for a beat. The check
  `features?.multiOrgEnabled === false` then evaluated to `false`, so the
  "no orgs" branch fell through to `navigate({ to: '/organizations/new' })`
  — exactly the page that's gated off in single-tenant deployments. The
  wizard then bounced to `/organizations` (empty list), producing a jarring
  "create organization is not supported" flash.

  Both routes now wait for `features` to resolve before deciding the no-org
  redirect target, so single-tenant logins land on `/` (or their original
  `redirect=` target) directly.

## 7.0.0

### Patch Changes

- 39a23c5: fix
- dc72172: Fix: post-signup landing flow

  Single-tenant deployments (`OS_MULTI_ORG_ENABLED=false` /
  `OS_MULTI_TENANT=false`) no longer bounce a fresh user to the
  `/organizations` picker or the `/organizations/new` wizard — both are
  nonsensical when org creation is server-side-gated and the user is
  expected to land in the one default org. Registration now hands the
  user straight to the platform home (or the original `?redirect=`).

  Multi-tenant deployments still route no-org users into the create-org
  wizard, but the wizard now renders as a fullscreen `AuthShell` dialog
  (matching `/login` and `/register`) instead of the authenticated
  account chrome (TopBar + Sidebar). Showing a sidebar full of
  organization-scoped settings to a user who does not yet have an
  organization was contradictory and confusing — the create-org step
  should feel like a follow-on to register, not a settings panel. After
  successful creation, the wizard also honors `?redirect=` and falls
  back to `/` instead of dropping the user back into org settings.

  Verified end-to-end in browser for both tenancy modes with two fresh
  deployments (single-tenant on :3003 with `OS_MULTI_ORG_ENABLED=false`,
  multi-tenant on :3004 with `OS_MULTI_TENANT=true`).

## 6.9.0

## 6.8.1

## 6.8.0

### Patch Changes

- 99866d8: Fix forgot-password page returning 404. better-auth's password reset
  endpoint is `/api/v1/auth/request-password-reset` (not the legacy
  `forget-password`); the account UI now calls the correct path so
  the reset email actually dispatches.

## 6.7.1

### Patch Changes

- 87c4d19: Move all 26 runtime `dependencies` to `devDependencies`. `@objectstack/account` is a pure-SPA package — `files: ['dist']` only ships the Vite-bundled `index.html` + `assets/*.js` + `assets/*.css`. The browser never imports `react`, `@radix-ui/*`, `@tanstack/react-router`, `@objectstack/client`, etc. directly — they are all already bundled into the dist JS.

  **Impact** (measured via `npm install @objectstack/account` in a fresh project):

  |                              | Before     | After    |
  | ---------------------------- | ---------- | -------- |
  | node_modules packages pulled | **33**     | **1**    |
  | on-disk size                 | **129 MB** | **2 MB** |
  | install time                 | ~4 min     | seconds  |

  Tarball itself is unchanged (still ~400KB, 7 files in `package/dist/` + `package.json` + `LICENSE`). Vite build still produces the same `dist/` (`pnpm --filter @objectstack/account build` verified — 2103 modules → 1.29 MB bundle).

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/client@6.7.0
  - @objectstack/client-react@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/client@6.6.0
  - @objectstack/client-react@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/client@6.5.1
- @objectstack/spec@6.5.1
- @objectstack/client-react@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/client@6.5.0
- @objectstack/client-react@6.5.0

## 6.4.0

### Minor Changes

- 15fc484: Upgrade `@object-ui/*` packages to **v6.0**.

  - `@objectstack/cli`: `@object-ui/console` and `@object-ui/studio` from `^5.4.2` → `^6.0.0` — bundled Studio + Console assets now ship the v6 UI shell (new design language, refreshed sidebar, redesigned record header).
  - `@objectstack/account`: `@object-ui/i18n` from `^5.4.2` → `^6.0.0` — i18n runtime now matches the v6 console/studio API.
  - Root devDependency `@object-ui/console` from `^5.4.2` → `^6.0.0` so workspace scripts and the docs build pick up v6.
  - `create-objectstack`: `tar` from `^7.4.3` → `^7.5.15` (security + perf fixes when unpacking remote templates).

  **Heads-up for consumers:** `@object-ui/*` v6 is a major release of the bundled UI; pages rendered through the CLI's `studio` / `console` mounts may look different from v5. The protocol surface is unchanged.

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/client@6.4.0
  - @objectstack/client-react@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/client@6.3.0
- @objectstack/client-react@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/client@6.2.0
  - @objectstack/client-react@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/client@6.1.1
- @objectstack/client-react@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/client@6.1.0
  - @objectstack/client-react@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/client@6.0.0
  - @objectstack/client-react@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/client@5.2.0
  - @objectstack/client-react@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/client@5.1.0
  - @objectstack/client-react@5.1.0

## 5.0.0

### Major Changes

- bb32755: Publish `@objectstack/account` and `@objectstack/console` to npm (major release).

  Previously both apps were marked `private: true`, which prevented `changeset publish`
  from releasing them. The CLI (`@objectstack/cli`) resolves these packages from
  `node_modules/@objectstack/{account,console,studio}` to serve their built `dist`
  assets, so third-party projects could not consume them via `pnpm add`.

  - Removed `private: true` from `apps/account` and `apps/console`.
  - Added `publishConfig.access: public` to `account`, `console`, and `studio` for
    scoped-package publish safety.

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/client@5.0.0
  - @objectstack/client-react@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/client@4.2.0
  - @objectstack/client-react@4.2.0

## 4.1.1

### Patch Changes

- Updated dependencies [5326c6b]
  - @objectstack/client@4.1.1
  - @objectstack/client-react@4.1.1
  - @objectstack/spec@4.1.1

## 4.0.6

### Patch Changes

- f41466a: Trim the first-run `/setup` page. Removed the optional teammate-invite section, the manually-edited org slug field, the large shield banner and the footer note. The form is now 4 fields (name + org name on one row, then email + password) with concise copy — the new owner can invite teammates from the dashboard after first login.
- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/client@4.1.0
  - @objectstack/client-react@4.1.0

## 0.1.1

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/client@4.0.5
  - @objectstack/client-react@4.0.5
