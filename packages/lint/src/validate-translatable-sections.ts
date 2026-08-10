// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0072 — reference resolvability] The third leg: a rendered heading that
 * NO key can ever address (issue #5417).
 *
 * `validate-translation-references` asks "does this bundle key point at
 * anything?" and the `os lint --i18n` coverage walk asks "does every key the
 * metadata expects have a translation?". Both questions are about keys that
 * EXIST. A form section authored with a `label` and no `name` exists on neither
 * side of that pair:
 *
 *   - the renderer keys the heading off `section.name` —
 *     `sectionLabel(objectName, section.name, authored)` in `@object-ui/i18n`,
 *     guarded on the name in every call site (`plugin-form`'s
 *     `ObjectForm`/`ModalForm`, `plugin-detail`'s `record:details`), so a
 *     nameless section falls back to the authored label in EVERY locale;
 *   - `_sections` is keyed by section name, so there is no key for a bundle to
 *     carry — nothing to report as an orphan;
 *   - the coverage walker (#5405 / PR #5416) emits `sections[].name`, so a
 *     section with no name contributes no `ExpectedEntry` and the report reads
 *     100% while the heading renders in the source locale.
 *
 * The heading is therefore untranslatable BY CONSTRUCTION, and every gate we
 * own is structurally blind to it. Measured on HotCRM at `0899b4f`: 70 of 70
 * form-view sections, across all 14 view files, in exactly that state — with
 * four locales at full declared coverage and zero warnings anywhere.
 *
 * ── Why the fix is a diagnostic and not renderer tolerance ───────────────
 *
 * The tempting "fix" is at the consumer: slugify the label and go fishing for a
 * second key. That is precisely the lenient fallback Prime Directive #12 bans —
 * it fossilizes a second de-facto contract (`_sections.<slug-of-label>`)
 * alongside the declared one (`_sections.<name>`), and the slug moves the day
 * anyone edits the heading text. objectui#3373 pinned the renderer's `name`
 * guard as CORRECT for that reason. So the defect is at the producer, and this
 * rule is where the producer hears about it. The `name` a hint suggests below
 * is a suggestion for the AUTHOR to write down, never a key anything resolves.
 *
 * ── Severity: warning ────────────────────────────────────────────────────
 *
 * Same reading as its sibling rule (ADR-0072 D1): nothing crashes and nothing
 * is dead — one heading renders in the source locale. That is weaker than the
 * dead references `validate-object-references` reports as errors, and the
 * severity should say so. Requiring `name` outright is a SCHEMA change
 * (`FormSection.name` is optional today), which is a breaking authoring change
 * needing a maintainer decision and a migration — deliberately not taken here.
 *
 * ── The opt-in gate: the object must actually be translated ──────────────
 *
 * A monolingual stack owes nobody a section name; warning there would be noise
 * on the majority of stacks, and it would contradict the opt-in invariant the
 * coverage gate already holds (`computeI18nCoverage`: declare no locales and no
 * bundles, and the gate reports nothing rather than inventing a translation
 * debt). So a section warns only when the object it renders under carries some
 * translation of its own — i.e. the object appears under `objects.<name>` in
 * at least one `stack.translations` bundle. Then, and only then, is the heading
 * the one string on that form which stays English while its neighbours resolve.
 *
 * The object-first `translation` METADATA TYPE (`o.<object>` records persisted
 * through the metadata store) is deliberately not read for that signal, for the
 * same reason its sibling rule does not visit it: it is not `stack.translations`
 * and this rule cannot see the store. Erring narrow costs a missed warning;
 * erring wide costs a false one on a stack that never opted in.
 *
 * ── The section face ─────────────────────────────────────────────────────
 *
 * Exactly the anchors the two landed halves already agree on — the coverage
 * walker's `section` kind (`packages/cli/src/utils/i18n-extract.ts`, #5416) and
 * this package's `_sections` fact set (`validate-translation-references.ts`
 * `addSections`, #5422):
 *
 *   - a view container's `sections`, its DEFAULT `form.sections` (#5415 — the
 *     anchor that is neither a `formViews.*` entry nor the record's own), and
 *     every `listViews.*` / `formViews.*` sub-container's `sections` — reached
 *     through the shared `view-walk.ts` ladder (#6381; never a private copy,
 *     for the reason that file's header states — three copies of this descent
 *     had each been fixed separately, twice for the same missing rung);
 *   - the same three on views embedded in an object (`objects[].views`,
 *     `objects[].listViews`);
 *   - `record:details` sections nested anywhere in a page's component tree,
 *     via the shared `walkPageComponents` traversal (never a private copy —
 *     duplicating that walk produced a dead rule once already, #3583).
 *
 * `fieldGroups`-derived sections are OUT of range by construction: their
 *  heading is keyed by `fieldGroups[].key`, so they always have a name. A
 * `sections` authored as a name-keyed MAP is out of range for the same reason —
 * the map key IS the name.
 */

import { collectionEntries } from './collection-entries.js';
import { walkPageComponents } from './page-walk.js';
import { viewContainerSites, viewObjectName } from './view-walk.js';

export const TRANSLATION_SECTION_NAME_MISSING = 'translation-section-name-missing';

export type TranslatableSectionSeverity = 'warning';

export interface TranslatableSectionFinding {
  /** Always `warning` — one heading stays in the source locale; nothing breaks. */
  severity: TranslatableSectionSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `object "crm_case" · view "case_views" · formViews.create`. */
  where: string;
  /** Config path, e.g. `views[0].formViews.create.sections[1]`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** One `sections` array, with where it sits and which object it renders under. */
interface SectionSite {
  /** Path of the `sections` array itself. */
  path: string;
  /**
   * Human-readable container the array hangs off (`formViews.create`), WITHOUT
   * the object — the object is prepended once at emission so every finding in
   * the family reads the same way. Empty when the container has no name of its
   * own to add beyond what `path` already says.
   */
  surface: string;
  objectName?: string;
  sections: unknown;
}

/** `view "case_views" · ` when the container names itself, else nothing. */
function viewLabel(view: AnyRec): string {
  const name = strName(view.name);
  return name ? `view "${name}"` : '';
}

/** Join the non-empty parts of a `where` line. */
function joinWhere(...parts: string[]): string {
  return parts.filter((p) => p.length > 0).join(' · ');
}

/**
 * Register every `sections` array ONE view container declares.
 *
 * The DESCENT is the shared one (`view-walk.ts`, #6381) — the entry itself, the
 * container's default `form` (#5415: the anchor that is neither a `formViews.*`
 * entry nor the record's own), and every `listViews.*` / `formViews.*`
 * sub-container. This rule takes the FULL ladder, `listViews.*` included: that
 * rung is how it reaches an object's own `listViews` container, which the module
 * docblock above declares as part of its section face.
 *
 * The binding COMPOSITION stays here, because it is this rule's own: it mirrors
 * `validate-translation-references.ts`'s `collectViewRecord` — a sub-container
 * resolves its own object first and falls back to the record's, then to the
 * default list's, because on the canonical shape the binding lives INSIDE the
 * container (`list.data.object`), not at the record root. The sibling rules
 * compose their fallbacks differently and folding them together would change
 * verdicts. Only the base rung each of them starts from is shared
 * (`viewObjectName`, `view-walk.ts`, #6662).
 *
 * One equivalence worth writing down, since it is what let the two branches
 * collapse into one: the entry's OWN site used to resolve `recordObject ??
 * listBinding` while sub-containers resolved `viewObjectName(sub) ??
 * recordObject ?? listBinding`. For the entry, `viewObjectName(view)` IS
 * `recordObject`, so the sub-container formula returns exactly the same answer
 * on it — the uniform expression below is the old two-branch behaviour, not a
 * widening of it.
 */
function collectViewSites(view: AnyRec, basePath: string, label: string, sites: SectionSite[]): void {
  const recordObject = viewObjectName(view);
  const listBinding = isRec(view.list) ? viewObjectName(view.list) ?? recordObject : undefined;

  for (const site of viewContainerSites(view, basePath)) {
    sites.push({
      path: `${site.path}.sections`,
      surface: joinWhere(label, site.surface),
      objectName: viewObjectName(site.view) ?? recordObject ?? listBinding,
      sections: site.view.sections,
    });
  }
}

/** Every object name some translation bundle carries a node for. */
function translatedObjectNames(stack: AnyRec): Set<string> {
  const out = new Set<string>();
  const bundles = Array.isArray(stack.translations) ? stack.translations : [];
  for (const bundle of bundles) {
    if (!isRec(bundle)) continue;
    for (const data of Object.values(bundle)) {
      if (!isRec(data) || !isRec(data.objects)) continue;
      for (const [objectName, node] of Object.entries(data.objects)) {
        if (isRec(node)) out.add(objectName);
      }
    }
  }
  return out;
}

/**
 * A snake_case name the author could adopt, derived from the heading text.
 *
 * A HINT ONLY. Nothing resolves this — see the module docstring: deriving a
 * lookup key from label text is the second contract this rule exists to
 * prevent. Returns `undefined` when the label yields nothing usable.
 */
function suggestedName(label: string): string | undefined {
  const slug = label
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug.length > 0 ? slug : undefined;
}

/**
 * Report every form/detail section that declares a heading but no `name`, on an
 * object the stack actually translates. Returns findings (empty = clean).
 */
export function validateTranslatableSections(stack: AnyRec): TranslatableSectionFinding[] {
  const findings: TranslatableSectionFinding[] = [];
  if (!isRec(stack)) return findings;

  // Opt-in gate: no bundles, no translated objects, nothing to warn about.
  const translated = translatedObjectNames(stack);
  if (translated.size === 0) return findings;

  const sites: SectionSite[] = [];

  // ── Objects: embedded views + the `listViews` container ──
  for (const { rec: obj, path: objPath } of collectionEntries(stack.objects, 'objects')) {
    const objectName = strName(obj.name);
    if (!objectName) continue;
    for (const { rec: view, path } of collectionEntries(obj.views, `${objPath}.views`)) {
      collectViewSites(
        { ...view, object: strName(view.object) ?? objectName },
        path,
        viewLabel(view),
        sites,
      );
    }
    if (isRec(obj.listViews)) {
      collectViewSites({ object: objectName, listViews: obj.listViews }, objPath, '', sites);
    }
  }

  // ── Stack-level view containers ──
  for (const { rec: view, path } of collectionEntries(stack.views, 'views')) {
    collectViewSites(view, path, viewLabel(view), sites);
  }

  // ── Pages: `record:details` sections, anywhere in the component tree ──
  for (const { rec: page, path: pagePath } of collectionEntries(stack.pages, 'pages')) {
    const pageName = strName(page.name);
    const pageLabel = pageName ? `page "${pageName}"` : '';
    for (const walked of walkPageComponents(page, pagePath)) {
      if (!walked.objectName) continue;
      const props = isRec(walked.component.properties) ? walked.component.properties : undefined;
      if (!props) continue;
      const type = strName(walked.component.type) ?? 'component';
      sites.push({
        path: `${walked.path}.properties.sections`,
        surface: joinWhere(pageLabel, type),
        objectName: walked.objectName,
        sections: props.sections,
      });
    }
  }

  for (const site of sites) {
    const objectName = site.objectName;
    if (!objectName || !translated.has(objectName)) continue;
    // Only the ARRAY shape can be nameless: a name-keyed map supplies the name
    // from its key, which is exactly the key `_sections` resolves against.
    if (!Array.isArray(site.sections)) continue;

    for (let i = 0; i < site.sections.length; i++) {
      const section = site.sections[i];
      if (!isRec(section)) continue;
      if (strName(section.name)) continue;
      // `label` is the ONE heading spelling both surfaces declare —
      // `RecordDetailsProps.sections[]` and `FormSectionSchema` (#5611, #5730).
      // A section with no `label` has no heading the schema recognises, so
      // there is nothing untranslated to report — that is `required/label`'s
      // question, and an off-spec `title` is its business, not this rule's.
      const heading = strName(section.label);
      if (!heading) continue;

      const slug = suggestedName(heading);
      findings.push({
        severity: 'warning',
        rule: TRANSLATION_SECTION_NAME_MISSING,
        where: joinWhere(`object "${objectName}"`, site.surface, `section "${heading}"`),
        path: `${site.path}[${i}]`,
        message:
          `Section "${heading}" declares a label but no \`name\`. Headings resolve through ` +
          `\`objects.${objectName}._sections.<name>.label\`, so a section with no name has no key ` +
          `a bundle can carry — this heading can never be translated and renders in the source ` +
          `locale in EVERY locale. Object "${objectName}" IS translated, which is what makes the ` +
          `hole invisible: every neighbouring label resolves and only the heading stays behind. ` +
          `The i18n coverage report cannot see it either — it walks \`sections[].name\`, and a ` +
          `nameless section contributes nothing to walk.`,
        hint:
          `Give the section a stable \`name\` (snake_case)` +
          (slug ? `, e.g. \`name: '${slug}'\`` : '') +
          `, then translate it as \`objects.${objectName}._sections.${slug ?? '<name>'}.label\` in ` +
          `each locale bundle. The renderers look the heading up by name only — the name above ` +
          `is a suggestion to write down, never a key derived from the label, so renaming the ` +
          `heading later cannot break the lookup.`,
      });
    }
  }

  return findings;
}
