/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/plugin-chatbot` ↔ `@objectstack/spec` symbol-collision guards
 * (objectui#3160, objectstack#4115 ledger batch 6).
 *
 * Four symbols here wore names the spec owns, and they split two ways:
 *
 *  - `PendingActionStatus` / `PendingActionRow` were hand transcriptions of the
 *    `IAIService` contract the REST route serialises. Both are re-exports now,
 *    and the assertions below pin the three drifts the copies carried, each of
 *    which had DISABLED a compile-time check rather than merely differed from
 *    one.
 *
 *  - `Tool` / `MessageContent` live in `src/elements/`, which is not objectui's
 *    authored surface: it is Vercel AI Elements (https://elements.ai-sdk.dev,
 *    MIT) — plus two Shadcn primitives under `elements/ui/` that
 *    `@object-ui/components` does not ship yet — vendored by the same
 *    copy-into-source model as the Shadcn no-touch zone in
 *    `@object-ui/components` and re-synced from upstream.
 *    Those names ARE the upstream component API — renaming them is undone by
 *    the next re-sync and breaks `<Tool><ToolHeader/></Tool>` for anyone reading
 *    upstream's docs — so the guard skips the directory
 *    (`SKIP_PATH_SEGMENTS` in scripts/check-spec-symbol-derivation.mjs) exactly
 *    as it already skips `components/src/ui/`.
 *
 *    A path skip is broader than an ALLOW entry, and the hole it opens is an
 *    objectui-AUTHORED file dropped into that directory and silently unscanned.
 *    `the vendored directory stays vendored` below is what closes it.
 *
 * objectui#3783 added a fifth and sixth pin here for the guard's OTHER hole —
 * the one no allowlist and no path skip is responsible for. `ApproveOutcome` /
 * `RejectOutcome` in the same `usePendingActions.ts` were hand copies of the
 * spec's approve/reject wire responses under DIFFERENT local names, so the
 * name-collision guard was never going to see them: it fires on a spec name
 * being occupied, and these occupied none. A renamed hand copy is invisible to
 * a name-based check by construction, which makes a compile-time parity pin the
 * only thing that can hold them — see
 * `the decision outcomes ARE the spec wire responses` at the bottom.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  ApproveOutcome,
  PendingActionRow,
  PendingActionStatus,
  RejectOutcome,
} from '../usePendingActions';
import type {
  PendingActionRow as SpecPendingActionRow,
  PendingActionStatus as SpecPendingActionStatus,
} from '@objectstack/spec/contracts';
import type {
  ApproveAiPendingActionResponse,
  RejectAiPendingActionResponse,
} from '@objectstack/spec/api';

/** Every name `@objectstack/spec` exports from any subpath — types AND values. */
function specExportNames(): Set<string> {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('@objectstack/spec/package.json');
  const pkgDir = dirname(pkgPath);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    exports?: Record<string, { import?: { types?: string }; require?: { types?: string } }>;
  };

  const files: string[] = [];
  for (const cond of Object.values(pkg.exports ?? {})) {
    if (typeof cond !== 'object' || cond === null) continue;
    const dts = cond.import?.types ?? cond.require?.types;
    if (dts) files.push(resolve(pkgDir, dts));
  }

  const program = ts.createProgram(files, {
    noEmit: true,
    skipLibCheck: true,
    strict: false,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const checker = program.getTypeChecker();

  const names = new Set<string>();
  for (const file of files) {
    const sf = program.getSourceFile(file);
    if (!sf) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    if (!moduleSymbol) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) names.add(exported.getName());
  }
  return names;
}

const SPEC_NAMES = specExportNames();

describe('the spec export-name probe itself works', () => {
  it('reads a non-trivial number of names', () => {
    expect(SPEC_NAMES.size).toBeGreaterThan(1000);
  });

  it('sees TYPE-only exports, not just runtime values', () => {
    expect(SPEC_NAMES.has('PendingActionRow')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The vendored directory                                                      */
/* -------------------------------------------------------------------------- */

const ELEMENTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'elements');
/**
 * The vendored-provenance banner every file there carries. Two upstreams are
 * represented — `vercel/ai-elements` for the chat primitives and `shadcn/ui`
 * for the two `ui/` primitives `@object-ui/components` does not ship yet — and
 * both banners say the same load-bearing thing: sourced from elsewhere, do not
 * edit, re-synced from upstream. That, not the specific project, is what makes
 * the directory not-ours and therefore skippable by the spec-symbol guard.
 */
const VENDOR_BANNER = /Sourced from \S+ \(http[^)]+\) — MIT\./;
/** The one objectui-authored file there: a barrel that re-exports and nothing else. */
const BARREL = 'index.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('the vendored directory stays vendored', () => {
  const files = walk(ELEMENTS_DIR);

  it('finds the files the guard is skipping', () => {
    // If this drops to zero the skip has stopped covering anything and the
    // SKIP_PATH_SEGMENTS entry is stale — delete it rather than leave a path
    // reserved for a future fork.
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.endsWith('tool.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('message.tsx'))).toBe(true);
  });

  it.each(files.map((f) => [f.slice(ELEMENTS_DIR.length + 1), f]))(
    '%s is upstream, not ours',
    (rel, full) => {
      const text = readFileSync(full, 'utf8');
      if (rel === BARREL) {
        // The barrel is objectui's, so it must stay a pure re-export: a
        // DECLARATION added here would be authored code sitting inside the
        // skipped path, invisible to the spec-symbol guard.
        const body = text
          .split('\n')
          .filter((l) => l.trim() && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
          .filter((l) => !l.trim().startsWith('//'));
        for (const line of body) {
          expect(
            /^export \* from '\.\/[\w-]+';$/.test(line.trim()),
            `${rel} declares something of its own (\`${line.trim()}\`). That file is inside ` +
              `SKIP_PATH_SEGMENTS, so the spec-symbol guard cannot see it. Move the ` +
              `declaration to an objectui-authored module outside src/elements/.`,
          ).toBe(true);
        }
        return;
      }
      expect(
        VENDOR_BANNER.test(text),
        `${rel} is inside src/elements/, which scripts/check-spec-symbol-derivation.mjs ` +
          `skips BECAUSE everything there is vendored from upstream. This file carries no ` +
          `vendor banner, so it is either objectui-authored code hiding from the guard, or ` +
          `a re-sync that dropped the banner. Move it out, or restore the banner.`,
      ).toBe(true);
    },
  );

  it('the two collisions the skip covers are still spec names', () => {
    // A reverse pin, per the pattern batch 5 used for `PerformanceConfig`: the
    // guard's SKIP comment names `Tool` and `MessageContent` as the collisions
    // it is waving through. If the spec retires either name that note is stale
    // and the entry deserves a fresh read — the workaround must not outlive its
    // stated reason.
    for (const owned of ['Tool', 'MessageContent']) {
      expect(
        SPEC_NAMES.has(owned),
        `@objectstack/spec no longer exports \`${owned}\` — the SKIP_PATH_SEGMENTS note ` +
          `in scripts/check-spec-symbol-derivation.mjs still cites it as one of the two ` +
          `collisions in src/elements/. Re-read the entry.`,
      ).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time pins. A violation is a `tsc` error, not a runtime failure.      */
/* Compiled by this package's `tsconfig.test.json` (objectui#3181; the narrow  */
/* project that named this file alone was retired in objectui#4291).           */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
/** The `unknown` erasure the `any` probe reports `false` for (objectui#3155). */
type IsUnknown<T> = [unknown] extends [T] ? ([T] extends [unknown] ? true : false) : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
/** objectstack#4075: an index signature absorbs every excess key. */
type HasIndexSignature<T> = string extends keyof T ? true : false;

describe('the pending-action row and status ARE the spec contract', () => {
  it('is pinned at compile time', () => {
    type _RowNotAny = Assert<Equal<IsAny<SpecPendingActionRow>, false>>;
    type _RowNotUnknown = Assert<Equal<IsUnknown<SpecPendingActionRow>, false>>;
    type _StatusNotAny = Assert<Equal<IsAny<SpecPendingActionStatus>, false>>;

    type _RowIsSpec = Assert<Equal<PendingActionRow, SpecPendingActionRow>>;
    type _StatusIsSpec = Assert<Equal<PendingActionStatus, SpecPendingActionStatus>>;

    // Drift 1 — the copy declared `status: PendingActionStatus | string`. A
    // union with `string` ABSORBS the literals, so that annotation carried no
    // information at all: `statusesForTab` could have returned a status the
    // server has never heard of and nothing would have said so.
    type _StatusIsNotString = Assert<Equal<string extends PendingActionStatus ? true : false, false>>;

    // Drift 2 — `[k: string]: unknown`. This is the objectstack#4075 mechanism:
    // with it, ANY structural comparison against the spec answers "identical",
    // however far the copy has drifted, which is why the guard and not a parity
    // test is what found this one.
    type _NoIndexSignature = Assert<Equal<HasIndexSignature<PendingActionRow>, false>>;

    // Drift 3 — `created_at` / `updated_at`, which the contract does not carry
    // and nothing in this repo reads. If the inbox ever needs them the fix is a
    // spec change, not a local widening.
    type _NoCreatedAt = Assert<Equal<'created_at' extends keyof PendingActionRow ? true : false, false>>;
    type _NoUpdatedAt = Assert<Equal<'updated_at' extends keyof PendingActionRow ? true : false, false>>;

    // The vocabulary the inbox's tabs and badges are built on.
    type _Vocabulary = Assert<
      Equal<PendingActionStatus, 'pending' | 'approved' | 'executed' | 'failed' | 'rejected'>
    >;

    expect(true).toBe(true);
  });

  it('still names every status the inbox renders a badge for', () => {
    // A cheap runtime net over the compile-time pin: if the spec RETIRES a
    // status, this fails here rather than as an unstyled badge in the queue.
    const all: PendingActionStatus[] = ['pending', 'approved', 'executed', 'failed', 'rejected'];
    expect(new Set(all).size).toBe(5);
  });
});

describe('the decision outcomes ARE the spec wire responses', () => {
  it('is pinned at compile time', () => {
    type _ApproveNotAny = Assert<Equal<IsAny<ApproveAiPendingActionResponse>, false>>;
    type _ApproveNotUnknown = Assert<Equal<IsUnknown<ApproveAiPendingActionResponse>, false>>;
    type _RejectNotAny = Assert<Equal<IsAny<RejectAiPendingActionResponse>, false>>;

    type _ApproveIsSpec = Assert<Equal<ApproveOutcome, ApproveAiPendingActionResponse>>;
    type _RejectIsSpec = Assert<Equal<RejectOutcome, RejectAiPendingActionResponse>>;

    // Drift 1 — the copy declared `id: string`, REQUIRED, on the APPROVE side.
    // The approve response has no `id` at all; `id` is the REJECT response's.
    // This is the one drift that was not dormant: `useHitlInChat`'s public
    // `onDecided` callback handed consumers this type over a payload that has
    // never carried the field, so `outcome.id` type-checked and evaluated to
    // `undefined`. The pin is `keyof`-shaped rather than an `Equal` on the
    // property type because the failure to catch is the key EXISTING.
    type _ApproveHasNoId = Assert<Equal<'id' extends keyof ApproveOutcome ? true : false, false>>;
    type _RejectHasId = Assert<Equal<RejectOutcome['id'], string>>;

    // Drift 2 — `'executed' | 'failed' | string` and `'rejected' | string`. A
    // union with `string` ABSORBS the literals, so both annotations conveyed
    // nothing; `AiPendingActionsInbox`'s `out.status === 'executed'` could have
    // been compared against any spelling at all.
    type _ApproveStatusNotString = Assert<
      Equal<string extends ApproveOutcome['status'] ? true : false, false>
    >;
    type _RejectStatusNotString = Assert<
      Equal<string extends RejectOutcome['status'] ? true : false, false>
    >;
    type _ApproveVocabulary = Assert<Equal<ApproveOutcome['status'], 'executed' | 'failed'>>;
    type _RejectVocabulary = Assert<Equal<RejectOutcome['status'], 'rejected'>>;

    // Drift 3 — `[k: string]: unknown` on the approve copy. objectstack#4075:
    // with it, this whole describe block would have been green on the copies.
    type _ApproveNoIndexSignature = Assert<Equal<HasIndexSignature<ApproveOutcome>, false>>;
    type _RejectNoIndexSignature = Assert<Equal<HasIndexSignature<RejectOutcome>, false>>;

    expect(true).toBe(true);
  });

  it('the spec still exports the names these are derived from', () => {
    // The reverse pin. `check-spec-symbol-derivation.mjs` cannot cover this
    // pair — the local names are `ApproveOutcome` / `RejectOutcome`, which
    // collide with nothing, and that is exactly how a renamed hand copy hides
    // from a name-based guard. So the only thing standing between these types
    // and a fresh hand copy is the `Assert<Equal<…>>` block above plus this:
    // if the spec renames or retires either response type, the import breaks
    // loudly at compile time instead of the derivation quietly rotting.
    for (const owned of ['ApproveAiPendingActionResponse', 'RejectAiPendingActionResponse']) {
      expect(
        SPEC_NAMES.has(owned),
        `@objectstack/spec no longer exports \`${owned}\`, which ` +
          `packages/plugin-chatbot/src/usePendingActions.ts derives its public ` +
          `\`${owned.startsWith('Approve') ? 'ApproveOutcome' : 'RejectOutcome'}\` from. ` +
          `Re-derive from the replacement — do NOT re-transcribe the shape locally ` +
          `(objectui#3783).`,
      ).toBe(true);
    }
  });

  it('neither local name collides with a spec export', () => {
    // Pins the PREMISE of the two pins above: were either name to become a spec
    // export, `check-spec-symbol-derivation.mjs` would start covering this file
    // for it and this note would be stale.
    for (const local of ['ApproveOutcome', 'RejectOutcome']) {
      expect(SPEC_NAMES.has(local)).toBe(false);
    }
  });
});
