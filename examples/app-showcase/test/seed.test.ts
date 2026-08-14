// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { deriveFieldGroupLayout } from '@objectstack/spec/data';
import stack from '../objectstack.config.js';
import { ShowcaseSeedData } from '../src/data/seed/index.js';
import * as viewBarrel from '../src/ui/views/index.js';
import { ShowcaseTranslationBundle } from '../src/system/translations/index.js';

/**
 * The object a view CONTAINER targets (#5420).
 *
 * A container (`defineView({ list, form, formViews })`) carries no top-level
 * `name` — per `view.zod.ts` it is keyed implicitly by the object its default
 * list or form binds to, the same key objectql's `resolveMetadataItemName` and
 * the i18n walker derive. Read structurally rather than through the spec types:
 * `data` is a union (an `api`-provider view has no `object` at all), and a guard
 * that only compiles for the `object` arm would stop compiling the day a
 * showcase view switches provider — noise in a test about registration.
 */
function targetObject(container: unknown): string | undefined {
  const objectOf = (node: unknown): string | undefined => {
    const data = (node as { data?: unknown } | undefined)?.data;
    const object = (data as { object?: unknown } | undefined)?.object;
    return typeof object === 'string' ? object : undefined;
  };
  const c = container as { list?: unknown; form?: unknown } | undefined;
  return objectOf(c?.list) ?? objectOf(c?.form);
}

/**
 * Smoke test — the stack loads and registers the expected breadth of
 * metadata. This guards the metadata-loading pipeline end-to-end.
 */
describe('showcase stack', () => {
  it('registers the core objects', () => {
    const names = (stack.objects ?? []).map((o: { name: string }) => o.name);
    expect(names).toContain('showcase_project');
    expect(names).toContain('showcase_task');
    expect(names).toContain('showcase_field_zoo');
    // 6 objects: account, project, task, category, team, membership, field_zoo
    expect((stack.objects ?? []).length).toBeGreaterThanOrEqual(6);
  });

  /**
   * #5420 — every view container the barrel exports must reach the stack.
   *
   * `src/ui/views/index.ts` is a barrel, and `objectstack.config.ts` names its
   * members one by one in a hand-written import list. There is no directory
   * scan behind `views:` — the CLI reads exactly that array — so an export the
   * import list forgets is metadata that compiles, type-checks, lints clean and
   * is never loaded by anything: no runtime container, and no static pass
   * (`os validate` / `os lint` / `os i18n extract` / the coverage ratchet) can
   * see it either. `ContactViews` sat that way while
   * `content/docs/ui/create-vs-edit-form.mdx` cited it as the live reference
   * implementation of "create form ≠ edit form", and the app's `nav_contacts`
   * entry rendered the derived default form instead of the authored one.
   *
   * Matched by TARGET OBJECT, not by object identity: `defineStack` parses the
   * config, so `stack.views[i]` is a structural copy and never `===` the
   * exported container. A view container carries no top-level `name` (spec:
   * `view.zod.ts`) — it is keyed implicitly by the object its default list or
   * form binds to, which is the same key objectql's `resolveMetadataItemName`
   * and the i18n walker use.
   */
  it('registers every view container the barrel exports', () => {
    const registered = new Set(
      (stack.views ?? []).map((v) => targetObject(v)).filter((o) => o !== undefined),
    );
    const missing = Object.entries(viewBarrel)
      .filter(([, container]) => {
        const object = targetObject(container);
        // A container the guard cannot key is reported, never skipped —
        // silently passing on an unresolvable one is how this guard would
        // rot into the very "looks covered, covers nothing" shape #5420 is.
        return object === undefined || !registered.has(object);
      })
      .map(([name]) => name);
    expect(missing, `exported but absent from \`views:\` → ${missing.join(', ')}`).toEqual([]);
    // The barrel is the authority for how many there are; assert it is not
    // empty so a barrel that stops exporting cannot make this vacuously green.
    expect(Object.keys(viewBarrel).length).toBeGreaterThanOrEqual(5);
    expect(registered.has('showcase_contact')).toBe(true);
  });

  /**
   * #5420 (extended by #8231's remainder) — the section headings the
   * registration makes translatable, pinned from BOTH sides on the real
   * stack.
   *
   * Registering `ContactViews` is what puts its named sections in front of
   * the i18n gates, and the two gates read the same set in opposite
   * directions: `i18n/missing-section` (#5405) fails on a declared section
   * with no bundle entry, `translation-target-unknown` (#5415/#5422) fails on
   * a bundle entry no section declares. A test that checked one direction
   * would stay green while the other broke, so this asserts set EQUALITY.
   *
   * Read on the composed stack, not on the imported container: what the gates
   * see is `stack.views`, and that is exactly the reachability this issue was
   * about. The default `form`'s four sections AND the sparse
   * `formViews.create` override's one section are both named as of #8231's
   * remainder, so both contribute to the set below — `formViews.create` is no
   * longer excluded.
   */
  it('keys the contact form sections to exactly what the container declares', () => {
    const contact = (stack.views ?? []).find((v) => targetObject(v) === 'showcase_contact');
    const namesOf = (view: unknown): string[] => {
      const sections = (view as { sections?: unknown } | undefined)?.sections;
      return (Array.isArray(sections) ? sections : [])
        .map((s) => (s as { name?: unknown } | undefined)?.name)
        .filter((n): n is string => typeof n === 'string');
    };
    const form = (contact as { form?: unknown } | undefined)?.form;
    const formViews = (contact as { formViews?: Record<string, unknown> } | undefined)?.formViews ?? {};
    const declared = [...namesOf(form), ...Object.values(formViews).flatMap(namesOf)].sort();
    expect(declared).toEqual(['contact', 'notes', 'status', 'who_is_this', 'work']);

    const zh = ShowcaseTranslationBundle['zh-CN']?.objects?.showcase_contact as
      | { _sections?: Record<string, { label?: string }> }
      | undefined;
    expect(Object.keys(zh?._sections ?? {}).sort()).toEqual(declared);
    // Every entry carries an actual translation — an empty or echoed English
    // label would satisfy the key set while faking the coverage.
    for (const name of declared) {
      const label = zh?._sections?.[name]?.label;
      expect(label, `zh-CN _sections.${name}.label`).toBeTruthy();
      expect(label).not.toMatch(/^[\x20-\x7e]+$/);
    }
  });

  /**
   * #5443 — the comment at the top of `ui/views/contact.view.ts` promises that
   * the hand-written `form` "mirrors what the platform auto-derives", i.e. that
   * you may OMIT it and get the same grouped form. That promise is only true if
   * the object DECLARES the four groups: `deriveFieldGroupLayout` (ADR-0085 §5,
   * the one derivation every renderer and the i18n walker consume) buckets a
   * field only when its `group` matches a declared `fieldGroups[].key`, and
   * otherwise drops it into the trailing untitled bucket — which is exactly
   * what nine `showcase_contact` fields did while the comment claimed
   * otherwise (`os lint`: 9 × `field-group-undeclared`).
   *
   * So this pins the promise itself, not the declaration: the derived sections
   * must equal the authored `form.sections` in ORDER and MEMBERSHIP. Deleting
   * `fieldGroups` makes `deriveFieldGroupLayout` return `null` (no declared
   * groups → grouping does not apply), and the assertion goes red on the first
   * line rather than passing vacuously on an empty comparison.
   *
   * Read on the composed stack for the same reason the section-key test above
   * is: what renderers and gates see is `stack.objects`, not the imported
   * module. The trailing ungrouped bucket the SERVED object grows (the
   * platform injects `owner_id`, which is neither hidden nor an audit column)
   * is deliberately out of frame here — it is a registration-time addition, and
   * the view comment states it in prose.
   */
  it('derives the contact form sections from `fieldGroups` exactly as the view authors them', () => {
    const object = (stack.objects ?? []).find(
      (o: { name: string }) => o.name === 'showcase_contact',
    );
    const derived = deriveFieldGroupLayout(object);
    expect(derived, 'showcase_contact must declare fieldGroups (#5443)').not.toBeNull();
    expect(derived!.map((s) => s.key)).toEqual(['contact', 'work', 'status', 'notes']);

    const contact = (stack.views ?? []).find((v) => targetObject(v) === 'showcase_contact');
    const form = (contact as { form?: unknown } | undefined)?.form;
    const authored = (form as { sections?: unknown } | undefined)?.sections;
    const authoredPairs = (Array.isArray(authored) ? authored : []).map((s) => {
      const section = s as { name?: unknown; label?: unknown; fields?: unknown };
      return {
        key: section.name,
        label: section.label,
        fields: Array.isArray(section.fields) ? section.fields : [],
      };
    });
    expect(derived!.map((s) => ({ key: s.key, label: s.label, fields: s.fields }))).toEqual(
      authoredPairs,
    );
  }, 60_000);

  it('registers UI, automation, security, and AI metadata', () => {
    expect((stack.views ?? []).length).toBeGreaterThan(0);
    expect((stack.dashboards ?? []).length).toBeGreaterThan(0);
    // ADR-0021 single-form: the former flat `tabular` TaskListReport was
    // reclassified as a ListView (a flat list is a row lens, not analytics).
    // Four dataset-bound analytics reports: summary, chart, matrix, joined.
    expect((stack.reports ?? []).length).toBe(4);
    expect((stack.flows ?? []).length).toBeGreaterThan(0);
    // Nine flat positions (contributor/manager/exec/auditor/ops/
    // field_ops_delegate/client_portal_user, plus finance/legal for the v16
    // approval sign-off flows) — the ADR-0090 distribution layer; `everyone`
    // and `guest` are built-in anchors and never declared by the app.
    expect((stack.positions ?? []).length).toBe(9);
    expect((stack.agents ?? []).length).toBe(0); // AI agents are an enterprise (service-ai) feature; the open showcase ships none
  });
});

/**
 * #8231 — generalizes the "keys the contact form sections..." test above to
 * EVERY view container's `form`/`formViews`, and to every `record:details`
 * section on every page. A section can silence
 * `translation-section-name-missing` completely just by getting a `name`,
 * with ZERO translation delivered: the bundle simply never gains a matching
 * `_sections.<name>` entry, and the heading keeps rendering in the source
 * locale in every locale. This asserts BOTH halves for every section this
 * sweep can see: it has a `name`, AND the zh-CN bundle carries a REAL
 * (non-empty, non-English) label for it — an echoed English string would
 * satisfy the key set while faking coverage.
 *
 * Read on the COMPOSED stack, the same reachability principle the test above
 * documents: what the platform's i18n resolver and lint gates see is
 * `stack.views` / `stack.pages` / `stack.translations`, not the imported
 * modules.
 */
describe('showcase form + page section i18n coverage (#8231)', () => {
  const zh = (stack.translations?.[0] as any)?.['zh-CN']?.objects as
    | Record<string, { _sections?: Record<string, { label?: string }> }>
    | undefined;

  interface Found {
    object: string;
    where: string;
    label: string;
    name: unknown;
  }

  /**
   * Formerly KNOWN EXCLUSIONS, now named (#8231 remainder).
   *
   * Three sections used to be excluded here — `showcase_task`'s
   * `formViews.edit` ("Task") and `formViews.quick` ("Quick Edit"), and
   * `showcase_contact`'s `formViews.create` ("Who is this?"). Naming them
   * would have flipped a currently-PINNED finding in
   * `packages/lint/src/validate-translatable-sections.test.ts` and
   * `validate-translation-references.test.ts`, which imported `TaskViews` /
   * `ContactViews` directly from this app and pinned their nameless state as
   * the regression fixture. #8515 (PR #8610) moved those pins onto a frozen
   * snapshot (`packages/lint/src/showcase-shape.fixtures.ts`) that no longer
   * reads live `examples/**` for the nameless cases, which is what freed this
   * app to name all three. No exclusion set is needed any more — every
   * section the sweep below finds is asserted individually.
   */

  function collectFormSections(): Found[] {
    const out: Found[] = [];
    for (const container of (stack.views ?? []) as any[]) {
      const containerObject: string | undefined =
        container.list?.data?.object ?? container.form?.data?.object;
      const forms: Record<string, any> = { ...(container.formViews ?? {}) };
      if (container.form) forms.form = container.form;
      for (const [viewKey, fv] of Object.entries(forms)) {
        const sections = Array.isArray(fv?.sections) ? fv.sections : [];
        const objectName: string | undefined = fv?.data?.object ?? containerObject;
        if (!objectName) continue;
        const where = viewKey === 'form' ? 'form' : `formViews.${viewKey}`;
        sections.forEach((s: any) => {
          out.push({ object: objectName, where, label: String(s?.label ?? '(untitled)'), name: s?.name });
        });
      }
    }
    return out;
  }

  function collectPageDetailSections(): Found[] {
    const out: Found[] = [];
    const visit = (node: unknown, pageName: string, pageObject: string) => {
      if (Array.isArray(node)) {
        for (const item of node) visit(item, pageName, pageObject);
        return;
      }
      if (node && typeof node === 'object') {
        const rec = node as Record<string, unknown>;
        if (rec.type === 'record:details' && rec.properties && typeof rec.properties === 'object') {
          const sections = (rec.properties as any).sections;
          if (Array.isArray(sections)) {
            sections.forEach((s: any) => {
              out.push({
                object: pageObject,
                where: `page "${pageName}" · record:details`,
                label: String(s?.label ?? '(untitled)'),
                name: s?.name,
              });
            });
          }
        }
        for (const v of Object.values(rec)) visit(v, pageName, pageObject);
      }
    };
    for (const page of (stack.pages ?? []) as any[]) {
      if (typeof page.object !== 'string') continue;
      visit(page.regions, page.name, page.object);
      visit(page.slots, page.name, page.object);
    }
    return out;
  }

  const found = [...collectFormSections(), ...collectPageDetailSections()];

  it('found more than a token number of sections (guards against a vacuous sweep)', () => {
    expect(found.length).toBeGreaterThanOrEqual(12);
  });

  for (const f of found) {
    it(`${f.object} · ${f.where} · section "${f.label}" declares a name and resolves in zh-CN`, () => {
      expect(
        typeof f.name === 'string' && f.name.length > 0,
        `${f.object} · ${f.where} · "${f.label}" has no \`name\` — untranslatable by construction.`,
      ).toBe(true);
      const name = f.name as string;
      const label = zh?.[f.object]?._sections?.[name]?.label;
      expect(label, `objects.${f.object}._sections.${name}.label is missing from the zh-CN bundle`).toBeTruthy();
      expect(label, `zh-CN _sections.${name}.label reads as untranslated ASCII`).not.toMatch(/^[\x20-\x7e]+$/);
    });
  }
});

/**
 * Static shadow of the seed contract after #3433: a seed write is a curated
 * end-state fact, so the platform EXEMPTS it from the object's `state_machine`
 * rule — a project is seeded directly `active` / `on_hold` / `completed`
 * without walking the FSM up from `planned` (the three-phase walk workaround
 * of #3415 is gone). This guard pins the new contract for every object whose
 * state_machine gates INSERT (`initialStates`):
 *   1. every seeded value is still a state the FSM DECLARES (a curated fact,
 *      not a typo — the exemption is not a license to write garbage); and
 *   2. the fixture actually EXERCISES the exemption by seeding ≥1 non-initial
 *      state, so a regression back to "all rows enter as the initial state"
 *      (a re-introduced walk, or a fixture that collapses the board to one
 *      column) fails here. The #3433 failure was 1/5 projects surviving.
 */
describe('seed data vs state machines (#3433)', () => {
  const gated = (stack.objects ?? []).flatMap((o: any) =>
    (o.validations ?? [])
      .filter(
        (v: any) =>
          v.type === 'state_machine' &&
          (v.events ?? []).includes('insert') &&
          Array.isArray(v.initialStates) &&
          v.severity !== 'warning',
      )
      .map((v: any) => ({ object: o, rule: v })),
  );

  it('covers the project status flow (the #3433 gate)', () => {
    expect(gated.map((g: any) => `${g.object.name}.${g.rule.field}`)).toContain('showcase_project.status');
  });

  for (const { object, rule } of gated) {
    it(`${object.name}: seeded '${rule.field}' is FSM-exempt but stays within declared states (#3433)`, () => {
      const datasets = ShowcaseSeedData.filter((d: any) => d.object === object.name);
      expect(datasets.length).toBeGreaterThan(0);

      // Every state the FSM knows about — the legal value universe, derived
      // from the rule itself (no dependency on the field's option shape).
      const fsmStates = new Set<string>(
        [
          ...rule.initialStates,
          ...Object.keys(rule.transitions ?? {}),
          ...Object.values(rule.transitions ?? {}).flat(),
        ].map(String),
      );

      const seeded = new Set<string>();
      for (const ds of datasets as any[]) {
        for (const rec of ds.records as any[]) {
          const v = rec[rule.field];
          if (v === undefined || v === null) continue;
          const key = String(rec[ds.externalId ?? 'name']);
          // #3433: a seed value need NOT be an initialState (the FSM entry
          // guard is exempt), but it must be a state the machine declares.
          expect(fsmStates, `'${key}' seeds '${rule.field}=${String(v)}'`).toContain(String(v));
          seeded.add(String(v));
        }
      }

      // The exemption must actually be used: seed at least one state the FSM
      // entry point would reject on INSERT. Guards against a silent regression
      // to a planned-only fixture (or a re-introduced FSM walk).
      const nonInitial = [...seeded].filter((v) => !rule.initialStates.includes(v));
      expect(
        nonInitial.length,
        `${object.name} seeds only initial states (${[...seeded].join(', ')}) — #3433 exemption unused`,
      ).toBeGreaterThan(0);
    });
  }
});
