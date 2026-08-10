// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The ratchet behind `authoring-rules.ts` (#4409; extended to the runtime
// surface in #4463). Supersedes `reference-integrity-wiring.test.ts`, which
// guarded the same seam for one rule family (#3583 §5 D5, #4384) — the suite is
// now one entry in the registry this file guards, so its invariants are carried
// below rather than duplicated.
//
// It moved here from `packages/cli/src/commands/` with the registry itself: the
// table is no longer the CLI's, and a guard that lives in one of the four
// consumers reads as if that consumer were privileged. It scans all four by
// repo-relative path.
//
// ## Why a test and not a comment
//
// The defect is not a wrong result — it is a MISSING CALL, and a missing call
// produces no failing assertion anywhere. Every command's own tests pass, every
// rule's unit tests pass, and the only symptom is that `os validate`, `os build`
// and `os lint` quietly disagree about the same stack.
//
// #4463 is the same defect with the doors counted properly. The three commands
// agreed with each other perfectly — and the runtime write path, the only door
// a Studio tenant or an MCP/AI author has, ran none of the 26 rules at all. A
// guard that asks "do the three commands agree?" answers YES on that state,
// which is why invariant 5 below asks the different question: is every SURFACE
// on the table, and does each one consume the table rather than a list of its
// own?
//
// That failure mode was repaired four times before anyone guarded the mode
// itself: the reference-integrity suite (#3583), the four CLI-local authoring
// lints wired into `build` alone (#3782), `validateReadonlyFlowWrites` missing
// from `lint` (#4384/#4394), and the name-list guard that followed (#4402).
// Each repair removed an instance. #4409 measured what was left: 23 of 26 rules
// on a strict subset of the three commands, nine of them able to emit `error`,
// and `os build` — the command that PUBLISHES — the weakest gate of the three.
//
// #4402's guard could not have caught any of it. It filtered on the CURRENT
// member names of one suite, so a rule wired by hand into two commands from
// outside that suite passed it in silence. A name list only guards the names on
// it; a ratchet guards the shape.
//
// ## The invariants
//
//  1. A rule that can emit `error` runs on all three commands. A gate is only as
//     strong as the weakest command CI happens to run.
//  2. A rule that runs on fewer than three carries a written reason.
//  3. An `advisory` claim is TRUE — checked against the rule's own source, so
//     the tier cannot be used to launder a gate into partial coverage. #3760
//     promoted a `lintFlowPatterns` rule from advisory to gating and nothing
//     anywhere asked whether its coverage should follow.
//  4. No command hand-wires a rule. Every remaining direct call is on the
//     ratchet below with a reason, and adding one is an explicit edit.
//  5. Every rule answers the SURFACE question — it either runs on the runtime
//     publish gate (with the metadata types it judges) or records why not — and
//     the runtime gate consumes this table rather than naming rules itself
//     (#4463).
//
// ## Why it scans source
//
// vitest inlines imports through its transform, so a spy on `@objectstack/lint`
// cannot prove which symbols a command file actually reaches for — the same
// reason `@objectstack/lint`'s `lazy-deps.test.ts` scans `src/` rather than
// probing a module cache. Behavioural coverage of what each rule FINDS lives in
// that rule's own tests; this file guards only the seam between the registry and
// its four call sites.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { REFERENCE_INTEGRITY_RULES } from './reference-integrity-suite.js';
import {
  AUTHORING_COMMANDS,
  AUTHORING_RULES,
  AUTHORING_SURFACES,
  authoringRulesFor,
  type AuthoringCommand,
} from './authoring-rules.js';
import { runtimeAuthoringRulesFor, runtimeGatedTypes, stackKeyForType } from './runtime-gate.js';

const srcDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(srcDir, '..', '..', '..');
const commandsDir = join(repoRoot, 'packages/cli/src/commands');

/** The command source file each authoring command lives in. */
const COMMAND_FILES: Readonly<Record<AuthoringCommand, string>> = {
  validate: 'validate.ts',
  build: 'compile.ts',
  lint: 'lint.ts',
};

/**
 * The runtime surface's own call site: the ONE place the metadata write path
 * reaches the shared core. Scanned for the same two things the command files
 * are — that it runs the registry, and that it names no rule of its own.
 */
const RUNTIME_GATE_FILE = 'packages/metadata-protocol/src/runtime-authoring-gate.ts';

const sourceOf = (file: string) => readFileSync(join(commandsDir, file), 'utf8');

/**
 * Rules a command file may still call directly, each with the reason it is not
 * a registry entry.
 *
 * This is the ratchet — the `FLOW_WRITE_NODE_TYPES_DEFERRED` / `TEST_DEBT`
 * discipline applied to rule wiring. Adding a key here is a deliberate claim
 * that the rule is NOT one of the three commands' shared author-time checks;
 * anything else belongs in `AUTHORING_RULES`, where all three commands get it
 * at once. A rule that merely reads the stack does not qualify, no matter how
 * convenient the local call site is.
 */
const DIRECT_CALL_RATCHET: Readonly<Record<string, string>> = {
  lintConfig:
    "`os lint`'s own entry point, defined in lint.ts itself — the rubric (naming, labels, structure), " +
    'not a shared authoring rule. Its `error` severity is a lint verdict, not a publish gate.',
  lintDataModel:
    "`os lint`'s data-model best-practice sweep (ADR-0035 conventions + the eval rubric in score.ts). " +
    'Deliberately lint-only: `os build` has never rejected a lookup that should have been a ' +
    'master_detail, and making it do so is a product decision, not a wiring fix.',
  lintUnknownStackKeys:
    'Needs `ObjectStackDefinitionSchema` to diff the authored keys against what the schema declares, ' +
    'and must read the PRE-parse stack, which only the two commands that parse actually have. ' +
    '`os lint` never parses, so it has nothing to diff against.',
  lintUnknownAuthoringKeys:
    'The object/field half of the same pre-parse key diff (#3786) — wired with, and for the same ' +
    'reason as, `lintUnknownStackKeys`.',
};

/**
 * Symbols a command file may import from `@objectstack/lint` without being a
 * registry entry. Same ratchet discipline, on the import rather than the call —
 * `buildAccessMatrix`/`diffAccessMatrix` do not match the `lint*`/`validate*`
 * naming convention the call-site scan keys on, so the import scan is what
 * covers them.
 */
const LINT_IMPORT_RATCHET: Readonly<Record<string, string>> = {
  buildAccessMatrix:
    '[ADR-0090 D6] Derives the (permission set × object) capability matrix. Not a rule — it produces ' +
    'the snapshot `os build` diffs against a committed file, so it is an artifact step, not a check.',
  diffAccessMatrix:
    'The other half of the D6 snapshot gate: it compares a committed `access-matrix.json` against the ' +
    'matrix above. Reads a file next to the config, so it cannot run where that file may not exist.',
  // The registry's own API. Importing THESE is the sanctioned wiring — it is
  // importing a RULE that is not (#4409). They became cross-package imports in
  // #4463 when the table moved to `@objectstack/lint`, so the import scan sees
  // them where it previously saw a relative path.
  runAuthoringRules:
    'The registry runner itself — the ONE call every surface is required to make. Ratcheted so the ' +
    'import scan does not read the sanctioned wiring as a hand-wired rule.',
  authoringRulesFor:
    'Registry query (which rules does this command run), used to report coverage in `--json` output. ' +
    'Reads the table; runs nothing.',
  splitBySeverity:
    'Pure partition of a finding list into gating vs advisory. Carries no rule identity at all.',
  lintDataModel:
    "`os lint`'s data-model best-practice sweep — see DIRECT_CALL_RATCHET above for why it is " +
    'deliberately lint-only. It relocated into `@objectstack/lint` with the rest of the rules in ' +
    '#4463, so the import scan now sees it too.',
};

/** Every registry rule name, plus the member names of the suite it embeds. */
const REGISTRY_NAMES = new Set<string>([
  ...AUTHORING_RULES.map((r) => r.name),
  ...REFERENCE_INTEGRITY_RULES.map((r) => r.name),
]);

/**
 * Rules `@objectstack/lint` EXPORTS but that no authoring command runs, each
 * with the reason it is legitimately unwired (#4449).
 *
 * Empty, and that is the healthy state. An entry here is a written claim that
 * the rule has a consumer OTHER than the three commands (a Studio panel, an MCP
 * authoring surface) — not a parking space for one nobody got round to wiring.
 * Under ADR-0049 enforce-or-remove, a rule with no consumer at all is deleted,
 * not ledgered.
 */
const UNWIRED_RULE_LEDGER: Readonly<Record<string, string>> = {};

/**
 * Names the unwired-rule closure treats as wired-with-a-reason: anything the
 * DIRECT_CALL_RATCHET already justifies. Before #4463 those rules lived in the
 * CLI and never appeared on `@objectstack/lint`'s export surface, so the two
 * ratchets could not overlap; the relocation made them overlap, and answering
 * the same question twice in two ledgers is how ledgers rot.
 */
const ratchetedElsewhere = (name: string) => name in DIRECT_CALL_RATCHET;

/**
 * Every `validate*` / `lint*` symbol the lint package's public barrel exports —
 * read from source for the same reason the call-site scans are: vitest inlines
 * imports, so the module namespace object cannot tell an exported RULE from an
 * exported helper the way the naming convention can.
 */
function exportedLintRules(): string[] {
  const source = readFileSync(join(repoRoot, 'packages/lint/src/index.ts'), 'utf8');
  const names = new Set<string>();
  for (const m of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
      if (name && /^(?:validate|lint)[A-Z]/.test(name)) names.add(name);
    }
  }
  return [...names].sort();
}

/** Every `lintFoo(`/`validateFoo(` call site in a source file. */
function ruleCallsIn(source: string): string[] {
  return [...new Set(source.match(/\b(?:lint|validate)[A-Z]\w*(?=\s*\()/g) ?? [])];
}

/** Every symbol imported from `@objectstack/lint` by a source file. */
function lintImportsIn(source: string): string[] {
  const names: string[] = [];
  const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@objectstack\/lint['"]/g;
  for (const m of source.matchAll(importRe)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  return [...new Set(names)];
}

/**
 * The body of `export function <name>`, up to the next top-level `export` (or
 * end of file) — so a module hosting several rules is read one rule at a time.
 *
 * Known limitation, stated rather than hidden: a finding emitted from a helper
 * declared ABOVE the export is outside the slice. The check is a ratchet on the
 * common shape (a rule emits its own findings), not a proof.
 */
function ruleBody(source: string, name: string): string | null {
  const start = source.indexOf(`export function ${name}`);
  if (start < 0) return null;
  const rest = source.slice(start + 1);
  const end = rest.indexOf('\nexport ');
  return end < 0 ? rest : rest.slice(0, end);
}

/** Does this rule body emit `severity: 'error'`? (Union type declarations do not count.) */
function emitsError(body: string): boolean {
  const withoutTypeDecls = body
    .split('\n')
    .filter((line) => !/severity\??:\s*(?:'[a-z]+'\s*\|\s*)+'[a-z]+'/.test(line))
    .join('\n');
  return /severity:[^;\n]*'error'/.test(withoutTypeDecls);
}

describe('authoring-rule registry wiring (#4409)', () => {
  it.each([...AUTHORING_COMMANDS])('os %s runs the registry and nothing by hand', (command) => {
    const source = sourceOf(COMMAND_FILES[command]);
    expect(source, `${COMMAND_FILES[command]} must run the registry`).toMatch(/\brunAuthoringRules\s*\(/);

    const handWired = ruleCallsIn(source).filter((name) => REGISTRY_NAMES.has(name));
    expect(
      handWired,
      `${COMMAND_FILES[command]} calls registry rule(s) directly: ${handWired.join(', ')}.\n` +
        `Run them through runAuthoringRules() instead — a per-rule call site is exactly how a rule ` +
        `ends up on two commands out of three (#3782, #4394, #4409).`,
    ).toEqual([]);
  });

  it.each([...AUTHORING_COMMANDS])('os %s has no unratcheted direct rule call', (command) => {
    const source = sourceOf(COMMAND_FILES[command]);
    const unratcheted = ruleCallsIn(source)
      .filter((name) => !REGISTRY_NAMES.has(name))
      .filter((name) => !(name in DIRECT_CALL_RATCHET))
      .sort();

    expect(
      unratcheted,
      `${COMMAND_FILES[command]} hand-wires ${unratcheted.length} rule(s) the registry does not know ` +
        `about: ${unratcheted.join(', ')}.\n` +
        `Add each to AUTHORING_RULES in packages/lint/src/authoring-rules.ts so all three commands ` +
        `run it — or, if it genuinely is not a shared author-time rule (it needs the filesystem, the ` +
        `emitted artifact, or it belongs to os lint's own style rubric), add it to DIRECT_CALL_RATCHET ` +
        `in this file WITH the reason. Silence is the one option that is not available.`,
    ).toEqual([]);
  });

  it.each([...AUTHORING_COMMANDS])('os %s imports no unratcheted symbol from @objectstack/lint', (command) => {
    const source = sourceOf(COMMAND_FILES[command]);
    const unratcheted = lintImportsIn(source)
      .filter((name) => !(name in LINT_IMPORT_RATCHET))
      .sort();

    expect(
      unratcheted,
      `${COMMAND_FILES[command]} imports ${unratcheted.join(', ')} from @objectstack/lint directly. ` +
        `Register the rule in AUTHORING_RULES, or add the symbol to LINT_IMPORT_RATCHET with a reason.`,
    ).toEqual([]);
  });

  // ── The invariant the issue exists for ───────────────────────────────

  /**
   * Gating rules that do NOT yet run on all three commands, each with the reason
   * and the plan to close it.
   *
   * Empty, and that is the healthy state — a stack must not be publishable
   * through a command that skips a gate another command enforces. An entry here
   * is a KNOWN hole: `os build` may ship what `os lint` refuses, or the reverse.
   */
  const GATING_COVERAGE_DEBT: Readonly<Record<string, string>> = {};

  it('every gating rule runs on all three commands', () => {
    const holes = AUTHORING_RULES.filter((r) => r.tier === 'gating')
      .filter((r) => r.commands.length !== AUTHORING_COMMANDS.length)
      .filter((r) => !(r.name in GATING_COVERAGE_DEBT))
      .map((r) => `${r.name} (runs on: ${r.commands.join(', ')})`);

    expect(
      holes,
      `${holes.length} rule(s) can emit \`error\` but do not run on all three authoring commands: ` +
        `${holes.join('; ')}.\n` +
        `A gate is only as strong as the weakest command an author or CI happens to run, so partial ` +
        `coverage is not a stricter check — it is a coin flip. Widen \`commands\` to all three.`,
    ).toEqual([]);
  });

  it('the three commands run the identical gating set', () => {
    const gatingFor = (command: AuthoringCommand) =>
      authoringRulesFor(command)
        .filter((r) => r.tier === 'gating')
        .map((r) => r.name)
        .sort();

    const [validate, build, lint] = AUTHORING_COMMANDS.map(gatingFor);
    expect(build, 'os build must gate on exactly what os validate gates on').toEqual(validate);
    expect(lint, 'os lint must gate on exactly what os validate gates on').toEqual(validate);
  });

  it('every narrowed rule carries a reason', () => {
    const unexplained = AUTHORING_RULES.filter((r) => r.commands.length !== AUTHORING_COMMANDS.length)
      .filter((r) => (r.scopeReason ?? '').trim().length < 40)
      .map((r) => r.name);

    expect(
      unexplained,
      `${unexplained.join(', ')} run(s) on fewer than three commands with no substantive scopeReason. ` +
        `A narrowing must be a written decision, not an omission — that distinction IS the fix (#4409).`,
    ).toEqual([]);
  });

  // ── The fourth door: the runtime publish gate (#4463) ────────────────
  //
  // Everything above measures the three CLI commands against each other. They
  // agreed with each other perfectly on the day #4463 was filed, and the
  // metadata write path — the only door a Studio tenant, a REST `/meta` client
  // or an MCP/AI author has — ran zero of the 26 rules. These four cases ask
  // the question that state answers NO to.

  describe('runtime publish surface', () => {
    it('every rule answers the surface question — runs there, or says why not', () => {
      const silent = AUTHORING_RULES.filter((r) => !r.surfaces.includes('runtime-publish'))
        .filter((r) => (r.surfaceReason ?? '').trim().length < 40)
        .map((r) => r.name);

      expect(
        silent,
        `${silent.length} rule(s) neither run on the runtime publish gate nor record why: ` +
          `${silent.join(', ')}.\n` +
          `Set \`surfaces: CLI_AND_RUNTIME\` with \`runtimeTypes\`, or record a substantive ` +
          `\`surfaceReason\`. Silence is what #4409 fixed on the command axis and what #4463 found ` +
          `still true on the surface axis — a rule nobody decided about runs nowhere by default, and ` +
          `the default door is the one every tenant uses.`,
      ).toEqual([]);
    });

    it('every runtime-wired rule declares the metadata types it judges', () => {
      const undeclared = AUTHORING_RULES.filter((r) => r.surfaces.includes('runtime-publish'))
        .filter((r) => (r.runtimeTypes ?? []).length === 0)
        .map((r) => r.name);

      expect(
        undeclared,
        `${undeclared.join(', ')} claim(s) the runtime surface without naming a metadata type. The ` +
          `gate dispatches on the written item's type, so an empty \`runtimeTypes\` is a rule that ` +
          `is wired and runs on nothing — the #4449 shape, one surface over.`,
      ).toEqual([]);
    });

    it('every runtime-gated metadata type maps to a stack key', () => {
      // Without a mapping the gate silently no-ops for that type: it would find
      // the rules, build no snapshot, and return clean. Exactly the "looks
      // wired, enforces nothing" state this whole file exists to make loud.
      const unmapped = runtimeGatedTypes().filter((t) => stackKeyForType(t) === null);
      expect(
        unmapped,
        `runtime-gated type(s) with no stack-key mapping in runtime-gate.ts: ${unmapped.join(', ')}. ` +
          `The gate cannot build a snapshot for them, so the rules that declare them run on nothing.`,
      ).toEqual([]);
    });

    it('the runtime gate consumes the registry and names no rule of its own', () => {
      const path = join(repoRoot, RUNTIME_GATE_FILE);
      expect(existsSync(path), `${RUNTIME_GATE_FILE} must exist — it IS the runtime surface`).toBe(true);
      const source = readFileSync(path, 'utf8');

      expect(source, `${RUNTIME_GATE_FILE} must run the shared core`).toMatch(
        /\brunRuntimeAuthoringRules\s*\(/,
      );

      // The same subtraction the three commands get: a rule named at the gate
      // is a rule that can drift from the table.
      const handWired = ruleCallsIn(source).filter((name) => REGISTRY_NAMES.has(name));
      expect(
        handWired,
        `${RUNTIME_GATE_FILE} calls registry rule(s) directly: ${handWired.join(', ')}.\n` +
          `The runtime gate must reach them ONLY through runRuntimeAuthoringRules(). Hand-wiring one ` +
          `here rebuilds, on a fourth surface, the exact drift #3583 → #4409 took five repairs to end.`,
      ).toEqual([]);

      // And it must not reach past the kernel-safe entry: `@objectstack/lint`'s
      // root barrel pulls the react/jsx rules' module graph, which is the one
      // thing the boot path may not name (`lazy-deps.test.ts`).
      expect(
        source,
        `${RUNTIME_GATE_FILE} must import from '@objectstack/lint/runtime', not the root barrel — ` +
          `the root entry reaches the typescript/sucrase rules the kernel boot path must not name.`,
      ).not.toMatch(/from\s*['"]@objectstack\/lint['"]/);
    });

    it('the runtime gate and the CLI commands read the SAME array', () => {
      // The property the issue asked to be provable: delete a rule from
      // AUTHORING_RULES and BOTH sides lose it in the same commit. Asserted by
      // identity of membership, not by an import statement — an import proves a
      // module was loaded, never that the rule set came from it.
      for (const rule of AUTHORING_RULES) {
        if (!rule.surfaces.includes('runtime-publish')) continue;
        for (const type of rule.runtimeTypes ?? []) {
          expect(
            runtimeAuthoringRulesFor(type).map((r) => r.name),
            `${rule.name} declares runtime type '${type}' but the runtime gate does not run it`,
          ).toContain(rule.name);
        }
        expect(
          authoringRulesFor('build').map((r) => r.name),
          `${rule.name} runs at the runtime publish gate but not on os build — the two publish verbs ` +
            `must not disagree`,
        ).toContain(rule.name);
      }

      // Non-vacuous: #4463's worked example really is on both sides.
      expect(runtimeGatedTypes()).toContain('flow');
      expect(runtimeAuthoringRulesFor('flow').map((r) => r.name)).toContain('validateApprovalApprovers');
      expect(runtimeAuthoringRulesFor('flow').map((r) => r.name)).toContain('validateStackExpressions');
      // A type nobody gated returns nothing rather than everything.
      expect(runtimeAuthoringRulesFor('translation')).toEqual([]);
    });

    // ── #7220: a rule FAMILY crosses this wall together, or not at all ──
    //
    // The guard above makes each rule answer the surface question. It cannot
    // catch the failure #7220 names, because every individual answer is
    // well-formed: a family whose members split across the wall passes every
    // assertion in this file and still ships a door where one verdict about a
    // predicate is enforced and its siblings are not. #7214's implementer built
    // exactly that state, measured it, and reverted it.
    //
    // So the family is pinned by NAME here. This is deliberately a stronger
    // ratchet than a `surfaceReason` string: a reason is prose that goes stale
    // silently, while this fails the moment someone moves one of the two entries
    // and not the other — in either direction.
    it('the `views[]` visibility-predicate family sits on ONE side of the wall', () => {
      const FAMILY = ['validateVisibilityPredicates', 'validatePredicatePathRefs'];

      const entries = FAMILY.map((name) => {
        const entry = AUTHORING_RULES.find((r) => r.name === name);
        expect(entry, `${name} left AUTHORING_RULES — re-point this pin or retire it`).toBeDefined();
        return entry!;
      });

      const wired = entries.filter((e) => e.surfaces.includes('runtime-publish'));
      expect(
        wired.length === 0 || wired.length === entries.length,
        `the views[] visibility-predicate family is SPLIT across the runtime publish gate: `
          + `${wired.map((e) => e.name).join(', ') || '(none)'} run at the door and `
          + `${entries.filter((e) => !e.surfaces.includes('runtime-publish')).map((e) => e.name).join(', ')} `
          + `do not. All of these rules judge the SAME predicate on the SAME surface, so an author `
          + `whose view is refused for one defect and waved through for a sibling defect cannot `
          + `predict the door. Move them together (#7220's ruling) or not at all.`,
      ).toBe(true);

      // Same discipline on the type axis: two family rules gating different
      // metadata types is the same split wearing a different hat.
      const typeSets = new Set(entries.map((e) => [...(e.runtimeTypes ?? [])].sort().join(',')));
      expect(
        typeSets.size,
        `the family's members declare different runtimeTypes (${[...typeSets].join(' vs ')}) — `
          + `a view write would reach some of them and not others`,
      ).toBe(1);

      // Non-vacuous, and the record of where #7220 left this: both are wired,
      // for `view`. Flipping the family back to CLI-only is a legal edit that
      // must go through this line rather than around it.
      expect(wired.map((e) => e.name)).toEqual(FAMILY);
      expect(runtimeAuthoringRulesFor('view').map((r) => r.name)).toEqual(FAMILY);
    });
  });

  it('every rule declares a source file that exists', () => {
    const missing = AUTHORING_RULES.filter((r) => !existsSync(join(repoRoot, r.source))).map(
      (r) => `${r.name} → ${r.source}`,
    );
    expect(missing, `stale source path(s): ${missing.join(', ')}`).toEqual([]);
  });

  it('every advisory rule really is advisory', () => {
    // The check that keeps the tier honest: without it, mislabelling a gate as
    // advisory would silently buy it the right to partial coverage.
    const liars = AUTHORING_RULES.filter((r) => r.tier === 'advisory')
      .map((r) => {
        const body = ruleBody(readFileSync(join(repoRoot, r.source), 'utf8'), r.name);
        if (body === null) return `${r.name} (no \`export function ${r.name}\` in ${r.source})`;
        return emitsError(body) ? `${r.name} (${r.source} emits severity: 'error')` : null;
      })
      .filter((x): x is string => x !== null);

    expect(
      liars,
      `${liars.join('; ')}.\n` +
        `A rule that can emit \`error\` is \`gating\` and must run on all three commands. Change its ` +
        `tier and widen \`commands\` — do not leave a gate wearing an advisory label.`,
    ).toEqual([]);
  });

  // ── The other direction: a rule wired NOWHERE (#4449) ────────────────

  /**
   * The invariants above all start FROM a registry and look at the commands.
   * That view is blind by construction to a rule that never entered a registry:
   * `validateFormLayout` was implemented, unit-tested, exported and given four
   * published rule ids, and ran on zero stacks for as long as it existed. The
   * closure is the reverse subtraction — exported rules MINUS both registries —
   * which is the shape #4402 (a name list guards only the names on it) and
   * #4409 (a registry guards only what entered it) each missed one layer down.
   */
  it('every rule @objectstack/lint exports is wired into a registry', () => {
    const unwired = exportedLintRules()
      .filter((name) => !REGISTRY_NAMES.has(name))
      .filter((name) => !ratchetedElsewhere(name))
      .filter((name) => !(name in UNWIRED_RULE_LEDGER));

    expect(
      unwired,
      `@objectstack/lint exports ${unwired.length} rule(s) that no authoring command runs: ` +
        `${unwired.join(', ')}.\n` +
        `A rule on the public export surface reads — to a human and to an AI author alike — as a ` +
        `check the platform performs. Either register it in AUTHORING_RULES ` +
        `(packages/lint/src/authoring-rules.ts) so all three commands run it, or add it to ` +
        `UNWIRED_RULE_LEDGER in this file WITH the real consumer that justifies it — or delete it ` +
        `under ADR-0049 enforce-or-remove. Advertising it while running it nowhere is the one option ` +
        `that is not available (Prime Directive #10).`,
    ).toEqual([]);
  });

  it('the form-layout rule really runs, and really finds something', () => {
    // The wiring assertion above proves membership. This proves the entry is
    // live end to end: the rule reaches all three commands AND its `run`
    // adapter returns the finding a broken stack earns. Both halves matter —
    // #4449 is precisely a rule that existed, passed its own unit tests, and
    // produced no output on any real stack.
    for (const command of AUTHORING_COMMANDS) {
      expect(
        authoringRulesFor(command).map((r) => r.name),
        `os ${command} must run validateFormLayout`,
      ).toContain('validateFormLayout');
    }

    const entry = AUTHORING_RULES.find((r) => r.name === 'validateFormLayout')!;
    const findings = entry.run(
      {
        objects: [{ name: 'widget', fields: { title: { type: 'text' } } }],
        views: [
          {
            name: 'widget_form',
            data: { object: 'widget' },
            sections: [{ fields: [{ field: 'no_such_field', colSpan: 2 }] }],
          },
        ],
      },
      {},
    );
    expect(findings.map((f) => f.rule).sort()).toEqual([
      'absolute-colspan-discouraged',
      'form-field-unknown',
    ]);
  });

  it('every ledger entry is still an exported rule', () => {
    // Same anti-rot discipline as the two ratchets: an entry naming a rule that
    // no longer exists silently widens the allowance for the next one.
    const exported = new Set(exportedLintRules());
    const stale = Object.keys(UNWIRED_RULE_LEDGER).filter((n) => !exported.has(n));
    expect(stale, `UNWIRED_RULE_LEDGER entries no longer exported: ${stale.join(', ')}`).toEqual([]);
  });

  // ── Guards the guard ─────────────────────────────────────────────────

  it('the registry is non-empty and still holds the rules that motivated it', () => {
    expect(AUTHORING_RULES.length).toBeGreaterThan(20);
    const names = AUTHORING_RULES.map((r) => r.name);
    // The three that `os build` was blind to — it published what the other
    // commands refuse. `validateApprovalApprovers` is #4409's worked example.
    expect(names).toContain('validateApprovalApprovers');
    expect(names).toContain('validateListViewMode');
    expect(names).toContain('validateViewContainers');
    // The gating pair `os lint` was blind to, so the cheap pre-flight passed
    // stacks the build rejects.
    expect(names).toContain('lintAutonumberFormats');
    expect(names).toContain('lintViewRefs');
    // The suite #3583/#4402 built, now one entry among the rest.
    expect(names).toContain('validateReferenceIntegrity');
    expect(REFERENCE_INTEGRITY_RULES.length).toBeGreaterThan(0);
    // The rule whose absence from `os lint` motivated the suite's own guard.
    expect(REFERENCE_INTEGRITY_RULES.map((r) => r.name)).toContain('validateReadonlyFlowWrites');
    // #4463: every entry declares `cli`, and at least one declares the runtime
    // gate — a table where nothing does would pass every surface case above by
    // vacuity, which is precisely the state the issue was filed about.
    expect(AUTHORING_SURFACES).toEqual(['cli', 'runtime-publish']);
    expect(AUTHORING_RULES.every((r) => r.surfaces.includes('cli'))).toBe(true);
    expect(AUTHORING_RULES.filter((r) => r.surfaces.includes('runtime-publish')).length).toBeGreaterThan(0);
  });

  it('the source scans still match something (non-vacuous)', () => {
    // If the extraction regexes silently stop matching, every set-difference
    // above passes while checking nothing.
    expect(ruleCallsIn(sourceOf('lint.ts')).length).toBeGreaterThan(0);
    expect(lintImportsIn(sourceOf('compile.ts')).length).toBeGreaterThan(0);
    expect(emitsError("severity: 'error',")).toBe(true);
    expect(emitsError("severity: 'error' | 'warning';")).toBe(false);
    expect(emitsError("if (f.severity === 'error') return;")).toBe(false);
    // The export scan feeding the unwired-rule closure: if it stops matching,
    // that set difference is empty for the wrong reason.
    const exported = exportedLintRules();
    expect(exported.length).toBeGreaterThan(20);
    expect(exported).toContain('validateReferenceIntegrity');
    expect(exported).toContain('validateFormLayout');
  });

  it('every ratchet entry is still load-bearing', () => {
    // A ratchet nobody prunes rots into a permission slip. Each entry must
    // correspond to a call/import that actually exists somewhere.
    const allCalls = new Set(Object.values(COMMAND_FILES).flatMap((f) => ruleCallsIn(sourceOf(f))));
    const staleCalls = Object.keys(DIRECT_CALL_RATCHET).filter((n) => !allCalls.has(n));
    expect(staleCalls, `DIRECT_CALL_RATCHET entries with no call site left: ${staleCalls.join(', ')}`).toEqual([]);

    const allImports = new Set(Object.values(COMMAND_FILES).flatMap((f) => lintImportsIn(sourceOf(f))));
    const staleImports = Object.keys(LINT_IMPORT_RATCHET).filter((n) => !allImports.has(n));
    expect(staleImports, `LINT_IMPORT_RATCHET entries with no import left: ${staleImports.join(', ')}`).toEqual([]);
  });
});
