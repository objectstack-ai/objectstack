// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, child G1] `defineStack` WARNS, once per package and
 * namespace, about a namespace that spells a literal segment of the address
 * grammar (`actions`, `connectors`, `global`, `hooks`, `oauth`, `trigger`) —
 * its own manifest's or a `packages[]` body's — and still returns the stack.
 * It runs at every load of a config, the server's included, so a refusal here
 * would stop a deployment that already holds such a package from booting; the
 * refusal is the author's doors' (`os validate`, `os build`) and the install
 * door's. The warning carries the install door's own sentence
 * (`validateNamespaceNotAddressLiteral`), verbatim.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defineStack } from './stack.zod';
import { NAMESPACE_REFUSED_LITERALS, validateNamespaceNotAddressLiteral } from './kernel/address-grammar';

const object = (name: string) => ({ name, label: name, fields: { title: { type: 'text' as const } } });

/** A fresh package id per call, so the module's warn-once memory never hides a case. */
let serial = 0;
const fresh = (stem: string) => `com.x.${stem}${++serial}`;

const stack = (namespace: string, id = fresh('probe')) => ({
  manifest: { id, name: 'probe', version: '1.0.0', type: 'app' as const, namespace },
  objects: [object(`${namespace}_task`)],
});

const body = (id: string, namespace: string) => ({
  manifest: {
    id,
    name: id.split('.').pop()!,
    version: '1.0.0',
    type: 'module' as const,
    namespace,
    objects: [object(`${namespace}_item`)],
  },
});

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

const literalWarnings = () =>
  warn.mock.calls.map((c) => String(c[0])).filter((line) => line.includes('spells a literal segment of the address grammar'));

describe('defineStack — an address-literal namespace loads, with one warning', () => {
  it('the six literals are the ones this file pins', () => {
    expect([...NAMESPACE_REFUSED_LITERALS]).toEqual(['actions', 'connectors', 'global', 'hooks', 'oauth', 'trigger']);
  });

  it.each(NAMESPACE_REFUSED_LITERALS.map((literal) => [literal]))(
    'a stack whose manifest.namespace is `%s` is returned, and warned once in the install door\'s sentence',
    (literal) => {
      const id = fresh(literal);
      const built = defineStack(stack(literal, id));
      expect(built.manifest?.namespace).toBe(literal);
      const lines = literalWarnings();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(`package '${id}': ${validateNamespaceNotAddressLiteral(literal)}`);
      expect(lines[0]).toContain(`?package=${id}`);
      expect(lines[0]).toContain('`os validate` and `os build` refuse it');
    },
  );

  it('loading the same config again warns no second time', () => {
    const config = stack('hooks');
    defineStack(config);
    defineStack(config);
    expect(literalWarnings()).toHaveLength(1);
  });

  it('a packages[] body under a literal is warned, naming that body only', () => {
    const hooksId = fresh('hooks');
    defineStack({
      manifest: { id: fresh('release'), name: 'release', version: '1.0.0', type: 'app', namespace: 'crm' },
      packages: [body(fresh('alpha'), 'crm'), body(hooksId, 'hooks')],
    });
    const lines = literalWarnings();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`package '${hooksId}': ${validateNamespaceNotAddressLiteral('hooks')}`);
  });
});

describe('defineStack — what stays as it was', () => {
  it('CONTROL — `triggers` (a literal plus one letter) loads with no warning', () => {
    defineStack(stack('triggers'));
    expect(literalWarnings()).toEqual([]);
  });

  it('CONTROL — a packages[] body under `globals` loads with no warning', () => {
    defineStack({
      manifest: { id: fresh('release'), name: 'release', version: '1.0.0', type: 'app', namespace: 'crm' },
      packages: [body(fresh('alpha'), 'crm'), body(fresh('globals'), 'globals')],
    });
    expect(literalWarnings()).toEqual([]);
  });

  it('CONTROL — the namespace-prefix refusal still throws under a literal namespace', () => {
    expect(() => defineStack({
      manifest: { id: fresh('hooks'), name: 'probe', version: '1.0.0', type: 'app', namespace: 'hooks' },
      objects: [object('task')],
    })).toThrow(expect.objectContaining({ code: 'STACK_NAMESPACE_PREFIX_INVALID', status: 422 }));
  });
});
