// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Every comment that ships INTO a scaffolded project must be followable by the
// person reading it — someone who has this project and nothing else.
//
// ## The defect
//
// The two files a newcomer opens first after scaffolding, objectstack.config.ts
// and src/objects/note.object.ts, carried six references addressed to a reader
// with this monorepo open: four ADR identifiers, one bare issue number, and the
// path of a release-time script. None of docs/adr, the issue tracker, or that
// script ships in a scaffolded project, so "// per ADR-0097" was a reference the
// reader could not resolve — it read as an instruction they were failing to
// follow rather than as the context it was meant to be.
//
// ## Why this pin has TWO halves, and why the second is the load-bearing one
//
// The cheap way to make the references disappear is to delete the comments. That
// would be a worse project than the one with the dead references: the comments
// explain WHY each setting is the way it is, which is exactly what a newcomer
// deciding whether to change it needs. So a one-way "no ADR identifiers" grep
// would rot in the one direction that matters — it stays green while the
// rationale is deleted out from under it.
//
// Hence: no unfollowable reference (assertion 1) AND the fact each comment
// carries still stated (assertion 2). A future edit can reword freely; it cannot
// quietly strip the explanation, and it cannot re-introduce a dead end.
//
// ## The third half: a public link is only a fix while it resolves
//
// Replacing an internal identifier with a docs URL moves the same defect one
// level out if the URL 404s — a reference that looks authoritative and lands
// nowhere. Assertion 3 resolves every canonical-origin docs URL in the shipped
// tree against content/docs the way Fumadocs routes it: baseUrl /docs over
// content/docs, and a directory that exists but carries no index page is a 404.
// That candidate list is check-docs-redirects' pageCandidates, restated in six
// lines rather than imported, because importing a root script into this package
// would widen this suite's declared cross-package read radius to buy nothing.
//
// Assertion 3 only judges URLs already on the canonical origin; host
// CONVERGENCE — is the origin the RULED one at all — is assertion 4 (#10990).
// It could not have lived anywhere else: the published-readme-links gate
// prescribes the same canonical origin, but its population is publishable
// packages' PUBLISHED markdown, which never reaches this package's templates
// — `templates/AGENTS.md` is a template file under `src/`, not a package
// README, and `Dockerfile` / `docker-compose.yml` are not markdown at all.
// `shippedFiles()` below is the one walker in the repo that already
// enumerates exactly what a scaffold ships, so the host pin belongs here.
//
// ## A fifth `MONOREPO_ONLY` pattern, found while fixing #11022
//
// `blank/README.md` named "the ObjectStack framework repo" as the home of
// `skills/` — a monorepo-only reference in PROSE rather than in one of the
// four syntactic shapes (ADR id / issue number / script path / package path)
// the first four patterns matched. Nothing in this file's original four
// patterns could have caught it, which is why removing the ADR-0097 reference
// this same README carried and deleting the (now self-retired) `EXCLUDED`
// entry for it would otherwise have let assertion 1 pass with that second,
// still-unfollowable line untouched. See the fifth `MONOREPO_ONLY` entry
// below for how it is scoped to avoid the reader's own project also being
// called "a monorepo" (`blank/pnpm-workspace.yaml`, correctly).

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const templateRoot = path.resolve(HERE, 'templates');
const contentDocs = path.resolve(HERE, '..', '..', '..', 'content', 'docs');

/**
 * Nothing is excluded — every shipped file is scanned. `blank/README.md` used
 * to carry a self-retiring entry here ("still carries an ADR identifier; owned
 * by another card") while its ADR-0097 reference and its unlinked "ObjectStack
 * framework repo" reference were another card's (#11022); both are gone now,
 * so the retirement fired as designed and this map goes back to empty rather
 * than staying around as a silent exemption over the most-read file in the
 * tree.
 */
const EXCLUDED = new Map<string, string>();

/** Text files the scaffolder copies into the user's project. */
function shippedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(path.relative(templateRoot, abs).split(path.sep).join('/'));
    }
  };
  walk(templateRoot);
  return out.sort();
}

/**
 * References a reader who has only their own scaffolded project cannot follow.
 * Each is spelled to match the identifier, not any particular sentence, so the
 * prose around it stays free to change.
 */
const MONOREPO_ONLY = [
  { label: 'an ADR identifier', re: /\bADR-\d{3,4}\b/ },
  { label: 'a bare issue number', re: /(^|[^\w/])#\d{3,6}\b/ },
  { label: 'a repo build-script path', re: /\bscripts\/[\w.-]+\.(?:mjs|mts|cjs|ts|js)\b/ },
  { label: 'a monorepo package path', re: /\bpackages\/[a-z0-9][\w-]*\//i },
  // #11022: `blank/README.md` named "the ObjectStack framework repo" as the
  // home of `skills/`, unlinked — a reader with only their own scaffolded
  // project has no way to reach it. The first four patterns are syntactic
  // identifiers (an ADR id, an issue number, a repo-relative path); this one
  // is the same class of defect in prose form, so it is spelled to the
  // FRAMEWORK'S OWN NAME next to a "repo" word, not to that one sentence —
  // it survives a reword. Deliberately narrower than a bare "repo" or
  // "monorepo" match: this template tree also calls the READER'S OWN project
  // "a monorepo root" (`blank/pnpm-workspace.yaml`), which is a correct,
  // self-contained, followable statement about a directory they do have.
  { label: 'a reference to the ObjectStack repo as an unlinked location', re: /\bObjectStack (?:framework )?(?:mono)?repo\b/i },
];

const read = (rel: string) => fs.readFileSync(path.join(templateRoot, rel), 'utf8');

describe('shipped template comments are followable by a stranger', () => {
  const files = shippedFiles();

  it('reads a real template tree (vacuity guard)', () => {
    expect(files).toContain('blank/objectstack.config.ts');
    expect(files).toContain('blank/src/objects/note.object.ts');
    expect(files.length).toBeGreaterThan(8);
  });

  // ── assertion 1: nothing unfollowable ────────────────────────────────────
  it.each(shippedFiles().filter((f) => !EXCLUDED.has(f)))(
    '%s cites nothing that only exists in this monorepo',
    (rel) => {
      const text = read(rel);
      for (const { label, re } of MONOREPO_ONLY) {
        const hit = re.exec(text);
        expect(
          hit,
          `${rel} cites ${label} (${JSON.stringify(hit?.[0])}). A scaffolded project ` +
            'ships no ADRs, no issue tracker and none of this repo\'s scripts, so this ' +
            'reads as a reference the newcomer is failing to follow. State the fact ' +
            'self-contained, or link a public docs page — do not delete the rationale.',
        ).toBeNull();
      }
    },
  );

  // ── assertion 2: the rationale survives ──────────────────────────────────
  // Each entry is the FACT the removed reference was carrying, matched loosely
  // enough that rewording is free and deletion is not.
  const RATIONALE: { file: string; facts: { what: string; re: RegExp }[] }[] = [
    {
      file: 'blank/objectstack.config.ts',
      facts: [
        { what: 'why the protocol range exists (an incompatible runtime refuses the app)', re: /refuses? this app|refuse this package|incompatible runtime/i },
        { what: 'that the protocol range is stamped for you, not hand-tuned', re: /stamped|scaffold(ing|ed)/i },
        { what: 'why `automation` must stay when a connector is listed', re: /nowhere to register|boot fails/i },
        { what: 'that a declarative mcp stdio transport is denied by default', re: /denied by default/i },
      ],
    },
    {
      file: 'blank/src/objects/note.object.ts',
      facts: [
        { what: 'what the org-wide default means', re: /org-wide default|OWD/i },
        { what: 'that declaring it is required rather than optional', re: /required|refuses/i },
      ],
    },
    {
      // #11022's two rewrites (ADR-0097 -> a public docs link; "the ObjectStack
      // framework repo" -> the followable install form) are RATIONALE entries
      // too, for the same reason blank/objectstack.config.ts and
      // note.object.ts already are: assertions 1/3/4 only ever check that
      // something UNFOLLOWABLE is absent or that a present URL resolves --
      // none of them notice a fact quietly disappearing along the way.
      file: 'blank/README.md',
      facts: [
        { what: 'that a provider-bound connector is materialized into a live, dispatchable connector at boot (not written by hand)', re: /materializ\w*[^.]*?\bat\s+boot\b/i },
        { what: 'the followable skills install command (`npx skills add objectstack-ai/objectstack/skills`)', re: /npx skills add objectstack-ai\/objectstack\/skills/i },
      ],
    },
  ];

  for (const { file, facts } of RATIONALE) {
    describe(file, () => {
      for (const { what, re } of facts) {
        it(`still explains ${what}`, () => {
          expect(
            read(file),
            `${file} no longer explains ${what}. These comments were rewritten to drop ` +
              'monorepo-only references while KEEPING what they explain; deleting the ' +
              'explanation is not the same fix.',
          ).toMatch(re);
        });
      }
    });
  }

  // ── assertion 3: canonical docs links resolve ────────────────────────────
  it('every canonical docs URL in the shipped tree resolves to a real page', () => {
    // baseUrl '/docs' is mounted over content/docs, so the route path is the
    // file path minus the extension; a directory resolves only via an index page.
    const candidates = (route: string) => [
      `${route}.mdx`,
      `${route}.md`,
      `${route}/index.mdx`,
      `${route}/index.md`,
    ];
    const urls: { rel: string; url: string; route: string }[] = [];
    for (const rel of shippedFiles()) {
      const text = read(rel);
      for (const m of text.matchAll(/https:\/\/objectstack\.ai\/docs\/([\w./-]*[\w-])/g)) {
        urls.push({ rel, url: m[0], route: m[1] });
      }
    }
    // Non-vacuity: the rewritten starter comments put docs links in this tree on
    // purpose. Zero matches means the extractor broke, not that the tree is clean.
    expect(urls.length, 'no canonical docs URLs found — the extractor is broken').toBeGreaterThan(0);

    for (const { rel, url, route } of urls) {
      const found = candidates(route).some((c) => fs.existsSync(path.join(contentDocs, c)));
      expect(
        found,
        `${rel} links ${url}, which content/docs serves from none of ` +
          `${candidates(route).join(', ')}. A link that 404s is the same defect one ` +
          'level out — repoint it, or make the comment self-contained instead.',
      ).toBe(true);
    }
  });

  // ── assertion 4: no non-canonical docs host ships into a project ────────
  // #10990: three shipped lines cited `objectstack.com` (not even a
  // redirecting alias — a different, wrong domain) or `docs.objectstack.ai`
  // (an accepted-but-unratified alias per the published-readme-links gate's
  // DOCS_HOSTS) instead of the ruled canonical origin (maintainer ruling,
  // 2026-08-21). Full reasoning on why this population needed its own pin is
  // in the file header above.
  it.each(shippedFiles())('%s cites no non-canonical docs host', (rel) => {
    // Restated, not imported, for the same cross-package-read-radius reason
    // assertion 3's candidate list gives above. This is every host the
    // published-readme-links gate's DOCS_HOSTS classifies as this docs site
    // (canonical + redirecting aliases) MINUS the canonical origin itself,
    // plus `objectstack.com` — a different, wrong domain that is not in that
    // set at all, so it is not a "host" in that gate's sense, just a mistake
    // this population has actually shipped.
    const NON_CANONICAL_DOCS_HOSTS = [
      'docs.objectstack.ai',
      'www.objectstack.ai',
      'www.docs.objectstack.ai',
      'protocol.objectstack.ai',
      'www.protocol.objectstack.ai',
      'objectstack.com',
    ];
    const re = new RegExp(
      `https?://(?:${NON_CANONICAL_DOCS_HOSTS.map((h) => h.replace(/\./g, '\\.')).join('|')})\\b`,
    );
    const hit = re.exec(read(rel));
    expect(
      hit,
      `${rel} cites ${JSON.stringify(hit?.[0])}, a non-canonical docs host. Converge ` +
        'on https://objectstack.ai (maintainer ruling, 2026-08-21).',
    ).toBeNull();
  });

  // ── the exclusion is live, or it is gone ─────────────────────────────────
  it.each([...EXCLUDED.keys()])('%s still needs its exclusion', (rel) => {
    const text = read(rel);
    const hits = MONOREPO_ONLY.filter(({ re }) => re.test(text));
    expect(
      hits.length,
      `${rel} no longer cites anything monorepo-only — remove it from EXCLUDED in ` +
        'this file so it is scanned like every other shipped file. An exclusion kept ' +
        'past its cause is how a file stops being checked without anyone deciding to ' +
        'stop checking it.',
    ).toBeGreaterThan(0);
  });
});
