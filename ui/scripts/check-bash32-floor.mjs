#!/usr/bin/env node
// copied from objectstack@61362932b5ad4c85b39169e70cf9be64d4332ce5
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The bash-3.2 floor, repo-wide (objectui#7692).
 *
 * ⚠️ PORTED from objectstack-ai/objectstack `scripts/check-bash32-floor.mjs` at
 * commit `6136293`, which is where the class, the construct table and the
 * exemption rules were worked out. This header states which claims are
 * upstream's and which were re-measured HERE; ⛔ do not read an inherited
 * measurement as a reading about this tree. The `copied from objectstack@`
 * line above names the commit this copy was last synced at; the section "## No
 * drift gate over this copy" below says what follows from it.
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
 * Both incidents are UPSTREAM's, and they are what established the class. A
 * sweep found and fixed all four sites there. Nothing stopped a fifth being
 * typed, in either repository.
 *
 * ## The coverage this repository had before this gate: none
 *
 * Measured on `origin/main` `28cfff4`, with a live control beside each zero —
 * a zero taken with no control is not a reading:
 *
 *   - tracked files whose name carries `bash32` / `bash-32` / `bash3`: 0.
 *     Control, same listing: 47 `scripts/check-*.mjs` gates exist. So the
 *     absence is the tree's, not the grep's.
 *   - the two neighbours that look closest are neither, by their own verdicts:
 *       `check-control-bytes` — "scanned 6443 tracked text file(s); skipped 85
 *         binary". It judges BYTES, in every text file, and says nothing about
 *         shell grammar.
 *       `check-shell-escape-residue` — "206 file(s) and 1309 fenced block(s)
 *         examined in total". Its population is markdown FENCES in `AGENTS.md`,
 *         `CLAUDE.md`, `skills`, `.claude/skills` and `content/docs`: prose
 *         about shell, not shell programs.
 *
 * Upstream additionally retains two FILE-SCOPED simulated runs that this
 * repository does not have (`enable -n mapfile readarray` via `BASH_ENV`, plus
 * `unset` of the bash-5 variables). That difference matters for what the
 * "Known limit" section below can promise, and it is stated there rather than
 * left to be discovered.
 *
 * ## What this gate is NOT
 *
 * ⛔ Upstream carries this scan as the THIRD leg beside those two simulated
 * runs, and its header forbids using it to retire them. Here there is no such
 * pair to retire — so the same sentence has to be read forwards instead: a
 * static scan sees parse-level constructs a simulated run cannot reach, and a
 * simulated run reaches constructs assembled at runtime that no static scan can
 * see. This repository now holds the first half only. ⛔ Do not read a green
 * verdict here as the coverage upstream's green verdict carries.
 *
 * ## The exemption rule: telling a HUNTER from a USER
 *
 * The hard part of a repo-wide scan is that the files which document this floor
 * have to NAME the constructs they refuse in order to explain why, and a
 * self-test hunting these tokens has to name them in order to hunt them. A scan
 * that cannot tell a mention from a use reddens itself on day one. Upstream met
 * exactly that: 8 findings there, every one a false positive, all in one file.
 *
 * ⚠️ Re-measured HERE, and the answer is different — recorded because carrying
 * upstream's number across would be inventing a reading. Over the 12 shell
 * files in this population, with E1 (full-line comments) AND E3 (command
 * position) both switched OFF, the 19 patterns match on **0 lines**. So on this
 * tree today the exemptions suppress NOTHING, and none of them is load-bearing
 * yet. They are carried anyway, and that is a decision rather than inertia:
 * the doctrine this repository is acquiring — this file, its wiring comment in
 * `.github/workflows/lint.yml`, and any hook that later refuses one of these
 * tokens — has to name the constructs in order to refuse them, which is the
 * arrangement that produced upstream's 8. An exemption rule invented on the day
 * it is first needed is invented under pressure to make a red gate green.
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
 * hunt these tokens.
 *
 * ⚠️ Upstream can say the hole is "precisely what the retained SIMULATED runs
 * cover" — it keeps two of them. THIS repository has none, so here the hole is
 * simply UNCOVERED, and that is a smaller claim than upstream's identical-
 * looking sentence. Said plainly rather than inherited: after this gate lands,
 * an `eval "mapfile -t x < f"` in this tree is refused by nothing. Closing it
 * is a separate card, not a line to loosen here.
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
 *   New FLAGS on builtins already refused whole (`mapfile -d`, `readarray -C`).
 *   A `builtin` row refuses its builtin at every flag, so these need no row.
 *
 *   Variables added after 4.0 — `BASH_XTRACEFD` (4.1), `BASH_ARGV0` (5.0),
 *   `SRANDOM` (5.1), `PROMPT_DIRTRIM`. Outside the 4.0 line this sweep drew.
 *   They are named here so the next reader inherits the list instead of
 *   rediscovering it, which is the cost this section exists to stop paying.
 *
 * One entry has LEFT this list, and the departure is recorded because a list of
 * absences that quietly shrinks is as misleading as one that never existed.
 * `test -v` / `[ -v ]` was written here as an open hole — the `-v` unary is one
 * construct with THREE spellings and the `has-v` row saw only `[[` — and it is
 * now closed: that row covers all three. The false-positive judgement the
 * closure needed is written at the row itself rather than here, because that is
 * where a future reader tempted to loosen the pattern will be standing.
 *
 * ## No drift gate over this copy
 *
 * This file was registered in a port pin whose parity gate reversed the
 * declared divergences and compared the result with the upstream digest.
 * objectui#10208 retired both on the maintainer's ruling (objectui#10205): this
 * is now a plain copy, its differences from upstream are simply its text, and
 * drift from upstream is found by hand.
 *
 * ## Population
 *
 * Tracked files under `POPULATION_ROOTS` that are shell: a `.sh` name, or a
 * `sh`/`bash`/`dash`/`ksh`/`zsh` shebang whatever the name.
 *
 * ⚠️ The shebang half's STATUS DIFFERS from upstream's, and inheriting
 * upstream's sentence would have been the false half of this port. Upstream
 * measures 2 shebang-only scripts (`.githooks/pre-commit`, `.githooks/pre-push`)
 * and calls the half load-bearing. Measured HERE on `origin/main` `28cfff4`:
 * every one of the 12 shell files in this population carries a `.sh` name, so
 * the shebang census is **0** and the half catches nothing TODAY. It is kept
 * because it is the half that would catch the first extension-less script
 * someone adds — and because dropping it would make a future re-sync with
 * upstream a semantic merge rather than a textual one. Its mechanism is
 * therefore pinned where it can actually be exercised: the end-to-end fixture
 * in `--self-test` plants a shebang-only script under a walked root and
 * requires the census to see it. ⛔ The real-tree leg must NOT assert
 * `byShebang > 0` here; upstream's does, and it would be red on day one.
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
 * The population, declared as SUBTREE GLOBS.
 *
 * ⭐ `e2e/**` IS THE PORT'S ONE SUBSTANTIVE CHANGE, and it is the reason
 * objectui#7692 exists rather than being closed by a copy. Upstream declares
 * `scripts/**`, `.claude/hooks/**`, `.githooks/**`. This repository has no
 * `.githooks/` at all, and TWO of the four shell files it wrote itself —
 * `e2e/live/ci/start-backend.sh` and `e2e/live/ci/stop-backend.sh` — live under
 * `e2e/`. Copying upstream's roots verbatim would have walked past half of the
 * population this card is about while printing a confident green line, which is
 * the failure mode this whole file is built to refuse. ⛔ Do not "restore" the
 * upstream list.
 *
 * ⛔ These must stay SOURCE LITERALS in the glob form. Two independent reasons,
 * one of them upstream's and one of them local:
 *
 *   - upstream's: a root assembled at runtime (`` `${r}/**` ``) builds no watch
 *     hint for its dispatch derivation, and a bare single-segment word is
 *     refused by its literal extractor. Neither tool runs in THIS repository —
 *     said so it is not mistaken for a live local mechanism — but the shape is
 *     kept so a re-sync stays textual.
 *   - local, and load-bearing on its own: the shape is what `--self-test` can
 *     actually check. A declaration it cannot read is a declaration nothing
 *     pins.
 *
 * The walk roots are DERIVED from these globs one line below rather than
 * re-spelled, so the declaration and the scan cannot drift apart: there is no
 * second place to edit.
 */
export const POPULATION_ROOTS = ['scripts/**', '.claude/hooks/**', 'e2e/**'];

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
 * `has-v` is the second exception, and the only row whose version has been read
 * from a primary source in BOTH of bash's own release documents. It is recorded
 * at length because the row was challenged and the challenge was refused on
 * measurement, which is the expensive half to re-derive. #12760 reported the
 * `-v` unary as bash 4.1 and proposed correcting this row's `4.2` down. In the
 * bash maintainer's NEWS the line
 *
 *     f.  test/[/[[ have a new -v variable unary operator, which returns
 *         success if `variable' has been set.
 *
 * occurs exactly ONCE in the whole file, under "the new features added to
 * bash-4.2 since the release of bash-4.1"; CHANGES carries the same line under
 * `bash-4.2-alpha`. The 4.1 reading is the one that section header invites — it
 * names two versions and the second is the wrong one to take. `4.2` stands. The
 * later entries corroborate it rather than competing with it: 4.3 "The
 * test/[/[[ `-v variable' binary operator now understands array" references,
 * and 5.1 "`test -v N' can now test whether or not positional parameter N is
 * set." Both extend an operator that already exists.
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
  //
  // The `-v` unary is ONE construct with THREE spellings: bash 4.2 gave it to
  // `test`, `[` and `[[` together. Until #12760 this row was anchored to the
  // `[[` spelling alone, so two thirds of the construct walked past — the
  // denylist-absence shape again, one level down, INSIDE a row that already
  // existed and therefore read as covered.
  //
  // Widening it is NOT the mechanical edit the four 4.0 operator rows were,
  // because `[ -v` is also the opening of an ordinary bracket EXPRESSION:
  // `tr -d '[ -v]'` is the character range space-to-v, and a `sed` class or a
  // `case` glob carries the same shape legitimately. A wrong widening reddens
  // the tree on CORRECT 3.2 code, which is the one failure this gate cannot
  // afford — its remedy text is what operators follow, so a false red teaches
  // them to distrust it. Three discriminators, each pinned in both directions
  // in `--self-test`, and each load-bearing on a line the other two miss:
  //
  //   1. COMMAND POSITION — `kind: 'builtin'`, so CMD_POS applies. `test` and
  //      `[` are builtins and `[[` is a reserved word, so all three take effect
  //      only where a command can start. This is E3 unchanged, and it is shell
  //      semantics rather than a heuristic: `[[` outside command position is
  //      not the operator at all. A bracket expression is an ARGUMENT — in
  //      `tr -d '[ -v]'` the `[` sits after a quote, which is no separator.
  //      (`coproc` is the precedent for a reserved word carried as `builtin`.)
  //   2. `-v` IS A WHOLE WORD — `[ \t]+` on BOTH sides. A range closes its class
  //      immediately after the `v`, so it never reaches an operand. This is the
  //      one that carries a `case` glob at the start of a line, where
  //      discriminator 1 matches and cannot help.
  //   3. AN OPERAND FOLLOWS. The unary takes a variable name, an array
  //      reference (4.3), a positional parameter (5.1) or an expansion — never
  //      a `]`. This is the one that carries `[ -v ]`, which is not the unary
  //      at all but a 3.2-LEGAL one-argument `test` asking whether the string
  //      `-v` is non-empty.
  //
  // The two failure DIRECTIONS differ across the spellings, the way the
  // `&>>`/`|&` pair does, and the message now says so. Measured on bash 5.2.21
  // with `-Z` standing in for `-v`, since an unrecognised unary takes the same
  // path today that `-v` takes on 3.2 — a proxy, stated as one:
  //
  //   `[[ -Z name ]]`  `bash -n` FAILS: "conditional binary operator expected",
  //                    "syntax error near `name'". A parse error, so not one
  //                    line of the script runs.
  //   `[ -Z name ]`    both PARSE; at run time "unary operator expected" goes
  //   `test -Z name`   to stderr, the test is FALSE, and the run CONTINUES.
  //
  // So the row that matched only `[[` carried the QUIET description — which
  // belonged to the two spellings it could not see, and not to the one it could.
  //
  // The attributions above are MEASURED rather than asserted. Each
  // discriminator was removed on disk in turn and `--self-test` read back:
  //
  //   drop 1 and 3, keep the word boundary   4 legs red — `run_test -v`, the
  //                                          quoted mention, `[ -v ]`
  //   drop all three                         7 legs red — adding the `tr`,
  //                                          `sed` and `case`-glob lines
  //   narrow back to `[[` alone              10 legs red — including both new
  //                                          coverage-floor entries
  //
  // So `tr -d '[ -v]'` is carried TWICE over — the quote and the closing `]`
  // each suffice alone — while the `case` glob rests on the word boundary alone
  // and `[ -v ]` on the operand rule alone. No control below is decoration, and
  // no discriminator above is redundant.
  {
    id: 'has-v',
    since: '4.2',
    kind: 'builtin',
    spelling: '[[ -v name ]] / [ -v name ] / test -v name',
    token: String.raw`(?:\[\[?|test)[ \t]+-v[ \t]+(?=[A-Za-z0-9_"'$])`,
    breaks:
      'with `[[`, a PARSE error ("conditional binary operator expected") and the script does not '
      + 'start; with `[` and `test`, "unary operator expected" on stderr, the test evaluates FALSE, '
      + 'and the run CONTINUES past it — the quiet direction',
    fix: '[[ -n "${name+set}" ]], or [ -n "${name+set}" ] for the single-bracket spellings',
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

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798). The self-test's own exit code stays load-bearing, so the
// handshake is a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures.length === 0` used to be this self-test's ONLY success condition, so
// "every case held" and "the cases never ran" printed the same line. Closed the
// way PR #13487 validated on check-doc-authoring: what is pinned is the
// registered NAMES, not a number. Every section opens with `battery('<name>')`,
// every assertion is attributed to the battery most recently opened, and the
// floor requires the OPENED set to equal the DECLARED set with each battery at
// or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'the table itself': 2,
  '⭐ the pattern is not vacuous, and it is not greedy': 38,
  '⭐ and the probes are real shell, not plausible-looking text': 19,
  'E1: full-line comments are prose, trailing comments are not': 3,
  'E2: variables are read through a sigil, and a guarded read is the fix': 8,
  'E3: a builtin only executes in command position': 11,
  'the near-neighbours that are NOT bash 4, so must never redden': 8,
  '⭐ a COVERAGE FLOOR: deleting a row must redden this self-test': 7,
  '⭐ the two `case` terminators stay DISJOINT': 2,
  '⭐ the `-v` unary: three spellings, one release, one bracket trap': 21,
  '⭐ the 3.2 replacements the new rows point at must stay GREEN': 7,
  'E2 again, for the row the sweep added': 6,
  'population membership': 5,
  '⭐ the declaration, and the two obligations it makes unreachable': 5,
  // ⚠️ Two floors differ from upstream's, and the difference is the port:
  //   end to end   5 -> 6  the clean-tree fixture now asserts BOTH census
  //                        halves by number instead of matching the word
  //                        "shebang", which the green line prints regardless.
  //   the real tree 2 -> 3  upstream's `byShebang > 0` is false in this
  //                         repository (12 shell files, all `.sh`); it is
  //                         replaced by the partition and the really-read legs.
  // ⛔ Neither is a floor LOWERED: both batteries grew. A future re-sync that
  // restores upstream's numbers here will red, which is the intent.
  '⭐ end to end, through the real discovery path': 6,
  '⭐ the instrument is real: the flagged construct really does break': 4,
  'the real tree': 3,
  // objectui#8404. Declared LAST because its third case reads `narrowed`, which
  // only has its final value once every host-dependent leg above has run.
  '⭐ objectui#8404: the self-test declares its own host premise': 5,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 18;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

function selfTest() {
  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const seen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    seen.set(b, (seen.get(b) ?? 0) + 1);
  };
  const SELF = fileURLToPath(import.meta.url);
  let failed = 0;
  let cases = 0;
  const t = (label, ok, detail = '') => {
    registerCase();
    cases += 1;
    if (ok) {
      console.log(`  ✓ ${label}`);
      return;
    }
    failed += 1;
    console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
  };
  const ids = (text) => scanText('f.sh', text).map((f) => f.id);

  // ── objectui#8404: the self-test's own host premise, made explicit ───────
  //
  // ⭐ A floor gate whose battery cannot run ON the floor it declares is a gate
  // asserting something it has never demonstrated. That was this file: every
  // probe, harness and `bash -n` leg below drives a bash-4+ construct through
  // the HOST's bash, and the host this gate exists for is macOS, which ships
  // 3.2.57 and no bash 4+. There, `coproc`, `|&` and `&>>` are syntax errors
  // `bash -n` refuses, `mapfile` is not a builtin there is anything to disable,
  // and `[[ -v ]]` is a conditional operator `bash -n` also refuses (this
  // file's `has-v` row already records that `bash -n` judges `[[` operators).
  // So `--self-test` exited non-zero on the one host whose behaviour the whole
  // gate is about, and `bash32-floor-wiring.test.ts` reported it as a red test.
  //
  // ⛔ The production scan is NOT affected and is not narrowed: `scanText` is
  // pure JS, so `node scripts/check-bash32-floor.mjs` judges a 3.2 host exactly
  // as it judges CI. Only `--self-test` needs the newer parser.
  //
  // The premise is detected by CAPABILITY and never by platform name — a
  // `process.platform === 'darwin'` branch would red again on the next non-GNU
  // host, which is the very species this gate is about. Two probes, because the
  // legs below need two different things from the host: a parser that accepts
  // bash-4 GRAMMAR, and a runtime that has a bash-4 BUILTIN to disable.
  const HOST_PROBES = [
    // The canonical bash-4.0 operator. A shell at the floor answers with a
    // syntax error near the `&`.
    { need: 'grammar', probe: 'echo a |& cat', run: () => spawnSync('bash', ['-n'], { input: 'echo a |& cat\n', encoding: 'utf8' }) },
    // The canonical bash-4.0 builtin. A shell at the floor answers 127.
    { need: 'builtin', probe: 'mapfile -t x < /dev/null', run: () => spawnSync('bash', ['-c', 'mapfile -t x < /dev/null'], { encoding: 'utf8' }) },
  ];
  const hostCan = Object.fromEntries(HOST_PROBES.map((h) => [h.need, h.run().status === 0]));
  const HOST_JUDGES_BASH4 = HOST_PROBES.every((h) => hostCan[h.need]);
  const NARROWING = HOST_PROBES.filter((h) => !hostCan[h.need]).map((h) => `\`${h.probe}\``).join(' and ');
  let narrowed = 0;

  /**
   * An assertion whose SUBJECT is a bash-4 construct run through the host bash.
   *
   * Where the host can judge bash-4, this is `t` unchanged — CI and every
   * bash-4+ host lose nothing. Where it cannot, the case still REGISTERS (so
   * its battery floor still holds and a battery that stops running still names
   * itself) but is reported as NARROWED rather than passed, and the verdict
   * line carries the count. ⛔ A narrowed case is a real coverage loss and is
   * printed as one: at the floor a typo and a bash-4 construct are the same
   * syntax error, so "the probe is not a typo" is genuinely unmeasurable there.
   */
  const tHostBash4 = (label, ok, detail = '') => {
    if (HOST_JUDGES_BASH4) {
      t(label, ok, detail);
      return;
    }
    registerCase();
    cases += 1;
    narrowed += 1;
    console.log(`  \u2298 ${label} — NARROWED: this host's bash refuses ${NARROWING}, so it is at or below the 3.2 floor this gate declares and cannot judge the case.`);
  };

  console.log('check-bash32-floor --self-test\n');

  // --- the table itself ----------------------------------------------------
  battery('the table itself');
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
  battery('⭐ the pattern is not vacuous, and it is not greedy');
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
  battery('⭐ and the probes are real shell, not plausible-looking text');
  for (const c of CONSTRUCTS) {
    const parse = spawnSync('bash', ['-n'], { input: `${c.probe}\n`, encoding: 'utf8' });
    tHostBash4(`${c.id}: the probe is shell a bash-4 parser accepts`, parse.status === 0, (parse.stderr || '').trim());
  }

  // --- E1: full-line comments are prose, trailing comments are not ---------
  battery('E1: full-line comments are prose, trailing comments are not');
  t('E1 a full-line comment naming a construct is exempt', ids('   # no mapfile here, ever').length === 0);
  t('E1 a comment naming EPOCHSECONDS is exempt', ids('# EPOCHSECONDS is bash 5').length === 0);
  t(
    'E1 a TRAILING comment does not exempt the code beside it',
    ids('mapfile -t x < f   # sorry').includes('mapfile'),
  );

  // --- E2: variables are read through a sigil, and a guarded read is the fix
  battery('E2: variables are read through a sigil, and a guarded read is the fix');
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
  battery('E3: a builtin only executes in command position');
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
  battery('the near-neighbours that are NOT bash 4, so must never redden');
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
  //
  // The two `-v` spellings are here for a VARIANT of the same reason. They live
  // on a row that already existed, so deleting the row is not the only way to
  // lose them: narrowing its pattern back to the `[[` spelling would too, and
  // that is a one-character edit no row count would notice.
  battery('⭐ a COVERAGE FLOOR: deleting a row must redden this self-test');
  for (const [label, line] of [
    ['&>> (append-both)', 'exec "$@" &>> "$logfile"'],
    ['|& (pipe-both)', 'make build |& tee build.log'],
    [';& (case fall-through)', 'case "$1" in -v) verbose=1 ;& *) run ;; esac'],
    ['{x..y..incr} (brace increment)', 'for i in {0..100..10}; do echo "$i%"; done'],
    ['$BASHPID', 'tmp="$TMPDIR/work.$BASHPID"'],
    ['[ -v (single-bracket unary)', 'if [ -v CONFIG_PATH ]; then :; fi'],
    ['test -v (bare `test` unary)', 'test -v CONFIG_PATH && echo set'],
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
  battery('⭐ the two `case` terminators stay DISJOINT');
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

  // --- ⭐ the `-v` unary: three spellings, one release, one bracket trap ----
  //
  // bash 4.2 gave `-v` to `test`, `[` and `[[` in one release, so the three are
  // one construct on one row. These legs are deliberately NOT parameterised by
  // `CONSTRUCTS`: a table-driven leg supplies ONE probe per ROW, which is
  // exactly how two thirds of this construct stayed unseen while the suite
  // stayed green. A per-row probe cannot pin a per-SPELLING gap.
  //
  // ⚠️ Every positive pins the ARRIVAL, not the departure. `length > 0` is
  // satisfied by a row that reports these lines under the WRONG id and prints
  // the wrong remedy, and "no longer the empty result" is not the claim here.
  battery('⭐ the `-v` unary: three spellings, one release, one bracket trap');
  for (const [label, line] of [
    ['[[ -v name ]]', '[[ -v name ]] && echo yes'],
    ['[ -v name ]', '[ -v name ] && echo yes'],
    ['test -v name', 'if test -v name; then :; fi'],
  ]) {
    t(
      `\`${label}\` is reported as has-v — the arrival, not merely a non-empty result`,
      ids(line).includes('has-v'),
      `got ${JSON.stringify(ids(line))}`,
    );
    const vParse = spawnSync('bash', ['-n'], { input: `${line}\n`, encoding: 'utf8' });
    tHostBash4(`\`${label}\` is shell a bash-4 parser accepts`, vParse.status === 0, (vParse.stderr || '').trim());
  }
  t('has-v after `&&` → RED', ids('cd "$d" && [ -v name ]').includes('has-v'));
  t('has-v inside `$( )` → RED', ids('n=$( [ -v name ] && echo 1 )').includes('has-v'));
  t('has-v after `while` → RED', ids('while [[ -v name ]]; do :; done').includes('has-v'));
  t('has-v with a quoted operand → RED', ids('[ -v "$name" ]').includes('has-v'));
  t('has-v with a 4.3 array reference → RED', ids('[[ -v arr[0] ]] && echo yes').includes('has-v'));
  t('has-v with a 5.1 positional parameter → RED', ids('test -v 1 && echo yes').includes('has-v'));
  t('and the single-bracket 3.2 repair stays green', !ids('[ -n "${name+set}" ]').includes('has-v'));

  // ⭐ The false-positive half — the whole reason this row was filed rather
  // than swept. Every line below is CORRECT 3.2 shell, and a row that reddens
  // any of them teaches operators to distrust the remedy text they are supposed
  // to follow. The discriminator carrying each is named, because the three are
  // not redundant: the first three lines are each carried by a DIFFERENT one.
  t(
    'a `tr` bracket EXPRESSION is not the unary — carried TWICE over',
    ids("tr -d '[ -v]' < in > out").length === 0,
    'the `[` sits after a quote (not a command separator) AND the class closes at `-v]`; '
      + 'measured, either one alone keeps this green',
  );
  t(
    'a `sed` character class likewise — a second idiom, the same shape',
    ids("sed 's/[ -v]//g' file.txt").length === 0,
  );
  t(
    'a `case` glob at the START of a line — carried by the WORD BOUNDARY alone',
    ids('  [ -v]) echo "in range" ;;').length === 0,
    'command position DOES match here; the class closing at `-v]` is what saves it',
  );
  t(
    '`[ -v ]` is a 3.2-LEGAL one-argument test — carried by the OPERAND rule alone',
    ids('[ -v ] && echo nonempty').length === 0,
    'position and word boundary both match here; only the absent operand saves it',
  );
  t('a command whose name merely ENDS in `test` is not `test`', ids('run_test -v "$case"').length === 0);
  t(
    'and a mention inside a quoted argument invokes nothing (E3)',
    ids('echo "use test -v name to check whether it is set"').length === 0,
  );
  //
  // ⚠️ A negative control is satisfied by a pattern that matches NOTHING at
  // all, so the halves above are paired with the red they are one token from.
  t(
    'minimal pair: adding an OPERAND flips `[ -v ]` red',
    ids('[ -v ] && echo nonempty').length === 0 && ids('[ -v x ] && echo nonempty').includes('has-v'),
    'were the red half green, every negative above would pass on a dead row',
  );
  t(
    'and the negatives are not passing on a dead row: it still fires',
    ids('[ -v name ] && echo yes').includes('has-v'),
  );

  // --- ⭐ the 3.2 replacements the new rows point at must stay GREEN --------
  //
  // The load-bearing half. A `|&` pattern that also matched `2>&1 |` would red
  // every correct pipeline in the repo — the gate refusing its own remedy — and
  // the failure text tells operators to write exactly that.
  battery('⭐ the 3.2 replacements the new rows point at must stay GREEN');
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
  battery('E2 again, for the row the sweep added');
  t('E2 `$BASHPID` is an unguarded read → RED', ids('p=$BASHPID').includes('bashpid'));
  t('E2 `${BASHPID}` is an unguarded read → RED', ids('p=${BASHPID}').includes('bashpid'));
  t('E2 `${BASHPID:-$$}` is the repair → green', !ids('p="${BASHPID:-$$}"').includes('bashpid'));
  t('E2 a bare word is not a read: `unset BASHPID` → green', !ids('unset BASHPID').includes('bashpid'));
  t('E2 `$BASHPIDX` is a different name → green', !ids('p=$BASHPIDX').includes('bashpid'));
  t('and `$$` — the 3.2 spelling — is not flagged', ids('p=$$').length === 0);

  // --- population membership -----------------------------------------------
  battery('population membership');
  t('a .sh name is shell', isShell('scripts/x.sh', 'echo hi').by === 'extension');
  // ⚠️ These fixture paths are under THIS repository's roots, not upstream's
  // `.githooks/`. `isShell` never touches the filesystem, so any string would
  // "work" — and that is the trap: a fixture naming a directory this gate does
  // not walk reads as coverage of a population that is not scanned.
  t(
    'a shebang-only script is shell — the half a *.sh glob misses',
    isShell('e2e/live/ci/pre-push', '#!/bin/sh\necho hi').by === 'shebang',
  );
  t('`#!/usr/bin/env bash` counts', isShell('scripts/release-helper', '#!/usr/bin/env bash\n').by === 'shebang');
  t('a node script is not shell', isShell('scripts/x.mjs', '#!/usr/bin/env node\n').shell === false);
  t('a plain text file is not shell', isShell('scripts/README.md', '# hi\n').shell === false);

  // --- ⭐ the declaration, and the two obligations it makes unreachable -----
  //
  // Spelled as subtree GLOBS so the derivation can read them (a bare
  // single-segment word builds no hint at all and lands unnameable), and
  // spelled as SOURCE LITERALS so the extractor can see them at all — an
  // assembled root is invisible to it, which is the same blind spot wearing a
  // template string.
  battery('⭐ the declaration, and the two obligations it makes unreachable');
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
  battery('⭐ end to end, through the real discovery path');
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

  // ⭐ The shebang-only member sits under `e2e/**` — a root THIS gate walks.
  // Upstream's fixture puts it under `.githooks/`, which is in upstream's roots
  // and not in these; carried across unchanged it would never be discovered,
  // and the census leg below would have passed anyway (see its own note).
  const cleanRepo = fixtureRepo({
    'scripts/ok.sh': '#!/usr/bin/env bash\n# no mapfile, no declare -A\nwhile IFS= read -r l; do :; done < f\n',
    'e2e/live/ci/pre-push': '#!/bin/sh\nnow="${EPOCHSECONDS:-$(date +%s)}"\n',
  });
  const cleanRun = spawnSync(process.execPath, [SELF, '--root', cleanRepo], { encoding: 'utf8' });
  t(
    'a 3.2-clean tree is GREEN, guarded reads and all',
    cleanRun.status === 0,
    `${cleanRun.stdout}${cleanRun.stderr}`.slice(0, 400),
  );
  // ⚠️ Upstream asserts `/shebang/` on this output. That word is in the green
  // line UNCONDITIONALLY — it is printed even when the count is 0 — so the leg
  // passes on a discovery path that found nothing, which is the species this
  // file exists to refuse. The COUNTS are what carry the claim, so they are
  // what is asserted: this fixture has exactly one `.sh` member and exactly one
  // shebang-only member, and both halves of the census must say so.
  t(
    'and its green line reports the census as 1 by extension and 1 by shebang alone',
    /census: 1 by \.sh extension, 1 by shebang alone/.test(cleanRun.stdout),
    cleanRun.stdout,
  );
  t(
    'so the shebang half really is reachable under THIS repository\'s roots',
    / 2 tracked shell file\(s\) /.test(cleanRun.stdout),
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
  battery('⭐ the instrument is real: the flagged construct really does break');
  const simDir = mkdtempSync(join(tmpdir(), 'bash32-sim-'));
  const noBash4 = join(simDir, 'no-bash4-builtins.sh');
  writeFileSync(noBash4, 'enable -n mapfile readarray 2> /dev/null\n');
  const probe = join(simDir, 'probe.sh');
  writeFileSync(probe, 'mapfile -t x < /dev/null && echo MAPFILE-WORKS\n');
  const plain = spawnSync('bash', [probe], { encoding: 'utf8' });
  const sim = spawnSync('bash', [probe], { encoding: 'utf8', env: { ...process.env, BASH_ENV: noBash4 } });
  // ⚠️ objectui#8404: both legs need a host that HAS `mapfile` to remove. At
  // the 3.2 floor `plain` never prints MAPFILE-WORKS either, so the first leg
  // is false for the wrong reason and the second passes for the wrong one —
  // 127 there is the absent builtin, not the harness. Narrowed together,
  // because the second leg's meaning is carried by the first.
  tHostBash4(
    'the simulated-3.2 harness really removes the builtin (else the next leg proves nothing)',
    plain.stdout.includes('MAPFILE-WORKS') && !sim.stdout.includes('MAPFILE-WORKS') && /mapfile/.test(sim.stderr),
    `plain=${plain.stdout.trim()} sim.out=${sim.stdout.trim()} sim.err=${sim.stderr.trim()}`,
  );
  tHostBash4(
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
  battery('the real tree');
  const live = scanTree(REPO_ROOT);
  t(
    'real-tree discovery finds shell to scan (a gate over nothing is not green)',
    live.population.length > 0,
    `${live.population.length} file(s)`,
  );
  // ⛔ Upstream's second leg here is `live.byShebang > 0`, and it CANNOT be
  // carried: measured on `origin/main` `28cfff4` this repository has 12 shell
  // files and every one of them ends in `.sh`, so the shebang census is 0 and
  // upstream's leg would be red on the day this landed. The temptation is then
  // to drop the shebang half of discovery, which is the wrong repair — see the
  // "## Population" note above. What replaces it are the two things that ARE
  // true here and that a future edit could break silently:
  //
  //   - the census PARTITIONS the population. If a member is ever counted in
  //     neither half (or in both), the totals the green line prints stop
  //     describing what was scanned, and that is the arithmetic upstream's
  //     `> 0` never checked at all.
  //   - every member really was READ. `listPopulation` skips a path it cannot
  //     open, so a population of empty texts is a walk that discovered names
  //     and judged nothing — green, over nothing.
  //
  // The shebang half's own MECHANISM is pinned end to end in the clean-tree
  // fixture above, where it is exercised rather than merely counted.
  t(
    'the census partitions the population — every file counted in exactly one half',
    live.byExtension + live.byShebang === live.population.length,
    `${live.byExtension} + ${live.byShebang} != ${live.population.length}`,
  );
  t(
    'and every member was actually read, not merely named',
    live.population.every((f) => typeof f.text === 'string' && f.text.length > 0),
    `${live.population.filter((f) => !f.text).length} member(s) came back empty`,
  );
  console.log(
    `\n  · real tree: ${live.population.length} shell file(s) — ${live.byExtension} by extension, `
    + `${live.byShebang} by shebang alone — ${live.findings.length} finding(s)`,
  );

  // --- ⭐ objectui#8404: the self-test declares its own host premise -------
  //
  // The narrowing mechanism above is itself a place a gate can go quiet, so it
  // is pinned in both directions: a host that CAN judge bash-4 must narrow
  // nothing, and a host that cannot must narrow something. A mechanism that
  // narrowed on every host would read as green while measuring nothing.
  battery('⭐ objectui#8404: the self-test declares its own host premise');
  // ⚠️ E1 again, and for E1's reason: this file has to NAME the branch it
  // refuses in order to explain why, and a check hunting that name has to name
  // it too. So the needle is assembled from parts rather than written as a
  // literal, and the prose lines are dropped before the search — exactly the
  // mention-versus-use rule the CONSTRUCTS table is built on. A real branch
  // lives on a code line, which is what survives the filter.
  const PLATFORM_BRANCH = new RegExp(['process', 'platform'].join('\\.'));
  const codeLines = readFileSync(SELF, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  t(
    '⛔ the premise is a capability, never a platform name — a `darwin` branch reds again on the next non-GNU host',
    !PLATFORM_BRANCH.test(codeLines),
    'a code line here branches on the platform name; the host premise must be measured instead',
  );
  t(
    'and the filter that allows the prose above is not blanket permission — a code line IS searched',
    PLATFORM_BRANCH.test(codeLines + '\nconst x = process' + '.platform;'),
    'the mention/use filter matched nothing at all, so the leg above proves nothing',
  );
  t(
    'and the two capability probes are constructs THIS gate declares above the floor',
    ids(HOST_PROBES[0].probe).includes('pipe-both') && ids(HOST_PROBES[1].probe).includes('mapfile'),
    `got ${JSON.stringify(HOST_PROBES.map((h) => ids(h.probe)))}`,
  );
  t(
    'judging and narrowing are exclusive: a host that judges bash-4 narrowed nothing',
    !HOST_JUDGES_BASH4 || narrowed === 0,
    `HOST_JUDGES_BASH4=${HOST_JUDGES_BASH4} narrowed=${narrowed}`,
  );
  t(
    'and a host that does NOT judge bash-4 really did narrow — a narrowing nobody takes is a claim nobody made',
    HOST_JUDGES_BASH4 || narrowed > 0,
    `HOST_JUDGES_BASH4=${HOST_JUDGES_BASH4} narrowed=${narrowed}`,
  );

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ───
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  const floorFailure = (message) => {
      failed += 1;
      console.error(`  FAIL ${message}`);
  };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of seen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = seen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the ' +
        'number. Find what stopped registering (an early return, a deleted block, a guard that now ' +
        'skips) and restore it.',
    );
  }
  if (failed > 0) {
    console.error(`\n✗ check-bash32-floor self-test failed (${failed} of ${cases} case(s)).`);
    process.exit(1);
  }
  if (narrowed > 0) {
    console.log(
      `\n✓ check-bash32-floor self-test: ${cases - narrowed} cases pass, ${narrowed} NARROWED.\n`
      + `  This host's bash refuses ${NARROWING}, so it is at or below the bash 3.2 floor this\n`
      + '  gate declares and cannot judge a bash-4 construct. Those cases did not run here:\n'
      + '  a real coverage loss, stated rather than hidden. CI runs bash 5 and runs them.\n'
      + '  ⛔ The SCAN is not narrowed — `node scripts/check-bash32-floor.mjs` is pure JS and\n'
      + '  judges this host exactly as it judges CI (objectui#8404).',
    );
  } else {
    console.log(`\n✓ check-bash32-floor self-test: ${cases} cases pass.`);
  }
  selfTestReachedVerdict = true;
}

// ---------------------------------------------------------------------------

function main() {
  if (process.argv.includes('--self-test')) {
    const selfTestCode = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-bash32-floor self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    return selfTestCode;
  }

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
