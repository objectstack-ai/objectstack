// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #25777 — `objectstack serve` constructs `AuthPlugin` itself, so it is what
// hands the stack's `demoStaff` to the plugin that provisions them. The list is
// read off the definition this process LOADED (`config`), never off the
// artifact: `os build` writes no `demoStaff` into one
// (`test/build-demo-staff-artifact.test.ts`), so a boot of a built artifact
// has none to hand over, and a development boot of the authored config does.
//
// Read from `serve.ts` with comments masked, as
// `serve-auth-organization-record-page.contract.test.ts` reads it: `AuthPlugin`
// is imported through a variable specifier, so the type checker cannot see the
// literal. What the plugin does with the list is
// `plugin-auth/src/demo-staff-provisioning.test.ts`, over a real kernel.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

const SERVE_SOURCE = maskComments(
  readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'serve.ts'), 'utf8'),
);

/** The argument text of every `new AuthPlugin(` call. */
function authPluginConstructions(source: string): string[] {
  const out: string[] = [];
  const needle = 'new AuthPlugin(';
  for (let i = source.indexOf(needle); i !== -1; i = source.indexOf(needle, i + 1)) {
    const open = i + needle.length - 1;
    let depth = 0;
    for (let j = open; j < source.length; j++) {
      if (source[j] === '(') depth++;
      else if (source[j] === ')' && --depth === 0) {
        out.push(source.slice(open + 1, j));
        break;
      }
    }
  }
  return out;
}

const normalise = (text: string) => text.replace(/\s+/g, '');

describe('serve hands the loaded definition`s demoStaff to AuthPlugin', () => {
  it('passes `demoStaff` from `config`, and only an array', () => {
    const constructions = authPluginConstructions(SERVE_SOURCE);
    // Absence must be loud: a scan that finds no construction proves nothing.
    expect(constructions.length, 'serve.ts must construct AuthPlugin exactly once').toBe(1);
    expect(normalise(constructions[0])).toContain(
      'demoStaff:Array.isArray((configasany).demoStaff)?(configasany).demoStaff:undefined',
    );
  });
});
