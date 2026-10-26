// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// @vitest-environment happy-dom

/**
 * The public share-link base resolves through the ONE console-mount resolver
 * (objectui#4482).
 *
 * ## What was wrong, given nothing was broken
 *
 * `AiChatPage` built `publicShareBase` itself: read `<base href>`, take its
 * pathname, trim trailing slashes, concatenate `${origin}${base}/s`. Measured
 * output was correct for every deployment shape the console is actually served
 * in — this card is drift risk, not a defect. It was the third independent copy
 * of a resolution `resolveConsoleUrl` already centralizes; objectui#4472 had
 * just deleted the other two. A correct-today duplicate is precisely the shape
 * that rots: the next change to mount semantics updates the helper and misses
 * the copy.
 *
 * So a green suite proves nothing by itself here, and these cases are written
 * to be discriminating rather than merely passing — see the reverse
 * verification at the bottom of this header.
 *
 * ## Why the pins are driven by an injected `<base>` element
 *
 * PR #4480 recorded the trap: `vi.stubEnv('BASE_URL', …)` does nothing against
 * the `import.meta.env.BASE_URL` spelling, because Vite inlines that at
 * transform time. A test steering it is permanently green while testing
 * nothing the production path reads. The mount is carried by the injected
 * `<base href>` tag and by nothing else, so every case below sets a real
 * `<base>` element in the document — the same mechanism the framework CLI
 * writes into the served HTML (`<base href="${CONSOLE_PATH}/">`) and the same
 * one the router's own basename resolution reads (`apps/console/src/App.tsx`).
 *
 * ## Equivalence measured at fix time
 *
 * Old builder vs `resolveConsoleUrl('s')` over the base-href matrix: identical
 * output for every reachable input — `/_console/` (the CLI's only injection,
 * always trailing-slashed), `/` (root mount), no `<base>` (dev/standalone),
 * `./` (portable build), and nested mounts. They differ only for inputs
 * nothing emits: a base href with NO trailing slash, and a cross-origin
 * absolute base href. In both the shared resolver follows the HTML base-URL
 * semantics the router and the SPA's relative asset URLs already live by,
 * while the deleted copy treated the href as a directory prefix and forced the
 * document origin. Recorded on the issue rather than fixed here — changing
 * `consoleRoot()` would move `/home` and org-switch navigation too.
 *
 * ## Reverse verification (performed when written)
 *
 * - Making `consoleRoot()` ignore the `<base>` tag (always the origin root)
 *   reddens the two mount cases — `/_console/` and the port/scheme one — while
 *   the root-mount and no-`<base>` cases stay green, because they resolve to
 *   the same URL either way. That split is the point: it shows the mount cases
 *   are measuring the mechanism and not a constant. It also reddens the scan
 *   self-check below, which was NOT predicted and is worth writing down: that
 *   case asserts the resolver still contains a `<base>` read, and this ablation
 *   deletes precisely that. The coupling is correct — "the resolver is the one
 *   place that reads the tag" is false once the resolver stops reading it — but
 *   it means the self-check is not independent of `consoleRoot()`'s body.
 * - Deleting the no-DOM guard from `resolvePublicShareBase` reddens the SSR
 *   case by THROWING (`resolveConsoleUrl` reaches `window.location.origin`
 *   through an undefined `window`), not by returning a wrong string.
 * - Re-introducing a hand-rolled `document.querySelector('base')` into
 *   `AiChatPage` reddens the one-resolver case with that path named.
 * - Pointing `consoleRoot()`'s no-`<base>` fallback at `document.baseURI`
 *   reddens only the deep-route case — the regression `resolveHomeUrl`'s
 *   header already records, here for the share base.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePublicShareBase } from '../resolveHomeUrl';

function setBaseHref(href: string | null): void {
  document.head.querySelectorAll('base').forEach((el) => el.remove());
  if (href != null) {
    const base = document.createElement('base');
    base.setAttribute('href', href);
    document.head.appendChild(base);
  }
}

describe('resolvePublicShareBase (injected <base href> mechanism)', () => {
  afterEach(() => {
    setBaseHref(null);
    vi.unstubAllGlobals();
    history.pushState({}, '', '/');
  });

  it('lands under the console mount the framework CLI injects', () => {
    // `<base href="/_console/">` — packages/cli/src/utils/console.ts writes
    // exactly this (CONSOLE_PATH + '/'). A recipient opening the copied link
    // must reach SharedRecordPage at /_console/s/:token, not /s/:token.
    setBaseHref('/_console/');
    expect(resolvePublicShareBase()).toBe(`${window.location.origin}/_console/s`);
  });

  it('is the origin root on a root-mounted deployment', () => {
    setBaseHref('/');
    expect(resolvePublicShareBase()).toBe(`${window.location.origin}/s`);
  });

  it('is the origin root when the host injected no <base> at all', () => {
    // Standalone / `os dev` runs ship no <base>; the SPA is root-mounted.
    setBaseHref(null);
    expect(resolvePublicShareBase()).toBe(`${window.location.origin}/s`);
  });

  it('ignores the current SPA route when no <base> is present', () => {
    // The share dialog opens from deep inside the chat surface. Resolving
    // against the current document URL would produce /ai/agent/s — the same
    // family of bug as resolveHomeUrl's /home/home/home regression.
    setBaseHref(null);
    history.pushState({}, '', '/ai/support_agent/conv_123');
    expect(resolvePublicShareBase()).toBe(`${window.location.origin}/s`);
  });

  it('carries a non-default port and scheme through unchanged', () => {
    setBaseHref('/_console/');
    const url = new URL(resolvePublicShareBase()!);
    expect(url.origin).toBe(window.location.origin);
    // Regression the resolver family exists for: `${origin}${BASE_URL}` with a
    // relative Vite base produced a trailing-dot host in production.
    expect(url.hostname.endsWith('.')).toBe(false);
    expect(url.pathname).toBe('/_console/s');
  });

  it('returns undefined with no DOM instead of guessing an origin', () => {
    // ShareDialog then applies its own fallback. A string built here without a
    // window would be a link to a host that does not exist.
    setBaseHref('/_console/');
    vi.stubGlobal('window', undefined);
    expect(resolvePublicShareBase()).toBeUndefined();
  });
});

/**
 * The structural half. The behavioural cases above cannot tell "routes through
 * the shared resolver" from "hand-rolls the same answer correctly" — which is
 * the entire subject of this card, and what the next copy will look like.
 */
describe('objectui#4482 — app-shell reads <base href> in exactly one place', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const srcRoot = path.resolve(here, '../../..');
  const RESOLVER = path.join(srcRoot, 'console/organizations/resolveHomeUrl.ts');
  const BASE_TAG_READ = /(querySelector|querySelectorAll|getElementsByTagName)\(\s*['"`]base['"`]\s*\)/;

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      // Tests legitimately create and clear <base> elements — including this
      // file, which must not fence itself out of existence.
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  const files = walk(srcRoot);

  it('is reading the real tree, not an empty one', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain(RESOLVER);
  });

  it('no app-shell file outside the resolver reads the <base> tag', () => {
    const offenders = files.filter(
      (f) => f !== RESOLVER && BASE_TAG_READ.test(readFileSync(f, 'utf8')),
    );
    expect(offenders.map((f) => path.relative(srcRoot, f))).toEqual([]);
  });

  it('the scan can see a hand-rolled read (it is not a regex that never matches)', () => {
    // Without this the case above would pass just as well spelled wrong. This
    // is the exact line deleted from AiChatPage.
    expect(BASE_TAG_READ.test("document.querySelector('base')?.getAttribute('href')")).toBe(true);
    expect(BASE_TAG_READ.test(readFileSync(RESOLVER, 'utf8'))).toBe(true);
  });
});
