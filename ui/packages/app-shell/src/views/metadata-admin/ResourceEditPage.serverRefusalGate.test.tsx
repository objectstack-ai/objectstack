// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins the BLOCKING half of the save-gate carve-out (objectui#8057) — the half
 * `ResourceEditPage.schemaAdvisory.test.tsx` does not cover.
 *
 * ## The boundary these two suites pin between them
 *
 *   server-REFUSED  →  BLOCKS   (this suite)
 *   server-ACCEPTED →  advisory (`ResourceEditPage.schemaAdvisory.test.tsx`)
 *
 * "Advisory" was only ever about a verdict this client PREDICTS. A verdict the
 * server RETURNED is a different thing, and the objectui#4306 / #6980 reasoning
 * never covered it: that reasoning is conditioned on the server ACCEPTING the
 * draft, and a 422 is the server saying it does not. Neither suite may be read
 * without the other — a carve-out with only its blocking half pinned is
 * indistinguishable from having deleted the advisory ruling.
 *
 * ## The measured wedge, and why `inspectorBlocking` cannot close it
 *
 * objectui#8057 measured, against a real 17.3.0 backend: add a Lookup field
 * with an empty target, and the auto-save PUTs a document the server refuses
 * with `fields.lookup.reference`. Then rename an unrelated, already-saved
 * field — and the same half-filled document is PUT again, refused again, while
 * the designer renders the rename as applied and the server has none of it.
 *
 * The existing block (`inspectorBlocking`) is stamped with the current
 * SELECTION and expires when it changes — which IS step 2 of that
 * reproduction. So the discriminating pin in this file is not "the refused
 * document stops being sent"; it is **the block survives the selection moving
 * off the offending element**. An implementation that reuses `inspectorBlocking`
 * as-is passes every other assertion here and fails that one.
 *
 * ## Why each negative assertion carries a lit control
 *
 * "The refused document is not re-sent" is a claim about a call that did NOT
 * happen, and it passes vacuously in a harness where the save could never have
 * fired at all (not dirty, not editing, auto-save off, the draft never reaching
 * the gate). Every such assertion below is therefore paired with a control that
 * fires the same call on the same harness with the refusal absent.
 *
 * Stubbing mirrors the sibling suites: only the page CANVAS is stubbed (to emit
 * a selection) and the CEL engine is stubbed deterministically. The Zod pass,
 * the save doors, the gate and this host's real blocking are all shipping code.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient, type MetadataError } from '@object-ui/data-objectstack';

/**
 * Two blocks in one region. `OFFENDER` stands in for the half-filled lookup —
 * the element the server names — and `BYSTANDER` for the unrelated,
 * already-saved field the author renames in step 2.
 */
const OFFENDER_SEL = 'regions[0].components[1]';
const BYSTANDER_SEL = 'regions[0].components[0]';
/** The dot-joined form the server's `INVALID_METADATA` issues carry. */
const REFUSED_PATH = 'regions.0.components.1.visibleWhen';

const PAGE = {
  name: 'home',
  label: 'Home',
  type: 'home',
  template: 'default',
  regions: [
    {
      name: 'main',
      components: [
        { type: 'text', id: 'bystander', visibleWhen: 'record.amount > 10' },
        { type: 'text', id: 'offender', visibleWhen: 'record.amount > 20' },
      ],
    },
  ],
};

/**
 * The error the page catches, built the way production builds it: the wire
 * body goes through the REAL `MetadataClient`'s error parser (`parseError`).
 * A hand-assembled error object can carry a field the parser never sets, or
 * lack one it always sets — which is how this suite's fixture used to carry
 * `body.issues` and no `issues`, a shape no transport can produce (objectui#11379).
 */
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
    await client.save('page', 'home', {});
  } catch (e) {
    return e as MetadataError;
  }
  throw new Error('the stub transport accepted the save: there is no refusal to hand the page');
}

/** A distinctive prescription, so a test can tell it from any headline text. */
const ISSUE_MESSAGE = 'visibleWhen must name a field the page record declares';

/**
 * The two live wire shapes of one `INVALID_METADATA` refusal. `issues[]` is
 * set UNCONDITIONALLY beside the message on the throw site
 * (`metadata-protocol`'s `invalid_metadata` branch) and survives message
 * truncation on the wire, so the client sees structured `{path, message, code}`
 * — that is what makes the refused path localisable at all. The doors differ
 * in WHERE they put it:
 *
 * - `rest`: `@objectstack/rest`'s door — `error` a string, `issues` top-level.
 * - `dispatcher`: `@objectstack/runtime`'s `HttpDispatcher.errorFromThrown`
 *   (the `/meta` save branch) — `error` an OBJECT, `issues` under
 *   `error.details.issues`.
 */
function refusalWire(shape: 'rest' | 'dispatcher', path: string) {
  const message = `[invalid_metadata] page/home failed spec validation: 1 issue — ${path} [custom]`;
  const issues = [{ path, message: ISSUE_MESSAGE, code: 'custom' }];
  return shape === 'rest'
    ? { error: message, code: 'INVALID_METADATA', issues }
    : { success: false, error: { code: 'INVALID_METADATA', message, details: { issues } } };
}

function refusal(path: string, shape: 'rest' | 'dispatcher' = 'rest') {
  return parsedRefusal(422, refusalWire(shape, path));
}

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: PAGE, code: PAGE, editable: true })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  saveDraft: vi.fn(async () => ({})),
  save: vi.fn(async () => ({})),
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
          // The most lenient server schema there can be — so nothing below is
          // an artefact of the client's own Zod pass finding something.
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

function stubEngine() {
  __setCelFormulaLoader(() =>
    Promise.resolve({
      // Everything parses here: this suite is about the SERVER's verdict, and a
      // CEL fault would arm the OTHER block and confound every assertion.
      validateExpression: () => ({ ok: true, errors: [], warnings: [] }),
      introspectScope: () => ({ fields: ['amount'], roots: ['record'], functions: ['has'] }),
      inferExpressionType: () => 'boolean' as const,
    }),
  );
}

/** Canvas stand-in: lets a test select either block, as the real canvas does. */
function StubPageCanvas({
  onSelectionChange,
}: {
  onSelectionChange?: (next: MetadataSelection | null) => void;
}) {
  return (
    <>
      <button type="button" onClick={() => onSelectionChange?.({ kind: 'block', id: BYSTANDER_SEL })}>
        select bystander
      </button>
      <button type="button" onClick={() => onSelectionChange?.({ kind: 'block', id: OFFENDER_SEL })}>
        select offender
      </button>
    </>
  );
}

const realPagePreview = getMetadataPreview('page');

beforeEach(() => {
  vi.clearAllMocks();
  stubEngine();
  registerMetadataPreview('page', StubPageCanvas as never);
});

afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
  if (realPagePreview) registerMetadataPreview('page', realPagePreview);
});

/** The Save button, found by its title in every state this suite reaches. */
// Title flipped to the neutral inspector copy by ruling 5831744213 (objectui#6900).
const saveButton = () =>
  screen.getByRole('button', {
    name: /Save \(⌘S\)|The server refused this draft|Fix the issues shown in the inspector before saving\.|No changes to save/,
  });

/**
 * Is a REFUSAL what is holding Save shut?
 *
 * ⚠️ Not `toBeEnabled()`. After a save the server ACCEPTS, the draft is clean
 * again and the button is legitimately disabled as "No changes to save" — so
 * `toBeEnabled()` fails there for a reason that has nothing to do with this
 * gate, and would have made the advisory half look broken when it was not.
 * The question worth asking is which term is holding it.
 */
const refusalHoldsSave = () =>
  (saveButton().getAttribute('title') ?? '').includes('The server refused this draft');

/**
 * Open the editor and select `which`, returning that block's CEL textarea.
 *
 * The visibility control does not always need the "Expression" switch — it
 * already sits in expression mode whenever the selected block carries a CEL
 * string, and after a save round-trip it can come back that way. So the switch
 * is clicked only when the textarea is not already on screen; clicking it
 * unconditionally is what made three of these tests fail on the harness rather
 * than on the behaviour.
 */
async function selectAndOpenCel(which: 'bystander' | 'offender') {
  fireEvent.click(await screen.findByRole('button', { name: `select ${which}` }));
  const celBox = () =>
    screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as
      | HTMLTextAreaElement
      | undefined;
  if (!celBox()) {
    const tab = screen.queryByText('Expression');
    if (tab) fireEvent.click(tab);
  }
  return await waitFor(
    () => {
      const box = celBox();
      if (!box) throw new Error(`no CEL textarea for ${which}`);
      return box;
    },
    { timeout: 6000 },
  );
}

function openEditor() {
  render(
    <MemoryRouter initialEntries={['/metadata/page/home']}>
      <MetadataResourceEditPage type="page" name="home" />
    </MemoryRouter>,
  );
}

/** Auto-save debounces 1500ms; wait past it so a fire has room to happen. */
const AUTOSAVE_WINDOW_MS = 2600;
const pastAutoSaveWindow = () => new Promise((r) => setTimeout(r, AUTOSAVE_WINDOW_MS));

describe('MetadataResourceEditPage — a draft the SERVER refused blocks Save (#8057)', () => {
  it('CONTROL: with no refusal standing, an edit reaches client.save', async () => {
    // The lit control for every "did not save" assertion below. It fires the
    // same call, through the same door, on the same harness — so a later zero
    // is a zero about the BLOCK and not about the harness.
    openEditor();
    const box = await selectAndOpenCel('bystander');
    fireEvent.change(box, { target: { value: 'record.amount > 11' } });

    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1), { timeout: 6000 });
  }, 20000);

  it('holds the block after the selection moves OFF the offending element', async () => {
    // ⭐ THE DISCRIMINATING ASSERTION. Reusing the selection-stamped
    // `inspectorBlocking` passes everything else in this file and fails here:
    // its stamp expires the moment the selection changes, which is exactly the
    // step the measured reproduction takes next.
    mockClient.save.mockRejectedValueOnce(await refusal(REFUSED_PATH));

    openEditor();
    const offenderBox = await selectAndOpenCel('offender');
    fireEvent.change(offenderBox, { target: { value: 'record.amount > 21' } });

    // The server refuses that draft. Anchor on the button actually going
    // disabled, so everything after is taken at a moment the gate provably ran.
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1), { timeout: 6000 });
    await waitFor(() => expect(saveButton()).toBeDisabled(), { timeout: 6000 });
    expect(saveButton()).toHaveAttribute('title', expect.stringContaining('The server refused this draft'));

    // Step 2 of the reproduction: select a DIFFERENT element and edit it. The
    // refused element is untouched, so the block must still stand.
    const bystanderBox = await selectAndOpenCel('bystander');
    fireEvent.change(bystanderBox, { target: { value: 'record.amount > 12' } });

    await waitFor(
      () => expect(bystanderBox).toHaveValue('record.amount > 12'),
      { timeout: 6000 },
    );
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveAttribute('title', expect.stringContaining('The server refused this draft'));
  }, 20000);

  it('does not re-send the refused document when an unrelated field changes', async () => {
    // The wedge itself, at the door it came through. Paired with the CONTROL
    // above: same harness, same edit shape, same wait — only the refusal added.
    mockClient.save.mockRejectedValueOnce(await refusal(REFUSED_PATH));

    openEditor();
    const offenderBox = await selectAndOpenCel('offender');
    fireEvent.change(offenderBox, { target: { value: 'record.amount > 21' } });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1), { timeout: 6000 });
    await waitFor(() => expect(saveButton()).toBeDisabled(), { timeout: 6000 });

    const bystanderBox = await selectAndOpenCel('bystander');
    fireEvent.change(bystanderBox, { target: { value: 'record.amount > 13' } });

    await pastAutoSaveWindow();
    // Still ONE. Before this fix the timer fired again here, carrying the same
    // half-filled document, and was refused again — while the designer showed
    // the edit as applied.
    expect(mockClient.save).toHaveBeenCalledTimes(1);
  }, 20000);

  it('releases as soon as the author edits the element the server named', async () => {
    // The escape must be cheap. The card measured the only existing escape as a
    // page reload, "which discards every unsaved edit made since".
    mockClient.save.mockRejectedValueOnce(await refusal(REFUSED_PATH));

    openEditor();
    let offenderBox = await selectAndOpenCel('offender');
    fireEvent.change(offenderBox, { target: { value: 'record.amount > 21' } });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1), { timeout: 6000 });
    await waitFor(() => expect(saveButton()).toBeDisabled(), { timeout: 6000 });

    // Touch the refused element itself — the block is keyed to that slice.
    offenderBox = await selectAndOpenCel('offender');
    fireEvent.change(offenderBox, { target: { value: 'record.amount > 22' } });

    await waitFor(() => expect(saveButton()).toBeEnabled(), { timeout: 6000 });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(2), { timeout: 6000 });
  }, 20000);

  it('a refusal that localises to NO slice blocks nothing', async () => {
    // Fail-open is a deliberate property, not an oversight: an unlocatable
    // refusal names nothing the author could edit to clear it, so holding Save
    // against it would be the dead-bolt the advisory ruling exists to prevent.
    mockClient.save.mockRejectedValueOnce(await refusal('nosuchkey.deeper.stillmissing'));

    openEditor();
    const box = await selectAndOpenCel('offender');
    fireEvent.change(box, { target: { value: 'record.amount > 21' } });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1), { timeout: 6000 });

    // The error is still surfaced; only the BLOCK is withheld.
    await waitFor(() => expect(saveButton()).toBeEnabled(), { timeout: 6000 });
  }, 20000);
});

describe('MetadataResourceEditPage — the advisory half is untouched (#8057 / #6980)', () => {
  it('a draft the server ACCEPTS still saves, and Save never blocks', async () => {
    // ⭐ THE NON-REGRESSION AXIS, derived from the plausible WRONG fix: a gate
    // that blocks Save on any Zod issue satisfies every "the refused document
    // stops being sent" assertion above while dead-bolting exactly the drafts
    // the advisory ruling exists to protect. So the load-bearing case is the
    // server-ACCEPTED one, and it is observed on a document the server really
    // takes — `client.save` resolving, not merely a button looking enabled.
    openEditor();
    const box = await selectAndOpenCel('offender');
    fireEvent.change(box, { target: { value: 'record.amount > 21' } });

    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1), { timeout: 6000 });
    // The server TOOK it: the draft is clean again, and the only thing holding
    // Save is that there is nothing left to save.
    await waitFor(() => expect(saveButton()).toHaveAttribute('title', 'No changes to save'), {
      timeout: 6000,
    });
    expect(refusalHoldsSave()).toBe(false);

    // And a further edit saves too, across a selection change — the caricature
    // ("Save is always blocked") reddens on this second call.
    const other = await selectAndOpenCel('bystander');
    fireEvent.change(other, { target: { value: 'record.amount > 14' } });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(2), { timeout: 8000 });
    expect(refusalHoldsSave()).toBe(false);
  }, 25000);

  it('a refusal that has been SETTLED by a successful save stops blocking', async () => {
    // The block is not a latch. Once the server takes the document, whatever it
    // refused before is settled — otherwise the first 422 of a session would
    // wedge the editor for as long as it stayed open.
    mockClient.save.mockRejectedValueOnce(await refusal(REFUSED_PATH));

    openEditor();
    let box = await selectAndOpenCel('offender');
    fireEvent.change(box, { target: { value: 'record.amount > 21' } });
    await waitFor(() => expect(saveButton()).toBeDisabled(), { timeout: 6000 });

    box = await selectAndOpenCel('offender');
    fireEvent.change(box, { target: { value: 'record.amount > 22' } });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(2), { timeout: 6000 });
    await waitFor(() => expect(refusalHoldsSave()).toBe(false), { timeout: 6000 });

    // A later unrelated edit is not held against the settled refusal.
    const other = await selectAndOpenCel('bystander');
    fireEvent.change(other, { target: { value: 'record.amount > 15' } });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(3), { timeout: 8000 });
  }, 25000);
});

/**
 * The refusal branches read the PARSED error, whichever door served it
 * (objectui#11379).
 *
 * `MetadataClient`'s `parseError` already reads every live wire shape onto
 * `err.message` / `err.issues` / `err.code`. The page used to re-read the raw
 * `err.body` instead, which knows only the REST shape: on the dispatcher shape
 * the issues sit under `body.error.details.issues`, so the page found none and
 * fell back to `String(body.error)` — an object — and showed `[object Object]`
 * with an empty field path in the Save title.
 *
 * Every error below is built by the real parser from a wire body, so a test
 * cannot pass on a field the parser would never set.
 */
describe('MetadataResourceEditPage — a refusal is read off the parsed error on both wire shapes (objectui#11379)', () => {
  /** The part of the human label `describeIssuePath` builds that names the refused element. */
  const FIELD_TRAIL = 'offender → visibleWhen';

  it.each(['dispatcher', 'rest'] as const)(
    '422 on the %s shape: the banner carries the server message and the Save title names the field',
    async (shape) => {
      mockClient.save.mockRejectedValueOnce(await refusal(REFUSED_PATH, shape));

      openEditor();
      const box = await selectAndOpenCel('offender');
      fireEvent.change(box, { target: { value: 'record.amount > 21' } });
      await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1), { timeout: 6000 });
      await waitFor(() => expect(saveButton()).toBeDisabled(), { timeout: 6000 });

      const title = saveButton().getAttribute('title') ?? '';
      expect(title).toContain('The server refused this draft');
      expect(title).toContain(FIELD_TRAIL);
      // The banner is the single-issue line: the field's label, then the
      // server's own prescription — not a headline, and never `String(object)`.
      expect(await screen.findByText(new RegExp(`${FIELD_TRAIL}: ${ISSUE_MESSAGE}$`))).toBeInTheDocument();
      expect(screen.queryAllByText(/\[object Object\]/)).toHaveLength(0);
    },
    20000,
  );

  it.each(['dispatcher', 'rest'] as const)(
    '409 DESTRUCTIVE_CHANGE on the %s shape: the confirmation lists what the server said would be lost',
    async (shape) => {
      // The producer's real issue shape (`metadata-protocol`'s destructive-change
      // detector). The branch reads nothing type-specific, so the page harness
      // carries it as well as an object would.
      const lost = "Field 'amount' removed — existing data in this column will become inaccessible.";
      const issues = [{ code: 'field_removed', field: 'amount', message: lost }];
      const message = `page/home would drop or transform existing data: ${lost}`;
      const wire =
        shape === 'rest'
          ? { error: message, code: 'DESTRUCTIVE_CHANGE', issues }
          : { success: false, error: { code: 'DESTRUCTIVE_CHANGE', message, details: { issues } } };
      mockClient.save.mockRejectedValueOnce(await parsedRefusal(409, wire));

      openEditor();
      const box = await selectAndOpenCel('offender');
      fireEvent.change(box, { target: { value: 'record.amount > 21' } });
      await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1), { timeout: 6000 });

      expect(await screen.findByText('Destructive change detected', {}, { timeout: 6000 })).toBeInTheDocument();
      expect(screen.getByText(lost)).toBeInTheDocument();
    },
    20000,
  );

  it('CONTROL: a non-422 refusal keeps the plain banner and holds nothing', async () => {
    // Neither refusal branch may claim it: the message reaches the banner as the
    // server wrote it, and Save stays free.
    const message = 'The metadata store is temporarily unavailable.';
    mockClient.save.mockRejectedValueOnce(
      await parsedRefusal(503, { success: false, error: { code: 'SERVICE_UNAVAILABLE', message } }),
    );

    openEditor();
    const box = await selectAndOpenCel('offender');
    fireEvent.change(box, { target: { value: 'record.amount > 21' } });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1), { timeout: 6000 });

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(refusalHoldsSave()).toBe(false);
    expect(saveButton()).toBeEnabled();
  }, 20000);
});
