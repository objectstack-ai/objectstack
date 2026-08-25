// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Every comment that ships into a project scaffolded by `objectstack init`
// must be followable by the person reading it — someone who has that
// project and nothing else.
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
// ## Why the population is the RENDERED output, not the source file
//
// `init.ts` also carries its own ordinary source comments that legitimately
// cite ADRs and issue numbers (e.g. the `printCreatedFilesSummary` doc
// comment cites #10499) — those never ship, because they live outside the
// `configContent` / `srcFiles` functions the command actually writes to
// disk. A pin that greps `init.ts` wholesale would match those too and
// report on the wrong population. So this pin does not read the source
// file at all: it calls the exact functions the `init` command calls
// (`template.configContent(...)`, `writeTemplateSrcFiles(...)`) and scans
// the files they actually write — the same real emitter
// `init-scaffold-authoring-rules.test.ts` uses, for the same reason (so
// neither test can drift from what `init` really does).
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = path.resolve(HERE, '../tmp');
const CONTENT_DOCS = path.resolve(HERE, '..', '..', '..', 'content', 'docs');
const PROJECT_NAME = 'my-app';

const roots: string[] = [];
afterAll(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

interface Rendered {
  templateKey: string;
  file: string;
  content: string;
}

/**
 * Render every built-in template through `init`'s own emitter — the exact
 * functions the command calls, writing to real files in a throwaway
 * directory (mirroring `init-scaffold-authoring-rules.test.ts`) — and
 * return every file it produced. This IS the population the defect lives
 * in: text a scaffolded project actually receives.
 */
function renderAll(): Rendered[] {
  const namespace = sanitizeNamespace(PROJECT_NAME);
  const out: Rendered[] = [];
  fs.mkdirSync(TMP_ROOT, { recursive: true });

  for (const templateKey of Object.keys(TEMPLATES)) {
    const template = TEMPLATES[templateKey];
    const root = fs.mkdtempSync(path.join(TMP_ROOT, `render-${templateKey}-`));
    roots.push(root);

    fs.writeFileSync(
      path.join(root, 'objectstack.config.ts'),
      template.configContent(PROJECT_NAME, namespace),
    );
    writeTemplateSrcFiles(template.srcFiles, root, PROJECT_NAME, namespace);

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else out.push({ templateKey, file: path.relative(root, abs), content: fs.readFileSync(abs, 'utf8') });
      }
    };
    walk(root);
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

describe('rendered init templates are followable by a stranger', () => {
  const rendered = renderAll();

  // ── vacuity guard: prove this is reading real rendered output ──────────
  it('rendered a real, non-empty project per template (vacuity guard)', () => {
    expect(Object.keys(TEMPLATES).length).toBeGreaterThan(0);
    expect(rendered.length).toBeGreaterThan(0);
    for (const templateKey of Object.keys(TEMPLATES)) {
      const files = rendered.filter((r) => r.templateKey === templateKey);
      expect(files.map((f) => f.file), `template "${templateKey}"`).toContain('objectstack.config.ts');
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

  // ── assertion 1: nothing unfollowable ───────────────────────────────────
  it.each(rendered.map((r) => [`${r.templateKey}/${r.file}`, r] as const))(
    '%s cites nothing that only exists in this monorepo',
    (_label, r) => {
      for (const { label, re } of MONOREPO_ONLY) {
        const hit = re.exec(r.content);
        expect(
          hit,
          `${r.templateKey}/${r.file} cites ${label} (${JSON.stringify(hit?.[0])}). A project ` +
            'scaffolded by `os init` ships no ADRs, no issue tracker and none of this repo\'s ' +
            'scripts, so this reads as a reference the newcomer is failing to follow. State the ' +
            'fact self-contained, or link a public docs page — do not delete the rationale.',
        ).toBeNull();
      }
    },
  );

  // ── assertion 2: the rationale survives ─────────────────────────────────
  // The FACT each removed reference was carrying, matched loosely enough
  // that rewording is free and deletion is not.
  it.each(rendered.filter((r) => r.file === 'objectstack.config.ts').map((r) => [r.templateKey, r] as const))(
    'template "%s" objectstack.config.ts still explains the protocol range',
    (_templateKey, r) => {
      expect(r.content, `${r.templateKey}/${r.file} must still explain why the range exists`).toMatch(
        /refuses this (app|plugin) at the boundary|incompatible runtime/i,
      );
      expect(r.content, `${r.templateKey}/${r.file} must still explain it was stamped by scaffolding`).toMatch(
        /stamped/i,
      );
    },
  );

  const objectFiles = rendered.filter((r) => /^src\/objects\/(?!index\.ts$)[^/]+\.ts$/.test(r.file));
  it.each(objectFiles.map((r) => [`${r.templateKey}/${r.file}`, r] as const))(
    '%s still explains the org-wide default',
    (_label, r) => {
      expect(r.content, `${r.templateKey}/${r.file} must still explain what OWD means`).toMatch(
        /org-wide default|OWD/i,
      );
      expect(r.content, `${r.templateKey}/${r.file} must still explain declaring it is required`).toMatch(
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
        urls.push({ where: `${r.templateKey}/${r.file}`, url: m[0], route: m[1] });
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
