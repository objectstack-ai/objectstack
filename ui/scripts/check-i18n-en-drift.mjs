#!/usr/bin/env node
/**
 * When an `en` string CHANGES, the other nine packs must change with it.
 *
 * Run:  node scripts/check-i18n-en-drift.mjs   (also `pnpm check:i18n-drift`)
 * Exit: 0 = every changed `en` value was followed (or waived), 1 = it was not
 *
 * ## The gap this closes (objectui#3650)
 *
 * Three i18n gates already run on every PR and all three read only KEYS:
 *
 *   - `packages/i18n/src/__tests__/all-locales-key-parity.test.ts` — every pack
 *     defines every `en` key and no key `en` lacks. A **key-set** invariant.
 *   - `scripts/check-i18n-call-site-keys.mjs` (objectui#3530) — every key a
 *     `t()` call site asks for exists in `en`. Also a **key** invariant.
 *   - that gate's baseline ratchet — same, one level down.
 *
 * None of them can see a VALUE go stale, and two shipped defects proved it:
 *
 *   - objectui#3582: `console.objectView.systemViewReadonly` — `en` was changed
 *     from "duplicate to customize" to "read-only"; eight packs kept serving the
 *     old English sentence.
 *   - objectui#3625: `view.readonlyTooltip` — same `en` edit, same eight packs,
 *     except here the packs held **idiomatic native-script translations of the
 *     retired sentence**. Native script, mutually distinct, full key parity,
 *     correct placeholders: every mechanical judgement about the value itself
 *     was green, and stayed green. objectui#3582's suggested "no ASCII English
 *     in a non-Latin pack" probe would not have seen it either — measured,
 *     in PR #3642.
 *
 * The second case is the one that fixes the design. No gate can decide whether
 * a Japanese sentence still MEANS what the English one now means; asking for
 * that is asking for a translator. What a gate can decide is the **event**: the
 * `en` value for this key changed in this PR and the nine translations did not.
 * That is the invariant both defects violated at birth, and it is checkable
 * exactly once — in the PR that edits `en`, while the author still knows what
 * the sentence is supposed to say. A day later it is archaeology.
 *
 * ## What is compared, and against what
 *
 * The pack sources at the **merge base** of `HEAD` and `origin/main` versus the
 * pack sources at `HEAD` (or the working tree). Merge base, not `origin/main`'s
 * tip: a branch must answer for the `en` edits IT made, never for edits that
 * landed on `main` after it forked.
 *
 * A key is "drifted" when it exists in `en` on BOTH sides with DIFFERENT values.
 * For each drifted key, each of the nine packs must also show a different value
 * across the same two commits. Granularity is the key — not the sentence, not
 * the namespace, not the file. Two facts follow, and both are deliberate:
 *
 *   - **A key ADDED to or REMOVED from `en` is not this gate's business.** That
 *     is a key-set change and `all-locales-key-parity.test.ts` already fails on
 *     it, in both directions. Reporting it here would double-report one defect.
 *   - **A pack that does not define the key is skipped for that key**, and the
 *     skips are counted and printed. The four `console.ai.*` outbound-message
 *     keys are absent from eight packs BY DESIGN (see
 *     `all-locales-key-parity.test.ts` and `outbound-agent-messages.test.ts`);
 *     demanding those packs "follow" a key they must not define would be this
 *     gate contradicting the one that owns key sets.
 *
 * ## Typography is NOT exempt
 *
 * Changing `en` from `Save` to `Save.` fails exactly like a rewrite. Two
 * reasons, in this order:
 *
 *   1. There is no honest mechanical test for "this edit did not change the
 *      meaning". A punctuation-only heuristic is a semantic claim wearing a
 *      regex, and objectui#3625 is the case study in what those cost: every
 *      cheap judgement about that value was green while the sentence was wrong.
 *   2. The waiver ledger below already IS the exemption channel, and it makes
 *      the claim a person signs rather than a rule the script guesses. A
 *      typography-only edit takes one ledger entry naming the new text.
 *
 * Measured before choosing, not assumed: replaying this gate over all 21 commits
 * that have touched `en.ts` since the packs entered this repo turns up exactly
 * ONE commit that changes an `en` value at all (0e50440e8, three keys), and all
 * 27 of its pack/key pairs followed — green, correctly. So the observable cost
 * of refusing an exemption is, on this history, zero commits: there is no
 * typography-only churn here for a carve-out to spare. See the PR for
 * objectui#3650 for the full replay.
 *
 * ## Why it lands green, and why that is not an empty green
 *
 * Neither defect's originating commit is reachable from here. The ten packs
 * entered this repository whole at 30ac2e1ee, and at that very commit `en`
 * already said "read-only" while `ja` already said the duplicate-to-customize
 * sentence — both drifts arrived pre-broken, from wherever the files were moved
 * in. The replay over everything since is green because in that window exactly
 * one commit changed an `en` value and it did the right thing.
 *
 * So this gate cannot be validated by history, and the honest consequence is
 * that its acceptance corpus is IMPLANTED rather than observed:
 * `check-i18n-en-drift.test.ts` rebuilds the objectui#3625 commit that must have
 * existed — `en` moved to the read-only sentence, the eight packs left holding
 * their translations of the retired one — in a throwaway git repo, and asserts
 * this gate names both keys and all eight packs. That, plus the exit-code tests
 * around it, is the evidence that the green above is a measurement and not an
 * empty comparison.
 *
 * ## The waiver ledger
 *
 * `scripts/i18n-en-drift-baseline.json`. It ships EMPTY, and unlike
 * objectui#3547's baseline it can never hold a backlog, because this gate has
 * no backlog to hold: it judges an event in a diff, not a state in the tree.
 * There is no "the packs are currently 258 keys behind" to write down here —
 * whether today's `ja` sentence still matches today's `en` sentence is the
 * semantic question no gate can answer, and pretending otherwise is how
 * objectui#3625 stayed green.
 *
 * An entry is `{ "<key>": { "en": "<the NEW en text>", "reason": …, "issue": … } }`
 * and it is checked against the tree on EVERY run, diff or no diff:
 *
 *   - the key must still exist in `en`;
 *   - `entry.en` must still equal `en`'s CURRENT value for that key.
 *
 * That transcription is the whole mechanism. A waiver can only be written by
 * someone who already made the edit (they have to copy the new sentence into
 * the ledger, where a reviewer reads it next to the reason), it waives that one
 * sentence and no other, and the NEXT time the key's `en` value changes the
 * entry no longer matches and the build fails until someone deletes or renews
 * it. Waivers expire by themselves; they do not accumulate into an allowlist.
 *
 * A waiver that fires no finding on a given run is NOT an error — after the
 * waiving PR merges, every later run sees an empty diff, and failing them all
 * would turn one PR's escape hatch into everyone else's red build. The ratchet
 * on quantity is a pin in `scripts/__tests__/check-i18n-en-drift.test.ts`: the
 * ledger's entry count has a ceiling in that test, so growing the ledger means
 * editing a test that says so, in the PR that grows it.
 *
 * ## Why the packs are parsed from source rather than imported
 *
 * The "before" side is a blob inside git, not a file on disk, and the ten packs
 * are 1.5 MB of TypeScript. `git show <base>:<path>` hands us the text and the
 * TypeScript AST turns it into `key -> string` with no build step, no loader,
 * and no temp files — the same trick, for the same reason, as `collectEnKeys`
 * in `scripts/check-i18n-call-site-keys.mjs`. `check-i18n-en-drift.test.ts`
 * pins the extraction against the real module vitest evaluates, so the parser
 * cannot drift from the packs it claims to read. Anything the parser does not
 * understand THROWS rather than being skipped: a silently dropped subtree would
 * make this gate green over exactly the keys it stopped reading.
 *
 * ## A base commit with no objectui tree at all (objectstack#25728)
 *
 * Paths into a revision are `revPath(ref, path)` (`scripts/workspace-root.mjs`,
 * "Paths handed to git"), so under the objectstack monorepo the packs are read
 * from `ui/` at the base. One change has no such tree at its base: the one that
 * IMPORTS objectui as `ui/` (and every branch cut from it before it lands). Its
 * merge base is objectstack `main` without `ui/`, so no pack can be read there.
 * That is not a missing pack, it is a missing BEFORE side: every key is new in
 * the change, and drift between two sides needs two. `treeExistsAt` asks git
 * whether the tree itself (`<base>:./`) exists; only when it does not is the
 * before side empty, and the CLI says so. Standalone the tree is the repository
 * root, which exists at every commit, so this never fires there; a tree that
 * exists at the base with a pack missing still THROWS, as it always did.
 */

import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DESIGNER_TABLE,
  DESIGNER_TABLE_PAIRS,
  readDesignerPairs,
} from './check-i18n-designer-table-parity.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { revPath } from './workspace-root.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

/** The ten built-in packs, `en` first. Mirrors `packages/i18n/src/locales/index.ts`. */
export const LOCALES = ['en', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'pt', 'ru', 'ar'];

/** The nine packs that must follow `en`. */
export const FOLLOWERS = LOCALES.filter((lang) => lang !== 'en');

/** Repo-relative path of a pack source. */
export const packPath = (lang) => `packages/i18n/src/locales/${lang}.ts`;

/** Where the waiver ledger lives, repo-relative. */
export const LEDGER_PATH = 'scripts/i18n-en-drift-baseline.json';

/** A ledger entry must name the issue that justifies it, in this spelling. */
export const ISSUE_PATTERN = /^objectui#\d+$/;

// -- pack parsing -------------------------------------------------------------

/** Strips `as const`, `satisfies X` and parentheses off an expression node. */
function unwrap(node) {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    (ts.isSatisfiesExpression?.(current) ?? false)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * The object literal a pack module default-exports.
 *
 * Resolved through `export default <ident>` rather than by assuming the binding
 * is named after the file: this parser also reads HISTORICAL versions of these
 * files, where that convention is an assumption rather than a fact.
 */
function packLiteral(source, label) {
  let exported = null;
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      exported = unwrap(statement.expression);
    }
  }
  if (exported === null) throw new Error(`${label}: no \`export default\` found`);
  if (ts.isObjectLiteralExpression(exported)) return exported;
  if (!ts.isIdentifier(exported)) {
    throw new Error(`${label}: \`export default\` is neither an object literal nor an identifier`);
  }

  const name = exported.text;
  let literal = null;
  const find = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      const init = unwrap(node.initializer);
      if (ts.isObjectLiteralExpression(init)) literal = init;
    }
    ts.forEachChild(node, find);
  };
  find(source);
  if (!literal) throw new Error(`${label}: cannot find the \`const ${name} = { … }\` object literal`);
  return literal;
}

/**
 * The string a value node denotes, or `null` if it does not denote one.
 *
 * Handles the two literal forms plus `'a' + 'b'` concatenation chains, which is
 * how a long sentence is wrapped across source lines (no `en` value is written
 * that way today; the last one retired with objectui#7611), and the folded
 * text is what i18next serves, so it is what must be compared. (The
 * counterpart in `check-i18n-call-site-keys.mjs` folds it the same way and for
 * the same reason, since objectui#3810 gave that gate a value rule too: a leaf
 * neither can read as a string stays a key-only leaf there, judged for
 * existence and not for text.)
 */
function stringValueOf(node) {
  const value = unwrap(node);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = stringValueOf(value.left);
    const right = stringValueOf(value.right);
    return left === null || right === null ? null : left + right;
  }
  return null;
}

/**
 * `dotted key -> string value` for one pack source.
 *
 * Throws on any property form it does not understand. Every leaf in all ten
 * packs resolves to a string today (measured: 2736 keys in `en`, 2732 in the
 * eight non-gate packs, all strings, one of them a two-part concatenation); a
 * leaf that stops resolving must be a decision, not a silent omission that
 * takes the key out of this gate's sight.
 *
 * @returns {Map<string, string>}
 */
export function parsePack(text, label) {
  const source = ts.createSourceFile(label, text, ts.ScriptTarget.Latest, true);
  const values = new Map();

  const walk = (object, prefix) => {
    for (const prop of object.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        throw new Error(
          `${label}: unsupported property form at ${prefix || '<root>'}: ${ts.SyntaxKind[prop.kind]}`,
        );
      }
      const name =
        ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) || ts.isNumericLiteral(prop.name)
          ? prop.name.text
          : null;
      if (name === null) throw new Error(`${label}: unsupported key form at ${prefix || '<root>'}`);

      const path = prefix ? `${prefix}.${name}` : name;
      const value = unwrap(prop.initializer);
      if (ts.isObjectLiteralExpression(value)) {
        walk(value, path);
        continue;
      }
      const text = stringValueOf(value);
      if (text === null) {
        throw new Error(
          `${label}: ${path} is neither a nested object nor a static string ` +
            `(${ts.SyntaxKind[value.kind]}). This gate compares string values; teach it this form ` +
            'or the key silently leaves its scope.',
        );
      }
      values.set(path, text);
    }
  };
  walk(packLiteral(source, label), '');
  return values;
}

// -- git ----------------------------------------------------------------------

function git(root, args) {
  // stderr is PIPED, not inherited: the base-resolution probes below try refs
  // that legitimately do not exist, and git's "Not a valid object name" for a
  // probe that was supposed to miss reads as a real error in a CI log.
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitQuiet(root, args) {
  try {
    return git(root, args).trim();
  } catch {
    return null;
  }
}

/**
 * The ten packs at `ref`, or from the working tree when `ref` is null.
 *
 * The working tree is the default "after" side on purpose: an agent editing
 * `en.ts` gets the answer before committing, not after pushing.
 *
 * @returns {Map<string, Map<string, string>>} lang -> (key -> value)
 */
export function readPacks(root, ref) {
  const packs = new Map();
  for (const lang of LOCALES) {
    const rel = packPath(lang);
    const label = ref === null ? rel : revPath(ref, rel);
    let text;
    if (ref === null) {
      const full = join(root, rel);
      if (!existsSync(full)) throw new Error(`${rel} does not exist in the working tree`);
      text = readFileSync(full, 'utf8');
    } else {
      text = gitQuiet(root, ['show', revPath(ref, rel)]);
      if (text === null) throw new Error(`cannot read ${label} — is ${ref} in this clone?`);
    }
    packs.set(lang, parsePack(text, label));
  }
  return packs;
}

/**
 * Which commit this branch should be judged against.
 *
 * An explicitly NAMED base (`--base`, `OS_I18N_DRIFT_BASE`) is authoritative and
 * is the only thing consulted when given. Otherwise the base is DISCOVERED: the
 * merge base with the pull request's own base branch (`GITHUB_BASE_REF`), then
 * `origin/main`, then a local `main`. The merge base — rather than the target
 * branch's tip — is what makes a branch answer for the edits IT made and not for
 * whatever landed on `main` after it forked.
 *
 * A base that cannot be resolved is a HARD FAILURE, never a skip: a diff gate
 * that quietly finds nothing to diff reports green while checking nothing, which
 * is the failure this whole family of gates exists to stop. And an explicit one
 * that cannot be resolved does NOT fall through to the discovery candidates —
 * with the fallthrough, a `--base` sha absent from this clone (a shallow clone,
 * an unfetched sha, a typo) silently judged the packs against whatever the
 * discovery chain answered next instead (`merge-base with origin/main` on this
 * repo, as measured) and printed a confident green, with the `(--base …)` in the
 * summary line replaced by the candidate actually used so the log gave the
 * reader nothing to notice (objectui#3766, measured: exit 0 → exit 1). "The base
 * you named is missing" and "you named no base" are different facts, and only
 * the second one may be answered by guessing. `check-changeset-presence.mjs`
 * resolves its base from the same sources and had this same defect caught by its
 * own tests first (objectui#3762) — the two `resolveBaseRef`s are deliberately
 * the same shape.
 *
 * @param {string} root
 * @param {{ explicit?: string | null, env?: Record<string, string | undefined> }} [options]
 * @returns {{ ok: true, ref: string, how: string } | { ok: false, tried: string[], shallow: boolean, named: boolean }}
 */
export function resolveBaseRef(root, { explicit = null, env = process.env } = {}) {
  const tried = [];
  const verify = (ref) => gitQuiet(root, ['rev-parse', '--verify', `${ref}^{commit}`]);
  const shallow = () => gitQuiet(root, ['rev-parse', '--is-shallow-repository']) === 'true';

  const named = explicit
    ? { how: `--base ${explicit}`, ref: explicit }
    : env.OS_I18N_DRIFT_BASE
      ? { how: `OS_I18N_DRIFT_BASE=${env.OS_I18N_DRIFT_BASE}`, ref: env.OS_I18N_DRIFT_BASE }
      : null;

  if (named) {
    const resolved = verify(named.ref);
    tried.push(`${named.how}${resolved ? '' : ' (unresolved)'}`);
    return resolved
      ? { ok: true, ref: resolved, how: named.how }
      : { ok: false, tried, shallow: shallow(), named: true };
  }

  const attempt = (how, compute) => {
    const value = compute();
    tried.push(`${how}${value ? '' : ' (unresolved)'}`);
    return value ? { ok: true, ref: value, how } : null;
  };

  const candidates = [
    env.GITHUB_BASE_REF
      ? () => attempt(`merge-base with origin/${env.GITHUB_BASE_REF}`, () => gitQuiet(root, ['merge-base', 'HEAD', `origin/${env.GITHUB_BASE_REF}`]))
      : null,
    () => attempt('merge-base with origin/main', () => gitQuiet(root, ['merge-base', 'HEAD', 'origin/main'])),
    () => attempt('merge-base with main', () => gitQuiet(root, ['merge-base', 'HEAD', 'main'])),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const hit = candidate();
    if (hit) return hit;
  }
  return { ok: false, tried, shallow: shallow(), named: false };
}

// -- the comparison -----------------------------------------------------------

/**
 * @typedef {{ key: string, enBefore: string, enAfter: string, unfollowed: string[] }} Finding
 * @typedef {{ reason: string, key: string, detail: string }} LedgerProblem
 */

/**
 * Findings for every `en` value that changed without its translations.
 *
 * `followers` is a parameter rather than the module constant so a SECOND
 * population can reuse this comparison unchanged — the designer table below
 * has exactly one follower. It defaults to `FOLLOWERS`, so the ten-pack call
 * site is byte-identical to what it was.
 *
 * @param {Map<string, Map<string, string>>} before
 * @param {Map<string, Map<string, string>>} after
 * @param {string[]} [followers]
 * @returns {{ findings: Finding[], counters: Record<string, number> }}
 */
export function findDrift(before, after, followers = FOLLOWERS) {
  const enBefore = before.get('en');
  const enAfter = after.get('en');
  /** @type {Finding[]} */
  const findings = [];
  const counters = { changedEnKeys: 0, addedEnKeys: 0, removedEnKeys: 0, followedPacks: 0, absentInPack: 0 };

  for (const [key, value] of enAfter) {
    if (!enBefore.has(key)) {
      counters.addedEnKeys += 1;
      continue;
    }
    const previous = enBefore.get(key);
    if (previous === value) continue;
    counters.changedEnKeys += 1;

    /** @type {string[]} */
    const unfollowed = [];
    for (const lang of followers) {
      const packBefore = before.get(lang);
      const packAfter = after.get(lang);
      // Absent on either side: a key-set fact, owned by all-locales-key-parity.
      if (!packBefore.has(key) || !packAfter.has(key)) {
        counters.absentInPack += 1;
        continue;
      }
      if (packBefore.get(key) === packAfter.get(key)) unfollowed.push(lang);
      else counters.followedPacks += 1;
    }
    if (unfollowed.length > 0) {
      findings.push({ key, enBefore: previous, enAfter: value, unfollowed });
    }
  }

  for (const key of enBefore.keys()) if (!enAfter.has(key)) counters.removedEnKeys += 1;

  return { findings, counters };
}

// -- the waiver ledger --------------------------------------------------------

/**
 * The ledger, in two independent sections.
 *
 * `waivers` covers the ten locale packs; `designerWaivers` covers the designer
 * table population added by objectui#8834. They are separate maps rather than
 * one because `checkLedger` validates every entry against the `en` values of
 * ITS population — a designer key is not a pack key, and one shared map would
 * make every entry look stale to the other half. Both sections ship EMPTY.
 *
 * @returns {{ waivers: Record<string, { en: string, reason: string, issue: string }>,
 *             designerWaivers: Record<string, { en: string, reason: string, issue: string }> }}
 */
export function readLedger(root) {
  const file = join(root, LEDGER_PATH);
  if (!existsSync(file)) return { waivers: {}, designerWaivers: {} };
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return { waivers: parsed.waivers ?? {}, designerWaivers: parsed.designerWaivers ?? {} };
}

/**
 * Every way a ledger entry can be wrong, judged against the CURRENT `en` pack
 * and nothing else — so it is decidable on any commit, with or without a diff.
 *
 * Note what is deliberately absent: "this waiver matched no finding" is not a
 * problem. Every run after the waiving PR merges sees an empty diff, and making
 * those runs red would hand one PR's escape hatch to every later PR as a red
 * build. Quantity is ratcheted by the pin test instead.
 */
export function checkLedger(ledger, enAfter) {
  /** @type {LedgerProblem[]} */
  const problems = [];
  for (const [key, entry] of Object.entries(ledger.waivers)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push({ reason: 'malformed-waiver', key, detail: 'entry is not an object' });
      continue;
    }
    if (typeof entry.en !== 'string') {
      problems.push({ reason: 'malformed-waiver', key, detail: 'missing the `en` text this waiver covers' });
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      problems.push({ reason: 'malformed-waiver', key, detail: 'missing a `reason`' });
    }
    if (typeof entry.issue !== 'string' || !ISSUE_PATTERN.test(entry.issue)) {
      problems.push({ reason: 'malformed-waiver', key, detail: 'missing an `issue` of the form objectui#1234' });
    }
    if (!enAfter.has(key)) {
      problems.push({ reason: 'stale-waiver', key, detail: 'this key no longer exists in the en pack' });
      continue;
    }
    if (typeof entry.en === 'string' && entry.en !== enAfter.get(key)) {
      problems.push({
        reason: 'stale-waiver',
        key,
        detail:
          'the en text this waiver covers is gone. Ledger says ' +
          `${JSON.stringify(entry.en)}, en now says ${JSON.stringify(enAfter.get(key))}`,
      });
    }
  }
  return problems;
}

/** Splits findings into the ones a valid waiver covers and the ones it does not. */
export function applyLedger(findings, ledger, enAfter) {
  /** @type {Finding[]} */
  const unwaived = [];
  /** @type {Finding[]} */
  const waived = [];
  for (const finding of findings) {
    const entry = ledger.waivers[finding.key];
    const covers =
      entry !== undefined &&
      entry !== null &&
      typeof entry === 'object' &&
      entry.en === finding.enAfter &&
      // A waiver whose text no longer matches `en` is stale, and a stale waiver
      // waives nothing — otherwise the expiry rule above would be advisory.
      enAfter.get(finding.key) === entry.en;
    (covers ? waived : unwaived).push(finding);
  }
  return { unwaived, waived };
}

// -- CLI ----------------------------------------------------------------------

/**
 * Analysis for a repo root, given the two refs. `null` head = working tree.
 *
 * @param {string} root
 * @param {{ base: string, head?: string | null }} options
 */
export function analyze(root, { base, head = null }) {
  const treeAtBase = treeExistsAt(root, base);
  const before = treeAtBase ? readPacks(root, base) : new Map(LOCALES.map((lang) => [lang, new Map()]));
  const after = readPacks(root, head);
  const { findings, counters } = findDrift(before, after);
  return { before, after, findings, counters, treeAtBase };
}

/**
 * Whether the tree git runs in exists at `ref` (`<ref>:./`). False only for a
 * change that imports the tree -- see "A base commit with no objectui tree".
 *
 * @param {string} root
 * @param {string} ref
 * @returns {boolean}
 */
export function treeExistsAt(root, ref) {
  return gitQuiet(root, ['cat-file', '-e', revPath(ref, '')]) !== null;
}

// -- the designer table, a SECOND population (objectui#8834) ------------------

/**
 * `packages/app-shell/src/views/metadata-admin/i18n.ts` carries the Studio
 * designer's own module-local string tables, and until objectui#8834 they were
 * out of every i18n gate's population — including this one, whose header says
 * so above: "This table is not one of them".
 *
 * That blind spot is this gate's exact shape of defect. objectui#8413 changed
 * an English help string that said something untrue; the Chinese row said the
 * same untrue thing, and nothing would have failed had the author fixed only
 * the English one. The dispatch that ordered that fix asserted this gate would
 * name the changed value. It could not — the table is not a locale pack.
 *
 * ## Why a SEPARATE population and not an eleventh pack
 *
 * The table is module-local by deliberate design (see the header of
 * `check-i18n-dead-keys.mjs` for why), and folding it into `LOCALES` would put
 * it in front of `all-locales-key-parity`, `check-i18n-call-site-keys` and the
 * `--min-keys` floor, none of which can read it. It gets its own `before`/
 * `after` pair, its own single follower, and its own ledger section instead;
 * `findDrift` is reused unchanged.
 *
 * ## Why the 55 one-sided keys need no ledger here
 *
 * `ENGINE_STRINGS_ZH` carries 55 keys `ENGINE_STRINGS_EN` deliberately lacks.
 * This gate never sees them: it iterates the `en` side, and its per-key rule —
 * "a pack that does not define the key is skipped for that key" — already
 * handles the reverse direction. Key-set asymmetry is not this gate's business,
 * exactly as stated for the packs; `check-i18n-designer-table-parity.mjs` owns
 * that state invariant.
 */

/** The designer table's one follower. `en` leads, `zh` follows. */
export const DESIGNER_FOLLOWERS = ['zh'];

/**
 * The designer tables at `ref`, or from the working tree when `ref` is null.
 *
 * `require` is false only on the BASE side: a pair that does not exist yet at
 * the base commit is a fact about history, not a stale extractor, and the CLI
 * PRINTS every pair it had to skip for that reason rather than silently
 * comparing nothing. On the head side a missing table is loud, as it must be.
 *
 * @returns {{ values: Map<string, Map<string, string>>, fileMissing: boolean }}
 */
export function readDesignerTables(root, ref, { require = true } = {}) {
  const label = ref === null ? DESIGNER_TABLE : revPath(ref, DESIGNER_TABLE);
  let text;
  if (ref === null) {
    const full = join(root, DESIGNER_TABLE);
    if (!existsSync(full)) throw new Error(`${DESIGNER_TABLE} does not exist in the working tree`);
    text = readFileSync(full, 'utf8');
  } else {
    text = gitQuiet(root, ['show', revPath(ref, DESIGNER_TABLE)]);
    if (text === null) {
      if (require) throw new Error(`cannot read ${label} — is ${ref} in this clone?`);
      return { values: new Map(), fileMissing: true };
    }
  }
  return { values: readDesignerPairs(root, { source: text, label, require }), fileMissing: false };
}

/**
 * Folds the pair list into the `lang -> (key -> value)` shape `findDrift` reads.
 *
 * Keys are namespaced with the pair label (`TYPE_LABELS.object`), so two pairs
 * that both declare `object` stay distinct and every line this gate prints —
 * and every ledger entry anyone writes — names which table it is about.
 *
 * @returns {{ population: Map<string, Map<string, string>>, skipped: string[] }}
 */
export function designerPopulation(values) {
  const en = new Map();
  const zh = new Map();
  const skipped = [];
  for (const pair of DESIGNER_TABLE_PAIRS) {
    const enTable = values.get(pair.en);
    const zhTable = values.get(pair.zh);
    if (!enTable || !zhTable) {
      skipped.push(pair.label);
      continue;
    }
    for (const [key, value] of enTable) en.set(`${pair.label}.${key}`, value);
    for (const [key, value] of zhTable) zh.set(`${pair.label}.${key}`, value);
  }
  return { population: new Map([['en', en], ['zh', zh]]), skipped };
}

/**
 * The designer analysis for a repo root, given the two refs. `null` head = the
 * working tree, the same default the packs use and for the same reason.
 *
 * @param {string} root
 * @param {{ base: string, head?: string | null }} options
 */
export function analyzeDesigner(root, { base, head = null }) {
  const beforeRead = readDesignerTables(root, base, { require: false });
  const afterRead = readDesignerTables(root, head);
  const before = designerPopulation(beforeRead.values);
  const after = designerPopulation(afterRead.values);
  const { findings, counters } = findDrift(before.population, after.population, DESIGNER_FOLLOWERS);
  return {
    after: after.population,
    findings,
    counters,
    skippedAtBase: before.skipped,
    baseFileMissing: beforeRead.fileMissing,
  };
}


const invokedDirectly = isEntrypoint(import.meta.url);

if (invokedDirectly) {
  const argOf = (name) => {
    const index = process.argv.indexOf(name);
    return index > -1 ? process.argv[index + 1] : null;
  };

  // `--root` points the gate at a different checkout — a worktree, or one of the
  // throwaway repos `check-i18n-en-drift.test.ts` builds to exercise the exit
  // codes end to end. `--base` / `--head` name the two commits explicitly; both
  // default to the branch-vs-merge-base comparison CI runs.
  const root = resolve(argOf('--root') ?? resolve(scriptDir, '..'));

  const base = resolveBaseRef(root, { explicit: argOf('--base') });
  if (!base.ok) {
    console.error(
      'Cannot resolve the commit to compare against, so there is nothing to diff.\n' +
        `  tried: ${base.tried.join(', ')}\n` +
        (base.named
          ? '  That base was named EXPLICITLY, so it is not guessed around: comparing the packs\n' +
            '  against some other commit instead would answer a question nobody asked, and\n' +
            '  answer it confidently. Name a commit that exists in this clone, or pass none and\n' +
            '  let the merge base with the target branch be found.\n'
          : base.shallow
            ? '  This clone is SHALLOW. In CI, give the checkout `fetch-depth: 0`; locally,\n' +
              '  run `git fetch --no-tags origin main` (or `git fetch --unshallow`).\n'
            : '  Fetch the base branch (`git fetch --no-tags origin main`) and re-run.\n') +
        '  This is a failure, not a skip: a diff gate with no diff would pass while\n' +
        '  checking nothing. See the header of scripts/check-i18n-en-drift.mjs.',
    );
    process.exit(1);
  }

  const head = argOf('--head');
  const { after, findings, counters, treeAtBase } = analyze(root, { base: base.ref, head });
  const enAfter = after.get('en');

  // Guard against a refactor quietly emptying the comparison: with no keys, every
  // assertion here is trivially satisfied. Same reason `all-locales-key-parity.test.ts`
  // and `check-i18n-call-site-keys.mjs` both open with a size assertion. `--min-keys`
  // exists because this gate's own tests run it over ten-key fixture packs; the
  // DEFAULT is the number that matters and CI never passes the flag.
  const minKeys = Number(argOf('--min-keys') ?? 2000);
  const smallest = Math.min(...LOCALES.map((lang) => after.get(lang).size));
  if (smallest < minKeys) {
    console.error(
      `The scan collapsed: the smallest pack parsed to ${smallest} keys, expected at least ${minKeys}.` +
        ' The extractor is broken, and an empty comparison would pass while asserting nothing.',
    );
    process.exit(1);
  }

  const ledger = readLedger(root);
  const ledgerProblems = checkLedger(ledger, enAfter);
  const { unwaived, waived } = applyLedger(findings, ledger, enAfter);

  // The second population (objectui#8834). Same comparison, same ledger
  // mechanism, its own section of the ledger file — see `analyzeDesigner`.
  const designer = analyzeDesigner(root, { base: base.ref, head });
  const designerEnAfter = designer.after.get('en');
  const designerLedger = { waivers: ledger.designerWaivers };
  const designerLedgerProblems = checkLedger(designerLedger, designerEnAfter);
  const designerSplit = applyLedger(designer.findings, designerLedger, designerEnAfter);

  // The same collapse guard as above, for the same reason: an empty designer
  // population would satisfy every assertion about it trivially. The floor sits
  // well under today's 1702 en rows and is not a pin — adding strings is
  // routine and must not need this file edited.
  const minDesignerKeys = Number(argOf('--min-designer-keys') ?? 1500);
  if (designerEnAfter.size < minDesignerKeys) {
    console.error(
      `The designer scan collapsed: ${DESIGNER_TABLE} parsed to ${designerEnAfter.size} en key(s), ` +
        `expected at least ${minDesignerKeys}. The extractor is broken, and an empty comparison would ` +
        'pass while asserting nothing.',
    );
    process.exit(1);
  }

  console.log(
    `Compared the ten locale packs at ${base.ref.slice(0, 9)} (${base.how}) with ` +
      `${head ?? 'the working tree'}: ${counters.changedEnKeys} en value(s) changed ` +
      `(${counters.addedEnKeys} key(s) added, ${counters.removedEnKeys} removed — those are ` +
      `all-locales-key-parity's), ${counters.followedPacks} pack value(s) followed, ` +
      `${counters.absentInPack} pack/key pair(s) skipped because the pack does not define the key, ` +
      `${waived.length} finding(s) waived by the ledger` +
      (treeAtBase
        ? '.'
        : ' — this tree does not exist at the base commit (the change imports it), so every key is new ' +
          'here and there was no before side to compare.'),
  );

  console.log(
    `Compared ${DESIGNER_TABLE} over the same range: ${designer.counters.changedEnKeys} en value(s) ` +
      `changed (${designer.counters.addedEnKeys} key(s) added, ${designer.counters.removedEnKeys} removed ` +
      `— those are check:i18n-designer-parity's), ${designer.counters.followedPacks} zh value(s) followed, ` +
      `${designer.counters.absentInPack} key(s) skipped because the zh table does not define them, ` +
      `${designerSplit.waived.length} finding(s) waived by the ledger` +
      (designer.baseFileMissing
        ? ' — the file does not exist at the base commit, so it is entirely new here'
        : designer.skippedAtBase.length > 0
          ? ` — ${designer.skippedAtBase.join(', ')} did not exist at the base commit, so ` +
            'nothing was compared for those pair(s)'
          : '') +
      '.',
  );

  if (
    unwaived.length === 0 &&
    ledgerProblems.length === 0 &&
    designerSplit.unwaived.length === 0 &&
    designerLedgerProblems.length === 0
  ) {
    console.log(
      counters.changedEnKeys === 0
        ? 'No en value changed in this range.'
        : waived.length === 0
          ? 'Every changed en value was followed by all nine translation packs.'
          : `Every changed en value was followed by all nine translation packs, except ${waived.length} ` +
            `covered by a waiver in ${LEDGER_PATH}: ${waived.map((f) => f.key).join(', ')}.`,
    );
    console.log(
      designer.counters.changedEnKeys === 0
        ? 'No designer-table en value changed in this range.'
        : 'Every changed designer-table en value was followed by its zh row.',
    );
    process.exit(0);
  }

  if (unwaived.length > 0) {
    console.error(
      `\n${unwaived.length} en string(s) changed without their translations:\n`,
    );
    for (const finding of unwaived) {
      console.error(`  ${finding.key}`);
      console.error(`      en was:  ${JSON.stringify(finding.enBefore)}`);
      console.error(`      en now:  ${JSON.stringify(finding.enAfter)}`);
      console.error(`      unchanged in: ${finding.unfollowed.join(', ')}`);
    }
    console.error(
      '\nTranslate the new text in each pack listed, IN THIS PR. The nine packs going one\n' +
        'release out of date is how objectui#3582 and objectui#3625 happened: eight packs kept\n' +
        'serving a retired sentence, one of them as an idiomatic translation that every other\n' +
        'gate reads as perfectly healthy. Nothing downstream can find it again.\n' +
        `If a translation genuinely does not need to change, say so in ${LEDGER_PATH}:\n` +
        '  { "<key>": { "en": "<the new en text, verbatim>", "reason": "…", "issue": "objectui#1234" } }\n' +
        'A waiver covers that one sentence and expires the next time the key changes.',
    );
  }

  if (designerSplit.unwaived.length > 0) {
    console.error(
      `\n${designerSplit.unwaived.length} designer-table en string(s) changed without their zh row:\n`,
    );
    for (const finding of designerSplit.unwaived) {
      console.error(`  ${finding.key}`);
      console.error(`      en was:  ${JSON.stringify(finding.enBefore)}`);
      console.error(`      en now:  ${JSON.stringify(finding.enAfter)}`);
      console.error(`      unchanged in: ${finding.unfollowed.join(', ')}`);
    }
    console.error(
      `\nTranslate the new text in ${DESIGNER_TABLE}, IN THIS PR. objectui#8413 is the case study:\n` +
        'an English help string said something untrue and the Chinese row said the same untrue thing,\n' +
        'so fixing only the English half would have left the Chinese designer telling the old lie with\n' +
        'every gate in this repo green. The key is prefixed with its table.\n' +
        `If the zh row genuinely does not need to change, say so in ${LEDGER_PATH}:\n` +
        '  { "designerWaivers": { "<TABLE.key>": { "en": "<the new en text, verbatim>", "reason": "…", "issue": "objectui#1234" } } }\n' +
        'A waiver covers that one sentence and expires the next time the key changes.',
    );
  }

  if (designerLedgerProblems.length > 0) {
    console.error(`\n${designerLedgerProblems.length} problem(s) in ${LEDGER_PATH} designerWaivers:`);
    for (const problem of designerLedgerProblems) {
      console.error(`  [${problem.reason}] ${problem.key}: ${problem.detail}`);
    }
  }

  if (ledgerProblems.length > 0) {
    console.error(`\n${ledgerProblems.length} problem(s) in ${LEDGER_PATH}:`);
    for (const problem of ledgerProblems) {
      console.error(`  [${problem.reason}] ${problem.key}: ${problem.detail}`);
    }
    console.error(
      '\nA waiver names the exact en text it covers, so it stops applying as soon as that text\n' +
        'changes — delete the entry, or renew it against the new sentence. The ledger only\n' +
        'shrinks on its own; growing it also means raising the ceiling in\n' +
        'scripts/__tests__/check-i18n-en-drift.test.ts, where a reviewer will see it.',
    );
  }

  console.error('\nSee the header of scripts/check-i18n-en-drift.mjs.');
  process.exit(1);
}
