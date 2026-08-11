// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  EXTERNAL_ERROR_CODES,
  EXTERNAL_ERROR_HTTP_STATUS,
  renderDiffMessage,
  ExternalSchemaMismatchError,
  ExternalWriteForbiddenError,
  ExternalSchemaModeViolationError,
  type SchemaDiffEntry,
} from './external-errors';

describe('External error codes (ADR-0015)', () => {
  it('exposes stable codes', () => {
    expect(EXTERNAL_ERROR_CODES.schemaMismatch).toBe('EXTERNAL_SCHEMA_MISMATCH');
    expect(EXTERNAL_ERROR_CODES.writeForbidden).toBe('EXTERNAL_WRITE_FORBIDDEN');
    expect(EXTERNAL_ERROR_CODES.schemaModeViolation).toBe('EXTERNAL_SCHEMA_MODE_VIOLATION');
  });
});

// ---------------------------------------------------------------------------
// [#7739] The status half of the contract.
//
// A code with no status is a code no HTTP exit can put on the wire: every exit
// in this repo resolves `status` → `statusCode` and, finding neither, answers
// the terminal sanitised 500 that has no `code` at all. So these assertions are
// not decoration on the table — they are what makes the ledgered codes
// REACHABLE by a client.
// ---------------------------------------------------------------------------

describe('[#7739] EXTERNAL_ERROR_HTTP_STATUS', () => {
  it('covers every code in the family — no gate can leak as a bare 500', () => {
    // The `satisfies Record<ExternalErrorCode, number>` makes a missing entry a
    // compile error; this is the runtime twin, so a code added to the map but
    // not to `EXTERNAL_ERROR_CODES` (or vice versa) is caught by `pnpm test`
    // too. Sorted comparison: the map is keyed by VALUE, the codes object by
    // name.
    expect(Object.keys(EXTERNAL_ERROR_HTTP_STATUS).sort()).toEqual(
      Object.values(EXTERNAL_ERROR_CODES).sort(),
    );
  });

  it('reports the two POLICY refusals as 403, not as a client-syntax error', () => {
    // 403 rather than 400/422: the request is well-formed and would succeed
    // unchanged once the opt-in flags are set — nothing for the caller to fix
    // in the payload. Rather than 409: no state the caller can reconcile and
    // retry.
    expect(EXTERNAL_ERROR_HTTP_STATUS.EXTERNAL_WRITE_FORBIDDEN).toBe(403);
    expect(EXTERNAL_ERROR_HTTP_STATUS.EXTERNAL_SCHEMA_MODE_VIOLATION).toBe(403);
  });

  it('reports a schema divergence as 503 — a deployment state, not the caller', () => {
    // Same reading `ERR_DATASOURCE_UNAVAILABLE` gets: nothing about the request
    // is wrong, only an operator can reconcile metadata with the remote table,
    // and it may clear. A 4xx here would tell the caller to fix something they
    // do not control.
    expect(EXTERNAL_ERROR_HTTP_STATUS.EXTERNAL_SCHEMA_MISMATCH).toBe(503);
  });

  it('every status is inside the 400-599 band each HTTP exit reads', () => {
    // Outside that band `declaredHttpStatus` (rest) and its siblings treat the
    // declaration as absent, which would silently restore the 500 leak.
    for (const status of Object.values(EXTERNAL_ERROR_HTTP_STATUS)) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it('each error instance carries its family status as `status`', () => {
    // `status` (not `statusCode`) because that is the spelling BOTH doors read:
    // `resolveErrorResponse` is deliberately `status`-only (#7525).
    expect(new ExternalWriteForbiddenError().status).toBe(403);
    expect(new ExternalSchemaModeViolationError().status).toBe(403);
    expect(new ExternalSchemaMismatchError('warehouse', 'wh_order', []).status).toBe(503);
  });
});

describe('renderDiffMessage', () => {
  it('renders a header with no entries', () => {
    const msg = renderDiffMessage('warehouse', 'wh_order', []);
    expect(msg).toContain("Object 'wh_order'");
    expect(msg).toContain("datasource 'warehouse'");
    expect(msg.split('\n')).toHaveLength(1);
  });

  it('renders one line per diff entry with type detail', () => {
    const diffs: SchemaDiffEntry[] = [
      { kind: 'missing_column', remoteSchema: 'mart', remoteName: 'fact_orders', column: 'amount', severity: 'error' },
      {
        kind: 'type_mismatch',
        remoteSchema: 'mart',
        remoteName: 'fact_orders',
        column: 'ordered_at',
        expected: 'datetime',
        actual: 'text',
        severity: 'warning',
      },
    ];
    const lines = renderDiffMessage('warehouse', 'wh_order', diffs).split('\n');
    expect(lines).toHaveLength(3); // header + 2 entries
    expect(lines[1]).toContain('missing_column');
    expect(lines[1]).toContain('mart.fact_orders.amount');
    expect(lines[2]).toContain('type_mismatch');
    expect(lines[2]).toContain('expected datetime');
    expect(lines[2]).toContain('actual text');
  });
});

describe('ExternalSchemaMismatchError', () => {
  it('carries code, datasource, object, diffs and a rendered message', () => {
    const diffs: SchemaDiffEntry[] = [
      { kind: 'missing_table', remoteName: 'fact_orders', severity: 'error' },
    ];
    const err = new ExternalSchemaMismatchError('warehouse', 'wh_order', diffs);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('EXTERNAL_SCHEMA_MISMATCH');
    expect(err.name).toBe('ExternalSchemaMismatchError');
    expect(err.datasource).toBe('warehouse');
    expect(err.object).toBe('wh_order');
    expect(err.diffs).toBe(diffs);
    expect(err.message).toContain('missing_table');
  });
});

describe('ExternalWriteForbiddenError', () => {
  it('has a stable code and a default message', () => {
    const err = new ExternalWriteForbiddenError();
    expect(err.code).toBe('EXTERNAL_WRITE_FORBIDDEN');
    expect(err.name).toBe('ExternalWriteForbiddenError');
    expect(err.message.length).toBeGreaterThan(0);
  });

  it('accepts a custom message', () => {
    const err = new ExternalWriteForbiddenError('nope');
    expect(err.message).toBe('nope');
  });
});

describe('ExternalSchemaModeViolationError', () => {
  it('has a stable code and a default message', () => {
    const err = new ExternalSchemaModeViolationError();
    expect(err.code).toBe('EXTERNAL_SCHEMA_MODE_VIOLATION');
    expect(err.name).toBe('ExternalSchemaModeViolationError');
    expect(err.message.length).toBeGreaterThan(0);
  });
});
