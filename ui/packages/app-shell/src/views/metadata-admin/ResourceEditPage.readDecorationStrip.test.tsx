// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins that the framework's READ DECORATIONS never reach the client edit gate
 * through the pending-draft merge (objectui#7603).
 *
 * ## The defect this file exists to keep fixed
 *
 * `client.getDraft()` serves a DECORATED body: the strict draft branch returns
 * `item: decorateMetadataItem(type, …)`, which attaches `_diagnostics` whenever
 * the type has a registered Zod schema, and `_draft` on the preview-draft
 * branch. The spec names both a READ-TIME decoration and says a served body
 * "is therefore NOT a valid input to the schema that produced it until these
 * are removed" — `METADATA_READ_DECORATIONS` in the spec kernel.
 *
 * `ResourceEditPage` merges that body over the layered baseline
 * (`{ ...baseline, ...draftReal }`) and hands the result to
 * `validateMetadataDraft`. The baseline half is clean — `getMetaItemLayered`
 * serves RAW layers — so the decoration arrives ONLY when the item has a
 * pending draft, which is why this stayed invisible: a no-draft case passes
 * today and cannot catch it. Every wired metadata type whose schema is
 * `.strict()` then reported a body THE SERVER ACCEPTS as `unrecognized_keys`,
 * putting a false "this item is invalid" banner plus inline field errors on an
 * author who is mid-edit.
 *
 * ## Why the fixture must carry a pending draft
 *
 * ⚠️ Drop the `getDraft` item from these cases and both of them still pass,
 * while the defect is fully present. The pending draft IS the trigger.
 *
 * ## The two directions, and why the second one is not optional
 *
 * A strip is only correct if it removes the framework's own keys and NOTHING
 * else. `unrecognizedGate` below feeds the same pending-draft path a body that
 * carries the two decorations AND one genuinely undeclared key, and requires
 * the gate to still refuse — naming the real key and neither decoration. That
 * case is also this file's CONTROL: it proves the gate actually runs on the
 * merged draft in this harness, so the first case's "no issues" is a measured
 * verdict rather than a validator that never fired.
 *
 * ⛔ The cure is never to loosen a schema. The ADR-0010 envelope keys
 * (`_lock`, `_provenance`, …) are allowlisted by the closed schemas ON PURPOSE
 * so provenance survives a re-parse; the decorations are not, and a gate that
 * tolerated them would destroy that distinction (AGENTS.md #0.1).
 *
 * ## Where the strip lives
 *
 * In `extractDraftBody` — the one function that turns a served draft envelope
 * into a body, and the chokepoint all THREE merge sites go through (the load
 * effect, the post-save refresh and the post-publish refresh). It reuses the
 * spec's exported `stripReadDecorations`, the same helper
 * `MetadataService.saveFields` already reaches for. ⛔ Never a second
 * hand-maintained `['_diagnostics', '_draft']` in objectui: a local copy goes
 * stale the next time the framework adds a decoration, and a decoration this
 * code does not know to remove is precisely the defect above.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** A key the bundled spec does not declare — a GENUINE author-side defect. */
const UNDECLARED_KEY = 'zzUndeclaredKey';

/** Present only in the pending draft, so we can prove the merge ran. */
const DRAFT_ONLY_LABEL = 'Home (draft in flight)';

/** The published body, exactly as the RAW layered read serves it: clean. */
const PUBLISHED_PAGE = {
  name: 'home',
  label: 'Home',
  type: 'home',
  template: 'default',
  regions: [{ name: 'main', components: [{ type: 'text', id: 'b1' }] }],
};

/**
 * The framework's read-time decorations, spelled out because this fixture is
 * standing in for a real served body. ⛔ Not imported from the spec: a fixture
 * that derives its own input from the list under test would pass even if that
 * list were emptied. The PRODUCTION strip is the thing that must read the
 * spec, and it does.
 */
const READ_DECORATIONS = {
  _diagnostics: { valid: true, errors: [], warnings: [] },
  _draft: true,
};

/** A served draft envelope: `{ type, name, item }` with the item decorated. */
const draftEnvelope = (extra: Record<string, unknown> = {}) => ({
  type: 'page',
  name: 'home',
  item: { ...PUBLISHED_PAGE, label: DRAFT_ONLY_LABEL, ...READ_DECORATIONS, ...extra },
});

/**
 * Records what the REAL gate was asked to judge and what it answered.
 *
 * The assertions read this rather than the banner on purpose: the banner is a
 * rendering of the verdict, while this is the verdict — the same measurement
 * the card reports (`body + _diagnostics -> REJECT unrecognized_keys`).
 */
const gate = vi.hoisted(() => ({
  calls: [] as Array<{ draft: Record<string, unknown>; ok: boolean; issues: Array<{ path: string; message: string }> }>,
}));

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: PUBLISHED_PAGE, code: PUBLISHED_PAGE, editable: true })),
  getDraft: vi.fn(async () => draftEnvelope()),
  get: vi.fn(async () => null),
  saveDraft: vi.fn(async () => ({})),
}));

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      entries: [
        {
          type: 'page',
          name: 'page',
          label: 'Page',
          allowEnvironmentOverlay: true,
          // The most lenient live server there can be. It is handed to the
          // cross-repo spec-skew cure, which only drops TOP-LEVEL absent
          // required fields — it structurally cannot suppress an
          // `unrecognized_keys` issue, whose path is empty. So no server hint
          // can rescue a decorated body; only the strip can.
          schema: { required: [] },
        },
      ],
    }),
  };
});

/**
 * The gate itself is REAL — this wrapper only records. Stubbing the verdict
 * would leave the assertions measuring the stub.
 */
vi.mock('./clientValidation.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./clientValidation')>();
  return {
    ...mod,
    validateMetadataDraft: async (
      ...args: Parameters<typeof mod.validateMetadataDraft>
    ): Promise<Awaited<ReturnType<typeof mod.validateMetadataDraft>>> => {
      const res = await mod.validateMetadataDraft(...args);
      gate.calls.push({
        draft: (args[1] ?? {}) as Record<string, unknown>,
        ok: res.ok,
        issues: res.issues,
      });
      return res;
    },
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerBuiltinInspectors } from './inspectors';

registerBuiltinInspectors();

beforeEach(() => {
  gate.calls.length = 0;
  mockClient.getDraft.mockImplementation(async () => draftEnvelope());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function openEditor() {
  render(
    <MemoryRouter initialEntries={['/metadata/page/home']}>
      <MetadataResourceEditPage type="page" name="home" />
    </MemoryRouter>,
  );
}

/**
 * The LAST verdict taken on the merged draft — the one the pending draft won.
 *
 * Index arithmetic rather than `Array.prototype.findLast`: this package's
 * `type-check` compiles against a lib older than es2023, where that method does
 * not exist on the type. It runs fine under vitest, so the failure would have
 * been `tsc`-only — green tests, red CI.
 */
function lastMergedVerdict() {
  const merged = gate.calls.filter((c) => c.draft.label === DRAFT_ONLY_LABEL);
  return merged[merged.length - 1];
}

/**
 * Wait for the gate to judge the MERGED draft. Anchoring on `DRAFT_ONLY_LABEL`
 * is what makes every later assertion be about the pending-draft path: a
 * verdict taken on the baseline-only draft would be clean for a reason that has
 * nothing to do with this fix.
 */
async function awaitMergedVerdict() {
  await waitFor(
    () => {
      expect(lastMergedVerdict(), 'the gate never judged the merged pending draft').toBeDefined();
    },
    { timeout: 4000 },
  );
  return lastMergedVerdict()!;
}

const keysNamedIn = (issues: Array<{ message: string }>) => issues.map((i) => i.message).join(' | ');

describe('MetadataResourceEditPage — read decorations never reach the edit gate (#7603)', () => {
  it('accepts a served body whose pending draft carries `_diagnostics` and `_draft`', async () => {
    openEditor();
    const verdict = await awaitMergedVerdict();

    // The decorations were on the wire…
    expect(await mockClient.getDraft.mock.results[0]!.value).toMatchObject({
      item: { _diagnostics: expect.anything(), _draft: true },
    });
    // …and did NOT survive into what the gate judged.
    expect(Object.keys(verdict.draft)).not.toContain('_diagnostics');
    expect(Object.keys(verdict.draft)).not.toContain('_draft');

    // The verdict itself: the body the server accepts, the client accepts.
    expect(verdict.issues, keysNamedIn(verdict.issues)).toEqual([]);
    expect(verdict.ok).toBe(true);

    // …and the author sees no "this item is invalid" banner.
    expect(screen.queryByTestId('metadata-validation-banner')).not.toBeInTheDocument();

    // The author's own content survived the strip untouched.
    expect(verdict.draft.label).toBe(DRAFT_ONLY_LABEL);
    expect(verdict.draft.regions).toEqual(PUBLISHED_PAGE.regions);
  });

  it('still refuses a genuinely undeclared key riding the same decorated draft', async () => {
    mockClient.getDraft.mockImplementation(async () => draftEnvelope({ [UNDECLARED_KEY]: 1 }));
    openEditor();
    const verdict = await awaitMergedVerdict();

    // The strip is not a "drop whatever the schema refuses" pass: an author's
    // real defect still fails, loudly, and by name.
    expect(verdict.ok).toBe(false);
    expect(keysNamedIn(verdict.issues)).toContain(UNDECLARED_KEY);

    // …and neither decoration is named alongside it — the strip took exactly
    // the framework's own keys and left the author's.
    expect(keysNamedIn(verdict.issues)).not.toContain('_diagnostics');
    expect(keysNamedIn(verdict.issues)).not.toContain('_draft');

    // The banner is the CONTROL for the previous case: it fires here, in this
    // same harness, on this same pending-draft path.
    const banner = await screen.findByTestId('metadata-validation-banner', undefined, { timeout: 4000 });
    expect(banner).toHaveTextContent(UNDECLARED_KEY);
  });
});
