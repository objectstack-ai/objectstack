// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// ⚠️  AUTO-GENERATION SCRIPT
//
// This script regenerates ALL files under content/docs/references/{category}/.
// It DELETES each category folder before regenerating from JSON Schemas.
//
// DO NOT place hand-written content in content/docs/references/ — it WILL be
// overwritten or deleted on the next build.
//
// Hand-written documentation lives in the module folders under content/docs/
// (data-modeling/, automation/, permissions/, ui/, api/, ai/, plugins/, kernel/, ...).
// See DX_ROADMAP.md and .cursorrules for details.
//
// Usage:
//   tsx scripts/build-docs.ts            # write
//   tsx scripts/build-docs.ts --check    # verify in sync (CI); exit 1 on drift
//   tsx scripts/build-docs.ts --update-import-baseline   # re-ratchet the import-surface baseline (review the diff!)

import fs from 'fs';
import path from 'path';

// One staleness rule, shared with the merge driver's pre-commit half and with
// `check:generated`'s `--fix` refusal — a second copy of "is this artifact older
// than src" would drift, and the direction it drifts in is the one that renders
// a confident page from a tree nobody rebuilt (#4675, #4723).
import { schemaTreeIsStale } from '../../../scripts/check-regen-pending.mjs';

import { resolveCategoryTitles } from './lib/category-title';
import {
  evaluateBaseline,
  loadEntrySurfaces,
  resolveImports,
  serializeImportBaseline,
  type CategorySurface,
} from './lib/docs-import-surface';
import { renderFileDescription } from './lib/file-description';
import { anchorFor } from './lib/format-type';
import { createSink } from './lib/generated-output';
import {
  blurbCoverage,
  docLinkTargets,
  formatBlurbCoverage,
  renderRootIndex,
  type RootIndexCategory,
} from './lib/root-index';
import {
  buildSchemaIndex,
  formatConflicts,
  resolveSchemaPage,
  type SchemaIndex,
  type ZodFileInput,
} from './lib/schema-index';
import { schemaNameFromExportKey } from './lib/schema-name';
import { renderSchemaSection } from './lib/schema-section';
import { API_SURFACE_DIR_NAME, readApiSurfaceFrom } from './lib/sharded-artifacts';

const SCHEMA_DIR = path.resolve(__dirname, '../json-schema');
const SRC_DIR = path.resolve(__dirname, '../src');
// Output directly to references folder (flattened)
// ⚠️  Everything inside category sub-folders is auto-generated and disposable.
const DOCS_ROOT = path.resolve(__dirname, '../../../content/docs/references');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const API_SURFACE_DIR = path.resolve(__dirname, `../${API_SURFACE_DIR_NAME}`);
const IMPORT_BASELINE_PATH = path.resolve(__dirname, '../docs-import-surface.baseline.json');

const CHECK = process.argv.includes('--check');
const UPDATE_IMPORT_BASELINE = process.argv.includes('--update-import-baseline');

// ── The input tree is a BUILD ARTIFACT, and it must be current (#4723) ────────
//
// Every mode below renders from `SCHEMA_DIR` — `packages/spec/json-schema/`,
// which is gitignored, so no checkout carries it and nothing in git can tell you
// how old it is.
//
// Until #4723 the question could not come up: `check:docs` was
// `pnpm gen:schema && tsx scripts/build-docs.ts --check`, so the tree was rebuilt
// on every run. That first step is what made a script called `check:` WRITE two
// TRACKED files — `json-schema.manifest/` and `authorable-surface/` are
// projections `gen:schema` repairs whenever they are behind — so running the gate
// silently edited the tree of whoever ran it and left the staleness unreported.
// #4711 removed exactly that from `--check`; this was the same defect at a
// different entry, and the fix is the same shape: the check checks, and the
// CALLER generates (lint.yml's `check:authorable-surface` step, `check:generated`'s
// declared gate order, `pnpm build`, `apps/docs`' build).
//
// What the old first step also provided, silently, was FRESHNESS. Dropping it
// without asserting freshness would trade a tracked-file write for something
// worse: a green `check:docs` computed against a tree that predates the edit
// under test — a false green on precisely the change (`.describe()` added, a key
// renamed) this gate exists to catch. So the prerequisite is stated, in every
// mode, and it is fatal rather than a warning: `gen:docs` on a stale tree does
// not fail, it WRITES stale pages, which is the `readsDist` trap one artifact
// over (AGENTS.md records what that one cost).
if (schemaTreeIsStale(path.resolve(__dirname, '..'))) {
  const missing = !fs.existsSync(SCHEMA_DIR);
  console.error(
    `\n❌ ${path.relative(REPO_ROOT, SCHEMA_DIR)} is ${missing ? 'missing' : 'older than packages/spec/src'}.\n\n` +
      `   The reference docs are rendered from that tree, and it is a gitignored build\n` +
      `   artifact — nothing in a checkout carries it, and a merge never brings it along.\n` +
      `   Rendering ${CHECK ? 'a verdict' : 'pages'} from a stale tree would ${
        CHECK ? 'report the docs in sync with sources this run never read' : 'WRITE pages describing sources this run never read'
      }.\n\n` +
      `   Generate it first:\n\n` +
      `     pnpm --filter @objectstack/spec gen:schema\n\n` +
      `   (\`pnpm --filter @objectstack/spec build\` does this as its first step, and so does\n` +
      `   \`check:authorable-surface\`, which runs before this gate in CI and in check:generated.\n` +
      `   This script no longer runs it for you: a check that regenerates is a check that\n` +
      `   repairs the two tracked projections instead of reporting them — #4711, #4723.)`,
  );
  process.exit(1);
}

// ── Output sink ──────────────────────────────────────────────────────────────
// Shared with the spec's other generators — see lib/generated-output.ts for why
// the write and --check paths must be the same code.

const { emit, manageDir, wasEmitted, flush } = createSink({
  check: CHECK,
  repoRoot: REPO_ROOT,
});

// Categories are discovered from the src directory; their TITLES are declared,
// not derived from the directory name (#5853 — see lib/category-title.ts for
// why a derived title is wrong in a way no gate can see). A directory with no
// declared title stops the build here rather than publishing a guess.
const CATEGORY_DIRS = fs.readdirSync(SRC_DIR)
  .filter(file => fs.statSync(path.join(SRC_DIR, file)).isDirectory());

// `resolveCategoryTitles` is the ONLY way this map gets built, and it is total:
// it throws on a directory with no title and on a title with no directory. The
// check lives inside the constructor rather than beside it so a future caller
// cannot obtain a CATEGORIES map without it — what this replaces was exactly a
// fallback nobody had to opt out of.
function loadCategoryTitles(): Record<string, string> {
  try {
    return resolveCategoryTitles(CATEGORY_DIRS);
  } catch (err) {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

const CATEGORIES = loadCategoryTitles();

// Track all zod files per category
const categoryZodFiles = new Map<string, Set<string>>();
/**
 * `category` -> page slug -> the published schema names that page documents.
 *
 * Filled while the category pages are generated, and read back by the root
 * index (§2.6) so the master table enumerates from the SAME map that decided
 * which pages exist. Anything derived from it — rows, per-category counts, the
 * grand total — cannot disagree with the pages themselves (#4759).
 */
const categoryPageSchemas = new Map<string, Map<string, string[]>>();
/**
 * Page slug -> its real path under `packages/spec/src/<category>/`.
 *
 * A page named after a NESTED file (`driver-postgres`) does not sit at
 * `<category>/driver-postgres.zod.ts`, so the "Source:" line has to be looked up
 * rather than reassembled from the slug. Naming a file that does not exist is
 * the same defect as a schema that does not validate: a reader following it
 * finds nothing and has no way to tell the pointer was invented.
 */
const zodFileSourceRel = new Map<string, string>();

/**
 * `.zod.ts` files under a category, RECURSIVELY, keyed by the slug their page
 * takes (`driver/postgres.zod.ts` → `driver-postgres`).
 *
 * The walk used to be one level deep, which made every schema under
 * `data/driver/` invisible: those twelve landed in the catch-all `misc` bucket
 * the moment they were exported (#4410), on a page whose "Source" line named
 * `data/misc.zod.ts` — a file that does not exist. Same one-level-deep bug the
 * strictness ledger's own coverage gate had, and the same lesson: a generator
 * that under-reports produces confident output about surface it never saw.
 */
function collectZodFiles(dir: string, prefix = ''): Array<{ slug: string; rel: string }> {
  const out: Array<{ slug: string; rel: string }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...collectZodFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`));
      continue;
    }
    if (!entry.name.endsWith('.zod.ts')) continue;
    const rel = `${prefix}${entry.name}`;
    out.push({ slug: rel.replace(/\.zod\.ts$/, '').replace(/\//g, '-'), rel });
  }
  return out;
}

// Scan source files to build maps
function scanCategories(): SchemaIndex {
  const files: ZodFileInput[] = [];

  Object.keys(CATEGORIES).forEach(category => {
    const dir = path.join(SRC_DIR, category);
    if (!fs.existsSync(dir)) return;

    const zodFiles = new Set<string>();

    for (const { slug, rel } of collectZodFiles(dir)) {
      zodFiles.add(slug);
      zodFileSourceRel.set(`${category}/${slug}`, rel);
      files.push({
        category,
        slug,
        rel,
        source: fs.readFileSync(path.join(dir, rel), 'utf-8'),
      });
    }

    categoryZodFiles.set(category, zodFiles);
  });

  // Suffix-only strip — shared with build-schemas.ts; see lib/schema-name.ts (#4592).
  const index = buildSchemaIndex(files, schemaNameFromExportKey);

  // Two files in one category laying equal claim to a name is not a state this
  // generator may resolve: whichever it picked, the loser's schema would be
  // written onto a page named after a file that does not contain it. Stop.
  if (index.conflicts.length > 0) {
    console.error(`\n✗ ${formatConflicts(index.conflicts)}`);
    process.exit(1);
  }

  return index;
}

/**
 * Repo-relative source path for a page slug, or `undefined` when the slug has
 * no file behind it (the `misc` catch-all bucket). Callers must omit the
 * "Source:" pointer in that case rather than print a plausible-looking path.
 */
function sourcePathFor(category: string, zodFile: string): string | undefined {
  const rel = zodFileSourceRel.get(`${category}/${zodFile}`);
  return rel ? `packages/spec/src/${category}/${rel}` : undefined;
}

/**
 * `<category>/<SchemaName>` -> the page that documents it, plus the link rules
 * over it. Keyed by category on purpose: `build-schemas.ts` publishes
 * `json-schema/<category>/<Name>.json`, so the same name under two categories
 * is two published schemas and must be two index entries (#4696). See
 * `lib/schema-index.ts` for why a re-export counts and which file wins.
 */
const schemaIndex = scanCategories();

// ── Import examples: the package's real export surface ───────────────────────
// `api-surface/` is the committed record of every `name (kind)` per public
// entry point, kept honest by `check:api-surface`. Import examples are spelled
// from it rather than from the schema file name, so a page can only advertise
// an import that actually exists (#4570). Names it cannot account for are
// collected here and ratcheted against the committed baseline after flush().

const ENTRY_SURFACES: ReadonlyMap<string, CategorySurface> = loadEntrySurfaces(
  readApiSurfaceFrom(API_SURFACE_DIR),
);

/** Every unresolvable import name this run met, one stable line each. */
const importGaps = new Set<string>();

/**
 * Resolve a schema name to its page, AS SEEN FROM the category being rendered.
 * Returns null when the schema isn't one we generate a page for, or when the
 * name alone does not identify one — callers then render the type without a
 * link rather than emitting a 404 or a confident link to the wrong schema.
 *
 * The `fromCategory` argument is the whole point: a bare name is not a schema
 * identity (#4696). `ServiceStatus` is an `api` enum AND a `system` object, and
 * a single global lookup answered both with whichever the directory walk
 * reached last.
 */
function schemaHrefFrom(fromCategory: string): (name: string) => string | null {
  return (name: string) => {
    const page = resolveSchemaPage(schemaIndex, fromCategory, name);
    return page ? `/docs/references/${page.category}/${page.slug}${anchorFor(name)}` : null;
  };
}


/**
 * Every page this run publishes: `category` -> page slug -> the schemas that
 * page documents.
 *
 * Grouped ONCE and read twice — by §2 below, which emits the pages, and by
 * `sourcePathToDocsRoute`, which has to answer "is there a page for this file?"
 * while §2 is still part-way through the categories. Neither of the two obvious
 * shortcuts can answer it: asking the sink (`wasEmitted`) makes the reply depend
 * on which category the walk reached first, and asking the disk makes a run's
 * output depend on the previous run's, so a deleted page would keep resolving
 * until someone regenerated twice.
 */
function groupSchemasByPage(): Map<string, Map<string, Array<{ name: string; content: any }>>> {
  const byCategory = new Map<string, Map<string, Array<{ name: string; content: any }>>>();

  for (const category of Object.keys(CATEGORIES)) {
    const categorySchemaDir = path.join(SCHEMA_DIR, category);
    if (!fs.existsSync(categorySchemaDir)) {
      console.log(`Warning: Schema directory ${categorySchemaDir} does not exist`);
      continue;
    }

    const pages = new Map<string, Array<{ name: string; content: any }>>();
    for (const file of fs.readdirSync(categorySchemaDir).filter(f => f.endsWith('.json'))) {
      const schemaName = file.replace('.json', '');
      const content = JSON.parse(fs.readFileSync(path.join(categorySchemaDir, file), 'utf-8'));
      // Category-scoped: the page is owned by the file in THIS category that puts
      // the name on its export surface — declaration or re-export. `misc` stays
      // the catch-all for a published schema no `.zod.ts` here accounts for
      // (`security/*` declares two in plain `.ts` files), and it is honest about
      // it: `sourcePathFor` finds no file, so the page prints no "Source:" line.
      const zodFile = schemaIndex.pageFor(category, schemaName) || 'misc';

      if (!pages.has(zodFile)) pages.set(zodFile, []);
      pages.get(zodFile)!.push({ name: schemaName, content });
    }

    byCategory.set(category, pages);
  }

  return byCategory;
}

/**
 * Rewrite a source path referenced from JSDoc (`../automation/sync.zod.ts`) to
 * the docs route that renders it. Without this the generated page links to a
 * path that only exists in the repo, i.e. a 404 on the site.
 *
 * Always given a path WITH a category segment: `lib/file-description.ts`
 * completes a same-directory spelling from its `fromCategory` before calling in,
 * precisely so this stays the `<category>/<file>` lookup #4696 settled on and
 * never has to guess which `auth.zod.ts` an author meant.
 */
function sourcePathToDocsRoute(target: string): string | null {
  const m = target.match(/(?:^|\/)([\w-]+)\/([\w.-]+)\.zod\.ts$/);
  if (!m) return null;
  const [, category, zodFile] = m;
  if (!CATEGORIES[category]) return null;
  // A real category is not yet a page. This used to be the whole test, which
  // was survivable only because every path the old regex could match happened
  // to name a file with a page behind it. #6484 widened what reaches here to
  // include same-directory spellings, and FOUR of the nine name a neighbour
  // that does not exist at all — `identity/auth`, `system/audit`,
  // `system/compliance`, `system/masking`, all four long since removed. Under
  // the old test each would have become a confident link to a 404 (measured:
  // deleting this line puts exactly those four dead routes into the artifact).
  //
  // File existence is not the test either: seven `.zod.ts` sources publish no
  // page at all, their schemas being unrepresentable in JSON Schema. The test
  // is whether THIS run emits the page, which is what the map knows.
  if (!PAGES_BY_CATEGORY.get(category)?.has(zodFile)) return null;
  return `/docs/references/${category}/${zodFile}`;
}

// The module description a page opens with — WHICH doc block, and how it
// renders, both live in `lib/file-description.ts` (#5059). It used to be the
// first doc block anywhere in the file, which is a rule about ordering rather
// than about descriptions: six public pages opened with an internal comment
// because a helper happened to sit at the top of the file, and `check:docs`
// could not see it (the artifact reproduced the wrong block faithfully).

// `_zodFile` is passed by the caller and deliberately unread here: the file slug
// is a page-level fact, and every use of it (title, source link, card) lives in
// `generateZodFileMarkdown` around this call. Underscored rather than dropped so
// this touches one line of a renderer PR #6377 is editing (#5475).
//
// The section itself is rendered by `lib/schema-section.ts`, extracted at #7658
// for the reason `lib/format-type.ts` was at #4912: this file is a top-level
// script with side effects, so the only way to assert on a section used to be to
// run the whole generator and grep the emitted `.mdx` — and the defect #7658
// fixed was a section rendered as the EMPTY STRING, i.e. precisely the output
// grepping emitted pages cannot see. `scripts/schema-section.test.ts` pins it
// directly now.
function generateMarkdown(schemaName: string, schema: any, category: string, _zodFile: string) {
  return renderSchemaSection(schemaName, schema, { schemaHref: schemaHrefFrom(category) });
}

function generateZodFileMarkdown(zodFile: string, schemas: Array<{name: string, content: any}>, category: string): string {
  const zodTitle = zodFile.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  
  // Get source description
  const sourceRel = sourcePathFor(category, zodFile);
  const sourcePath = sourceRel ? path.join(REPO_ROOT, sourceRel) : undefined;
  let fileDesc = '';
  if (sourcePath && fs.existsSync(sourcePath)) {
      // `category` is what a path written relative to the module's own
      // directory is relative TO — without it the renderer cannot tell which
      // `auth.zod.ts` a neighbour reference means, and until #6484 it was never
      // told, so those references shipped as plain prose.
      fileDesc = renderFileDescription(fs.readFileSync(sourcePath, 'utf-8'), {
        fromCategory: category,
        sourcePathToDocsRoute,
      });
  }

  let md = `---\n`;
  md += `title: ${zodTitle}\n`;
  md += `description: ${zodTitle} protocol schemas\n`;
  md += `---\n\n`;
  md += `{/* ⚠️  AUTO-GENERATED — DO NOT EDIT. Run build-docs.ts to regenerate. Hand-written docs live in the module folders under content/docs/. */}\n\n`;
  
  if (fileDesc) {
      md += `${fileDesc}\n\n`;
  }
  
  // Only when there IS one — the `misc` catch-all has no file behind it, and a
  // reassembled `packages/spec/src/<category>/misc.zod.ts` points at nothing.
  if (sourceRel) {
    md += `<Callout type="info">\n`;
    md += `**Source:** \`${sourceRel}\`\n`;
    md += `</Callout>\n\n`;
  }
  
  // TypeScript usage example — spelled from the package's real export surface,
  // never from the schema file name. A name the entry point does not export is
  // dropped here and reported by the import-surface ratchet below, so the page
  // cannot advertise an import that fails to compile (#4570).
  const imports = resolveImports(category, schemas.map(s => s.name), ENTRY_SURFACES);
  for (const gap of imports.gaps) importGaps.add(gap);

  if (imports.valueNames.length || imports.typeNames.length) {
    md += `## TypeScript Usage\n\n`;
    md += `\`\`\`typescript\n`;
    if (imports.valueNames.length) {
      md += `import { ${imports.valueNames.join(', ')} } from '@objectstack/spec/${category}';\n`;
    }
    if (imports.typeNames.length) {
      md += `import type { ${imports.typeNames.join(', ')} } from '@objectstack/spec/${category}';\n`;
    }
    md += `\n`;
    if (imports.exampleValue) {
      md += `// Validate data\n`;
      md += `const result = ${imports.exampleValue}.parse(data);\n`;
    }
    md += `\`\`\`\n\n`;
    md += `---\n\n`;
  }

  // Generate markdown for each schema in the file
  schemas.forEach(({name, content}) => {
    md += generateMarkdown(name, content, category, zodFile);
    md += `\n---\n\n`;
  });

  return md;
}

/**
 * Reference-sidebar section grouping, per category. #1862 grouped each category's
 * `references/{cat}/meta.json` by hand, but `gen:docs` rewrites those files as a flat
 * alphabetical list on every run (in the docs production build), so the grouping was
 * silently lost. Owning it here makes it durable (#1880).
 *
 * A page is placed under the FIRST section that names it. The mapping degrades
 * gracefully: names that produce no page are ignored, and pages present on disk but
 * not named here still appear (sorted, under a trailing `More` separator) — so adding
 * or removing a schema never drops it from the sidebar. Categories with no entry keep
 * the legacy flat sorted list.
 */
const SECTION_GROUPS: Record<string, Array<{ section: string; pages: string[] }>> = {
  ai: [
    { section: 'Agents & Tools', pages: ['agent', 'tool', 'skill', 'solution-blueprint', 'mcp'] },
    { section: 'Knowledge & RAG', pages: ['knowledge-document', 'knowledge-source', 'embedding'] },
    { section: 'Models & Runtime', pages: ['model-registry', 'conversation', 'usage'] },
  ],
  // `http` / `core-services` / `package-registry` left this category at #4696:
  // all three were pages `api/` never had a `.zod.ts` for — the bare-name index
  // borrowed another category's slug for a re-exported or same-named schema.
  // Their sections moved to the api file that really exports them (`router`,
  // `discovery`, `protocol`). `buildCategoryPages` filters by what was emitted,
  // so leaving the names here would have been silently harmless — which is why
  // they are removed deliberately instead (same discipline as #4988 below).
  api: [
    { section: 'Contract & Routing', pages: ['protocol', 'contract', 'endpoint', 'router', 'registry', 'discovery', 'documentation', 'versioning', 'errors', 'batch'] },
    { section: 'Transport & Realtime', pages: ['http-cache', 'rest-server', 'websocket', 'realtime', 'realtime-shared', 'odata', 'query-adapter', 'dispatcher'] },
    { section: 'Service APIs', pages: ['auth', 'auth-endpoints', 'identity', 'metadata', 'metadata-plugin', 'automation-api', 'analytics', 'export', 'storage', 'notification', 'events', 'connector', 'package-api', 'plugin-rest-api'] },
  ],
  automation: [
    { section: 'Flow & Execution', pages: ['flow', 'control-flow', 'execution', 'node-executor', 'state-machine', 'time-relative-trigger'] },
    // `sync` (#4738, L1) and `etl` (#6414, L2) are both retired; `offline` went
    // with `ui/offline.zod.ts` (#4988). `buildCategoryPages` filters by what was
    // emitted, so leaving a dead name here is silently harmless — which is why
    // each is removed deliberately instead.
    { section: 'Integration & Data', pages: ['connector', 'webhook', 'bpmn-interop'] },
    { section: 'Approvals & Jobs', pages: ['approval', 'job'] },
  ],
  cloud: [
    { section: 'Environments & Packages', pages: ['environment', 'environment-artifact', 'environment-package', 'package', 'package-version', 'template-manifest', 'provisioning'] },
    { section: 'Marketplace & Distribution', pages: ['marketplace', 'marketplace-admin', 'app-store', 'developer-portal'] },
    { section: 'Tenancy & Security', pages: ['tenant', 'plugin-security'] },
  ],
  data: [
    { section: 'Objects & Fields', pages: ['object', 'field', 'validation', 'hook', 'hook-body', 'mapping'] },
    { section: 'Query & Analytics', pages: ['query', 'filter', 'data-engine', 'analytics', 'date-macros'] },
    // `external-lookup` retired whole at #8075 (ADR-0049) — `external-catalog`
    // is the surviving federated-external-data surface.
    { section: 'Datasources & Drivers', pages: ['datasource', 'driver', 'driver-sql', 'driver-nosql', 'external-catalog'] },
    { section: 'Documents & Seed', pages: ['document', 'seed', 'seed-loader', 'feed'] },
  ],
  integration: [
    // `connector-auth` removed at #4696 — `integration/` has no such file; the
    // five `ConnectorInstance*Auth` schemas reach this entry point through
    // `integration/connector.zod.ts`, and are documented there now.
    //
    // `mapping`, `translation`, `http`, `message-queue`, `object-storage`,
    // `offline`, `tenant` and `misc` never had a matching `.zod.ts` here
    // after #4480 removed the per-provider connector template files
    // (`connector/saas.zod.ts`, `connector/database.zod.ts`, file-storage,
    // message-queue, github, vercel) — the losing side of ADR-0023's
    // rejected per-system modelling; ADR-0097's answer is that provider
    // shapes come from the provider itself, not from the spec
    // (`integration/index.ts` records the six removed files). This
    // integration `message-queue` is that connector-template entry, not the
    // `system` category's own `message-queue.zod.ts` (#8075). `connector` is
    // the only module `integration/` has ever emitted a page for.
    // `buildCategoryPages` filters by what was emitted, so leaving these dead
    // names here would have been silently harmless — which is why they are
    // removed deliberately instead (#8166).
    { section: 'Connectors', pages: ['connector'] },
  ],
  kernel: [
    { section: 'Plugin Lifecycle', pages: ['plugin', 'plugin-lifecycle-events', 'plugin-lifecycle-advanced', 'plugin-runtime', 'plugin-loading', 'plugin-registry', 'plugin-structure', 'plugin-validator'] },
    { section: 'Plugin Security & Dependencies', pages: ['plugin-security', 'plugin-security-advanced', 'plugin-capability', 'plugin-versioning', 'dependency-resolution', 'manifest'] },
    { section: 'Packages', pages: ['package-artifact', 'package-registry', 'package-upgrade'] },
    { section: 'Metadata & Runtime', pages: ['metadata-plugin', 'metadata-loader', 'metadata-customization', 'metadata-protection', 'metadata-persistence', 'misc', 'context', 'execution-context', 'service-registry', 'startup-orchestrator', 'cluster', 'feature', 'cli-extension', 'dev-plugin', 'state-machine'] },
  ],
  system: [
    { section: 'Config & Settings', pages: ['settings-manifest', 'settings-client', 'registry-config', 'auth-config', 'email-config', 'email-template', 'license', 'migration', 'deploy-bundle', 'environment-artifact', 'app-install', 'provisioning', 'tenant'] },
    // `metadata-loader` removed at #4696 — that file lives in `kernel/`, and the
    // two schemas `system/` re-exports from it are documented on
    // `system/metadata-persistence`, the file that re-exports them.
    // `message-queue` retired whole at #8075 (ADR-0049) — the live MQ surface
    // is kernel's `EventMessageQueueConfig`, documented with the event bus.
    { section: 'Services & Infrastructure', pages: ['core-services', 'http-server', 'cache', 'object-storage', 'search-engine', 'worker', 'job', 'notification', 'translation', 'metadata-persistence'] },
    { section: 'Observability', pages: ['logging', 'metrics', 'tracing', 'audit'] },
    { section: 'Security & Compliance', pages: ['encryption', 'security-context', 'incident-response', 'supplier-security', 'disaster-recovery', 'change-management', 'training'] },
    { section: 'Content & Collaboration', pages: ['doc', 'book', 'collaboration'] },
  ],
  ui: [
    // `action-params` sits beside `action` deliberately: it is the same
    // surface's RUNTIME half (the `ctx.session` contract an action body reads,
    // #5697), and a reader who found the action declaration should find what a
    // body receives in the same section rather than under "More".
    { section: 'Apps & Navigation', pages: ['app', 'page', 'view', 'action', 'action-params'] },
    // `expression-bindable-text-keys` sits beside `component` deliberately: it
    // is the SDUI rendering contract's evaluation vocabulary (objectui#4795
    // Direction 1 — which top-level text keys the renderer's expression memo
    // evaluates, per component type), and a reader who found the component
    // prop schemas should find it in the same section rather than under "More".
    { section: 'Visualization', pages: ['chart', 'dashboard', 'dataset', 'report', 'widget', 'component', 'expression-bindable-text-keys'] },
    // `animation` / `dnd` / `keyboard` / `touch` / `offline` left this section at
    // #4988: the five `ui/` interaction config modules were retired whole
    // (ADR-0049 — no carrier key, nothing parsed them), and their generated
    // pages went with them. `buildCategoryPages` filters by what was emitted, so
    // leaving the names here would have been silently harmless — which is why
    // they are removed deliberately instead.
    { section: 'Interaction & Layout', pages: ['responsive', 'theme'] },
    // `http` removed at #4696 — `ui/` has no `http.zod.ts`; `HttpMethod` and
    // `HttpRequest` reach this entry point through `ui/view.zod.ts`, whose own
    // file comment already says so ("Migrated to shared/http.zod.ts.
    // Re-exported here…"), and are documented on `ui/view` now.
    { section: 'Platform', pages: ['i18n', 'notification', 'sharing'] },
  ],
};

/**
 * Build a category's `meta.json` `pages` array. With a SECTION_GROUPS entry, emit
 * fumadocs `"---Section---"` separators around the grouped pages; otherwise fall back
 * to the legacy flat alphabetical list. `emitted` is the set of pages that actually
 * produced a reference file this run.
 */
function buildCategoryPages(category: string, emitted: string[]): string[] {
  const groups = SECTION_GROUPS[category];
  if (!groups) return [...emitted].sort();

  const present = new Set(emitted);
  const used = new Set<string>();
  const out: string[] = [];

  for (const { section, pages } of groups) {
    const inSection = pages.filter(p => present.has(p) && !used.has(p)).sort();
    if (inSection.length === 0) continue;
    out.push(`---${section}---`);
    for (const p of inSection) { out.push(p); used.add(p); }
  }

  // Pages on disk that no section claimed still appear — never drop a page. Only
  // label them when something above was grouped; a lone "More" over an otherwise
  // ungrouped category would read oddly, so degrade to a flat list in that case.
  const leftover = emitted.filter(p => !used.has(p)).sort();
  if (leftover.length) {
    if (out.length) out.push('---More---');
    out.push(...leftover);
  }
  return out;
}

// ── Root index prose (#4759) ─────────────────────────────────────────────────
//
// The rot this ends, and why every column is enumerated rather than asserted,
// is written down once in `lib/root-index.ts`. What lives here is the prose the
// page still needs — in reviewed generator source, the same treatment the
// category `index.mdx` pages' intro sentences already get, and the reason this
// file grows no preserve/marker mechanism: hand-written text preserved inside
// `content/docs/references/` would recreate the ownerless state #4759 is about.

const ROOT_INDEX_INTRO =
  'This is the complete reference for every protocol schema published by `@objectstack/spec`. ' +
  'Each protocol is defined as a **Zod schema** (Prime Directive #1), which is where its runtime ' +
  'validation, its TypeScript type and its JSON Schema all come from.\n';

/**
 * One line per category, keyed by the `src/` directory name — the only
 * hand-written prose in the index's tables, and deliberately per-CATEGORY:
 * `blurbCoverage` holds this map to exactly the categories that have pages, in
 * both directions. A per-FILE purpose map (201 entries today) could not be held
 * to anything but existence, so it would be the same unverifiable hand-kept
 * prose that rotted the old table, merely moved into TypeScript.
 */
const CATEGORY_BLURBS: Record<string, string> = {
  ai: 'Agents, tools, skills, RAG and knowledge sources, model registry, conversations.',
  api: 'REST/GraphQL contracts, endpoints, routing, realtime, batch, discovery.',
  automation: 'Flows and their nodes, approvals, ETL pipelines, webhooks, state machines, execution records.',
  cloud: 'Environments, packages and versions, marketplace, developer portal, tenancy.',
  data: 'Objects, fields, queries, filters, datasources and drivers — the ObjectQL layer.',
  // "API keys" deliberately absent since #8715: the sys_api_key table is
  // declared by @objectstack/platform-objects, not by a spec identity schema.
  identity: 'Users and accounts, organizations, positions, SCIM provisioning.',
  integration: 'The single connector protocol (ADR-0097) — catalog descriptors and provider-bound instances.',
  kernel: 'Plugin lifecycle and manifests, capabilities and security, metadata loading, service registry.',
  qa: 'Declarative test suites — scenarios, steps, actions and assertions.',
  security: 'Permission sets, row-level security, sharing rules, tenancy posture.',
  shared: 'Primitives used across every protocol — identifiers, HTTP, expressions, error maps, enums.',
  studio: 'Studio designer metadata — the authoring surfaces for the protocols above.',
  system: 'The runtime environment — logging, jobs, cache, metrics, notifications, i18n and compliance.',
  ui: 'Apps, pages, views, dashboards, reports, actions and themes — the ObjectUI layer.',
};

const ROOT_INDEX_CONVENTIONS =
  '## Schema Conventions\n\n' +
  '### Naming\n\n' +
  '- **Configuration keys (TypeScript props):** `camelCase` — `maxLength`, `referenceFilters`\n' +
  '- **Machine names (data values):** `snake_case` — `name: \'project_task\'`, `object: \'account\'`\n' +
  '- **Metadata type names:** singular — `\'view\'`, `\'flow\'`, `\'agent\'`\n\n' +
  '### Validation\n\n' +
  '- Every schema is a Zod schema; TypeScript types are inferred with `z.infer<typeof Schema>`\n' +
  '- JSON Schemas are generated from the Zod sources, so IDE completion and the docs cannot drift apart\n\n' +
  '### Usage\n\n' +
  '```typescript\n' +
  "import { ObjectSchema } from '@objectstack/spec/data';\n\n" +
  '// Runtime validation\n' +
  'const result = ObjectSchema.safeParse(objectDefinition);\n' +
  '```\n\n' +
  'Each module is importable on its own subpath (`@objectstack/spec/<module>`); every reference page\n' +
  'shows the exact import line for the schemas it documents.\n';

// Both cards point at pages that exist — asserted below, because the two this
// section replaced (`getting-started/architecture`, `guides/cheatsheets/quick-reference`)
// did not, and nothing noticed.
const ROOT_INDEX_NEXT_STEPS =
  '## Next Steps\n\n' +
  '<Cards>\n' +
  '  <Card\n' +
  '    href="/docs/getting-started/glossary"\n' +
  '    title="Glossary"\n' +
  '    description="Key terminology across all protocol namespaces"\n' +
  '  />\n' +
  '  <Card\n' +
  '    href="/docs/deployment/cli"\n' +
  '    title="CLI Guide"\n' +
  '    description="Validate, compile, and generate metadata"\n' +
  '  />\n' +
  '</Cards>\n';

const CONTENT_DOCS_ROOT = path.resolve(REPO_ROOT, 'content/docs');

/**
 * Which of the index's internal `/docs/...` links resolve to no page.
 *
 * A page counts as existing when it is on disk OR emitted by this run: the
 * reference pages the tables link to are this run's own output, and under
 * `--check` nothing is written, so reading only the disk would make the check
 * disagree with the write it models.
 */
function deadDocLinks(mdx: string): string[] {
  return docLinkTargets(mdx).filter(target => {
    const rel = target.replace(/^\/docs\/?/, '');
    const candidates = [
      path.join(CONTENT_DOCS_ROOT, `${rel}.mdx`),
      path.join(CONTENT_DOCS_ROOT, rel, 'index.mdx'),
    ];
    return !candidates.some(p => fs.existsSync(p) || wasEmitted(p));
  });
}

// === EXECUTION ===

console.log('Building documentation...');

/**
 * The page inventory, built before anything is rendered.
 *
 * It has to exist before the first `renderFileDescription` call, because that
 * is where `sourcePathToDocsRoute` is asked whether a referenced neighbour has
 * a page — an answer no partially-filled sink could give.
 */
const PAGES_BY_CATEGORY = groupSchemasByPage();

/** Categories that had schemas to regenerate from — drives the flush() guard. */
let managedCount = 0;

// 1. Clean existing category folders from DOCS_ROOT — but only when there are
// JSON schemas to regenerate from. Otherwise we'd silently delete every .mdx
// file when the upstream `gen:schema` step produced nothing (data loss).
Object.keys(CATEGORIES).forEach(category => {
  const dir = path.join(DOCS_ROOT, category);
  const schemaDir = path.join(SCHEMA_DIR, category);
  const hasSchemas = fs.existsSync(schemaDir)
    && fs.readdirSync(schemaDir).some(f => f.endsWith('.json'));
  if (!hasSchemas) {
    if (fs.existsSync(dir)) {
      // NOT "run gen:schema first" any more: the freshness guard at the top of
      // this file has already proved the tree is newer than src, so this is the
      // steady state for a category whose schemas are all unrepresentable in JSON
      // Schema (`contracts/` is the standing example) — the old line sent readers
      // after a regeneration that would change nothing (#4723).
      console.warn(`⚠ Skipping clean of ${category}/ — this build published no JSON Schema under ${schemaDir}; leaving its pages as they are.`);
    }
    return;
  }
  manageDir(dir);
  managedCount++;
});

// 2. Generate Files
// Clear DOCS_ROOT first to remove old flattened files
if (fs.existsSync(DOCS_ROOT)) {
    // We want to preserve 'index.mdx', 'meta.json' (root one we will rewrite), etc?
    // Safer to just overwrite. 
    // fs.rmSync(DOCS_ROOT, { recursive: true, force: true });
    // But verify we don't kill the manual files.
}

// The grouping is `PAGES_BY_CATEGORY`'s, not a second one computed here: the
// page a schema lands on decides both what this loop writes and what
// `sourcePathToDocsRoute` calls a live route, and two enumerations of that could
// disagree — the same discipline §2.6 already applies to the root index.
PAGES_BY_CATEGORY.forEach((zodFileSchemas, category) => {
  const categoryDir = path.join(DOCS_ROOT, category);

  // Generate file
  zodFileSchemas.forEach((schemas, zodFile) => {
    const fileName = `${zodFile}.mdx`;
    const mdx = generateZodFileMarkdown(zodFile, schemas, category);
    emit(path.join(categoryDir, fileName), mdx);
  });

  // Hand the same grouping to the root index — never a second enumeration.
  categoryPageSchemas.set(
    category,
    new Map([...zodFileSchemas].map(([zodFile, schemas]) => [zodFile, schemas.map(s => s.name).sort()])),
  );

  // Generate Category Meta. Group into fumadocs `---Section---` separators when the
  // category has a SECTION_GROUPS entry; otherwise a flat sorted list (see #1880).
  const pages = buildCategoryPages(category, Array.from(zodFileSchemas.keys()));

  // A category that published no page gets no `meta.json` — and so no directory
  // at all — the same way §2.5 below skips the `index.mdx` of one. What this
  // guard removes is a folder holding a single `{ "pages": [] }`: no page, no
  // `index.mdx`, and no entry in the root `meta.json`, so it is unroutable, and
  // invisible to the link checker. Its one measurable effect was that anyone
  // enumerating the tree counted one category more than exists — which is how
  // #7303 came to be filed.
  //
  // `contracts/` is the case: it holds TypeScript service interfaces rather than
  // `.zod.ts` schemas, so `gen:schema` creates `json-schema/contracts/` and
  // leaves it empty; unlike `conversions`/`migrations` (no schema directory at
  // all, so `groupSchemasByPage` skips them outright) it reaches this loop with
  // zero pages. The guard is on the pages, not on that asymmetry, so any future
  // category in either shape lands the same way.
  if (pages.length === 0) return;

  const meta = {
    title: CATEGORIES[category],
    pages
  };
  emit(path.join(categoryDir, 'meta.json'), JSON.stringify(meta, null, 2));
});

// 2.5 Generate Category Overviews (index.mdx in each folder)
Object.entries(CATEGORIES).forEach(([category, title]) => {
  const zodFiles = categoryZodFiles.get(category) || new Set<string>();
  if (zodFiles.size === 0) return;

  let mdx = `---\n`;
  mdx += `title: ${title}\n`;
  mdx += `description: Complete reference for all ${title.toLowerCase()} schemas\n`;
  mdx += `---\n\n`;
  
  mdx += `This section contains all protocol schemas for the ${category} layer of ObjectStack.\n\n`;
  
  mdx += `<Cards>\n`;
  Array.from(zodFiles).sort().forEach(zodFile => {
      // Only card zod files that actually produced a reference page. A
      // `.zod.ts` whose schemas are all unrepresentable in JSON Schema — e.g.
      // they embed a transform (the ADR-0031 control-flow constructs and the
      // Flow edge schema carry CEL-expression transforms) — generates no page,
      // so carding it would be a dangling 404 link. This aligns the index with
      // `meta.json`, which already lists only generated pages.
      //
      // Asks the sink, not the disk: this run's own output is the authority on
      // what pages exist. (Equivalent on disk, since the folder was just wiped
      // and rewritten — but it stays correct under --check, where nothing is
      // written and the stale files are still lying around.)
      if (!wasEmitted(path.join(DOCS_ROOT, category, `${zodFile}.mdx`))) return;
      const fileTitle = zodFile.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      const cardSource = sourcePathFor(category, zodFile);
      // Link relative to the category folder (where index.mdx lives)
      mdx += `  <Card href="/docs/references/${category}/${zodFile}" title="${fileTitle}"${cardSource ? ` description="Source: ${cardSource}"` : ''} />\n`;
  });
  mdx += `</Cards>\n`;

  // Fumadocs treats folder/index.mdx as the page for the folder, so this is what
  // makes /docs/references/<category> resolve.
  emit(path.join(DOCS_ROOT, category, 'index.mdx'), mdx);
});

// 2.6 Generate the root index — the protocol master table (#4759).
//
// Every cell is rendered from `categoryPageSchemas`, i.e. from the same
// grouping that decided which pages exist two steps ago, so a deleted
// `.zod.ts` cannot leave a row behind and a name that is not a published
// schema cannot appear. See `lib/root-index.ts` for the rot this replaces.
if (managedCount > 0) {
  // Claim the two root-level files this generator owns — and ONLY those, which
  // is what `owns` is for: root-level hand-written `.mdx` (an
  // `implementation-status.mdx` and the like) stays untouched, and the category
  // sub-trees are already managed above.
  //
  // Without this claim the index would be checked only while it is emitted:
  // delete the `emit()` below and `check:docs` goes green again at one file
  // fewer, which is precisely how this page spent its life outside every gate.
  // Owned means a run that stops generating it reports it as stale instead.
  const ROOT_OWNED = new Set([
    path.join(DOCS_ROOT, 'index.mdx'),
    path.join(DOCS_ROOT, 'meta.json'),
  ]);
  manageDir(DOCS_ROOT, p => ROOT_OWNED.has(p));

  const indexCategories: RootIndexCategory[] = [...categoryPageSchemas].map(([category, pages]) => ({
    category,
    title: CATEGORIES[category],
    pages: [...pages].map(([slug, schemas]) => ({
      slug,
      sourceRel: zodFileSourceRel.get(`${category}/${slug}`),
      schemas,
    })),
  }));

  const coverage = blurbCoverage(indexCategories, CATEGORY_BLURBS);
  if (coverage.missing.length > 0 || coverage.extra.length > 0) {
    console.error(`\n✗ ${formatBlurbCoverage(coverage)}`);
    process.exit(1);
  }

  const rootIndex = renderRootIndex({
    categories: indexCategories,
    blurbs: CATEGORY_BLURBS,
    prose: {
      intro: ROOT_INDEX_INTRO,
      conventions: ROOT_INDEX_CONVENTIONS,
      nextSteps: ROOT_INDEX_NEXT_STEPS,
    },
  });

  const dead = deadDocLinks(rootIndex);
  if (dead.length > 0) {
    console.error(
      `\n✗ The root reference index links to ${dead.length} page(s) that do not exist:\n\n` +
        dead.map(d => `    • ${d}`).join('\n') +
        `\n\nThese come from the hand-written prose constants in this file — the generated tables\n` +
        `cannot invent a target. Repoint the link at the page that replaced it, or drop it: two\n` +
        `dead "Next Steps" cards sat on this page for months because nothing looked (#4759).`,
    );
    process.exit(1);
  }

  emit(path.join(DOCS_ROOT, 'index.mdx'), rootIndex);
}

// 3. Update root meta.json
// Collect categories that have actual generated content (non-empty zod files)
const categoryDirs = Object.keys(CATEGORIES)
  .filter(cat => {
    const zodFiles = categoryZodFiles.get(cat);
    return zodFiles && zodFiles.size > 0;
  })
  .sort();

// Collect other root files (if any exist, like implementation-status.mdx).
// Root-level .mdx is hand-written and never generated, so this reads the disk in
// both modes — it is an input to the sidebar, not part of the emitted tree.
const rootFiles = fs.readdirSync(DOCS_ROOT)
  .filter(f => f.endsWith('.mdx') && !f.startsWith('index')) // Exclude index.mdx if it exists?
  .map(f => f.replace('.mdx', ''))
  .filter(f => !categoryDirs.includes(f)); // Exclude if it's a category name (unlikely if they are folders)

const pages = [
  ...categoryDirs,
  ...rootFiles.sort()
];

const meta = {
  title: "Reference",
  icon: "FileCode",
  // One collapsible group in the single-tree sidebar (module-based IA); it must
  // NOT be a root tab — the whole docs tree renders as one sidebar.
  pages: pages
};
emit(path.join(DOCS_ROOT, 'meta.json'), JSON.stringify(meta, null, 2));

// 4. Import-surface ratchet — the backstop `check:docs` alone cannot be.
//
// Diffing generated output against committed docs proves the two agree; it
// cannot prove either is TRUE. Now that import examples are spelled from
// `api-surface/`, a schema whose type alias is missing quietly loses its
// name from the `import type` line — correct output, silent regression. The
// baseline turns that silence into a red gate: a NEW gap fails (that is #4539
// exactly — deleting a zero-consumer type alias while its schema keeps its
// page), and a stale line fails too, so the ledger can only shrink.
//
// Deliberately NOT wired into any `gen:` script: `--update-import-baseline` is
// a hand-run, reviewed act, for the same reason the dual-source baseline is
// (#4446) — a fix command that rewrites the ledger admits new debt by reflex
// instead of by decision.
//
// Runs BEFORE flush() because flush() exits on drift, and one failure must not
// hide the other. The exit is deferred to after flush() so a write run still
// produces the corrected pages.
let importSurfaceFailed = false;
if (managedCount > 0) {
  const gaps = [...importGaps].sort();

  if (UPDATE_IMPORT_BASELINE) {
    // Serialized through the lib, never inline: the same function is what the
    // round-trip pin in `docs-import-surface.test.ts` re-serializes the
    // committed file with, so this writer and that file cannot drift into two
    // encodings again (#5990).
    fs.writeFileSync(IMPORT_BASELINE_PATH, serializeImportBaseline(gaps));
    console.log(`Wrote ${gaps.length} import-surface gap(s) to ${path.relative(REPO_ROOT, IMPORT_BASELINE_PATH)} — review the diff before committing.`);
  } else {
    const baseline: { entries?: string[] } = fs.existsSync(IMPORT_BASELINE_PATH)
      ? JSON.parse(fs.readFileSync(IMPORT_BASELINE_PATH, 'utf-8'))
      : {};
    const { fresh, stale } = evaluateBaseline(gaps, baseline.entries ?? []);

    if (fresh.length > 0) {
      importSurfaceFailed = true;
      console.error(
        `\n✗ ${fresh.length} reference page import example(s) name an export that '@objectstack/spec' no longer has:\n\n` +
          fresh.map(f => `    • ${f}`).join('\n') +
          `\n\nThe name was dropped from the page rather than published as a dead import, so the docs are\n` +
          `still correct — but a schema that documents itself without its type alias is a hole in the\n` +
          `machine-readable surface, and the import line is the line an AI metadata author copies.\n\n` +
          `Fix it at the declaration, not the ledger:\n` +
          `  - add the missing alias next to the schema (\`export type X = z.infer<typeof XSchema>;\`),\n` +
          `    then \`pnpm --filter @objectstack/spec gen:api-surface\`; or\n` +
          `  - retire the schema with its alias, so no page documents it either.\n\n` +
          `If a maintainer decides the gap must stand, re-ratchet it deliberately:\n` +
          `  pnpm --filter @objectstack/spec exec tsx scripts/build-docs.ts --update-import-baseline`,
      );
    }

    if (stale.length > 0) {
      importSurfaceFailed = true;
      console.error(
        `\n✗ ${stale.length} stale import-surface baseline entr${stale.length === 1 ? 'y' : 'ies'} — the gap is gone, delete the line(s):\n\n` +
          stale.map(s => `    • ${s}`).join('\n') +
          `\n\nThe baseline is shrink-only. A stale line stays available to excuse the NEXT missing export\n` +
          `under the last one's justification, which is how a ratchet quietly stops ratcheting.\n` +
          `  pnpm --filter @objectstack/spec exec tsx scripts/build-docs.ts --update-import-baseline`,
      );
    }

    if (!importSurfaceFailed) {
      console.log(`✅ import examples resolve against ${API_SURFACE_DIR_NAME}/ (${gaps.length} accepted gap(s) in the baseline)`);
    }
  }
}

// 5. Disposition: write the tree, or report drift against it.
flush({
  surface: 'content/docs/references/',
  regenerate:
    '  pnpm --filter @objectstack/spec gen:schema && pnpm --filter @objectstack/spec gen:docs\n' +
    '  git add content/docs/references',
  // Backstop to the freshness guard at the top of this file. That one catches the
  // common shape — an absent or stale tree — before a single page is rendered.
  // This one catches what mtimes cannot see: a tree that is NEWER than src and
  // still has no category with schemas in it (a truncated or half-written
  // generation). Either way "nothing differs" must never read as success — green
  // while checking no pages is the silent shape this whole file guards against.
  // `check:docs` no longer regenerates for you, deliberately: that first step is
  // what made a check repair two tracked projections (#4711, #4723).
  guard: () =>
    managedCount === 0
      ? `No JSON schemas found under ${path.relative(REPO_ROOT, SCHEMA_DIR)} — nothing to check against.\n` +
        '  The tree is newer than packages/spec/src but published no category, which means a\n' +
        '  partial generation. Run `pnpm --filter @objectstack/spec gen:schema` again.'
      : null,
});

// Deferred so a write run still lands the corrected pages before failing.
if (importSurfaceFailed) process.exit(1);
