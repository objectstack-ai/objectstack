// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An embedded item's refused parent save reads the PARSED error, whichever
 * door served it (objectui#11379).
 *
 * `EmbeddedItemEditor` saves an embedded item (`object.fields.amount`) by
 * PUTting the whole parent, and maps the parent's spec-validation issues back
 * onto the sub-form. `MetadataClient`'s `parseError` already reads every live
 * wire shape onto `err.issues`; the editor used to re-read the raw
 * `err.body.issues` instead, which only the REST door fills. On the HTTP
 * dispatcher's shape the issues sit under `body.error.details.issues`, so the
 * editor found none: the banner counted zero issues and no field was marked.
 *
 * Every error below is built by the real parser from a wire body, so a test
 * cannot pass on a field the parser would never set. The editor is mounted
 * directly, as its sibling suites do (`EmbeddedItemEditor.preview.test.tsx`
 * says why the drawer is not).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MetadataClient, type MetadataError } from '@object-ui/data-objectstack';

const FIELD_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string', title: 'Label' },
    description: { type: 'string', title: 'Description' },
  },
} satisfies Record<string, unknown>;

const mocks = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => ({
    // No pending draft: the save reads the published parent (objectui#12027).
    getDraft: async () => null,
    layered: async () => ({
      effective: { name: 'sales_order', fields: { amount: { type: 'number', label: 'Amount' } } },
      code: null,
      overlay: null,
      overlayScope: null,
    }),
    save: mocks.save,
  }),
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'field', label: 'Field', allowEnvironmentOverlay: true, schema: FIELD_SCHEMA }],
  }),
}));

import { EmbeddedItemEditor } from './EmbeddedItemEditor';

beforeEach(() => {
  mocks.save.mockReset();
});

afterEach(cleanup);

/** The error the editor catches, built by the real client from a wire body. */
async function parsedRefusal(status: number, wire: unknown): Promise<MetadataError> {
  const client = new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async () =>
      new Response(JSON.stringify(wire), {
        status,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
  });
  try {
    await client.save('object', 'sales_order', {});
  } catch (e) {
    return e as MetadataError;
  }
  throw new Error('the stub transport accepted the save: there is no refusal to hand the editor');
}

/** A distinctive prescription, so a test can tell it from any headline text. */
const ISSUE_MESSAGE = 'A field label must not be empty';
/** The parent-relative path the server names; the editor trims it to `label`. */
const PARENT_PATH = 'fields.amount.label';

function refusalWire(shape: 'rest' | 'dispatcher') {
  const message = `[invalid_metadata] object/sales_order failed spec validation: 1 issue — ${PARENT_PATH} [custom]`;
  const issues = [{ path: PARENT_PATH, message: ISSUE_MESSAGE, code: 'custom' }];
  return shape === 'rest'
    ? { error: message, code: 'INVALID_METADATA', issues }
    : { success: false, error: { code: 'INVALID_METADATA', message, details: { issues } } };
}

function openAmountField() {
  render(
    <EmbeddedItemEditor
      parentType="object"
      parentName="sales_order"
      embeddedPath="fields"
      itemName="amount"
      editAs="field"
      initialRaw={{ name: 'amount', label: 'Amount' }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /save into object/i }));
}

describe('EmbeddedItemEditor — a refused parent save is read off the parsed error (objectui#11379)', () => {
  it.each(['dispatcher', 'rest'] as const)(
    '422 on the %s shape: the issue lands on the sub-form field and the banner counts it',
    async (shape) => {
      mocks.save.mockRejectedValueOnce(await parsedRefusal(422, refusalWire(shape)));

      openAmountField();

      expect(await screen.findByText('Validation failed (1 issue).')).toBeInTheDocument();
      expect(screen.getByText(ISSUE_MESSAGE)).toBeInTheDocument();
      expect(mocks.save).toHaveBeenCalledTimes(1);
    },
  );

  it('CONTROL: a non-422 refusal shows the server message as the banner', async () => {
    const message = 'The metadata store is temporarily unavailable.';
    mocks.save.mockRejectedValueOnce(
      await parsedRefusal(503, { success: false, error: { code: 'SERVICE_UNAVAILABLE', message } }),
    );

    openAmountField();

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText(/Validation failed/)).toBeNull();
  });
});
