// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8813 — the public form `/f/:slug` resolves its section headings and
 * field labels through the app's i18n bundle. Seam 2 of #8408.
 *
 * ## The defect, in the DOM
 *
 * A `zh-CN` visitor opening a published form was greeted by "Your application"
 * — the string the author typed while building the form — even though the app
 * bundle carried `objects.ats_inquiry._sections.apply.label`. The renderer
 * never looked: `buildSections` copied `sec.label` and DROPPED `sec.name`, so
 * the key `objects.{object}._sections.{name}.label` could not be constructed at
 * the render site at all. Carrying `sec.name` is therefore a precondition of
 * this fix, not a tidy-up beside it.
 *
 * ## ⚠️⚠️ Why a green test here proves less than it looks like — read first
 *
 * An `I18nProvider` IS mounted above this route (measured on the real tree with
 * a four-cell control matrix, #8813: a probe calling `useI18nContext()`, which
 * throws outside a provider, answers YES in `FormPage`'s exact route position
 * under the real `main.tsx` wrapper and NO with the wrapper removed). So
 * `useSafeFieldLabel` returns REAL resolvers here and nothing throws — which
 * inverts the usual hazard:
 *
 *   ⇒ a passing assertion proves the resolver RAN. It does not prove a KEY was
 *     FOUND. An identity function and a successful lookup are indistinguishable
 *     from the outside whenever the expected string happens to equal the
 *     fallback.
 *
 * Every leg below is therefore written so the expected string and the fallback
 * are DIFFERENT strings, and the file's discriminating power was measured, not
 * assumed, by two ablations recorded on the PR:
 *
 *   1. delete `objects.ats_inquiry._sections.apply.label` from {@link BUNDLE}
 *      -> `SECTION_HEADING_IS_TRANSLATED` FAILS (it reads the authored English
 *      fallback). This is the leg that can tell a found key from a missed one;
 *      given nothing throws, it is the ONLY one that can.
 *   2. delete `name: sec.name` from `buildSections` -> the same leg FAILS,
 *      because the key can no longer be built. That is the structural blocker
 *      this card exists for.
 *
 * ## ⚠️ Which visitor this file covers: one who HOLDS a bundle
 *
 * This file seeds the app bundle itself (`createI18n` in `beforeEach`), so it
 * covers a visitor of `/f/:slug` whose console loaded one: the signed-in
 * visitor. Since objectui#12034 a signed-out visitor holds none — the `/i18n`
 * domain refuses an anonymous caller (objectstack-ai/objectstack#22432) and
 * `loadLanguage` answers `{}` — so every lookup below misses on that path, and
 * the server's payload is what localizes it (objectstack-ai/objectstack#23497).
 * That path is pinned by `FormPage.signedOutSectionI18n-12333.test.tsx`.
 *
 * ## ⛔ Not a provider-wrapped harness — and the difference matters
 *
 * The acceptance criterion is an assertion on the ROUTE, not on a fixture built
 * to make one pass. So the tree rendered below is the route `App.tsx` declares
 * for `/f/:slug` — `<Route path="/f/:slug" element={<FormPage mode="public" />}
 * />` — with no provider wrapped around it. No `I18nProvider` appears in this
 * file. The one thing it adds that production does not have for EVERY visitor
 * is the seeded bundle: a signed-out visitor has none (see above).
 *
 * The bundle instead reaches the resolvers the way it reaches every unwrapped
 * consumer: `createI18n` registers its instance as react-i18next's
 * process-global (via `initReactI18next`), and `useTranslation` binds to that
 * global whenever no context supplies one — the same mechanism, pinned in
 * `packages/i18n/src/__tests__/useObjectLabel-identity-5564.test.tsx`, that
 * makes `useSafeFieldLabel` provider-optional in the first place. Wrapping the
 * route in a provider would test that a provider works; this tests that the
 * ROUTE resolves.
 *
 * ## ⛔ The key is the section's stable `name`, never its authored label
 *
 * `KEY_IS_THE_SECTION_NAME_NOT_THE_LABEL` fences that with a decoy entry filed
 * under the authored heading. The same rule is pinned for the sibling renderer
 * by `packages/plugin-form/src/__tests__/sectionLabelI18n.test.tsx`, and that
 * pin exists because the two halves of the form renderer drifted apart once
 * already.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ─── Fixture — #8408's real payload, in a translated app ──────────────────

/** The app namespace the bundle is filed under (`{ns}.objects.…`). */
const NS = 'ats';
/** The object the public form writes to — and the `{objectName}` in every key. */
const API_NAME = 'ats_inquiry';
/** The language a member of the public arrives in. */
const LANG = 'zh-CN';

/** The section's STABLE name — the only thing that may appear in a key. */
const SECTION_NAME = 'apply';
/** What the author typed. Rendered today, on every language. */
const SECTION_AUTHORED = 'Your application';
/** What the bundle says. Rendered only if the lookup actually happens. */
const SECTION_TRANSLATED = '您的申请';

/** A field label: authored (and server-served) vs. what the bundle overlays. */
const FIELD_AUTHORED = 'Full Name';
const FIELD_TRANSLATED = '姓名';

/** A named section the bundle says NOTHING about — the fallback leg. */
const UNTRANSLATED_NAME = 'consent';
const UNTRANSLATED_AUTHORED = 'Consent';

/** A section authored with no `name` at all — it has no key, and may not need one. */
const NAMELESS_AUTHORED = 'Attachments';

/**
 * ⛔ The decoy. A bundle entry keyed by the AUTHORED HEADING rather than by the
 * section name. Nothing may ever render this string: a renderer that reaches
 * this entry is one that guessed a key from the author's prose.
 */
const DECOY = '⛔ keyed by the authored label';

const BUNDLE = {
  [NS]: {
    objects: {
      [API_NAME]: {
        _sections: {
          [SECTION_NAME]: { label: SECTION_TRANSLATED },
          [SECTION_AUTHORED]: { label: DECOY },
        },
      },
    },
    fields: {
      [API_NAME]: {
        full_name: FIELD_TRANSLATED,
      },
    },
  },
};

const INQUIRY_SCHEMA = {
  name: API_NAME,
  label: 'Inquiry',
  fields: {
    full_name: { type: 'text', label: FIELD_AUTHORED, required: true },
    email: { type: 'text', label: 'Email' },
    consent_ack: { type: 'text', label: 'I agree' },
  },
};

const APPLY_FORM = {
  type: 'simple',
  columns: 1,
  title: 'Apply',
  sections: [
    // Named + translated — the card's own section.
    { name: SECTION_NAME, label: SECTION_AUTHORED, fields: ['full_name'] },
    // Named, absent from the bundle — the fallback must survive.
    { name: UNTRANSLATED_NAME, label: UNTRANSLATED_AUTHORED, fields: ['consent_ack'] },
    // Unnamed — no key exists, and none is invented.
    { label: NAMELESS_AUTHORED, fields: ['email'] },
  ],
};

/** How many sections the fixture draws — the harness's own liveness anchor. */
const SECTION_COUNT = APPLY_FORM.sections.length;

const SERVED = {
  slug: 'apply',
  object: API_NAME,
  form: APPLY_FORM,
  objectSchema: INQUIRY_SCHEMA,
};

// ─── Harness ──────────────────────────────────────────────────────────────

function stubFetch(body: unknown) {
  return vi.fn(async (url: string) => {
    if (!String(url).includes('/forms/apply')) {
      throw new Error(`unstubbed fetch: ${url}`);
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
}

/**
 * Render the PUBLIC route, unwrapped.
 *
 * ⚠️ Deliberately identical to the element `App.tsx` declares. Anything added
 * around it would move this file off the route and onto a harness — see the
 * header.
 */
function renderPublicRoute() {
  vi.stubGlobal('fetch', stubFetch(SERVED));
  return render(
    <MemoryRouter initialEntries={['/f/apply']}>
      <Routes>
        <Route path="/f/:slug" element={<FormPage mode="public" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * The landmark every leg navigates by.
 *
 * Its failure text is unlike every content assertion in this file on purpose: a
 * form that never loaded, or one drawn twice, must never be scored as "the
 * translation was refused" when the ablation legs are classified.
 */
async function liveSections(): Promise<HTMLElement[]> {
  await waitFor(() =>
    expect(document.body.querySelectorAll('form > section').length).toBe(SECTION_COUNT),
  );
  const sections = Array.from(
    document.body.querySelectorAll<HTMLElement>('form > section'),
  );
  if (sections.length !== SECTION_COUNT) {
    throw new Error(
      `HARNESS DEAD 8813: expected ${SECTION_COUNT} sections, found ${sections.length}`,
    );
  }
  const headings = document.body.querySelectorAll('form > section > h2');
  if (headings.length !== SECTION_COUNT) {
    throw new Error(
      `HARNESS DEAD 8813: expected ${SECTION_COUNT} section headings, found ${headings.length}`,
    );
  }
  return sections;
}

/** Every section heading on the page, in document order. */
const headings = (sections: HTMLElement[]): string[] =>
  sections.map((s) => s.querySelector('h2')?.textContent ?? '');

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // One fresh instance per test, so no leg can inherit another's bundle. This
  // is the app's OWN factory — the same call `I18nProvider` makes — and it
  // registers itself as react-i18next's process-global, which is how an
  // unwrapped consumer sees a bundle at all.
  createI18n({
    defaultLanguage: LANG,
    detectBrowserLanguage: false,
    resources: { [LANG]: BUNDLE },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('objectui#8813 — public form i18n on the /f/:slug route', () => {
  it('SECTION_HEADING_IS_TRANSLATED — the bundle string renders, not the authored one', async () => {
    renderPublicRoute();
    const sections = await liveSections();

    // ⭐ The discriminating leg. Both directions asserted: the translation is
    // present AND the authored fallback is gone. "Contains something" would be
    // satisfied by the identity function this route's resolvers degrade to.
    expect(sections[0].querySelector('h2')?.textContent).toBe(SECTION_TRANSLATED);
    expect(headings(sections)).not.toContain(SECTION_AUTHORED);
  });

  it('FIELD_LABEL_IS_TRANSLATED — the field label resolves through the same bundle', async () => {
    renderPublicRoute();
    const sections = await liveSections();

    const label = sections[0].querySelector('label');
    expect(label?.textContent).toContain(FIELD_TRANSLATED);
    expect(label?.textContent).not.toContain(FIELD_AUTHORED);
    // The control is still an input the visitor can fill in, addressed by the
    // translated name — a label detached from its control would satisfy the
    // text assertion above and be a worse form than the untranslated one.
    expect(screen.getByLabelText(new RegExp(FIELD_TRANSLATED))).toBeInTheDocument();
  });

  it('KEY_IS_THE_SECTION_NAME_NOT_THE_LABEL — the decoy entry is unreachable', async () => {
    renderPublicRoute();
    const sections = await liveSections();

    // The bundle carries BOTH `_sections.apply.label` and a decoy filed under
    // the authored heading. Only the first may ever be read.
    expect(document.body.textContent).not.toContain(DECOY);
    expect(sections[0].querySelector('h2')?.textContent).toBe(SECTION_TRANSLATED);
  });

  it('MISSING_KEY_KEEPS_THE_AUTHORED_HEADING — the fallback is not widened away', async () => {
    renderPublicRoute();
    const sections = await liveSections();

    // A named section the bundle says nothing about. The resolver runs and
    // misses, and what the author wrote must survive that miss — a form whose
    // untranslated sections went blank would be a worse defect than this card's.
    expect(sections[1].querySelector('h2')?.textContent).toBe(UNTRANSLATED_AUTHORED);
  });

  it('NAMELESS_SECTION_STILL_RENDERS_ITS_HEADING — no key, no invention, no crash', async () => {
    renderPublicRoute();
    const sections = await liveSections();

    // `name` is optional on the authoring surface. A section without one has no
    // key; it keeps its heading and nothing is guessed from its prose.
    expect(sections[2].querySelector('h2')?.textContent).toBe(NAMELESS_AUTHORED);
  });

  it('HARNESS_KILL — the liveness anchor fires when the form never loads', async () => {
    // Proves the anchor above can actually fail, so a dead render can never be
    // silently scored as a translated one.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    render(
      <MemoryRouter initialEntries={['/f/apply']}>
        <Routes>
          <Route path="/f/:slug" element={<FormPage mode="public" />} />
        </Routes>
      </MemoryRouter>,
    );
    await expect(liveSections()).rejects.toThrow();
  });
});
