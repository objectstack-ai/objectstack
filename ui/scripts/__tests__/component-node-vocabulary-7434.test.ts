import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The documented name for "a component node" is `BaseSchema` (objectui#7434,
 * maintainer ruling 2026-09-06, option 1).
 *
 * ## What this pin is for
 *
 * objectui#7082 corrected nine rows where authored docs called the generic
 * protocol node `ComponentSchema` -- a name that never meant the generic
 * concept. It was the block family's narrow `type: 'component'` kind, and
 * objectui#4895 retired that family outright. The rows regrew, because
 * #7082 fixed SITES while the vocabulary gap stayed open: an author naming
 * "a component node" had three candidates and no ruling.
 *
 * That recurrence is the whole argument for a pin rather than another sweep.
 * The sharpest instance: the reference in `scripts/check-doc-snippet-types.mjs`
 * was that gate's own POSITIVE CONTROL, so retiring the family made the gate
 * exit 2 with "HARNESS CONTROL FAILED -- no verdict about the documents can be
 * read from this run". A vocabulary gap took out a gate's control group; the
 * run reported nothing about any document at all.
 *
 * The two banned spellings, and why each is banned:
 *
 * - `UIComponent` -- what AGENTS.md's topology table calls the shape, but it
 *   is NOT EXPORTED by `@object-ui/types` (0 files under `packages/types/src`,
 *   against 101 for `BaseSchema`, so that zero is a real zero and not a dead
 *   grep). A doc teaching it teaches an identifier no reader can import or
 *   type-check. Option 2 of the ruling -- minting the export -- was declined:
 *   a public-surface widening for a word.
 * - `ComponentSchema` in the GENERIC sense -- retired with the block family.
 *
 * ## The distinction this pin must not flatten
 *
 * `SchemaNode` is NOT interchangeable with `BaseSchema` and this pin does not
 * push anyone toward it. `SchemaNode` is
 * `BaseSchema | string | number | boolean | null | undefined`
 * (`packages/types/src/base.ts:483`); `BaseSchema` is exactly the OBJECT half.
 * Renderers that narrow a slot before reading keys -- e.g.
 * `packages/components/src/renderers/feedback/empty.tsx:37`,
 * `actionSchema && typeof actionSchema === 'object'` -- drop the primitive
 * members on the floor, so the union is wrong for a node-slot position.
 * Where the union IS genuinely correct (`content/docs/guide/layout.md`),
 * `SchemaNode` stays. Neither name is asserted absent here: only the two
 * spellings that name nothing real are.
 *
 * ## Why the boundary is `\b` and not a substring test
 *
 * Seven legitimate compound symbols live on this surface --
 * `AppComponentSchema`, `DashboardComponentSchema`, `MyComponentSchema`,
 * `PageComponentSchema`, `ReportComponentSchema`, `ThemeComponentSchema`,
 * `AnyComponentSchema`. Each is a real, distinct type; a substring scan would
 * flag all seven and the natural repair would be to weaken the scan until it
 * missed the thing it exists to catch. A leading `\b` excludes them
 * structurally: in `AppComponentSchema` there is no word boundary before `C`.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The scan surface: the authored teaching surfaces where an author looks up
 * the name of a concept.
 *
 * ⛔ Deliberately EXCLUDED, and the exclusions are load-bearing:
 * - `docs/audits/**` and the repo-root `docs/**` -- historical audit records,
 *   not teaching surfaces, and out of every doc gate's scan surface today
 *   (objectui#7856). `docs/audits/2026-08-zod-to-json-schema-fidelity.md`
 *   carries a verbatim historical symbol list that legitimately contains
 *   `ComponentSchema`; that list is a record of what the repo once exported,
 *   and rewriting history to satisfy a vocabulary pin would be a lie.
 * - `AGENTS.md` -- governed surface, repaired in this card's PR B by the
 *   `domain:skills` seat. Adding it here would red this pin on `main` until
 *   that separate, human-merged PR lands.
 */
const DOCS_ROOT = 'content/docs';
const DOC_EXTENSIONS = ['.md', '.mdx'];

/**
 * Reasoned exemptions, by repo-relative path, each with the sentence that
 * earns it. EMPTY TODAY and that is the honest state: the surface has no
 * legitimate use of either banned spelling.
 *
 * ⛔ If a real one appears -- a tombstone sentence naming the retired symbol,
 * say -- add it HERE with its reason. ⛔ Never widen the regex: the regex is
 * the thing that works, and an entry with a reason stays reviewable while a
 * loosened pattern silently stops catching the class.
 */
const ALLOWED: Record<string, string> = {};

/** Every `.md` / `.mdx` under `content/docs`, plus each `packages/<name>/README.md`. */
function scanSurface(): string[] {
  const out: string[] = [];

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (DOC_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(rel);
    }
  };
  walk(DOCS_ROOT);

  for (const entry of fs.readdirSync(path.join(repoRoot, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rel = `packages/${entry.name}/README.md`;
    if (fs.existsSync(path.join(repoRoot, rel))) out.push(rel);
  }

  return out.filter((rel) => !(rel in ALLOWED)).sort();
}

const BANNED: Array<{ name: string; pattern: RegExp; why: string }> = [
  {
    name: 'UIComponent',
    pattern: /\bUIComponent\b/g,
    why: 'not exported by @object-ui/types -- a reader cannot import or type-check it',
  },
  {
    name: 'ComponentSchema (generic sense)',
    pattern: /\bComponentSchema\b/g,
    why: 'the retired block-family kind (objectui#4895), never the generic node',
  },
];

describe('the documented name for "a component node" is `BaseSchema` (objectui#7434)', () => {
  const surface = scanSurface();
  const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

  /**
   * ⭐ The live control, and it runs FIRST. Every assertion below is an
   * ABSENCE, and an absence is unreadable from a scan that reached nothing:
   * a walk that silently returned [] -- a moved directory, a renamed
   * extension -- renders as a clean green sweep, indistinguishable from a
   * surface that is genuinely clean. So the surface must be populated AND a
   * word that must hit has to actually hit.
   */
  it('control: the surface is populated and a must-hit word fires on it', () => {
    expect(surface.length).toBeGreaterThan(50);
    expect(surface).toContain('packages/types/README.md');
    expect(surface).toContain('content/docs/api/schema-reference.md');

    const withBaseSchema = surface.filter((rel) => /\bBaseSchema\b/.test(read(rel)));
    expect(withBaseSchema.length).toBeGreaterThan(0);

    // The page that carries the definitional statement must be one of them.
    expect(withBaseSchema).toContain('content/docs/api/schema-reference.md');
  });

  it.each(BANNED)('no `$name` survives on the authored surface', ({ pattern, why }) => {
    const hits: string[] = [];

    for (const rel of surface) {
      const lines = read(rel).split('\n');
      lines.forEach((line, i) => {
        if (new RegExp(pattern.source).test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }

    expect(hits, `${why}. Use \`BaseSchema\`. Offending lines:\n${hits.join('\n')}`).toEqual([]);
  });

  /**
   * Counter-probe: the matcher above can still fail. Without this, a regex
   * broken into never matching (or a `\b` that swallowed the class) would
   * report the same green as a clean surface.
   */
  it('counter-probe: the matcher fires on the residue it was built to catch, and spares the compounds', () => {
    const residue = 'UIComponent                         <- Base interface for all UI components';
    expect(/\bUIComponent\b/.test(residue)).toBe(true);
    expect(/\bComponentSchema\b/.test('type: ComponentSchema')).toBe(true);

    // The seven real compound symbols must NOT be caught.
    for (const compound of [
      'AppComponentSchema',
      'DashboardComponentSchema',
      'MyComponentSchema',
      'PageComponentSchema',
      'ReportComponentSchema',
      'ThemeComponentSchema',
      'AnyComponentSchema',
    ]) {
      expect(/\bComponentSchema\b/.test(compound)).toBe(false);
    }
  });
});
