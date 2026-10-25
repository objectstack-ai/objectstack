/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use client"

/**
 * Reads the persisted sidebar collapse state back out of `document.cookie` —
 * objectui#4234.
 *
 * `SidebarProvider` has always WRITTEN `sidebar_state` on every toggle (7-day
 * max-age) and never read it back, so a collapsed sidebar came back expanded
 * on the next load: the cookie was present and correct, and nothing consulted
 * it. Upstream Shadcn closes that loop in a **server component** — it reads the
 * cookie there and hands the value down as `defaultOpen`. A pure SPA (the
 * console) has no such step, so the read has to happen client-side, which is
 * what this function is for.
 *
 * ## Why the implementation lives HERE and not in the primitive
 *
 * `packages/components/src/ui/**` is regenerated from the Shadcn registry
 * (AGENTS.md Commandment #7) — anything written there is overwritten by the
 * next `pnpm shadcn:update`. `src/lib/` is not part of that regeneration, so
 * this file is permanent. `sidebar.tsx` gets only a one-line call, re-applied
 * on every sync by the declared patch in `scripts/shadcn-local-patches.mjs`.
 * Keeping the payload out of the regenerated zone is what makes the patch small
 * enough to survive upstream churn — the same shape as `close-label.tsx`.
 *
 * ## Why the cookie NAME is a parameter
 *
 * The name is owned by the write side: `SIDEBAR_COOKIE_NAME` in `sidebar.tsx`,
 * the same constant the `document.cookie =` assignment interpolates. Passing it
 * in keeps that the single source of truth — a second spelling here could drift
 * from the writer and would read a cookie nobody writes. (Importing the
 * constant instead would make `sidebar.tsx` and this module circular.)
 *
 * ## Strict values, deliberately
 *
 * Only the two literals the write side produces are accepted. Anything else —
 * absent, empty, `"1"`, `"collapsed"`, a truncated value — returns `undefined`
 * so the caller falls through to its `defaultOpen`. That is contract-first
 * (AGENTS.md #0.1): the writer is ours and emits exactly `true`/`false`, so a
 * tolerant parse here would only serve values no part of this system writes,
 * and would silently invent a preference the user never expressed.
 *
 * @param name Cookie name to look up, matched EXACTLY (not by prefix or
 *   substring), so `sidebar_state_v2` / `my_sidebar_state` never answer for
 *   `sidebar_state`.
 * @returns `true` / `false` for a persisted preference, or `undefined` when
 *   there is none to honour — including on the server, where there is no
 *   `document` to read (Next.js SSRs `"use client"` components for the initial
 *   HTML, so this guard is load-bearing for `apps/site`, not defensive noise).
 */
export function readSidebarStateCookie(name: string): boolean | undefined {
  if (typeof document === "undefined") return undefined

  const jar = document.cookie
  if (!jar) return undefined

  for (const entry of jar.split(";")) {
    const separator = entry.indexOf("=")
    // A bare `foo` segment carries no value — it cannot be our `name=value`.
    if (separator === -1) continue
    if (entry.slice(0, separator).trim() !== name) continue

    // First exact-name match decides. Browsers order `document.cookie` most
    // specific path first, so that is the cookie this document would send —
    // scanning past it for a better-looking value would answer with a cookie
    // the server never sees.
    const value = entry.slice(separator + 1).trim()
    if (value === "true") return true
    if (value === "false") return false
    return undefined
  }

  return undefined
}
