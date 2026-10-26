// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins the SAVE-GATE ASYMMETRY the editor is built on (objectui#6980).
 *
 * Two author-time error sources reach `ResourceEditPage`, and exactly one of
 * them gates Save:
 *
 *   - the scoped inspector's blocking issues (a CEL predicate that does not
 *     parse) — BLOCKING, because the server accepts that draft and publishing
 *     makes the malformed expression live (objectui#4306);
 *   - the live client Zod pass (`validateMetadataDraft`) — ADVISORY, because
 *     `saveMetaItem` runs the same contract and refuses the draft with a 422
 *     that `doSave` maps straight back into these same inline issues. The only
 *     failure the client can cause on its own is being STRICTER than the
 *     server, and that skew is real (objectstack#5316).
 *
 * From outside, "one of these blocks and the other doesn't" reads as a defect.
 * This suite exists so the asymmetry cannot be "fixed" by accident: adding
 * `issues.length` to the Save gate turns the first case below red.
 *
 * ## ⭐ The boundary, amended by objectui#8057 — read this before citing the above
 *
 * There is now a THIRD term in the Save gate, and it does block:
 *
 *     server-REFUSED   →  BLOCKS   (`refusalBlocking`, pinned by
 *                                   `ResourceEditPage.serverRefusalGate.test.tsx`)
 *     server-ACCEPTED  →  advisory (this suite, unchanged)
 *
 * That is not a narrowing of the ruling above, and the distinction is worth
 * getting right because the two are easy to conflate. Everything this suite
 * pins is about a verdict the client PREDICTS — and the reason it must not
 * block is spelled out in its own terms: the client may be STRICTER than the
 * server, so blocking would dead-bolt Save "on a draft the server accepts".
 * `refusalBlocking` is armed only by a 422 the server actually returned, so it
 * can never be armed by a draft the server accepts — there is no refusal to arm
 * it with. The dead-bolt this suite guards against stays unreachable, and no
 * prediction was promoted to a block.
 *
 * What objectui#8057 ended is narrower than it looks: the client used to
 * re-send a document the server had ALREADY refused, on every later edit,
 * reporting nothing — measured against a real 17.3.0 backend, where the
 * designer rendered a rename as applied while the server held none of it.
 *
 * ⛔ Neither suite may be cited without the other. A carve-out with only its
 * blocking half pinned is indistinguishable from having deleted this one.
 *
 * ## The fixture is the real skew shape, not a contrived one
 *
 * The stored page carries `zzServerOnlyKey` — a key the bundled
 * `@objectstack/spec` does not declare. That is objectstack#5316's exact shape
 * (a stored view carrying the platform's own `isPinned` / `sortOrder`), and it
 * is the class `clientValidation.ts`'s root-cure structurally cannot suppress:
 * the cure only drops TOP-LEVEL absent required fields (`path.length === 1`),
 * while `unrecognized_keys` arrives at `path.length === 0`. The mocked type
 * entry therefore hands the validator a MAXIMALLY LENIENT server schema
 * (`required: []` — a server that requires nothing at all) and the client
 * still rejects, which is the whole point: no server-schema hint can rescue
 * this class, so a blocking gate would dead-bolt Save on a draft the server
 * accepts.
 *
 * Stubbing mirrors `ResourceEditPage.celGate.test.tsx`: only the page CANVAS
 * is stubbed (to emit a selection) and the CEL engine is stubbed
 * deterministically. The Zod pass, the banner, the contract prop and this
 * host's real gating are all real.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** A key the bundled spec does not declare — the server-gained-a-key shape. */
const SERVER_ONLY_KEY = 'zzServerOnlyKey';

const PAGE = {
  name: 'home',
  label: 'Home',
  type: 'home',
  template: 'default',
  regions: [{ name: 'main', components: [{ type: 'text', id: 'b1', visibleWhen: 'record.amount > 10' }] }],
  [SERVER_ONLY_KEY]: 1,
};

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: PAGE, code: PAGE, editable: true })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  saveDraft: vi.fn(async () => ({})),
};

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
          // The live server schema handed to the skew root-cure. `required: []`
          // is the most lenient server there can be; it still cannot suppress
          // an `unrecognized_keys` issue, whose path is empty.
          schema: { required: [] },
        },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerBuiltinInspectors } from './inspectors';
import { registerMetadataPreview, getMetadataPreview, type MetadataSelection } from './preview-registry';
import { __setCelFormulaLoader } from './celAuthoring';

registerBuiltinInspectors();

const BLOCK_PATH = 'regions[0].components[0]';
const DANGLING = /[*+\-/&|=<>]\s*$/;

function stubEngine() {
  __setCelFormulaLoader(() =>
    Promise.resolve({
      validateExpression: (_role: string, input: unknown) => {
        const src = typeof input === 'string' ? input : String((input as { source?: string })?.source ?? '');
        return DANGLING.test(src)
          ? { ok: false, errors: [{ message: 'Parse error: expression ends after an operator' }], warnings: [] }
          : { ok: true, errors: [], warnings: [] };
      },
      introspectScope: () => ({ fields: ['amount'], roots: ['record'], functions: ['has'] }),
      inferExpressionType: () => 'boolean' as const,
    }),
  );
}

/** Canvas stand-in: emits the block selection the real canvas emits on click. */
function StubPageCanvas({
  onSelectionChange,
}: {
  onSelectionChange?: (next: MetadataSelection | null) => void;
}) {
  return (
    <button type="button" onClick={() => onSelectionChange?.({ kind: 'block', id: BLOCK_PATH })}>
      select the block
    </button>
  );
}

const realPagePreview = getMetadataPreview('page');

beforeEach(() => {
  stubEngine();
  registerMetadataPreview('page', StubPageCanvas as never);
});

afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
  if (realPagePreview) registerMetadataPreview('page', realPagePreview);
});

/** The Save button is an icon button identified by its title. */
// Title flipped to the neutral inspector copy by ruling 5831744213 (objectui#6900).
const saveButton = () =>
  screen.getByRole('button', { name: /Save \(⌘S\)|Fix the issues shown in the inspector before saving\./ });

/**
 * Dirty the draft with a predicate that parses, then WAIT FOR THE BANNER.
 *
 * The wait is the load-bearing part. The Zod pass is debounced 200ms, so a
 * `waitFor(() => expect(save).toBeEnabled())` would happily succeed on a render
 * taken before `issues` had landed — the suite would then pass even with the
 * gate wired to `issues.length`, which is precisely the regression it exists to
 * catch (measured: it did). Anchoring on the banner proves the validator ran on
 * THIS draft and rejected it, so the Save assertions that follow are taken at a
 * moment when `issues` is provably non-empty, and can be synchronous.
 */
async function dirtyAndAwaitSchemaError(box: HTMLTextAreaElement) {
  fireEvent.change(box, { target: { value: 'record.amount > 20' } });
  const banner = await screen.findByTestId('metadata-validation-banner', undefined, { timeout: 4000 });
  await waitFor(() => expect(banner).toHaveTextContent(SERVER_ONLY_KEY), { timeout: 4000 });
  return banner;
}

/** Open the editor, select the block, and switch its visibility control to raw CEL. */
async function openBlockCel() {
  render(
    <MemoryRouter initialEntries={['/metadata/page/home']}>
      <MetadataResourceEditPage type="page" name="home" />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'select the block' }));
  fireEvent.click(await screen.findByText('Expression'));
  return screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
}

describe('MetadataResourceEditPage — client Zod issues are ADVISORY, inspector issues BLOCK (#6980)', () => {
  it('surfaces a schema error the server would accept, and leaves Save enabled', async () => {
    const box = await openBlockCel();

    // The schema issue IS reported — advisory does not mean silent. This half
    // also keeps the pin honest: if the validator ever stopped running, the
    // "Save stays enabled" assertion below would pass vacuously.
    await dirtyAndAwaitSchemaError(box);

    // …and Save is NOT gated on it. Synchronous on purpose — see the helper.
    expect(saveButton()).toBeEnabled();
    expect(saveButton()).toHaveAttribute('title', expect.stringContaining('Save'));
  });

  it('blocks Save on an inspector CEL fault while that same schema error stands', async () => {
    const box = await openBlockCel();

    await dirtyAndAwaitSchemaError(box);
    expect(saveButton()).toBeEnabled();

    // Same draft, same unrecognized key, one added parse fault — and now Save
    // refuses. The contrast is the assertion: the two classes are treated
    // differently on purpose.
    fireEvent.change(box, { target: { value: 'record.amount >' } });
    await waitFor(() => expect(saveButton()).toBeDisabled(), { timeout: 4000 });
    expect(saveButton()).toHaveAttribute('title', 'Fix the issues shown in the inspector before saving.');
    expect(screen.getByTestId('metadata-validation-banner')).toHaveTextContent(SERVER_ONLY_KEY);
  });
});
