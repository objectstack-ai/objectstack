#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The bash-3.2 floor, repo-wide (#12221).
 *
 *   node scripts/check-bash32-floor.mjs
 *   node scripts/check-bash32-floor.mjs --self-test
 *
 * ## The class, and why CI is blind to it by construction
 *
 * Every shell script this repo ships runs under `/usr/bin/env bash`, and on
 * macOS that is bash 3.2.57 — Apple ships no bash 4+, for licensing reasons.
 * CI runs bash 5, where every bash-4-only construct works. So a bash-4 builtin
 * in a hand-run script is invisible to a normal green run: the defect AND its
 * repair both read as green, and the only reader who ever sees the failure is
 * an operator on a Mac, at the moment they most need the script to work.
 *
 * Two incidents, four sites, both found by hand and late:
 *
 *   - a release helper died at status 127 with `mapfile: command not found` as
 *     its ONLY output, so the warning it exists to print could not print;
 *   - the shared verify lock used `mapfile` and `EPOCHSECONDS`, where the 3.2
 *     symptom is worse than a crash: `EPOCHSECONDS` unbound leaves the deadline
 *     empty and turns a bounded wait into an unbounded spin.
 *
 * A sweep found and fixed all four. Nothing stopped a fifth being typed. Today's
 * coverage before this gate was two FILE-SCOPED scans living inside two
 * unrelated gates' self-tests — which is the arrangement that let the class
 * survive in the first place.
 *
 * ## What this gate is NOT
 *
 * ⛔ It does not supersede those two scans and must not be used to retire them.
 * A static scan sees parse-level constructs a simulated run cannot reach; a
 * simulated run (`enable -n mapfile readarray` via `BASH_ENV`, plus `unset` of
 * the bash-5 variables) proves the real code path COMPLETES without them, and
 * reaches constructs assembled at runtime that no static scan can see. They
 * catch different things. This gate is the repo-wide third leg — defence in
 * depth over the class, at the price of a regex — and the blind spot named
 * under "Known limit" below is exactly the half the simulation harness holds.
 *
 * ## The exemption rule: telling a HUNTER from a USER
 *
 * The hard part of a repo-wide scan is that the files which document this floor
 * have to NAME the constructs they refuse in order to explain why, and the
 * lock's own self-test has to name them in order to hunt them. A scan that
 * cannot tell a mention from a use reddens itself on day one. Measured on this
 * tree with the tree's existing rule (full-line comments exempt, everything
 * else a use): 8 findings, every one of them a false positive, all in one file.
 *
 * So the rule is not "exempt these files" — an allowlist of filenames rots, and
 * a rotting allowlist is how this class survived. The rule is that an
 * occurrence is a USE unless the LINE ITSELF carries mechanical evidence that
 * it is not, and there are exactly three such pieces of evidence:
 *
 *   E1  FULL-LINE COMMENT (`^\s*#`). Inherited verbatim from the file-scoped
 *       scan this generalises, whose own comment states the reason: a file
 *       refusing a construct has to name it. Full-line only — a trailing
 *       comment on a code line is not exempt, because the code half still runs.
 *
 *   E2  A VARIABLE IS ONLY READ THROUGH A SIGIL, AND A GUARDED READ IS THE FIX.
 *       `EPOCHSECONDS` as a bare word is not a read at all — `unset EPOCHSECONDS`
 *       is a no-op on 3.2, and so is naming it in a string. Only `$EPOCHSECONDS`
 *       or `${EPOCHSECONDS...}` reads it, and only an UNGUARDED read is fatal
 *       under `set -u`. `${EPOCHSECONDS:-}` is not a mention being tolerated: it
 *       is the repair, and the shared lock is written that way on purpose.
 *
 *   E3  A BUILTIN OR RESERVED WORD ONLY EXECUTES IN COMMAND POSITION.
 *       `enable -n mapfile readarray` does not invoke `mapfile`; it removes it,
 *       which is what a simulated-3.2 harness does and the opposite of a use.
 *       A token inside a quoted argument — a test-case label, a message — does
 *       not invoke anything either. Neither is preceded by a command separator.
 *
 * Each of the three is a property of the shell, not a concession, and each is
 * pinned in both directions in `--self-test` below.
 *
 * ## Known limit, stated rather than discovered later
 *
 * A construct assembled at runtime is not in command position anywhere the
 * scanner can see it: `eval "mapfile -t x < f"` and `bash -c 'mapfile ...'` both
 * pass. That is a real hole and it is deliberate — closing it needs a shell
 * parser, and widening E3 instead would re-red the tree on the very files that
 * hunt these tokens. The hole is precisely what the retained SIMULATED runs
 * cover: they execute the real path with the builtin disabled, so a dynamically
 * built `mapfile` fails there and nowhere else. Two instruments, one class.
 *
 * ## The 4.0 operator set, and what is deliberately NOT in the table
 *
 * A denylist's absences read as approvals, so the absences are written down
 * here rather than left to be re-derived one card at a time. After the sweep,
 * every OPERATOR bash 4.0 added has a row: `|&`, `&>>`, `;&`, `;;&`,
 * `${x^^}`/`${x,,}`, and the `{x..y..incr}` brace increment. Out, with reasons:
 *
 *   `**` (globstar). Not a construct on its own — `**` without `shopt -s
 *   globstar` is two ordinary globs and legal on 3.2, so what is refusable is
 *   the option, and the `shopt-4` row already refuses it. A literal `**` token
 *   would also fire on arithmetic exponentiation and on every doubled asterisk
 *   in a `find` argument.
 *
 *   `test -v` / `[ -v ]`. The `-v` unary is bash 4.1 for `test`, `[` and `[[`
 *   alike, and the `has-v` row sees only the `[[` spelling — a real hole. It is
 *   NOT closed by widening that pattern, because `[ -v` is also the opening of
 *   an ordinary bracket EXPRESSION: `tr -d '[ -v]'` is the character range
 *   space-to-v. That row needs a false-positive judgement this sweep did not
 *   take, so it is filed rather than guessed at.
 *
 *   New FLAGS on builtins already refused whole (`mapfile -d`, `readarray -C`).
 *   A `builtin` row refuses its builtin at every flag, so these need no row.
 *
 *   Variables added after 4.0 — `BASH_XTRACEFD` (4.1), `BASH_ARGV0` (5.0),
 *   `SRANDOM` (5.1), `PROMPT_DIRTRIM`. Outside the 4.0 line this sweep drew.
 *   They are named here so the next reader inherits the list instead of
 *   rediscovering it, which is the cost this section exists to stop paying.
 *
 * ## Population
 *
 * Tracked files under `POPULATION_ROOTS` that are shell: a `.sh` name, or a
 * `sh`/`bash`/`dash`/`ksh`/`zsh` shebang whatever the name. The shebang half is
 * not decoration — measured on this tree it adds `.githooks/pre-commit` and
 * `.githooks/pre-push`, two `#!/bin/sh` scripts a `*.sh` glob does not see and
 * whose floor is TIGHTER than bash 3.2, not looser. An extension-only census
 * would have called this population complete at 18 while running past both.
 *
 * Deliberately OUT: `package.json` script bodies and heredocs inside `.mjs`.
 * Both really can carry shell, and both are excluded for the same reason — the
 * scanner would have to decide which spans of a non-shell file are shell before
 * it could judge a line, and a wrong answer there is a finding fabricated out
 * of JavaScript. The population is files whose WHOLE content is shell, which is
 * decidable from the name and the first line and from nothing else.
 *
 * Discovery reads the git index, so an ignored or generated file is never
 * scanned and a newly tracked script is scanned the moment it is staged.
 * An empty population is a REFUSAL, not a quiet pass (#4690).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { isEntrypoint } from './invoked-as.mjs';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * The population, declared as SUBTREE GLOBS — the one spelling that is both a
 * watch hint the dispatch derivation can read and a claim narrow enough to be
 * true.
 *
 * ⛔ These must stay SOURCE LITERALS. A root assembled at runtime
 * (`` `${r}/**` ``) builds no watch hint at all, which is the invisible half of
 * the bare-root species: a gate nameable by no dispatch brief, leaving no
 * residue saying so. And the glob form is what keeps this out of the
 * `escapable-literal` species too — the extractor admits any literal carrying a
 * separator, and refuses a bare single-segment word.
 *
 * The walk roots are DERIVED from these globs one line below rather than
 * re-spelled, so the declaration and the scan cannot drift apart: there is no
 * second place to edit.
 */
export const POPULATION_ROOTS = ['scripts/**', '.claude/hooks/**', '.githooks/**'];

/** The declared globs, collapsed to the directories the index is queried for. */
export const WALK_ROOTS = POPULATION_ROOTS.map((glob) => glob.replace(/\/\*\*$/, ''));

/**
 * A shell shebang. `sh` is in the set on purpose and is the STRICTER case:
 * `/bin/sh` is bash 3.2 in posix mode on macOS and dash on Debian, so every
 * construct below is out of bounds there for two independent reasons.
 */
const SHELL_SHEBANG = /^#![ \t]*(?:\S*\/)?(?:env[ \t]+)?(?:[a-z]*sh)\b/;

/**
 * Command position: the places a word can START a command, which is the only
 * place a builtin or reserved word executes.
 *
 * Start of line, or after a separator (`;` `&` `|` `(` `)` `{` `}` `` ` ``, or
 * `$(`), then optional leading reserved words and `VAR=value` prefixes, which
 * are the two things that may legally sit between a separator and a command.
 * `&&` and `||` need no separate case — their second character is already in
 * the class.
 */
const CMD_POS =
  String.raw`(?:^|[;&|(){}\x60]|\$\()[ \t]*` +
  String.raw`(?:(?:!|time|if|then|elif|else|while|until|do)[ \t]+)*` +
  String.raw`(?:[A-Za-z_][A-Za-z0-9_]*=[^ \t;|&]*[ \t]+)*`;

/**
 * The constructs, each with the version that introduced it and what a 3.2 host
 * actually does when it meets one.
 *
 * ⚠️ `since` is DOCUMENTATION, not a predicate. Nothing here branches on it:
 * the floor is 3.2 and every row is above it, so the verdict is identical
 * whether a construct arrived in 4.0 or 5.0. It is carried because a failure
 * message that says "bash 4.2" tells the reader why their green local run
 * proves nothing, and a bare "not portable" does not. The tier-1 six carry the
 * versions this repo already recorded beside its own repairs; the rest carry
 * the bash reference manual's, which could not be re-verified from the seat
 * that wrote this file (the GNU documentation hosts are egress-blocked there) —
 * so what IS verified, on every run of `--self-test`, is the property that
 * actually decides findings: that each `pattern` matches a real, parseable
 * instance of the construct it claims to describe, and matches nothing in the
 * exempt forms beside it.
 *
 * The four rows added by the 4.0 operator sweep (`pipe-both`,
 * `case-fallthrough-next`, `brace-increment`, `bashpid`) are the exception:
 * their versions were read off the bash NEWS text itself, which was reachable
 * from the seat that added them. `|&` is "a synonym for `2>&1 |`", `;&` and
 * `;;&` are the two new case terminators, and `$BASHPID` is "a new variable" —
 * all four entries under bash 4.0.
 *
 * `kind` selects the exemption rule, and is the whole of E2/E3:
 *
 *   `builtin`   only executes in command position (E3)
 *   `variable`  only read through a sigil, and a guarded read is correct (E2)
 *   `syntax`    an operator or expansion — position-independent, flagged
 *               anywhere outside a full-line comment
 */
export const CONSTRUCTS = [
  {
    id: 'mapfile',
    since: '4.0',
    kind: 'builtin',
    spelling: 'mapfile / readarray',
    token: String.raw`(?:mapfile|readarray)(?=[ \t]|$)`,
    breaks: 'status 127, `mapfile: command not found` — and under `set -e` that is the whole run',
    fix: 'a `while IFS= read -r line` loop',
    probe: 'mapfile -t arr < /dev/null',
    exemptProbe: "st_case 'runs with mapfile disabled' 0",
  },
  {
    id: 'assoc-array',
    since: '4.0',
    kind: 'builtin',
    spelling: 'declare -A / local -A / typeset -A / readonly -A',
    token: String.raw`(?:declare|local|typeset|readonly)[ \t]+-[A-Za-z]*A(?=[ \t=]|$)`,
    breaks: '`declare: -A: invalid option` — the array is never created and every later read is empty',
    fix: 'two parallel indexed arrays, or a `case` dispatch',
    probe: 'declare -A m',
    exemptProbe: 'declare -a m',
  },
  {
    id: 'nameref-global',
    since: '4.2 (-g) / 4.3 (-n)',
    kind: 'builtin',
    spelling: 'declare -n / declare -g',
    token: String.raw`(?:declare|local|typeset)[ \t]+-[A-Za-z]*[ng](?=[ \t=]|$)`,
    breaks: '`declare: -n: invalid option`; the intended indirection silently does not happen',
    fix: 'eval-free indirection via `${!name}`, which is 3.2',
    probe: 'declare -n ref=other',
    exemptProbe: 'declare -r ref=other',
  },
  {
    id: 'coproc',
    since: '4.0',
    kind: 'builtin',
    spelling: 'coproc',
    token: String.raw`coproc(?=[ \t]|$)`,
    breaks: 'not a reserved word on 3.2, so it is looked up as a command: status 127',
    fix: 'an explicit FIFO, or a background job with named pipes',
    probe: 'coproc CO { cat; }',
    exemptProbe: 'echo "coproc is bash 4"',
  },
  {
    id: 'wait-n',
    since: '4.3',
    kind: 'builtin',
    spelling: 'wait -n',
    token: String.raw`wait[ \t]+-[A-Za-z]*n(?=[ \t]|$)`,
    breaks: '`wait: -n: invalid option`, and the wait it was meant to perform does not happen',
    fix: 'wait on explicit PIDs',
    probe: 'wait -n',
    exemptProbe: 'wait "$pid"',
  },
  {
    id: 'shopt-4',
    since: '4.0 (globstar) / 4.2 (lastpipe)',
    kind: 'builtin',
    spelling: 'shopt -s globstar / lastpipe',
    token: String.raw`shopt[ \t]+[^\n]*?(?:globstar|lastpipe)\b`,
    breaks:
      '`shopt: globstar: invalid shell option name` — and if `set -e` does not catch it, `**` '
      + 'silently degrades to a single-level `*`, which is the quiet direction',
    fix: '`find` with `-name`, or an explicit recursive walk',
    probe: 'shopt -s globstar',
    exemptProbe: 'shopt -s nullglob',
  },
  {
    id: 'fd-autoalloc',
    since: '4.1',
    kind: 'builtin',
    spelling: 'exec {fd}> — file-descriptor auto-allocation',
    token: String.raw`exec[ \t]+\{[A-Za-z_]`,
    breaks: 'parsed as the literal filename `{fd}`, so the redirection lands somewhere it should not',
    fix: 'a fixed descriptor number, chosen explicitly',
    probe: 'exec {lfd}>/dev/null',
    exemptProbe: 'exec 9>/dev/null',
  },
  {
    id: 'case-modify',
    since: '4.0',
    kind: 'syntax',
    spelling: '${x^^} / ${x,,} case-modifying expansion',
    token: String.raw`\$\{[!#]?[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?[\^,]`,
    breaks: '`bad substitution` — a parse error, so the script does not start',
    fix: '`tr "[:lower:]" "[:upper:]"`',
    probe: 'echo "${name^^}"',
    exemptProbe: 'echo "${name//,/ }"',
  },
  {
    id: 'param-transform',
    since: '4.4',
    kind: 'syntax',
    spelling: '${x@Q} and the other @-transformations',
    token: String.raw`\$\{[!#]?[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?@[A-Za-z]\}`,
    breaks: '`bad substitution` — a parse error, so the script does not start',
    fix: '`printf %q`',
    probe: 'echo "${name@Q}"',
    exemptProbe: 'printf "%q" "$name"',
  },
  {
    id: 'negative-subscript',
    since: '4.2',
    kind: 'syntax',
    spelling: '${arr[-1]} negative array subscript',
    token: String.raw`\$\{[!#]?[A-Za-z_][A-Za-z0-9_]*\[[ \t]*-`,
    breaks: '`bad array subscript` — and the expansion yields nothing',
    fix: '${arr[${#arr[@]}-1]}',
    probe: 'echo "${arr[-1]}"',
    exemptProbe: 'echo "${arr[0]}"',
  },
  {
    id: 'case-fallthrough',
    since: '4.0',
    kind: 'syntax',
    spelling: ';;& case terminator',
    token: String.raw`;;&`,
    breaks: 'a syntax error at parse time, so the script does not start',
    fix: 'repeat the body, or restructure as `if`',
    probe: 'case x in x) echo a ;;& *) echo b ;; esac',
    exemptProbe: 'case x in x) echo a ;; esac',
  },
  //
  // ⚠️ The two `case` terminators bash 4.0 added are a PAIR, and the row above
  // owns only one of them. Bash's own names, from the 4.0 NEWS: `;&` "causes
  // execution to continue with the action associated with the next pattern",
  // `;;&` "causes the shell to test the next set of patterns". So the id
  // `case-fallthrough` above sits on `;;&` for historical reasons — the row
  // below is the actual fall-through. The ids are not renamed here: an id is
  // what a finding is reported under, and this card's job is closing an
  // ABSENCE, not renaming what is present.
  //
  // The lookbehind is load-bearing and not cosmetic: `;;&` CONTAINS `;&`, so a
  // bare `;&` token double-flags every `;;&` line, and half of each pair of
  // findings then names the wrong construct and the wrong repair. Both
  // directions of the disjointness are pinned in `--self-test`, because a
  // one-sided pin passes with the lookbehind deleted.
  {
    id: 'case-fallthrough-next',
    since: '4.0',
    kind: 'syntax',
    spelling: ';& case terminator — fall through to the next action, untested',
    token: String.raw`(?<!;);&`,
    breaks: 'a syntax error at parse time, so the script does not start',
    fix: 'repeat the body, or restructure as `if`',
    probe: 'case x in x) echo a ;& *) echo b ;; esac',
    exemptProbe: 'case x in x) echo a; echo b ;; esac',
  },
  {
    id: 'has-v',
    since: '4.2',
    kind: 'syntax',
    spelling: '[[ -v name ]]',
    token: String.raw`\[\[[ \t]+-v[ \t]`,
    breaks: '`-v: unary operator expected`, and the test evaluates FALSE — the quiet direction',
    fix: '[[ -n "${name+set}" ]]',
    probe: '[[ -v name ]] && echo yes',
    exemptProbe: '[[ -n "${name+set}" ]] && echo yes',
  },
  {
    id: 'printf-time',
    since: '4.2',
    kind: 'syntax',
    spelling: "printf '%(fmt)T'",
    token: String.raw`%\([^)\n]*\)T`,
    breaks: '`invalid format character` — the timestamp is never produced',
    fix: '`date +FORMAT`',
    probe: 'printf "%(%F)T\\n" -1',
    exemptProbe: 'date +%F',
  },
  {
    id: 'append-both',
    since: '4.0',
    kind: 'syntax',
    spelling: '&>> append-both redirection',
    token: String.raw`&>>`,
    breaks: 'parsed as `&` then `>>`, so the command is BACKGROUNDED and only stdout is appended',
    fix: '>> file 2>&1',
    probe: 'echo hi &>> /dev/null',
    exemptProbe: 'echo hi >> /dev/null 2>&1',
  },
  //
  // `|&` is the row above's twin: same bash release, same table, and until this
  // sweep only one of the two was known here — which is the whole shape of a
  // denylist defect, because an absence from a denylist reads as an approval.
  // The two differ in the DIRECTION of the 3.2 failure, and the messages say
  // so: `&>>` is parsed as `&` then `>>` and quietly BACKGROUNDS the command,
  // while `|&` does not parse at all.
  {
    id: 'pipe-both',
    since: '4.0',
    kind: 'syntax',
    spelling: '|& pipe-both operator',
    token: String.raw`\|&`,
    breaks:
      'a syntax error at parse time ("syntax error near unexpected token &") — the script does '
      + 'not start, so not one line of it runs',
    fix: '2>&1 | — which is what bash 4.0 documents `|&` as a synonym for',
    probe: 'echo a |& cat',
    exemptProbe: 'echo a 2>&1 | cat',
  },
  //
  // The sweep's one QUIET row. `{x..y}` is old enough for the floor; the
  // optional `..incr` third field is 4.0, and a bash that cannot parse a
  // sequence expression does not complain — it leaves the whole brace word
  // LITERAL (measured on this host with a deliberately unparseable increment:
  // `{1..10..x}` prints back as its own ten characters). So the 3.2 symptom is
  // a loop that runs exactly ONCE, over a nonsense value, at exit 0.
  //
  // The pattern is deliberately tighter than the other `syntax` rows: a
  // sequence expression's fields are alphanumeric runs and an integer step, so
  // requiring that shape keeps ordinary brace LISTS of relative paths —
  // `cp {../a,../b} .`, which carries two `..` runs inside one pair of braces —
  // out of the findings. Pinned both ways below.
  {
    id: 'brace-increment',
    since: '4.0',
    kind: 'syntax',
    spelling: '{x..y..incr} brace-expansion increment',
    token: String.raw`\{[A-Za-z0-9]+\.\.[A-Za-z0-9]+\.\.[-+]?[0-9]+\}`,
    breaks:
      'NOT an error — the brace word is left literal, so the loop runs ONCE over the string '
      + '`{1..10..2}` itself and the run exits 0. The quiet direction, and the reason this row exists',
    fix: '`seq FIRST INCR LAST` in a `for` loop, or an explicit counter',
    probe: 'for i in {1..10..2}; do echo "$i"; done',
    exemptProbe: 'for i in {1..10}; do echo "$i"; done',
  },
  {
    id: 'bashpid',
    since: '4.0',
    kind: 'variable',
    spelling: 'BASHPID',
    token: String.raw`\$\{?BASHPID(?:[^A-Za-z0-9_]|$)`,
    breaks:
      'unbound. Under `set -u` that is fatal; without it the read yields EMPTY, so a pid-derived '
      + 'lock name or tempdir collapses to a shared constant and stops separating processes',
    fix: '`$$` read through a `${...:-}` guard — noting `$$` is the PARENT shell\'s pid inside a '
      + 'subshell, which is the difference BASHPID exists for',
    probe: 'lock="/tmp/l.$BASHPID"',
    exemptProbe: 'lock="/tmp/l.${BASHPID:-$$}"',
  },
  {
    id: 'epoch-vars',
    since: '5.0',
    kind: 'variable',
    spelling: 'EPOCHSECONDS / EPOCHREALTIME',
    token: String.raw`\$\{?(?:EPOCHSECONDS|EPOCHREALTIME)(?:[^A-Za-z0-9_]|$)`,
    breaks:
      'unbound. Under `set -u` that is fatal; without it the read yields EMPTY, which is how a '
      + 'bounded wait becomes an unbounded spin — a hang, not a crash',
    fix: '`date +%s`, read through a `${...:-}` guard',
    probe: 'now=$EPOCHSECONDS',
    exemptProbe: 'now="${EPOCHSECONDS:-}"',
  },
];

/**
 * Is this occurrence of a `variable` construct a guarded read?
 *
 * `${NAME:-...}` and its siblings supply a value when the name is unbound, so
 * the line behaves identically on 3.2 and on 5 — it is the REPAIR, not a
 * tolerated mention. A bare word with no sigil is not a read at all.
 */
function guardedRead(matchText) {
  if (!matchText.startsWith('${')) return false;
  const tail = matchText.slice(matchText.length - 1);
  return ':-+=?'.includes(tail);
}

/** The compiled matcher for one construct, honouring its `kind`. */
function matcherFor(construct) {
  const prefix = construct.kind === 'builtin' ? CMD_POS : '';
  return new RegExp(prefix + construct.token, 'g');
}

/**
 * Every finding in one shell file's text.
 *
 * @param {string} relPath
 * @param {string} text
 */
export function scanText(relPath, text) {
  const findings = [];
  const lines = text.split('\n');
  for (const construct of CONSTRUCTS) {
    const re = matcherFor(construct);
    lines.forEach((line, i) => {
      // E1: a full-line comment is prose. Doctrine files must NAME what they
      // refuse; a trailing comment is not exempt, because the code half runs.
      if (/^[ \t]*#/.test(line)) return;
      re.lastIndex = 0;
      for (let m = re.exec(line); m !== null; m = re.exec(line)) {
        // E2: only a sigil is a read, and a guarded read is the fix.
        if (construct.kind === 'variable' && guardedRead(m[0])) continue;
        findings.push({
          file: relPath,
          line: i + 1,
          id: construct.id,
          since: construct.since,
          spelling: construct.spelling,
          breaks: construct.breaks,
          fix: construct.fix,
          text: line.trim(),
        });
        break; // one finding per construct per line; the line is what gets fixed
      }
    });
  }
  return findings.sort((a, b) => a.line - b.line || a.id.localeCompare(b.id));
}

/** Is this tracked file shell? By name, or — the half a `*.sh` glob misses — by shebang. */
export function isShell(relPath, text) {
  if (relPath.endsWith('.sh')) return { shell: true, by: 'extension' };
  if (SHELL_SHEBANG.test(text.split('\n', 1)[0] ?? '')) return { shell: true, by: 'shebang' };
  return { shell: false, by: null };
}

/**
 * The population, read from the git index under the derived walk roots.
 *
 * @param {string} root
 */
export function listPopulation(root) {
  const out = spawnSync('git', ['-C', root, 'ls-files', '-z', '--', ...WALK_ROOTS], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (out.status !== 0) {
    throw new Error(`git ls-files failed under ${root}: ${(out.stderr || '').trim()}`);
  }
  const population = [];
  let byExtension = 0;
  let byShebang = 0;
  for (const rel of out.stdout.split('\0').filter(Boolean)) {
    let text;
    try {
      text = readFileSync(join(root, rel), 'utf8');
    } catch {
      continue; // a deleted-but-indexed path is not a script to judge
    }
    const verdict = isShell(rel, text);
    if (!verdict.shell) continue;
    if (verdict.by === 'extension') byExtension += 1;
    else byShebang += 1;
    population.push({ rel, text, by: verdict.by });
  }
  return { population, byExtension, byShebang };
}

/** Scan a whole tree. Returns findings plus the census the green line prints. */
export function scanTree(root) {
  const { population, byExtension, byShebang } = listPopulation(root);
  const findings = [];
  for (const { rel, text } of population) findings.push(...scanText(rel, text));
  return { findings, population, byExtension, byShebang };
}

function report(findings) {
  console.error(`✗ check-bash32-floor: ${findings.length} bash-4+ construct(s) in shell this repo ships.\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}`);
    console.error(`      ${f.text}`);
    console.error(`      ${f.spelling} — bash ${f.since}; the floor is 3.2 (macOS ships 3.2.57).`);
    console.error(`      On 3.2: ${f.breaks}`);
    console.error(`      Use instead: ${f.fix}\n`);
  }
  console.error(
    'Your local run and CI both pass because both run bash 5. That is the point of this gate.\n'
    + 'If the line is a MENTION rather than a use, it needs no waiver — move it into a full-line\n'
    + 'comment, read the variable through a `${NAME:-}` guard, or keep the token out of command\n'
    + 'position. ⛔ There is no filename allowlist, deliberately: that is how this class survived.',
  );
}

// ---------------------------------------------------------------------------

/**
 * A throwaway git repo holding one `scripts/` tree, so the end-to-end legs
 * exercise the REAL discovery path (the git index) and not a stub.
 */
function fixtureRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'bash32-floor-'));
  spawnSync('git', ['-C', dir, 'init', '-q'], { encoding: 'utf8' });
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });
  return dir;
}

function selfTest() {
  const SELF = fileURLToPath(import.meta.url);
  let failed = 0;
  let cases = 0;
  const t = (label, ok, detail = '') => {
    cases += 1;
    if (ok) {
      console.log(`  ✓ ${label}`);
      return;
    }
    failed += 1;
    console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
  };
  const ids = (text) => scanText('f.sh', text).map((f) => f.id);

  console.log('check-bash32-floor --self-test\n');

  // --- the table itself ----------------------------------------------------
  t('every construct has a unique id', new Set(CONSTRUCTS.map((c) => c.id)).size === CONSTRUCTS.length);
  t(
    'every construct declares kind, version, breakage and a fix',
    CONSTRUCTS.every(
      (c) =>
        ['builtin', 'variable', 'syntax'].includes(c.kind) &&
        /^\d/.test(c.since) &&
        c.breaks.length > 20 &&
        c.fix.length > 3,
    ),
  );

  // --- ⭐ the pattern is not vacuous, and it is not greedy ------------------
  //
  // A scanner's silent failure is a pattern that matches NOTHING real: the
  // production run stays green forever and reads exactly like a clean tree.
  // So every row is driven in both directions against a real instance of the
  // construct it claims to describe, and against the 3.2 spelling that replaces
  // it — which must stay green, or the gate would refuse its own remedy.
  for (const c of CONSTRUCTS) {
    t(`${c.id}: the pattern matches a real \`${c.probe}\``, ids(c.probe).includes(c.id), `got ${JSON.stringify(ids(c.probe))}`);
    t(
      `${c.id}: and does NOT match its 3.2 replacement \`${c.exemptProbe}\``,
      !ids(c.exemptProbe).includes(c.id),
      `got ${JSON.stringify(ids(c.exemptProbe))}`,
    );
  }

  // --- ⭐ and the probes are real shell, not plausible-looking text ---------
  //
  // `bash -n` parses without executing. A probe that does not parse would prove
  // only that the regex matches a typo.
  for (const c of CONSTRUCTS) {
    const parse = spawnSync('bash', ['-n'], { input: `${c.probe}\n`, encoding: 'utf8' });
    t(`${c.id}: the probe is shell this host can parse`, parse.status === 0, (parse.stderr || '').trim());
  }

  // --- E1: full-line comments are prose, trailing comments are not ---------
  t('E1 a full-line comment naming a construct is exempt', ids('   # no mapfile here, ever').length === 0);
  t('E1 a comment naming EPOCHSECONDS is exempt', ids('# EPOCHSECONDS is bash 5').length === 0);
  t(
    'E1 a TRAILING comment does not exempt the code beside it',
    ids('mapfile -t x < f   # sorry').includes('mapfile'),
  );

  // --- E2: variables are read through a sigil, and a guarded read is the fix
  t('E2 `$EPOCHSECONDS` is an unguarded read → RED', ids('now=$EPOCHSECONDS').includes('epoch-vars'));
  t('E2 `${EPOCHSECONDS}` is an unguarded read → RED', ids('now=${EPOCHSECONDS}').includes('epoch-vars'));
  t('E2 `${EPOCHSECONDS:-}` is the repair → green', !ids('now="${EPOCHSECONDS:-}"').includes('epoch-vars'));
  t('E2 `${EPOCHREALTIME:-}` likewise → green', !ids('raw="${EPOCHREALTIME:-}"').includes('epoch-vars'));
  t('E2 `${EPOCHSECONDS-x}` (no colon) is guarded too → green', !ids('now=${EPOCHSECONDS-0}').includes('epoch-vars'));
  t('E2 `${EPOCHSECONDS:?}` is guarded → green', !ids('now=${EPOCHSECONDS:?}').includes('epoch-vars'));
  t(
    'E2 a bare word is not a read: `unset EPOCHSECONDS EPOCHREALTIME` → green',
    !ids('unset EPOCHSECONDS EPOCHREALTIME').includes('epoch-vars'),
  );
  t(
    'E2 a bare word inside a message is not a read → green',
    !ids("st_case 'runs with EPOCHSECONDS/EPOCHREALTIME unset' 0").includes('epoch-vars'),
  );

  // --- E3: a builtin only executes in command position ----------------------
  t('E3 at the start of a line → RED', ids('  mapfile -t x < f').includes('mapfile'));
  t('E3 after a pipe → RED', ids('printf a | readarray -t x').includes('mapfile'));
  t('E3 after `&&` → RED', ids('cd "$d" && mapfile -t x < f').includes('mapfile'));
  t('E3 after `if` → RED', ids('if mapfile -t x < f; then :; fi').includes('mapfile'));
  t('E3 inside `$( )` → RED', ids('n=$(mapfile -t x < f)').includes('mapfile'));
  t('E3 after a VAR=value prefix → RED', ids('IFS=, mapfile -t x < f').includes('mapfile'));
  t('E3 `declare -A` at the start of a line → RED', ids('declare -A seen').includes('assoc-array'));
  t('E3 `local -A` after `then` → RED', ids('then local -A seen').includes('assoc-array'));
  t(
    'E3 `enable -n mapfile readarray` REMOVES the builtin, it does not call it → green',
    !ids('  enable -n mapfile readarray 2> /dev/null').includes('mapfile'),
  );
  t(
    'E3 a token inside a quoted argument invokes nothing → green',
    !ids("  st_case 'acquires with mapfile disabled' \"$rc\" 0").includes('mapfile'),
  );
  t(
    'E3 the whole hunting line from a self-test scanner → green',
    scanText('f.sh', `pat="\${pat}"'|(mapfile|readarray)[[:space:]]'`).length === 0,
  );

  // --- the near-neighbours that are NOT bash 4, so must never redden --------
  t('3.2-legal `&>` (non-append) is not flagged', ids('echo hi &> /dev/null').length === 0);
  t('3.2-legal `declare -a` / `-r` / `-i` are not flagged', ids('declare -ari x=1').length === 0);
  t('3.2-legal `${x//,/ }` is not flagged', ids('echo "${x//,/ }"').length === 0);
  t('3.2-legal `${x:0:1}` is not flagged', ids('echo "${x:0:1}"').length === 0);
  t('3.2-legal `${#arr[@]}` is not flagged', ids('echo "${#arr[@]}"').length === 0);
  t('3.2-legal `;;` is not flagged', ids('case x in x) echo a ;; esac').length === 0);
  t('3.2-legal `read -n 1` is not flagged', ids('read -n 1 ch').length === 0);
  t('3.2-legal `exec 9>` is not flagged', ids('exec 9>"$lock"').length === 0);

  // --- ⭐ a COVERAGE FLOOR: deleting a row must redden this self-test -------
  //
  // Every leg above that iterates `CONSTRUCTS` is parameterised BY the table,
  // so deleting a row deletes its own tests and the suite stays green with the
  // coverage gone — which is the exact species this gate exists to refuse, one
  // level up, in the instrument instead of the tree. These cases are not
  // parameterised: they name real lines and require that SOMETHING still
  // refuses each one. Written against behaviour rather than ids, so renaming a
  // row is free and removing its coverage is loud. `&>>` is in the list as the
  // control — it is the row whose presence made the `|&` absence legible.
  for (const [label, line] of [
    ['&>> (append-both)', 'exec "$@" &>> "$logfile"'],
    ['|& (pipe-both)', 'make build |& tee build.log'],
    [';& (case fall-through)', 'case "$1" in -v) verbose=1 ;& *) run ;; esac'],
    ['{x..y..incr} (brace increment)', 'for i in {0..100..10}; do echo "$i%"; done'],
    ['$BASHPID', 'tmp="$TMPDIR/work.$BASHPID"'],
  ]) {
    t(`the table still refuses ${label}`, scanText('f.sh', line).length > 0, line);
  }

  // --- ⭐ the two `case` terminators stay DISJOINT --------------------------
  //
  // `;;&` CONTAINS `;&`. Without the `;&` row's lookbehind every `;;&` line
  // yields two findings, one of them naming the wrong construct and the wrong
  // repair. Pinned in BOTH directions: a one-sided pin passes with the
  // lookbehind deleted, because `;&` matching `;;&` is invisible from the
  // `;&`-only side.
  t(
    '`;;&` is the case-fallthrough row ALONE',
    ids('case x in x) echo a ;;& *) echo b ;; esac').join() === 'case-fallthrough',
    `got ${JSON.stringify(ids('case x in x) echo a ;;& *) echo b ;; esac'))}`,
  );
  t(
    '`;&` is the case-fallthrough-next row ALONE',
    ids('case x in x) echo a ;& *) echo b ;; esac').join() === 'case-fallthrough-next',
    `got ${JSON.stringify(ids('case x in x) echo a ;& *) echo b ;; esac'))}`,
  );

  // --- ⭐ the 3.2 replacements the new rows point at must stay GREEN --------
  //
  // The load-bearing half. A `|&` pattern that also matched `2>&1 |` would red
  // every correct pipeline in the repo — the gate refusing its own remedy — and
  // the failure text tells operators to write exactly that.
  t('`2>&1 |`, the replacement `|&` is a synonym FOR, is not flagged', ids('echo a 2>&1 | cat').length === 0);
  t('an ordinary pipe is not flagged', ids('grep -c . f | wc -l').length === 0);
  t('an ordinary background `&` is not flagged', ids('long_job &').length === 0);
  t('3.2-legal `{1..10}` (no increment) is not flagged', ids('echo {1..10}').length === 0);
  t('3.2-legal `{a..z}` is not flagged', ids('echo {a..z}').length === 0);
  t(
    'a brace LIST of relative paths is not a sequence expression',
    ids('cp {../a,../b} .').length === 0,
    'two `..` runs inside one brace pair, and no increment',
  );
  t('a `for` over an explicit list is not flagged', ids('for i in 0 10 20; do echo "$i"; done').length === 0);

  // --- E2 again, for the row the sweep added --------------------------------
  t('E2 `$BASHPID` is an unguarded read → RED', ids('p=$BASHPID').includes('bashpid'));
  t('E2 `${BASHPID}` is an unguarded read → RED', ids('p=${BASHPID}').includes('bashpid'));
  t('E2 `${BASHPID:-$$}` is the repair → green', !ids('p="${BASHPID:-$$}"').includes('bashpid'));
  t('E2 a bare word is not a read: `unset BASHPID` → green', !ids('unset BASHPID').includes('bashpid'));
  t('E2 `$BASHPIDX` is a different name → green', !ids('p=$BASHPIDX').includes('bashpid'));
  t('and `$$` — the 3.2 spelling — is not flagged', ids('p=$$').length === 0);

  // --- population membership -----------------------------------------------
  t('a .sh name is shell', isShell('scripts/x.sh', 'echo hi').by === 'extension');
  t(
    'a shebang-only script is shell — the half a *.sh glob misses',
    isShell('.githooks/pre-push', '#!/bin/sh\necho hi').by === 'shebang',
  );
  t('`#!/usr/bin/env bash` counts', isShell('.githooks/pre-commit', '#!/usr/bin/env bash\n').by === 'shebang');
  t('a node script is not shell', isShell('scripts/x.mjs', '#!/usr/bin/env node\n').shell === false);
  t('a plain text file is not shell', isShell('scripts/README.md', '# hi\n').shell === false);

  // --- ⭐ the declaration, and the two obligations it makes unreachable -----
  //
  // Spelled as subtree GLOBS so the derivation can read them (a bare
  // single-segment word builds no hint at all and lands unnameable), and
  // spelled as SOURCE LITERALS so the extractor can see them at all — an
  // assembled root is invisible to it, which is the same blind spot wearing a
  // template string.
  const ownSource = readFileSync(SELF, 'utf8');
  t('every declared root is a subtree glob', POPULATION_ROOTS.every((r) => r.endsWith('/**')));
  t('every declared root carries a separator, so none is a bare root', POPULATION_ROOTS.every((r) => r.includes('/')));
  t(
    'every declared root is a SOURCE LITERAL, not assembled at runtime',
    POPULATION_ROOTS.every((r) => ownSource.includes(`'${r}'`)),
    'an assembled root builds no watch hint',
  );
  t(
    'the walk roots are DERIVED from the declaration, never re-spelled',
    WALK_ROOTS.length === POPULATION_ROOTS.length &&
      WALK_ROOTS.every((w, i) => POPULATION_ROOTS[i] === `${w}/**`),
  );
  t(
    'and no walk root appears anywhere in this file as a BARE literal',
    WALK_ROOTS.every((w) => !ownSource.includes(`'${w}'`) && !ownSource.includes(`"${w}"`)),
    'a bare single-segment root is the species this declaration exists to avoid',
  );

  // --- ⭐ end to end, through the real discovery path -----------------------
  const bad = {};
  for (const c of CONSTRUCTS) bad[`scripts/bad-${c.id}.sh`] = `#!/usr/bin/env bash\n${c.probe}\n`;
  const badRepo = fixtureRepo(bad);
  const badRun = spawnSync(process.execPath, [SELF, '--root', badRepo], { encoding: 'utf8' });
  const badOut = `${badRun.stdout}${badRun.stderr}`;
  t('a known-bad tree makes this gate EXIT 1 — it can be SHOWN to fail', badRun.status === 1, badOut.slice(0, 400));
  const unnamed = CONSTRUCTS.filter((c) => !badOut.includes(`bad-${c.id}.sh`));
  t(
    'and the failure names every construct in the table, by file and line',
    unnamed.length === 0,
    `unnamed: ${unnamed.map((c) => c.id).join(', ')}`,
  );

  const cleanRepo = fixtureRepo({
    'scripts/ok.sh': '#!/usr/bin/env bash\n# no mapfile, no declare -A\nwhile IFS= read -r l; do :; done < f\n',
    '.githooks/pre-push': '#!/bin/sh\nnow="${EPOCHSECONDS:-$(date +%s)}"\n',
  });
  const cleanRun = spawnSync(process.execPath, [SELF, '--root', cleanRepo], { encoding: 'utf8' });
  t(
    'a 3.2-clean tree is GREEN, guarded reads and all',
    cleanRun.status === 0,
    `${cleanRun.stdout}${cleanRun.stderr}`.slice(0, 400),
  );
  t(
    'and its green line reports the shebang half of the census separately',
    /shebang/.test(cleanRun.stdout),
    cleanRun.stdout,
  );

  // #4690: "nothing to check" and "the walk found nothing" are different answers.
  const emptyRepo = fixtureRepo({ 'scripts/notes.md': '# nothing executable here\n' });
  const emptyRun = spawnSync(process.execPath, [SELF, '--root', emptyRepo], { encoding: 'utf8' });
  t(
    'an EMPTY population is a refusal, not a quiet pass (#4690)',
    emptyRun.status === 1 && /no shell/i.test(`${emptyRun.stdout}${emptyRun.stderr}`),
    `${emptyRun.stdout}${emptyRun.stderr}`.slice(0, 300),
  );

  // --- ⭐ the instrument is real: the flagged construct really does break ---
  //
  // R7a's shape, and for R7a's reason: without this the leg below could pass by
  // proving nothing. `BASH_ENV` is sourced by every non-interactive bash, so the
  // child inherits the disabling — measured BOTH ways on a probe first.
  const simDir = mkdtempSync(join(tmpdir(), 'bash32-sim-'));
  const noBash4 = join(simDir, 'no-bash4-builtins.sh');
  writeFileSync(noBash4, 'enable -n mapfile readarray 2> /dev/null\n');
  const probe = join(simDir, 'probe.sh');
  writeFileSync(probe, 'mapfile -t x < /dev/null && echo MAPFILE-WORKS\n');
  const plain = spawnSync('bash', [probe], { encoding: 'utf8' });
  const sim = spawnSync('bash', [probe], { encoding: 'utf8', env: { ...process.env, BASH_ENV: noBash4 } });
  t(
    'the simulated-3.2 harness really removes the builtin (else the next leg proves nothing)',
    plain.stdout.includes('MAPFILE-WORKS') && !sim.stdout.includes('MAPFILE-WORKS') && /mapfile/.test(sim.stderr),
    `plain=${plain.stdout.trim()} sim.out=${sim.stdout.trim()} sim.err=${sim.stderr.trim()}`,
  );
  t(
    'and a script this gate flags really does die at 127 under it',
    sim.status === 127,
    `status=${sim.status} err=${sim.stderr.trim()}`,
  );
  //
  // ⚠️ The variable is SOURCED into the shell that unset it, never handed to a
  // fresh `bash`: `unset` strips the dynamic attribute in THIS shell only, and a
  // child re-creates it on startup. Read from a child, this leg passes by
  // measuring bash 5 twice.
  const epochProbe = join(simDir, 'epoch.sh');
  writeFileSync(epochProbe, 'now=$EPOCHSECONDS\necho "got=$now"\n');
  const unsetThenSource = 'unset EPOCHSECONDS EPOCHREALTIME; set -u; . "$0"';
  const epochSim = spawnSync('bash', ['-c', unsetThenSource, epochProbe], { encoding: 'utf8' });
  t(
    'and an unguarded EPOCHSECONDS read really is fatal once the variable is gone',
    epochSim.status !== 0 && /unbound|EPOCHSECONDS/.test(epochSim.stderr),
    `status=${epochSim.status} err=${epochSim.stderr.trim()}`,
  );
  const guardedProbe = join(simDir, 'epoch-guarded.sh');
  writeFileSync(guardedProbe, 'now="${EPOCHSECONDS:-$(date +%s)}"\ntest -n "$now" && echo GUARDED-OK\n');
  const guardedSim = spawnSync('bash', ['-c', unsetThenSource, guardedProbe], { encoding: 'utf8' });
  t(
    'while the guarded read this gate calls exempt survives the same shell',
    guardedSim.status === 0 && guardedSim.stdout.includes('GUARDED-OK'),
    `status=${guardedSim.status} out=${guardedSim.stdout.trim()} err=${guardedSim.stderr.trim()}`,
  );

  for (const d of [badRepo, cleanRepo, emptyRepo, simDir]) rmSync(d, { recursive: true, force: true });

  // --- the real tree -------------------------------------------------------
  const live = scanTree(REPO_ROOT);
  t(
    'real-tree discovery finds shell to scan (a gate over nothing is not green)',
    live.population.length > 0,
    `${live.population.length} file(s)`,
  );
  t(
    'and the shebang half of the census is non-empty, so it is not decoration',
    live.byShebang > 0,
    `${live.byShebang} shebang-only file(s)`,
  );
  console.log(
    `\n  · real tree: ${live.population.length} shell file(s) — ${live.byExtension} by extension, `
    + `${live.byShebang} by shebang alone — ${live.findings.length} finding(s)`,
  );

  if (failed > 0) {
    console.error(`\n✗ check-bash32-floor self-test failed (${failed} of ${cases} case(s)).`);
    process.exit(1);
  }
  console.log(`\n✓ check-bash32-floor self-test: ${cases} cases pass.`);
}

// ---------------------------------------------------------------------------

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const rootFlag = process.argv.indexOf('--root');
  const root = rootFlag === -1 ? REPO_ROOT : process.argv[rootFlag + 1];

  const { findings, population, byExtension, byShebang } = scanTree(root);

  if (population.length === 0) {
    console.error(
      `✗ check-bash32-floor: found no shell files under ${POPULATION_ROOTS.join(', ')}.\n`
      + '  "nothing to check" and "the walk found nothing" are different answers, and this gate\n'
      + '  refuses to report the second as the first (#4690).',
    );
    process.exit(1);
  }

  if (findings.length > 0) {
    report(findings);
    process.exit(1);
  }

  console.log(
    `✓ check-bash32-floor: ${population.length} tracked shell file(s) under `
    + `${POPULATION_ROOTS.join(', ')} name no bash 4+ construct outside a comment, a guarded `
    + `\${VAR:-} read, or a non-command position.\n`
    + `  census: ${byExtension} by .sh extension, ${byShebang} by shebang alone; `
    + `${CONSTRUCTS.length} constructs checked, floor bash 3.2.`,
  );
}

if (isEntrypoint(import.meta.url)) {
  main();
}
