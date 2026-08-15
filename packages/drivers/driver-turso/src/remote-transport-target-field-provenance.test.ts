// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8197, maintainer ruling 2026-08-15] `RemoteTransport`'s half of the
 * TARGET-FIELD withhold.
 *
 * This transport carries its own copy of the unbindable-comparand refusal
 * (`uncompilableComparand`'s non-reference branch), and that copy named
 * `'object.field'`, the operator and a preview of the comparand — all three of
 * which belong to the administrator when the predicate came from a read scope.
 * `TursoDriver extends SqlDriver`, so one deployment answers from THIS compiler
 * or from `driver-sql`'s depending on connection mode: a guard that existed
 * twice and disagreed with itself would make the disclosure a property of the
 * connection string, which is the same reason #8198 fixed both compilers at
 * once and #8220 taught both to read one mark.
 *
 * The three populations are pinned together for the reason stated in the
 * `driver-sql` twin: a suite that only showed "policy is withheld" would pass
 * against a transport that withheld from EVERYONE, which is the blanket cost
 * the ruling refused.
 */

import { describe, it, expect, vi } from 'vitest';
import { RemoteTransport } from './remote-transport.js';
import { markFilterSubtreeProvenance } from '@objectstack/spec/data';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

function transport() {
  const client = {
    execute: vi.fn(async () => ({ rows: [], columns: [] })),
    close: vi.fn(),
  };
  const sink: string[] = [];
  const t = new RemoteTransport();
  t.setClient(client as any);
  t.setDiagnosticSink((m) => sink.push(m));
  return { t, sink, client };
}

const refusalOf = async (run: () => Promise<unknown>): Promise<WireBearingError> => {
  try {
    await run();
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the transport to refuse this filter, but it resolved');
};

describe('[#8197] RemoteTransport target-field refusal × filter-subtree provenance', () => {
  // A fresh graph per call: the mark is non-writable and first-mark-wins, so a
  // shared literal would carry one population's verdict into the next.
  const unbindable = () => ({ secret_policy_col: { $gt: { a: 1 } } });

  it('policy-marked ⇒ the target field, the operator and the comparand are WITHHELD', async () => {
    const { t, sink } = transport();
    const err = await refusalOf(() =>
      t.find('deal', { where: markFilterSubtreeProvenance(unbindable(), 'policy') }),
    );
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).not.toContain('secret_policy_col');
    expect(err.message).not.toContain('$gt');
    expect(err.message).not.toContain('{"a":1}');
    // The capability statement is not derived from the predicate, so it stays.
    expect(err.message).toContain('cannot bind');
    expect(sink.join('\n')).toContain('secret_policy_col');
  });

  it('author-marked ⇒ the full diagnostic is retained, target field included', async () => {
    const { t } = transport();
    const err = await refusalOf(() =>
      t.find('deal', { where: markFilterSubtreeProvenance(unbindable(), 'author') }),
    );
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('deal.secret_policy_col');
    expect(err.message).toContain('$gt');
  });

  it('UNMARKED ⇒ withheld, byte-identically to policy — the fail direction', async () => {
    const { t } = transport();
    const unmarked = await refusalOf(() => t.find('deal', { where: unbindable() }));
    const policy = await refusalOf(() =>
      t.find('deal', { where: markFilterSubtreeProvenance(unbindable(), 'policy') }),
    );
    expect(unmarked.message).toBe(policy.message);
    expect(unmarked.message).not.toContain('secret_policy_col');
  });

  it("the author's arm inside a merged $and discloses; the policy arm beside it does not", async () => {
    const { t } = transport();
    const authorArm = markFilterSubtreeProvenance(unbindable(), 'author');
    const disclosed = await refusalOf(() =>
      t.find('deal', { where: { $and: [markFilterSubtreeProvenance({ stage: 'won' }, 'policy'), authorArm] } }),
    );
    expect(disclosed.message).toContain('secret_policy_col');

    // Mirrored: same tree shape, the REFUSING arm is the policy one.
    const policyArm = markFilterSubtreeProvenance(unbindable(), 'policy');
    const withheld = await refusalOf(() =>
      t.find('deal', {
        where: { $and: [markFilterSubtreeProvenance({ stage: 'won' }, 'author'), policyArm] },
      }),
    );
    expect(withheld.message).not.toContain('secret_policy_col');
  });

  it('a serialization round-trip DROPS an author mark — the copy withholds', async () => {
    const { t } = transport();
    const marked = markFilterSubtreeProvenance(unbindable(), 'author');
    const err = await refusalOf(() => t.find('deal', { where: JSON.parse(JSON.stringify(marked)) }));
    expect(err.message).not.toContain('secret_policy_col');
  });

  it('an implicit-equality array comparand takes the same mark', async () => {
    // The bare `{ field: [...] }` spelling reaches the same refusal through the
    // other branch of the router, so it must not have its own verdict.
    const { t } = transport();
    const withheld = await refusalOf(() => t.find('deal', { where: { secret_policy_col: ['a'] } }));
    expect(withheld.message).not.toContain('secret_policy_col');
    const disclosed = await refusalOf(() =>
      t.find('deal', { where: markFilterSubtreeProvenance({ secret_policy_col: ['a'] }, 'author') }),
    );
    expect(disclosed.message).toContain('secret_policy_col');
  });

  it('every face that builds a WHERE resolves the mark, not just find', async () => {
    // `buildWhereSQL` resolves at its outermost frame, which all five external
    // call sites share — pinned so a face cannot acquire its own verdict.
    for (const run of [
      (where: any) => transport().t.count('deal', { where }),
      (where: any) => transport().t.updateMany('deal', { where }, { stage: 'won' }),
      (where: any) => transport().t.deleteMany('deal', { where }),
    ]) {
      const withheld = await refusalOf(() => run(unbindable()));
      expect(withheld.message).not.toContain('secret_policy_col');
      const disclosed = await refusalOf(() =>
        run(markFilterSubtreeProvenance(unbindable(), 'author')),
      );
      expect(disclosed.message).toContain('secret_policy_col');
    }
  });

  it('a filter that binds is still compiled — the withhold adds no refusal', async () => {
    const { t, client } = transport();
    await t.find('deal', { where: { stage: 'won' } });
    expect(client.execute).toHaveBeenCalled();
  });
});
