// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `pnpm --filter @objectstack/scenarios run-scenarios [flags]` — run every card
 * under `docs/qa/scenarios/` end to end and write one run record per card.
 *
 *   --cards DIR          the card directory (default: the repo's docs/qa/scenarios,
 *                        or the copy the published package carries, `library.ts`);
 *                        any other directory is loaded as the private overlay,
 *                        where a `generic` card is refused (`libraryOf`)
 *   --only ID[,ID]       run only these cards
 *   --modes M[,M]        scratch, template, ask, door (default: scratch,template);
 *                        ask runs only the questions and operations on a
 *                        verified build — --template F, else this run's
 *                        scratch build when it passed — and authors nothing,
 *                        so ask without --template and without scratch is
 *                        refused before any card runs; door builds through
 *                        the app's MCP draft door with no project, publishes
 *                        the drafts as a person, then scores and runs the Run
 *                        half (`door.ts`, `doorMode`); the live `claude`
 *                        driver or a replay only
 *   --door-skills DIR    door mode: give the client the Claude Code skills in
 *                        DIR (the published `skills/`), as --ask-skills gives
 *                        them; absent ⇒ none
 *   --door-skill-omit N[,N]
 *                        door mode: leave these skills of --door-skills out,
 *                        the arm without them; a name DIR holds no skill of
 *                        is refused
 *   --door-rules builtin door mode: give the client the built-in rule texts,
 *                        the hosted MCP build door's authoring rules ported as
 *                        data (`door-rules-corpus.ts` names their source)
 *   --door-rules FILE    door mode: give the client the rule texts in FILE
 *                        instead, a rules file the maintainer supplies from
 *                        outside the repository (`door.ts` states the format);
 *                        default the OS_SCENARIOS_DOOR_RULES variable (a file
 *                        or `builtin`); absent ⇒ none
 *   --door-rules-omit S[,S]
 *                        door mode: leave these rule ids or named sets of the
 *                        rules out, the arm without them (the built-in sets:
 *                        metadata-authoring, solution-design, inline,
 *                        ondemand, names-build-door-tools)
 *   --driver claude      the local Claude Code CLI on your own login (default)
 *   --driver codex       the local OpenAI Codex CLI on your own ChatGPT plan
 *                        login (`drivers/codex.ts`); it has no turn cap and no
 *                        effort flag, so the two --*-max-turns flags and the
 *                        three effort flags are refused with it
 *   --driver external:C  any command C that speaks the driver contract (one
 *                        process per call, JSON in on stdin, JSON out on stdout;
 *                        `drivers/external.ts` and the package README); every
 *                        flag below reaches it in the call's `limits`
 *   --driver recorded:F  replay the recording F (no model, no network to a model)
 *   --record F           also save every live turn to F, for later replay
 *   --author-timeout MIN the live driver's budget per authoring turn, build and
 *                        iterate alike (default 60); a turn it kills leaves its
 *                        Build half not measured
 *   --author-max-turns N the live driver's turn cap per authoring turn, build
 *                        and iterate alike, on every card (default by the card's
 *                        tier: control 80, starter 300, delivery 600); a turn
 *                        that reaches it (`error_max_turns`) leaves its Build
 *                        half not measured
 *   --ask-max-turns N    the live driver's turn cap per question or operation
 *                        turn (default 12)
 *   --ask-repeats N      ask each (question, persona) turn N times on the same
 *                        booted app, each ask a fresh agent session, and score
 *                        k/N per turn (default 1); operations run once. Any
 *                        driver: a replay (`recorded:`) reads the first N asks
 *                        the recording holds of each question turn, and an N
 *                        it holds fewer of is refused before any card runs
 *   --model M            the model every live turn asks for, an alias (`sonnet`)
 *                        or a name (`claude-sonnet-4-5`), as `claude --model`
 *                        takes it (default: the login's own)
 *   --author-model M     the model for authoring turns, build and iterate, in
 *                        place of --model
 *   --ask-model M        the model for question and operation turns, in place
 *                        of --model; the record and the scorecard state the
 *                        model each turn was served, and mark a mismatch
 *   --ask-skills DIR     give every question and operation turn the Claude Code
 *                        skills in DIR (one skill directory holding SKILL.md,
 *                        or a directory of them): each turn's directory gets
 *                        them under .claude/skills/ and the turn may use the
 *                        Skill tool. Off by default; the record states each
 *                        skill's name, version and sha256 (`ask-skills.ts`).
 *                        The live `claude` driver only
 *   --effort LEVEL       the effort level every live turn asks for, as
 *                        `claude --effort` takes it (Claude Code 2.1.325: low,
 *                        medium, high, xhigh, max); a level the CLI's own
 *                        `--help` does not list is refused before any card
 *                        runs (default: CLAUDE_CODE_EFFORT_LEVEL when set, else
 *                        the CLI's default effort)
 *   --author-effort L    the effort for authoring turns, in place of --effort
 *   --ask-effort L       the effort for question and operation turns, in place
 *                        of --effort; the record and the scorecard state the
 *                        effort each turn asked for beside its served model
 *   --lang zh|en         render every card text a prompt carries (the build
 *                        prompt, the iterate change, each question's and each
 *                        operation's ask) in this language and no other; a
 *                        card missing one that the run's modes render is
 *                        skipped before the first card runs, naming each
 *                        missing text, and the other cards run. The runner's
 *                        own wrapper text stays in English (default: each
 *                        text in English when the card has it, else Chinese)
 *   --prompt short|detailed
 *                        the card prompt the build turn is given (default
 *                        detailed); the iterate turn is unchanged. The record
 *                        and the scorecard state both choices when either
 *                        flag is given, a recording carries them, and a
 *                        replay (`recorded:`) under other choices than its
 *                        recording's is refused before any card runs
 *   --template F         a verified build (dist/objectstack.json) for template
 *                        and ask modes; a record whose template or ask mode
 *                        installed it names its file and sha256 (`template`),
 *                        so `summary` can tell runs on one build from another's
 *   --no-iterate-run     skip the Run half after the iterate (scratch mode)
 *   --out DIR            where records go (default docs/qa/platform-checklist/runs, git-ignored;
 *                        ./scenario-runs when run from the published package)
 *   --work DIR           where projects are scaffolded (default: a temp dir)
 *   --create-version V   the create-objectstack version (default latest)
 *   --packages P         where the @objectstack/* packages come from (`packages.ts`):
 *                        `published` (default) — npm, what a customer gets;
 *                        `workspace` — this checkout, built and packed as the
 *                        release would publish it (unreleased; never exported;
 *                        refused when run from the published package, which has no checkout)
 *
 * `run-scenarios summary <record|dir>…` (`objectstack-scenarios summary`) reads
 * run records back instead and prints one author-model × ask-model table per
 * card and mode (`summary.ts`; its own flags, `--card` and `--mode`).
 *
 * ⛔ No API-billed model: the live driver refuses to start when an API key is
 * configured (the cost ruling on cloud#3600).
 */

import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatRefusal, libraryOf, loadScenarios, readCapabilityAreas, type LoadedScenario } from '../loader.js';
import { HttpApp } from './app.js';
import { askSkillsText } from './ask-skills.js';
import { DOOR_RULES_ENV, doorArmText, doorModeRefusal, readDoorRules } from './door.js';
import { ClaudeCodeDriver, RecordedDriver, RecordingDriver, type AgentDriver } from './driver.js';
import { CodexDriver } from './drivers/codex.js';
import { ExternalDriver } from './drivers/external.js';
import { CAPABILITY_AREAS_DIR, locateLibraryRoot } from './library.js';
import { askModeRefusal, minutesText, runCard, type CardRun, type ProjectOps } from './orchestrate.js';
import { installedSpecVersion, PACKAGES_MODES, prepareWorkspacePackages, settleWorkspaceProject, workspaceScaffolder, type PackageSource, type PackagesMode } from './packages.js';
import { bootDev, os, readArtifact, readNamespace, scaffold } from './project.js';
import { PROMPT_LANGS, PROMPT_LENGTHS, promptChoiceText, promptLanguageRefusal, statedPromptChoice, type PromptChoice, type PromptLang, type PromptLength } from './prompts.js';
import { rebaseScenario } from './run-date.js';
import { cardScorecard, renderScorecard, runRecord, type CardStamp } from './scorecard.js';
import { SUPPLIED_TEMPLATE_SOURCE, summaryMain, suppliedTemplateOf, type SuppliedTemplate } from './summary.js';

/** The `summary` command, re-exported so the published bin reaches it through this built entry (`src/bin.ts`). */
export { summaryMain };

/** The dev admin `objectstack dev --fresh` seeds; the runner and the gallery exporter sign in as it. */
export const ADMIN = { email: 'admin@objectos.ai', password: 'admin123' };

export function findUp(start: string, test: (dir: string) => boolean): string {
  let dir = start;
  for (;;) {
    if (test(dir)) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error(`not found above ${start}`);
    dir = up;
  }
}

export interface CliArgs {
  cards?: string;
  only?: string[];
  modes: Array<'scratch' | 'template' | 'ask' | 'door'>;
  driver: string;
  record?: string;
  template?: string;
  iterateRun: boolean;
  /** Minutes per authoring turn (`--author-timeout`); the driver's default when absent. */
  authorTimeoutMin?: number;
  /** Turns per authoring turn on every card (`--author-max-turns`); the card tier's default when absent. */
  authorMaxTurns?: number;
  /** Turns per question or operation turn (`--ask-max-turns`); the driver's default when absent. */
  askMaxTurns?: number;
  /** How many times each (question, persona) turn is asked (`--ask-repeats`); once when absent. Not a live-only flag: a replay reads that many recorded asks. */
  askRepeats?: number;
  /** The model every live turn asks for (`--model`); the login's default when absent. */
  model?: string;
  /** The model an authoring turn asks for (`--author-model`), in place of `model`. */
  authorModel?: string;
  /** The model a question or operation turn asks for (`--ask-model`), in place of `model`. */
  askModel?: string;
  /** The effort level every live turn asks for (`--effort`); the CLI's default when absent. */
  effort?: string;
  /** The effort level an authoring turn asks for (`--author-effort`), in place of `effort`. */
  authorEffort?: string;
  /** The effort level a question or operation turn asks for (`--ask-effort`), in place of `effort`. */
  askEffort?: string;
  /** The skills directory every question and operation turn is given (`--ask-skills`); none when absent. */
  askSkills?: string;
  /** Door mode's skills directory (`--door-skills`); none when absent. */
  doorSkills?: string;
  /** Skill names left out of {@link doorSkills} (`--door-skill-omit`). */
  doorSkillOmit?: string[];
  /** Door mode's rules file, or `builtin` for the built-in corpus (`--door-rules`); else {@link DOOR_RULES_ENV}; none when neither. */
  doorRules?: string;
  /** The rule ids and set names left out of the rules file (`--door-rules-omit`). */
  doorRulesOmit?: string;
  out?: string;
  work?: string;
  createVersion?: string;
  /** `--packages`: where the `@objectstack/*` packages come from. */
  packages: PackagesMode;
  /** `--lang`: the language every card text a prompt renders is sent in ({@link PromptChoice.lang}); absent ⇒ English, else Chinese, per text. */
  lang?: PromptLang;
  /** `--prompt`: the card prompt the build turn is given ({@link PromptChoice.prompt}); absent ⇒ `detailed`. */
  prompt?: PromptLength;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const a: CliArgs = { modes: ['scratch', 'template'], driver: 'claude', iterateRun: true, packages: 'published' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    const turns = () => {
      const raw = val();
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} takes a whole number of turns above 0, not \`${raw}\``);
      return n;
    };
    const model = () => {
      const raw = val();
      if (raw.trim() === '' || raw.startsWith('-')) throw new Error(`${flag} takes a model alias or name (sonnet, opus, claude-sonnet-4-5), not \`${raw}\``);
      return raw;
    };
    const effort = () => {
      const raw = val();
      if (raw.trim() === '' || raw.startsWith('-')) throw new Error(`${flag} takes an effort level as \`claude --effort\` takes it (low, medium, high, xhigh, max), not \`${raw}\``);
      return raw.trim();
    };
    if (flag === '--cards') a.cards = val();
    else if (flag === '--only') a.only = val().split(',');
    else if (flag === '--modes') {
      const modes = val().split(',');
      for (const m of modes) if (m !== 'scratch' && m !== 'template' && m !== 'ask' && m !== 'door') throw new Error(`unknown mode \`${m}\` (scratch, template, ask, door)`);
      a.modes = modes as CliArgs['modes'];
    } else if (flag === '--driver') a.driver = val();
    else if (flag === '--record') a.record = val();
    else if (flag === '--template') a.template = val();
    else if (flag === '--no-iterate-run') a.iterateRun = false;
    else if (flag === '--author-timeout') {
      const raw = val();
      const min = Number(raw);
      if (!Number.isFinite(min) || min <= 0) throw new Error(`--author-timeout takes a number of minutes above 0, not \`${raw}\``);
      a.authorTimeoutMin = min;
    }
    else if (flag === '--author-max-turns') a.authorMaxTurns = turns();
    else if (flag === '--ask-max-turns') a.askMaxTurns = turns();
    else if (flag === '--ask-repeats') {
      const raw = val();
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`--ask-repeats takes a whole number of asks above 0, not \`${raw}\``);
      a.askRepeats = n;
    }
    else if (flag === '--model') a.model = model();
    else if (flag === '--author-model') a.authorModel = model();
    else if (flag === '--ask-model') a.askModel = model();
    else if (flag === '--effort') a.effort = effort();
    else if (flag === '--author-effort') a.authorEffort = effort();
    else if (flag === '--ask-effort') a.askEffort = effort();
    else if (flag === '--ask-skills') {
      const raw = val();
      if (raw.trim() === '' || raw.startsWith('-')) throw new Error(`--ask-skills takes a skills directory, not \`${raw}\``);
      a.askSkills = raw;
    }
    else if (flag === '--door-skills' || flag === '--door-rules' || flag === '--door-rules-omit' || flag === '--door-skill-omit') {
      const raw = val();
      if (raw.trim() === '' || raw.startsWith('-')) throw new Error(`${flag} takes ${flag === '--door-skills' ? 'a skills directory' : flag === '--door-rules' ? 'a rules file or `builtin`' : 'a comma-separated list'}, not \`${raw}\``);
      if (flag === '--door-skills') a.doorSkills = raw;
      else if (flag === '--door-rules') a.doorRules = raw;
      else if (flag === '--door-rules-omit') a.doorRulesOmit = raw;
      else a.doorSkillOmit = raw.split(',').map((x) => x.trim());
    }
    else if (flag === '--lang') {
      const l = val();
      if (!(PROMPT_LANGS as readonly string[]).includes(l)) throw new Error(`unknown --lang \`${l}\` (${PROMPT_LANGS.join(', ')})`);
      a.lang = l as PromptLang;
    } else if (flag === '--prompt') {
      const p = val();
      if (!(PROMPT_LENGTHS as readonly string[]).includes(p)) throw new Error(`unknown --prompt \`${p}\` (${PROMPT_LENGTHS.join(', ')})`);
      a.prompt = p as PromptLength;
    }
    else if (flag === '--out') a.out = val();
    else if (flag === '--work') a.work = val();
    else if (flag === '--create-version') a.createVersion = val();
    else if (flag === '--packages') {
      const p = val();
      if (!(PACKAGES_MODES as readonly string[]).includes(p)) throw new Error(`unknown --packages \`${p}\` (${PACKAGES_MODES.join(', ')})`);
      a.packages = p as PackagesMode;
    } else throw new Error(`unknown flag \`${flag}\``);
  }
  const askRefusal = askModeRefusal(a.modes, a.template !== undefined);
  if (askRefusal) throw new Error(askRefusal);
  const doorFlags = [['--door-skills', a.doorSkills], ['--door-skill-omit', a.doorSkillOmit], ['--door-rules', a.doorRules], ['--door-rules-omit', a.doorRulesOmit]].filter(([, v]) => v !== undefined).map(([f]) => f as string);
  if (doorFlags.length && !a.modes.includes('door')) throw new Error(`${doorFlags.join(', ')} ${doorFlags.length === 1 ? 'sets' : 'set'} door mode's arm, and --modes does not include door`);
  if (a.doorSkillOmit !== undefined && a.doorSkills === undefined) throw new Error('--door-skill-omit leaves skills out of --door-skills, which is not given');
  if (a.packages === 'workspace' && a.createVersion !== undefined) {
    throw new Error('--create-version names a published create-objectstack; --packages workspace scaffolds with the one this checkout builds');
  }
  return a;
}

/** The prompt choice `--lang` and `--prompt` set ({@link PromptChoice}), or `undefined` when neither is given: the default prompts. */
export function promptChoiceOf(args: Pick<CliArgs, 'lang' | 'prompt'>): PromptChoice | undefined {
  return statedPromptChoice({ ...(args.lang !== undefined ? { lang: args.lang } : {}), ...(args.prompt !== undefined ? { prompt: args.prompt } : {}) });
}

/** The live driver's limits a run may set: `--author-timeout`, `--author-max-turns`, `--ask-max-turns`. */
export type DriverLimits = Pick<CliArgs, 'authorTimeoutMin' | 'authorMaxTurns' | 'askMaxTurns'>;

/** The models a run may ask the live driver for: `--model`, `--author-model`, `--ask-model`. */
export type DriverModels = Pick<CliArgs, 'model' | 'authorModel' | 'askModel'>;

/** The effort levels a run may ask the live driver for: `--effort`, `--author-effort`, `--ask-effort`. */
export type DriverEfforts = Pick<CliArgs, 'effort' | 'authorEffort' | 'askEffort'>;

/** The skills a run may give the live `claude` driver: `--ask-skills`, and door mode's arm (`--door-*`). */
export type DriverSkills = Pick<CliArgs, 'askSkills' | 'doorSkills' | 'doorSkillOmit' | 'doorRules' | 'doorRulesOmit'>;

const LIVE_FLAGS: ReadonlyArray<readonly [keyof (DriverLimits & DriverModels & DriverEfforts & DriverSkills), string]> = [
  ['authorTimeoutMin', '--author-timeout'],
  ['authorMaxTurns', '--author-max-turns'],
  ['askMaxTurns', '--ask-max-turns'],
  ['model', '--model'],
  ['authorModel', '--author-model'],
  ['askModel', '--ask-model'],
  ['effort', '--effort'],
  ['authorEffort', '--author-effort'],
  ['askEffort', '--ask-effort'],
  ['askSkills', '--ask-skills'],
  ['doorSkills', '--door-skills'],
  ['doorSkillOmit', '--door-skill-omit'],
  ['doorRules', '--door-rules'],
  ['doorRulesOmit', '--door-rules-omit'],
];

/** The live flags of `keys` that `opts` sets, as typed (`--effort`), in {@link LIVE_FLAGS} order. */
const givenFlags = (opts: DriverLimits & DriverModels & DriverEfforts & DriverSkills, keys?: ReadonlyArray<keyof (DriverLimits & DriverModels & DriverEfforts & DriverSkills)>): string[] =>
  LIVE_FLAGS.filter(([key]) => (keys === undefined || keys.includes(key)) && opts[key] !== undefined).map(([, flag]) => flag);

/** What {@link makeDriver} reads beyond the flags: this runner's checkout (a rules file inside it is refused). */
export interface DriverContext {
  repoRoot?: string;
}

export function makeDriver(spec: string, opts: DriverLimits & DriverModels & DriverEfforts & DriverSkills = {}, context: DriverContext = {}): AgentDriver {
  if (opts.doorRulesOmit !== undefined && opts.doorRules === undefined) throw new Error('--door-rules-omit leaves rules out of --door-rules, which is not given (`--door-rules builtin` gives the built-in corpus)');
  if (spec === 'claude') {
    const rules = opts.doorRules !== undefined ? readDoorRules(opts.doorRules, { ...(opts.doorRulesOmit !== undefined ? { omit: opts.doorRulesOmit } : {}), ...(context.repoRoot !== undefined ? { repoRoot: context.repoRoot } : {}) }) : undefined;
    return new ClaudeCodeDriver({
      ...(opts.authorTimeoutMin !== undefined ? { authorTimeoutMs: opts.authorTimeoutMin * 60_000 } : {}),
      ...(opts.authorMaxTurns !== undefined ? { authorMaxTurns: opts.authorMaxTurns } : {}),
      ...(opts.askMaxTurns !== undefined ? { askMaxTurns: opts.askMaxTurns } : {}),
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      ...(opts.authorModel !== undefined ? { authorModel: opts.authorModel } : {}),
      ...(opts.askModel !== undefined ? { askModel: opts.askModel } : {}),
      ...(opts.effort !== undefined ? { effort: opts.effort } : {}),
      ...(opts.authorEffort !== undefined ? { authorEffort: opts.authorEffort } : {}),
      ...(opts.askEffort !== undefined ? { askEffort: opts.askEffort } : {}),
      ...(opts.askSkills !== undefined ? { askSkillsDir: opts.askSkills } : {}),
      ...(opts.doorSkills !== undefined ? { doorSkillsDir: opts.doorSkills } : {}),
      ...(opts.doorSkillOmit !== undefined ? { doorSkillOmit: opts.doorSkillOmit } : {}),
      ...(rules ? { doorRules: rules } : {}),
    });
  }
  // Only the `claude` CLI loads a project skill through its `Skill` tool; no other driver is given one.
  const skills = givenFlags(opts, ['askSkills']);
  if (skills.length && spec !== 'claude' && !spec.startsWith('recorded:')) {
    throw new Error(`--ask-skills applies to the live \`claude\` driver only: it places Claude Code skills where a \`claude\` session discovers them and allows its \`Skill\` tool, and \`${spec}\` has neither`);
  }
  const door = givenFlags(opts, ['doorSkills', 'doorSkillOmit', 'doorRules', 'doorRulesOmit']);
  if (door.length && spec !== 'claude' && !spec.startsWith('recorded:')) throw new Error(`${door.join(', ')}: ${doorModeRefusal(`\`${spec}\``)}`);
  if (spec.startsWith('recorded:')) {
    const given = givenFlags(opts);
    if (given.length) throw new Error(`${given.join(', ')} ${given.length === 1 ? 'applies' : 'apply'} to the live driver only: a replay re-reads each turn as it was recorded`);
    return RecordedDriver.fromFile(spec.slice('recorded:'.length));
  }
  if (spec === 'codex') {
    // Measured on codex-cli 0.167.0: `codex exec` takes no cap on its agentic turns (`drivers/codex.ts`).
    const capped = givenFlags(opts, ['authorMaxTurns', 'askMaxTurns']);
    if (capped.length) throw new Error(`${capped.join(', ')} ${capped.length === 1 ? 'has' : 'have'} no equivalent in the Codex CLI: \`codex exec\` takes no turn cap`);
    // Measured on codex-cli 0.167.0: `codex exec --help` has no effort flag, and the config key
    // `model_reasoning_effort` starts a turn with any value (`bogus` included), so no level
    // name could be checked against what the model was served; refused, never guessed.
    const effort = givenFlags(opts, ['effort', 'authorEffort', 'askEffort']);
    if (effort.length) throw new Error(`${effort.join(', ')} ${effort.length === 1 ? 'has' : 'have'} no equivalent in the Codex CLI: \`codex exec\` takes no effort flag`);
    return new CodexDriver({
      ...(opts.authorTimeoutMin !== undefined ? { authorTimeoutMs: opts.authorTimeoutMin * 60_000 } : {}),
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      ...(opts.authorModel !== undefined ? { authorModel: opts.authorModel } : {}),
      ...(opts.askModel !== undefined ? { askModel: opts.askModel } : {}),
    });
  }
  if (spec.startsWith('external:')) {
    return new ExternalDriver({
      command: spec.slice('external:'.length),
      ...(opts.authorTimeoutMin !== undefined ? { authorTimeoutMs: opts.authorTimeoutMin * 60_000 } : {}),
      ...(opts.authorMaxTurns !== undefined ? { authorMaxTurns: opts.authorMaxTurns } : {}),
      ...(opts.askMaxTurns !== undefined ? { askMaxTurns: opts.askMaxTurns } : {}),
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      ...(opts.authorModel !== undefined ? { authorModel: opts.authorModel } : {}),
      ...(opts.askModel !== undefined ? { askModel: opts.askModel } : {}),
      ...(opts.effort !== undefined ? { effort: opts.effort } : {}),
      ...(opts.authorEffort !== undefined ? { authorEffort: opts.authorEffort } : {}),
      ...(opts.askEffort !== undefined ? { askEffort: opts.askEffort } : {}),
    });
  }
  throw new Error(`unknown driver \`${spec}\` (claude, codex, external:COMMAND, recorded:FILE)`);
}

/**
 * The record with its supplied template named (`template`, top level), when a
 * template or ask mode of the run installed the `--template` file; the record
 * unchanged otherwise, so a run without one keeps its bytes.
 */
export function withSuppliedTemplate(record: Record<string, unknown>, cardRun: CardRun, supplied: SuppliedTemplate | undefined): Record<string, unknown> {
  const installed = cardRun.modes.some((m) => m.template?.source === SUPPLIED_TEMPLATE_SOURCE);
  return supplied && installed ? { ...record, template: supplied } : record;
}

/**
 * The {@link CardStamp} of a loaded card: its id and the sha256 of the bytes
 * the loader parsed (`LoadedScenario.fileSha256`), never a second read of the
 * file. A card edited while its run went on is still stamped with the card
 * that ran, and one moved or deleted meanwhile still gets its record written.
 */
export function loadedCardStamp(loaded: Pick<LoadedScenario, 'fileSha256' | 'card'>): CardStamp {
  return { id: loaded.card.id, sha256: loaded.fileSha256 };
}

export async function main(argv: readonly string[]): Promise<number> {
  // `summary` reads records back; it runs nothing (`summary.ts`).
  if (argv[0] === 'summary') return summaryMain(argv.slice(1));
  const args = parseArgs(argv);
  const here = dirname(fileURLToPath(import.meta.url));
  // The checkout, or the library root the published package carries (`library.ts`).
  const { root: repo, checkout } = locateLibraryRoot(here);
  if (args.packages === 'workspace' && !checkout) {
    throw new Error('--packages workspace builds and packs the packages of an objectstack checkout; the published CLI has none. Run it from a checkout (`pnpm --filter @objectstack/scenarios run-scenarios --packages workspace`), or use --packages published');
  }
  const cardsDir = resolve(args.cards ?? join(repo, 'docs/qa/scenarios'));
  const outDir = resolve(args.out ?? (checkout ? join(repo, 'docs/qa/platform-checklist/runs') : 'scenario-runs'));
  const work = resolve(args.work ?? mkdtempSync(join(tmpdir(), 'scenario-run-')));
  mkdirSync(work, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const { cards, refusals } = loadScenarios(cardsDir, {
    areas: readCapabilityAreas(join(repo, CAPABILITY_AREAS_DIR)),
    library: libraryOf(cardsDir, repo),
  });
  for (const r of refusals) console.error(formatRefusal(r));
  const picked = args.only ? cards.filter((c) => args.only!.includes(c.card.id)) : cards;
  if (picked.length === 0) {
    console.error(`no card to run under ${cardsDir}${args.only ? ` matching ${args.only.join(',')}` : ''}`);
    return 2;
  }
  const promptChoice = promptChoiceOf(args);
  // A card that lacks a text the run would render in the chosen language is skipped here, before any scaffold or boot; the others run.
  const chosen = picked.filter((c) => {
    const refusal = promptLanguageRefusal(c.card, promptChoice, args.modes);
    if (refusal) console.error(`skipped ${c.card.id}: ${refusal}`);
    return refusal === undefined;
  });
  if (chosen.length === 0) {
    console.error(`no card to run: every card chosen lacks a text the run would send in ${args.lang}`);
    return 2;
  }

  // Door mode's rules file: the flag, else the variable, read only where door mode runs on the live driver.
  const envRules = process.env[DOOR_RULES_ENV]?.trim();
  if (args.doorRules === undefined && envRules && args.modes.includes('door') && args.driver === 'claude') {
    args.doorRules = envRules;
    console.log(`door rules: ${DOOR_RULES_ENV} names the rules file`);
  }
  if (args.modes.includes('door') && args.driver !== 'claude' && !args.driver.startsWith('recorded:')) throw new Error(doorModeRefusal(`\`--driver ${args.driver}\``));
  const live = makeDriver(args.driver, args, checkout ? { repoRoot: repo } : {});
  // A replay reads the first N asks of each question turn: refused here, before any card runs, when it holds fewer.
  if (args.askRepeats !== undefined && live instanceof RecordedDriver) live.assertAskRepeats(args.askRepeats, chosen.map((c) => c.card));
  // A replay under other prompts than its recording's would grade one choice's answers as another's: refused here, before any card runs.
  if (live instanceof RecordedDriver) live.assertPromptChoice(promptChoice);
  const driver = args.record ? new RecordingDriver(live, promptChoice) : live;
  const info = driver.info();
  console.log(
    `driver: ${info.driver} ${info.version ?? ''} · login: ${info.authMethod ?? 'n/a'} · API-billed: no` +
      (info.authorTimeoutMs !== undefined ? ` · author timeout: ${minutesText(info.authorTimeoutMs)}` : '') +
      (info.authorMaxTurns ? ` · author max turns: ${Object.entries(info.authorMaxTurns).map(([tier, n]) => `${tier} ${n}`).join(', ')}` : '') +
      (info.askMaxTurns !== undefined ? ` · ask max turns: ${info.askMaxTurns}` : '') +
      (info.authorModel ? ` · author model: ${info.authorModel}` : '') +
      (info.askModel ? ` · ask model: ${info.askModel}` : '') +
      (info.authorEffort ? ` · author effort: ${info.authorEffort}` : '') +
      (info.askEffort ? ` · ask effort: ${info.askEffort}` : '') +
      (info.askSkills ? ` · ask skills: ${askSkillsText(info.askSkills)}` : '') +
      (args.modes.includes('door') ? ` · door arm: ${doorArmText(info.door)}` : ''),
  );
  if (args.askRepeats !== undefined && args.askRepeats > 1) console.log(`ask repeats: each question turn asked ${args.askRepeats} times, operations once`);
  if (promptChoice) console.log(`prompts: ${promptChoiceText(promptChoice)}`);

  // Built and packed once, before the first card: every scaffold of this run installs the same tarballs.
  const workspace = args.packages === 'workspace' ? await prepareWorkspacePackages(repo, join(work, 'workspace-packages')) : undefined;
  if (workspace) console.log(`packages: workspace @ ${workspace.source.commit}${workspace.source.uncommitted ? ' + uncommitted changes' : ''} — ${workspace.tarballs.size} packed under ${join(work, 'workspace-packages')}`);
  /** The `@objectstack/spec` versions the current card's published scaffolds installed. */
  let publishedVersions = new Set<string>();

  const ops: ProjectOps = {
    scaffold: async (name, under) => {
      const parent = join(work, under);
      mkdirSync(parent, { recursive: true });
      if (workspace) {
        const done = await scaffold(parent, name, workspaceScaffolder(workspace));
        if (done.result.exit !== 0) return done;
        return { dir: done.dir, result: await settleWorkspaceProject(done.dir, workspace) };
      }
      const done = await scaffold(parent, name, args.createVersion ? { version: args.createVersion } : {});
      const version = installedSpecVersion(done.dir);
      if (version) publishedVersions.add(version);
      return done;
    },
    os: (dir, a) => os(dir, a),
    readArtifact,
    namespace: readNamespace,
    // Door mode's host serves the OAuth authorization server its client's token comes from.
    boot: (dir, o) => bootDev(dir, undefined, o?.authoringDoor ? { OS_OIDC_PROVIDER_ENABLED: 'true' } : {}),
    harness: (url) => new HttpApp({ baseUrl: url, adminEmail: ADMIN.email, adminPassword: ADMIN.password }),
  };
  const templateBytes = args.template ? readFileSync(args.template) : undefined;
  const template = templateBytes ? JSON.parse(templateBytes.toString('utf8')) : undefined;
  /** The template's file name and sha256, for a record whose template or ask mode installed it (`SuppliedTemplate`). */
  const supplied = args.template && templateBytes ? suppliedTemplateOf(args.template, templateBytes) : undefined;
  let framework: string | undefined;
  try {
    // Only a checkout has a framework commit: an installed package may sit in someone else's repository.
    if (checkout) framework = execSync('git rev-parse --short HEAD', { cwd: repo, encoding: 'utf8' }).trim();
  } catch {
    /* not a checkout */
  }
  const date = new Date().toISOString().slice(0, 10);

  for (const loaded of chosen) {
    // The card's dates move onto the day this card starts, so its "today", its
    // seeded rows and the app's own clock agree (`run-date.ts`).
    const runDate = new Date().toISOString().slice(0, 10);
    const scenario = rebaseScenario(loaded, runDate);
    console.log(`\n▶ ${scenario.card.id} (${args.modes.join(' + ')})`);
    if (loaded.card.asOf !== undefined && loaded.card.asOf !== scenario.card.asOf) {
      console.log(`dates: the card's ${loaded.card.asOf} is run as ${scenario.card.asOf}, every card date moved by the same days`);
    }
    publishedVersions = new Set();
    const cardRun = await runCard(scenario, driver, ops, { modes: args.modes, iterateRun: args.iterateRun, admin: ADMIN, ...(template ? { templateArtifact: template } : {}), ...(args.askRepeats !== undefined ? { askRepeats: args.askRepeats } : {}), ...(promptChoice ? { promptChoice } : {}) });
    const packages: PackageSource = workspace ? workspace.source : { source: 'published', versions: [...publishedVersions].sort() };
    // The card file the run graded, as it was loaded (`CardStamp`): the record and the scorecard name its hash.
    const card = loadedCardStamp(loaded);
    const record = withSuppliedTemplate(runRecord({ run: `${date}-scenario-${scenario.card.id}`, date, ...(framework ? { framework } : {}), packages, driver: info, runner: 'scenario-runner', evidenceDir: work, card }, cardRun), cardRun, supplied);
    const file = join(outDir, `${date}-scenario-${scenario.card.id}.json`);
    writeFileSync(file, JSON.stringify(record, null, 2));
    console.log(renderScorecard(cardScorecard(cardRun, packages, card)));
    console.log(`record: ${file}`);
    if (driver instanceof RecordingDriver && args.record) driver.save(args.record);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
