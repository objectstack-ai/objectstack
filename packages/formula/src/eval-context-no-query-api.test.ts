import { describe, expect, it } from 'vitest';

import { celEngine } from './cel-engine';
import { buildScope } from './stdlib';
import type { EvalContext } from './types';
import type { Expression } from '@objectstack/spec';

const cel = (source: string): Expression => ({ dialect: 'cel', source });

/**
 * `EvalContext` once declared an optional `api?: { exists, count, lookup }`,
 * and `buildScope()` never read it — so `os.exists` / `os.count` / `os.lookup`
 * reached no scope however well a call site cooperated. The member is gone;
 * these pins hold it gone in both directions: the type no longer accepts it,
 * and a context still carrying one at runtime binds nothing.
 *
 * The two runtime pins launder their context through `unknown` on purpose —
 * the shape they need is exactly the one the type no longer admits.
 */
describe('EvalContext carries no query API', () => {
  it('does not declare an `api` member (type-level pin)', () => {
    const ctx: EvalContext = {
      record: { amount: 10 },
      // @ts-expect-error `api` is not a member of EvalContext. If this
      // directive ever reports as unused, the retired kernel query API has
      // been re-declared without being bound — reopen the capability question
      // rather than restoring the declaration.
      api: { lookup: () => null },
    };

    expect(buildScope(ctx)).toEqual({ record: { amount: 10 } });
  });

  it('binds no `os` namespace from a context whose only key is a query api', () => {
    const scope = buildScope({ api: { exists: () => true } } as unknown as EvalContext);

    expect(scope).toEqual({});
    expect('os' in scope).toBe(false);
  });

  it('refuses a predicate calling os.lookup even when the call site supplies one', () => {
    const result = celEngine.evaluate(cel('os.lookup("crm_account", record.account_id) != null'), {
      record: { account_id: 'acc_1' },
      api: { lookup: () => ({ type: 'partner' }) },
    } as unknown as EvalContext);

    expect(result.ok).toBe(false);
  });
});
