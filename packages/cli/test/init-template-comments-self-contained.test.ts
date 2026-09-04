// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Every comment that ships into a project this package scaffolds must be
// followable by the person reading it — someone who has that project and
// nothing else. This package has TWO scaffolders and both ship such text,
// so both are swept: `objectstack init` and `objectstack create`.
//
// ## The defect
//
// `packages/cli/src/commands/init.ts` renders its templates as string
// literals (`TEMPLATES[key].configContent` / `.srcFiles`) and writes them
// straight into the user's project. Five of those literals carried ADR
// identifiers — `ADR-0087` and `ADR-0090 D1` — addressed to a reader with
// this monorepo open. A project scaffolded by `os init` ships no
// `docs/adr/`, so the identifier named something the reader could not look
// up. This is the same defect class #10324 fixed in `create-objectstack`'s
// bundled template *files*; this is the OTHER scaffolder, which renders its
// templates as in-source string literals instead.
//
// ## Why the population spans BOTH scaffolders
//
// `packages/cli/src/commands/create.ts` exports a second, independent
// template map (`templates`) whose entries render text — an
// `objectstack.config.ts`, a plugin `src/index.ts`, a `README.md` — as
// in-source string literals and write them straight into the user's
// project. Same emitter shape, same population: text a scaffolded project
// actually receives. While this pin read only `init`'s map, its three
// assertions held for `init` only, and an edit to a `create` literal that
// cited an ADR or linked a docs page that later moved shipped to every
// `os create` user with every gate green. So the population is DERIVED
// from both maps — never written down — the way
// `scaffold-manifest-schema.test.ts` derives its own sweep: a template
// added to either map is swept the day it is added, with nobody
// remembering to extend this file.
//
// `create` has no `configContent` / `srcFiles` split. Every file it writes
// lives in one `files` map keyed by the path it lands at and is rendered by
// calling that entry, so this pin renders EVERY entry and serialises each
// one exactly the way `Create.run()` does (a string verbatim, anything else
// through `JSON.stringify(_, null, 2)`). Sweeping the whole map rather than
// a chosen subset is deliberate: a filter is a place a future file can
// escape through silently, which is the shape of the defect above.
//
// ## Why the population is the RENDERED output, not the source file
//
// `init.ts` also carries its own ordinary source comments that legitimately
// cite ADRs and issue numbers (e.g. the `printCreatedFilesSummary` doc
// comment cites #10499) — those never ship, because they live outside the
// `configContent` / `srcFiles` functions the command actually writes to
// disk. `create.ts` is the same: its `run()` body cites `packages/plugins`
// as a destination directory, which ships nowhere. A pin that grepped
// either source file wholesale would match those too and report on the
// wrong population. So this pin does not read the source files at all: it
// calls the exact functions each command calls
// (`template.configContent(...)`, `writeTemplateSrcFiles(...)`, and for
// `create` the entries of `template.files`) and scans the files they
// actually write — the same real emitters
// `init-scaffold-authoring-rules.test.ts` and
// `scaffold-manifest-schema.test.ts` use, for the same reason (so no test
// can drift from what the commands really do).
//
// ## Why this pin has TWO halves, and why the second is the load-bearing one
//
// The cheap way to make the references disappear is to delete the
// comments. That would ship a worse project than one with the dead
// references: the comments explain WHY `sharingModel` and `engines.protocol`
// are the way they are — exactly what a newcomer deciding whether to change
// them needs. A one-way "no ADR identifiers" grep would stay green while
// the rationale is deleted out from under it. Hence: no unfollowable
// reference (assertion 1) AND the fact each comment carries still stated
// (assertion 2). A future reword is free; silently stripping the
// explanation, or reintroducing a dead end, is not.
//
// ## The third half: a public link is only a fix while it resolves
//
// The two docs URLs the rewrite links (upgrading, permissions/sharing-rules)
// are only a fix while they resolve. Assertion 3 checks every
// canonical-origin docs URL in the rendered output against the docs content
// tree the way Fumadocs routes it. The candidate-route logic is restated
// here rather than imported from check-published-readme-links' own module
// (which owns the canonical-origin constant), for the same reason #10324's
// version does: an import would widen this suite's declared cross-package
// read radius to buy six lines.

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATES, sanitizeNamespace, writeTemplateSrcFiles } from '../src/commands/init.js';
import { templates as createTemplates } from '../src/commands/create.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = path.resolve(HERE, '../tmp');
const CONTENT_DOCS = path.resolve(HERE, '..', '..', '..', 'content', 'docs');
const PROJECT_NAME = 'my-app';

const roots: string[] = [];
afterAll(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

interface Rendered {
  /** `<command>:<template key>` — the command a user would have typed. */
  scaffoldId: string;
  file: string;
  content: string;
  /**
   * The template entry rendered a STRING — an in-source literal, the only
   * kind of emitted file that can carry prose. Used by the vacuity guard
   * so "this arm was swept" cannot be satisfied by serialised JSON alone.
   */
  fromLiteral: boolean;
}

/** A throwaway project directory, registered for cleanup. */
function makeRoot(scaffoldId: string): string {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(TMP_ROOT, `render-${scaffoldId.replace(':', '-')}-`));
  roots.push(root);
  return root;
}

/**
 * Render every built-in template of BOTH scaffolders through its own
 * emitter — the exact functions each command calls, writing to real files
 * in a throwaway directory (mirroring `init-scaffold-authoring-rules.test.ts`)
 * — and return every file they produced. This IS the population the defect
 * lives in: text a scaffolded project actually receives.
 */
function renderAll(): Rendered[] {
  const namespace = sanitizeNamespace(PROJECT_NAME);
  const out: Rendered[] = [];

  const collect = (scaffoldId: string, root: string, literals: Set<string>) => {
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else {
          const file = path.relative(root, abs);
          out.push({
            scaffoldId,
            file,
            content: fs.readFileSync(abs, 'utf8'),
            fromLiteral: literals.has(file),
          });
        }
      }
    };
    walk(root);
  };

  // ── `os init -t <key>`: every template renders a config plus src files ──
  for (const templateKey of Object.keys(TEMPLATES)) {
    const template = TEMPLATES[templateKey];
    const root = makeRoot(`init:${templateKey}`);

    fs.writeFileSync(
      path.join(root, 'objectstack.config.ts'),
      template.configContent(PROJECT_NAME, namespace),
    );
    writeTemplateSrcFiles(template.srcFiles, root, PROJECT_NAME, namespace);

    // Everything `init` emits here is an in-source string literal.
    const literals = new Set<string>();
    const markAll = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) markAll(abs);
        else literals.add(path.relative(root, abs));
      }
    };
    markAll(root);
    collect(`init:${templateKey}`, root, literals);
  }

  // ── `os create <key> <name>`: one `files` map keyed by destination path ─
  for (const templateKey of Object.keys(createTemplates)) {
    const template = createTemplates[templateKey as keyof typeof createTemplates];
    const root = makeRoot(`create:${templateKey}`);
    const files = template.files as Record<string, (name: string) => unknown>;
    const literals = new Set<string>();

    for (const [filePath, render] of Object.entries(files)) {
      const content = render(PROJECT_NAME);
      // Exactly what `Create.run()` writes for this entry.
      const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
      if (typeof content === 'string') literals.add(filePath);
      const abs = path.join(root, filePath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text);
    }
    collect(`create:${templateKey}`, root, literals);
  }

  return out;
}

/**
 * References a reader who has only their own scaffolded project cannot
 * follow. Reused verbatim from #10324's
 * `starter-comments-self-contained.test.ts` — same defect class, same
 * vocabulary — spelled to match the identifier, not any particular
 * sentence, so the prose around it stays free to change.
 */
const MONOREPO_ONLY = [
  { label: 'an ADR identifier', re: /\bADR-\d{3,4}\b/ },
  { label: 'a bare issue number', re: /(^|[^\w/])#\d{3,6}\b/ },
  { label: 'a repo build-script path', re: /\bscripts\/[\w.-]+\.(?:mjs|mts|cjs|ts|js)\b/ },
  { label: 'a monorepo package path', re: /\bpackages\/[a-z0-9][\w-]*\//i },
];

describe('rendered scaffold templates are followable by a stranger', () => {
  const rendered = renderAll();

  // ── vacuity guard: prove this is reading real rendered output ──────────
  it('rendered a real, non-empty project per template of BOTH scaffolders (vacuity guard)', () => {
    expect(Object.keys(TEMPLATES).length).toBeGreaterThan(0);
    expect(Object.keys(createTemplates).length).toBeGreaterThan(0);
    expect(rendered.length).toBeGreaterThan(0);

    for (const templateKey of Object.keys(TEMPLATES)) {
      const files = rendered.filter((r) => r.scaffoldId === `init:${templateKey}`);
      expect(files.map((f) => f.file), `template "init:${templateKey}"`).toContain('objectstack.config.ts');
    }

    // `create`'s templates are NOT checked for that one filename: its
    // `plugin` template emits no `objectstack.config.ts` at all (its
    // `src/index.ts` declares a `Plugin` object instead), so requiring one
    // would report on a surface that scaffolder does not have. What must
    // hold for every `create` template is that the sweep reached its
    // in-source LITERALS — the only emitted files that can carry prose —
    // which is where this pin's three assertions have anything to read.
    for (const templateKey of Object.keys(createTemplates)) {
      const literals = rendered.filter((r) => r.scaffoldId === `create:${templateKey}` && r.fromLiteral);
      expect(
        literals.length,
        `template "create:${templateKey}" contributed no rendered string literal — the sweep ` +
          'reached none of its prose, so every assertion below passes vacuously for it',
      ).toBeGreaterThan(0);
    }

    // The two templates that emit an object (app, plugin) must have reached
    // the OWD comment's file, or assertion 2 below would vacuously pass.
    // Selected STRUCTURALLY (anything under src/objects/ that is not the
    // barrel) rather than by filename spelling: this guard went red on the
    // #11598 rename from `<ns>_item.ts` to `<ns>_item.object.ts`, which is a
    // correct catch but a re-edit the property never needed.
    const objectFiles = rendered.filter((r) => /^src\/objects\/(?!index\.ts$)[^/]+\.ts$/.test(r.file));
    expect(objectFiles.length).toBeGreaterThan(0);
  });

  // The second scaffolder, named — so a future edit that drops it from the
  // population fails with this card's own vocabulary rather than a bare
  // count that a shrinking sweep satisfies just as well.
  it('sweeps the `os create` scaffolder, not just `os init`', () => {
    const ids = [...new Set(rendered.map((r) => r.scaffoldId))];
    expect(ids).toContain('create:example');
    expect(ids).toContain('create:plugin');
    expect(ids.filter((id) => id.startsWith('init:')).length).toBe(Object.keys(TEMPLATES).length);
    expect(ids.filter((id) => id.startsWith('create:')).length).toBe(Object.keys(createTemplates).length);
  });

  // ── assertion 1: nothing unfollowable ───────────────────────────────────
  it.each(rendered.map((r) => [`${r.scaffoldId}/${r.file}`, r] as const))(
    '%s cites nothing that only exists in this monorepo',
    (_label, r) => {
      const command = r.scaffoldId.startsWith('init:') ? 'os init' : 'os create';
      for (const { label, re } of MONOREPO_ONLY) {
        const hit = re.exec(r.content);
        expect(
          hit,
          `${r.scaffoldId}/${r.file} cites ${label} (${JSON.stringify(hit?.[0])}). A project ` +
            `scaffolded by \`${command}\` ships no ADRs, no issue tracker and none of this repo's ` +
            'scripts, so this reads as a reference the newcomer is failing to follow. State the ' +
            'fact self-contained, or link a public docs page — do not delete the rationale.',
        ).toBeNull();
      }
    },
  );

  // ── assertion 2: the rationale survives ─────────────────────────────────
  // The FACT each removed reference was carrying, matched loosely enough
  // that rewording is free and deletion is not.
  it.each(rendered.filter((r) => r.file === 'objectstack.config.ts').map((r) => [r.scaffoldId, r] as const))(
    'scaffold "%s" objectstack.config.ts still explains the protocol range',
    (_scaffoldId, r) => {
      expect(r.content, `${r.scaffoldId}/${r.file} must still explain why the range exists`).toMatch(
        /refuses this (app|plugin) at the boundary|incompatible runtime/i,
      );
      expect(r.content, `${r.scaffoldId}/${r.file} must still explain it was stamped by scaffolding`).toMatch(
        /stamped/i,
      );
    },
  );

  const objectFiles = rendered.filter((r) => /^src\/objects\/(?!index\.ts$)[^/]+\.ts$/.test(r.file));
  it.each(objectFiles.map((r) => [`${r.scaffoldId}/${r.file}`, r] as const))(
    '%s still explains the org-wide default',
    (_label, r) => {
      expect(r.content, `${r.scaffoldId}/${r.file} must still explain what OWD means`).toMatch(
        /org-wide default|OWD/i,
      );
      expect(r.content, `${r.scaffoldId}/${r.file} must still explain declaring it is required`).toMatch(
        /required|refuses/i,
      );
    },
  );
  // Non-vacuity for assertion 2's own population: the app/plugin templates
  // both emit an object file, so this list must not be empty.
  it('found object source files to check the OWD rationale on', () => {
    expect(objectFiles.length).toBeGreaterThanOrEqual(2);
  });

  // ── assertion 3: canonical docs links resolve ───────────────────────────
  it('every canonical docs URL in rendered templates resolves to a real page', () => {
    // baseUrl '/docs' is mounted over content/docs, so the route path is the
    // file path minus the extension; a directory resolves only via an index
    // page. Restated from check-published-readme-links.mjs's pageCandidates
    // rather than imported — see file header.
    const candidates = (route: string) => [
      `${route}.mdx`,
      `${route}.md`,
      `${route}/index.mdx`,
      `${route}/index.md`,
    ];
    const urls: { where: string; url: string; route: string }[] = [];
    for (const r of rendered) {
      for (const m of r.content.matchAll(/https:\/\/objectstack\.ai\/docs\/([\w./-]*[\w-])/g)) {
        urls.push({ where: `${r.scaffoldId}/${r.file}`, url: m[0], route: m[1] });
      }
    }
    // Non-vacuity: the rewrite puts docs links in every template on
    // purpose. Zero matches means the extractor broke, not that the
    // templates are clean.
    expect(urls.length, 'no canonical docs URLs found — the extractor is broken').toBeGreaterThan(0);

    for (const { where, url, route } of urls) {
      const found = candidates(route).some((c) => fs.existsSync(path.join(CONTENT_DOCS, c)));
      expect(
        found,
        `${where} links ${url}, which content/docs serves from none of ` +
          `${candidates(route).join(', ')}. A link that 404s is the same defect one level ` +
          'out — repoint it, or make the comment self-contained instead.',
      ).toBe(true);
    }
  });
});
