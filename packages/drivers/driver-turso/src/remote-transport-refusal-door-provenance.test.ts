// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20020] The remote transport's twins of `driver-sql`'s four refusal doors
 * read the #8220 filter-subtree provenance mark too.
 *
 * `TursoDriver` picks this compiler or the inherited `SqlDriver` one by `url`,
 * so a door that withholds on one face and discloses on the other would make
 * the disclosure a property of the connection string. Three of the four doors
 * have a twin here and each named the predicate's field (and, for two, its
 * comparand) whatever the mark said: a retired or unknown operator (plus the
 * arm of the same method that answers a non-operator key in an operator map),
 * a combinator whose operand is not a list, and a non-boolean `$null` /
 * `$exists`. The fourth — a WHERE column the table lacks — has no refusal on
 * this face at all: the transport's `find` answers it with `[]`, so it names
 * nothing, and it is not moved here.
 *
 * Per door, the contract in `filter-subtree-provenance.ts`: policy-marked and
 * unmarked ⇒ `INVALID_FILTER` / 400 with the operands withheld and sent to the
 * diagnostic sink; author-marked ⇒ the full text; inside a merged `$and` the
 * refusing arm's mark decides.
 */

import { describe, it, expect, vi } from 'vitest';
import { RemoteTransport } from './remote-transport.js';
import { markFilterSubtreeProvenance } from '@objectstack/spec/data';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const POLICY_COL = 'secret_policy_col';
const SECRET = 'PSECRET_LITERAL';

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

const refusalOf = async (where: unknown) => {
  const { t, sink, client } = transport();
  try {
    await t.find('deal', { where } as never);
  } catch (e) {
    expect(client.execute, 'a refused filter must not execute a statement').not.toHaveBeenCalled();
    return { err: e as WireBearingError, sink: sink.join('\n') };
  }
  throw new Error('expected the transport to refuse this filter, but it resolved');
};

const DOORS: ReadonlyArray<{
  readonly name: string;
  readonly where: () => Record<string, unknown>;
  readonly secrets: readonly string[];
  readonly klass: string;
}> = [
  {
    name: 'a RETIRED operator',
    where: () => ({ [POLICY_COL]: { $regex: `^${SECRET}` } }),
    secrets: [POLICY_COL, '$regex'],
    klass: 'is RETIRED',
  },
  {
    name: 'an operator outside the vocabulary',
    where: () => ({ [POLICY_COL]: { $sounds_like: SECRET } }),
    secrets: [POLICY_COL, '$sounds_like'],
    klass: 'not compiled in remote mode',
  },
  {
    name: 'a non-operator key in an operator map',
    where: () => ({ [POLICY_COL]: { secret_relation_key: SECRET } }),
    secrets: [POLICY_COL, 'secret_relation_key'],
    klass: 'a key that is not an operator',
  },
  {
    name: 'a combinator whose operand is an OBJECT',
    where: () => ({ $or: { [POLICY_COL]: SECRET } }),
    secrets: [POLICY_COL, SECRET],
    klass: 'requires an array of filter conditions',
  },
  {
    name: 'a combinator whose operand is a PRIMITIVE',
    where: () => ({ $and: SECRET }),
    secrets: [SECRET],
    klass: 'requires an array of filter conditions',
  },
  {
    name: 'a non-boolean $null',
    where: () => ({ [POLICY_COL]: { $null: SECRET } }),
    secrets: [POLICY_COL, SECRET],
    klass: 'Operator "$null" in this filter requires a boolean comparand',
  },
  {
    name: 'a non-boolean $exists',
    where: () => ({ [POLICY_COL]: { $exists: SECRET } }),
    secrets: [POLICY_COL, SECRET],
    klass: 'Operator "$exists" in this filter requires a boolean comparand',
  },
];

const expectWithheld = (
  { err, sink }: { err: WireBearingError; sink: string },
  secrets: readonly string[],
  klass: string,
) => {
  expect(err.code).toBe('INVALID_FILTER');
  expect(err.status).toBe(400);
  for (const secret of secrets) expect(err.message, `names "${secret}"`).not.toContain(secret);
  expect(err.message).toContain(klass);
  for (const secret of secrets) expect(sink, `sink lost "${secret}"`).toContain(secret);
};

describe('[#20020] RemoteTransport refusal doors × filter-subtree provenance', () => {
  for (const door of DOORS) {
    describe(door.name, () => {
      it('policy-marked ⇒ same code and status, operands WITHHELD, and in the sink', async () => {
        expectWithheld(
          await refusalOf(markFilterSubtreeProvenance(door.where(), 'policy')),
          door.secrets,
          door.klass,
        );
      });

      it('author-marked ⇒ the full diagnostic, the text the withheld case sank', async () => {
        const policy = await refusalOf(markFilterSubtreeProvenance(door.where(), 'policy'));
        const author = await refusalOf(markFilterSubtreeProvenance(door.where(), 'author'));
        expect(author.err.code).toBe('INVALID_FILTER');
        expect(author.err.status).toBe(400);
        for (const secret of door.secrets) expect(author.err.message).toContain(secret);
        expect(policy.sink).toContain(author.err.message);
      });

      it('UNMARKED ⇒ withheld, byte-identical to policy', async () => {
        const unmarked = await refusalOf(door.where());
        expectWithheld(unmarked, door.secrets, door.klass);
        const policy = await refusalOf(markFilterSubtreeProvenance(door.where(), 'policy'));
        expect(unmarked.err.message).toBe(policy.err.message);
      });

      it("merged $and: the refusing arm's mark decides", async () => {
        const disclosed = await refusalOf({
          $and: [
            markFilterSubtreeProvenance({ stage: 'won' }, 'policy'),
            markFilterSubtreeProvenance(door.where(), 'author'),
          ],
        });
        for (const secret of door.secrets) expect(disclosed.err.message).toContain(secret);
        expectWithheld(
          await refusalOf({
            $and: [
              markFilterSubtreeProvenance({ stage: 'won' }, 'author'),
              markFilterSubtreeProvenance(door.where(), 'policy'),
            ],
          }),
          door.secrets,
          door.klass,
        );
      });
    });
  }

  it('the local and remote withheld sentences for the flag doors are one sentence', async () => {
    // `driver-sql`'s withheld text, behind this file's `[RemoteTransport]`
    // prefix — one condition reads alike on both compilers of one driver.
    const { err } = await refusalOf({ [POLICY_COL]: { $null: SECRET } });
    expect(err.message.startsWith('[RemoteTransport] Operator "$null" in this filter requires a boolean comparand (true or false).')).toBe(true);
  });
});
