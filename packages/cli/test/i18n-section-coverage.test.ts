// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#5405 — an object's SECTION headings were the one declared,
// resolved, rendered translation surface the shared walker had no kind for.
// `ExpectedEntry['source']` listed object/field/option/view/action/... and two
// `metadataForm*` kinds (Studio metadata forms, a different namespace), so
// `objects.<o>._sections.<s>.label` was structurally unreachable: `os i18n
// extract` never scaffolded a heading and `os lint` could not report one
// missing. Measured downstream (hotcrm#697): 85 sections across 15 objects,
// 2 of 85 translated in ja-JP and es-ES, and `objectstack lint` reported
// ZERO i18n warnings for both.
//
// The surface itself was never in doubt — `ObjectTranslationDataSchema`
// declares `_sections` (with `sections` as an authoring alias), and
// `@object-ui/i18n`'s `sectionLabel` resolves it for `record:details`, for
// `ObjectForm`/`ModalForm` and for the field-group designer. Only the walker
// disagreed.
//
// Two authoring surfaces feed one key, and BOTH are load-bearing:
//   (a) `fieldGroups` × field `group` — the fields decide which sections
//       exist, `fieldGroups[].label` supplies the source text;
//   (b) a named `sections[]` on a form view or inside a record page's
//       component tree — where the nesting is deep enough
//       (`page:tabs` → `properties.items[].children[]` → `record:details`)
//       that a shallow walk sees nothing.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract';
import { computeI18nCoverage } from '../src/utils/i18n-coverage';
import { foldCoverageIssues } from '../src/commands/lint';
import { ObjectTranslationDataSchema } from '@objectstack/spec/system';
import { deriveFieldGroupLayout } from '@objectstack/spec/data';

/** Every `objects.<o>._sections.*` path the walker emits, as dot-paths. */
const sectionKeys = (config: any) =>
  collectExpectedEntries(config)
    .filter((e) => e.source === 'section')
    .map((e) => e.path.join('.'));

const sectionEntries = (config: any) =>
  collectExpectedEntries(config).filter((e) => e.source === 'section');

// ── (a) fieldGroups × field `group` ────────────────────────────────────

/**
 * `showcase_semantic_zoo`'s posture: two declared groups, both referenced.
 * `money` also carries icon/description, so the group is the full ADR-0085
 * shape rather than a bare key.
 */
const groupedObject = {
  name: 'crm_opportunity',
  label: 'Opportunity',
  fields: {
    name: { label: 'Name', group: 'basics' },
    amount: { label: 'Amount', group: 'money' },
    notes: { label: 'Notes' },
  },
  fieldGroups: [
    { key: 'basics', label: 'Basic Information' },
    { key: 'money', label: 'Financials', collapse: 'collapsed' },
  ],
};

describe('field-group sections', () => {
  it('emits one label key per rendered group, seeded from `fieldGroups[].label`', () => {
    const entries = sectionEntries({ objects: [groupedObject] });

    expect(entries.map((e) => ({ path: e.path.join('.'), inline: e.inline, objectName: e.objectName }))).toEqual([
      {
        path: 'objects.crm_opportunity._sections.basics.label',
        inline: 'Basic Information',
        objectName: 'crm_opportunity',
      },
      {
        path: 'objects.crm_opportunity._sections.money.label',
        inline: 'Financials',
        objectName: 'crm_opportunity',
      },
    ]);
  });

  it('leaves the ungrouped bucket alone — it renders without a heading', () => {
    // `notes` declares no group and lands in the trailing untitled bucket,
    // which `deriveFieldGroupLayout` returns with NO `key`. Renderers show no
    // card chrome for it, so there is no heading to translate.
    expect(sectionKeys({ objects: [groupedObject] })).not.toContain(
      'objects.crm_opportunity._sections.undefined.label',
    );
    expect(sectionKeys({ objects: [groupedObject] })).toHaveLength(2);
  });

  it('drops a declared group no visible field references', () => {
    // The fields are the authority for which sections EXIST — a group nothing
    // references never becomes a heading, so demanding a translation for it
    // would be a gap that cannot be seen on any screen.
    const config = {
      objects: [
        {
          name: 'crm_lead',
          fields: { name: { label: 'Name', group: 'basics' }, hidden_note: { label: 'Note', group: 'ghost', hidden: true } },
          fieldGroups: [{ key: 'basics', label: 'Basics' }, { key: 'ghost', label: 'Ghost' }],
        },
      ],
    };
    expect(sectionKeys(config)).toEqual(['objects.crm_lead._sections.basics.label']);
  });

  it('drops a field `group` that no `fieldGroups` entry declares', () => {
    // `deriveFieldGroupLayout` treats an undeclared group as ungrouped, so
    // nothing renders a heading for it. Same reasoning, other direction.
    const config = {
      objects: [
        {
          name: 'crm_lead',
          fields: { name: { label: 'Name', group: 'basics' }, phone: { label: 'Phone', group: 'nowhere' } },
          fieldGroups: [{ key: 'basics', label: 'Basics' }],
        },
      ],
    };
    expect(sectionKeys(config)).toEqual(['objects.crm_lead._sections.basics.label']);
  });

  it('keeps `inline` unset when the group declares no label of its own', () => {
    // The key still renders (the derivation falls back to the group key), so
    // the skeleton is seeded — but nobody AUTHORED that text, and the coverage
    // gate must not report an untranslated string that does not exist.
    const entries = sectionEntries({
      objects: [
        {
          name: 'crm_lead',
          fields: { name: { label: 'Name', group: 'basics' } },
          fieldGroups: [{ key: 'basics' }],
        },
      ],
    });
    expect(entries).toEqual([
      {
        path: ['objects', 'crm_lead', '_sections', 'basics', 'label'],
        sourceValue: 'basics',
        inline: undefined,
        source: 'section',
        objectName: 'crm_lead',
      },
    ]);
  });
});

// ── (b) authored sections on form views and record pages ───────────────

describe('authored form-view sections', () => {
  const config = {
    views: [
      {
        list: { type: 'grid', data: { object: 'crm_contact' } },
        form: {
          type: 'simple',
          data: { object: 'crm_contact' },
          sections: [
            { name: 'contact', label: 'Contact', fields: ['name'] },
            { name: 'work', label: 'Work', fields: ['company'] },
          ],
        },
        formViews: {
          create: {
            type: 'simple',
            data: { object: 'crm_contact' },
            sections: [
              { name: 'who', label: 'Who is this?', fields: ['name'] },
              // No `name` → `ObjectForm`'s `tSec` falls straight through to
              // `s.label`; the lookup can never fire, so no expected key.
              { label: 'Anything else?', fields: ['notes'] },
            ],
          },
        },
      },
    ],
  };

  it('covers the container default form AND its named overrides', () => {
    expect(sectionKeys(config).sort()).toEqual([
      'objects.crm_contact._sections.contact.label',
      'objects.crm_contact._sections.who.label',
      'objects.crm_contact._sections.work.label',
    ]);
  });

  it('skips a section with no `name` — every renderer guards the lookup on it', () => {
    expect(sectionKeys(config)).not.toContain('objects.crm_contact._sections.anything_else.label');
  });
});

describe('authored record-page sections', () => {
  /**
   * The showcase `showcase_project_detail` shape: a slotted record page whose
   * `record:details` lives two levels down inside `page:tabs`
   * (`properties.items[].children[]`). This is the nesting the issue calls
   * out — a walk that only looked at `regions[].components[].properties`
   * would report nothing here.
   */
  const slottedPage = {
    name: 'crm_opportunity_detail',
    type: 'record',
    object: 'crm_opportunity',
    kind: 'slotted',
    regions: [],
    slots: {
      tabs: {
        type: 'page:tabs',
        properties: {
          items: [
            {
              key: 'details',
              label: 'Details',
              children: [
                {
                  type: 'record:details',
                  properties: {
                    sections: [
                      { name: 'overview', label: 'Overview', fields: ['name'] },
                      { name: 'timeline', label: 'Timeline', fields: ['close_date'] },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    },
  };

  it('reaches sections nested under `page:tabs → children → record:details`', () => {
    expect(sectionKeys({ pages: [slottedPage] }).sort()).toEqual([
      'objects.crm_opportunity._sections.overview.label',
      'objects.crm_opportunity._sections.timeline.label',
    ]);
  });

  it('reads `label` as the source text', () => {
    const timeline = sectionEntries({ pages: [slottedPage] }).find((e) => e.path[3] === 'timeline');
    expect(timeline?.inline).toBe('Timeline');
  });

  it('does NOT read an off-spec `title` as the source text — the key is still emitted, empty', () => {
    // #5730: `label` is the only heading spelling `RecordDetailsProps.sections[]`
    // declares (#5611). The walk keys sections off `name`, so a `title`-only
    // section STILL contributes its expected key — what it must not contribute
    // is source text, because scaffolding `"Timeline"` into a bundle from an
    // off-spec key is how the second spelling would become self-documenting.
    // Asserting the key survives is what keeps this non-vacuous: the entry is
    // present and its `inline` is empty, not absent because nothing was walked.
    const titled = JSON.parse(JSON.stringify(slottedPage));
    const sections = titled.slots.tabs.properties.items[0].children[0].properties.sections;
    sections[1] = { name: 'timeline', title: 'Timeline', fields: ['close_date'] };

    const entries = sectionEntries({ pages: [titled] });
    expect(entries.map((e) => e.path.join('.'))).toContain(
      'objects.crm_opportunity._sections.timeline.label',
    );
    expect(entries.find((e) => e.path[3] === 'timeline')?.inline).toBeUndefined();
  });

  it('reaches the plain `regions[].components[]` shape, and never mines a page REGION name', () => {
    // `PageSchema.aliases` maps `sections` → `regions`, and a region carries a
    // `name` exactly like a section does. The shared walk enters at
    // `regions[].components[]` / `slots.<slot>` and reads `sections` only from
    // a COMPONENT's `properties`, so the region name `main` can never become a
    // heading key.
    //
    // Paired with a real section in that same region, so the assertion cannot
    // pass merely because nothing was produced.
    const config = {
      pages: [
        {
          name: 'crm_lead_detail',
          object: 'crm_lead',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'record:details', properties: { sections: [{ name: 'summary', label: 'Summary' }] } },
              ],
            },
          ],
        },
      ],
    };
    const keys = sectionKeys(config);
    expect(keys).toEqual(['objects.crm_lead._sections.summary.label']);
    expect(keys).not.toContain('objects.crm_lead._sections.main.label');
  });

  it('ignores a page with no object binding — the key has nothing to hang on', () => {
    const detailsComponent = {
      type: 'record:details',
      properties: { sections: [{ name: 'summary', label: 'Summary' }] },
    };
    const config = {
      pages: [
        // No `object`: the section is real but there is no object to key it
        // under, so no expected key can be formed.
        { name: 'marketing_home', regions: [{ name: 'main', components: [detailsComponent] }] },
        // Same component, bound — proves the exclusion is the binding and not
        // a dead walk.
        { name: 'crm_lead_detail', object: 'crm_lead', regions: [{ name: 'main', components: [detailsComponent] }] },
      ],
    };
    expect(sectionKeys(config)).toEqual(['objects.crm_lead._sections.summary.label']);
  });

  it('keys a re-bound component under ITS object, not the page’s', () => {
    // `dataSource.object` / `properties.object` retarget a component, so one
    // page can show two objects. Keying such a section under the PAGE's object
    // is worse than missing it — the bundle entry would sit at a path the
    // resolver never reads. The shared lint traversal resolves the binding per
    // component, which is the reason to reuse it rather than re-walk here.
    const config = {
      pages: [
        {
          name: 'crm_lead_detail',
          object: 'crm_lead',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'record:details',
                  dataSource: { object: 'crm_account' },
                  properties: { sections: [{ name: 'company', label: 'Company' }] },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(sectionKeys(config)).toEqual(['objects.crm_account._sections.company.label']);
  });

  it('skips a source-authored page — its `regions` are a derived cache, not authoring', () => {
    // `kind: 'html' | 'react' | 'jsx'` pages are authored as `source`; the
    // region tree is at most a compiled cache the source wins over. Scaffolding
    // translation keys off it would invent an authoring surface, so the shared
    // walk yields nothing for those pages. Paired with the same component on a
    // normally-authored page.
    const detailsComponent = {
      type: 'record:details',
      properties: { sections: [{ name: 'summary', label: 'Summary' }] },
    };
    const config = {
      pages: [
        { name: 'crm_lead_html', object: 'crm_lead', kind: 'html', source: '<div/>', regions: [{ name: 'main', components: [detailsComponent] }] },
        { name: 'crm_account_detail', object: 'crm_account', regions: [{ name: 'main', components: [detailsComponent] }] },
      ],
    };
    expect(sectionKeys(config)).toEqual(['objects.crm_account._sections.summary.label']);
  });
});

describe('one key per (object, section) however many surfaces declare it', () => {
  it('does not double-count a heading authored as a field group AND a page section', () => {
    const config = {
      objects: [groupedObject],
      pages: [
        {
          name: 'crm_opportunity_detail',
          object: 'crm_opportunity',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'record:details', properties: { sections: [{ name: 'basics', label: 'Basic Information' }] } },
              ],
            },
          ],
        },
      ],
    };
    expect(sectionKeys(config)).toEqual([
      'objects.crm_opportunity._sections.basics.label',
      'objects.crm_opportunity._sections.money.label',
    ]);
  });

  it('takes the authored heading from whichever surface has one', () => {
    // The field group declares no `label`, the page section does. Whichever
    // surface is walked first, `inline` has to report the text the reader
    // actually sees — otherwise the gate stays quiet about a heading that is
    // sitting on screen in the source locale.
    const config = {
      objects: [
        {
          name: 'crm_lead',
          fields: { name: { label: 'Name', group: 'basics' } },
          fieldGroups: [{ key: 'basics' }],
        },
      ],
      pages: [
        {
          name: 'crm_lead_detail',
          object: 'crm_lead',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'record:details', properties: { sections: [{ name: 'basics', label: 'Basic Information' }] } },
              ],
            },
          ],
        },
      ],
    };
    const entries = sectionEntries(config);
    expect(entries).toHaveLength(1);
    expect(entries[0].inline).toBe('Basic Information');
  });
});

// ── The gate: lint reports it, extract scaffolds it ────────────────────

describe('coverage + lint', () => {
  const config = {
    objects: [groupedObject],
    i18n: { defaultLocale: 'en', supportedLocales: ['ja-JP'] },
    translations: [
      {
        'ja-JP': {
          objects: {
            crm_opportunity: {
              label: '商談',
              fields: { name: { label: '名前' }, amount: { label: '金額' }, notes: { label: 'メモ' } },
              // `basics` is translated; `money` is not — exactly the hotcrm
              // shape where a bundle looks complete and the headings are not.
              _sections: { basics: { label: '基本情報' } },
            },
          },
        },
      },
    ],
  };

  it('reports the untranslated heading that used to be invisible', () => {
    const report = computeI18nCoverage(config);
    const sections = report.issues.filter((i) => i.source === 'section');

    expect(sections.map((i) => ({ locale: i.locale, key: i.key, severity: i.severity }))).toEqual([
      {
        locale: 'ja-JP',
        key: 'objects.crm_opportunity._sections.money.label',
        severity: 'warning',
      },
    ]);
    expect(sections[0].message).toContain('Section "crm_opportunity" _sections.money.label');
  });

  it('surfaces it through `os lint` as `i18n/missing-section`, not as platform noise', () => {
    const { folded, hiddenPlatform } = foldCoverageIssues(
      computeI18nCoverage(config).issues,
      /* includePlatform */ false,
    );
    const rules = folded.filter((i) => i.rule.startsWith('i18n/')).map((i) => i.rule);

    expect(rules).toContain('i18n/missing-section');
    // The heading belongs to the user's own metadata: `--include-platform`
    // must not be what makes it visible.
    expect(hiddenPlatform).toBeGreaterThan(0);
    expect(
      foldCoverageIssues(computeI18nCoverage(config).issues, false).folded.some(
        (i) => i.path === 'translations.ja-JP.objects.crm_opportunity._sections.money.label',
      ),
    ).toBe(true);
  });

  it('scaffolds the heading in `os i18n extract` — the same walker, for free', () => {
    const result = extractTranslations({ objects: [groupedObject] }, { locales: ['ja-JP'], fill: 'default' });
    expect((result.bundles['ja-JP'] as any).objects.crm_opportunity._sections).toEqual({
      basics: { label: 'Basic Information' },
      money: { label: 'Financials' },
    });
  });

  it('a monolingual project still reports nothing', () => {
    // The gate is opt-in by construction and sections must not break that.
    const report = computeI18nCoverage({ objects: [groupedObject] });
    expect(report.issues.filter((i) => i.source === 'section')).toEqual([]);
  });
});

// ── Reconciliation: declared = enforced ────────────────────────────────

describe('the emitted key is the key the platform declares and consumes', () => {
  it('every emitted path parses against `ObjectTranslationDataSchema._sections`', () => {
    // The DECLARATION face. `packages/spec/src/system/translation.zod.ts`
    // declares `_sections: z.record(..., { label, description })` on a
    // strictObject — so a walker that invented a spelling (`sections`,
    // `_section`, `.title`) would be rejected here rather than silently
    // scaffolding keys no bundle may legally carry.
    const bundle = extractTranslations({ objects: [groupedObject] }, { locales: ['en'] })
      .bundles.en as any;

    const parsed = ObjectTranslationDataSchema.safeParse(bundle.objects.crm_opportunity);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    expect(Object.keys((parsed as any).data._sections)).toEqual(['basics', 'money']);
  });

  it('field-group keys are read through the shared ADR-0085 derivation, not a second copy', () => {
    // The CONSUMPTION face. `deriveFieldGroupLayout` is the one derivation the
    // renderers consume — `@object-ui/plugin-detail`'s
    // `deriveFieldGroupDetailSections` maps its `key` straight onto the
    // section `name` that `sectionLabel(object, name, …)` looks up. Deriving
    // the expected set the same way is what makes "declared" and "gated" the
    // same set instead of two lists that drift.
    const rendered = (deriveFieldGroupLayout(groupedObject) ?? [])
      .filter((s) => s.key !== undefined)
      .map((s) => `objects.crm_opportunity._sections.${s.key}.label`);

    expect(sectionKeys({ objects: [groupedObject] })).toEqual(rendered);
  });
});

// ── Real metadata from the in-repo example app ─────────────────────────

describe('the showcase app, walked for real', () => {
  it('picks up `showcase_contact`’s default-form sections and `showcase_semantic_zoo`’s field groups', async () => {
    const [{ ContactViews }, { SemanticZoo }] = await Promise.all([
      import('../../../examples/app-showcase/src/ui/views/contact.view'),
      import('../../../examples/app-showcase/src/data/objects/semantic-zoo.object'),
    ]);

    const keys = sectionKeys({ objects: [SemanticZoo], views: [ContactViews] });

    expect(keys.sort()).toEqual([
      // `fieldGroups: [{ key: 'basics' }, { key: 'money' }]`, both referenced
      // by `group:` on real fields.
      'objects.showcase_semantic_zoo._sections.basics.label',
      'objects.showcase_semantic_zoo._sections.money.label',
      // `ContactViews.form.sections[].name` — the container's DEFAULT form,
      // which `ObjectForm` renders and translates like any other.
      'objects.showcase_contact._sections.contact.label',
      'objects.showcase_contact._sections.notes.label',
      'objects.showcase_contact._sections.status.label',
      'objects.showcase_contact._sections.work.label',
    ].sort());
  }, 60_000);
});
