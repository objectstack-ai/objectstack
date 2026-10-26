/**
 * `resolveCtaHref` and the action runner share ONE navigation-target answer
 * (objectui#12191, ruling A+: "one symbol, two callers, no second list").
 *
 * Before this card the CTA admitted `mailto:` through its own scheme test and
 * the runner refused it through another, so a mail button the spec accepts
 * published cleanly and then failed at click. The fix is structural, so the
 * pins are too:
 *
 * 1. **One definition.** `classifyNavigationTarget` is defined in exactly one
 *    source file, in `@object-ui/core`.
 * 2. **Two callers, no second list.** This dialog imports it from
 *    `@object-ui/core`, and the runner imports it from its sibling module.
 *    Neither keeps a scheme test of its own.
 * 3. **The CTA agrees with it.** An http(s) target passes as-is in a new tab, a
 *    `mailto:` target passes as-is in place, and a refused target is never
 *    passed as-is.
 *
 * The runner's own pins (mailto in place, the refused set and its message, the
 * http(s) and path controls) are in
 * `packages/core/src/actions/__tests__/navigationTarget.mailto-12191.test.ts`.
 *
 * The scans read code with comments blanked by the shared mask, because a
 * docblock that names `mailto:` while explaining the rule is not a scheme list.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyNavigationTarget } from '@object-ui/core';
import { resolveCtaHref } from '../EnvironmentEntitlementDialog';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');

const DEFINITION = 'packages/core/src/actions/navigationTarget.ts';
const RUNNER = 'packages/core/src/actions/ActionRunner.ts';
const DIALOG = 'packages/app-shell/src/environment/EnvironmentEntitlementDialog.tsx';

const code = (rel: string) => mask(readFileSync(path.join(repoRoot, rel), 'utf8'));

/** Every non-test `.ts` / `.tsx` source under `packages/PKG/src`, repo-relative. */
function packageSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') continue;
        walk(rel);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        out.push(rel);
      }
    }
  };
  for (const pkg of readdirSync(path.join(repoRoot, 'packages'), { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const src = path.join(repoRoot, 'packages', pkg.name, 'src');
    try {
      readdirSync(src);
    } catch {
      continue;
    }
    walk(`packages/${pkg.name}/src`);
  }
  return out;
}

/** A binding of the name in code: a function, a const/let/var, or a class. */
const DEFINES = /\b(?:function|const|let|var|class)\s+classifyNavigationTarget\b/;

/** A scheme test written in code: a `startsWith('scheme…')` or a regex anchored on one. */
const SCHEME_TEST = /startsWith\(\s*['"`](?:https?|mailto|tel|javascript|data)\b|\/\^\(?\??:?(?:https|http|mailto|tel)/i;

describe('one definition of classifyNavigationTarget (objectui#12191)', () => {
  it('is defined in exactly one source file, in @object-ui/core', () => {
    const sources = packageSources();
    // Population control: the walk reached the tree, and it reached the two callers.
    expect(sources.length).toBeGreaterThan(500);
    expect(sources).toContain(RUNNER);
    expect(sources).toContain(DIALOG);

    const definers = sources.filter((rel) => DEFINES.test(code(rel)));
    expect(definers).toEqual([DEFINITION]);
  });

  it('the dialog imports it from @object-ui/core and keeps no scheme test of its own', () => {
    const dialog = code(DIALOG);
    expect(dialog).toMatch(/import\s*\{[^}]*\bclassifyNavigationTarget\b[^}]*\}\s*from\s*'@object-ui\/core'/);
    expect(dialog).not.toMatch(SCHEME_TEST);
    // Not even a literal: the dialog's code names no scheme at all.
    expect(dialog).not.toMatch(/mailto:|https?:/i);
  });

  it('the runner imports it from its sibling module and keeps no scheme test of its own', () => {
    const runner = code(RUNNER);
    expect(runner).toMatch(/import\s*\{[^}]*\bclassifyNavigationTarget\b[^}]*\}\s*from\s*'\.\/navigationTarget\.js'/);
    expect(runner).not.toMatch(SCHEME_TEST);
    expect(runner).not.toMatch(/\bisValidUrl\b/);
  });

  it('CONTROL: the scheme-test pattern finds the definition it guards', () => {
    // Without this, a pattern that matches nothing would pass the two tests above.
    expect(code(DEFINITION)).toMatch(SCHEME_TEST);
  });
});

describe('resolveCtaHref agrees with the shared answer (objectui#12191)', () => {
  const BASE = 'https://cp.example.com';

  it.each(['https://x.com/p', 'HTTP://X.COM/p'])('passes the web target %s as-is, in a new tab', (url) => {
    expect(classifyNavigationTarget(url)).toBe('web');
    expect(resolveCtaHref(url, BASE)).toEqual({ href: url, external: true });
    expect(resolveCtaHref(url, '')).toEqual({ href: url, external: true });
  });

  it.each(['mailto:sales@objectos.ai', 'MAILTO:sales@objectos.ai'])('passes the mail target %s as-is, in place', (url) => {
    expect(classifyNavigationTarget(url)).toBe('mail');
    expect(resolveCtaHref(url, BASE)).toEqual({ href: url, external: false });
    expect(resolveCtaHref(url, '')).toEqual({ href: url, external: false });
  });

  it('CONTROL: an in-app path is control-plane-relative, as before', () => {
    expect(resolveCtaHref('/settings/billing', BASE)).toEqual({ href: `${BASE}/settings/billing`, external: true });
    expect(resolveCtaHref('/settings/billing', '')).toEqual({ href: '/settings/billing', external: false });
  });

  it.each(['javascript:alert(1)', 'data:text/html,hi', '//evil.example/x', 'tel:+1'])(
    'never passes the refused target %s as-is',
    (url) => {
      expect(classifyNavigationTarget(url)).toBeNull();
      expect(resolveCtaHref(url, BASE).href).not.toBe(url);
    },
  );
});
