/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6041 — the Field Designer reads and writes the relationship target
 * under the spec's spelling `reference`, in BOTH directions.
 *
 * Surfaced by the key-level parity gate built for objectui#5761
 * (`scripts/check-designer-field-key-parity.mjs`). `ServerFieldSchema` is one
 * of that gate's two `wire` shapes: `fromDesignerField` builds it and this page
 * PUTs the assembled `fields` map.
 *
 * `referenceTo` is not in `FieldSchema`'s accept set — measured on the installed
 * artifact, through the whole object document:
 *
 *   ObjectSchema.safeParse({ …, fields: { rel: { type: 'lookup', label: 'Owner',
 *                                               referenceTo: 'user' } } })
 *     => success = false
 *     => unrecognized_keys at ["fields","rel"] keys=["referenceTo"]
 *
 * i.e. a hard 422 `INVALID_METADATA` that blocks every later save of the object.
 *
 * Two directions, both broken by one misspelling and both pinned here:
 *
 *   WRITE — `fromDesignerField` emitted `referenceTo`, so authoring a lookup
 *           field produced the 422.
 *   READ  — `toDesignerField` read `raw.referenceTo` from the server payload.
 *           A spec-parsed server sends `reference`, so every EXISTING lookup
 *           field loaded into the designer with an empty reference box.
 *
 * Fixing only the write side would leave every already-saved field unreadable,
 * so the read case below is not a bonus assertion — it is half the card.
 *
 * Written against the wire like its siblings `MetadataFieldsPage.saveEnvelope`
 * and `MetadataFieldsPage.retiredIndexed`: a REAL `MetadataClient` over a fetch
 * double, assertions on the captured PUT bytes rather than on the argument
 * handed to the client. That distinction matters for this key — a property
 * whose value is `undefined` is a key zod's strict object COUNTS but
 * `JSON.stringify` DROPS.
 *
 * This file names no `isSystem`/`system` key anywhere, and its sibling
 * `MetadataFieldsPage.specKeySystem.test.tsx` names no reference key: the two
 * cards of this fold are independently verifiable, and reverting one fix must
 * red only its own file.
 *
 * ## objectui#7714 — a half-filled lookup is HELD CLIENT-SIDE and never PUT
 *
 * The half-filled case below used to pin the opposite ("still saves, exactly as
 * before"). `@objectstack/spec` 17.3.0 made `reference` a hard requirement on
 * `lookup` / `master_detail`, and objectui#7714 drove the consequence in a
 * running designer against a 17.3.0 backend: the target-less draft PUT the
 * whole object, got `422 INVALID_METADATA` at `fields.<name>.reference`, and
 * then blocked the NEXT edit too — to an entirely different, already-saved
 * field — because the draft rides along in the same document.
 *
 * This page now refuses the list and issues **no PUT at all**. The claim is
 * about THE PUT BODY, not the spec's verdict, which is why it never depended on
 * the pin in either direction — pinnable while the spec still accepted a
 * target-less draft, and pinnable now that it refuses one. ⛔ Do not re-stamp it
 * with a version when the pin next moves (objectui#8897). ⛔ Not "strip the incomplete field
 * and save the rest" — that shows the author a field the server never received,
 * the silent-drop shape objectstack#4001 closed. `puts` staying EMPTY is the
 * assertion that tells the two apart.
 *
 * ## objectui#8058 — the READ door reads BOTH spellings
 *
 * The READ line above describes what objectui#6041 left behind, and it was only
 * half repaired: `toDesignerField` moved from `raw.referenceTo` to
 * `raw.reference`, which is right for a spec-parsed server and wrong for a
 * document whose target was written by a pre-objectui#6041 build and never
 * re-saved. Such a document read as target-less, `carryOver` stripped the
 * stored key, and the field left as a `lookup` with no target at all —
 * silently at spec 17.2.0, and as an unattributed 422 against 17.3.0.
 *
 * It now reads `reference` and falls back to `referenceTo`
 * (`storedRelationshipTarget`), which is a pure rename: `FieldSchema`'s own
 * alias map renames `referenceTo` onto `reference`, and both spellings carry
 * one object machine name. The last `describe` in this file pins that, together
 * with the two controls that keep it a rename rather than a second contract —
 * objectui#7714's guard still refuses a field with no target under EITHER
 * spelling, and the spec spelling wins when both are stored and disagree.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { FieldSchema } from '@objectstack/spec/data';
import { MetadataClient } from '@object-ui/data-objectstack';
import type { DesignerFieldDefinition } from '@object-ui/types';

/**
 * The object document as it lives in the database.
 *
 *   `owner_id` carries what a SPEC-PARSED SERVER sends — `reference`. That is
 *   the read case: before this fix the designer looked for `referenceTo` and
 *   found nothing.
 *   `legacy_id` carries the misspelling a pre-fix designer build could have
 *   left behind, ALONGSIDE the spec spelling. `carryOver` spreads the previous
 *   server def verbatim, so without a tombstone the stale key rides straight
 *   back out to the route that rejects it — and the object stays blocked
 *   forever.
 *
 *   ⚠️ It carries BOTH keys deliberately (objectui#7714, and kept that way by
 *   objectui#8058). The retired key is what the strip assertion below
 *   MEASURES — delete it from the fixture and that assertion goes green
 *   because there is nothing left to strip — and the spec key is the one the
 *   read door must prefer, so this one field pins the precedence as well as
 *   the strip. Holding the target ONLY under the retired spelling is a
 *   different and narrower state; it has its own cases at the bottom of this
 *   file rather than riding invisibly inside the fixture every other test here
 *   shares, where it would have made all of them assert the read door instead
 *   of what they are named for.
 */
const OBJECT_BODY = {
  name: 'probe_widget',
  label: 'Widget',
  fields: {
    name: { type: 'text', label: 'Name', required: true },
    owner_id: { type: 'lookup', label: 'Owner', reference: 'account', inlineHelpText: 'Record owner.' },
    legacy_id: { type: 'lookup', label: 'Legacy', reference: 'contact', referenceTo: 'contact' },
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
  fields: DesignerFieldDefinition[];
  onFieldsChange?: (fields: DesignerFieldDefinition[]) => void;
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

/** The body of the last PUT, exactly as it went over the wire. */
function lastPut(): Record<string, unknown> {
  // Indexed rather than `.at(-1)`: `Array.prototype.at` is ES2022, and this
  // package's own `tsconfig.test.json` owns the `lib` level that decides
  // whether it type-checks — read that off the `lib` section of
  // `pnpm census:tsconfig-test-parity`. ⛔ Don't restate its answer here: the
  // sentence this replaces did, and went false the moment the level moved
  // (objectui#9513). Index arithmetic asks no `lib` question at all.
  return puts[puts.length - 1];
}

/** The fields map exactly as it went over the wire on the last PUT. */
function savedFields(): Record<string, Record<string, unknown>> {
  return lastPut().fields as Record<string, Record<string, unknown>>;
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
    // objectstack#4001 closed the silent-drop shape. Without it every parity
    // assertion here would be trivially green while the 422 still happened.
    const result = FieldSchema.safeParse({ type: 'text', label: 'L', zzzDefinitelyNotAKey: 1 });
    expect(result.success).toBe(false);
    expect(unrecognizedKeys(result)).toContain('zzzDefinitelyNotAKey');
  });

  it('refuses `referenceTo` by name and accepts `reference` — the two states this file distinguishes', () => {
    expect(unrecognizedKeys(FieldSchema.safeParse({ type: 'lookup', label: 'Owner', referenceTo: 'account' })))
      .toEqual(['referenceTo']);
    expect(FieldSchema.safeParse({ type: 'lookup', label: 'Owner', reference: 'account' }).success).toBe(true);
  });
});

describe('objectui#6041 · READ — an existing lookup field loads with its target', () => {
  it('hands the stored `reference` down to the designer', async () => {
    await renderPage();
    const owner = designerProps!.fields.find((f) => f.name === 'owner_id')!;
    // Before this fix the reader looked for `raw.referenceTo`, so this was
    // `undefined` and the reference box rendered EMPTY for every saved field.
    expect(owner.referenceTo).toBe('account');
    // Falsification: the field itself arrived, with its other keys intact.
    expect(owner.label).toBe('Owner');
    expect(owner.type).toBe('lookup');
  });
});

describe('objectui#6041 · WRITE — the save carries `reference`, never `referenceTo`', () => {
  it('PUTs the target under the spec spelling', async () => {
    await renderPage();
    await relabel('owner_id', 'Record owner');

    const fields = savedFields();
    expect(fields.owner_id.reference).toBe('account');
    expect('referenceTo' in fields.owner_id).toBe(false);
    // Falsification, twice: the edit landed, and the unknown per-field key the
    // designer does not RENDER (but the spec accepts) survived the round-trip.
    expect(fields.owner_id.label).toBe('Record owner');
    expect(fields.owner_id.inlineHelpText).toBe('Record owner.');
  });

  it('every field it PUTs parses through the real FieldSchema', async () => {
    await renderPage();
    await relabel('owner_id', 'Record owner');

    for (const [name, def] of Object.entries(savedFields())) {
      const result = FieldSchema.safeParse(def);
      expect(unrecognizedKeys(result), `field \`${name}\` emitted a refused key`).toEqual([]);
      expect(result.success, `field \`${name}\` did not parse`).toBe(true);
    }
  });

  it('a newly authored lookup field emits `reference`', async () => {
    await renderPage();
    const next: DesignerFieldDefinition[] = [
      ...designerProps!.fields,
      { id: 'fld_new', name: 'billing_id', label: 'Billing', type: 'lookup', referenceTo: 'invoice' },
    ];
    await act(async () => {
      designerProps!.onFieldsChange!(next);
    });
    await waitFor(() => expect(puts).toHaveLength(1));

    const fields = savedFields();
    expect(fields.billing_id.reference).toBe('invoice');
    expect('referenceTo' in fields.billing_id).toBe(false);
    expect(FieldSchema.safeParse(fields.billing_id).success).toBe(true);
  });

  it('a save of an object ALREADY carrying `referenceTo` puts it back without the key', async () => {
    // Without the tombstone this is the case that keeps a blocked object
    // blocked: renaming the emit site does not touch what `carryOver` spreads,
    // so the stored misspelling would ride back out to the same 422.
    await renderPage();
    await relabel('owner_id', 'Record owner');

    const fields = savedFields();
    expect('referenceTo' in fields.legacy_id).toBe(false);
    // Falsification: the field is still there, still a lookup, and still
    // pointing at its target — the strip removed a KEY, not the field and not
    // the relationship.
    expect(fields.legacy_id.type).toBe('lookup');
    expect(fields.legacy_id.reference).toBe('contact');
    expect(FieldSchema.safeParse(fields.legacy_id).success).toBe(true);
  });

  it('a HALF-FILLED draft — type `lookup`, target left empty — is REFUSED, and issues NO PUT', async () => {
    // objectui#7714. Replaces the assertion that used to live here, rather
    // than respelling it: the branch it pinned is the branch this card removes.
    //
    // This page's caller is fire-and-forget (`void handleFieldsChange(next)`),
    // so the refusal is observed the way the AUTHOR observes it — the page's
    // error surface — and not as a rejected promise. The second assertion is
    // the card: no request was made at all, which is what distinguishes the
    // ruled fix from option B (strip the field, PUT the rest, report success).
    await renderPage();
    const next: DesignerFieldDefinition[] = [
      ...designerProps!.fields,
      { id: 'fld_half', name: 'half_id', label: 'Half', type: 'lookup' },
    ];
    await act(async () => {
      designerProps!.onFieldsChange!(next);
    });

    await waitFor(() =>
      expect(screen.getByTestId('metadata-fields-page-error').textContent).toMatch(
        /needs a `reference` naming the object it links to/,
      ),
    );
    expect(puts).toEqual([]);
  });

  it('a COMPLETE lookup still saves — the guard refuses drafts, not relationships', async () => {
    // Falsification: a guard that refused every `lookup` would satisfy the case
    // above while deleting the feature, so the accepting half is asserted here.
    await renderPage();
    const next: DesignerFieldDefinition[] = [
      ...designerProps!.fields,
      { id: 'fld_ok', name: 'billing_id', label: 'Billing', type: 'lookup', referenceTo: 'invoice' },
    ];
    await act(async () => {
      designerProps!.onFieldsChange!(next);
    });
    await waitFor(() => expect(puts).toHaveLength(1));

    expect(savedFields().billing_id.reference).toBe('invoice');
  });

  it('an UNTOUCHED stored lookup saves on an unrelated edit — the target comes from `prev`', async () => {
    // The reason the guard reads the EMITTED entry rather than the designer's
    // input. `owner_id`'s target lives in the stored document and reaches the
    // wire through `carryOver`; a guard reading `designed.referenceTo` would
    // refuse this save — a document the server accepts, blocked by the client —
    // on every object that has ever had a lookup.
    await renderPage();
    await relabel('name', 'Full name');

    expect(puts).toHaveLength(1);
    expect(savedFields().owner_id.reference).toBe('account');
  });

  it('refuses every unusable target state, and PUTs none of them', async () => {
    // objectui#7714, all four states plus `null`. The whitespace row USED to be
    // this page being stricter than the contract; objectstack#16920 applies the
    // spec's emptiness test to the trimmed value, so upstream now refuses the
    // same shape under the same `custom` issue and the divergence is retired
    // (objectui#8621). It is still asserted HERE rather than against the spec,
    // for the reason that outlives the divergence: this refusal is the page's
    // own, raised at editor time before the PUT, and it does not depend on
    // which spec is installed. That independence is also what keeps this row
    // green across the pin bump: the pin has since reached objectstack#16920
    // (`@objectstack/spec` 17.4.0, objectui#8772), so upstream now refuses
    // `reference: '   '` under the same `custom` issue at the same `reference`
    // path — and this row did not move, because it never read the spec.
    // ⛔ The sentence that used to sit here said the installed pin WAS 17.3.0
    // and still parsed `'   '` green; both halves went false at the bump
    // (objectui#8897). The spec-side reading is measured, not narrated, in
    // `MetadataService.specKeyReference.test.ts`.
    //
    // One render, re-driven per state: `renderPage` per iteration would leave
    // several mounted pages in the document and `getByTestId` would then find
    // more than one error surface.
    await renderPage();
    const base = designerProps!.fields;

    for (const referenceTo of [undefined, '', '   ', 42, null]) {
      const next = [
        ...base,
        { id: 'fld_x', name: 'x_id', label: 'X', type: 'lookup', referenceTo },
      ] as DesignerFieldDefinition[];
      await act(async () => {
        designerProps!.onFieldsChange!(next);
      });
      await waitFor(() =>
        expect(
          screen.getByTestId('metadata-fields-page-error').textContent,
          `referenceTo=${JSON.stringify(referenceTo)} should be refused`,
        ).toMatch(/needs a `reference` naming the object it links to/),
      );
      expect(puts, `referenceTo=${JSON.stringify(referenceTo)} must issue no PUT`).toEqual([]);
    }
  });

  /**
   * ⭐ This WAS the marker case, and it is now a real pin — objectui#8060.
   *
   * ## What it used to assert, and why that was not coverage
   *
   * It asserted `expect(true).toBe(true)`. The guard's list carries
   * `master_detail` for parity with the sibling writer, where it IS reachable
   * (`FieldMetadataPayload['type']` is an unconstrained `string`, and
   * `MetadataService.saveObject` refuses a target-less master-detail — pinned
   * in `MetadataService.specKeyReference.test.ts`). Through THIS page it was
   * unreachable: `toDesignerType` mapped every type outside
   * `DESIGNER_FIELD_TYPES` to `'text'` on the READ path, so a stored
   * `master_detail` arrived at the guard already flattened —
   *
   *   stored { type: 'master_detail', reference: 'invoice' }
   *     => designer field type "text"
   *     => WIRE { "type": "text", "label": "Parent", "reference": "invoice" }
   *
   * — and a refusal assertion here would have been a PHANTOM: green because the
   * guard never saw a `master_detail`, not because it handled one. The case
   * existed so that when the flattening was fixed the missing coverage would be
   * visible rather than assumed. ⭐ *A check that cannot fire is
   * indistinguishable from one that passed.*
   *
   * ## What it asserts now
   *
   * objectui#8060 removed the flattening: a stored type this designer cannot
   * author is carried through verbatim and `toFieldsMap` runs the guard over
   * the carried-through entries too. So the branch FIRES on the real type, and
   * both of its outcomes are pinned below — the passing one first, because a
   * refusal pin alone cannot tell "the guard rejected it" from "the guard
   * rejects every master-detail".
   *
   * ⚠️ The refusal half is a BEHAVIOUR CHANGE, not merely restored coverage: an
   * object holding a target-less stored `master_detail` used to save from this
   * page by flattening the field to `text`, losing the relationship. It is now
   * refused by name before the PUT. `@objectstack/spec` 17.3.0 requires
   * `reference` on `master_detail`, so that document's PUT answers 422 anyway;
   * refusing here names the field and leaves the stored relationship intact.
   */
  it('DOES pin a `master_detail` now — the guard is reachable, and both outcomes are real', async () => {
    const body = {
      name: 'md_probe',
      label: 'MD Probe',
      fields: {
        name: { type: 'text', label: 'Name' },
        parent_id: { type: 'master_detail', label: 'Parent', reference: 'invoice' },
      },
    };
    const localPuts: Array<Record<string, unknown>> = [];
    const client = new MetadataClient({
      baseUrl: 'http://localhost:3000',
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if ((init?.method ?? 'GET').toUpperCase() === 'PUT') {
          localPuts.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
          return json({ success: true, name: 'md_probe' });
        }
        if (/\/meta\/object\/md_probe(\?|$)/.test(url)) {
          return json({ type: 'object', name: 'md_probe', item: body });
        }
        return json({ items: [] });
      }) as unknown as typeof fetch,
    });

    render(<MetadataFieldsPage objectName="md_probe" client={client} />);
    await waitFor(() => expect(designerProps).not.toBeNull());

    // (a) The guard SEES a real `master_detail` — the type is no longer
    //     flattened before it gets there — and passes it, because the target is
    //     present. Concrete strings on both sides: `'text'` is what the defect
    //     wrote, so asserting `not.toBe('text')` is what tells them apart.
    const next = designerProps!.fields.map((f) =>
      f.name === 'name' ? { ...f, label: 'Renamed' } : f,
    );
    await act(async () => {
      designerProps!.onFieldsChange!(next);
    });
    await waitFor(() => expect(localPuts).toHaveLength(1));
    const wire = localPuts[0].fields as Record<string, Record<string, unknown>>;
    expect(wire.parent_id.type).toBe('master_detail');
    expect(wire.parent_id.type).not.toBe('text');
    expect(wire.parent_id.reference).toBe('invoice');

    // (b) And the refusal branch is live: strip the target from the STORED
    //     document and the same edit is refused by name, with no PUT. Under the
    //     old flattening this saved happily as a `text` field.
    delete (body.fields.parent_id as Record<string, unknown>).reference;
    // Unmount the first page before mounting the second: two live pages would
    // both answer `getByTestId`, and `designerProps` would name whichever
    // rendered last rather than the one being driven.
    cleanup();
    designerProps = null;
    localPuts.length = 0;
    render(<MetadataFieldsPage objectName="md_probe" client={client} />);
    await waitFor(() => expect(designerProps).not.toBeNull());
    await act(async () => {
      designerProps!.onFieldsChange!(
        designerProps!.fields.map((f) => (f.name === 'name' ? { ...f, label: 'Renamed again' } : f)),
      );
    });
    await waitFor(() =>
      expect(
        screen.getByTestId('metadata-fields-page-error').textContent,
      ).toMatch(/a `master_detail` field needs a `reference` naming the object it links to/),
    );
    expect(localPuts).toEqual([]);
  });

});

/**
 * objectui#8058 — a target stored ONLY under the retired spelling is READ, and
 * the relationship survives the round-trip.
 *
 * ⚠️⚠️ THIS BLOCK REPLACES AN EXISTING PIN, AND THE FLIP IS THE CARD.
 *
 * objectui#7714 surfaced this state rather than sought it: its guard turned
 * every save in this file into a refusal when the shared fixture held
 * `legacy_id` that way, which is how the state became visible at all. It then
 * pinned what it had measured — `it('is refused by name, and issues no PUT')`,
 * asserting the page's error surface named `stale_id` and that `puts` stayed
 * empty — and said in the same breath that the refusal was "strictly better and
 * it is not a fix", because the author still has to re-pick a target the
 * document already held.
 *
 * That pin asserted the CONSEQUENCE of the read-side gap, not a contract worth
 * keeping. objectui#8058 closes the gap: `toDesignerField` now reads the target
 * under either spelling ({@link storedRelationshipTarget}), so this document no
 * longer arrives target-less, the guard has nothing to refuse, and the save
 * carries the relationship out under the spec spelling. The old expectation
 * cannot survive that and is not respelled — the branch it pinned is the branch
 * this card removes.
 *
 * ⛔ What did NOT change, and is asserted below rather than assumed:
 * objectui#7714's guard. A guard that stopped refusing because its subject was
 * repaired would be a guard broken by the repair, so the second case here feeds
 * it a field with no target under EITHER spelling and asserts it is still
 * refused, still BY NAME, still with no PUT. The third case pins the precedence
 * that keeps the fallback a rename and not a second contract: when both
 * spellings are stored and DISAGREE, the spec spelling wins.
 */
describe('objectui#8058 · a lookup whose target survives only as `referenceTo`', () => {
  /** A page over one stored `fields` map, with its own PUT recorder. */
  async function renderOver(fields: Record<string, Record<string, unknown>>) {
    const localPuts: Array<Record<string, unknown>> = [];
    const client = new MetadataClient({
      baseUrl: 'http://localhost:3000',
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if ((init?.method ?? 'GET').toUpperCase() === 'PUT') {
          localPuts.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
          return json({ success: true, name: 'probe_widget' });
        }
        if (/\/meta\/object\/probe_widget(\?|$)/.test(url)) {
          return json({ ...OBJECT_ENVELOPE, item: { ...OBJECT_BODY, fields } });
        }
        return json({ items: [] });
      }) as unknown as typeof fetch,
    });
    render(<MetadataFieldsPage objectName="probe_widget" client={client} />);
    await waitFor(() => expect(designerProps).not.toBeNull());
    return localPuts;
  }

  /** Relabel an UNRELATED field — the author never touches the lookup. */
  async function relabelName(label: string) {
    await act(async () => {
      designerProps!.onFieldsChange!(
        designerProps!.fields.map((f) => (f.name === 'name' ? { ...f, label } : f)),
      );
    });
  }

  it('loads with its target, and PUTs it back under the spec spelling', async () => {
    const localPuts = await renderOver({
      name: { type: 'text', label: 'Name', required: true },
      stale_id: { type: 'lookup', label: 'Stale', referenceTo: 'contact' },
    });

    // READ — the half objectui#8058 changed. Before it, this was `undefined`.
    const stale = designerProps!.fields.find((f) => f.name === 'stale_id')!;
    expect(stale.referenceTo).toBe('contact');

    await relabelName('Full name');
    await waitFor(() => expect(localPuts).toHaveLength(1));

    // WRITE — the target leaves under `reference`, and the retired key does not
    // ride along: the strip still runs, it just no longer costs the
    // relationship. This is the sentence the `carryOver` docblock claims.
    const wire = localPuts[0].fields as Record<string, Record<string, unknown>>;
    expect(wire.stale_id.reference).toBe('contact');
    expect('referenceTo' in wire.stale_id).toBe(false);
    expect(FieldSchema.safeParse(wire.stale_id).success).toBe(true);
    // Falsification: the unrelated edit is what triggered the save, and it
    // landed — this is not a green produced by nothing having happened.
    expect(wire.name.label).toBe('Full name');
  });

  it('⛔ CONTROL — a lookup with NO target under EITHER spelling is still refused, by name, with no PUT', async () => {
    // objectui#7714's guard, unchanged. If reading the retired spelling had
    // been written as a way to satisfy the guard rather than to find a stored
    // value, this case would go green too — and the guard would be gone.
    const localPuts = await renderOver({
      name: { type: 'text', label: 'Name', required: true },
      orphan_id: { type: 'lookup', label: 'Orphan' },
    });

    await relabelName('Full name');

    await waitFor(() =>
      expect(screen.getByTestId('metadata-fields-page-error').textContent).toMatch(/`orphan_id`/),
    );
    expect(screen.getByTestId('metadata-fields-page-error').textContent).toMatch(
      /needs a `reference` naming the object it links to/,
    );
    expect(localPuts).toEqual([]);
  });

  it('⛔ CONTROL — when both spellings are stored and DISAGREE, the spec spelling wins', async () => {
    // The fallback is a fallback, not a merge: the retired key is consulted
    // only when the spec key holds nothing. A document mid-migration carries
    // both, and reading the stale one would resurrect a target the author has
    // already moved away from.
    const localPuts = await renderOver({
      name: { type: 'text', label: 'Name', required: true },
      moved_id: { type: 'lookup', label: 'Moved', reference: 'contact', referenceTo: 'account' },
    });

    expect(designerProps!.fields.find((f) => f.name === 'moved_id')!.referenceTo).toBe('contact');

    await relabelName('Full name');
    await waitFor(() => expect(localPuts).toHaveLength(1));

    const wire = localPuts[0].fields as Record<string, Record<string, unknown>>;
    expect(wire.moved_id.reference).toBe('contact');
    expect(wire.moved_id.reference).not.toBe('account');
    expect('referenceTo' in wire.moved_id).toBe(false);
  });
});

/**
 * objectui#7714 - the refusal DIAGNOSES the state it found, on THIS writer too.
 *
 * The sibling block of the same name lives in
 * `packages/app-shell/src/services/MetadataService.specKeyReference.test.ts`.
 * The two assert the SAME four states deliberately: what both
 * `describeUnusableTarget` docblocks claim is specifically PARITY, so a partial
 * pin would leave that sentence false in a subtler way than no pin at all.
 *
 * ## Why this block exists - the measurement, not the intuition (objectui#8925)
 *
 * Both docblocks said the two copies "cannot drift" because each pin asserts
 * the same four states. That had never been measured on this side. Replacing
 * ONE branch of this page's `describeUnusableTarget` with a marker sentence and
 * running the whole package, on `6214db63f`, gave:
 *
 *   absent           mutated -> 19 files / 149 tests passed   UNPINNED
 *   non-string       mutated -> 19 files / 149 tests passed   UNPINNED
 *   empty            mutated -> 19 files / 149 tests passed   UNPINNED
 *   whitespace-only  mutated -> 1 failed                      pinned, but by
 *       `MetadataFieldsPage.carriedThroughReference-8896.test.tsx` and only
 *       through the words "whitespace names no object" - a card about a
 *       different subject, which is why it covered one row and no other.
 *
 * The same four mutations on the sibling writer turned its pin red every time.
 * So the parity sentence was false on three rows out of four while being read
 * as a guarantee.
 *
 * ⛔ The lesson worth carrying, because it is what made this survive: the claim
 * had been restated in THREE places - objectui#8897's card text, that card's
 * triage comment, and both docblocks - and not one of the three was a reading.
 * Repetition is not measurement. A parity claim is only worth its words when
 * the files that would go red are named and can be re-run.
 *
 * ## Why the page, and not the function
 *
 * `describeUnusableTarget` is module-private, and pinning it directly would pin
 * a string builder instead of what an author is shown. These cases drive the
 * page the way the author does - through the fire-and-forget `onFieldsChange`
 * the designer calls - and read the text back out of the page's error surface,
 * so a correct sentence that never reaches the banner cannot pass here.
 */
describe('objectui#7714 · the refusal message distinguishes the four states', () => {
  /**
   * Drive one unusable target through the page and hand back what the author
   * reads. Re-entrant on purpose: the non-string row takes two probes inside
   * one case, and a second `render` without `cleanup` would leave two error
   * surfaces in the document for `getByTestId` to choose between.
   */
  const refusalFor = async (reference: unknown): Promise<string> => {
    cleanup();
    designerProps = null;
    puts = [];
    await renderPage();
    const next = [
      ...designerProps!.fields,
      { id: 'fld_x', name: 'x_id', label: 'X', type: 'lookup', referenceTo: reference },
    ] as DesignerFieldDefinition[];
    await act(async () => {
      designerProps!.onFieldsChange!(next);
    });
    await waitFor(() =>
      expect(
        screen.getByTestId('metadata-fields-page-error').textContent,
        `reference=${JSON.stringify(reference)} should be refused`,
      ).toMatch(/needs a `reference` naming the object it links to/),
    );
    // A diagnosed message is only worth anything if it also stopped the write.
    expect(puts, `reference=${JSON.stringify(reference)} must issue no PUT`).toEqual([]);
    return screen.getByTestId('metadata-fields-page-error').textContent ?? '';
  };

  it('absent → "has none", and names the 422 consequence', async () => {
    const m = await refusalFor(undefined);
    expect(m).toMatch(/has none/);
    expect(m).toMatch(/blocks EVERY later save of this object/);
  });

  it('empty string → "is empty", not "has none"', async () => {
    const m = await refusalFor('');
    expect(m).toMatch(/is empty/);
    expect(m).not.toMatch(/has none/);
  });

  it('non-string → names the KIND and `invalid_type`, and does not prescribe "supply a target"', async () => {
    const m = await refusalFor(42);
    expect(m).toMatch(/holds a number instead of an object name/);
    expect(m).toMatch(/invalid_type/);
    expect(m).not.toMatch(/has none/);
    // `null` is typeof 'object'; spelling it as "null" is the accurate word.
    expect(await refusalFor(null)).toMatch(/holds null instead of an object name/);
  });

  it('whitespace-only → names the TRIM the contract applies, and is not the "is empty" sentence', async () => {
    const m = await refusalFor('   ');
    expect(m).toMatch(/is blank/);
    // What replaced "the spec ACCEPTS this value": since 17.4.0 the contract
    // applies its non-empty test to the trimmed value, so this writer can now
    // promise the 422 it used to have to withhold here.
    expect(m).toMatch(/TRIMMED value/);
    expect(m).toMatch(/422/);
    expect(m).toMatch(/objectstack#16920/);
    // Falsification, and the reason the four-state split survives the merge of
    // the two refusals: blank must still not be rendered as either of the
    // states that carry a different repair.
    expect(m).not.toMatch(/is empty/);
    expect(m).not.toMatch(/has none/);
    // The retired claim must be GONE, not merely out-ranked by a new match.
    expect(m).not.toMatch(/ACCEPTS this value/);
    expect(m).not.toMatch(/would succeed/);
  });
});
