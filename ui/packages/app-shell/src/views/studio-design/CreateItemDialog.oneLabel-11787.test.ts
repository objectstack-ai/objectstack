// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11787 — Studio's create dialogs say one thing: *Save as draft*.
 *
 * Every `CreateItemDialog` in Studio writes a draft (an app, a page, a
 * dashboard, a report, an object, a flow, a permission set), so the submit
 * button names that one act with one string, `engine.studio.createDraft`. The
 * QA pass that filed the card found *New permission set* alone saying
 * *Create*.
 *
 * The call sites are ENUMERATED from this package's source, not listed here
 * (AGENTS.md #9): a dialog added later is asked the same question, and the
 * control below proves the enumeration reaches the site this card changed.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../../scripts/js-comment-mask.mjs';

const mask: (source: string) => string = maskComments;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const SRC = path.join(repoRoot, 'packages/app-shell/src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith('.tsx') && !/\.test\.tsx$/.test(full)) out.push(full);
  }
  return out;
}

/** One rendered `<CreateItemDialog …>`: its file, its submit label, and the props text around it. */
interface Site {
  file: string;
  submitLabel: string | undefined;
  props: string;
}

function createDialogSites(): Site[] {
  const sites: Site[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = mask(readFileSync(file, 'utf8'));
    // `submitLabel` is a required prop, so the first one after the tag is the tag's own.
    for (const props of source.split('<CreateItemDialog').slice(1)) {
      sites.push({
        file: path.relative(repoRoot, file),
        submitLabel: props.match(/submitLabel=\{([^}]*)\}/)?.[1],
        props,
      });
    }
  }
  return sites;
}

const ONE_LABEL = "t('engine.studio.createDraft', locale)";

describe('Studio create dialogs carry one label (objectui#11787)', () => {
  it('every CreateItemDialog submits as "Save as draft"', () => {
    const sites = createDialogSites();
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      expect({ file: site.file, submitLabel: site.submitLabel }).toEqual({ file: site.file, submitLabel: ONE_LABEL });
    }
  });

  it('CONTROL — the enumeration reaches the New permission set dialog, the one that said "Create"', () => {
    const access = createDialogSites().filter((site) => /title=\{t\('engine\.studio\.access\.new'/.test(site.props));
    expect(access).toHaveLength(1);
    expect(access[0].submitLabel).toBe(ONE_LABEL);
  });
});
