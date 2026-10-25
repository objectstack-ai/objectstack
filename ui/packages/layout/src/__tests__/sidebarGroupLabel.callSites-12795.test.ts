/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12795 — every `SidebarGroupLabel` call site hides its label from
 * the tab order and the accessibility tree in icon mode.
 *
 * The primitive hides a label in the collapsed icon sidebar with `opacity-0`
 * and `-mt-8` only, which leaves it focusable (when it is a button) and
 * announced. The fix rides on each call site's `className`, because the
 * primitive is Shadcn-synced and never edited (AGENTS.md #7). So a NEW call
 * site would ship the defect again unless it carries the same classes: this
 * pin enumerates every `<SidebarGroupLabel` opening tag in `packages/` and
 * `apps/` source (the synced `ui/` copy and tests aside) and asserts each one
 * passes `HIDDEN_ICON_LABEL_NOT_FOCUSABLE`, declared in its own file with
 * exactly the variant-scoped `invisible` and `visibility` transition. The
 * variant is DERIVED from the primitive's own `…:opacity-0` token, so a
 * primitive that changes its hiding condition turns this red.
 *
 * The behaviour itself (Tab order, the accessibility tree, the CONTROL in the
 * expanded sidebar) is pinned through the real components by
 * `sidebarGroupLabel.iconModeFocus-12795.test.tsx` here and
 * `UnifiedSidebar.iconModeLabelFocus-12795.test.tsx` in `@object-ui/app-shell`.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

const PRIMITIVE = 'packages/components/src/ui/sidebar.tsx';
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.turbo', '.next', 'out', 'storybook-static', '__tests__']);
const CONSTANT = 'HIDDEN_ICON_LABEL_NOT_FOCUSABLE';

function sourceFiles(rel: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(repoRoot, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && child !== 'packages/components/src/ui') out.push(...sourceFiles(child));
    } else if (/\.(tsx?|jsx?|mts)$/.test(entry.name) && !/\.(test|spec|stories)\./.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(child);
    }
  }
  return out;
}

/** The text of each `<SidebarGroupLabel …>` opening tag, braces balanced so an `=>` inside a prop does not end it. */
function openingTags(source: string): string[] {
  const tags: string[] = [];
  const re = /<SidebarGroupLabel(?![\w$])/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    tags.push(source.slice(m.index, i + 1));
  }
  return tags;
}

/** The value of `const NAME = 'a' + 'b' …;` in `source`, string literals joined, or undefined. */
function constantValue(source: string, name: string): string | undefined {
  const decl = new RegExp(`const ${name}\\s*=\\s*((?:\\s*\\+?\\s*'[^']*')+)\\s*;`).exec(source);
  if (!decl) return undefined;
  return [...decl[1].matchAll(/'([^']*)'/g)].map((m) => m[1]).join('');
}

/** The icon-mode prefix the primitive hides a group label under, read off its `…:opacity-0` token. */
function primitiveHidingPrefix(): string {
  const source = readFileSync(path.join(repoRoot, PRIMITIVE), 'utf8');
  const start = source.indexOf('const SidebarGroupLabel');
  const end = source.indexOf('SidebarGroupLabel.displayName', start);
  expect(start, 'the primitive still declares SidebarGroupLabel').toBeGreaterThan(-1);
  const hide = source.slice(start, end).match(/[\w\-[\]=:]+:opacity-0(?![\w-])/);
  expect(hide, 'the primitive hides the label with a variant-scoped opacity-0').not.toBeNull();
  return hide![0].slice(0, -'opacity-0'.length);
}

const sources = [...sourceFiles('packages'), ...sourceFiles('apps')].map((file) => ({
  file,
  source: readFileSync(path.join(repoRoot, file), 'utf8'),
}));
const callSites = sources.filter(({ source }) => /<SidebarGroupLabel(?![\w$])/.test(source));

describe('every SidebarGroupLabel call site hides its label from focus and the accessibility tree in icon mode (objectui#12795)', () => {
  it('the enumeration finds the call sites it is known to cover (control)', () => {
    const files = callSites.map((c) => c.file);
    for (const known of [
      'packages/app-shell/src/layout/UnifiedSidebar.tsx',
      'packages/layout/src/NavigationRenderer.tsx',
      'packages/layout/src/AppSchemaRenderer.tsx',
      'packages/layout/src/SidebarNav.tsx',
    ]) {
      expect(files).toContain(known);
    }
  });

  it.each(callSites.map((c) => [c.file, c.source] as const))('%s: every opening tag passes the constant, declared with the primitive\'s own variant', (file, source) => {
    const prefix = primitiveHidingPrefix();
    expect(constantValue(source, CONSTANT)?.split(/\s+/), `${file} declares ${CONSTANT}`).toEqual([
      `${prefix}invisible`,
      `${prefix}transition-[margin,opacity,visibility]`,
    ]);

    const tags = openingTags(source);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag, `${file}: a SidebarGroupLabel without ${CONSTANT}`).toMatch(/\bclassName=\{[^]*\bHIDDEN_ICON_LABEL_NOT_FOCUSABLE\b[^]*\}/);
    }
  });

  it('no file renames the primitive on import, which would hide a call site from the enumeration', () => {
    for (const { file, source } of sources) {
      expect(source, file).not.toMatch(/\bSidebarGroupLabel\s+as\s+\w/);
    }
  });
});
