// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio builder's two screens, as the ONE module the console loads them
 * through (objectui#11798).
 *
 * `StudioRoute.tsx` (the `/studio` subtree) and `registerStudioComponents.tsx`
 * (the `studio:builder` registry entry) both reach these components through
 * `import('./studioBuilder')`, behind a `lazy()` boundary. Nothing in the
 * console imports this module statically, and nothing may: that is what lets
 * the bundler place `StudioDesignSurface`, `BuilderLanding` and the modules only
 * they reach (such as the pillar panels and the form designer) in a chunk that
 * is fetched when a Studio screen first renders, instead of in the eager
 * closure every console page load pays for.
 *
 * ## Why a console-local module, and not `import('@object-ui/app-shell')`
 *
 * The console imports the `@object-ui/app-shell` barrel statically on every
 * page, so an `import()` of that same specifier moves nothing: rolldown reports
 * it as an `INEFFECTIVE_DYNAMIC_IMPORT`, and the components stay eager. That is
 * exactly what objectui#5486 found in an earlier `lazy()` here. A specifier that
 * only `import()` names is the boundary the bundler can honour, and the barrel's
 * named re-exports still resolve to the defining modules, so no package entry or
 * `exports` subpath is involved.
 *
 * ⛔ A static `import ... from './studioBuilder'` anywhere in the console makes
 * these `import()`s ineffective again. The console build's
 * `ineffective-dynamic-import-ledger` plugin fails the build on an unpinned
 * one, and `pnpm check:eager-closure` weighs the bytes that would come back.
 */

export { BuilderLanding, StudioDesignSurface } from '@object-ui/app-shell';
