// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8220, A of the #7929 ruling] The remote transport's half of the
 * provenance-aware withhold. `RemoteTransport` carries its OWN copy of the
 * cross-field refusal (`uncompilableComparand` — no executor compiles the
 * form in remote mode at all), so it consumes the spec's filter-subtree mark
 * itself, at its `buildWhereSQL` entry: an `'author'`-marked subtree gets the
 * operand-naming text back; `'policy'`, unmarked and a mark lost to a
 * serialization round-trip all keep the #7929 redaction. Leaving one mode
 * disclosing would make the disclosure a property of the connection string —
 * the same reason #8198 fixed both compilers at once.
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
  return { t, sink };
}

const refusalOf = async (run: () => Promise<unknown>): Promise<WireBearingError> => {
  try {
    await run();
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the transport to refuse this filter, but it resolved');
};

describe('[#8220] RemoteTransport cross-field refusal × filter-subtree provenance', () => {
  const crossField = () => ({ amount: { $gt: { $field: 'budget' } } });

  it("an 'author'-marked filter gets its operands back", async () => {
    const { t } = transport();
    const err = await refusalOf(() =>
      t.find('deal', { where: markFilterSubtreeProvenance(crossField(), 'author') }),
    );
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('deal.amount');
    expect(err.message).toContain('budget');
  });

  it("an 'author'-marked arm inside a merged $and discloses too", async () => {
    const { t } = transport();
    const authorArm = markFilterSubtreeProvenance(crossField(), 'author');
    const err = await refusalOf(() =>
      t.find('deal', { where: { $and: [{ stage: 'won' }, authorArm] } }),
    );
    expect(err.message).toContain('budget');
  });

  it("a 'policy'-marked filter keeps the redaction; the diagnostic reaches the sink", async () => {
    const { t, sink } = transport();
    const err = await refusalOf(() =>
      t.find('deal', { where: markFilterSubtreeProvenance(crossField(), 'policy') }),
    );
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.message).not.toContain('budget');
    expect(err.message).not.toContain('amount');
    expect(sink.join('\n')).toContain('budget');
  });

  it('an UNMARKED filter withholds byte-identically to a policy-marked one — the fail direction', async () => {
    const { t } = transport();
    const unmarked = await refusalOf(() => t.find('deal', { where: crossField() }));
    const policy = await refusalOf(() =>
      t.find('deal', { where: markFilterSubtreeProvenance(crossField(), 'policy') }),
    );
    expect(unmarked.message).toBe(policy.message);
    expect(unmarked.message).not.toContain('budget');
  });

  it('a serialization round-trip DROPS an author mark — the copy withholds', async () => {
    const { t } = transport();
    const marked = markFilterSubtreeProvenance(crossField(), 'author');
    const err = await refusalOf(() =>
      t.find('deal', { where: JSON.parse(JSON.stringify(marked)) }),
    );
    expect(err.message).not.toContain('budget');
  });

  it("the innermost mark wins: 'policy' nested under an 'author' root stays redacted", async () => {
    const { t } = transport();
    const scope = markFilterSubtreeProvenance(crossField(), 'policy');
    const where = markFilterSubtreeProvenance({ $and: [{ stage: 'won' }, scope] }, 'author');
    const err = await refusalOf(() => t.find('deal', { where }));
    expect(err.message).not.toContain('budget');
  });

  it('the non-$field comparand refusal is untouched — it never withheld, it never discloses more', async () => {
    // A Uint8Array comparand is refused by NAME with no redaction (#1058);
    // provenance resolution must leave errors that never carried the withheld
    // symbol exactly alone.
    const { t } = transport();
    const err = await refusalOf(() =>
      t.find('deal', { where: markFilterSubtreeProvenance({ amount: { $gt: new Uint8Array([1]) } } as never, 'author') }),
    );
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.message).toContain('deal.amount');
  });
});
