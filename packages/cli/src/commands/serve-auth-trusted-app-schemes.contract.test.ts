// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #29972 — `objectstack serve` hands the deployment's registered app schemes
// to AuthPlugin, from `OS_TRUSTED_APP_SCHEMES`.
//
// The mobile sign-in hand-off (`GET /api/v1/auth/one-time-token/handoff`)
// redirects a one-time token only to a scheme `AuthConfig.trustedAppSchemes`
// registers, and plugin-auth mounts the `one-time-token` plugin only when that
// list is non-empty. `serve` used to construct AuthPlugin with no
// `trustedAppSchemes` and nothing a deployment could set reached the key, so
// the hand-off refused every app (`400 … is not a registered app scheme`).
//
// Three halves. The reader half drives `resolveTrustedAppSchemes` over the
// shapes an operator types: unset stays unset (no default scheme), entries are
// trimmed, empties dropped and repeats folded the way `OS_TRUSTED_ORIGINS` is
// read, and nothing is validated or dropped. The refusal half hands what the
// reader answers for a bad entry to a real `AuthManager` (what AuthPlugin
// builds at init) and shows the boot still fails loudly, naming the entry. The
// construction half scans `serve.ts` with comments masked, as the sibling
// `serve-auth-*.contract.test.ts` files do: AuthPlugin is imported through a
// variable specifier, so the type checker cannot see the literal.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthManager } from '@objectstack/plugin-auth';
import { resolveTrustedAppSchemes, TRUSTED_APP_SCHEMES_ENV_NAME } from './serve.js';
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVE_SOURCE = maskComments(readFileSync(path.resolve(HERE, 'serve.ts'), 'utf8'));
const ENV_DOC = readFileSync(
  path.resolve(HERE, '../../../../content/docs/deployment/environment-variables.mdx'),
  'utf8',
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
const env = (value?: string): NodeJS.ProcessEnv =>
  value === undefined ? {} : { [TRUSTED_APP_SCHEMES_ENV_NAME]: value };

const managerWith = (trustedAppSchemes: string[] | undefined) =>
  new AuthManager({
    secret: 'a-test-secret-that-is-at-least-32-chars-long',
    baseUrl: 'http://localhost:3000',
    trustedAppSchemes,
  } as any);

describe('resolveTrustedAppSchemes reads OS_TRUSTED_APP_SCHEMES', () => {
  it('reads the variable named OS_TRUSTED_APP_SCHEMES', () => {
    expect(TRUSTED_APP_SCHEMES_ENV_NAME).toBe('OS_TRUSTED_APP_SCHEMES');
  });

  it('unset stays unset: no default scheme', () => {
    expect(resolveTrustedAppSchemes(env())).toBeUndefined();
  });

  it('set but empty, or only separators and spaces, registers nothing', () => {
    for (const value of ['', '   ', ',', ' , ,, ']) {
      expect(resolveTrustedAppSchemes(env(value)), JSON.stringify(value)).toBeUndefined();
    }
  });

  it('one scheme', () => {
    expect(resolveTrustedAppSchemes(env('ai.objectos.mobile'))).toEqual(['ai.objectos.mobile']);
  });

  it('trims entries, drops empties and folds repeats, in the order typed', () => {
    expect(
      resolveTrustedAppSchemes(env(' ai.objectos.mobile , ,com.example.app,ai.objectos.mobile,  ')),
    ).toEqual(['ai.objectos.mobile', 'com.example.app']);
  });

  it('passes a bad entry through as typed: never validated, lower-cased or dropped here', () => {
    expect(resolveTrustedAppSchemes(env('ai.objectos.mobile, Https,AI.Objectos.Mobile'))).toEqual([
      'ai.objectos.mobile',
      'Https',
      'AI.Objectos.Mobile',
    ]);
  });
});

describe('what the reader answers is what AuthManager registers or refuses', () => {
  it('a set variable registers its schemes', () => {
    const manager = managerWith(resolveTrustedAppSchemes(env('ai.objectos.mobile, com.example.app')));
    expect(manager.getRegisteredAppSchemes()).toEqual(['ai.objectos.mobile', 'com.example.app']);
  });

  it('an unset variable registers none', () => {
    expect(managerWith(resolveTrustedAppSchemes(env())).getRegisteredAppSchemes()).toEqual([]);
  });

  it('a bad entry fails construction loudly, naming the entry', () => {
    expect(() => managerWith(resolveTrustedAppSchemes(env('ai.objectos.mobile,myapp')))).toThrow(
      /invalid trustedAppSchemes: "myapp"/,
    );
  });
});

describe('serve constructs AuthPlugin with the schemes OS_TRUSTED_APP_SCHEMES names', () => {
  it('passes trustedAppSchemes from resolveTrustedAppSchemes(process.env)', () => {
    const constructions = authPluginConstructions(SERVE_SOURCE);
    // Absence must be loud: a scan that finds no construction proves nothing.
    expect(constructions.length, 'serve.ts must construct AuthPlugin exactly once').toBe(1);
    expect(normalise(constructions[0])).toContain('trustedAppSchemes:resolveTrustedAppSchemes(process.env),');
  });

  it('reads the variable nowhere else in serve.ts', () => {
    // One reader: a second `process.env.OS_TRUSTED_APP_SCHEMES` could disagree
    // with the one AuthPlugin is built from.
    expect(SERVE_SOURCE).not.toMatch(/process\.env\.OS_TRUSTED_APP_SCHEMES|\['OS_TRUSTED_APP_SCHEMES'\]/);
  });

  it('is listed in the environment-variables reference next to OS_TRUSTED_ORIGINS', () => {
    const rows = ENV_DOC.split('\n');
    const origins = rows.findIndex((row) => row.startsWith('| `OS_TRUSTED_ORIGINS` |'));
    expect(origins, 'the OS_TRUSTED_ORIGINS row').toBeGreaterThan(-1);
    expect(rows[origins + 1]).toMatch(/^\| `OS_TRUSTED_APP_SCHEMES` \| csv \|/);
  });
});
