// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#18650] The platform test checklist's statements about the anonymous
// `/get-session` answer are held EQUAL to this package's refusal envelope.
//
// ## The failure this exists for
//
// `docs/qa/platform-checklist/areas/identity-auth.json` taught better-auth's
// bare no-session convention — HTTP `200` with a JSON `null` body — in five
// places, and instructed a runner accordingly: "a 401 expectation misdescribes
// a correct implementation", "a get-session that answers 200 after the revoke
// is NOT that failure". #17238 ruled and #17881 landed
// `refuseAnonymousSession`, which converts exactly that answer into `401` with
// the ADR-0112 refusal envelope. From that day the checklist asserted the
// OPPOSITE of the truth: a runner following it scored a correct platform as
// defective, and the remedy its negative pointed at was undoing an auth
// tightening. The drift was invisible for five weeks because nothing compared
// the two.
//
// Worse, one of the five sites was itself a CORRECTION (`revision 3`, run
// #7663) whose cited authority — `session-of-record.test.ts` — was inverted
// underneath it afterwards. A correction pinned to an authority that moves is
// not self-limiting: it keeps instructing, with the record of why it was right
// still attached.
//
// ## Why this pin lives HERE, in `plugin-auth`
//
// The next behaviour change is a diff in THIS package: the status and code are
// this module's (`anonymous-session-refusal.ts`), so a PR that moves them puts
// `@objectstack/plugin-auth` in the affected set and this test runs. A pin
// sitting with the checklist instead would be judged by where the DOCS live and
// would sit green through exactly the change it exists to catch —
// `check:platform-checklist` is deliberately not wired into per-PR CI (its own
// header records the ruling), so it is the daily watchdog, not the gate a
// behaviour change trips.
//
// The escaping read into `docs/qa/platform-checklist/areas/` is declared in
// `scripts/cross-package-test-inputs.mjs` and mirrored into `turbo.json`, so
// neither of CI's scoping layers replays a cached green over it.
//
// ## The three legs, and why none of them is optional
//
//  1. **ALIGNMENT.** Every checklist string that names the refusal seam must
//     state the status and the code this package actually emits — and both are
//     READ FROM THE RUNTIME (`ANONYMOUS_SESSION_REFUSAL_STATUS`, and the code
//     DERIVED from it through ADR-0112's own map), never spelled as a second
//     copy here. Change the status to `403` and the checklist still says `401`:
//     red. That is the failable half triage asked for.
//  2. **ABSENCE.** No INSTRUCTIONAL string in any area file may teach the
//     retired convention again — a tree-scoped absence pin, so the regression
//     cannot come back in a sibling area file either.
//  3. **FLOOR.** Leg 1 is satisfied vacuously by a file that says nothing, and
//     leg 2 by a file that says nothing at all. So each of the four
//     instructional families of the item must still carry at least one aligned
//     statement. Deleting the guidance is a red, not a pass.
//
// ⛔ `history` is deliberately EXEMPT from leg 2. A revision entry recording
// what an earlier revision got wrong has to be free to quote the retired text;
// a rule that forbade it would make the file unable to record its own
// corrections — which is the precise mistake this card was told not to make
// when it was told to leave `revision 3` standing.

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { standardErrorCodeForHttpStatus } from '@objectstack/spec/api';
import { ANONYMOUS_SESSION_REFUSAL_STATUS } from './anonymous-session-refusal';

/**
 * Seeded from `__dirname` for the two reasons `managed-extension-fields.test.ts`
 * states at length: `import.meta` is a TS1470 in this CJS-typed package, and
 * `__dirname` is one of the spellings `check:cross-package-test-inputs`
 * resolves statically, so this file's escaping read stays VISIBLE to the gate
 * that keeps turbo's input hash moving with it.
 */
const HERE = __dirname;
/** …/packages/plugins/plugin-auth/src → repo root */
const REPO_ROOT = resolve(HERE, '../../../..');
const AREAS_DIR = join(REPO_ROOT, 'docs/qa/platform-checklist/areas');

/** The item whose clauses score the revoke, and the module they must agree with. */
const ITEM_ID = 'identity-auth.admin-lifecycle-operations';
const SEAM = 'anonymous-session-refusal';

/**
 * ⛔ Both READ from the runtime, never spelled twice. The status is this
 * module's exported constant; the code is derived from it through ADR-0112's
 * own status → code map, exactly as `refuseAnonymousSession` derives it. A
 * second literal here would agree with a changed runtime forever.
 */
const REFUSAL_STATUS = ANONYMOUS_SESSION_REFUSAL_STATUS;
const REFUSAL_CODE = standardErrorCodeForHttpStatus(REFUSAL_STATUS);

/**
 * The retired convention, in every spelling this file ever carried it in. Its
 * ability to FIRE is proved below against a sample rather than assumed — an
 * absence pin whose matcher cannot match is a green that means nothing.
 */
const RETIRED_CONVENTION =
  /HTTP 200 (and|with) a JSON null body|200 \+ a JSON null body|200-with-null-body|no-session convention is HTTP 200|a 401 expectation misdescribes/i;

/** A string that DOES carry the retired convention — the matcher's positive control. */
const RETIRED_SAMPLE =
  "better-auth's no-session convention is HTTP 200 with a JSON null body, so a 401 expectation misdescribes a correct implementation";

/** A string that must NOT match — the matcher's negative control. */
const ALIGNED_SAMPLE =
  'an anonymous OR revoked get-session answers 401 UNAUTHENTICATED in the ADR-0112 refusal envelope';

type Area = { area: string; items: Array<Record<string, any>> };

const areaFiles = (): Array<{ file: string; data: Area }> =>
  readdirSync(AREAS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({ file, data: JSON.parse(readFileSync(join(AREAS_DIR, file), 'utf8')) as Area }));

/**
 * Every string in `node`, as `<path> :: <text>` pairs, with the `history`
 * subtree skipped — see the exemption in the header.
 */
function instructionalStrings(node: unknown, path: string, out: Array<[string, string]> = []) {
  if (typeof node === 'string') {
    out.push([path, node]);
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => instructionalStrings(v, `${path}[${i}]`, out));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'history') continue;
      instructionalStrings(v, `${path}.${k}`, out);
    }
  }
  return out;
}

const targetItem = () => {
  const found = areaFiles()
    .flatMap(({ data }) => data.items ?? [])
    .find((i) => i.id === ITEM_ID);
  if (!found) throw new Error(`checklist item ${ITEM_ID} is gone — this pin has no subject`);
  return found;
};

// ───────────────────────────────────────────────────────────────────────────
describe('[#18650] the checklist agrees with the ADR-0112 anonymous-session refusal', () => {
  it('the retired-convention matcher can actually fire — control, both directions', () => {
    // Leg 2 is an absence claim, and an absence claim carried by a matcher that
    // matches nothing is indistinguishable from a passing one. Proved here
    // against the text this card removed, and against the text that replaced it.
    expect(RETIRED_CONVENTION.test(RETIRED_SAMPLE)).toBe(true);
    expect(RETIRED_CONVENTION.test(ALIGNED_SAMPLE)).toBe(false);
  });

  it('⭐ every site naming the refusal seam states the status and code the RUNTIME emits', () => {
    // The failable half. `REFUSAL_STATUS` / `REFUSAL_CODE` come from the module
    // under this directory, so moving the wire answer without re-pointing the
    // checklist turns this red on the very PR that moves it.
    const offenders: string[] = [];
    for (const { file, data } of areaFiles()) {
      for (const [path, text] of instructionalStrings(data, file)) {
        if (!text.includes(SEAM)) continue;
        if (!text.includes(String(REFUSAL_STATUS))) offenders.push(`${path}: missing status ${REFUSAL_STATUS}`);
        if (!text.includes(REFUSAL_CODE)) offenders.push(`${path}: missing code ${REFUSAL_CODE}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('⭐ no instructional string teaches the retired 200-plus-null convention', () => {
    const offenders: string[] = [];
    for (const { file, data } of areaFiles()) {
      for (const [path, text] of instructionalStrings(data, file)) {
        if (RETIRED_CONVENTION.test(text)) offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('⭐ each instructional family still CARRIES the aligned statement — not merely lacks the old one', () => {
    // Leg 3. Without this, deleting the guidance passes legs 1 and 2 outright,
    // and the card was explicit that the substantive advice must survive the
    // repair of the convention it rested on.
    const item = targetItem();
    const families: Record<string, string[]> = {
      steps: item.steps ?? [],
      'acceptance[].verify': (item.acceptance ?? []).map((a: any) => String(a?.verify ?? '')),
      negative: item.negative ?? [],
      source: item.source ?? [],
    };
    const empty = Object.entries(families)
      .filter(([, strings]) => !strings.some((s) => s.includes(SEAM)))
      .map(([name]) => name);
    expect(empty).toEqual([]);
  });

  it('the clause keeps its NON-status oracle — the protected request, not get-session', () => {
    // The advice that survives the inversion, and the reason it survives: the
    // contract is an immediate kill on a PROTECTED request, so one auth-route
    // seam's status was never the right oracle and still is not. Pinned so a
    // future "the status discriminates now, just use it" edit has to argue with
    // something.
    const item = targetItem();
    // Selected by what the clause SAYS, not by its index — an inserted clause
    // must not silently re-point this pin at a neighbour.
    const clause = (item.acceptance ?? []).find((a: any) =>
      String(a?.clause ?? '').includes('revoke-user-sessions kills'),
    );
    expect(clause, 'the revoke-user-sessions clause is gone').toBeDefined();
    const verify = String(clause?.verify ?? '');
    expect(verify).toContain('get-session is NOT the oracle for this clause');
    expect(verify).toMatch(/PROTECTED request/);
  });
});
