// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateTranslatableSections,
  TRANSLATION_SECTION_NAME_MISSING,
} from './validate-translatable-sections.js';
import { validateTranslationReferences } from './validate-translation-references.js';
import { Contact } from '../../../examples/app-showcase/src/data/objects/contact.object.js';
import { ContactViews } from '../../../examples/app-showcase/src/ui/views/contact.view.js';
import { ShowcaseTranslationBundle } from '../../../examples/app-showcase/src/system/translations/index.js';
// The frozen snapshot of that same shipped shape (#8515). Every case that pins
// a NAMELESS section reads it from here rather than from `examples/**` — see
// `showcase-shape.fixtures.ts` for why, and for what the lift did and did not
// carry across. The live imports above survive only in the cases that pin what
// the shipped app gets RIGHT, which no fix to the app can pull out from under.
import {
  SnapshotContact,
  SnapshotContactViews,
  SnapshotTaskViews,
  SnapshotTranslationBundle,
} from './showcase-shape.fixtures.js';

/** A `crm_case` object with the two fields the fixtures below lay out. */
const crmCase = {
  name: 'crm_case',
  label: 'Case',
  fields: [
    { name: 'subject', type: 'text', label: 'Subject' },
    { name: 'status', type: 'select', label: 'Status', options: [{ value: 'open', label: 'Open' }] },
  ],
};

/** A bundle that translates `crm_case` — the opt-in signal the rule gates on. */
const caseTranslated = [
  { 'zh-CN': { objects: { crm_case: { label: '个案', fields: { subject: { label: '主题' } } } } } },
];

const data = { provider: 'object', object: 'crm_case' };

/** The three nameless headings #5417 measured on HotCRM's `crm_case` form view. */
const hotcrmSections = [
  { label: 'Case', columns: 2, fields: ['subject'] },
  { label: 'SLA', columns: 2, fields: ['status'] },
  { label: 'Resolution', columns: 1, fields: ['status'] },
];

describe('validateTranslatableSections — the HotCRM shape (#5417)', () => {
  /**
   * The acceptance anchor from the issue: `crm_case`'s form view sections are
   * authored `{ label: 'Case' } / { label: 'SLA' } / { label: 'Resolution' }`
   * with no `name`, while its detail page's sections carry names and translate.
   * That difference is the reported `Case / SLA / Resolution` English strip
   * (#5408) — and until this rule, nothing said a word about it.
   */
  const stack = {
    objects: [crmCase],
    views: [
      {
        name: 'case_views',
        list: { name: 'all', type: 'grid', data },
        formViews: { edit: { type: 'simple', data, sections: hotcrmSections } },
      },
    ],
    translations: caseTranslated,
  };

  it('warns once per nameless labelled section, in authoring order', () => {
    const findings = validateTranslatableSections(stack);
    expect(findings.map((f) => f.path)).toEqual([
      'views[0].formViews.edit.sections[0]',
      'views[0].formViews.edit.sections[1]',
      'views[0].formViews.edit.sections[2]',
    ]);
    expect(findings.map((f) => f.rule)).toEqual([
      TRANSLATION_SECTION_NAME_MISSING,
      TRANSLATION_SECTION_NAME_MISSING,
      TRANSLATION_SECTION_NAME_MISSING,
    ]);
  });

  it('is advisory — one heading stays English, nothing breaks', () => {
    for (const finding of validateTranslatableSections(stack)) {
      expect(finding.severity).toBe('warning');
    }
  });

  it('names the heading, the object, and the key that can never exist', () => {
    const [first] = validateTranslatableSections(stack);
    expect(first.where).toBe('object "crm_case" · view "case_views" · formViews.edit · section "Case"');
    expect(first.message).toContain('Section "Case" declares a label but no `name`');
    expect(first.message).toContain('objects.crm_case._sections.<name>.label');
    // The coverage half of the invisibility, said out loud: #5405's walker is
    // keyed on `sections[].name`, so it cannot report this as missing either.
    expect(first.message).toContain('walks `sections[].name`');
  });

  it('suggests a snake_case name derived from the heading — as a hint, never a key', () => {
    const findings = validateTranslatableSections(stack);
    expect(findings[0].hint).toContain("`name: 'case'`");
    expect(findings[0].hint).toContain('objects.crm_case._sections.case.label');
    expect(findings[2].hint).toContain("`name: 'resolution'`");
    // The renderer resolves by name only. Saying so in the hint is what keeps an
    // author (or an AI author) from assuming the label text is itself a key —
    // the slug-fishing fallback objectui#3373 pinned as WRONG.
    expect(findings[0].hint).toContain('never a key derived from the label');
  });

  it('says nothing once the sections carry names', () => {
    const named = {
      ...stack,
      views: [
        {
          name: 'case_views',
          list: { name: 'all', type: 'grid', data },
          formViews: {
            edit: {
              type: 'simple',
              data,
              sections: hotcrmSections.map((s, i) => ({ ...s, name: ['case', 'sla', 'resolution'][i] })),
            },
          },
        },
      ],
    };
    expect(validateTranslatableSections(named)).toEqual([]);
  });
});

describe('validateTranslatableSections — the opt-in gate', () => {
  const nameless = {
    objects: [crmCase],
    views: [{ name: 'case_views', form: { type: 'simple', data, sections: hotcrmSections } }],
  };

  it('says nothing on a monolingual stack (no bundles at all)', () => {
    // Same invariant `computeI18nCoverage` holds: declare no locales and no
    // bundles and the gate reports nothing rather than inventing a debt.
    expect(validateTranslatableSections(nameless)).toEqual([]);
  });

  it('says nothing when the stack translates OTHER objects but not this one', () => {
    const findings = validateTranslatableSections({
      ...nameless,
      translations: [{ 'zh-CN': { objects: { crm_lead: { label: '线索' } } } }],
    });
    expect(findings).toEqual([]);
  });

  it('warns as soon as the object itself carries any translation', () => {
    const findings = validateTranslatableSections({ ...nameless, translations: caseTranslated });
    expect(findings).toHaveLength(3);
  });

  it('counts a bundle node with only a `_sections` entry as translated', () => {
    // The author has already started translating this object's headings — the
    // nameless ones next to them are exactly the gap worth naming.
    const findings = validateTranslatableSections({
      ...nameless,
      translations: [{ 'zh-CN': { objects: { crm_case: { _sections: { intro: { label: '简介' } } } } } }],
    });
    expect(findings).toHaveLength(3);
  });
});

describe('validateTranslatableSections — the section face', () => {
  /**
   * The anchors this rule covers must be exactly the anchors the two landed
   * halves read: the coverage walker's `section` kind (#5416) and this
   * package's `_sections` fact set (#5422). Each case below is asserted TWICE —
   * once nameless (this rule warns) and once named + translated (the sibling
   * rule accepts the key). An anchor missing from either list fails one half.
   */
  const bothWays = (build: (sections: unknown[]) => Record<string, unknown>, sectionName: string) => {
    const nameless = { ...build([{ label: 'Heading', fields: ['subject'] }]), translations: caseTranslated };
    const named = {
      ...build([{ name: sectionName, label: 'Heading', fields: ['subject'] }]),
      translations: [
        { 'zh-CN': { objects: { crm_case: { _sections: { [sectionName]: { label: '标题' } } } } } },
      ],
    };
    return { nameless, named };
  };

  const anchors: Array<[string, (sections: unknown[]) => Record<string, unknown>, string]> = [
    [
      "a container's default `form` (#5415)",
      (sections) => ({ objects: [crmCase], views: [{ name: 'v', form: { type: 'simple', data, sections } }] }),
      'form_section',
    ],
    [
      'a named `formViews.*` entry',
      (sections) => ({
        objects: [crmCase],
        views: [{ name: 'v', list: { name: 'all', data }, formViews: { create: { type: 'simple', sections } } }],
      }),
      'create_section',
    ],
    [
      'a `listViews.*` entry',
      (sections) => ({
        objects: [crmCase],
        views: [{ name: 'v', list: { name: 'all', data }, listViews: { mine: { sections } } }],
      }),
      'list_section',
    ],
    [
      "the view record's own `sections`",
      (sections) => ({ objects: [crmCase], views: [{ name: 'v', object: 'crm_case', sections }] }),
      'record_section',
    ],
    [
      'a view embedded on the object',
      (sections) => ({
        objects: [{ ...crmCase, views: [{ name: 'inner', form: { type: 'simple', sections } }] }],
      }),
      'inner_section',
    ],
    [
      "the object's own `listViews` container",
      (sections) => ({ objects: [{ ...crmCase, listViews: { compact: { sections } } }] }),
      'compact_section',
    ],
    [
      "a page's `record:details` (#5416's page half)",
      (sections) => ({
        objects: [crmCase],
        pages: [
          {
            name: 'case_detail',
            object: 'crm_case',
            regions: [{ components: [{ type: 'record:details', properties: { sections } }] }],
          },
        ],
      }),
      'details_section',
    ],
    [
      'a `record:details` nested inside `page:tabs`',
      (sections) => ({
        objects: [crmCase],
        pages: [
          {
            name: 'case_detail',
            object: 'crm_case',
            regions: [
              {
                components: [
                  {
                    type: 'page:tabs',
                    properties: {
                      items: [
                        { children: [{ type: 'record:details', properties: { sections } }] },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      }),
      'tabbed_section',
    ],
  ];

  for (const [label, build, sectionName] of anchors) {
    it(`covers ${label}`, () => {
      const { nameless, named } = bothWays(build, sectionName);
      expect(validateTranslatableSections(nameless)).toHaveLength(1);
      expect(validateTranslatableSections(nameless)[0].message).toContain('objects.crm_case._sections');
      // The co-derivation half: the same anchor, NAMED, is a key the reference
      // validator accepts. If either list drifts, exactly one of these fails.
      expect(validateTranslatableSections(named)).toEqual([]);
      expect(validateTranslationReferences(named)).toEqual([]);
    });
  }
});

describe('validateTranslatableSections — what it deliberately leaves alone', () => {
  it('ignores `fieldGroups`-derived sections (their key IS the name)', () => {
    const findings = validateTranslatableSections({
      objects: [
        {
          ...crmCase,
          fieldGroups: [{ key: 'basics', label: 'Basics' }],
          fields: [
            { name: 'subject', type: 'text', label: 'Subject', group: 'basics' },
            { name: 'status', type: 'select', label: 'Status', group: 'basics' },
          ],
        },
      ],
      translations: caseTranslated,
    });
    expect(findings).toEqual([]);
  });

  it('ignores a name-keyed `sections` MAP (the key supplies the name)', () => {
    const findings = validateTranslatableSections({
      objects: [crmCase],
      views: [{ name: 'v', form: { type: 'simple', data, sections: { intro: { label: 'Intro' } } } }],
      translations: caseTranslated,
    });
    expect(findings).toEqual([]);
  });

  it('ignores a section with no heading at all — that is `required/label`\'s question', () => {
    const findings = validateTranslatableSections({
      objects: [crmCase],
      views: [{ name: 'v', form: { type: 'simple', data, sections: [{ fields: ['subject'] }] } }],
      translations: caseTranslated,
    });
    expect(findings).toEqual([]);
  });

  it('ignores a container bound to no object at all', () => {
    // Nothing resolves `_sections` without an object, so there is no key to
    // describe — and guessing an owner is how a rule reports the wrong one.
    const findings = validateTranslatableSections({
      objects: [crmCase],
      views: [{ name: 'v', form: { type: 'simple', sections: hotcrmSections } }],
      translations: caseTranslated,
    });
    expect(findings).toEqual([]);
  });

  // #5730: `label` is the only heading spelling `RecordDetailsProps.sections[]`
  // declares (#5611). The rule used to read `label ?? title`, which meant an
  // off-spec `title` earned a translation-shaped warning — telling the author
  // their `title` heading needed a `name` to be translatable, i.e. teaching the
  // spelling the schema rejects. The two cases below are one pin, deliberately
  // PAIRED: the `label` case proves the walk reaches this component at all, so
  // the `title` case's empty result is the tolerance being gone and not the
  // fixture failing to arrive (#5046's "green because nothing was produced").
  const namelessDetailSection = (section: Record<string, unknown>) => ({
    objects: [crmCase],
    pages: [
      {
        name: 'case_detail',
        object: 'crm_case',
        regions: [{ components: [{ type: 'record:details', properties: { sections: [section] } }] }],
      },
    ],
    translations: caseTranslated,
  });

  it('reads a detail section\'s `label` as its heading', () => {
    const findings = validateTranslatableSections(namelessDetailSection({ label: 'SLA' }));
    expect(findings).toHaveLength(1);
    expect(findings[0].where).toContain('section "SLA"');
  });

  it('does NOT read a detail section\'s off-spec `title` as its heading', () => {
    const findings = validateTranslatableSections(namelessDetailSection({ title: 'SLA' }));
    expect(findings).toEqual([]);
  });

  it('keys a retargeted component under the object it actually binds', () => {
    // A `record:details` pointed at another object keys its headings THERE, so
    // the gate must consult that object's translations, not the page's.
    const page = {
      name: 'case_detail',
      object: 'crm_lead',
      regions: [
        {
          components: [
            {
              type: 'record:details',
              dataSource: { object: 'crm_case' },
              properties: { sections: [{ label: 'SLA' }] },
            },
          ],
        },
      ],
    };
    const findings = validateTranslatableSections({
      objects: [crmCase, { name: 'crm_lead', fields: [] }],
      pages: [page],
      translations: caseTranslated,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('objects.crm_case._sections');
  });

  it('returns nothing for an empty stack', () => {
    expect(validateTranslatableSections({})).toEqual([]);
  });
});

/**
 * #5417 measured against the metadata the repo actually ships — on a FROZEN
 * SNAPSHOT of it since #8515.
 *
 * The shape is still the shipped one and is still not reduced by hand: the
 * defect this rule reports is an anchor MISSING from a list, and a fixture built
 * from memory can only pin the anchors whoever wrote it remembered. So the
 * container below is a copy of the whole shipped task container — all thirteen
 * list views included, precisely because they declare no sections and the
 * assertion here is exhaustive — parsed through the same `defineView` the app
 * uses, and verified structurally identical to the live one at snapshot time.
 *
 * What changed in #8515 is only WHERE it is read from. `TaskViews` was imported
 * live from `examples/app-showcase` until then, which made the rule's regression
 * coverage depend on the shipped app STAYING defective: the two nameless
 * headings asserted below were simultaneously the defect #8231 was sweeping up
 * and the evidence that the rule fires on real metadata. The maintainer ruled
 * (2026-08-13) that the fixture moves and the app gets fixed; this is the first
 * half. ⚠️ The honest cost, recorded rather than papered over: after #8231's
 * remainder names those sections, this case no longer proves the rule fires on
 * metadata that actually ships today — it proves it fires on metadata that
 * really did, in the shape it really had.
 *
 * (Historic measurement, unchanged: `os validate` over the whole showcase config
 * reported 14 of these — 6 from form views, 8 from `record:details` pages — and
 * still exited 0, because they are `warning` findings and only `error` gates.)
 */
describe('validateTranslatableSections — the snapshotted showcase task views', () => {
  it('reports both nameless headings the shipped task container declares', () => {
    const findings = validateTranslatableSections({
      views: [SnapshotTaskViews],
      translations: [SnapshotTranslationBundle],
    });
    expect(findings.map((f) => f.where)).toEqual([
      'object "showcase_task" · formViews.edit · section "Task"',
      'object "showcase_task" · formViews.quick · section "Quick Edit"',
    ]);
    for (const finding of findings) {
      expect(finding.rule).toBe(TRANSLATION_SECTION_NAME_MISSING);
      expect(finding.severity).toBe('warning');
    }
  }, 60_000);
});

/**
 * The other half of the showcase evidence, on the surface #5415 pinned.
 *
 * `ContactViews` is exported from the views barrel but not listed in the
 * showcase's `views:` array, so it is composed here exactly as #5415's sibling
 * test composes it — object + container. What makes it worth pinning is the
 * CONTRAST it carries in one file: the default `form` names all four of its
 * sections (and #5415 pins that the reference validator accepts bundles for
 * exactly those four), while the sparse `formViews.create` override names none.
 * One rule must therefore be silent about the first and loud about the second,
 * or the two rules would tell an author opposite things about one surface.
 *
 * ⚠️ The two cases below read the same surface from DIFFERENT places, and the
 * split is the point of #8515 rather than an oversight:
 *
 *   - the NAMELESS half — `formViews.create`'s "Who is this?" — is the defect
 *     #8231 is fixing, so pinning it against the live app made the rule's
 *     coverage depend on the app staying broken. It reads the frozen snapshot.
 *   - the NAMED half — the four sections of the default `form` — is what the
 *     shipped app gets RIGHT. Nothing about fixing the create override can
 *     remove it, so it stays pinned against the metadata that really ships, and
 *     the rule keeps one live real-metadata anchor.
 */
describe('validateTranslatableSections — the showcase contact surface (#5415)', () => {
  /** The frozen snapshot (#8515) — the nameless-section half. */
  const snapshotContactStack = {
    objects: [SnapshotContact],
    views: [SnapshotContactViews],
    translations: [SnapshotTranslationBundle],
  };

  /** The live shipped metadata — the named-section half. */
  const showcaseContactStack = {
    objects: [Contact],
    views: [ContactViews],
    translations: [ShowcaseTranslationBundle],
  };

  it('reports the sparse create override and nothing from the named default form', () => {
    const findings = validateTranslatableSections(snapshotContactStack);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(TRANSLATION_SECTION_NAME_MISSING);
    expect(findings[0].path).toBe('views[0].formViews.create.sections[0]');
    expect(findings[0].where).toBe(
      'object "showcase_contact" · formViews.create · section "Who is this?"',
    );
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].hint).toContain('objects.showcase_contact._sections.who_is_this.label');
  }, 60_000);

  it('agrees with #5415 about the four sections the default form names', () => {
    // Those four ARE addressable, and `validateTranslationReferences` accepts
    // bundles for them. This rule must stay silent there.
    const paths = validateTranslatableSections(showcaseContactStack).map((f) => f.path);
    expect(paths.filter((p) => p.startsWith('views[0].form.sections'))).toEqual([]);
    expect(
      validateTranslationReferences({
        objects: [Contact],
        views: [ContactViews],
        translations: [
          {
            'zh-CN': {
              objects: {
                showcase_contact: {
                  _sections: {
                    contact: { label: '联系方式' },
                    work: { label: '工作' },
                    status: { label: '状态' },
                    notes: { label: '备注' },
                  },
                },
              },
            },
          },
        ],
      }),
    ).toEqual([]);
  }, 60_000);
});
