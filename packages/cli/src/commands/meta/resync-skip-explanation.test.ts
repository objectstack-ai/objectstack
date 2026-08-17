// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #9184 — `os meta resync` reports a nonzero skip count with no explanation.
//
// The docblock half (#9130 / PR #9183) already explains, IN SOURCE, that a
// stored `'admin'` (or legacy `'user'`) stamp is not always a deliberate
// Setup takeover — on any install created before #8692 the platform's own
// seeder wrote that exact stamp, so `resynced 0 / skipped N` is a permanent,
// by-design outcome there. This card is the runtime-output half: the same
// explanation has to reach the operator who is staring at the terminal,
// never having gone looking for the source.
//
// What is pinned here:
//   • the explanation fires exactly when `resyncSkipped > 0` — the same
//     condition the skip-count summary itself uses, never a narrower one
//     (e.g. `resynced === 0`);
//   • it names BOTH spellings of the legacy-vs-current provenance value
//     (`admin` and `user`), because a stored legacy row can surface under
//     either;
//   • it says the skip is expected / by design / not a failure — the whole
//     point of the card;
//   • it does NOT reintroduce "intentional override" framing for the
//     admin-owned case — the docblock removed that as false (a pre-#8692
//     seeder wrote the stamp, not an admin), and this line must not
//     contradict it.

import { describe, it, expect } from 'vitest';
import { resyncSkipExplanationLine } from './resync.js';

describe('resyncSkipExplanationLine — the runtime-output half of #9184', () => {
  it('is silent when nothing was skipped', () => {
    expect(resyncSkipExplanationLine(0)).toBeNull();
  });

  it('is silent for a negative count too (defensive — should never occur)', () => {
    expect(resyncSkipExplanationLine(-1)).toBeNull();
  });

  it('fires for a full skip (the classic pre-#8692 "resynced 0 / skipped N" case)', () => {
    const line = resyncSkipExplanationLine(8);
    expect(line).not.toBeNull();
    expect(line).toContain('admin');
    expect(line).toContain('user');
    expect(line).toContain('#8692');
  });

  it('fires identically for a PARTIAL skip — same trigger as the summary, not `resynced === 0`', () => {
    // The card requires this line to ride the same condition as the skip
    // summary (`resyncSkipped > 0`), not a narrower "totally stuck" gate. A
    // caller with resynced=3/skipped=2 must get the same explanation as
    // resynced=0/skipped=8.
    expect(resyncSkipExplanationLine(2)).toBe(resyncSkipExplanationLine(8));
  });

  it('says the outcome is expected / by design / not a failure', () => {
    const line = resyncSkipExplanationLine(1)!;
    expect(line.toLowerCase()).toMatch(/expected|by design/);
    expect(line.toLowerCase()).toContain('not a failure');
  });

  it('never claims the admin-owned case is a deliberate override — the framing PR #9183 removed', () => {
    const line = resyncSkipExplanationLine(1)!;
    // The pre-#8692 case is exactly the platform's own seeder inheriting a
    // field default, not an administrator deciding anything — the docblock
    // in bootstrap-platform-admin.ts is explicit that stating this as
    // "(intentional override)" is a lie for those rows. This line must keep
    // that same neutral framing rather than reintroducing it.
    expect(line).toContain("isn't always a deliberate Setup takeover");
    expect(line).not.toMatch(/admin[^.]*\(intentional override\)/i);
  });

  it('keeps the package-owned case correctly framed as ALWAYS deliberate, unlike admin', () => {
    // Unlike a stored 'admin'/'user' stamp, a package-owned row genuinely is
    // always a deliberate override — the docblock draws this distinction and
    // the runtime line must not blur it by applying uniform "override"
    // language to both provenance classes.
    const line = resyncSkipExplanationLine(1)!;
    expect(line).toMatch(/package-owned row.*always a deliberate override/s);
  });
});
