// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #7314 — the third libSQL loader, and the two ways it disagreed with this one.
//
// #6268 converged the two HOST-injected loaders (CLI + standalone stack) onto
// `turso-driver-factory.ts`. A third arm it could not reach —
// `createDefaultDatasourceDriverFactory`'s `turso` case in
// `@objectstack/service-datasource` — serves every door that is NOT a host's
// `default` datasource: one created in Setup, one probed by `testConnection`, a
// declared non-default. Two things differed across that seam, and an author
// could see neither:
//
//   1. THE CONFIG SURFACE (the half a user could actually hit). This loader
//      built `new TursoDriver({ url, authToken })` — two keys — while the
//      open-core arm read nine. `TursoConfigSchema` accepts all nine, so an
//      encrypted or embedded-replica datasource silently lost `encryptionKey` /
//      `syncUrl` / `sync` / `concurrency` / `timeout` / `mode` / `schemaMode`
//      with no diagnostic, and got them back the moment it was renamed away from
//      `default`.
//   2. THE ERROR CLASS. `MissingDriverPackageError` was declared in this package,
//      which `service-datasource` cannot import (runtime depends on it, not the
//      reverse), so that arm raised a plain `Error` — matched by no `instanceof`.
//
// The assertions below are deliberately of two kinds, because the two defects
// hide from different tests:
//
//   - the config pin asserts THE CONSTRUCTOR ARGUMENT, not a successful boot. A
//     dropped key produces a driver that constructs perfectly and connects to
//     the wrong thing; every boot-level assertion stayed green through the years
//     this loader read two keys.
//   - the identity pin asserts CLASS IDENTITY (`===` / `instanceof`), never
//     `name` or message text. Two same-named classes produce byte-identical
//     messages — that is exactly what makes the defect invisible.
//
// No test here touches a real libSQL endpoint: the optional package is
// substituted through `importDriverPackage`.

import { describe, it, expect, vi } from 'vitest';
import {
  buildTursoDriverConfig,
  createDefaultDatasourceDriverFactory,
  MissingDriverPackageError as OpenCoreMissingDriverPackageError,
  TURSO_DRIVER_CONFIG_KEYS,
  type DatasourceConnectionSpec,
} from '@objectstack/service-datasource';
import { loadTursoDriverFactory, MissingDriverPackageError } from './turso-driver-factory.js';

/**
 * A `default` libSQL datasource declaring EVERY key the config contract accepts
 * — the case the narrow read silently degraded.
 *
 * `schemaMode` rides on the spec rather than in `config`, which is where a
 * datasource actually declares it (#4410); the builder reads all three of its
 * sources, and a loader that only looked inside `config` would drop it.
 */
const FULL_SPEC: DatasourceConnectionSpec = {
  name: 'default',
  driver: 'turso',
  schemaMode: 'external',
  config: {
    url: 'libsql://my-db.turso.io',
    authToken: 'jwt-token',
    encryptionKey: 'aes-256-key',
    concurrency: 7,
    syncUrl: 'libsql://replica.turso.io',
    sync: { intervalSeconds: 30, onConnect: false },
    timeout: 9000,
    mode: 'replica',
  },
};

/** Substitute the optional package with a ctor that records what it was handed. */
function capturingDriverPackage() {
  const seen: unknown[] = [];
  class TursoDriver {
    constructor(config: unknown) {
      seen.push(config);
    }
  }
  return { seen, importDriverPackage: async () => ({ TursoDriver }) };
}

describe('#7314 point 3 — the host loader reads the whole libSQL config, not two keys of it', () => {
  it('reaches the driver with every declared key, asserted on the constructor argument', async () => {
    const { seen, importDriverPackage } = capturingDriverPackage();
    const factory = await loadTursoDriverFactory({ importDriverPackage });
    factory.create(FULL_SPEC);

    expect(seen).toHaveLength(1);
    // Spelled out rather than compared to the builder alone: this is the list an
    // author can point at, and it is what the open-core arm has always honoured.
    expect(seen[0]).toEqual({
      url: 'libsql://my-db.turso.io',
      authToken: 'jwt-token',
      encryptionKey: 'aes-256-key',
      concurrency: 7,
      syncUrl: 'libsql://replica.turso.io',
      sync: { intervalSeconds: 30, onConnect: false },
      timeout: 9000,
      mode: 'replica',
      schemaMode: 'external',
    });
  });

  // The anti-drift half. The pin above would go green again on a SECOND
  // hand-written list that happened to agree today — which is precisely how the
  // first two lists came to disagree. This one fails unless the loader is
  // actually building through the shared derivation.
  it('builds through the shared builder, so a new key cannot reach one loader only', async () => {
    const { seen, importDriverPackage } = capturingDriverPackage();
    const factory = await loadTursoDriverFactory({ importDriverPackage });
    factory.create(FULL_SPEC);

    expect(seen[0]).toEqual(buildTursoDriverConfig(FULL_SPEC, 'libsql://my-db.turso.io'));
    expect(Object.keys(seen[0] as object).sort()).toEqual([...TURSO_DRIVER_CONFIG_KEYS].sort());
  });

  // Absent ≠ present-and-undefined: `@libsql/client` reads some options by
  // presence, and the open-core arm has always spread-omitted rather than
  // passing `undefined` through.
  it('omits keys the datasource did not declare rather than passing undefined', async () => {
    const { seen, importDriverPackage } = capturingDriverPackage();
    const factory = await loadTursoDriverFactory({ importDriverPackage });
    factory.create({ name: 'default', driver: 'turso', config: { url: 'file:./data/objectstack.db' } });

    expect(seen[0]).toEqual({ url: 'file:./data/objectstack.db' });
    expect(Object.keys(seen[0] as object)).toEqual(['url']);
  });

  // Shared url resolution, which this loader did not have: it tested
  // `typeof url === 'string'` without trimming, so a whitespace-only url reached
  // `@libsql/client` instead of the named refusal the open-core arm gives.
  it('refuses a whitespace-only url by name instead of handing it to the driver', async () => {
    const { seen, importDriverPackage } = capturingDriverPackage();
    const factory = await loadTursoDriverFactory({
      importDriverPackage,
      missingUrlError: (message) => new Error(message),
    });

    expect(() => factory.create({ name: 'default', driver: 'turso', config: { url: '   ' } }))
      .toThrow(/needs a libSQL url/);
    expect(seen).toHaveLength(0);
  });
});

describe('#7314 point 2 — one MissingDriverPackageError class across the seam', () => {
  // The declaration moved DOWN (runtime depends on service-datasource, so this
  // is the only legal direction) and is re-exported from its old home. Asserted
  // by object identity: a second same-named class would satisfy every other
  // assertion in this file.
  it('the runtime export IS the service-datasource class object', () => {
    expect(MissingDriverPackageError).toBe(OpenCoreMissingDriverPackageError);
  });

  it('the host loader raises an error the open-core binding matches', async () => {
    const err = await loadTursoDriverFactory({
      importDriverPackage: async () => { throw new Error("Cannot find package '@objectstack/driver-turso'"); },
    }).then(() => null, (e: unknown) => e);

    expect(err).toBeInstanceOf(OpenCoreMissingDriverPackageError);
    expect((err as InstanceType<typeof MissingDriverPackageError>).driverType).toBe('turso');
  });

  // THE pin, and the direction that was impossible before this change: the
  // open-core arm's failure now satisfies the predicate `serve.ts` runs
  // (`e instanceof MissingDriverPackageError`, against the runtime binding).
  // Until #7314 that arm raised a plain `Error` and this assertion could not
  // have been written.
  it('the open-core arm raises an error the runtime binding matches', async () => {
    // ⭐ STAGED absence since #12943. `@objectstack/driver-turso` is now an
    // OPTIONAL PEER of `@objectstack/service-datasource` and of this package —
    // the honest install-time declaration of a relationship the source already
    // had. It installs nothing for a consumer, but pnpm LINKS an optional
    // workspace peer, so the package resolves here and the bare form stopped
    // entering the missing-package arm. That is precisely the transition this
    // pin's old notice named, and this is it carried out.
    //
    // ⛔ Mocked WITHOUT `vi.resetModules()`, and that is load-bearing rather
    // than a shortcut: this pin is about CLASS IDENTITY ACROSS THE SEAM, and a
    // reset re-evaluates `missing-driver-package-error.js` inside
    // `@objectstack/service-datasource`. The arm would then raise a fresh class
    // object, `instanceof` against the runtime binding would be FALSE for a
    // perfectly correct error, and the reset would have destroyed the very fact
    // under test. No reset is needed here: nothing in this file imports the
    // driver package before this point, so the factory's lazy
    // `await import(...)` is the first one and the mock is what it finds.
    vi.doMock('@objectstack/driver-turso', () => {
      throw Object.assign(
        new Error("Cannot find package '@objectstack/driver-turso' imported from /app/node_modules/x.mjs"),
        { code: 'ERR_MODULE_NOT_FOUND' },
      );
    });
    let err: unknown = null;
    try {
      await createDefaultDatasourceDriverFactory()
        .create({ name: 'warehouse', driver: 'turso', config: { url: 'libsql://my-db.turso.io' } });
    } catch (e) {
      err = e;
    } finally {
      vi.doUnmock('@objectstack/driver-turso');
    }

    if (err === null) {
      throw new Error(
        'staging @objectstack/driver-turso as absent no longer makes the open-core turso arm '
        + 'raise, so this case has stopped exercising the missing-package arm. ⛔ Do not delete '
        + 'it and do not weaken it: find out why the stub stops short of the arm. An arm no test '
        + 'can enter is a decoration, and this one is the whole reason serve.ts can decide boot '
        + 'fatality on a failure the OPEN-CORE factory raised.',
      );
    }
    expect(err).toBeInstanceOf(MissingDriverPackageError);
    expect((err as InstanceType<typeof MissingDriverPackageError>).installCommand)
      .toBe('npm install @objectstack/driver-turso');
  });
});
