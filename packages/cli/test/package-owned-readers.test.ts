// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22288 — the in-process readers that took a multi-package config's
 * package-owned keys off its top level, pinned against the REAL producer:
 * `composeStacks([a, b], { manifest: 'preserve' })`, whose top level carries
 * none of them (ADR-0130 D4, 2026-09-22 addendum). Each case pairs the
 * two-package shape with the same definitions in ONE `defineStack`, which is
 * what makes it a pin: a reader that refused every `packages[]` stack would
 * satisfy a lone two-package case, and the control holds the one-package answer
 * unchanged.
 *
 * Measured through the doors on `6729e107`, before the fix:
 *
 *     two packages                                  one package (control)
 *     os generate flow   "It will not run yet: …    no warning
 *                        does not require 'automation', 'triggers'"
 *     os generate types  no record interfaces       one per object
 *     os generate migration --format sql  no CREATE TABLE   one per object
 *
 * The readers are called directly (they are what those doors call), so this
 * file needs no spawn and stays in the unit tier. The commands whose fold sits
 * inside `run()` (`os doctor`, `os diff`, `os migrate meta`) are pinned through
 * the door in `package-owned-command-readers.test.ts`; `os serve`'s in
 * `serve-package-declared-capabilities.test.ts`; `os migrate plan`'s in
 * `src/utils/schema-migrate.requires-providers.integration.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { composeStacks, defineStack } from '@objectstack/spec';

import { stackDeclaredCapabilities } from '../src/utils/stack-collections.js';
import { declaredCapabilities, missingCapabilities } from '../src/utils/scaffold-wiring.js';
import { generateMigrationSql, generateMigrationTs, generateTypesFromConfig } from '../src/commands/generate.js';

const svcManifest = { id: 'com.example.por.svc', name: 'POR Service', namespace: 'por', version: '1.0.0', type: 'module' };
const appManifest = { id: 'com.example.por.app', name: 'POR App', namespace: 'por', version: '1.0.0', type: 'app' };
const note = {
  name: 'por_note', label: 'Note', pluralLabel: 'Notes', sharingModel: 'private',
  fields: { name: { name: 'name', type: 'text', label: 'Name', required: true } },
};
const ticket = {
  name: 'por_ticket', label: 'Ticket', pluralLabel: 'Tickets', sharingModel: 'private',
  fields: { title: { name: 'title', type: 'text', label: 'Title', required: true } },
};

type Bag = Record<string, unknown>;

/** The two-package shape: `svcExtra` on the service package, `appExtra` on the app package. */
function twoPackages(svcExtra: Bag = {}, appExtra: Bag = {}): Bag {
  const svc = defineStack({ manifest: svcManifest, objects: [note], ...svcExtra } as never);
  const app = defineStack({ manifest: appManifest, objects: [ticket], ...appExtra } as never);
  return composeStacks([svc, app], { manifest: 'preserve' }) as unknown as Bag;
}

/** The same definitions in one `defineStack`. */
function onePackage(extra: Bag = {}): Bag {
  return defineStack({ manifest: appManifest, objects: [ticket, note], ...extra } as never) as unknown as Bag;
}

describe('the shape these pins depend on (anti-vacuity control)', () => {
  it('a two-package `preserve` stack carries `requires` and `objects` in its bodies, not at its top level', () => {
    const stack = twoPackages({ requires: ['automation'] });
    expect(stack.requires).toBeUndefined();
    expect(stack.objects).toBeUndefined();
    expect(Array.isArray(stack.packages)).toBe(true);
  });
});

describe('stackDeclaredCapabilities — the one `requires` reader `os serve`, `os migrate` and `os generate` share', () => {
  it('two packages: each body\'s tokens, in package order', () => {
    const stack = twoPackages({ requires: ['automation'] }, { requires: ['triggers', 'automation'] });
    expect(stackDeclaredCapabilities(stack)).toEqual(['automation', 'triggers', 'automation']);
  });

  it('control, one package: its top-level list, unchanged', () => {
    expect(stackDeclaredCapabilities(onePackage({ requires: ['automation', 'triggers'] })))
      .toEqual(['automation', 'triggers']);
    expect(stackDeclaredCapabilities(onePackage())).toEqual([]);
  });

  it('a top-level `requires` wins over the bodies (the additive shape already carries the union there)', () => {
    const stack = { ...twoPackages({ requires: ['automation'] }), requires: ['ai'] };
    expect(stackDeclaredCapabilities(stack)).toEqual(['ai']);
  });
});

describe('os generate — the missing-capability hint reads what a server mounts', () => {
  const FLOW_NEEDS = ['automation', 'triggers'];

  it('two packages: a token a package declares is not reported missing', () => {
    const stack = twoPackages({}, { requires: ['automation', 'triggers'] });
    expect(missingCapabilities(stack, FLOW_NEEDS)).toEqual([]);
    expect(declaredCapabilities(stack)).toEqual(['automation', 'triggers']);
  });

  it('two packages: a token no package declares still is, and a stack declaring none answers null', () => {
    expect(missingCapabilities(twoPackages({ requires: ['automation'] }), FLOW_NEEDS)).toEqual(['triggers']);
    expect(declaredCapabilities(twoPackages())).toBeNull();
    expect(missingCapabilities(twoPackages(), FLOW_NEEDS)).toEqual(FLOW_NEEDS);
  });

  it('control, one package: unchanged', () => {
    expect(missingCapabilities(onePackage({ requires: ['automation', 'triggers'] }), FLOW_NEEDS)).toEqual([]);
    expect(missingCapabilities(onePackage({ requires: ['automation'] }), FLOW_NEEDS)).toEqual(['triggers']);
    expect(declaredCapabilities(onePackage({ requires: [] }))).toEqual([]);
    expect(declaredCapabilities(onePackage())).toBeNull();
  });
});

describe('os generate types / migration — the objects a package declares are emitted', () => {
  /** The generated text with its timestamp line removed. */
  const stable = (text: string) => text.split('\n').filter((line) => !/Generated at /.test(line)).join('\n');

  it('types: one record interface per object, in both shapes', () => {
    for (const stack of [twoPackages(), onePackage()]) {
      const out = generateTypesFromConfig(stack);
      expect(out).toMatch(/export interface PorNoteRecord \{/);
      expect(out).toMatch(/export interface PorTicketRecord \{/);
    }
  });

  it('migration (sql and ts): one table per object, in both shapes', () => {
    for (const stack of [twoPackages(), onePackage()]) {
      const sql = generateMigrationSql(stack);
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "por_note"');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "por_ticket"');
      const ts = stable(generateMigrationTs(stack));
      expect(ts).toContain('por_note');
      expect(ts).toContain('por_ticket');
    }
  });
});
