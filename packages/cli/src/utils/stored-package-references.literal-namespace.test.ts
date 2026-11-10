// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, child G1; D10] The upgrade report names each installed package
 * whose namespace spells an address literal: the package the boot keeps with
 * one warning, which the install door refuses afterwards. Over the real
 * `SchemaRegistry`: a package installed during the cold boot (never sealed
 * yet) is HELD, so it is in the report; the row carries the install door's own
 * sentence (`validateNamespaceNotAddressLiteral`), verbatim.
 *
 * No stored table is carried by this registry, so the report reads no row and
 * the engine is never asked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { validateNamespaceNotAddressLiteral } from '@objectstack/spec/kernel';
import { collectStoredPackageReferences, type StoredReferenceRegistry } from './stored-package-references.js';

const HOOKS = 'com.acme.hooks';
const TRIGGERS = 'com.acme.triggers';

const manifest = (id: string, namespace: string) =>
  ({ id, name: id, version: '1.0.0', type: 'app', namespace }) as never;

/** The engine is never reached: no stored table is carried. */
const NO_ENGINE = {} as never;

let registry: SchemaRegistry;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  registry = new SchemaRegistry({ multiTenant: false });
});

afterEach(() => {
  warn.mockRestore();
});

const report = () => collectStoredPackageReferences(NO_ENGINE, registry as unknown as StoredReferenceRegistry);

describe('the upgrade report names an installed package under an address-literal namespace', () => {
  it('THE PIN: a held `hooks` package is named with its id, the literal and the install door\'s sentence', async () => {
    // The cold boot re-registers what an earlier release installed (source
    // `marketplace`): both are kept, the `hooks` one with a warning. A package
    // the deployment's own code ships (`code`) is held the same way.
    registry.installPackage(manifest(HOOKS, 'hooks'), 'marketplace');
    registry.installPackage(manifest(TRIGGERS, 'triggers'), 'marketplace');
    registry.sealBareNameHolders();

    const answer = await report();
    expect(answer.literalNamespaces).toEqual([
      { packageId: HOOKS, namespace: 'hooks', message: validateNamespaceNotAddressLiteral('hooks') },
    ]);
    // The other sections are untouched by it.
    expect(answer.stored).toEqual([]);
    expect(answer.picklists).toEqual([]);
    expect(answer.sealedClashes).toEqual([]);
  });

  it('CONTROL: a deployment whose packages spell no literal (`triggers`) reports none', async () => {
    registry.installPackage(manifest(TRIGGERS, 'triggers'), 'marketplace');
    registry.sealBareNameHolders();
    expect((await report()).literalNamespaces).toEqual([]);
  });

  it('CONTROL: a new `hooks` package after the seal is refused at install, so the report never holds it', async () => {
    registry.sealBareNameHolders();
    expect(() => registry.installPackage(manifest(HOOKS, 'hooks'), 'marketplace')).toThrow(
      expect.objectContaining({ code: 'NAMESPACE_CONFLICT', status: 422 }),
    );
    expect((await report()).literalNamespaces).toEqual([]);
  });
});
