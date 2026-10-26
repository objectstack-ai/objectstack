// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0141 D2 — the range reader beside the protocol handshake, and the one
 * pre-install dependency predicate every install door calls.
 *
 * The reader answers at EXACT-VERSION granularity (`^6.2.0` refuses an
 * installed `6.1.0`, which `rangeAdmitsMajor` admits), over the grammar the
 * handshake family already reads. The predicate judges each declared entry
 * of the delivered packages: present (installed, or delivered by the same
 * act) and, for an installed record, in range. An unreadable range or version
 * does not satisfy.
 */

import { describe, expect, it } from 'vitest';
import {
  assertDeclaredDependencies,
  checkDeclaredDependencies,
  dependencyMissingAnswer,
  DependencyMissingError,
  isDependencyMissingError,
  rangeAdmitsMajor,
  rangeAdmitsVersion,
  readExactVersion,
} from './protocol-handshake.js';

describe('rangeAdmitsVersion — exact-version granularity over the handshake grammar', () => {
  it('caret: the ruling\'s own 「HotCRM 6.x」 spellings, and the minor/patch floor the major reader cannot see', () => {
    expect(rangeAdmitsVersion('^6.2.0', '6.2.0')).toBe(true);
    expect(rangeAdmitsVersion('^6.2.0', '6.9.1')).toBe(true);
    expect(rangeAdmitsVersion('^6.2.0', '7.0.0')).toBe(false);
    // The reason this reader exists: the major reader admits it, D2 cannot.
    expect(rangeAdmitsMajor('^6.2.0', 6)).toBe(true);
    expect(rangeAdmitsVersion('^6.2.0', '6.1.0')).toBe(false);
    expect(rangeAdmitsVersion('^6', '6.0.0')).toBe(true);
    expect(rangeAdmitsVersion('^6', '5.9.9')).toBe(false);
    // npm's zero-major caret narrows to the first non-zero part.
    expect(rangeAdmitsVersion('^0.2.3', '0.2.9')).toBe(true);
    expect(rangeAdmitsVersion('^0.2.3', '0.3.0')).toBe(false);
    expect(rangeAdmitsVersion('^0.0.3', '0.0.4')).toBe(false);
    expect(rangeAdmitsVersion('^0.0', '0.0.9')).toBe(true);
    expect(rangeAdmitsVersion('^0.0', '0.1.0')).toBe(false);
  });

  it('tilde pins the minor when one is written, the major otherwise', () => {
    expect(rangeAdmitsVersion('~6.1.2', '6.1.9')).toBe(true);
    expect(rangeAdmitsVersion('~6.1.2', '6.1.1')).toBe(false);
    expect(rangeAdmitsVersion('~6.1.2', '6.2.0')).toBe(false);
    expect(rangeAdmitsVersion('~6', '6.9.0')).toBe(true);
    expect(rangeAdmitsVersion('~6', '7.0.0')).toBe(false);
  });

  it('x and * wildcards, bare partials, and the full wildcard', () => {
    expect(rangeAdmitsVersion('6.x', '6.4.2')).toBe(true);
    expect(rangeAdmitsVersion('6.x', '7.0.0')).toBe(false);
    expect(rangeAdmitsVersion('6.1.*', '6.1.7')).toBe(true);
    expect(rangeAdmitsVersion('6.1.*', '6.2.0')).toBe(false);
    expect(rangeAdmitsVersion('6', '6.3.0')).toBe(true);
    expect(rangeAdmitsVersion('6.1', '6.2.0')).toBe(false);
    expect(rangeAdmitsVersion('*', '0.0.1')).toBe(true);
    expect(rangeAdmitsVersion('x', '12.0.0')).toBe(true);
  });

  it('an exact version admits that version only', () => {
    expect(rangeAdmitsVersion('6.1.2', '6.1.2')).toBe(true);
    expect(rangeAdmitsVersion('=6.1.2', '6.1.2')).toBe(true);
    expect(rangeAdmitsVersion('6.1.2', '6.1.3')).toBe(false);
  });

  it('single comparators, with npm\'s partial-version desugaring', () => {
    expect(rangeAdmitsVersion('>=6.2.0', '6.2.0')).toBe(true);
    expect(rangeAdmitsVersion('>=6.2.0', '6.1.9')).toBe(false);
    expect(rangeAdmitsVersion('>6.2.0', '6.2.0')).toBe(false);
    expect(rangeAdmitsVersion('>6.2.0', '6.2.1')).toBe(true);
    // `>6` is `>=7.0.0`; `<=6` is `<7.0.0`; `<6.2` is `<6.2.0`.
    expect(rangeAdmitsVersion('>6', '6.9.9')).toBe(false);
    expect(rangeAdmitsVersion('>6', '7.0.0')).toBe(true);
    expect(rangeAdmitsVersion('<=6', '6.9.9')).toBe(true);
    expect(rangeAdmitsVersion('<=6', '7.0.0')).toBe(false);
    expect(rangeAdmitsVersion('<6.2', '6.1.9')).toBe(true);
    expect(rangeAdmitsVersion('<6.2', '6.2.0')).toBe(false);
    // An operator separated from its version by a space reads the same.
    expect(rangeAdmitsVersion('>= 6.2.0', '6.2.0')).toBe(true);
  });

  it('space- and comma-joined intersections, hyphen ranges and || unions', () => {
    expect(rangeAdmitsVersion('>=6.2.0 <7.0.0', '6.5.0')).toBe(true);
    expect(rangeAdmitsVersion('>=6.2.0 <7.0.0', '7.0.0')).toBe(false);
    expect(rangeAdmitsVersion('>=6.2.0, <7', '6.1.0')).toBe(false);
    expect(rangeAdmitsVersion('6.1.0 - 6.3', '6.3.9')).toBe(true);
    expect(rangeAdmitsVersion('6.1.0 - 6.3', '6.4.0')).toBe(false);
    expect(rangeAdmitsVersion('6.1.0 - 6.3.0', '6.3.0')).toBe(true);
    expect(rangeAdmitsVersion('^5.4.0 || ^6.1.0', '6.0.0')).toBe(false);
    expect(rangeAdmitsVersion('^5.4.0 || ^6.1.0', '5.9.0')).toBe(true);
    expect(rangeAdmitsVersion('^5.4.0 || ^6.1.0', '6.2.0')).toBe(true);
  });

  it('fails closed: a range it cannot read answers null, never true', () => {
    for (const range of ['', '   ', 'latest', 'next', '|| ^5', '6.x.foo', '>=', '~>6.0', '^6.0.0.1', 'a'.repeat(200)]) {
      expect(rangeAdmitsVersion(range, '6.0.0'), range).toBeNull();
    }
    // One unreadable alternative makes a union unreadable unless another admits.
    expect(rangeAdmitsVersion('^6 || nonsense', '6.1.0')).toBe(true);
    expect(rangeAdmitsVersion('^6 || nonsense', '7.0.0')).toBeNull();
    // An empty alternative is an unreadable one.
    expect(rangeAdmitsVersion('^6 ||', '7.0.0')).toBeNull();
  });

  it('answers null for a version outside MAJOR.MINOR.PATCH (a prerelease included)', () => {
    expect(rangeAdmitsVersion('^6', '6')).toBeNull();
    expect(rangeAdmitsVersion('^6', '6.1')).toBeNull();
    expect(rangeAdmitsVersion('^6', '6.1.0-beta.1')).toBeNull();
    expect(rangeAdmitsVersion('^6', 'banana')).toBeNull();
    // A leading `v` and build metadata are read.
    expect(readExactVersion('v6.1.0+build.7')).toEqual([6, 1, 0]);
    expect(readExactVersion(6)).toBeNull();
  });
});

const installed = (records: Record<string, string | undefined>) => (id: string) =>
  id in records ? { manifest: { version: records[id] } } : undefined;

describe('checkDeclaredDependencies — ADR-0141 D2\'s one predicate', () => {
  const psa = { id: 'com.acme.psa', dependencies: { 'com.hotcrm.sales': '^6.0.0' } };

  it('admits a dependency installed at a version inside its range', () => {
    expect(checkDeclaredDependencies({ delivered: [psa], getInstalled: installed({ 'com.hotcrm.sales': '6.3.1' }) })).toEqual([]);
  });

  it('reports an absent dependency and one installed outside its range, every entry in one answer', () => {
    const pkg = { id: 'com.acme.psa', dependencies: { 'com.hotcrm.sales': '^6.0.0', 'com.acme.billing': '>=2.1.0' } };
    expect(checkDeclaredDependencies({ delivered: [pkg], getInstalled: installed({ 'com.hotcrm.sales': '5.9.0' }) })).toEqual([
      { packageId: 'com.acme.psa', dependency: 'com.hotcrm.sales', range: '^6.0.0', found: 'out-of-range', installedVersion: '5.9.0' },
      { packageId: 'com.acme.psa', dependency: 'com.acme.billing', range: '>=2.1.0', found: 'absent' },
    ]);
  });

  it('fails closed on an unreadable range and on an unreadable installed version, naming which side', () => {
    const pkg = { id: 'com.acme.psa', dependencies: { 'com.hotcrm.sales': 'latest', 'com.acme.billing': '^2' } };
    expect(checkDeclaredDependencies({
      delivered: [pkg],
      getInstalled: installed({ 'com.hotcrm.sales': '6.0.0', 'com.acme.billing': '2.0.0-rc.1' }),
    })).toEqual([
      { packageId: 'com.acme.psa', dependency: 'com.hotcrm.sales', range: 'latest', found: 'unreadable-range', installedVersion: '6.0.0' },
      { packageId: 'com.acme.psa', dependency: 'com.acme.billing', range: '^2', found: 'unreadable-version', installedVersion: '2.0.0-rc.1' },
    ]);
    // An unreadable range is reported as such even when the dependency is
    // absent: installing it would not make the entry satisfiable, so the
    // range is the fact the author has to act on.
    expect(checkDeclaredDependencies({ delivered: [pkg], getInstalled: installed({}) })[0]).toEqual(
      { packageId: 'com.acme.psa', dependency: 'com.hotcrm.sales', range: 'latest', found: 'unreadable-range' },
    );
  });

  it('judges a dependency the same act delivers for presence only, whatever its version', () => {
    // ADR-0141 D2 arm 2: inside one artifact the packages are one tested unit.
    const core = { id: 'com.example.multi.core', version: '2.0.0' };
    const orders = { id: 'com.example.multi.orders', dependencies: { 'com.example.multi.core': '^1.0.0' } };
    expect(checkDeclaredDependencies({ delivered: [orders, core], getInstalled: installed({}) })).toEqual([]);
    // An id delivered by the act without being judged itself (an artifact's own identity).
    expect(checkDeclaredDependencies({
      delivered: [orders], deliveredIds: ['com.example.multi.core'], getInstalled: installed({}),
    })).toEqual([]);
    // Control: delivered by nobody, the same entry is absent.
    expect(checkDeclaredDependencies({ delivered: [orders], getInstalled: installed({}) })).toHaveLength(1);
  });

  it('reads a declaration that is not a record as unreadable, never as "no dependencies"', () => {
    const pkg = { id: 'com.acme.psa', dependencies: [{ packageId: 'com.hotcrm.sales', versionRange: '^6' }] };
    expect(checkDeclaredDependencies({ delivered: [pkg], getInstalled: installed({}) })).toEqual([
      { packageId: 'com.acme.psa', found: 'unreadable-declaration' },
    ]);
    // Absent and empty declarations judge nothing.
    expect(checkDeclaredDependencies({ delivered: [{ id: 'a.b.c' }, { id: 'a.b.d', dependencies: {} }], getInstalled: installed({}) })).toEqual([]);
  });
});

describe('assertDeclaredDependencies / DependencyMissingError — the ADR-0112 envelope and the one door answer', () => {
  const psa = { id: 'com.acme.psa', dependencies: { 'com.hotcrm.sales': '^6.0.0', 'com.acme.billing': '>=2.1.0' } };

  it('returns silently when every entry is satisfied', () => {
    expect(() => assertDeclaredDependencies({
      delivered: [psa], getInstalled: installed({ 'com.hotcrm.sales': '6.0.0', 'com.acme.billing': '2.1.0' }),
    })).not.toThrow();
  });

  it('throws 422 DEPENDENCY_MISSING carrying one dependency_missing issue per unmet entry', () => {
    let thrown: unknown;
    try {
      assertDeclaredDependencies({ delivered: [psa], getInstalled: installed({ 'com.hotcrm.sales': '5.2.0' }) });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DependencyMissingError);
    const err = thrown as DependencyMissingError;
    expect(err.code).toBe('DEPENDENCY_MISSING');
    expect(err.status).toBe(422);
    expect(err.statusCode).toBe(422);
    expect(err.issues).toHaveLength(2);
    for (const issue of err.issues) {
      expect(issue).toEqual({ severity: 'error', category: 'dependency_missing', message: expect.any(String) });
    }
    // Each issue names the id, the range and what was found.
    expect(err.issues[0]!.message).toContain("'com.hotcrm.sales'");
    expect(err.issues[0]!.message).toContain('^6.0.0');
    expect(err.issues[0]!.message).toContain('5.2.0');
    expect(err.issues[1]!.message).toContain("'com.acme.billing'");
    expect(err.issues[1]!.message).toContain('not installed');
    expect(isDependencyMissingError(err)).toBe(true);
  });

  it('dependencyMissingAnswer: status, code, the error\'s own message, and a closed details shape', () => {
    const err = new DependencyMissingError([
      { packageId: 'com.acme.psa', dependency: 'com.hotcrm.sales', range: '^6.0.0', found: 'absent' },
    ]);
    const answer = dependencyMissingAnswer(err);
    expect(answer.status).toBe(422);
    expect(answer.code).toBe('DEPENDENCY_MISSING');
    expect(answer.message).toBe(err.message);
    expect(Object.keys(answer.details).sort()).toEqual(['compatible', 'issues', 'unmet']);
    expect(answer.details.compatible).toBe(false);
    expect(answer.details.issues).toEqual(err.issues);
    expect(answer.details.unmet).toEqual([
      { packageId: 'com.acme.psa', dependency: 'com.hotcrm.sales', range: '^6.0.0', found: 'absent' },
    ]);
  });

  it('recognises the brand, not the field names', () => {
    const lookalike = Object.assign(new Error('x'), { code: 'DEPENDENCY_MISSING', status: 422, unmet: [] });
    expect(isDependencyMissingError(lookalike)).toBe(false);
    expect(isDependencyMissingError(null)).toBe(false);
  });
});
