// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The protocol upgrade guide's public address: one docs-site page per protocol
 * major, plus an index, GENERATED at docs build and never committed (#22449 B′,
 * condition 2).
 *
 * `build-upgrade-guide.ts` with no flag writes these pages into
 * `content/docs/protocol-upgrade/` (gitignored), and the `@objectstack/docs`
 * build runs it before `next build`. The site serves them at
 * `https://objectstack.ai/docs/protocol-upgrade` (the index) and
 * `https://objectstack.ai/docs/protocol-upgrade/<major>` (one per major), so a
 * pointer to one major's page keeps resolving after the next major opens.
 * `docs/protocol-upgrade-guide.md` is a committed pointer stub naming them.
 *
 * The docs site builds from `main`, and `main` can carry a protocol major no
 * release ships yet: in Changesets pre mode `PROTOCOL_VERSION` may already name
 * the major the pending release will publish (`src/kernel/protocol-version.ts`).
 * So every page says which state its major is in, read from the tree's own
 * `@objectstack/spec` version — `released`, `prerelease` or `unreleased` — and
 * every page says it is generated from `main`, ahead of the release that ships
 * a newly landed entry.
 *
 * This module only ASSEMBLES pages; it imports no registry, so it is pinned by
 * `upgrade-guide-docs.test.ts` with fixture sections. The guide's prose comes
 * from the same renderers `build()` uses for the single-file projection.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The generated tree, relative to the repo root. Gitignored. */
export const DOCS_DIR = 'content/docs/protocol-upgrade';

/** The site route the generated tree is served at. */
export const DOCS_ROUTE = '/docs/protocol-upgrade';

/** The docs site's origin (`apps/docs/lib/site.ts` `SITE_ORIGIN`). */
export const DOCS_ORIGIN = 'https://objectstack.ai';

/** Where one major's page is served. */
export function majorRoute(major: number): string {
  return `${DOCS_ROUTE}/${major}`;
}

export type ReleaseStatus = 'released' | 'prerelease' | 'unreleased';

/**
 * Which state protocol `major` is in, judged from the tree's own
 * `@objectstack/spec` version. The protocol major is kept in lockstep with the
 * package major (`protocol-version.test.ts`); the one exception is a pending
 * major in pre mode, which is exactly the `unreleased` case here.
 */
export function releaseStatus(major: number, specVersion: string): ReleaseStatus {
  const m = /^(\d+)\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.exec(specVersion);
  if (!m) throw new Error(`@objectstack/spec version ${JSON.stringify(specVersion)} is not MAJOR.MINOR.PATCH[-PRE].`);
  const versionMajor = Number(m[1]);
  if (versionMajor < major) return 'unreleased';
  if (versionMajor === major && m[2] !== undefined) return 'prerelease';
  return 'released';
}

/** One blockquote line saying what state the major is in. */
export function statusLine(major: number, status: ReleaseStatus, specVersion: string): string {
  switch (status) {
    case 'unreleased':
      return (
        `> **Not released yet.** Protocol ${major} ships in no published \`@objectstack/spec\` ` +
        `(this tree versions it ${specVersion}). This page is generated from \`main\` and changes ` +
        `as entries land; nothing on it is shipped until the release that carries protocol ${major}.`
      );
    case 'prerelease':
      return (
        `> **Prerelease.** Protocol ${major} ships on the \`next\` dist-tag ` +
        `(\`@objectstack/spec@${specVersion}\` in this tree) until ${major}.0 GA; entries can ` +
        'still land before then.'
      );
    case 'released':
      return `> **Released.** Protocol ${major} ships in \`@objectstack/spec\` (this tree versions it ${specVersion}).`;
  }
}

/** The provenance paragraph every page carries. */
export const PROVENANCE =
  'Generated at docs build from the ADR-0087 registries on `main` (`@objectstack/spec` ' +
  '`conversions/` + `migrations/`): an entry shows here once it merges, before the release that ' +
  'ships it. What a given release shipped is its own copy: every `@objectstack/spec` release after ' +
  '17.7.0 carries `protocol-upgrade-guide.md` in the package and attached to its ' +
  '`@objectstack/spec@VERSION` GitHub Release; 17.7.0 and earlier carry none.';

/** One major's hop, as the generator renders it. */
export interface HopInput {
  /** The protocol major the hop arrives at (`17` for `16 → 17`). */
  major: number;
  /** The hop's own section, `## Protocol N-1 → N` and everything under it. */
  section: string[];
}

export interface DocsPagesInput {
  /** `@objectstack/spec`'s version in this tree (`packages/spec/package.json`). */
  specVersion: string;
  /** The `## How to upgrade` section, shared by every page. */
  howToUpgrade: string[];
  /** One per major the registries carry; any order (pages list newest first). */
  hops: HopInput[];
  /** The closing lines (machine-readable equivalents). */
  footer: string[];
}

/** A frontmatter scalar, quoted so YAML never reads `:` or `→` as structure. */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

function frontmatter(title: string, description: string): string[] {
  return ['---', `title: ${yamlString(title)}`, `description: ${yamlString(description)}`, '---', ''];
}

/**
 * Every file of the generated tree, keyed by its path relative to `DOCS_DIR`:
 * `index.md`, one `<major>.md` per hop, and the folder's `meta.json`.
 */
export function buildDocsPages(input: DocsPagesInput): Map<string, string> {
  const hops = [...input.hops].sort((a, b) => b.major - a.major);
  const files = new Map<string, string>();

  for (const hop of hops) {
    const status = releaseStatus(hop.major, input.specVersion);
    const lines = [
      ...frontmatter(
        `Protocol ${hop.major - 1} → ${hop.major} upgrade guide`,
        `The mechanical conversions and the semantic to-dos for moving metadata from protocol ` +
          `${hop.major - 1} to ${hop.major}, generated from the ADR-0087 registries.`,
      ),
      statusLine(hop.major, status, input.specVersion),
      '',
      PROVENANCE,
      '',
      ...input.howToUpgrade,
      ...hop.section,
      ...input.footer,
    ];
    files.set(`${hop.major}.md`, lines.join('\n'));
  }

  const index = [
    ...frontmatter(
      'Protocol upgrade guide',
      'One page per metadata protocol major: what each major changed, what `objectstack migrate meta` ' +
        'rewrites for you, and the to-dos it leaves you.',
    ),
    PROVENANCE,
    '',
    '| Protocol | Page | State |',
    '|---|---|---|',
    ...hops.map(
      (hop) =>
        `| ${hop.major - 1} → ${hop.major} | [${majorRoute(hop.major)}](${majorRoute(hop.major)}) | ` +
        `${releaseStatus(hop.major, input.specVersion)} |`,
    ),
    '',
    ...input.howToUpgrade,
    ...input.footer,
  ];
  files.set('index.md', index.join('\n'));

  files.set(
    'meta.json',
    `${JSON.stringify({ title: 'Protocol Upgrade Guide', pages: ['index', ...hops.map((hop) => String(hop.major))] }, null, 2)}\n`,
  );
  return files;
}

/** The file names this generator writes, and so the only ones it removes. */
const GENERATED_NAME = /^(?:index|\d+)\.md$|^meta\.json$/;

/**
 * Replace the generated tree at `dir` with `files`, so a page for a major that
 * left the registries (its hop fell below the support floor) does not linger
 * from an earlier run. Only generator-named files are removed: a directory
 * holding anything else is refused untouched, so a mistyped `--docs` target
 * can never cost a hand-written page.
 */
export function writeDocsPages(dir: string, files: Map<string, string>): string[] {
  if (existsSync(dir)) {
    const entries = readdirSync(dir);
    const foreign = entries.filter((name) => !GENERATED_NAME.test(name));
    if (foreign.length > 0) {
      throw new Error(
        `${dir} holds files this generator did not write (${foreign.slice(0, 5).join(', ')}` +
          `${foreign.length > 5 ? ', …' : ''}); refusing to replace it. Point --docs at an empty or generated directory.`,
      );
    }
    for (const name of entries) rmSync(join(dir, name));
  }
  const written: string[] = [];
  for (const [rel, bytes] of files) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    written.push(target);
  }
  return written;
}
