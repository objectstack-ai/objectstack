/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:details` — the section `group` reference form, and the field-label
 * ladder an enumerated `fields` list walks (objectui#8497).
 *
 * Two defects, one card, and they met on the same surface:
 *
 * 1. An authored `{ group: 'parties' }` — a shape `@objectstack/spec` 17.3.0
 *    declares in full (`RecordDetailsProps.sections[].group`, objectstack#13855)
 *    — THREW, and took every sibling section on the page down with it. Measured
 *    on `origin/main` before the fix: `document.body.textContent` was the empty
 *    string and the render threw `Cannot read properties of undefined (reading
 *    'name')`. One authored key blanked a whole record page.
 *
 * 2. An enumerated `sections[].fields` list resolved its labels ONLY through the
 *    i18n bundle. With no bundle — the default for an app that never configured
 *    translations — every detail page rendered raw snake_case field names, while
 *    the object's own `label:` sat unread one lookup away.
 *
 * ## Where the crash came from, and why the docs were right
 *
 * `git log -S` on the crashing expression names ONE commit, `e997708419c1d311c2126c93762578d330cb48cf`
 * (2026-05-01, "feat(plugin-detail): record detail aesthetic polish (Sprint D)")
 * — months BEFORE #13855 declared `group`. So the throw was never a deliberate
 * refusal of the key; `DetailView` mapped every section through `s.fields`
 * unguarded, `flatMap` kept the resulting `undefined` as an ELEMENT (it flattens
 * arrays, and `undefined` is not one), and the next line read `.name` off it.
 * The declaration was right and the runtime had simply never honoured it, so the
 * repair is to IMPLEMENT `group`, not to make it a no-op.
 *
 * ## Two containment layers, and why one is not enough
 *
 * The crash fired inside a `useMemo` in `DetailView`'s own body — ABOVE the
 * section loop, outside every per-section subtree. A React error boundary
 * catches what throws while rendering ITS subtree, so a per-section boundary
 * alone could never have contained this one. Both layers are therefore pinned
 * separately below: the tolerant reader (`sectionFieldEntries`) for the path
 * that actually fired, and the per-section boundary for every OTHER way one
 * section can throw.
 *
 * ## The harness navigates by something the caricature cannot erase
 *
 * The caricature this card invites is a repair that swallows the throw and
 * renders nothing: the page stops crashing and silently loses the section. It
 * passes "the page no longer throws", and — measured, not predicted, see the
 * ablation notes on `SECTION_GROUP_RENDERS_MEMBERS` below — it ALSO passes
 * "the well-formed sibling sections still render their fields with their
 * labels", because under the caricature the siblings are exactly what survives.
 * So every leg here navigates by {@link requireLiveBody}, whose anchor is the
 * always-well-formed sibling section, and the discriminating assertion is
 * always about the GROUP-REFERENCED section's own members. `requireLiveBody`
 * throws a textually distinct `HARNESS DEAD` — proven to fire in the
 * harness-kill leg — so a dead harness can never read as a strong refusal.
 *
 * No positional navigation anywhere (`children[n]` and friends): a caricature
 * that inserts or drops a sibling shifts every index.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { I18nProvider, createI18n } from '@object-ui/i18n';
import { RecordDetailsRenderer, resetUnresolvedSectionGroupReports } from '../record-details';

/* ─────────────────────────────────────────────────────────────────────────────
 * Fixture
 *
 * `name` is DECLARED and left UNSET on every record below. The renderer's
 * page-H1 dedupe ladder resolves its title candidate to `name`, finds no value
 * there and hides nothing — without it the ladder's ADR-0079 derivation rung
 * ends on the first title-eligible field and would silently drop one of the
 * rows these legs assert on (the objectui#8175 trap).
 * ─────────────────────────────────────────────────────────────────────────── */

const OBJECT_NAME = 'clm_contract';

const objectSchema = {
  name: OBJECT_NAME,
  fields: {
    name: { type: 'text', label: 'Contract Name' },
    // Members of the `parties` group — and the two fields whose declared labels
    // the enumerated body used to lose.
    our_entity: { type: 'text', label: 'Our Signing Entity', group: 'parties' },
    counterparty: { type: 'text', label: 'Counterparty', group: 'parties' },
    // Ungrouped: reachable only by enumeration, so the two bodies below name
    // DIFFERENT fields and neither can accidentally satisfy the other's leg.
    term_months: { type: 'number', label: 'Term (Months)' },
    // ⭐ Rung 3's control: declares NO label at all, so its row must still read
    // as its raw name. Without it, "the declared label wins" and "there is no
    // rung 3 left" are indistinguishable.
    auto_renew: { type: 'boolean' },
  },
  fieldGroups: [{ key: 'parties', label: 'Parties' }],
};

const record = {
  our_entity: 'Acme Holdings',
  counterparty: 'Globex',
  term_months: 24,
  auto_renew: true,
};

/** The sibling section every leg keeps: well-formed, enumerated, never a group. */
const WELL_FORMED_SIBLING = {
  name: 'terms',
  label: 'Terms',
  fields: ['term_months'],
};

const renderDetails = (
  schema: Record<string, unknown>,
  options: { i18n?: ReturnType<typeof createI18n> } = {},
) => {
  const tree = (
    <RecordContextProvider
      objectName={OBJECT_NAME}
      recordId="C1"
      data={record}
      objectSchema={objectSchema}
    >
      <RecordDetailsRenderer schema={schema as any} />
    </RecordContextProvider>
  );
  return render(
    options.i18n ? <I18nProvider instance={options.i18n}>{tree}</I18nProvider> : tree,
  );
};

/**
 * The one landmark every leg navigates by, and the reason no leg navigates by
 * the thing under repair.
 *
 * ⚠️ Its failure text is deliberately unlike every other failure in this file.
 * If a change to `record:details` erased the body wholesale, a leg that queried
 * the GROUP section directly would fail with "Unable to find an element" — the
 * same sentence a genuine refusal produces — and the pin would read strong
 * while measuring nothing (objectui#8504). Here the harness dies first, loudly,
 * and says so. The harness-kill leg below proves this actually fires.
 */
const requireLiveBody = (): HTMLElement => {
  const heading = screen.queryAllByText('Terms');
  if (heading.length !== 1) {
    throw new Error(
      `HARNESS DEAD: expected exactly 1 well-formed sibling section heading, found ${heading.length}`,
    );
  }
  return document.body;
};

/**
 * ⚠️ `queryByText` throws on MULTIPLE matches as well as returning null on
 * none, and inside a `waitFor` that surfaces as a timeout pointing at the
 * component rather than at the query. Every count below goes through
 * `queryAllByText(...).length`, which reports both directions honestly.
 */
const textCount = (text: string): number => screen.queryAllByText(text).length;

/* ── the `/api/v1/security/explain` recording double ────────────────────────
 * `useRecordEditable` degrades to the GLOBAL `fetch` when no host supplies an
 * authenticated one, and under happy-dom that is a real HTTP client. A router,
 * not a sink: `afterEach` fails on any URL outside the one route it serves, so
 * an escape elsewhere reds here instead of vanishing into the hook's
 * best-effort `catch`. Nothing in this file reads the verdict.
 * ─────────────────────────────────────────────────────────────────────────── */

const EXPLAIN_ROUTE = '/api/v1/security/explain';
let explainCalls: string[] = [];

beforeEach(() => {
  explainCalls = [];
  resetUnresolvedSectionGroupReports();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      explainCalls.push(url);
      if (url !== EXPLAIN_ROUTE) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ record: { visible: true } }) };
    }),
  );
});

afterEach(() => {
  expect(explainCalls.filter((url) => url !== EXPLAIN_ROUTE)).toEqual([]);
  // Unmount BEFORE restoring the real `fetch` — vitest runs `afterEach` in
  // reverse registration order, so unstubbing first would leave the tree
  // mounted with the real global back in place (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
});

/* ═══════════════════════════════════════════════════════════════════════════
 * A — blast radius: one section's failure is that section
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('record:details — an authored `sections[].group` (objectui#8497 findings 1 & 2)', () => {
  it('SECTION_GROUP_RENDERS_MEMBERS: the referenced group renders its members, with the labels the OBJECT declares', () => {
    renderDetails({ sections: [{ group: 'parties' }, WELL_FORMED_SIBLING] });
    requireLiveBody();

    // ⭐ THE discriminating assertion of this card. Everything else in leg A
    // passes under the caricature (a repair that swallows the throw and renders
    // nothing); this is the one that does not — measured by ablation, not
    // predicted. The group section must be PRESENT and populated.
    expect(textCount('Parties')).toBe(1);
    expect(textCount('Our Signing Entity')).toBe(1);
    expect(textCount('Acme Holdings')).toBe(1);
    expect(textCount('Counterparty')).toBe(1);
    expect(textCount('Globex')).toBe(1);
  });

  it('SIBLINGS_SURVIVE: a section carrying `group` does not remove the sections that are fine', () => {
    renderDetails({ sections: [{ group: 'parties' }, WELL_FORMED_SIBLING] });
    requireLiveBody();

    // The p1 itself: before the fix `document.body.textContent` was ''. The
    // sibling is well-formed and enumerated — nothing about it is in question.
    expect(textCount('Term (Months)')).toBe(1);
    expect(textCount('24')).toBe(1);

    // ⚠️ NOT a discriminating assertion, and named here so nobody reads it as
    // one: the caricature passes it too. It pins the reported SYMPTOM
    // ("Component `record:details` failed to render"), which is what a reader
    // of the card recognises.
    expect(screen.queryAllByText(/failed to render/).length).toBe(0);
  });

  it('ONE_BAD_SECTION_IS_BOUNDED: a section that throws for a reason unrelated to `group` degrades to THAT section', () => {
    // Acceptance 2 is INDEPENDENT of `group` and is not satisfied by fixing
    // `group` alone, so it gets a fixture `group` cannot reach: a section whose
    // own field entry explodes while `DetailSection` renders it.
    //
    // ⚠️ The throwing member is `value`, and the choice is MEASURED, not
    // stylistic. A first attempt threw from a `name` getter and this leg failed
    // with the raw `section-local failure` — because `name` is read by
    // `normaliseField` / `columnIdentity` inside `RecordDetailsRenderER`, which
    // is ABOVE every per-section boundary, so nothing could contain it. `value`
    // is read by neither (`columnIdentity` reads only `field` / `name` /
    // `fieldName`); the first read is `DetailSection`'s own
    // `data?.[field.name] ?? field.value`. That is the boundary's real subtree.
    //
    // ⛔ The renderer's mapping is deliberately NOT hardened to match. A throw
    // there needs metadata `@objectstack/spec` refuses on parse — `fields` is
    // `z.array(z.string())`, and a bare string cannot carry a getter — so
    // wrapping it would be a lenient fallback for input the contract already
    // rejects (Commandment #0.1), buying nothing an author can reach.
    const exploding: any = {
      name: 'boom',
      label: 'Boom',
      fields: [
        {
          name: 'boom_field',
          get value(): never {
            throw new Error('section-local failure');
          },
        },
      ],
    };

    renderDetails({ sections: [exploding, WELL_FORMED_SIBLING] });
    requireLiveBody();

    // The failure is reported in the broken section's own place …
    expect(screen.queryAllByText(/failed to render/).length).toBe(1);
    // … naming that section rather than blaming the whole component.
    expect(screen.queryAllByText(/record:details section boom/).length).toBe(1);
    // … and the sibling keeps its field AND its label.
    expect(textCount('Term (Months)')).toBe(1);
    expect(textCount('24')).toBe(1);
  });

  it('SECTION_WITHOUT_MEMBERS_IS_BOUNDED: a section naming neither `group` nor `fields` does not blank the page', () => {
    // The reported crash path in its most general form, and the leg that pins
    // the TOLERANT READER specifically.
    //
    // ⭐ Measured, and it changed this file: with `group` implemented, a
    // `{ group }` section is resolved into one carrying `fields` BEFORE
    // `DetailView` ever sees it, so the group legs above no longer traverse the
    // unguarded read at all — they all passed with `sectionFieldEntries`
    // reverted to the bare `flatMap`. Without this leg that guard would be
    // untested code defended by an assertion never observed to fail.
    //
    // `@objectstack/spec` refuses a section carrying neither key, so this
    // document is off-spec — but it is reachable (a hand-authored page is not
    // validated at render time) and it produced the IDENTICAL whole-component
    // failure. Acceptance 2 is about exactly that: a malformed section
    // degrades to THAT section.
    renderDetails({ sections: [{ name: 'orphan', label: 'Orphan' }, WELL_FORMED_SIBLING] });
    requireLiveBody();

    // Bounded: the failure is reported in the orphan's own place …
    expect(screen.queryAllByText(/record:details section orphan/).length).toBe(1);
    // … and the well-formed sibling still renders its field, with its label.
    expect(textCount('Term (Months)')).toBe(1);
    expect(textCount('24')).toBe(1);
  });

  it('HARNESS_KILL: the harness itself dies loudly, and distinctly, when its anchor is gone', () => {
    // ⭐ This leg exists to prove the other legs are measuring anything at all.
    // If a caricature could erase what `requireLiveBody` navigates by, every
    // pin above would fail for the harness's reason while reading as a strong
    // refusal about `group`. Render a body with NO well-formed sibling and
    // confirm the anchor check fires, with text unlike any content assertion.
    renderDetails({ sections: [{ group: 'parties' }] });
    expect(requireLiveBody).toThrow(/HARNESS DEAD: expected exactly 1/);

    // And the inverse direction, so "found 0" is not the only failure it can
    // report: a duplicated anchor is equally fatal, which is what stops a
    // caricature from satisfying the harness by ADDING a section.
    cleanup();
    renderDetails({ sections: [WELL_FORMED_SIBLING, { ...WELL_FORMED_SIBLING, name: 'terms_2' }] });
    expect(requireLiveBody).toThrow(/HARNESS DEAD: expected exactly 1/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * B — the label ladder: bundle key -> declared label -> field name
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('record:details — an enumerated `fields` list walks all THREE label rungs', () => {
  it('RUNG_2_DECLARED_LABEL: with no bundle, the label the object declares beats the raw field name', () => {
    renderDetails({
      sections: [{ name: 'parties_enum', label: 'Parties', fields: ['our_entity', 'counterparty'] }, WELL_FORMED_SIBLING],
    });
    requireLiveBody();

    expect(textCount('Our Signing Entity')).toBe(1);
    expect(textCount('Counterparty')).toBe(1);
    // The raw names are what shipped; their absence is half the claim.
    expect(textCount('our_entity')).toBe(0);
    expect(textCount('counterparty')).toBe(0);
  });

  it('RUNG_1_BUNDLE_WINS: a bundle key still outranks the declared label (an app WITH translations is unchanged)', () => {
    const instance = createI18n({
      defaultLanguage: 'zh',
      detectBrowserLanguage: false,
      resources: {
        zh: { app: { fields: { [OBJECT_NAME]: { our_entity: '我方签约主体' } } } },
      },
    });

    renderDetails(
      {
        sections: [{ name: 'parties_enum', label: 'Parties', fields: ['our_entity', 'counterparty'] }, WELL_FORMED_SIBLING],
      },
      { i18n: instance },
    );
    requireLiveBody();

    expect(textCount('我方签约主体')).toBe(1);
    // Rung 2 must not have overtaken rung 1 …
    expect(textCount('Our Signing Entity')).toBe(0);
    // … while the field the bundle does NOT cover still gets its declared
    // label, which is what proves rung 2 is reached per FIELD, not per app.
    expect(textCount('Counterparty')).toBe(1);
  });

  it('RUNG_3_FIELD_NAME: a field declaring no label still falls back to its own name', () => {
    renderDetails({
      sections: [{ name: 'renewal', label: 'Renewal', fields: ['auto_renew'] }, WELL_FORMED_SIBLING],
    });
    requireLiveBody();

    expect(textCount('auto_renew')).toBe(1);
  });

  it('AUTHORED_LABEL_WINS: an explicit entry `label` is still the author\'s override', () => {
    renderDetails({
      sections: [
        {
          name: 'parties_enum',
          label: 'Parties',
          fields: [{ name: 'our_entity', label: 'Signatory' }],
        },
        WELL_FORMED_SIBLING,
      ],
    });
    requireLiveBody();

    expect(textCount('Signatory')).toBe(1);
    expect(textCount('Our Signing Entity')).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * C — the two bodies agree (acceptance 4)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('record:details — the group-derived and enumerated bodies render the same labels', () => {
  /**
   * Every party-field label the page renders, in DOM order.
   *
   * Scoped by FIXTURE rather than by DOM ancestry: only one section in each
   * render below names a party field, and the sibling section names none, so a
   * document-wide read cannot pick up a stray. An earlier attempt scoped with
   * `heading.closest('[data-slot="card"]')` and returned `[]` on the derived
   * body — the ancestry guess was wrong, and it failed in the direction that
   * reads as "the fix did nothing" rather than "the query was wrong". Measured,
   * so the next reader does not re-derive it.
   */
  const partyLabels = (): string[] =>
    screen
      .queryAllByText(/^(Our Signing Entity|Counterparty|our_entity|counterparty)$/)
      .map((n) => n.textContent?.trim() ?? '');

  it('BODIES_AGREE: the same fields, authored once as a group reference and once enumerated, read identically', () => {
    renderDetails({ sections: [{ group: 'parties' }, WELL_FORMED_SIBLING] });
    requireLiveBody();
    const derived = partyLabels();
    cleanup();

    renderDetails({
      sections: [
        { name: 'parties_enum', label: 'Parties', fields: ['our_entity', 'counterparty'] },
        WELL_FORMED_SIBLING,
      ],
    });
    requireLiveBody();
    const enumerated = partyLabels();

    // Non-vacuous first — an empty list would satisfy any equality.
    expect(derived).toEqual(['Our Signing Entity', 'Counterparty']);
    expect(enumerated).toEqual(derived);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * D — a `group` that names nothing is reported, never silent
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('record:details — a `group` naming no declared group', () => {
  it('UNRESOLVED_GROUP_IS_REPORTED: it renders nothing, says so once, and keeps its siblings', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderDetails({ sections: [{ group: 'no_such_group' }, WELL_FORMED_SIBLING] });
      requireLiveBody();

      // Siblings survive — the same containment as the resolvable case.
      expect(textCount('Term (Months)')).toBe(1);

      // ⭐ Not silent. `deriveFieldGroupLayout` drops a declared group nothing
      // references, and `@objectstack/spec` assigns EXISTENCE of a referenced
      // group to `@objectstack/lint` (`page-section-group-unknown`) rather than
      // to parse — so dropping is the contract. Vanishing without a word is not.
      const messages = spy.mock.calls.map((call) => String(call[0]));
      expect(messages.filter((m) => m.includes('no_such_group'))).toHaveLength(1);
      expect(messages.some((m) => m.includes('page-section-group-unknown'))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
