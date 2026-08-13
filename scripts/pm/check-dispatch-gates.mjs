#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check:pm-dispatch-gates (#8162) — the CI gate for the dispatch-gates tool.
 *
 *   node scripts/pm/check-dispatch-gates.mjs   # runs the tool's --self-test
 *
 * ⚠️ This header names repo paths UNQUOTED on purpose — see the last section.
 *
 * ## Why the gate exists
 *
 * scripts/pm/dispatch-gates.mjs derives the "local gates for this card" line of
 * every dispatch prompt. It carried a --self-test from its first commit — 61
 * cases at the time this gate was written, covering workflow extraction, script
 * resolution, watch-hint scanning, the runnable-invocation rendering and the
 * change-kind derivation — and no CI job ran a single one of them. The
 * self-test executed only when a human or an agent typed it, which makes it a
 * check whose coverage is a function of who remembered.
 *
 * The failure that shape produces is quiet: a break in the extraction functions
 * lands green, and it surfaces later as a dispatch prompt naming the WRONG gate
 * families — output that reads as correct, on the very tool whose purpose is to
 * stop gate lists from being memory-shaped. Same family as the changeset gates'
 * self-tests, which is why the workflow step, like theirs, is unconditional.
 *
 * ## Why the self-test ONLY, and not the live derivation
 *
 * The live derivation answers a QUESTION about a card's file surface: it
 * re-reads every workflow file and every check script's source, prints leads,
 * and exits 0 on any completed run. There is no verdict in it for CI to hold —
 * gating on it would buy a slow read of the whole workflow tree whose exit code
 * is 0 by construction. What CI can hold is the half that HAS a verdict, the
 * self-test. That self-test is not fixture-only either: it reads the real
 * pr-automation.yml and walks the real packages tree in the cases where a
 * fixture cannot prove the point, so the derivation's contact with reality is
 * covered by this gate too.
 *
 * ## Why this file exists instead of pointing the script at the tool directly
 *
 * The obvious spelling is to make check:pm-dispatch-gates run the tool's own
 * --self-test, with no file in between. That is the one shape this particular
 * tool cannot have. The derivation resolves a check family to its script file
 * and then scans THAT FILE's source for the path literals it operates on — its
 * watch hints — and dispatch-gates.mjs is a tool whose own tests are made of
 * path strings. Measured on the tree at the time of writing: 49 literals
 * extracted from its source, of which 2 name inputs it really reads and 43 are
 * self-test FIXTURES naming other packages. Wired directly, the derivation
 * printed a MATCHED line for this gate on a card touching spec's filter schema,
 * matched via a fixture string inside the self-test — a fabricated lead in the
 * column the tool's contract reserves for high-signal answers, for most of the
 * tree. The tool's own header rejects exactly that ("22 leads is the same as
 * none"), so shipping it as the price of gating the tool would have taken more
 * from every dispatch prompt than the gate gives back.
 *
 * A separate gate file is also what the other two pm gates look like
 * (check-skill-line-ratchet.mjs, check-skill-id-lint.mjs). Its watch hints are
 * the one constant below: this gate is matched for a card that edits the tool,
 * and for nothing else — which is the blind spot #8162 is about.
 *
 * ## Why the paths above are unquoted
 *
 * Watch-hint extraction reads any quoted-looking span, backticks included, and
 * does not skip comments. Written the ordinary way, with each path in backticks,
 * this header alone yielded ten hints — packages/spec/src, packages/objectql,
 * packages/plugins, packages/drivers, .claude/agents, .changeset among them —
 * and reproduced, from the file explaining the pollution, the exact false
 * MATCHED leads it exists to avoid (measured, not predicted: the first draft of
 * this file did it). So paths are named unquoted here, and the only quoted path
 * in this file is the one input this gate genuinely has.
 *
 * Nothing else belongs in this file. Assertions go in the tool's own self-test,
 * beside the code they judge; this is the CI invocation and its reason.
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';

const ROOT = new URL('../..', import.meta.url).pathname;

/** The tool under test, repo-relative — and this gate's only watch hint. */
const TOOL = 'scripts/pm/dispatch-gates.mjs';

const result = spawnSync(process.execPath, [join(ROOT, TOOL), '--self-test'], { stdio: 'inherit' });

if (result.error) {
  console.error(`✗ check:pm-dispatch-gates: could not run ${TOOL} — ${result.error.message}`);
  process.exit(2);
}
if (result.signal) {
  console.error(`✗ check:pm-dispatch-gates: ${TOOL} --self-test was killed by ${result.signal}.`);
  process.exit(2);
}
process.exit(result.status ?? 2);
