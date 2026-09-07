// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Every refusal this package throws with a numeric HTTP status carries that
// number under BOTH spellings, and they agree.
//
// ## Why both, and why a test rather than a comment
//
// `status` is what every HTTP door in this repo reads — `resolveThrownHttpError`
// (`@objectstack/types`) resolves `.status` → `.statusCode` and nothing else, so
// removing it would change what the REST and dispatcher doors answer. It stays.
//
// `httpStatus` is ADR-0112 D5's spelling ("the HTTP status lives on the
// transport and (optionally) `error.httpStatus`"), and it is what a consumer
// holding the THROWN error reads. The measured consumer is the CLI's `--json`
// error envelope: `errorCodeFields` (`packages/cli/src/utils/format.ts`)
// forwards `code` and `httpStatus` only, so `os migrate summary-nulls --json`
// emitted `{ error, code: 'INVALID_FIELD' }` with no status at all for a
// refusal that answers 400 over the wire.
//
// The two keys are written side by side at every producer, which means nothing
// but this test stops one of them from drifting: a producer whose status
// changes in one spelling and not the other is invisible to the type system
// (both are plain data on a thrown value) and invisible to
// `check:error-status-conformance`, whose deriver reads `status` /
// `statusCode` and does not know this spelling at all. So the invariant is
// asserted over CONSTRUCTED errors — the classes are the half a unit test can
// reach without booting an engine, and they are also the half published on the
// package's barrel.
//
// ⛔ Not a source scan. A regex over the producer files would re-derive the
// pairing this file exists to check, and would go green the day its pattern
// stopped matching. Constructing the error and reading the two properties is
// the same question asked of the artefact a consumer actually receives.

import { describe, it, expect } from 'vitest';
import { DuplicateRecordError } from './duplicate-record-error.js';
import { HookUnscopedDataAccessError } from './hook-run-as.js';
import { MultiUpdateHookKeyDivergenceError } from './multi-update-hook-key-divergence.js';
import { EmptyCredentialWriteError } from './secret-fields.js';
import { SystemWriteOrganizationRequiredError } from './tenancy/system-write-organization.js';
import { NamespaceConflictError, ArtifactObjectNameConflictError, ObjectOwnershipConflictError } from './registry.js';
import { invalidFilterError } from './filter-comparand-shape.js';

/**
 * Every status-carrying refusal this package can construct without an engine,
 * with the status it declares. The expected number is written here rather than
 * read off the instance, so a producer that changes its status in ONE spelling
 * fails on the value as well as on the agreement.
 */
const CONSTRUCTED: Array<[string, () => unknown, number]> = [
  ['DuplicateRecordError', () => new DuplicateRecordError('customer', new Error('dup'), 'email'), 409],
  ['HookUnscopedDataAccessError', () => new HookUnscopedDataAccessError({ hook: 'beforeFind', object: 'customer', event: 'beforeFind' }), 403],
  ['MultiUpdateHookKeyDivergenceError', () => new MultiUpdateHookKeyDivergenceError('customer', ['a', 'b'], 2), 400],
  ['EmptyCredentialWriteError', () => new EmptyCredentialWriteError('datasource', 'secret_key', 'secret'), 400],
  ['SystemWriteOrganizationRequiredError', () => new SystemWriteOrganizationRequiredError('sys_job', 'group', 'walled-posture'), 500],
  ['NamespaceConflictError', () => new NamespaceConflictError('crm', 'pkg_a', 'pkg_b'), 422],
  ['ArtifactObjectNameConflictError', () => new ArtifactObjectNameConflictError('customer', 'pkg_a', 'pkg_b'), 422],
  ['ObjectOwnershipConflictError', () => new ObjectOwnershipConflictError('customer', 'pkg_a', 'pkg_b'), 422],
  ['invalidFilterError', () => invalidFilterError('bad comparand'), 400],
];

describe('engine refusals declare their HTTP status under both spellings', () => {
  it.each(CONSTRUCTED)('%s declares its status under both spellings', (_name, make, expected) => {
    const err = make() as { status?: unknown; httpStatus?: unknown };
    expect(err.status).toBe(expected);
    expect(err.httpStatus).toBe(expected);
  });

  it('every constructed refusal agrees with itself — no producer drifts one spelling', () => {
    const disagreed = CONSTRUCTED
      .map(([name, make]) => [name, make() as { status?: unknown; httpStatus?: unknown }] as const)
      .filter(([, err]) => err.status !== err.httpStatus)
      .map(([name, err]) => `${name}: status=${String(err.status)} httpStatus=${String(err.httpStatus)}`);
    expect(disagreed).toEqual([]);
  });

  // The control this suite needs to be worth anything: a bare `Error` declares
  // NEITHER spelling. Without it, an assertion helper that silently read
  // `undefined` on both sides would report every producer as "agreeing".
  it('a bare Error declares neither spelling — the control', () => {
    const bare = new Error('nothing declared') as { status?: unknown; httpStatus?: unknown };
    expect(bare.status).toBeUndefined();
    expect(bare.httpStatus).toBeUndefined();
  });
});
