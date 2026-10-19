// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The CRUD stage's verdict on a refused create, read from the WHOLE answer.
//
// `runCrudVerification` sorts a refused create into two rows: a 400 validation
// answer is `needs-fixture` (the auto-derived record did not satisfy the app's
// own rules), anything else is `create-failed` (a hard failure that makes
// `os verify` exit 1). The row stores at most 280 characters of the body as its
// `detail`. The `/data` door's validation envelope puts the app-authored message
// FIRST and `code` after it, so a long message pushes `"code":"VALIDATION_FAILED"`
// past character 280: a verdict taken from the stored cut reads a validation
// answer as a hard failure. These cases pin the verdict to the whole body and
// the cut to the stored `detail` only.
//
// A stack double answers the create, so nothing here boots a stack: the unit
// under test is the classification, and the refusal bodies are the `/data`
// door's flat envelope as it is written on the wire.

import { describe, it, expect } from 'vitest';

import type { VerifyStack } from './harness.js';
import { runCrudVerification, type ObjectVerifyResult } from './verify.js';

const OBJECT = 'vcr_forecast';
const config = {
  manifest: { id: 'com.example.verify-create-refusal', namespace: 'vcr', version: '0.0.1', type: 'app', name: 'Create Refusal Fixture' },
  objects: [{ name: OBJECT, label: 'Forecast', fields: { name: { type: 'text', label: 'Name' } } }],
};

/** A stack double whose only answer is the given response to the create. */
function answeringCreateWith(response: () => Response): VerifyStack {
  return {
    async apiAs(_token: string, method: string, path: string) {
      if (method === 'POST' && path === `/data/${OBJECT}`) return response();
      throw new Error(`unexpected ${method} ${path}: the stage must stop at a refused create`);
    },
  } as unknown as VerifyStack;
}

async function verdictFor(response: () => Response): Promise<ObjectVerifyResult> {
  const report = await runCrudVerification(answeringCreateWith(response), 'token', config);
  expect(report.results).toHaveLength(1);
  return report.results[0];
}

/** The `/data` door's validation envelope, in its wire key order. */
const validationEnvelope = (message: string) => ({
  error: message,
  code: 'VALIDATION_FAILED',
  fields: [{ field: '_record', code: 'rule_violation', message }],
  object: OBJECT,
});

// Three sentences, as an app's forecast rule writes them: long enough that the
// envelope's `code` lands past the stored cut.
const LONG_MESSAGE =
  'A forecast must name the fiscal period it commits to before it can be saved. ' +
  'The committed amount cannot exceed the best-case amount, and the best-case amount cannot exceed the pipeline amount. ' +
  'Ask the forecast owner to set the period and reconcile the three amounts, then submit the forecast again for approval.';

describe('runCrudVerification — the verdict on a refused create reads the whole answer', () => {
  it('a 400 VALIDATION_FAILED whose message runs past 280 characters is needs-fixture, and the stored detail keeps its cut', async () => {
    const text = JSON.stringify(validationEnvelope(LONG_MESSAGE));
    // The fixture exercises the defect: the code is NOT inside the stored cut.
    expect(text.indexOf('"code":"VALIDATION_FAILED"')).toBeGreaterThan(280);

    const r = await verdictFor(() => new Response(text, { status: 400, headers: { 'content-type': 'application/json' } }));
    expect(r).toMatchObject({ object: OBJECT, status: 'needs-fixture', code: 400 });
    expect(r.detail).toBe(text.slice(0, 280));
    expect(r.detail!.length).toBeLessThanOrEqual(280);
  });

  it('control: a short 400 VALIDATION_FAILED is needs-fixture', async () => {
    const r = await verdictFor(() => Response.json(validationEnvelope('A forecast must name its fiscal period.'), { status: 400 }));
    expect(r).toMatchObject({ object: OBJECT, status: 'needs-fixture', code: 400 });
  });

  it('control: a 5xx is create-failed', async () => {
    const r = await verdictFor(() => Response.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 }));
    expect(r).toMatchObject({ object: OBJECT, status: 'create-failed', code: 500 });
  });

  it('control: a 400 with another code is create-failed', async () => {
    const r = await verdictFor(() =>
      Response.json({ error: `Unknown field 'region' on object '${OBJECT}'`, code: 'INVALID_FIELD', object: OBJECT }, { status: 400 }),
    );
    expect(r).toMatchObject({ object: OBJECT, status: 'create-failed', code: 400 });
  });

  it('control: a 400 that is not JSON is read as text with the original pattern', async () => {
    const r = await verdictFor(() => new Response('Validation failed: name is required', { status: 400 }));
    expect(r).toMatchObject({ object: OBJECT, status: 'needs-fixture', code: 400 });
  });
});
