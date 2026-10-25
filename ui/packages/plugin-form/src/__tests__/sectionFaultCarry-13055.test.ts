/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13055 — the fault direction of a field group's `visibleWhen`
 * travels WITH the predicate, from the derivation that stamps it to the row the
 * form renderer evaluates.
 *
 * `deriveFieldGroupSections` stamps `visibleWhenFault: 'hidden'` beside a
 * field group's predicate (`@objectstack/spec` declares
 * `ObjectFieldGroupSchema.visibleWhen` fail-closed), and nothing else does: an
 * authored form-view section's own `visibleWhen` faults OPEN. Every layout
 * between the two rebuilds the section KEY BY KEY, and a key a rebuild does not
 * copy is dropped without a sound — the failure that lost `visibleOn` (#6111)
 * and the section predicate on the tabbed route (#6237). So the carry is pinned
 * twice:
 *
 *  1. behaviourally, for the two ends — the stamp and `projectSectionDivider`;
 *  2. by ENUMERATION over every rebuild site, so a new arm that copies a
 *     section's `visibleWhen` without its `visibleWhenFault` goes red here
 *     instead of silently turning a group fail-open again.
 *
 * ## How the enumeration reads source
 *
 * It scans every non-test source file of this package plus the console's
 * `FormPage.tsx` (comments masked with the repo's shared
 * `scripts/js-comment-mask.mjs`) for a section predicate COPY — a line
 * `visibleWhen: RECV.visibleWhen,` (or `(RECV as any).visibleWhen`) — and
 * requires the next code line to be `visibleWhenFault: RECV.visibleWhenFault,`.
 * The receiver name tells a section copy from a field copy; an unclassified
 * receiver fails loudly so a new site is classified by a person, never guessed.
 * The per-file counts are the liveness half: a scanner that went blind would
 * read zero and fail them.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments as sharedMask } from '../../../../scripts/js-comment-mask.mjs';
import type { FormField } from '@object-ui/types';
import { deriveFieldGroupSections, projectSectionDivider } from '../fieldGroups';

/** Local annotation, since the import above is untyped -- the call site stays checked. */
const mask: (source: string) => string = sharedMask;

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_SRC = path.join(here, '..');
const REPO_ROOT = path.join(here, '..', '..', '..', '..');
const FORM_PAGE = path.join(REPO_ROOT, 'apps', 'console', 'src', 'components', 'FormPage.tsx');

/** Receivers that hold a SECTION (or a group/tab built from one). */
const SECTION_RECEIVERS = new Set(['s', 'section', 'sec', 'g']);
/** Receivers that hold a FIELD — a field's own `visibleWhen` is the fail-open triad. */
const FIELD_RECEIVERS = new Set(['field', 'override', 'def']);

/**
 * The section copy sites per file, as of this card. A site added or removed is
 * a deliberate edit here; the scan below is what re-derives the numbers.
 */
const EXPECTED_SECTION_SITES: Record<string, number> = {
  'packages/plugin-form/src/ObjectForm.tsx': 5,
  'packages/plugin-form/src/ModalForm.tsx': 4,
  'packages/plugin-form/src/DrawerForm.tsx': 2,
  'packages/plugin-form/src/SplitForm.tsx': 1,
  'packages/plugin-form/src/TabbedForm.tsx': 3,
  'apps/console/src/components/FormPage.tsx': 1,
};

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue;
      out.push(...listSources(full));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const COPY = /^(\s*)visibleWhen:\s*(?:\((\w+) as any\)|(\w+))\.visibleWhen,\s*$/;

interface Site {
  file: string;
  line: number;
  receiver: string;
  next: string;
}

function scan(file: string): Site[] {
  const lines = mask(readFileSync(file, 'utf8')).split('\n');
  const sites: Site[] = [];
  lines.forEach((text, i) => {
    const m = COPY.exec(text);
    if (!m) return;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    sites.push({
      file: path.relative(REPO_ROOT, file).split(path.sep).join('/'),
      line: i + 1,
      receiver: m[2] ?? m[3],
      next: (lines[j] ?? '').trim(),
    });
  });
  return sites;
}

const ALL_SITES = [...listSources(PKG_SRC), FORM_PAGE].flatMap(scan);

describe('objectui#13055 — the fault direction is stamped by the field-group derivation', () => {
  it("stamps 'hidden' beside a field group's visibleWhen", () => {
    const sections = deriveFieldGroupSections(
      [{ name: 'pro_seats', group: 'pro_details' } as unknown as FormField],
      [{ key: 'pro_details', label: 'Pro details', visibleWhen: "record.kind == 'pro'" }],
    );
    const pro = sections?.find((s) => s.name === 'pro_details');
    expect(pro?.visibleWhen).toBeDefined();
    expect(pro?.visibleWhenFault).toBe('hidden');
  });

  it('stamps nothing on a group that declares no predicate', () => {
    const sections = deriveFieldGroupSections(
      [{ name: 'email', group: 'contact' } as unknown as FormField],
      [{ key: 'contact', label: 'Contact' }],
    );
    const contact = sections?.find((s) => s.name === 'contact');
    expect(contact).toBeDefined();
    expect('visibleWhenFault' in (contact as object)).toBe(false);
  });

  it('projectSectionDivider carries the key unchanged onto both row shapes, and omits it when absent', () => {
    const titled = projectSectionDivider({
      key: 'pro',
      title: 'Pro details',
      visibleWhen: 'record.kind ==',
      visibleWhenFault: 'hidden',
      members: ['pro_seats'],
    });
    expect(titled).toHaveLength(1);
    expect(titled[0].visibleWhenFault).toBe('hidden');

    const gateOnly = projectSectionDivider({
      key: 'pro',
      visibleWhen: 'record.kind ==',
      visibleWhenFault: 'hidden',
      members: ['pro_seats'],
    });
    expect(gateOnly).toHaveLength(1);
    expect(gateOnly[0].visibleWhenFault).toBe('hidden');

    const unstamped = projectSectionDivider({
      key: 'sec',
      title: 'Section',
      visibleWhen: 'record.kind ==',
      members: ['x'],
    });
    expect('visibleWhenFault' in unstamped[0]).toBe(false);
  });
});

describe('objectui#13055 — every key-by-key rebuild carries visibleWhenFault beside visibleWhen', () => {
  it('every predicate-copy receiver is classified (section or field)', () => {
    const unclassified = ALL_SITES.filter(
      (s) => !SECTION_RECEIVERS.has(s.receiver) && !FIELD_RECEIVERS.has(s.receiver),
    );
    expect(
      unclassified.map((s) => `${s.file}:${s.line} receiver '${s.receiver}'`),
      'A new `visibleWhen: RECV.visibleWhen` copy site with an unknown receiver. If RECV holds a ' +
        'section (or a group/tab built from one), add it to SECTION_RECEIVERS and carry ' +
        '`visibleWhenFault: RECV.visibleWhenFault,` on the next line; if it holds a field, add it ' +
        'to FIELD_RECEIVERS.',
    ).toEqual([]);
  });

  it('every SECTION copy is followed by a visibleWhenFault copy from the same receiver', () => {
    const dropped = ALL_SITES.filter((s) => SECTION_RECEIVERS.has(s.receiver)).filter(
      (s) => !new RegExp(`^visibleWhenFault:\\s*${s.receiver}\\.visibleWhenFault,$`).test(s.next),
    );
    expect(
      dropped.map((s) => `${s.file}:${s.line} (${s.receiver}) next line: ${s.next}`),
      "A section rebuild copies `visibleWhen` without `visibleWhenFault`: a field group's " +
        'fail-closed predicate would silently fault OPEN on that arm (objectui#13055).',
    ).toEqual([]);
  });

  it('the scan is live: the section copy sites per file are the enumerated arms', () => {
    const counts: Record<string, number> = {};
    for (const s of ALL_SITES) {
      if (!SECTION_RECEIVERS.has(s.receiver)) continue;
      counts[s.file] = (counts[s.file] ?? 0) + 1;
    }
    expect(counts).toEqual(EXPECTED_SECTION_SITES);
  });
});
