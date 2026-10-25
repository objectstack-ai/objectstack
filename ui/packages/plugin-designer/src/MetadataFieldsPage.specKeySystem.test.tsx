/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6044 — the Field Designer reads the system-field marker under the
 * spec's spelling `system`, and never hands `isSystem` back to the API.
 *
 * Surfaced by the key-level parity gate built for objectui#5761
 * (`scripts/check-designer-field-key-parity.mjs`). `isSystem` is not in
 * `FieldSchema`'s accept set; the spec spells it `system`. Measured against the
 * installed `@objectstack/spec` 17.2.0:
 *
 *   FieldSchema.safeParse({ type: 'text', label: 'L', isSystem: true })
 *     => success = false
 *     => unrecognized_keys keys=["isSystem"]
 *        "Did you mean `isSystem` -> `system`?"
 *
 * ## Two defects, one misspelling — and they are two DIFFERENT sites
 *
 * READ (the quieter, worse half). `toDesignerField` read `raw.isSystem`. `raw`
 * is what the server sent and a spec-parsed server sends `system`, so the flag
 * was always `undefined`. Nothing went red, because the flag is OPTIONAL —
 * `undefined` is a valid "not a system field". But it is load-bearing in the
 * UI: `FieldDesigner` refuses to delete a system field and disables its name
 * and type inputs, so with the read dead `organization_id`, `created_at` and
 * friends presented as ordinary editable, DELETABLE business fields.
 *
 * WRITE. This one has no emit site at all — `fromDesignerField` never names
 * `isSystem`. Its only route out is the verbatim `...carryOver(prev)` spread,
 * so the fix is a `RETIRED_FIELD_KEYS` tombstone rather than a renamed line.
 * That answers the question the card left open: the round-trip and the
 * detection read are SEPARATE sites, and neither of them is in
 * `app-shell/services/MetadataService.ts` — `FieldMetadataPayload` never
 * declared the key, so `toFieldPayload` has nothing to fix.
 *
 * ⛔ Not resolved by the tombstone alone. Stripping `isSystem` without fixing
 * the read would close the 422 and FOSSILIZE the dead detection, which is the
 * scope constraint this card carries.
 *
 * Written against the wire like its siblings: a REAL `MetadataClient` over a
 * fetch double, assertions on the captured PUT bytes.
 *
 * This file names no `reference`/`referenceTo` key anywhere, and its sibling
 * `MetadataFieldsPage.specKeyReference.test.tsx` names no system key: the two
 * cards of this fold are independently verifiable, and reverting one fix must
 * red only its own file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { FieldSchema } from '@objectstack/spec/data';
import { MetadataClient } from '@object-ui/data-objectstack';

/**
 * The object document as it lives in the database.
 *
 *   `organization_id` carries what a SPEC-PARSED SERVER sends — `system`. That
 *   is the read case.
 *   `legacy_flag` carries the misspelling, which `carryOver` would otherwise
 *   spread straight back out to the route that rejects it.
 *   `nickname` is an ordinary business field, and it is the control: a harness
 *   whose two principals degenerate to the same value cannot tell a working
 *   read from a dead one, so the suite asserts BOTH states.
 */
const OBJECT_BODY = {
  name: 'probe_widget',
  label: 'Widget',
  fields: {
    nickname: { type: 'text', label: 'Nickname' },
    organization_id: { type: 'text', label: 'Organization', system: true, readonly: true },
    legacy_flag: { type: 'text', label: 'Legacy', isSystem: true },
  },
};

const OBJECT_ENVELOPE = {
  type: 'object',
  name: 'probe_widget',
  item: OBJECT_BODY,
  lock: 'none',
  provenance: 'org',
  editable: true,
};

interface RecordedDesignerProps {
  objectName: string;
  fields: Array<{ name: string; label: string; isSystem?: boolean }>;
  onFieldsChange?: (fields: RecordedDesignerProps['fields']) => void;
  readOnly?: boolean;
}

let designerProps: RecordedDesignerProps | null = null;

vi.mock('./FieldDesigner', () => ({
  FieldDesigner: (props: RecordedDesignerProps) => {
    designerProps = props;
    return null;
  },
}));

import { MetadataFieldsPage } from './MetadataFieldsPage';

let puts: Array<Record<string, unknown>> = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function realClient(): MetadataClient {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PUT') {
        puts.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return json({ success: true, name: 'probe_widget' });
      }
      if (/\/meta\/object\/probe_widget(\?|$)/.test(url)) return json(OBJECT_ENVELOPE);
      return json({ items: [] });
    }) as unknown as typeof fetch,
  });
}

async function renderPage() {
  render(<MetadataFieldsPage objectName="probe_widget" client={realClient()} />);
  await waitFor(() => expect(designerProps).not.toBeNull());
}

/** The fields map exactly as it went over the wire on the last PUT. */
function savedFields(): Record<string, Record<string, unknown>> {
  // Indexed rather than `.at(-1)`: `Array.prototype.at` is ES2022, and this
  // package's own `tsconfig.test.json` owns the `lib` level that decides
  // whether it type-checks — read that off the `lib` section of
  // `pnpm census:tsconfig-test-parity`. ⛔ Don't restate its answer here: the
  // sentence this replaces did, and went false the moment the level moved
  // (objectui#9513). Index arithmetic asks no `lib` question at all.
  return puts[puts.length - 1].fields as Record<string, Record<string, unknown>>;
}

const unrecognizedKeys = (result: ReturnType<typeof FieldSchema.safeParse>): string[] =>
  result.success
    ? []
    : result.error.issues
        .filter((i) => i.code === 'unrecognized_keys')
        .flatMap((i) => (i as unknown as { keys: string[] }).keys);

/** A plain relabel — the smallest edit that re-serialises every field. */
async function relabel(fieldName: string, label: string) {
  const next = designerProps!.fields.map((f) => (f.name === fieldName ? { ...f, label } : f));
  await act(async () => {
    designerProps!.onFieldsChange!(next);
  });
  await waitFor(() => expect(puts).toHaveLength(1));
}

beforeEach(() => {
  puts = [];
  designerProps = null;
});

afterEach(() => {
  designerProps = null;
});

describe('the instrument', () => {
  it('is the installed spec schema and it is STRICT — unknown keys are refused, not stripped', () => {
    const result = FieldSchema.safeParse({ type: 'text', label: 'L', zzzDefinitelyNotAKey: 1 });
    expect(result.success).toBe(false);
    expect(unrecognizedKeys(result)).toContain('zzzDefinitelyNotAKey');
  });

  it('refuses `isSystem` by name and accepts `system` — the two states this file distinguishes', () => {
    expect(unrecognizedKeys(FieldSchema.safeParse({ type: 'text', label: 'L', isSystem: true })))
      .toEqual(['isSystem']);
    expect(FieldSchema.safeParse({ type: 'text', label: 'L', system: true }).success).toBe(true);
  });
});

describe('objectui#6044 · READ — system-field detection sees the key the server sends', () => {
  it('a field the server marks `system` reaches the designer as a system field', async () => {
    await renderPage();
    const org = designerProps!.fields.find((f) => f.name === 'organization_id')!;
    // Before this fix the reader looked for `raw.isSystem`, so this was
    // `undefined` — and `undefined` is a VALID "not a system field", which is
    // why nothing ever went red while `organization_id` rendered as an
    // ordinary editable, deletable business field.
    expect(org.isSystem).toBe(true);
    // Falsification: the field itself arrived intact.
    expect(org.label).toBe('Organization');
  });

  it('an ordinary business field is NOT flagged — the other state of the world', async () => {
    await renderPage();
    const nickname = designerProps!.fields.find((f) => f.name === 'nickname')!;
    expect(nickname.isSystem).toBeFalsy();
  });
});

describe('objectui#6044 · WRITE — the save never hands `isSystem` back', () => {
  it('strips a stored `isSystem` from the round-trip', async () => {
    // `fromDesignerField` never names this key: its only route out is the
    // verbatim `carryOver` spread, so this asserts the tombstone, not an emit
    // site.
    await renderPage();
    await relabel('nickname', 'Nick');

    const fields = savedFields();
    expect('isSystem' in fields.legacy_flag).toBe(false);
    // Falsification: the strip removed a key, not the field.
    expect(fields.legacy_flag.type).toBe('text');
    expect(fields.legacy_flag.label).toBe('Legacy');
  });

  it('keeps the spec-spelled `system` the server injected', async () => {
    // ⚠ This case would still pass on a revert of either half: `system` is a
    // real `FieldSchema` key and `carryOver` has always spread it through. It
    // is asserted because the tombstone must not over-reach — stripping the
    // spec spelling too would make the read it feeds permanently dead.
    await renderPage();
    await relabel('nickname', 'Nick');

    expect(savedFields().organization_id.system).toBe(true);
  });

  it('every field it PUTs parses through the real FieldSchema', async () => {
    await renderPage();
    await relabel('nickname', 'Nick');

    for (const [name, def] of Object.entries(savedFields())) {
      const result = FieldSchema.safeParse(def);
      expect(unrecognizedKeys(result), `field \`${name}\` emitted a refused key`).toEqual([]);
      expect(result.success, `field \`${name}\` did not parse`).toBe(true);
    }
    // Falsification: the edit that triggered the save actually landed.
    expect(savedFields().nickname.label).toBe('Nick');
  });
});
