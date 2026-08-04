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

/** @returns {{ passed: boolean, lines: string[] }} */
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
  let passed = true;
  for (const testCase of cases) {
    const { problems } = validateLedger(testCase.text, today);
    let ok;
    if (testCase.expect === null) {
      ok = problems.length === 0;
    } else {
      ok = problems.length > 0 && problems.some((p) => testCase.expect.test(p));
    }
    if (!ok) passed = false;
    lines.push(
      `${ok ? '  ✓' : '  ✗'} ${testCase.name}` +
        (ok ? '' : `\n      got: ${problems.length === 0 ? '(no problems)' : problems.join('\n           ')}`),
    );
  }
  return { passed, lines };
}

function main() {
  if (process.argv.includes('--self-test')) {
    const { passed, lines } = selfTest();
    console.log('check-osv-exemptions self-test (both directions):');
    for (const line of lines) console.log(line);
    if (!passed) {
      console.error('\n✗ self-test failed — the ledger check does not do what it claims.');
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
