// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10532] `organization/add-member` — `organizationId` falls back to the
 * caller's active organization; `teamId` does NOT.
 *
 * ## What this pin watches, and why it reads the VENDOR
 *
 * Three of our source comments used to assert the symmetric version of that
 * sentence ("organizationId/teamId default to the caller's active org/team when
 * omitted"). better-auth 1.7.1 implements only the org half. The comments are
 * corrected, and the docs written for #10050 now state the asymmetry to users
 * — so the standing risk is no longer a wrong comment but a **vendor bump that
 * ADDS an active-team fallback**, which would make our (now correct) docs wrong
 * with nothing watching.
 *
 * Therefore this pin asserts a fact about the INSTALLED vendor artifact, read
 * out of `node_modules` at test time. It deliberately does NOT assert anything
 * about our own comment text or our own constants: an assertion whose both
 * sides derive from files in this repo proves only that we wrote what we wrote,
 * and could not fail for the reason it exists.
 *
 * ## The zero-hit discipline
 *
 * "There is no active-team fallback" is a NEGATIVE finding, and a negative
 * finding from a detector nobody proved is worthless — a typo'd matcher reports
 * the same clean absence as a real one. So every negative leg below is paired
 * with a POSITIVE control that runs the SAME matcher over a neighbouring fact
 * known to be present:
 *
 *   - `SESSION_ACTIVE_FALLBACK` must MATCH the `orgId` binding (which really
 *     does fall back) before its non-match on the `teamId` binding counts;
 *   - `activeOrganizationId` must occur in the file before the zero count for
 *     `activeTeam*` counts.
 *
 * Measured 2026-08-21 on the installed better-auth 1.7.1,
 * `dist/plugins/organization/routes/crud-members.mjs`, inside `addMember`:
 *
 *     const orgId = ctx.body.organizationId || session?.session.activeOrganizationId;
 *     const teamId = "teamId" in ctx.body ? ctx.body.teamId : void 0;
 *
 * `activeOrganizationId` occurs 8 times in that file; `activeTeamId`, 0.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Locate this package by walking up from the CWD — the idiom
 * `member-role-canonical.test.ts` / `rate-limit-storage-isolation.test.ts`
 * established here and state the reason for: plugin-auth is CJS-typed (no
 * `"type": "module"`, it publishes `dist/index.js` as CommonJS), so under
 * `module: NodeNext` `import.meta` is a TS1470 in this package however well it
 * runs under vitest.
 */
function findUp(predicate: (dir: string) => boolean, what: string): string {
  let dir = process.cwd();
  for (;;) {
    if (predicate(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`could not locate ${what}`);
    dir = parent;
  }
}

const PKG = findUp((dir) => {
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) return false;
  const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };
  return name === '@objectstack/plugin-auth';
}, 'the @objectstack/plugin-auth package root');

// Resolved from THIS package, so the file read is the better-auth this package
// is pinned to — not whatever a hoist happens to put at the repo root. The read
// goes through `node_modules` at test time; there is no checked-in copy of the
// vendor text for it to fall back to, which is what the ablation in the PR body
// demonstrates (mutate the file under `node_modules` and this suite reddens).
const require_ = createRequire(join(PKG, 'probe.js'));
/** `…/better-auth/dist/index.mjs` → `…/better-auth/dist`. */
const VENDOR_DIST = dirname(require_.resolve('better-auth'));
const CRUD_MEMBERS = join(VENDOR_DIST, 'plugins', 'organization', 'routes', 'crud-members.mjs');
const VENDOR_SOURCE = readFileSync(CRUD_MEMBERS, 'utf8');

/**
 * The whole top-level `const <name> = …` declaration, up to the next top-level
 * `const` (declarations inside the body are indented, so a line-start `const`
 * marks the next sibling). Throws when the declaration is gone — the drift
 * tripwire: a vendor upgrade that restructures the module fails loudly instead
 * of leaving a pin that matches nothing and passes.
 */
function topLevelDecl(source: string, name: string): string {
  const start = source.indexOf(`\nconst ${name} = `);
  if (start < 0) {
    throw new Error(
      `[#10532] could not find the top-level \`${name}\` declaration in ${CRUD_MEMBERS}. ` +
        `better-auth restructured this module — re-read \`addMember\` and re-decide whether ` +
        `\`teamId\` still has no active-team fallback (our comments and the ` +
        `content/docs/permissions/authentication.mdx "Attaching an existing user to an ` +
        `organization" section both state that it does not).`,
    );
  }
  const rest = source.slice(start + 1);
  const next = rest.indexOf('\nconst ');
  return next < 0 ? rest : rest.slice(0, next);
}

/**
 * The initialiser of a single-line `const <name> = …;` binding inside a slice,
 * returned as vendor BYTES. Throws when absent, for the same reason as above.
 */
function bindingInitializer(slice: string, name: string): string {
  const match = new RegExp(`\\n\\s*const ${name} = ([^;\\n]+);`).exec(slice);
  if (!match) {
    throw new Error(
      `[#10532] could not find the \`const ${name} = …;\` binding inside \`addMember\` in ` +
        `${CRUD_MEMBERS}. better-auth rewrote the handler — re-read it and re-decide whether ` +
        `\`teamId\` still has no active-team fallback.`,
    );
  }
  return match[1]!;
}

/**
 * "This binding falls back to something on the caller's session." One matcher,
 * used on both bindings, so the negative leg is only ever read after the same
 * matcher has been shown to fire on the positive one.
 */
const SESSION_ACTIVE_FALLBACK = /session[\s\S]*\bactive[A-Z]\w*/;

const ADD_MEMBER = topLevelDecl(VENDOR_SOURCE, 'addMember');

const occurrences = (needle: RegExp): number =>
  VENDOR_SOURCE.match(new RegExp(needle.source, 'g'))?.length ?? 0;

describe('[#10532] better-auth `addMember` — the org/team fallback asymmetry', () => {
  it('CONTROL: the `orgId` binding really does fall back to the session active org', () => {
    // Positive control for BOTH instruments used below: it proves the vendor
    // file was located and sliced, and that `SESSION_ACTIVE_FALLBACK` fires on
    // a binding that carries a session fallback. Without this leg passing, the
    // non-match in the next test is not evidence of anything.
    const orgId = bindingInitializer(ADD_MEMBER, 'orgId');
    expect(orgId).toMatch(SESSION_ACTIVE_FALLBACK);
    expect(orgId).toContain('activeOrganizationId');
  });

  it('the `teamId` binding has NO fallback — it reads the request body and nothing else', () => {
    const teamId = bindingInitializer(ADD_MEMBER, 'teamId');
    // Same matcher that just fired on `orgId`.
    expect(teamId).not.toMatch(SESSION_ACTIVE_FALLBACK);
    // …and positively: the only source of the value is the request body.
    expect(teamId).toContain('ctx.body');
    expect(teamId).not.toContain('session');
  });

  it('no active-team read anywhere in the module (with the neighbouring positive control)', () => {
    // The control first: if this ever hits 0 the grep itself is broken and the
    // zero below means nothing.
    expect(occurrences(/activeOrganizationId/)).toBeGreaterThan(0);
    expect(occurrences(/active[Tt]eam\w*/)).toBe(0);
  });

  it('the `if (teamId)` branches stay skipped when teamId is absent — no re-resolution later', () => {
    // The remaining way the vendor could acquire an active team is to
    // re-resolve it after the binding. Same control shape: the guard we expect
    // to be there is asserted present, then the re-resolution is asserted
    // absent across the whole handler.
    expect(ADD_MEMBER).toMatch(/if \(teamId\)/);
    expect(ADD_MEMBER).not.toMatch(/teamId\s*(?:\|\||\?\?)=?/);
  });
});
