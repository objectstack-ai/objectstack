// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11787 — Studio's create dialogs say what the create does, in one
 * word per act.
 *
 * objectstack#36511 — the editors whose Save is live (an object, an
 * automation, a permission set) create the item live: their dialogs say
 * *Create* (`engine.studio.createLive`). Every other `CreateItemDialog` in
 * Studio writes a draft (an app, a page, a dashboard, a report, a dataset) and
 * says *Save as draft* (`engine.studio.createDraft`). The QA pass that filed
 * objectui#11787 found *New permission set* alone saying *Create*, while every
 * dialog wrote a draft.
 *
 * The call sites are ENUMERATED from this package's source, not listed here
 * (AGENTS.md #9): a dialog added later is asked the same question, and the
 * controls below prove the enumeration reaches the sites of each label.
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

const DRAFT_LABEL = "t('engine.studio.createDraft', locale)";
const LIVE_LABEL = "t('engine.studio.createLive', locale)";

/**
 * The dialogs of the live editors, by their title key (objectstack#36511).
 * objectstack#36905 — the Access pillar's went with the pillar: a permission
 * set is created from its type's list.
 */
const LIVE_TITLES = ['engine.studio.data.newObject', 'engine.studio.auto.newTitle'];

const titleKeyOf = (site: Site): string | undefined => site.props.match(/title=\{t\('([^']+)'/)?.[1];

describe('Studio create dialogs say what the create does (objectui#11787, objectstack#36511)', () => {
  it('a live editor\'s dialog says "Create"; every other one says "Save as draft"', () => {
    const sites = createDialogSites();
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      const expected = LIVE_TITLES.includes(titleKeyOf(site) ?? '') ? LIVE_LABEL : DRAFT_LABEL;
      expect({ file: site.file, submitLabel: site.submitLabel }).toEqual({ file: site.file, submitLabel: expected });
    }
  });

  it('CONTROL — the enumeration reaches each live dialog, the New permission set one included', () => {
    const live = createDialogSites().filter((site) => LIVE_TITLES.includes(titleKeyOf(site) ?? ''));
    // An object and a flow are created from their pillar AND from the metadata
    // list (objectstack#36897, `MetadataListCreateDialog.tsx`): each title is
    // reached, by one site or more.
    expect([...new Set(live.map(titleKeyOf))].sort()).toEqual([...LIVE_TITLES].sort());
    for (const site of live) expect(site.submitLabel).toBe(LIVE_LABEL);
  });

  it('CONTROL — the enumeration reaches draft dialogs too', () => {
    const drafts = createDialogSites().filter((site) => !LIVE_TITLES.includes(titleKeyOf(site) ?? ''));
    expect(drafts.length).toBeGreaterThan(0);
    for (const site of drafts) expect(site.submitLabel).toBe(DRAFT_LABEL);
  });
});
