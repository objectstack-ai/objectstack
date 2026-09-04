// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `plugin` template's SHAPE against what the docs promise (#14824).
 *
 * ## Why this pin exists
 *
 * `os create plugin <name>` is shown on three public pages, and each of them
 * prints the file tree the reader is told to expect — a tutorial's whole value
 * is that the listing matches what appears on disk. `test/create.test.ts` pins
 * what the template EMITS and `test/scaffold-manifest-schema.test.ts` pins that
 * what it emits LOADS, but neither can fail when the docs and the template
 * disagree, and the `plugin` template is the one `ManifestSchema` does not
 * govern at all (it emits no `objectstack.config.ts`). So the docs were the
 * only statement of its shape, and nothing held them to it.
 *
 * The maintainer's ruling on #14824 is that a documented developer-facing
 * command must work for the developer who follows the docs. This file is the
 * half of that which no install can check: that the listing the developer READS
 * is the listing they GET.
 *
 * ## Both sides are derived
 *
 * The expected set comes from `templates.plugin.files` — the default (standalone)
 * emission, which is what a reader of these pages runs. The actual set is
 * harvested from the fenced blocks that contain the `os create plugin` command,
 * by file-extension shape rather than by a transcription of today's tree. So a
 * template that grows a file reddens all three pages until they say so, and a
 * page that invents a file reddens too.
 *
 * ⛔ Never satisfy a red here by deleting the listing from a page. The listing
 * is the promise; the point is to keep it true.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { templates } from '../src/commands/create.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');

// One `resolve(HERE, …)` call per line and nothing split across lines:
// `check:cross-package-test-inputs` reconstructs these reads by SOURCE SCAN,
// and a spelling it cannot parse leaves the glob declared and held by nothing.
// All three are declared for `@objectstack/cli` in
// scripts/cross-package-test-inputs.mjs and mirrored into turbo.json.
const PLUGINS_INDEX = resolve(HERE, '../../..', 'content/docs/plugins/index.mdx');
const KERNEL_INDEX = resolve(HERE, '../../..', 'content/docs/protocol/kernel/index.mdx');
const PLUGIN_SPEC = resolve(HERE, '../../..', 'content/docs/protocol/kernel/plugin-spec.mdx');

/** The pages that print a file tree for `os create plugin`. */
const DOC_SITES: Record<string, string> = {
  'content/docs/plugins/index.mdx': PLUGINS_INDEX,
  'content/docs/protocol/kernel/index.mdx': KERNEL_INDEX,
  'content/docs/protocol/kernel/plugin-spec.mdx': PLUGIN_SPEC,
};

/** Fenced code blocks whose body invokes `os create plugin`. */
function scaffoldFences(mdx: string): string[] {
  const fences = [...mdx.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1]);
  return fences.filter((body) => /^[^\n]*\bos create plugin\b/m.test(body));
}

/**
 * The file names a fence promises. Harvested by extension shape — the three
 * pages spell their trees three different ways (a box-drawing tree, an indented
 * listing, a CLI transcript), and the one thing all three share is that a file
 * is named with its extension.
 */
function promisedFiles(fence: string): Set<string> {
  const tokens = fence.match(/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:json|md|ts|yaml|yml)\b/g) ?? [];
  return new Set(tokens.map((t) => basename(t)));
}

/** What `os create plugin <name>` actually writes, by file name. */
const EMITTED = new Set(Object.keys(templates.plugin.files).map((p) => basename(p)));

describe('the `plugin` template emits what the docs promise', () => {
  it('emits something to compare, so an empty template cannot pass vacuously', () => {
    expect(EMITTED.size).toBeGreaterThan(0);
    expect([...EMITTED]).toContain('package.json');
  });

  it.each(Object.keys(DOC_SITES))('%s prints a scaffold listing', (site) => {
    const fences = scaffoldFences(readFileSync(DOC_SITES[site], 'utf8'));
    expect(
      fences.length,
      `${site} no longer shows an \`os create plugin\` block — the promise this pin holds is gone`,
    ).toBeGreaterThan(0);
    expect(promisedFiles(fences.join('\n')).size, `${site} names no files`).toBeGreaterThan(0);
  });

  it.each(Object.keys(DOC_SITES))('%s promises exactly the files the template writes', (site) => {
    const promised = promisedFiles(scaffoldFences(readFileSync(DOC_SITES[site], 'utf8')).join('\n'));
    const missing = [...EMITTED].filter((f) => !promised.has(f)).sort();
    const invented = [...promised].filter((f) => !EMITTED.has(f)).sort();
    expect(
      { missing, invented },
      `${site} disagrees with the \`plugin\` template:\n`
        + `  emitted but NOT documented: ${missing.join(', ') || '(none)'}\n`
        + `  documented but NOT emitted: ${invented.join(', ') || '(none)'}`,
    ).toEqual({ missing: [], invented: [] });
  });
});
