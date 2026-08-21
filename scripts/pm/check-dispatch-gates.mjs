#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check:pm-dispatch-gates (#8162) — the CI gate for the dispatch-gates tool.
 *
 *   node scripts/pm/check-dispatch-gates.mjs   # runs the tool's --self-test
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
 * Those numbers are PRE-MASKING, and the decision they justify survives on
 * narrower grounds than they describe. maskSelfTests now blanks the fixture
 * half outright: measured on this tree, the tool's own source yields 4 hints,
 * not 49 — .github/workflows, which it really reads, and packages/plugins,
 * packages/drivers, packages/services, the bases its package resolver probes.
 * Those three are real reads and still cover three of the largest directories
 * in the tree, so a directly-wired gate would print MATCHED for every card
 * under them — a smaller fabrication than the fixture one, of the same kind.
 * The spec filter path from the incident above no longer matches via fixtures;
 * it matches again today through a declared module-body constant (the clause-②
 * suspect glob), pinned as deliberate in the tool's own self-test and inert for
 * gate matching for the same reason as the tier globs beside it.
 *
 * A separate gate file is also what the other two pm gates look like
 * (check-skill-line-ratchet.mjs, check-skill-id-lint.mjs). Its watch hints are
 * the one constant below: this gate is matched for a card that edits the tool,
 * and for nothing else — which is the blind spot #8162 is about.
 *
 * ## Why the paths above are unquoted, and why that is no longer required
 *
 * The incident is real and worth keeping. Watch-hint extraction reads any
 * quoted-looking span, backticks included, and it USED TO read comments as
 * well. Written the ordinary way, with each path in backticks, this header
 * alone yielded ten hints — packages/spec/src, packages/objectql,
 * packages/plugins, packages/drivers, .claude/agents, .changeset among them —
 * and reproduced, from the file explaining the pollution, the exact false
 * MATCHED leads it exists to avoid (measured, not predicted: the first draft of
 * this file did it). Hence the convention.
 *
 * The extractor no longer works that way: extractWatchHints opens with
 * maskComments, whose own docblock names this file as the specimen it retires.
 * Measured on this tree, with every repo path this header names rewritten into
 * backticks: 1 hint under today's extractor — scripts/pm/dispatch-gates.mjs,
 * the same single hint the file ships with — against 10 under the pre-masking
 * one, reaching spec, objectql, plugins, drivers, .claude/agents and .changeset
 * exactly as the incident describes. Comment masking alone accounts for the
 * difference: masking self-test bodies instead changes nothing here, because
 * this file has none.
 *
 * So the unquoting is no longer load-bearing, and this section is history
 * rather than an instruction: quoting a path in a comment here is now free, and
 * the paths stay unquoted because rewriting them buys nothing. What is NOT free
 * is a path literal in a module body — masking cannot reach one — so the one
 * quoted path below is still the one input this gate genuinely has, and that is
 * the rule to carry into a new gate's header rather than the unquoting.
 *
 * Nothing else belongs in this file. Assertions go in the tool's own self-test,
 * beside the code they judge; this is the CI invocation and its reason.
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';

const ROOT = new URL('../..', import.meta.url).pathname;

/** The tool under test, repo-relative — and one of this gate's two watch hints. */
const TOOL = 'scripts/pm/dispatch-gates.mjs';

/**
 * The tool's shared enumeration module, declared so a card editing it derives
 * this gate (#9116).
 *
 * The tool imports its i18n walks from there instead of mirroring the gate's
 * copies, which is the point of that module — but an import specifier is not a
 * discoverable watch hint (`../i18n-bundle-surface.mjs` strips to a bare
 * filename, which the extractor rejects as unpathy). Without this constant, a
 * change to the shared module would move this gate's verdict — the tool's
 * self-test drives those very functions — while deriving nothing, which is the
 * blind-spot shape the tool exists to remove. Named here, not in the tool: this
 * family resolves to THIS file, and hints are scanned from the file a family
 * resolves to. Pinned live in the tool's own self-test.
 */
const SURFACE_MODULE = 'scripts/i18n-bundle-surface.mjs';

/**
 * The frame-sync gate whose COPIES table the tool's self-test pins the tier
 * mandate against, declared for the same reason as SURFACE_MODULE above
 * (#9116): since the 2026-08-20 clause-① narrowing, part of the
 * fable-mandatory surface is DEFINED as "every file carrying an enforced copy
 * of the decision frame", and the tool's self-test reaches that table through
 * a spawned import — which is not a discoverable watch hint. Without this
 * constant, a change to that gate's COPIES would move this gate's verdict
 * while deriving nothing, which is the blind-spot shape the tool exists to
 * remove. Pinned live in the tool's own self-test.
 */
const FRAME_MODULE = 'scripts/check-skill-frame-sync.mjs';

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
