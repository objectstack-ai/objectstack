// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Guards WHO decides a package is writable (objectui#7177 · ADR-0130
 * Consequences row 6 · objectstack#14375).
 *
 * The server computes `writable` with `isWritablePackage` (ADR-0070 D2) and
 * stamps it on every `GET /api/v1/packages` row. `parsePackages` must READ that
 * verdict, because the client cannot derive it: the signal that separates a
 * booted multi-package module (read-only, `engine.manifests`) from a
 * Studio-created database base (writable) lives only on the server, and BOTH of
 * those rows arrive with no `scope` key.
 *
 * The old `scope !== 'project'` expression survives as the fallback for servers
 * that predate the field — pinned here as byte-identical output, so the
 * compatibility arm cannot rot unnoticed.
 */
import { describe, expect, it } from 'vitest';
import { parsePackages } from './packages-io';

function wrap(packages: Array<Record<string, unknown>>) {
  return { data: { packages } };
}

/** A registry row as the runtime dispatcher serves it (`InstalledPackage` + the verdict). */
function row(manifest: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    manifest,
    status: 'installed',
    enabled: true,
    installedAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...extra,
  };
}

describe('parsePackages — the server owns the writable verdict', () => {
  it('honours writable:false on a scope-less row (the ADR-0130 module sub-package)', () => {
    const [pkg] = parsePackages(
      wrap([row({ id: 'com.example.leave', name: 'Leave', type: 'module' }, { writable: false })]),
    );
    // The row really has no scope — the verdict cannot be leaking out of one.
    expect(pkg.writable).toBe(false);
    expect(pkg.id).toBe('com.example.leave');
  });

  it('honours writable:true on a scope-less row (a Studio-created database base)', () => {
    const [pkg] = parsePackages(
      wrap([row({ id: 'com.example.my_base', name: 'My Base' }, { writable: true })]),
    );
    expect(pkg.writable).toBe(true);
  });

  it('lets the server win over the heuristic in BOTH directions on scope:project', () => {
    const [readOnly] = parsePackages(
      wrap([row({ id: 'app.objectstack.hotcrm', name: 'HotCRM', scope: 'project' }, { writable: false })]),
    );
    expect(readOnly.writable).toBe(false);

    // The heuristic would say false here; the server says true and is obeyed.
    const [writable] = parsePackages(
      wrap([row({ id: 'com.example.promoted', name: 'Promoted', scope: 'project' }, { writable: true })]),
    );
    expect(writable.writable).toBe(true);
  });

  it('ignores a non-boolean writable and falls back to the heuristic', () => {
    // A string is not a verdict. `Boolean('false')` is `true`, so a coercing
    // read would have made this row writable *and* agreed with the fallback by
    // accident — the scope:project row is what tells the two apart.
    const [scopeless] = parsePackages(
      wrap([row({ id: 'com.example.leave', name: 'Leave' }, { writable: 'false' })]),
    );
    expect(scopeless.writable).toBe(true); // fallback: no scope → not 'project'

    const [project] = parsePackages(
      wrap([row({ id: 'app.objectstack.hotcrm', name: 'HotCRM', scope: 'project' }, { writable: 'true' })]),
    );
    expect(project.writable).toBe(false); // fallback: scope 'project' → read-only
  });

  it('hides kernel packages whatever verdict they carry (visibility is not writability)', () => {
    const out = parsePackages(
      wrap([
        row({ id: 'objectstack.core', name: 'Core', scope: 'system' }, { writable: true }),
        row({ id: 'com.objectstack.cloud.billing', name: 'Billing', scope: 'cloud' }, { writable: true }),
        row({ id: 'com.example.leave', name: 'Leave' }, { writable: false }),
      ]),
    );
    expect(out.map((p) => p.id)).toEqual(['com.example.leave']);
  });
});

describe('parsePackages — a server with no writable field is unchanged', () => {
  /**
   * A realistic single-package install as an older server serves it: kernel
   * packages, the `scope: 'project'` app package, a scope-less database base and
   * a scope-less module. No `writable` key anywhere.
   */
  const LEGACY_PAYLOAD = {
    success: true,
    data: {
      packages: [
        row({ id: 'objectstack.core', name: 'ObjectStack Core', version: '1.0.0', scope: 'system' }),
        row({ id: 'com.objectstack.cloud.billing', name: 'Billing', version: '1.0.0', scope: 'cloud' }),
        row({
          id: 'app.objectstack.hotcrm',
          name: 'HotCRM',
          version: '1.0.0',
          type: 'app',
          scope: 'project',
        }),
        row({ id: 'com.example.my_base', name: 'My Base', version: '0.1.0' }),
        row({ id: 'com.example.leave', name: 'Leave', version: '0.1.0', type: 'module', namespace: 'leave' }),
      ],
      total: 5,
    },
  };

  /**
   * Captured by running `parsePackages` against LEGACY_PAYLOAD on the UNTOUCHED
   * tree (`ad3d4029abb949cb41815b6ce38d5e0ecad1486a`), before the verdict read
   * existed. Pasted, never re-derived — a re-derived expectation would agree
   * with any regression this pin exists to catch.
   */
  const OUTPUT_BEFORE_THIS_CHANGE = [
    { id: 'app.objectstack.hotcrm', name: 'HotCRM', writable: false, namespace: 'hotcrm' },
    { id: 'com.example.my_base', name: 'My Base', writable: true, namespace: 'my_base' },
    { id: 'com.example.leave', name: 'Leave', writable: true, namespace: 'leave' },
  ];

  it('produces exactly the output it produced before the verdict read landed', () => {
    expect(parsePackages(LEGACY_PAYLOAD)).toEqual(OUTPUT_BEFORE_THIS_CHANGE);
  });
});
