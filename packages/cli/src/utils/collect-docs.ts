// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Package documentation collection + lint (ADR-0046).
 *
 * `os build` compiles every Markdown file in the package's flat
 * `src/docs/` directory into a `doc` metadata item on the stack
 * (`docs: DocSchema[]`). This module owns that contract end to end — what is
 * collected, what is NOT, and what the collected set must satisfy:
 *
 *   - **Collection**: filename stem → `name`, frontmatter `title:` or the
 *     first `#` heading → `label`, body → `content`; the optional
 *     `description:`/`order:`/`group:` scalars and the `tags:` list are read
 *     through to the `doc` item. Subdirectories are a
 *     build error — flatness is the contract that keeps cross-references
 *     stable (a link is `[text](./<name>.md)`; resolution is a basename
 *     lookup with zero path arithmetic).
 *   - **Absence**: a `src/<pkg>/docs/` directory one level down is NEVER
 *     collected (ADR-0046 anchors at `src/docs`), and under an ADR-0130
 *     multi-package layout that is where a moved docs directory lands — so it
 *     is REPORTED rather than passed over, because a build that keeps none of
 *     the author's docs and says nothing is the defect (#18170).
 *   - **Lint**: namespace-prefix naming (`docs/namespace-prefix`,
 *     `docs/namespace-required`), duplicate names (`docs/duplicate-name`), the
 *     v1 syntax bans (no MDX, no images), and same-package link resolution.
 *
 * Cross-package links (a target whose prefix is not this package's
 * namespace) are deliberately not checked here: they resolve against
 * dependency docs at publish time, and render-side they degrade to a
 * "doc not found" notice rather than coupling into dependency resolution.
 *
 * ⚠️ What the naming lints rest on — and ⛔ what they no longer rest on.
 * Doc uniqueness is logical rather than physical (ADR-0046 §3.2), but ⛔ NOT
 * because "a bare-name collision silently overwrites across packages": that
 * sentence is ADR-0048 §1.1 *context*, overturned by the same ADR's §3.3/§3.4
 * (the write is already composite-keyed — §1.2, "the silence is in the read,
 * not the write" — and "the cross-package throw is retired"), and it is
 * declined by name at {@link lintDocNamesAcrossOwners}. ⛔ The two lints that
 * one sentence used to cover are not interchangeable:
 *
 *   - `docs/duplicate-name` rests on **authoring hygiene**, the class §3.4
 *     keeps. ⛔ The reading is deliberately NOT restated here — it lives at
 *     {@link lintDocNamesAcrossOwners}, and a second copy of a justification is
 *     exactly how this header went stale.
 *   - `docs/namespace-prefix` / `docs/namespace-required` rest on the **flat
 *     link namespace**, and the prefix is load-bearing *in this module*: a doc
 *     link is `[text](./<name>.md)` — a bare name with nowhere to put a
 *     package coordinate, flat on purpose so an editor or a GitHub preview
 *     resolves it natively (ADR-0046 §3.1/§3.3) — so the prefix is the only
 *     thing separating a same-package link, checked in {@link lintDocs}, from
 *     a cross-package one, deferred to publish as above. ⚠️ ADR-0048 §3.3
 *     repaired metadata reads by ADDING a package-id argument to `getItem`;
 *     the link form has nowhere to put one, so nothing §3.4 retired was ever
 *     load-bearing for these two.
 */

import fs from 'fs';
import path from 'path';

import { artifactPackages } from './artifact-packages.js';

export interface DocTranslationItem {
  label?: string;
  description?: string;
  content: string;
}

export interface DocItem {
  name: string;
  label?: string;
  description?: string;
  content: string;
  /**
   * Sort key + explicit book-group placement (ADR-0046 §6), read from
   * frontmatter `order:`/`group:`. The book resolver honors both; absent
   * leaves them out so the schema defaults apply.
   */
  order?: number;
  group?: string;
  /**
   * Membership tags — the operand of a book group's `include: { tag: '<t>' }`
   * rule (ADR-0046 §5), read from frontmatter `tags:`.
   *
   * `DocSchema.tags` was declared to make `include: { tag }` reachable (the
   * enforce half of ADR-0049), and the resolver's `matchesInclude` has always
   * compared against it — but this collector had no list case, so on the flat
   * `src/docs/*.md` path every doc reached the resolver with `tags ===
   * undefined` and a tag rule matched nothing. Absent leaves the key out so
   * the schema default applies.
   */
  tags?: string[];
  /**
   * Per-locale variants (ADR-0046 i18n), compiled from sibling
   * `<name>.<locale>.md` files. The base file is the default + fallback.
   */
  translations?: Record<string, DocTranslationItem>;
}

export interface DocIssue {
  severity: 'error' | 'warning';
  rule: string;
  message: string;
  path: string;
}

const DOC_NAME_RE = /^[a-z][a-z0-9_]*$/;
// A locale-variant file is `<base>.<locale>.md` (ADR-0046 i18n), e.g.
// `crm_lead_guide.zh.md` or `crm_lead_guide.pt-BR.md`. The base stem must be a
// valid doc name; the locale is a BCP-47-ish tag (primary subtag + optional
// region). Flatness is unchanged — variants are still flat siblings.
const DOC_VARIANT_RE = /^([a-z][a-z0-9_]*)\.([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)$/;

/** Extract a single-line scalar `key: value` from a frontmatter block. */
function frontmatterScalar(block: string, key: string): string | undefined {
  const re = new RegExp(`^${key}\\s*:`, 'i');
  const line = block.split(/\r?\n/).find((l) => re.test(l));
  if (!line) return undefined;
  const value = line.replace(re, '').trim().replace(/^['"]|['"]$/g, '');
  return value || undefined;
}

/** Strip one leading and one trailing quote, matching `frontmatterScalar`. */
function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '').trim();
}

/**
 * The result of reading a list-valued frontmatter key: absent, parsed, or
 * present in a spelling this reader does not handle.
 *
 * The third state is the point. This parser is deliberately minimal — it is
 * not a YAML engine — and a minimal reader that returns `undefined` for
 * everything it cannot read is indistinguishable from one the author never
 * wrote to. Silently dropping authored input is exactly the defect this key
 * was added to fix, so an unreadable spelling is reported instead.
 */
type FrontmatterList =
  | { kind: 'absent' }
  | { kind: 'list'; values: string[] }
  | { kind: 'unreadable'; spelling: string };

/**
 * Extract a list-valued `key:` from a frontmatter block, in the two ordinary
 * YAML sequence spellings and no others:
 *
 * ```yaml
 * tags: [tutorial, beginner]   # inline
 * tags:                        # block
 *   - tutorial
 *   - beginner
 * ```
 *
 * Anything else present under `key:` — a bare scalar, an unterminated inline
 * sequence, a key with nothing under it — comes back `unreadable` for the
 * caller to report as a `DocIssue`. Deliberately NOT handled (and therefore
 * reported rather than half-read): nested/mapping items, block scalars, and
 * quoted items containing commas.
 */
function frontmatterList(block: string, key: string): FrontmatterList {
  const re = new RegExp(`^${key}\\s*:`, 'i');
  const lines = block.split(/\r?\n/);
  const at = lines.findIndex((l) => re.test(l));
  if (at === -1) return { kind: 'absent' };
  const here = lines[at].trim();

  // ── inline form: `key: [a, b]` ──
  const inline = lines[at].replace(re, '').trim();
  if (inline) {
    if (!inline.startsWith('[') || !inline.endsWith(']')) {
      return { kind: 'unreadable', spelling: here };
    }
    const values = inline
      .slice(1, -1)
      .split(',')
      .map((item) => unquote(item.trim()))
      .filter((item) => item.length > 0);
    return { kind: 'list', values };
  }

  // ── block form: `- item` lines under the key, at any indent. Blank lines
  // are skipped; the first line that is neither blank nor an item ends the
  // sequence (normally the next frontmatter key).
  const values: string[] = [];
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const item = line.match(/^-\s*(.*)$/);
    if (!item) break;
    const value = unquote(item[1].trim());
    if (value) values.push(value);
  }
  if (values.length === 0) return { kind: 'unreadable', spelling: `${here} (no list items follow)` };
  return { kind: 'list', values };
}

/**
 * Strip a leading `---` frontmatter block; extract `title:`, `description:`,
 * `order:`, and `group:` if present (all optional, single-line scalars), plus
 * the list-valued `tags:` (see `frontmatterList`). `order:` is parsed to a
 * number and dropped when non-numeric. A `tags:` this reader cannot parse is
 * returned as `unreadableTags` so the caller can report it — never dropped.
 */
function parseFrontmatter(raw: string): {
  title?: string;
  description?: string;
  order?: number;
  group?: string;
  tags?: string[];
  unreadableTags?: string;
  body: string;
} {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) return { body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { body: raw };
  const block = raw.slice(raw.indexOf('\n') + 1, end);
  const bodyStart = raw.indexOf('\n', end + 1);
  const body = bodyStart === -1 ? '' : raw.slice(bodyStart + 1);
  const orderRaw = frontmatterScalar(block, 'order');
  const order = orderRaw !== undefined ? Number(orderRaw) : undefined;
  const tags = frontmatterList(block, 'tags');
  return {
    title: frontmatterScalar(block, 'title'),
    description: frontmatterScalar(block, 'description'),
    ...(order !== undefined && !Number.isNaN(order) ? { order } : {}),
    group: frontmatterScalar(block, 'group'),
    // An authored-but-empty `tags: []` is left out: it parses fine and means
    // the same as absent to `matchesInclude`, so it is not a dropped value.
    ...(tags.kind === 'list' && tags.values.length > 0 ? { tags: tags.values } : {}),
    ...(tags.kind === 'unreadable' ? { unreadableTags: tags.spelling } : {}),
    body,
  };
}

/** Remove fenced code blocks and inline code spans before content scans. */
function stripCode(markdown: string): string {
  return markdown
    .replace(/^(```|~~~)[\s\S]*?^\1\s*$/gm, '')
    .replace(/`[^`\n]*`/g, '');
}

function firstHeading(markdown: string): string | undefined {
  const m = stripCode(markdown).match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : undefined;
}

/** The one directory this collector reads, relative to the config file. */
const COLLECTED_DOCS_DIR = 'docs';

/** Markdown files directly inside `dir`, sorted; `[]` when it is not a readable directory. */
function markdownFilesIn(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort();
}

/**
 * Report Markdown docs that exist under `src/` but sit where this collector
 * never looks — one warning per `src/<pkg>/docs/` directory holding `.md`
 * files (#18170).
 *
 * ## Why this is a diagnostic and not a collection
 *
 * ADR-0046 collection is anchored at exactly `<config dir>/src/docs`, while
 * ADR-0130 lets one artifact ship N packages, each conventionally a top-level
 * directory under `src/`. Move a docs directory into its package
 * (`git mv src/docs src/sales/docs`) and the two conventions disagree: the
 * collector reads nothing, `os build` exits 0 with its usual
 * `Collecting package docs (ADR-0046)...` line, and the artifact is written
 * with no `docs[]` at all. Measured on `objectstack-ai/hotcrm` at `590b095`
 * (pin 17.4.0): four package docs gone, exit 0, no output naming the loss.
 *
 * **The hazard is the silence, not the fixed path.** An exit-0 build with the
 * usual progress line is the shape every reader trusts, so this collector says
 * what it did not read, in the same channel it already uses for authored input
 * it cannot use (`docs/frontmatter-tags` above): the author wrote docs, the
 * build kept none of them, and until now nothing said so.
 *
 * ⚠️ `severity: 'warning'` deliberately, not `'error'`. An error fails the
 * build (`compile.ts` exits 1 on any doc error), which would refuse a tree that
 * builds green today on a directory this collector can only GUESS was meant as
 * ADR-0046 docs — a `src/<pkg>/docs/` directory is not declared anywhere the
 * build can read.
 *
 * ## What #18431 changed, and what it deliberately did NOT
 *
 * The maintainer's ruling (batch #147 item 4) answered the two contract
 * questions this docblock used to record as open: per-package docs attach to
 * the OWNING PACKAGE'S BODY (`packages[]`, ADR-0130 D4 option B), and the doc
 * lint reads that package's OWN `namespace`. So a `src/<dir>/docs/` directory
 * whose `<dir>` names one of the artifact's `packages[]` entries is now
 * COLLECTED, by {@link sweepPackageDocsDirectories} below.
 *
 * ⛔ The warning is not removed and not weakened — the ruling keeps it for docs
 * in a place NEITHER convention reads, which is now a smaller but sharper set:
 * a stack that declares no `packages[]` at all (every single-package app —
 * where the message below is unchanged, because for that stack it is still
 * exactly true), and a directory whose name matches no package or matches more
 * than one (where the message NAMES the candidates, because "I read this
 * convention and could not attribute the result" is a different fact from "I do
 * not read this convention").
 */
function uncollectedDocsMessage(rel: string, files: readonly string[]): string {
  return `${rel}/ holds ${files.length} Markdown file(s) that were NOT collected: package docs are read from src/docs/ only (ADR-0046 §3.2), so these are absent from the artifact's \`docs[]\` and from every book that includes them. Move them into src/docs/ (doc names carry the package namespace prefix, so packages do not collide there), declare them inline as \`defineStack({ docs })\`, or delete them if they are not package docs. Found: ${files.join(', ')}`;
}

/**
 * One artifact `packages[]` entry, as the docs collector needs to see it: the
 * position to attach collected docs to, the namespace its docs are linted
 * against (the ruling's clause 2), and the `src/` directory names that name it.
 *
 * ⛔ The id is NOT computed here. `artifactPackages` owns that rule
 * (`manifest.id`, falling back to `name`, then to the positional spelling) and
 * its own header forbids a second copy: two readers computing "which package is
 * this" slightly differently is how one seam comes to judge a different set of
 * packages than another while both look right.
 */
export interface DocsPackageRef {
  /** Position in the artifact's `packages[]`. */
  readonly index: number;
  /** The id the runtime registers this package under, from `artifactPackages`. */
  readonly id: string;
  /** The package's own `namespace` — the prefix rule for the docs it owns. */
  readonly namespace?: string;
  /** The `src/<dir>` names this package answers to — see {@link docsPackageRefs}. */
  readonly directoryNames: readonly string[];
}

/** Docs read out of ONE package's own `src/<dir>/docs/` directory (ADR-0130 D4). */
export interface PackageDocSet {
  /** Position in the artifact's `packages[]` — where {@link attachPackageDocs} writes. */
  readonly index: number;
  readonly id: string;
  readonly namespace?: string;
  /** Where they were read from, relative to the config file. */
  readonly dir: string;
  readonly docs: DocItem[];
}

/**
 * The artifact's `packages[]`, reduced to what a `src/<dir>/docs/` directory can
 * be matched against.
 *
 * Two spellings, and no more: the package's full `id`, and the LAST
 * dot-separated segment of that id. The second one is the load-bearing case —
 * `examples/app-multi-package` declares `id: 'com.example.multi.core'` with
 * `name: 'Multi-Package Core'`, so a `src/core/` directory can only be resolved
 * through the id's tail. ⛔ `name` is NOT a spelling: it is the package's
 * DISPLAY name, free to be re-worded at any time, and a directory binding that
 * a later re-wording BREAKS — reported by the warning below, but broken — is
 * worse than one that never existed. ⛔ `namespace` is deliberately NOT a
 * spelling either: ADR-0130 D1 exists so that N packages of one artifact can
 * SHARE one namespace, so matching on it would be ambiguous exactly where
 * multi-package layouts are most common.
 *
 * A directory that matches none, or more than one, is not attributed — it is
 * reported, by {@link sweepPackageDocsDirectories}.
 */
export function docsPackageRefs(packages: unknown): DocsPackageRef[] {
  if (!Array.isArray(packages)) return [];
  return artifactPackages({ packages }).map(({ index, id, body }) => {
    const directoryNames = new Set<string>();
    if (typeof body.id === 'string' && body.id !== '') {
      directoryNames.add(body.id);
      const tail = body.id.split('.').pop();
      if (tail) directoryNames.add(tail);
    }
    return {
      index,
      id,
      ...(typeof body.namespace === 'string' && body.namespace !== '' ? { namespace: body.namespace } : {}),
      directoryNames: [...directoryNames],
    };
  });
}

/**
 * Walk every `src/<dir>/docs/` once and split the result two ways: collected
 * into the package that owns it, or reported as unread (#18170's warning, kept
 * by the #18431 ruling's clause 4).
 *
 * ⭐ ONE traversal, and it is the traversal that was already here. The warning
 * this function grew out of already read every `src/<dir>/docs/` and already
 * listed its Markdown files by name; collecting them costs the file reads and
 * nothing else. That is the measurement the ruling asked for — see the PR that
 * landed this — and it is why the directory convention is the one implemented
 * first.
 */
function sweepPackageDocsDirectories(
  srcDir: string,
  refs: readonly DocsPackageRef[],
): { packageDocs: PackageDocSet[]; issues: DocIssue[] } {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(srcDir, { withFileTypes: true });
  } catch {
    return { packageDocs: [], issues: [] };
  }
  const issues: DocIssue[] = [];
  const packageDocs: PackageDocSet[] = [];
  const packageDirs = entries.filter((e) => e.isDirectory() && e.name !== COLLECTED_DOCS_DIR);
  packageDirs.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of packageDirs) {
    const dir = path.join(srcDir, entry.name, COLLECTED_DOCS_DIR);
    const files = markdownFilesIn(dir);
    if (files.length === 0) continue;
    const rel = `src/${entry.name}/docs`;

    const owners = refs.filter((ref) => ref.directoryNames.includes(entry.name));
    if (owners.length === 1) {
      const compiled = compileDocsDirectory(dir, rel);
      issues.push(...compiled.issues);
      packageDocs.push({
        index: owners[0].index,
        id: owners[0].id,
        ...(owners[0].namespace !== undefined ? { namespace: owners[0].namespace } : {}),
        dir: rel,
        docs: compiled.docs,
      });
      continue;
    }

    if (refs.length === 0) {
      // No `packages[]` at all — the single-package shape, where "read from
      // src/docs/ only" is still the whole truth. ⛔ Message unchanged.
      issues.push({
        severity: 'warning',
        rule: 'docs/uncollected-directory',
        message: uncollectedDocsMessage(rel, files),
        path: rel,
      });
      continue;
    }

    const declared = refs.map((ref) => ref.id).join(', ');
    issues.push({
      severity: 'warning',
      rule: 'docs/uncollected-directory',
      message: owners.length === 0
        ? `${rel}/ holds ${files.length} Markdown file(s) that were NOT collected: "${entry.name}" names none of this artifact's packages, so there is no package body to attach them to (ADR-0130 D4). A per-package docs directory is matched against a package's \`id\` or the last dot-separated segment of that \`id\` — rename the directory to one of those two, declare the docs inline as \`defineStack({ docs })\` on the package that owns them, or move them into src/docs/. Declared packages: ${declared}. Found: ${files.join(', ')}`
        : `${rel}/ holds ${files.length} Markdown file(s) that were NOT collected: "${entry.name}" names ${owners.length} of this artifact's packages (${owners.map((o) => o.id).join(', ')}), so which package body owns these docs is ambiguous and ⛔ this collector will not guess (ADR-0130 D4). Give those packages distinct \`id\` spellings — their last dot-separated segments must differ too — or declare the docs inline as \`defineStack({ docs })\` on the one that owns them. Found: ${files.join(', ')}`,
      path: rel,
    });
  }
  return { packageDocs, issues };
}

/**
 * Read one flat docs directory and compile each `.md` file into a `DocItem`.
 * Structural problems (subdirectories, bad filename stems) are reported as
 * error issues; offending files are skipped rather than partially collected.
 *
 * `relBase` is how the directory is NAMED in every issue this raises, relative
 * to the config file — `src/docs` for the stack's own flat directory, and
 * `src/<pkg>/docs` for a package's. It is a parameter rather than a constant
 * because #18431 gave this reader a second caller; for the flat directory the
 * text it produces is byte-identical to what it produced before.
 */
function compileDocsDirectory(docsDir: string, relBase: string): { docs: DocItem[]; issues: DocIssue[] } {
  const issues: DocIssue[] = [];
  if (!fs.existsSync(docsDir)) return { docs: [], issues };

  const baseByName = new Map<string, DocItem>();
  const variants: Array<{ base: string; locale: string; item: DocTranslationItem; rel: string }> = [];

  for (const entry of fs.readdirSync(docsDir, { withFileTypes: true })) {
    const rel = `${relBase}/${entry.name}`;
    if (entry.isDirectory()) {
      issues.push({
        severity: 'error',
        rule: 'docs/flat-directory',
        message: `Subdirectory "${entry.name}" under ${relBase}/ is not allowed (ADR-0046 §3.2). Flatten all .md files directly into ${relBase}/.`,
        path: rel,
      });
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    const stem = entry.name.slice(0, -3);
    const raw = fs.readFileSync(path.join(docsDir, entry.name), 'utf-8');
    const { title, description, order, group, tags, unreadableTags, body } = parseFrontmatter(raw);

    // A `tags:` the reader could not parse is REPORTED, never dropped: the
    // symptom of a drop is a book group that renders empty with nothing
    // anywhere saying why, which is the failure this key exists to prevent.
    if (unreadableTags !== undefined) {
      issues.push({
        severity: 'warning',
        rule: 'docs/frontmatter-tags',
        message: `Frontmatter \`tags:\` in "${entry.name}" is not a list this reader understands, so no tags were collected and a book group's \`include: { tag }\` cannot match this doc. Write either \`tags: [tutorial, beginner]\` or a block of \`- item\` lines under \`tags:\`. Found: ${unreadableTags}`,
        path: rel,
      });
    }

    // Locale variant `<base>.<locale>.md` (ADR-0046 i18n) — checked before the
    // bare-name rule, since a variant stem legitimately contains a dot.
    const variantMatch = stem.match(DOC_VARIANT_RE);
    if (variantMatch) {
      // Tags are a property of the DOC, not of a translation — a
      // `DocTranslationItem` carries only label/description/content. Parsed
      // tags here would otherwise vanish exactly as unparsed ones used to.
      if (tags) {
        issues.push({
          severity: 'warning',
          rule: 'docs/frontmatter-tags',
          message: `Locale variant "${entry.name}" declares frontmatter \`tags:\`, but tags belong to the doc rather than to one translation and are read from the base file "${variantMatch[1]}.md" only — these tags were not collected. Move them to the base file.`,
          path: rel,
        });
      }
      variants.push({
        base: variantMatch[1],
        locale: variantMatch[2],
        item: { ...(title ? { label: title } : {}), ...(description ? { description } : {}), content: body },
        rel,
      });
      continue;
    }

    if (!DOC_NAME_RE.test(stem)) {
      issues.push({
        severity: 'error',
        rule: 'docs/filename',
        message: `Doc filename "${entry.name}" must be snake_case (e.g. crm_lead_guide.md), optionally with a locale suffix (crm_lead_guide.zh.md); the stem becomes the doc name.`,
        path: rel,
      });
      continue;
    }

    baseByName.set(stem, {
      name: stem,
      label: title ?? firstHeading(body),
      ...(description ? { description } : {}),
      content: body,
      ...(order !== undefined ? { order } : {}),
      ...(group ? { group } : {}),
      ...(tags ? { tags } : {}),
    });
  }

  // Fold variants into their base doc. An orphan variant (no base file) is an
  // error: it would silently never render (resolution always starts from the
  // base doc).
  for (const v of variants) {
    const base = baseByName.get(v.base);
    if (!base) {
      issues.push({
        severity: 'error',
        rule: 'docs/orphan-translation',
        message: `Locale variant "${path.basename(v.rel)}" has no base doc "${v.base}.md" in this package — add the base file or remove the variant.`,
        path: v.rel,
      });
      continue;
    }
    if (base.translations?.[v.locale]) {
      issues.push({
        severity: 'error',
        rule: 'docs/duplicate-translation',
        message: `Duplicate "${v.locale}" variant for doc "${v.base}".`,
        path: v.rel,
      });
      continue;
    }
    (base.translations ??= {})[v.locale] = v.item;
  }

  return { docs: [...baseByName.values()], issues };
}

/**
 * Read `src/docs/*.md` (flat) next to the given config file, and — when the
 * caller hands over the artifact's `packages[]` — every `src/<pkg>/docs/` whose
 * directory name resolves to one of those packages (#18431, ADR-0130 D4).
 *
 * The two results stay SEPARATE and that separation is the ruling: the flat
 * directory's docs are the stack's own and keep attaching where they always
 * did (`docs` below, which `compile.ts` writes to the artifact's top level),
 * while a package's docs go to `packageDocs` and from there into that package's
 * own body — ⛔ never to the top level.
 *
 * ⚠️ Called with ONE argument, this function behaves exactly as it always has:
 * `packageDocs` is empty, every `src/<pkg>/docs/` is reported by the #18170
 * warning, and `docs`/`issues` are byte-for-byte what they were. That is what
 * makes "nothing existing moves" checkable rather than promised — a
 * single-package stack declares no `packages[]`, so it takes the same branch.
 */
export function collectDocsFromSrc(
  configPath: string,
  packages?: unknown,
): { docs: DocItem[]; issues: DocIssue[]; packageDocs: PackageDocSet[] } {
  const srcDir = path.join(path.dirname(configPath), 'src');
  const sweep = sweepPackageDocsDirectories(srcDir, docsPackageRefs(packages));
  const flat = compileDocsDirectory(path.join(srcDir, COLLECTED_DOCS_DIR), `src/${COLLECTED_DOCS_DIR}`);
  return { docs: flat.docs, issues: [...sweep.issues, ...flat.issues], packageDocs: sweep.packageDocs };
}

/**
 * Content + naming lint over the package's full doc set (collected files
 * plus any inline `defineStack({ docs })` items).
 *
 * `resolvableNames` is the set a same-prefix LINK resolves against, and it is
 * deliberately separate from `docs` (#18431 contract review, finding C2). The
 * naming rules below judge one OWNER — that is the per-package prefix rule the
 * ruling asked for — but a link is not a judgment about an owner: it asks
 * whether the target EXISTS, and ADR-0130 D1 exists so that N packages of one
 * artifact may SHARE a namespace. Resolved against one package's own names, a
 * link from package A to package B's doc under the namespace they share reads
 * as broken and an artifact that built green stops building. So the caller
 * hands in every name the artifact carries and links resolve artifact-wide —
 * the same scope `lintMetadataEmbeds` already uses for the same docs, so the
 * two halves of one lint are partitioned the same way rather than two ways.
 *
 * ⚠️ Omitted, it falls back to this set's own names: the pre-#18431 behaviour,
 * and exactly right for the caller that omits it — a stack with no `packages[]`,
 * where the one set IS the artifact.
 */
export function lintDocs(
  docs: DocItem[],
  namespace: string | undefined,
  resolvableNames?: ReadonlySet<string>,
): DocIssue[] {
  const issues: DocIssue[] = [];
  if (docs.length === 0) return issues;

  if (!namespace) {
    issues.push({
      severity: 'error',
      rule: 'docs/namespace-required',
      message: 'A package that ships docs must declare manifest.namespace (ADR-0046 §3.2) — doc names are namespace-prefixed.',
      path: 'manifest.namespace',
    });
  }

  const names = new Set<string>();
  for (const doc of docs) {
    const where = `docs/${doc.name}`;

    if (names.has(doc.name)) {
      issues.push({
        severity: 'error',
        rule: 'docs/duplicate-name',
        message: `Duplicate doc name "${doc.name}" (inline defineStack docs and src/docs/*.md files share one namespace).`,
        path: where,
      });
      continue;
    }
    names.add(doc.name);

    if (namespace && !doc.name.startsWith(`${namespace}_`)) {
      issues.push({
        severity: 'error',
        rule: 'docs/namespace-prefix',
        message: `Doc name "${doc.name}" must carry the package namespace prefix: rename to "${namespace}_${doc.name}" (file ${namespace}_${doc.name}.md).`,
        path: where,
      });
    }

    const scannable = stripCode(doc.content);

    // v1 image ban (ADR-0046 §3.4): binaries bloat artifacts; external
    // URLs break version immutability.
    if (/!\[[^\]]*\]\(/.test(scannable) || /<img[\s>]/i.test(scannable)) {
      issues.push({
        severity: 'error',
        rule: 'docs/no-images',
        message: `Doc "${doc.name}" contains an image reference — not allowed in v1 (ADR-0046 §3.4).`,
        path: where,
      });
    }

    // MDX ban (ADR-0046 §3.4): MDX is code crossing the ADR-0025 trust
    // boundary. Heuristics are conservative — ESM import/export statement
    // shapes and capitalized JSX component tags outside code — so prose
    // like "import the data first" never trips them.
    if (
      /^\s*import\s+.+\s+from\s+['"]/m.test(scannable) ||
      /^\s*export\s+(default|const|function)\s/m.test(scannable) ||
      /<[A-Z][A-Za-z0-9]*[\s/>]/.test(scannable)
    ) {
      issues.push({
        severity: 'error',
        rule: 'docs/no-mdx',
        message: `Doc "${doc.name}" appears to contain MDX/JSX — only CommonMark + GFM Markdown is allowed (ADR-0046 §3.3/§3.4).`,
        path: where,
      });
    }

    // Locale variants get the same v1 content bans — a translated body must
    // not smuggle in MDX/images that the base file forbids.
    for (const [locale, variant] of Object.entries(doc.translations ?? {})) {
      const vScannable = stripCode(variant.content);
      if (/!\[[^\]]*\]\(/.test(vScannable) || /<img[\s>]/i.test(vScannable)) {
        issues.push({
          severity: 'error',
          rule: 'docs/no-images',
          message: `Doc "${doc.name}" (${locale}) contains an image reference — not allowed in v1 (ADR-0046 §3.4).`,
          path: `${where}.${locale}`,
        });
      }
      if (
        /^\s*import\s+.+\s+from\s+['"]/m.test(vScannable) ||
        /^\s*export\s+(default|const|function)\s/m.test(vScannable) ||
        /<[A-Z][A-Za-z0-9]*[\s/>]/.test(vScannable)
      ) {
        issues.push({
          severity: 'error',
          rule: 'docs/no-mdx',
          message: `Doc "${doc.name}" (${locale}) appears to contain MDX/JSX — only CommonMark + GFM Markdown is allowed (ADR-0046 §3.3/§3.4).`,
          path: `${where}.${locale}`,
        });
      }
    }
  }

  // Same-prefix link resolution: `[text](./NAME.md#anchor)` where the target
  // carries OUR namespace prefix must resolve to a doc THIS ARTIFACT carries.
  // Targets with a different prefix are cross-package links, verified at
  // publish time against dependency docs.
  //
  // [#18431] Resolved against `resolvableNames` — every name in the artifact —
  // rather than against `names`, which is this owner's set alone. See the
  // docblock: the two are the same set for a single-package stack, and they
  // differ exactly where ADR-0130 D1 lets packages share one namespace.
  const resolvable = resolvableNames ?? names;
  for (const doc of docs) {
    const linkRe = /\]\((?:\.\/)?([a-zA-Z0-9_.-]+\.md)(#[^)]*)?\)/g;
    const scannable = stripCode(doc.content);
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(scannable)) !== null) {
      const target = m[1].slice(0, -3);
      if (m[1].includes('/')) continue; // path-shaped link; flatness rule already errs on real subdirs
      if (namespace && !target.startsWith(`${namespace}_`)) continue;
      if (!resolvable.has(target)) {
        issues.push({
          severity: 'error',
          rule: 'docs/broken-link',
          message: `Doc "${doc.name}" links to "./${m[1]}" but no doc named "${target}" exists in this package.`,
          path: `docs/${doc.name}`,
        });
      }
    }
  }

  return issues;
}

// ── Inline metadata views (ADR-0051): ```metadata fences ────────────────────

type AnyRec = Record<string, unknown>;

const METADATA_EMBED_TYPES = ['state_machine', 'flow', 'permission'] as const;

/** Parse a flat `key: value` ```metadata fence body (data, not code). Mirrors
 *  the objectui-side parser so build-time validation matches render-time. */
function parseMetadataFenceBody(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/** Extract each ```metadata fenced block's raw body from Markdown. NOTE: the
 *  other content scans use stripCode(), which DELETES fenced blocks — so this
 *  walks the raw lines instead. */
function extractMetadataFences(content: string): string[] {
  const bodies: string[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```\s*metadata\b/.test(lines[i])) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      bodies.push(body.join('\n'));
    }
  }
  return bodies;
}

function levenshtein(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Closest candidate within a small edit distance, for did-you-mean hints. */
function nearest(name: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = levenshtein(name, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best !== undefined && bestD <= Math.max(2, Math.floor(name.length / 3)) ? best : undefined;
}

/**
 * Lint ```metadata embeds (ADR-0051): body shape + reference liveness against
 * the package's OWN metadata. A broken embed degrades to a placeholder at
 * render time (never crashes), but a dead same-package reference is a build
 * error here — the same posture as `docs/broken-link`. Cross-package embeds
 * are out of v1 scope, so every reference must resolve within this stack.
 */
export function lintMetadataEmbeds(docs: DocItem[], stack: Record<string, unknown>): DocIssue[] {
  const issues: DocIssue[] = [];
  const objects = Array.isArray(stack.objects) ? (stack.objects as AnyRec[]) : [];
  const flows = Array.isArray(stack.flows) ? (stack.flows as AnyRec[]) : [];
  const permissions = Array.isArray(stack.permissions) ? (stack.permissions as AnyRec[]) : [];
  const objByName = new Map(objects.map((o) => [String(o?.name), o]));
  const flowNames = flows.map((f) => String(f?.name));
  const permNames = permissions.map((p) => String(p?.name));

  const scan = (docName: string, content: string, locale?: string): void => {
    const where = `docs/${docName}${locale ? ` (${locale})` : ''}`;
    const err = (rule: string, message: string) => issues.push({ severity: 'error', rule, message, path: where });

    for (const body of extractMetadataFences(content)) {
      const f = parseMetadataFenceBody(body);
      const type = f.type;

      // ── body shape ──
      if (!type) {
        err('docs/metadata-embed', `metadata embed in "${docName}" is missing \`type\` (one of ${METADATA_EMBED_TYPES.join(', ')}).`);
        continue;
      }
      if (!(METADATA_EMBED_TYPES as readonly string[]).includes(type)) {
        const s = nearest(type, METADATA_EMBED_TYPES as unknown as string[]);
        err('docs/metadata-embed', `metadata embed in "${docName}" has unknown type "${type}"${s ? ` — did you mean \`${s}\`?` : ` (expected ${METADATA_EMBED_TYPES.join(', ')})`}.`);
        continue;
      }
      if (!f.name) {
        err('docs/metadata-embed', `metadata embed (${type}) in "${docName}" is missing \`name\`.`);
        continue;
      }

      // ── reference liveness (same-package) ──
      if (type === 'state_machine') {
        if (!f.object) {
          err('docs/metadata-embed', `state_machine embed "${f.name}" in "${docName}" is missing \`object\` (a state machine is a rule on an object).`);
          continue;
        }
        const obj = objByName.get(f.object);
        if (!obj) {
          const s = nearest(f.object, [...objByName.keys()]);
          err('docs/metadata-embed-ref', `state_machine embed in "${docName}" references object "${f.object}", which does not exist in this package${s ? ` — did you mean \`${s}\`?` : ''}.`);
          continue;
        }
        const rules = obj.validations ?? obj.validationRules;
        const smNames = (Array.isArray(rules) ? (rules as AnyRec[]) : [])
          .filter((r) => r?.type === 'state_machine')
          .map((r) => String(r?.name));
        if (!smNames.includes(f.name)) {
          const s = nearest(f.name, smNames);
          err('docs/metadata-embed-ref', `state_machine embed in "${docName}" references "${f.name}", but object "${f.object}" has no state_machine rule with that name${s ? ` — did you mean \`${s}\`?` : ''}.`);
        }
      } else if (type === 'flow') {
        if (!flowNames.includes(f.name)) {
          const s = nearest(f.name, flowNames);
          err('docs/metadata-embed-ref', `flow embed in "${docName}" references flow "${f.name}", which does not exist in this package${s ? ` — did you mean \`${s}\`?` : ''}.`);
        }
      } else if (type === 'permission') {
        if (!permNames.includes(f.name)) {
          const s = nearest(f.name, permNames);
          err('docs/metadata-embed-ref', `permission embed in "${docName}" references permission set "${f.name}", which does not exist in this package${s ? ` — did you mean \`${s}\`?` : ''}.`);
        }
      }
    }
  };

  for (const doc of docs) {
    scan(doc.name, doc.content);
    for (const [locale, v] of Object.entries(doc.translations ?? {})) scan(doc.name, v.content, locale);
  }
  return issues;
}

/**
 * A doc's identity for the "does some package already own this one?" question.
 *
 * Reference first, structural second — the shape `resolveArtifactCollections`
 * uses on the other side of the same artifact (`packages/runtime/src/
 * artifact-collections.ts`). `composeStacks(…, { manifest: 'preserve' })` puts
 * the SAME item object in a package body and in the flattened top level, so the
 * reference answers for every artifact this repo produces; the structural leg
 * is what keeps a hand-written artifact — where the two copies are equal but
 * not identical — from being read as a name collision with itself.
 */
function docIdentity(doc: unknown): string {
  return JSON.stringify(doc, (_key, value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
        Object.keys(value as Record<string, unknown>).sort().map((k) => [k, (value as Record<string, unknown>)[k]]),
      )
      : value) ?? 'undefined';
}

/** A membership test over {@link docIdentity}, reference-first. */
function claimedDocs(items: readonly DocItem[]): { has: (doc: DocItem) => boolean } {
  const refs = new WeakSet<object>();
  const keys = new Set<string>();
  for (const item of items) {
    if (item !== null && typeof item === 'object') refs.add(item as object);
    keys.add(docIdentity(item));
  }
  return {
    has: (doc) => (doc !== null && typeof doc === 'object' && refs.has(doc as object)) || keys.has(docIdentity(doc)),
  };
}

/** The `docs` a `packages[]` entry already carries in its own assembled body. */
function bodyDocsOf(packages: unknown, index: number): DocItem[] {
  if (!Array.isArray(packages)) return [];
  const body = (packages[index] as { manifest?: Record<string, unknown> } | null | undefined)?.manifest;
  const docs = body?.docs;
  return Array.isArray(docs) ? (docs as DocItem[]) : [];
}

/**
 * The ONE rule the per-package split cannot enforce inside a single package:
 * a doc name declared by two different owners.
 *
 * This rule PRESERVES a refusal, it does not add one. Before the split every
 * doc reached `lintDocs` in ONE flattened array — the composed top level is the
 * concat of every package's docs — so two owners declaring one name were two
 * entries in one set and `docs/duplicate-name` already fired. Splitting the set
 * per package (the ruling's clause 2) would have dropped that refusal silently,
 * and ADR-0130 D1 makes the case reachable on purpose: N packages of one
 * artifact may share one namespace, so their prefixes do not keep them apart.
 *
 * ⚠️ The REASON is authoring hygiene, and ⛔ deliberately not "one silently
 * overwrites the other at registration". That sentence is this module's older
 * framing and ADR-0048 retired it: packaged items are stored under a composite
 * `<packageId>:<name>` key and resolution is package-scoped, so two distinct
 * packages coexist on one bare name by construction (§3.3, §3.4 — "the
 * cross-package throw is retired"). What survives there is exactly what this
 * is: an authoring-time hygiene lint. ⚠️ That `os build` refuses the shape at
 * all is a standing disagreement with ADR-0048 §3.4 which PREDATES this card
 * and is filed as #19248 rather than changed here — ⛔ relaxing a refusal that
 * shipped is not a rider on a widening.
 *
 * #19248 read §3.4 back and settled the justification rather than moving it.
 * The clause retires a RUNTIME throw and nothing else — *"The cross-package
 * **throw is retired**; two distinct packages coexist on the same bare name by
 * construction."* — while keeping the class this lint belongs to: *"Authoring-time
 * hygiene — an author shipping two `page/home` in one package — stays covered by
 * the `naming/namespace-prefix` lint in `os lint`."* So the reason stated above is
 * the one that survived §3.4, and ⛔ no wording change was warranted. What #19248
 * left open is the SEVERITY, not the reason: §3.4 hands authoring hygiene to a
 * warning-only lint while this one is `severity: 'error'`.
 *
 * ⚠️ "this module's older framing" above was, when #19248 landed, still live in
 * this file's HEADER docblock as the current reason for the naming lints. Out of
 * that round's file surface (it also justified `docs/namespace-prefix`), it was
 * reported there rather than edited, and #19359 corrected the header — which now
 * separates the two lints instead of covering both with the one retired sentence.
 */
function lintDocNamesAcrossOwners(
  sets: ReadonlyArray<{ label: string; docs: readonly DocItem[] }>,
): DocIssue[] {
  const owners = new Map<string, string[]>();
  for (const set of sets) {
    const seen = new Set<string>();
    for (const doc of set.docs) {
      if (typeof doc?.name !== 'string' || seen.has(doc.name)) continue; // within-set dupes are `lintDocs`' job
      seen.add(doc.name);
      const labels = owners.get(doc.name) ?? [];
      labels.push(set.label);
      owners.set(doc.name, labels);
    }
  }
  const issues: DocIssue[] = [];
  for (const [name, labels] of owners) {
    if (labels.length < 2) continue;
    issues.push({
      severity: 'error',
      rule: 'docs/duplicate-name',
      message: `Doc name "${name}" is declared by ${labels.join(' and ')}. One artifact may not ship one doc name twice — rename one. Doc names are namespace-prefixed for authoring hygiene, and ADR-0130 D1 lets packages of one artifact SHARE a namespace, so the prefix does not keep these apart.`,
      path: `docs/${name}`,
    });
  }
  return issues;
}

/** Re-locate a per-package issue so its `path` says which package it came from. */
function underPackage(issues: readonly DocIssue[], index: number): DocIssue[] {
  return issues.map((issue) => ({ ...issue, path: `packages[${index}].${issue.path}` }));
}

/**
 * One-call entry for `os build` / `os validate` / `os lint`: collect
 * `src/docs/*.md` and every resolvable `src/<pkg>/docs/`, merge the flat set
 * with the stack's inline `docs`, and lint each set against the namespace of
 * the package that owns it.
 *
 * Returns the stack-level doc array (inline items first — they were already
 * schema-validated), which is what the artifact's TOP LEVEL carries, plus the
 * per-package sets {@link attachPackageDocs} writes into `packages[]`, plus
 * every issue found.
 *
 * ## The lint partition (#18431, the ruling's clause 2)
 *
 * A doc is linted ONCE, against the namespace of whoever owns it:
 *
 *   - a doc a `packages[]` body carries (composition folded a package's inline
 *     `defineStack({ docs })` there), or one read out of that package's
 *     `src/<pkg>/docs/`, is linted against THAT package's `namespace`;
 *   - everything else — the stack's own flat `src/docs/` and any top-level
 *     inline doc no package claims — keeps `stack.manifest.namespace`.
 *
 * ⛔ There is no single global prefix any more, and no fallback between the two
 * rules: a package doc that fails its own package's prefix is refused, never
 * re-tried against the artifact's. `lintDocNamesAcrossOwners` is what replaces
 * the one thing the single global set used to give for free.
 *
 * ## What the partition deliberately does NOT reach
 *
 * ⛔ The OWNERSHIP question and the EXISTENCE question are not the same
 * question, and only the first one is partitioned. Same-prefix link resolution
 * and metadata-embed reference liveness both resolve across the WHOLE artifact:
 * a doc's namespace prefix says who judges its NAME, while a link asks whether
 * the target is there, and ADR-0130 D1 exists precisely so that N packages of
 * one artifact may share a namespace and cross-link inside it.
 *
 * Partitioning links too would have turned an ordinary cross-package link into
 * `docs/broken-link` and stopped an artifact that built green from building —
 * an unauthorised narrowing, caught by this card's contract review as C2 and
 * pinned by `a link across two packages sharing one namespace` in
 * `collect-docs.package-docs.test.ts`.
 *
 * ⚠️ A stack with no `packages[]` — every single-package app — takes exactly
 * the old path: nothing is claimed, so the stack-level set IS the whole set and
 * the issue list is unchanged, item for item.
 */
export function collectAndLintDocs(
  configPath: string,
  stack: Record<string, unknown>,
): { docs: DocItem[]; issues: DocIssue[]; packageDocs: PackageDocSet[] } {
  const inline = Array.isArray(stack.docs) ? (stack.docs as DocItem[]) : [];
  const collected = collectDocsFromSrc(configPath, stack.packages);
  const namespace = (stack.manifest as { namespace?: string } | undefined)?.namespace;
  const docs = [...inline, ...collected.docs];

  const collectedByIndex = new Map(collected.packageDocs.map((set) => [set.index, set]));
  const owned = docsPackageRefs(stack.packages).map((ref) => {
    const body = bodyDocsOf(stack.packages, ref.index);
    const fromDisk = collectedByIndex.get(ref.index)?.docs ?? [];
    return { ref, body, fromDisk, all: [...body, ...fromDisk] };
  }).filter((entry) => entry.all.length > 0);

  // The top level keeps every doc it carried — the artifact shape does not
  // move. What the ownership split changes is only which namespace each doc is
  // JUDGED against, so the stack-level lint drops the ones a package claims.
  const claimed = claimedDocs(owned.flatMap((entry) => entry.body));
  const stackScoped = docs.filter((doc) => !claimed.has(doc));

  // [#18431 contract review, C2] Every name this artifact carries, whoever owns
  // it — what a same-prefix LINK resolves against. The ownership split decides
  // which namespace a doc is JUDGED by; it must not decide whether a sibling
  // package's doc EXISTS, because ADR-0130 D1 is the case where two packages
  // share the prefix and a cross-package link is ordinary. For a stack with no
  // `packages[]` this set is exactly `docs`, so the single-package path is
  // unmoved.
  const artifactNames: ReadonlySet<string> = new Set(
    [...docs, ...owned.flatMap((entry) => entry.all)]
      .map((doc) => doc?.name)
      .filter((name): name is string => typeof name === 'string'),
  );

  const issues: DocIssue[] = [
    ...collected.issues,
    ...lintDocs(stackScoped, namespace, artifactNames),
    ...lintMetadataEmbeds(docs, stack),
  ];
  for (const entry of owned) {
    issues.push(...underPackage(lintDocs(entry.all, entry.ref.namespace, artifactNames), entry.ref.index));
    // Only the docs read off disk need an embed pass here: a doc already on the
    // body is also in `docs` above, where `lintMetadataEmbeds` has judged it.
    issues.push(...underPackage(lintMetadataEmbeds(entry.fromDisk, stack), entry.ref.index));
  }
  issues.push(...lintDocNamesAcrossOwners([
    { label: 'the stack itself', docs: stackScoped },
    ...owned.map((entry) => ({ label: `package "${entry.ref.id}"`, docs: entry.all })),
  ]));

  return { docs, issues, packageDocs: collected.packageDocs };
}

/**
 * Write each collected {@link PackageDocSet} onto the body of the package that
 * owns it — `packages[i].manifest.docs`, the structural position ADR-0130 D4
 * reserves for a package body (#18431, the ruling's clause 1).
 *
 * ⛔ Not the artifact top level. A body's docs are served because the load path
 * REGISTERS EACH BODY — ⛔ not through `resolveArtifactCollections`, which is a
 * different seam (it answers the top-level READ of a collection):
 * `AppPlugin.init` calls `getService('manifest').register(artifact)`
 * (`packages/runtime/src/app-plugin.ts`); that service runs
 * `resolveArtifactPackageOrder` — every package body when `packages` is present
 * — and calls `ql.registerApp(body)` per body
 * (`packages/objectql/src/plugin.ts`); `registerApp` feeds
 * `registerMetadataCollections`, whose `METADATA_ARRAY_KEYS` carries `docs`
 * (`packages/objectql/src/engine.ts`). So a doc written here reaches the
 * registry stamped with its OWNING package, which is the ownership ADR-0130 D1
 * is about and a flattened copy would destroy.
 *
 * Returns the ARGUMENT ITSELF when nothing is added, so an artifact with no
 * per-package docs is not merely equal to the one built before this landed —
 * it is the same object, serialized from the same references.
 */
export function attachPackageDocs(packages: unknown, sets: readonly PackageDocSet[]): unknown {
  if (!Array.isArray(packages) || sets.length === 0) return packages;
  const byIndex = new Map(sets.map((set) => [set.index, set]));
  let changed = false;
  const out = packages.map((entry, index) => {
    const set = byIndex.get(index);
    if (!set || set.docs.length === 0) return entry;
    const body = (entry as { manifest?: Record<string, unknown> } | null | undefined)?.manifest;
    if (body === null || typeof body !== 'object') return entry;
    const existing = Array.isArray(body.docs) ? (body.docs as DocItem[]) : [];
    const claimed = claimedDocs(existing);
    const added = set.docs.filter((doc) => !claimed.has(doc));
    if (added.length === 0) return entry;
    changed = true;
    return { ...(entry as Record<string, unknown>), manifest: { ...body, docs: [...existing, ...added] } };
  });
  return changed ? out : packages;
}
