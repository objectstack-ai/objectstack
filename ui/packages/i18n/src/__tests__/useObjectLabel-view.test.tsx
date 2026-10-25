import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useObjectTranslation } from '../provider';
import { useObjectLabel } from '../useObjectLabel';
import { pickLocalized } from '../pickLocalized';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(
    I18nProvider,
    { config: { defaultLanguage: 'en', detectBrowserLanguage: false }, children },
  );

/** Same provider, with the dev missing-key warner explicitly on. */
const warningWrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(
    I18nProvider,
    {
      config: { defaultLanguage: 'en', detectBrowserLanguage: false, warnMissingKeys: true },
      children,
    },
  );

describe('useObjectLabel().viewLabel', () => {
  it('resolves an authored view translation from a qualified runtime view id', () => {
    const { result } = renderHook(
      () => ({ labels: useObjectLabel(), i18n: useObjectTranslation().i18n }),
      { wrapper },
    );
    result.current.i18n.addResourceBundle(
      'en',
      'translation',
      {
        crm: {
          objects: {
            crm_opportunity: {
              _views: {
                pipeline_kanban: {
                  label: 'Localized pipeline',
                  description: 'Localized pipeline description',
                  emptyState: {
                    title: 'No localized records',
                    message: 'Create a localized record to begin.',
                  },
                },
              },
            },
          },
        },
      },
      true,
      true,
    );

    expect(
      result.current.labels.viewLabel(
        'crm_opportunity',
        'crm_opportunity.pipeline_kanban',
        'Sales Pipeline',
      ),
    ).toBe('Localized pipeline');
    // The bundle above also authors `description` on that same `_views` node.
    // It resolves NOWHERE — that key is the retired catalog convention
    // (objectui#7219), and its inertness is pinned in its own describe below,
    // where the authored channel that replaced it is asserted alongside.
    expect(
      result.current.labels.viewEmptyState(
        'crm_opportunity',
        'crm_opportunity.pipeline_kanban',
        { title: 'No opportunities', message: 'Create one to begin.' },
      ),
    ).toEqual({
      title: 'No localized records',
      message: 'Create a localized record to begin.',
    });
  });

  it('continues to resolve an unqualified authored view name', () => {
    const { result } = renderHook(
      () => ({ labels: useObjectLabel(), i18n: useObjectTranslation().i18n }),
      { wrapper },
    );
    result.current.i18n.addResourceBundle(
      'en',
      'translation',
      {
        crm: {
          objects: {
            crm_opportunity: {
              _views: {
                pipeline_kanban: { label: 'Localized pipeline' },
              },
            },
          },
        },
      },
      true,
      true,
    );

    expect(
      result.current.labels.viewLabel(
        'crm_opportunity',
        'pipeline_kanban',
        'Sales Pipeline',
      ),
    ).toBe('Localized pipeline');
  });
});

/**
 * objectui#7219 (maintainer ruling 2026-09-02, option B): the catalog convention
 * `{ns}.objects.{objectName}._views.{viewName}.description` is retired together
 * with the `useObjectLabel().viewDescription()` member that resolved it.
 *
 * A list view's description has exactly ONE channel: the `I18nLabel` value
 * authored on the view entry — a string or an inline locale map — which
 * `ObjectView` relays (objectui#7199) and the render site resolves with
 * `pickLocalized`, the call `plugin-list`'s `ListView` makes. The catalog key
 * was declared and resolved here with zero callers and zero in-repo bundle
 * usage, so an entry authored under it reached no screen; wiring it in instead
 * would have put two vocabularies on one concept and required a precedence
 * rule, which is the ambiguity rather than the fix.
 *
 * ⚠️ WHY THIS IS NOT AN ABSENCE ASSERTION. A pin that only checked the member
 * is gone would be green on any tree where it never existed — including a tree
 * where the resolver was quietly broken. So this case AUTHORS the catalog entry
 * and then measures three things that only hold together in the ruled world:
 *
 *   1. CONTROL — the catalog node is live and reachable from here: `label` and
 *      `emptyState`, the two siblings sitting on the very same `_views` node,
 *      resolve out of the bundle. An instrument that answered "no translation"
 *      for those would make the description's silence meaningless.
 *   2. Nothing on the hook reads that node's `description` — at runtime, and in
 *      the return TYPE (`tsconfig.test.json` compiles this file, so the
 *      `@ts-expect-error` below is a real check of the published contract).
 *   3. The description a consumer renders is the AUTHORED value, and it is a
 *      DIFFERENT string from the catalog one.
 *
 * A reintroduced catalog channel fails this at either precedence:
 * catalog-over-authored changes the resolved string (3), authored-over-catalog
 * puts the member and its type back (2).
 */
describe('`_views.<view>.description` is an inert catalog entry (objectui#7219)', () => {
  /** What an out-of-repo translation bundle would author under the retired key. */
  const CATALOG_DESCRIPTION = 'Catalog pipeline description — must not surface';
  /** The surviving channel: the `I18nLabel` authored on the view entry itself. */
  const AUTHORED_DESCRIPTION = { en: 'Authored pipeline description', zh: '作者撰写的视图说明' };

  it('has no reader on the hook, and the authored value is what a consumer resolves', () => {
    const { result } = renderHook(
      () => ({ labels: useObjectLabel(), i18n: useObjectTranslation().i18n }),
      { wrapper },
    );
    result.current.i18n.addResourceBundle(
      'en',
      'translation',
      {
        crm: {
          objects: {
            crm_opportunity: {
              _views: {
                pipeline_kanban: {
                  label: 'Localized pipeline',
                  // The retired catalog key, authored exactly as a bundle would.
                  description: CATALOG_DESCRIPTION,
                  emptyState: {
                    title: 'No localized records',
                    message: 'Create a localized record to begin.',
                  },
                },
              },
            },
          },
        },
      },
      true,
      true,
    );
    const { labels } = result.current;

    // 1. CONTROL — this node IS live: both surviving siblings resolve off it.
    expect(
      labels.viewLabel('crm_opportunity', 'crm_opportunity.pipeline_kanban', 'Sales Pipeline'),
    ).toBe('Localized pipeline');
    expect(
      labels.viewEmptyState('crm_opportunity', 'crm_opportunity.pipeline_kanban', {
        title: 'No opportunities',
        message: 'Create one to begin.',
      }),
    ).toEqual({
      title: 'No localized records',
      message: 'Create a localized record to begin.',
    });

    // 2. Nothing on the hook reads that node's `description` — at runtime…
    expect(Object.keys(labels)).not.toContain('viewDescription');
    // …and not in the return type either, which is the half the changeset
    // announces to consumers.
    // @ts-expect-error removed from the hook's return type by objectui#7219.
    expect(labels.viewDescription).toBeUndefined();

    // 3. What a consumer renders is the AUTHORED value on the view entry,
    // through the same `pickLocalized` call `ListView` makes…
    const viewEntry = { name: 'pipeline_kanban', description: AUTHORED_DESCRIPTION };
    expect(pickLocalized(viewEntry.description, 'en')).toBe('Authored pipeline description');
    // …and never the catalog string authored on the same node above.
    expect(pickLocalized(viewEntry.description, 'en')).not.toBe(CATALOG_DESCRIPTION);
  });
});

/**
 * objectstack#5164 ruling A (2026-08-06): the canonical `_views` translation key
 * is the runtime view identity's BARE name. The extractor now derives it from the
 * view composer (objectstack#6124) and `packages/lint` enforces that one spelling
 * (objectstack#6038); this resolver used to additionally accept the prefixed full
 * name (`_views.<objectName>.<viewName>`) as a second candidate, which made the
 * Console show a translated label while the server-side resolver — which reads the
 * one key only (objectstack#5165) — still served English to every consumer that
 * does not re-resolve (REST, mobile, plain HTTP, SDUI).
 *
 * These pin BOTH directions of the narrowing: the bare key resolves, and the
 * prefixed spelling falls through to the metadata default on every surface that
 * goes through `viewSuffixes` (label / emptyState — `description` is no longer
 * one of them, objectui#7219).
 */
describe('useObjectLabel() view keys — bare-key-only resolution (objectui#3502)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not resolve a view translation authored under the prefixed full name', () => {
    const { result } = renderHook(
      () => ({ labels: useObjectLabel(), i18n: useObjectTranslation().i18n }),
      { wrapper },
    );
    result.current.i18n.addResourceBundle(
      'en',
      'translation',
      {
        crm: {
          objects: {
            crm_opportunity: {
              _views: {
                // The rejected spelling: the view name still carries its object
                // prefix, so the bundle nests `crm_opportunity` under `_views`.
                crm_opportunity: {
                  pipeline_kanban: {
                    label: 'Prefixed pipeline',
                    description: 'Prefixed pipeline description',
                    emptyState: {
                      title: 'Prefixed empty title',
                      message: 'Prefixed empty message.',
                    },
                  },
                },
              },
            },
          },
        },
      },
      true,
      true,
    );

    expect(
      result.current.labels.viewLabel(
        'crm_opportunity',
        'crm_opportunity.pipeline_kanban',
        'Sales Pipeline',
      ),
    ).toBe('Sales Pipeline');
    expect(
      result.current.labels.viewEmptyState(
        'crm_opportunity',
        'crm_opportunity.pipeline_kanban',
        { title: 'No opportunities', message: 'Create one to begin.' },
      ),
    ).toEqual({
      title: 'No opportunities',
      message: 'Create one to begin.',
    });
  });

  it('resolves the bare key even when a prefixed sibling exists', () => {
    const { result } = renderHook(
      () => ({ labels: useObjectLabel(), i18n: useObjectTranslation().i18n }),
      { wrapper },
    );
    result.current.i18n.addResourceBundle(
      'en',
      'translation',
      {
        crm: {
          objects: {
            crm_opportunity: {
              _views: {
                pipeline_kanban: { label: 'Bare pipeline' },
                crm_opportunity: {
                  pipeline_kanban: { label: 'Prefixed pipeline' },
                },
              },
            },
          },
        },
      },
      true,
      true,
    );

    expect(
      result.current.labels.viewLabel(
        'crm_opportunity',
        'crm_opportunity.pipeline_kanban',
        'Sales Pipeline',
      ),
    ).toBe('Bare pipeline');
  });

  it('keeps the object-name axis: a short-object-name bundle still resolves', () => {
    const { result } = renderHook(
      () => ({ labels: useObjectLabel(), i18n: useObjectTranslation().i18n }),
      { wrapper },
    );
    // Only the view axis was narrowed. The object axis (namespaced name first,
    // then the `__`-stripped base name) is a separate fallback and stays.
    result.current.i18n.addResourceBundle(
      'en',
      'translation',
      {
        crm: {
          objects: {
            opportunity: {
              _views: {
                pipeline_kanban: { label: 'Localized pipeline' },
              },
            },
          },
        },
      },
      true,
      true,
    );

    expect(
      result.current.labels.viewLabel(
        'crm__opportunity',
        'crm__opportunity.pipeline_kanban',
        'Sales Pipeline',
      ),
    ).toBe('Localized pipeline');
    // A runtime id qualified with the short object name strips just as well.
    expect(
      result.current.labels.viewLabel(
        'crm__opportunity',
        'opportunity.pipeline_kanban',
        'Sales Pipeline',
      ),
    ).toBe('Localized pipeline');
  });

  it('falls back visibly on screen, without adding dev-console noise', () => {
    // "Loud" here means the on-screen label is the untranslated metadata default
    // on EVERY consumer, not a Console-only success. The dev missing-key warner
    // stays out of it by design: convention probes carry `I18N_PROBE_FLAG`
    // (see `i18n.ts`) because they miss on every app that authored no view
    // translations at all, so warning here would fire on the healthy path rather
    // than the broken one. A `_views` key written under the rejected spelling is
    // reported at authoring time by `os lint` (`translation-target-unknown`,
    // objectstack#6038) — at the producer, per contract-first.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(
      () => ({ labels: useObjectLabel(), i18n: useObjectTranslation().i18n }),
      { wrapper: warningWrapper },
    );
    result.current.i18n.addResourceBundle(
      'en',
      'translation',
      {
        crm: {
          objects: {
            crm_opportunity: {
              _views: {
                crm_opportunity: { pipeline_kanban: { label: 'Prefixed pipeline' } },
              },
            },
          },
        },
      },
      true,
      true,
    );
    warnSpy.mockClear();

    expect(
      result.current.labels.viewLabel(
        'crm_opportunity',
        'crm_opportunity.pipeline_kanban',
        'Sales Pipeline',
      ),
    ).toBe('Sales Pipeline');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
