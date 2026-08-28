/**
 * [#5638] `DeleteDataResult` is a CLAIM about the server's delete body, and it
 * has to be the claim its own comment makes: `Spec: DeleteDataResponseSchema`.
 *
 * It declared `{ object, id, deleted: boolean }` while
 * `DeleteDataResponseSchema` declares `{ object, id, success: boolean }`. Both
 * `delete` surfaces (`client.data.delete` and the project-scoped
 * `client.environment(id).data.delete`) are pure `unwrapResponse` / `_unwrap`
 * passthroughs — no runtime rewriting anywhere — so a consumer writing
 * `r.deleted` compiled fine and read `undefined` against every server path
 * that exists (#5581 / PR #5641 brought the ObjectQL fallback to `success`
 * too, so both producer paths now answer the same shape).
 *
 * WHICH LAYER ACTUALLY MOVES, and why that is not the usual one: the fix is a
 * type declaration, and types are erased before vitest ever runs. Reverting
 * `success` back to `deleted` therefore leaves every runtime assertion below
 * GREEN — they assert on a body the mock/server produced, which the client
 * never touched either way. The assertion that goes red on revert is the
 * type-level one (`SpecAndSdkAgree`), plus the `r.success` reads, and both are
 * enforced by `pnpm --filter @objectstack/client typecheck` → `check:test-typecheck`
 * (#5449/#5546), which compiles this file with the package's full strictness
 * and no debt-ledger entry. The runtime assertions below are shape pins: they
 * pin that the passthrough stays a passthrough, which is what makes the type
 * the only thing standing between a consumer and the wire.
 */
import { describe, it, expect, vi } from 'vitest';
import { DeleteDataResponseSchema, type DeleteDataResponse } from '@objectstack/spec/api';
import { ObjectStackClient, type DeleteDataResult } from './index';

/** Mutual assignability — `A extends B` alone would pass on a strict subset. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * The pin. `DeleteDataResult` must be structurally the spec type, field for
 * field: rename either side, add a key to one, or make one optional, and this
 * stops being `true` — a type error at `check:test-typecheck`, not a runtime
 * failure. (This is deliberately an equality, not `extends`: the old `deleted`
 * declaration was neither a subset nor a superset of the schema, and a
 * one-directional check would still have caught it — but a future
 * `success: boolean; deleted?: boolean` "transition" shape would slip past
 * one, and that shape is exactly what #5638's triage ruled out.)
 */
const SpecAndSdkAgree: Exact<DeleteDataResult, DeleteDataResponse> = true;

/** Helper: a client whose fetch answers `body` with `status`. */
function createMockClient(body: any, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
    headers: new Headers(),
  });
  const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000', fetch: fetchMock });
  return { client, fetchMock };
}

/** The body every server path answers a successful delete with (#5581). */
const SPEC_BODY = { object: 'task', id: 't1', success: true };

describe('[#5638] DeleteDataResult === DeleteDataResponseSchema', () => {
  it('declares the schema\'s shape, field for field (type-level)', () => {
    // Reading the binding is what keeps `noUnusedLocals` satisfied; the
    // assertion that matters already happened in tsc, above.
    expect(SpecAndSdkAgree).toBe(true);
  });

  it('the schema still declares `success` and has never declared `deleted`', () => {
    const parsed = DeleteDataResponseSchema.safeParse(SPEC_BODY);
    expect(parsed.success).toBe(true);
    expect(DeleteDataResponseSchema.safeParse({ object: 'task', id: 't1', deleted: true }).success)
      .toBe(false);
  });

  for (const [surface, del] of [
    ['client.data.delete', (c: ObjectStackClient) => c.data.delete('task', 't1')],
    ['client.environment(id).data.delete', (c: ObjectStackClient) => c.environment('proj-xyz').data.delete('task', 't1')],
  ] as const) {
    describe(surface, () => {
      it('hands back the spec body, and `success` is reachable through the declared type', async () => {
        const { client } = createMockClient(SPEC_BODY);
        const r: DeleteDataResult = await del(client);

        // The typed read. Under the pre-#5638 declaration this line is
        // TS2339 (`success` does not exist) — and the line a consumer WOULD
        // have written, `r.deleted`, compiled and evaluated to `undefined`.
        expect(r.success).toBe(true);
        expect(r.object).toBe('task');
        expect(r.id).toBe('t1');

        // `z.object` strips unknown keys, so a passing `safeParse` cannot by
        // itself prove no stray `deleted` came along (the #5641 caveat).
        // Assert the key set literally as well.
        expect(DeleteDataResponseSchema.safeParse(r).success).toBe(true);
        expect(Object.keys(r).sort()).toEqual(['id', 'object', 'success']);
        expect('deleted' in (r as object)).toBe(false);
      });

      it('does not manufacture `success` — an off-spec body passes through verbatim', async () => {
        // Contract-first: the fix belongs in the type (and, for the server,
        // in #5581), NOT in a tolerant consumer that reads
        // `body.success ?? body.deleted`. If someone ever adds that alias,
        // this test is where it shows up.
        const { client } = createMockClient({ object: 'task', id: 't1', deleted: true });
        const r = await del(client) as unknown as Record<string, unknown>;

        expect(r.success).toBeUndefined();
        expect(r.deleted).toBe(true);
      });
    });
  }
});
