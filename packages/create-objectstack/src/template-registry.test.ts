// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// The catalog is a user-facing advertisement, not just a lookup table: whatever
// is in it is printed by `--help` and by the `Available:` line on a bad `-t`.
// GA 17.0.0 shipped five remote content templates in it that had been delisted
// from the marketplace and left unmaintained — so the CLI recommended, by name
// and with marketing copy, five templates whose first `npm run build` exits 2.
// These tests pin both halves of the fix: the catalog no longer offers them,
// and typing one still gets an explanation rather than a bare "unknown".

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TEMPLATES,
  RETIRED_TEMPLATES,
  lookupTemplate,
  templateNames,
} from './template-registry.js';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('template catalog', () => {
  it('offers exactly the bundled blank template', () => {
    expect(templateNames()).toEqual(['blank']);
    expect(TEMPLATES.blank.source).toEqual({ kind: 'bundled', dir: 'blank' });
  });

  // The defect this card fixes, stated as the invariant that would have caught
  // it: nothing retired may appear in the catalog, because the catalog IS the
  // help text. Independent of the exact name list above.
  it('never advertises a retired template', () => {
    for (const retired of RETIRED_TEMPLATES) {
      expect(
        templateNames(),
        `"${retired}" is retired but still in TEMPLATES — \`--help\` would recommend it`,
      ).not.toContain(retired);
    }
  });

  it('describes every template it does offer', () => {
    for (const [name, info] of Object.entries(TEMPLATES)) {
      expect(info.description.trim(), `${name} has no description`).not.toBe('');
    }
  });
});

describe('lookupTemplate', () => {
  it('resolves a catalog name to its template', () => {
    const found = lookupTemplate('blank');
    expect(found).toMatchObject({ kind: 'found', name: 'blank' });
    expect(found.kind === 'found' && found.template).toBe(TEMPLATES.blank);
  });

  // Each of the five by name: a returning user with `-t todo` in a script or an
  // old tutorial must be told the template was retired, not that they typo'd.
  it.each([...RETIRED_TEMPLATES])('reports %s as retired, not unknown', (name) => {
    expect(lookupTemplate(name)).toEqual({ kind: 'retired', name });
  });

  it('still reports a name that never existed as unknown', () => {
    expect(lookupTemplate('bank')).toEqual({ kind: 'unknown', name: 'bank' });
    expect(lookupTemplate('')).toEqual({ kind: 'unknown', name: '' });
  });

  it('keeps the offered and retired sets disjoint', () => {
    const overlap = templateNames().filter((n) => RETIRED_TEMPLATES.includes(n));
    expect(
      overlap,
      'a name cannot be both scaffoldable and retired — lookupTemplate would ' +
        'silently prefer the catalog and the refusal would never fire',
    ).toEqual([]);
  });
});

// Wiring pins, not behaviour claims: these read index.ts as text because
// importing it runs the CLI. They exist because a correct registry that the CLI
// does not consult is exactly the shape of a phantom fix — the refusal branch
// would be unreachable and every test above would still pass.
describe('the CLI consults the registry', () => {
  // Line comments stripped: these assertions are about what the CLI *does*, and
  // the comments legitimately quote the wording being asserted against (the
  // retired branch explains why it does not print "Unknown template").
  const source = fs
    .readFileSync(path.join(pkgRoot, 'src', 'index.ts'), 'utf8')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  it('resolves -t through lookupTemplate rather than indexing the catalog', () => {
    expect(source).toContain('lookupTemplate(options.template)');
    expect(
      source,
      'a direct TEMPLATES[...] lookup bypasses the retired branch',
    ).not.toMatch(/TEMPLATES\[/);
  });

  it('builds both user-facing template lists from the catalog', () => {
    // `--help` and the `Available:` line, neither hand-maintained.
    expect(
      [...source.matchAll(/templateNames\(\)\.join\(', '\)/g)],
      'the help text and the Available: line must both derive from templateNames()',
    ).toHaveLength(2);
  });

  it('explains the retirement instead of printing the generic error', () => {
    const branch = /lookup\.kind === 'retired'[\s\S]*?\} else \{/.exec(source)?.[0] ?? '';
    expect(branch, 'no retired branch found in the CLI').not.toBe('');
    expect(branch).toMatch(/retired/i);
    expect(branch).toMatch(/no longer maintained/i);
    expect(branch, 'the retired branch must not fall back to the typo wording').not.toMatch(
      /Unknown template/,
    );
  });
});
