#!/usr/bin/env node
/**
 * Enforces the conventions that govern the OSV-Scanner exemption ledger
 * (`osv-scanner.toml`) — the single escape hatch of the OSV gate in
 * .github/workflows/validate-deps.yml.
 *
 * Run:        node scripts/check-osv-exemptions.mjs
 * Self-test:  node scripts/check-osv-exemptions.mjs --self-test
 *
 * Why a script and not a comment: OSV-Scanner v2.3.8 enforces none of this.
 * Verified against the real binary, on a lockfile with five live advisories:
 *
 *   - `ignoreUntil` omitted        → advisories filtered, scan exits 0, no
 *                                    warning, forever. A silent permanent
 *                                    exemption, which is the same failure as
 *                                    a permanently red job — nobody looks.
 *   - `ignoreUntil` in the past    → advisories reported again, exit 1. The
 *                                    expiry itself IS native and mechanical,
 *                                    so the gate turns red on its own; what
 *                                    is missing is any requirement to set it.
 *   - `reason` = "probe"           → accepted. The scanner never reads it.
 *   - `ignoreUntil` quoted         → the WHOLE config file is discarded with
 *                                    an "Ignored invalid config file" line on
 *                                    stderr and the scan proceeds; one typo
 *                                    silently voids every other exemption.
 *
 * So: the scanner expires an exemption that carries a date, and this check
 * makes carrying a well-formed, still-plausible date (and a reviewable
 * reason) the only way an exemption can exist at all. Conventions 1 and 2 of
 * #4965 are enforced here; convention 3 (an exemption lands in its own,
 * labelled PR) is discipline and is stated in osv-scanner.toml's header.
 *
 * No dependencies — runs before/without `pnpm install`. The ledger is a tiny,
 * deliberately restricted TOML subset, so it is parsed here rather than
 * pulling in a TOML package (same approach as check-override-consistency.mjs
 * with pnpm-workspace.yaml). Anything outside that subset is a hard failure
 * with instructions, never a silent skip: a construct this parser does not
 * understand is a construct nobody has agreed to allow in the ledger.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const LEDGER_PATH = resolve(repoRoot, 'osv-scanner.toml');

/** Recommended exemption window, in days — what a fresh entry should use. */
const DEFAULT_WINDOW_DAYS = 30;
/**
 * Hard ceiling for `ignoreUntil`, in days from today. Without a ceiling
 * "mandatory expiry" is satisfied by `ignoreUntil = 2099-01-01`, i.e. by a
 * permanent exemption wearing a date. The ceiling only ever gets easier to
 * satisfy as the clock runs, so it cannot fail an entry that passed when it
 * was written.
 */
const MAX_WINDOW_DAYS = 90;
/** Minimum prose (reason with the URLs removed) that counts as a rationale. */
const MIN_REASON_PROSE_CHARS = 40;

const ALLOWED_TABLE = 'IgnoredVulns';
const REQUIRED_KEYS = ['id', 'ignoreUntil', 'reason'];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?$/;
const ADVISORY_ID_RE = /^[A-Z][A-Z0-9]*-[A-Za-z0-9.-]+$/;
const PLACEHOLDER_RE = /\bTODO\b|\bFIXME\b|x{4,}/i;

/**
 * @typedef {{ kind: 'string' | 'date', value: string, line: number }} Field
 * @typedef {{ line: number, fields: Map< string, Field > }} Entry
 */

/**
 * Parse the ledger's restricted TOML subset: `[[IgnoredVulns]]` tables whose
 * values are basic strings (single- or multi-line) and bare dates.
 *
 * @param {string} text
 * @returns {{ entries: Entry[], problems: string[] }}
 */
function parseLedger(text) {
  /** @type {Entry[]} */
  const entries = [];
  /** @type {string[]} */
  const problems = [];
  const lines = text.split(/\r?\n/);

  /** @type {Entry | null} */
  let current = null;
  /** @type {{ key: string, line: number, parts: string[] } | null} */
  let pending = null;

  const setField = (key, field, lineNo) => {
    if (!current) {
      problems.push(
        `line ${lineNo}: key \`${key}\` sits outside a [[${ALLOWED_TABLE}]] table. ` +
          `The ledger holds exemptions and nothing else.`,
      );
      return;
    }
    if (current.fields.has(key)) {
      problems.push(`line ${lineNo}: duplicate key \`${key}\` in one exemption.`);
      return;
    }
    current.fields.set(key, { ...field, line: lineNo });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const raw = lines[i];

    if (pending) {
      const end = raw.indexOf('"""');
      if (end === -1) {
        pending.parts.push(raw.trim());
        continue;
      }
      pending.parts.push(raw.slice(0, end).trim());
      setField(pending.key, { kind: 'string', value: pending.parts.join(' ').trim() }, pending.line);
      pending = null;
      continue;
    }

    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    if (line.startsWith('[')) {
      const arrayTable = /^\[\[\s*([A-Za-z0-9_.]+)\s*\]\]\s*(#.*)?$/.exec(line);
      if (arrayTable) {
        if (arrayTable[1] !== ALLOWED_TABLE) {
          problems.push(
            `line ${lineNo}: [[${arrayTable[1]}]] is not allowed in this ledger — ` +
              `only [[${ALLOWED_TABLE}]]. Other OSV-Scanner config tables ` +
              `(PackageOverrides, GoVersionOverride) can suppress findings too, and ` +
              `none of the #4965 conventions cover them. If you genuinely need one, ` +
              `decide its conventions first and teach this script about it.`,
          );
          current = null;
          continue;
        }
        current = { line: lineNo, fields: new Map() };
        entries.push(current);
        continue;
      }
      problems.push(
        `line ${lineNo}: unsupported table header \`${line}\` — the ledger accepts ` +
          `only [[${ALLOWED_TABLE}]] entries.`,
      );
      current = null;
      continue;
    }

    const eq = line.indexOf('=');
    if (eq <= 0) {
      problems.push(`line ${lineNo}: cannot parse \`${line}\` as \`key = value\`.`);
      continue;
    }
    const key = line.slice(0, eq).trim();
    const rest = line.slice(eq + 1).trim();

    if (rest.startsWith('"""')) {
      const after = rest.slice(3);
      const end = after.indexOf('"""');
      if (end === -1) {
        pending = { key, line: lineNo, parts: [after.trim()] };
      } else {
        setField(key, { kind: 'string', value: after.slice(0, end).trim() }, lineNo);
      }
      continue;
    }

    if (rest.startsWith('"')) {
      const parsed = readBasicString(rest);
      if (!parsed) {
        problems.push(`line ${lineNo}: unterminated string for \`${key}\`.`);
        continue;
      }
      const trailing = parsed.rest.trim();
      if (trailing !== '' && !trailing.startsWith('#')) {
        problems.push(`line ${lineNo}: unexpected text after the value of \`${key}\`.`);
        continue;
      }
      setField(key, { kind: 'string', value: parsed.value }, lineNo);
      continue;
    }

    const bare = rest.replace(/#.*$/, '').trim();
    if (DATE_RE.test(bare) || DATETIME_RE.test(bare)) {
      setField(key, { kind: 'date', value: bare }, lineNo);
      continue;
    }
    problems.push(
      `line ${lineNo}: value of \`${key}\` is neither a quoted string nor a bare ` +
        `TOML date: \`${bare}\`.`,
    );
  }

  if (pending) {
    problems.push(`line ${pending.line}: unterminated multi-line string for \`${pending.key}\`.`);
  }

  return { entries, problems };
}

/**
 * Read a TOML basic string starting at index 0 of `input`.
 *
 * @param {string} input
 * @returns {{ value: string, rest: string } | null}
 */
function readBasicString(input) {
  let value = '';
  for (let i = 1; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '\\') {
      const next = input[i + 1];
      if (next === undefined) return null;
      const escapes = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' };
      value += escapes[next] ?? next;
      i += 1;
      continue;
    }
    if (ch === '"') return { value, rest: input.slice(i + 1) };
    value += ch;
  }
  return null;
}

/** @param {Date} date @returns {number} UTC midnight of that calendar day */
function utcMidnight(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** @param {string} value a `YYYY-MM-DD` or RFC3339 value @returns {number | null} */
function parseLedgerDate(value) {
  const m = DATE_RE.exec(value) ?? DATETIME_RE.exec(value);
  if (!m) return null;
  const [, y, mo, d] = m;
  const stamp = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  const back = new Date(stamp);
  if (back.getUTCMonth() !== Number(mo) - 1 || back.getUTCDate() !== Number(d)) return null;
  return stamp;
}

/** @param {number} days @returns {string} `YYYY-MM-DD`, `days` from today */
function isoDaysFromToday(days, today) {
  return new Date(utcMidnight(today) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * @param {string} text ledger contents
 * @param {Date} today
 * @returns {{ problems: string[], count: number }}
 */
function validateLedger(text, today) {
  const { entries, problems } = parseLedger(text);
  const todayStamp = utcMidnight(today);
  const seenIds = new Map();

  entries.forEach((entry, index) => {
    const label = `exemption #${index + 1} (line ${entry.line})`;

    for (const key of entry.fields.keys()) {
      if (!REQUIRED_KEYS.includes(key)) {
        problems.push(
          `${label}: unknown key \`${key}\`. An exemption is exactly ` +
            `\`id\` + \`ignoreUntil\` + \`reason\`.`,
        );
      }
    }
    for (const key of REQUIRED_KEYS) {
      if (!entry.fields.has(key)) {
        problems.push(
          key === 'ignoreUntil'
            ? `${label}: no \`ignoreUntil\`. OSV-Scanner reads a missing expiry as ` +
              `"ignore forever" and says nothing — that is precisely the silent ` +
              `permanent exemption #4965 forbids. Set one (default ` +
              `${DEFAULT_WINDOW_DAYS} days: ` +
              `\`ignoreUntil = ${isoDaysFromToday(DEFAULT_WINDOW_DAYS, today)}\`).`
            : `${label}: no \`${key}\`.`,
        );
      }
    }

    const id = entry.fields.get('id');
    if (id) {
      if (id.kind !== 'string' || id.value.trim() === '') {
        problems.push(`${label}: \`id\` must be a non-empty quoted advisory id.`);
      } else if (!ADVISORY_ID_RE.test(id.value.trim())) {
        problems.push(
          `${label}: \`id\` = "${id.value}" does not look like an advisory id ` +
            `(GHSA-…, CVE-…, GO-…).`,
        );
      } else if (PLACEHOLDER_RE.test(id.value)) {
        problems.push(`${label}: \`id\` = "${id.value}" is still the template placeholder.`);
      } else {
        const key = id.value.trim();
        if (seenIds.has(key)) {
          problems.push(
            `${label}: duplicate exemption for ${key} (first at line ${seenIds.get(key)}). ` +
              `OSV-Scanner only honours the first, so the second is a lie in the ledger.`,
          );
        } else {
          seenIds.set(key, entry.line);
        }
      }
    }

    const until = entry.fields.get('ignoreUntil');
    if (until) {
      if (until.kind !== 'date') {
        problems.push(
          `${label}: \`ignoreUntil\` must be a BARE TOML date (\`ignoreUntil = ` +
            `${isoDaysFromToday(DEFAULT_WINDOW_DAYS, today)}\`), never quoted. A quoted ` +
            `value makes OSV-Scanner discard this entire file — every other exemption ` +
            `in it silently stops applying.`,
        );
      } else {
        const stamp = parseLedgerDate(until.value);
        if (stamp === null) {
          problems.push(`${label}: \`ignoreUntil\` = ${until.value} is not a real calendar date.`);
        } else if (stamp <= todayStamp) {
          const days = Math.round((todayStamp - stamp) / 86_400_000);
          problems.push(
            `${label}: \`ignoreUntil\` = ${until.value} EXPIRED ${days} day(s) ago. ` +
              `Re-decide it, do not extend it reflexively: take the fix if one now ` +
              `exists (then delete this entry), or renew it in its own PR with a ` +
              `reason that argues the premise again.`,
          );
        } else {
          const days = Math.round((stamp - todayStamp) / 86_400_000);
          if (days > MAX_WINDOW_DAYS) {
            problems.push(
              `${label}: \`ignoreUntil\` = ${until.value} is ${days} days out, over the ` +
                `${MAX_WINDOW_DAYS}-day ceiling. An expiry far enough away is a permanent ` +
                `exemption with a date on it. Default window is ` +
                `${DEFAULT_WINDOW_DAYS} days (\`${isoDaysFromToday(DEFAULT_WINDOW_DAYS, today)}\`).`,
            );
          }
        }
      }
    }

    const reason = entry.fields.get('reason');
    if (reason) {
      if (reason.kind !== 'string') {
        problems.push(`${label}: \`reason\` must be a quoted string.`);
      } else {
        const value = reason.value;
        const links = value.match(/https:\/\/\S+/g) ?? [];
        const prose = value
          .replace(/https?:\/\/\S+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (links.length === 0) {
          problems.push(
            `${label}: \`reason\` cites no advisory link. Whoever reviews this at ` +
              `renewal has to re-read the advisory; give them the https:// URL.`,
          );
        }
        if (prose.length < MIN_REASON_PROSE_CHARS) {
          problems.push(
            `${label}: \`reason\` carries ${prose.length} characters of rationale beside ` +
              `the link (need ${MIN_REASON_PROSE_CHARS}). Write the sentence that says why ` +
              `this cannot be fixed or routed around — no upstream release, patch only in ` +
              `a major we cannot take yet, transitive through X.`,
          );
        }
        if (PLACEHOLDER_RE.test(value)) {
          problems.push(`${label}: \`reason\` still contains template placeholder text.`);
        }
      }
    }
  });

  return { problems, count: entries.length };
}

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `passed` used to be this self-test's ONLY success condition, so "every case
// held" and "the cases never ran" printed the same line. Closed the way PR
// #13487 validated on check-doc-authoring: what is pinned is the registered
// NAMES, not a number.
//
// This self-test is TABLE-DRIVEN — one literal `cases` table, one loop over it,
// and a sink that writes only when a case FAILS. Routing THAT sink through
// `registerCase()` would register a case only when it fails: a fully green run
// would register 0 and every battery would read DID NOT RUN, the floor inverted
// rather than installed. So the roster is the table's own rows. Each row's
// `name` is a declared battery, verbatim, with a floor of 1, and
// `registerCase(name)` is the FIRST statement of the driving loop body — so the
// case is attributed to the row actually being run, whatever that row asserts
// afterwards. There is no `battery()` opener: for a table-driven self-test the
// ROW is the battery, so attribution is the loop variable rather than a
// most-recently-opened section.
//
// ⛔ A pinned TOTAL is not the repair, and neither is a roster DERIVED from the
// table: `cases.length` moves with the table, so a deleted row would delete its
// own floor. The roster below is a LITERAL the table is checked against, which
// is what lets a deleted or renamed row name ITSELF in the refusal.
//
// The counts are a FLOOR, not an equality — a row that grows into several
// registrations must not red. 1 is the honest floor for a table row: the loop
// reaches it exactly once per run.
//
// ── Why the LEDGER is module-level and the CHECK sits at the verdict site ──
//
// This gate splits its self-test in two: `selfTest()` REGISTERS and returns its
// failure count, and `main()` DECIDES — it prints the per-case lines, the red
// line or the green one. There is no verdict site inside the registering body,
// so the floor is evaluated where the green line already is (inside `main()`'s
// `--self-test` branch, so it can never fire on a production run). The ledger it
// reads therefore has to outlive `selfTest()`'s frame — hence module scope
// rather than the local map the single-body recipe closes over. Only the CHECK's
// location moves; attribution and scope are untouched. This is the class-3
// placement PR #15309 settled.
//
// ⛔ The floor is NOT placed at the end of `selfTest()` before its `return`: an
// early return anywhere above that line would skip the check entirely — the
// exact defect the #13798 verdict handshake exists to catch — coupling hole 1
// to hole 2 after the card ruled them orthogonal. Evaluated at the verdict site,
// the same early return lands as a count BELOW the floor and reds.
const SELF_TEST_BATTERIES = Object.freeze({
  'missing/empty ledger → green': 1,
  'comments-only ledger (zero exemptions) → green': 1,
  'well-formed exemption inside the window → green': 1,
  'multi-line reason → green': 1,
  'expired ignoreUntil → red': 1,
  'ignoreUntil == today → red (the scanner already stopped ignoring it)': 1,
  'missing ignoreUntil → red': 1,
  'quoted ignoreUntil → red': 1,
  'ignoreUntil beyond the ceiling → red': 1,
  'reason without an advisory link → red': 1,
  'reason that is only a link → red': 1,
  'untouched template placeholders → red': 1,
  'missing reason → red': 1,
  'unknown key → red': 1,
  'duplicate id → red': 1,
  '[[PackageOverrides]] escape hatch → red': 1,
  'top-level key outside a table → red': 1,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too. This pin is also half of
// the duplicate-label refusal: two rows sharing a name collapse to ONE key in
// the literal above, so the roster falls below this number; the table
// cross-check in `batteryFloorFailures()` is the other half, and names WHICH
// label collided.
const SELF_TEST_BATTERY_FLOOR = 17;

// The ledger `batteryFloorFailures()` reads from the OTHER function, and the
// row labels the table actually presented on this run — both module-level
// because the body that fills them is not the body that reads them.
//
// ⚠️ Named for the roster's role, deliberately NOT with a self-test spelling:
// `check:pm-dispatch-gates` anchors on a top-level declaration whose NAME spells
// self-test and every such name owes a row in its COMPOUND_ANCHOR_LEDGER. This
// machinery holds no fixtures to mask and reads no path literal, so the accurate
// name is the one that says `battery`.
const batterySeen = new Map();
let batteryRowLabels = [];

/** Called by `selfTest()`'s driving loop, once per row, before the row runs. */
function registerCase(name) {
  batterySeen.set(name, (batterySeen.get(name) ?? 0) + 1);
}

/**
 * The floor: every declared row RAN, and ran its case (#13489).
 *
 * Guards the registrations made by **`selfTest()`** — the body whose driving
 * loop calls `registerCase()`. It is called from `main()`'s `--self-test`
 * branch immediately before the success line, so that line can only be printed
 * by a run in which the set of rows that registered EQUALS the set declared,
 * each at or above its own count. A set difference says WHICH row stopped; a
 * count says only that something did.
 *
 * @returns {string[]} floor breaches; empty means the floor held
 */
function batteryFloorFailures() {
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const problems = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    problems.push(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  const duplicated = [...new Set(batteryRowLabels.filter((name, i) => batteryRowLabels.indexOf(name) !== i))];
  if (duplicated.length > 0) {
    problems.push(
      `the cases table uses ${duplicated.map((n) => JSON.stringify(n)).join(', ')} as a row label more than once — ` +
        'two rows sharing a label are ONE battery, so the second can stop running while the first keeps the floor met.',
    );
  }
  for (const [name, count] of batterySeen) {
    if (declared.includes(name)) continue;
    problems.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — a case attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    problems.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed that case holds.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (problems.length) {
    problems.push(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the ' +
        'number. Find what stopped registering (a deleted row, a renamed label, a loop that no longer ' +
        'reaches it) and restore it.',
    );
  }
  return problems;
}

/** @returns {{ failures: number, lines: string[] }} */
// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798). The self-test's own exit code stays load-bearing, so the
// handshake is a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

function selfTest() {
  const today = new Date(Date.UTC(2026, 7, 4)); // 2026-08-04, fixed
  const good = [
    '[[IgnoredVulns]]',
    'id = "GHSA-3jxr-9vmj-r5cp"',
    'ignoreUntil = 2026-08-25',
    'reason = "https://github.com/advisories/GHSA-3jxr-9vmj-r5cp — upstream has shipped no fixed release; the patch exists only in foo@6, which needs the ESM migration in #1234."',
  ].join('\n');

  const cases = [
    { name: 'missing/empty ledger → green', text: '', expect: null },
    { name: 'comments-only ledger (zero exemptions) → green', text: '# nothing here\n', expect: null },
    { name: 'well-formed exemption inside the window → green', text: good, expect: null },
    {
      name: 'multi-line reason → green',
      text: [
        '[[IgnoredVulns]]',
        'id = "CVE-2026-1234"',
        'ignoreUntil = 2026-09-01',
        'reason = """',
        'https://nvd.nist.gov/vuln/detail/CVE-2026-1234',
        'No fixed release upstream; the only patch rides a major we cannot take yet.',
        '"""',
      ].join('\n'),
      expect: null,
    },
    {
      name: 'expired ignoreUntil → red',
      text: good.replace('2026-08-25', '2026-07-25'),
      expect: /EXPIRED 10 day\(s\) ago/,
    },
    {
      name: 'ignoreUntil == today → red (the scanner already stopped ignoring it)',
      text: good.replace('2026-08-25', '2026-08-04'),
      expect: /EXPIRED/,
    },
    {
      name: 'missing ignoreUntil → red',
      text: good.replace('ignoreUntil = 2026-08-25\n', ''),
      expect: /no `ignoreUntil`/,
    },
    {
      name: 'quoted ignoreUntil → red',
      text: good.replace('ignoreUntil = 2026-08-25', 'ignoreUntil = "2026-08-25"'),
      expect: /BARE TOML date/,
    },
    {
      name: 'ignoreUntil beyond the ceiling → red',
      text: good.replace('2026-08-25', '2099-01-01'),
      expect: /over the 90-day ceiling/,
    },
    {
      name: 'reason without an advisory link → red',
      text: good.replace(/reason = ".*"/, 'reason = "Not exploitable in our code path at all, we are quite sure of it."'),
      expect: /cites no advisory link/,
    },
    {
      name: 'reason that is only a link → red',
      text: good.replace(/reason = ".*"/, 'reason = "https://github.com/advisories/GHSA-3jxr-9vmj-r5cp"'),
      expect: /characters of rationale/,
    },
    {
      name: 'untouched template placeholders → red',
      text: good.replace('GHSA-3jxr-9vmj-r5cp"', 'GHSA-xxxx-xxxx-xxxx"'),
      expect: /template placeholder/,
    },
    {
      name: 'missing reason → red',
      text: good.replace(/reason = ".*"\n?/, ''),
      expect: /no `reason`/,
    },
    {
      name: 'unknown key → red',
      text: `${good}\nseverity = "low"`,
      expect: /unknown key `severity`/,
    },
    {
      name: 'duplicate id → red',
      text: `${good}\n\n${good}`,
      expect: /duplicate exemption/,
    },
    {
      name: '[[PackageOverrides]] escape hatch → red',
      text: '[[PackageOverrides]]\nname = "foo"\nignore = true\n',
      expect: /is not allowed in this ledger/,
    },
    {
      name: 'top-level key outside a table → red',
      text: 'GoVersionOverride = "1.20.0"\n',
      expect: /outside a \[\[IgnoredVulns\]\] table/,
    },
  ];

  const lines = [];
  // The row labels this run actually presented, for the floor's table
  // cross-check at the verdict site (#13489).
  batteryRowLabels = cases.map((testCase) => testCase.name);
  let failures = 0;
  for (const testCase of cases) {
    registerCase(testCase.name);
    const { problems } = validateLedger(testCase.text, today);
    let ok;
    if (testCase.expect === null) {
      ok = problems.length === 0;
    } else {
      ok = problems.length > 0 && problems.some((p) => testCase.expect.test(p));
    }
    if (!ok) failures++;
    lines.push(
      `${ok ? '  ✓' : '  ✗'} ${testCase.name}` +
        (ok ? '' : `\n      got: ${problems.length === 0 ? '(no problems)' : problems.join('\n           ')}`),
    );
  }
  selfTestReachedVerdict = true;
  return { failures, lines };
}

function main() {
  if (process.argv.includes('--self-test')) {
    // Read BEFORE destructuring: an early return yields `undefined`, and
    // destructuring that throws a TypeError before the handshake is reached —
    // an accidental non-zero exit is not a verdict handshake (#13798).
    const selfTestResult = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-osv-exemptions self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    const { failures, lines } = selfTestResult;
    console.log('check-osv-exemptions self-test (both directions):');
    for (const line of lines) console.log(line);
    // ── The assertion floor, at the verdict site (#13489) ─────────────────
    // `selfTest()` registers but does not decide, so the floor over ITS
    // registrations is evaluated here, after every row has had its chance and
    // immediately before the success line — the only place a run that
    // registered nothing can still be stopped from reporting that every case
    // held. Its breaches share this branch's counted sink, so one red line
    // covers cases and floor alike.
    const floorProblems = batteryFloorFailures();
    for (const problem of floorProblems) console.error(`✗ self-test floor: ${problem}`);
    const total = failures + floorProblems.length;
    if (total > 0) {
      console.error(`\n✗ check-osv-exemptions self-test: ${total} failure(s) (cases and floor).`);
      process.exit(1);
    }
    console.log('\n✓ self-test passed: valid ledgers accepted, every convention breach rejected.');
    return;
  }

  let text;
  try {
    text = readFileSync(LEDGER_PATH, 'utf8');
  } catch {
    console.log('✓ No osv-scanner.toml — zero OSV exemptions, nothing to check.');
    return;
  }

  const { problems, count } = validateLedger(text, new Date());
  if (problems.length === 0) {
    console.log(
      count === 0
        ? '✓ osv-scanner.toml holds zero OSV exemptions (the intended steady state).'
        : `✓ ${count} OSV exemption(s) in osv-scanner.toml: all carry an unexpired ` +
          `ignoreUntil within ${MAX_WINDOW_DAYS} days and a reason with an advisory link.`,
    );
    if (count > 0) {
      console.log(
        '  Reminder (convention 3, discipline — not checkable here): adding or renewing\n' +
          '  an exemption belongs in its own `osv-exemption`-labelled PR, never bundled\n' +
          '  into a feature or dependency-bump PR.',
      );
    }
    return;
  }

  console.error('✗ osv-scanner.toml violates the OSV exemption conventions (#4965).\n');
  console.error(
    'An exemption suppresses a known vulnerability in a required security gate, so it\n' +
      'must expire on its own and must explain itself to whoever inherits it:\n',
  );
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    `\nThe full conventions are in the header of osv-scanner.toml. Re-run:\n` +
      `  node scripts/check-osv-exemptions.mjs\n` +
      `  node scripts/check-osv-exemptions.mjs --self-test   # proves this check both ways`,
  );
  process.exit(1);
}

main();
