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
 * ## The BOUNDARY: the axis is the bash INTERPRETER, not the userland binaries
 *
 * A gate that states its class but not its boundary can be widened by a
 * well-meaning row, so the boundary is written here rather than left to be
 * re-derived. This gate's axis is the VERSION OF BASH THAT RUNS A SCRIPT, and
 * the row schema says so by construction, not by convention: every
 * `CONSTRUCTS` row carries a `since:` that is a bash version, and every `kind`
 * is a bash category — a builtin, a piece of syntax, a variable. There is no
 * value for "an external binary", and a row about one has nowhere to put it.
 *
 * So a difference between the GNU and BSD USERLAND BINARIES a script calls —
 * `mktemp` and where it will accept the `XXXXXX`, `sed -i` and whether it
 * demands a suffix argument, `readlink -f`, `date` and its flags — is a
 * DIFFERENT AXIS, and ⛔ it is not a row here. Such a row could not be written
 * honestly: `mktemp` has no bash version, so its `since:` would have to be a
 * lie or a special case, and the verdict line this gate prints ends
 * "constructs checked, floor bash 3.2" — which becomes false advertising the
 * moment a coreutils-vs-BSD rule joins the table it counts. Widening here
 * would silently convert a gate that means "this script needs bash 4" into one
 * that means "this script behaves differently on a Mac": a strictly larger
 * claim, made by adding a row.
 *
 * ⇒ That class wants a SIBLING gate, not a row here — and ⛔ not yet. The
 * measured population of real userland defects in this repo is ONE: an
 * `mktemp` template whose `XXXXXX` was not last. It is already fixed and
 * guarded by a per-script pin, which ⛔ stays — nothing here replaces it. A
 * shared gate for a population of one is not warranted, and the evidence that
 * would change that is a SECOND real instance; the place to land it is the
 * boundary card this paragraph came from (#17141).
 *
 * ⚠️ The basis is written out and not just the verdict, on purpose: a boundary
 * stated without its basis gets re-litigated by the next person who
 * provisionally leans yes. That is not hypothetical. This exact question —
 * should this gate grow a BSD/portability rule, so the `mktemp` class is
 * caught by a shared gate instead of a per-script pin — was asked, was
 * answered NO, and the seat that answered it had leaned the other way first
 * and put that on the record: *"measuring is what produced it — I had
 * provisionally leaned yes."* ⇒ Measuring is the part that is reproducible.
 * Read any row's `since:` and `kind:` before re-opening this; ⛔ do not
 * re-litigate it from intuition.
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
 *
 * ## The census is enumerated from the INDEX and judged from the DISK (#18465)
 *
 * Those are two different trees, and the gap between them is a HOLE in the
 * census rather than a smaller population. A sparse checkout, a partially
 * materialised worktree, a `--root` pointed at one, or a deletion that is not
 * staged yet all leave paths the index lists and the disk cannot supply.
 * Skipping one is CORRECT — a deleted-but-indexed path is genuinely not a
 * script to judge — so the skip stays. What is not correct is doing it
 * quietly.
 *
 * The green line prints the census as a VERDICT, so a silently shrunken count
 * is an assertion a reader acts on, and it is strictly more dangerous than the
 * empty population the paragraph above refuses: an empty census is visibly
 * absurd, a plausible smaller one reads as a fact. Measured on a 7-file
 * fixture with four paths removed from the disk alone, the gate printed
 * `3 tracked shell file(s) ... census: 2 by .sh extension, 1 by shebang alone`
 * at exit 0 while `git ls-files` still listed 7. It has already cost time: a
 * 33 to 29 to 33 swing sat unreconciled for six days, because the run that
 * read 29 had no way to say what it had not read.
 *
 * So an unreadable indexed path is a REFUSAL carrying its reason, PER PATH —
 * the same disposition `unsupportedConstructs` takes toward a skip above, and
 * ⛔ never a count, which is the silent skip with a number attached.
 *
 * ⚠️ Refusing rather than merely warning is safe because the skip is
 * measurably ZERO on a complete checkout: every path the index lists under
 * these roots is a regular blob — no symlink, no gitlink, and this repo
 * declares no submodule — so nothing but an incomplete tree produces one.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { gitFreeEnv } from './git-env.mjs';
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
 * ## What the `bash` on PATH can actually do — MEASURED, never inferred
 *
 * Two `--self-test` harnesses in this repo drive a real shell, and both
 * assumed the interpreter they spawn is bash 4+. On macOS `/bin/bash` is
 * 3.2.57 — the very floor this gate defends — so both went red on the one
 * platform whose support is the whole point of the floor, while CI's bash 5
 * stayed green. This is the ONE detection both harnesses now share. The
 * DISPOSITIONS they take from it are deliberately NOT shared, and each is
 * argued where it is taken: a harness that replays a bash-4 workflow block
 * verbatim cannot run at all under the floor and says so out loud, while the
 * simulated-3.2 leg below wants the opposite and reads a native absence as a
 * BETTER instrument than the one it manufactures.
 *
 * Two readings, and the split between them is not cosmetic:
 *
 *   `major`/`minor`   from `BASH_VERSINFO`, set by every bash since 2.0. It is
 *                     the only instrument that can speak about SYNTAX and about
 *                     new FLAGS on old builtins — `declare -A`, `shopt -s
 *                     globstar`, `${x^^}` — because on 3.2 the command itself
 *                     still exists and only the flag or the expansion is new,
 *                     so there is nothing for `type` to be asked about.
 *
 *   `builtins`        `type -t <name>`, per name, for the rows whose construct
 *                     IS the command. Exactly two names are probed and the
 *                     narrowness is the whole point: `type -t declare` answers
 *                     `builtin` on 3.2 as loudly as on 5.2, so probing there
 *                     would report a capability the host does not have. It is
 *                     also the only reading that survives `enable -n mapfile
 *                     readarray` — the manufactured floor this file's own
 *                     instrument leg builds, where the version still reads 5.x
 *                     while the builtin is gone.
 *
 * ⚠️ `CONSTRUCTS[].since` is NOT consulted here and must not be. The header
 * above states it is documentation and not a predicate; a capability inferred
 * from a table is not a measurement, and the table would then be certifying
 * itself.
 *
 * ⛔ `answered: false` is a REFUSAL, not a default. A caller that cannot read
 * the host's capabilities knows nothing, and "knows nothing" must fail loudly
 * rather than fall through to the permissive branch (#4690).
 */
export const PROBED_BUILTINS = Object.freeze(['mapfile', 'readarray']);

/**
 * The pure half: turn one probe transcript into a capability reading.
 *
 * Split out from the spawning half on purpose — it is what lets BOTH branches
 * of every disposition below be pinned from fixtures on any host, including the
 * bash-4+ hosts where a native 3.2 reading cannot be produced at all.
 *
 * @param {string} stdout the probe's output
 * @param {number|null} status the probe's exit status
 */
export function readBashCapabilities(stdout, status) {
  const lines = String(stdout ?? '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  const version = lines[0] ?? '';
  const m = /^(\d+)\.(\d+)$/.exec(version);
  /** @type {Record<string, boolean|null>} */
  const builtins = {};
  for (const name of PROBED_BUILTINS) builtins[name] = null;
  for (const line of lines.slice(1)) {
    const [name, kind] = line.split(' ');
    if (!PROBED_BUILTINS.includes(name)) continue;
    // `type -t` prints `builtin` for a live builtin and NOTHING once
    // `enable -n` has removed it — which is also what a host that never had it
    // prints. Those two are the same fact about this shell, and this reading
    // deliberately does not try to tell them apart: the callers that care do it
    // by argument, not by probe.
    builtins[name] = kind === 'builtin' || kind === 'function' || kind === 'file';
  }
  const answered = status === 0 && m !== null && PROBED_BUILTINS.every((b) => builtins[b] !== null);
  return {
    answered,
    version: m ? version : null,
    major: m ? Number(m[1]) : null,
    minor: m ? Number(m[2]) : null,
    builtins,
  };
}

/** The probe script, kept beside its reader so the two cannot drift. */
const CAPABILITY_PROBE =
  'printf \'%s.%s\\n\' "${BASH_VERSINFO[0]:-0}" "${BASH_VERSINFO[1]:-0}"\n' +
  PROBED_BUILTINS.map((b) => `printf '%s %s\\n' '${b}' "$(type -t ${b} 2> /dev/null || true)"`).join('\n') +
  '\n';

/** Measure the `bash` this process would spawn. Resolved through `PATH`, like every other spawn here. */
export function probeBashCapabilities() {
  const out = spawnSync('bash', ['-c', CAPABILITY_PROBE], { encoding: 'utf8' });
  return readBashCapabilities(out.stdout ?? '', out.status);
}

/**
 * The rows whose construct is a COMMAND, so `type -t` can answer for them.
 * Every other row is a flag, an option, an expansion or an operator on
 * something 3.2 already has, and only the version reading speaks to those.
 */
const ROW_PROBED_BUILTINS = Object.freeze({ mapfile: PROBED_BUILTINS });

/**
 * Which constructs in one block of shell this host's `bash` cannot run.
 *
 * Returns `scanText` findings, so a caller reporting a skip can name the line,
 * the spelling and what it BREAKS — the same sentence this gate prints when it
 * flags the same construct in a tracked file. A skip carrying that is a skip
 * with a reason; one carrying a count is the quiet pass #4690 refuses.
 *
 * @param {string} label a name for the block, used only in the findings
 * @param {string} text the block, verbatim
 * @param {ReturnType<typeof readBashCapabilities>} caps
 */
export function unsupportedConstructs(label, text, caps) {
  if (!caps.answered) throw new Error('unsupportedConstructs: capabilities were never read — refuse, do not guess');
  return scanText(label, text).filter((finding) => {
    const probed = ROW_PROBED_BUILTINS[finding.id];
    const named = probed ? probed.filter((name) => finding.text.includes(name)) : [];
    if (named.length > 0) return named.some((name) => caps.builtins[name] === false);
    return typeof caps.major === 'number' && caps.major < 4;
  });
}

/**
 * Why one indexed path could not be read, in the terms the OS gave.
 *
 * Node's `fs` message already opens with the errno and ends with the path
 * (`ENOENT: no such file or directory, open '...'`), which is the whole reason
 * this is carried rather than summarised: the shapes a reader must tell apart
 * — absent (a sparse checkout or an unstaged deletion), a directory here, a
 * mode this process cannot read — differ only in that code.
 *
 * @param {unknown} err
 */
function unreadableReason(err) {
  const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : null;
  const reason = err instanceof Error && err.message ? err.message : String(err);
  return { code, reason };
}

/**
 * The population, read from the git index under the derived walk roots.
 *
 * Also returns `unreadable`: the paths the index listed and the disk could not
 * supply, each with its reason (#18465). The skip is kept — a deleted-but-
 * indexed path is not a script to judge — but it leaves a hole in the census,
 * so the caller can refuse instead of printing a shrunken number as a verdict.
 *
 * @param {string} root
 */
export function listPopulation(root) {
  const out = spawnSync('git', ['-C', root, 'ls-files', '-z', '--', ...WALK_ROOTS], {
    // #16644: `-C root` is the ONLY thing that may decide which index is read. An
    // inherited GIT_DIR outranks it, and this function is called with a mkdtemp fixture
    // as `root` in every end-to-end leg below -- under a hook those legs would census
    // the real repository and report a number about the wrong tree.
    env: gitFreeEnv(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (out.status !== 0) {
    throw new Error(`git ls-files failed under ${root}: ${(out.stderr || '').trim()}`);
  }
  const population = [];
  /** @type {{ rel: string, code: string|null, reason: string }[]} */
  const unreadable = [];
  let byExtension = 0;
  let byShebang = 0;
  for (const rel of out.stdout.split('\0').filter(Boolean)) {
    let text;
    try {
      text = readFileSync(join(root, rel), 'utf8');
    } catch (err) {
      // Still skipped: a deleted-but-indexed path is not a script to judge.
      // But RECORDED, because the population was enumerated from the index and
      // this path is in it — the silence, not the skip, was the defect (#18465).
      unreadable.push({ rel, ...unreadableReason(err) });
      continue;
    }
    const verdict = isShell(rel, text);
    if (!verdict.shell) continue;
    if (verdict.by === 'extension') byExtension += 1;
    else byShebang += 1;
    population.push({ rel, text, by: verdict.by });
  }
  return { population, byExtension, byShebang, unreadable };
}

/** Scan a whole tree. Returns findings plus the census the green line prints. */
export function scanTree(root) {
  const { population, byExtension, byShebang, unreadable } = listPopulation(root);
  const findings = [];
  for (const { rel, text } of population) findings.push(...scanText(rel, text));
  return { findings, population, byExtension, byShebang, unreadable };
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

/**
 * The census has a HOLE in it: name every path, and why each one (#18465).
 *
 * ⛔ Per path with its reason, never a count. A count is the silent skip with
 * a number attached, and the defect was precisely that the number was
 * plausible — `report()` above names a file, a line and a spelling for the
 * same reason.
 *
 * @param {{ rel: string, code: string|null, reason: string }[]} unreadable
 * @param {{ rel: string }[]} population what the readable remainder came to
 * @param {{ file: string }[]} findings the remainder's findings, if any
 */
function reportUnreadable(unreadable, population, findings) {
  console.error(
    '✗ check-bash32-floor: ' + unreadable.length + ' path(s) under ' + POPULATION_ROOTS.join(', ')
    + ' are listed in the\n  git index but could not be read from disk, so this census has a hole in '
    + 'it and is not a verdict.\n',
  );
  for (const u of unreadable) {
    console.error('  ' + u.rel);
    console.error('      ' + u.reason + '\n');
  }
  console.error(
    'The population is enumerated from the INDEX and judged from the DISK. Skipping a path that\n'
    + 'cannot be read is correct — a deleted-but-indexed path is not a script to judge — but doing it\n'
    + 'quietly would have printed "' + population.length + ' tracked shell file(s)" as a verdict while '
    + unreadable.length + ' path(s) the index\nlists were never read at all; an unread path cannot even be '
    + 'classified as shell, so the census\ncannot say whether it belonged in the count. A plausible smaller '
    + 'number reads as a fact where\nan empty one would read as absurd — this is the neighbouring refusal '
    + 'completed (#4690).\n\n'
    + 'Usual causes, in the order they occur: a deletion that is not staged yet (git add -A, or\n'
    + 'git rm), a sparse or partially materialised checkout (git sparse-checkout disable), or a\n'
    + '--root pointed at one. Re-run against a complete tree.',
  );
  if (findings.length > 0) {
    console.error(
      '\nThe readable remainder also carries ' + findings.length + ' finding(s), reported below. That is a\n'
      + 'reading of the REMAINDER, never of the population.\n',
    );
  }
}

// ---------------------------------------------------------------------------

/**
 * A throwaway git repo holding one `scripts/` tree, so the end-to-end legs
 * exercise the REAL discovery path (the git index) and not a stub.
 */
function fixtureRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'bash32-floor-'));
  // #16644: `init` and `add -A` are the two commands the measured incident ran. With an
  // inherited GIT_DIR the `init` writes core.bare into the SHARED .git/config and the
  // `add -A` stages the real tree as deleted, both silently.
  spawnSync('git', ['-C', dir, 'init', '-q'], { encoding: 'utf8', env: gitFreeEnv() });
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8', env: gitFreeEnv() });
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
  '⭐ end to end, through the real discovery path': 5,
  '⭐ an indexed path the DISK cannot supply is a REFUSAL': 11,
  '⭐ the bash-4 capability reading, pinned in BOTH directions': 12,
  '⭐ the instrument is real: the flagged construct really does break': 5,
  'the real tree': 2,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 19;

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
    t(`${c.id}: the probe is shell this host can parse`, parse.status === 0, (parse.stderr || '').trim());
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
    t(`\`${label}\` is shell this host can parse`, vParse.status === 0, (vParse.stderr || '').trim());
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

  // --- ⭐ an indexed path the DISK cannot supply is a REFUSAL (#18465) -----
  //
  // The population is enumerated from the INDEX and judged from the DISK, so a
  // path the index lists and the disk cannot supply is a HOLE in the census
  // rather than a smaller population. Before this battery the gate dropped it
  // in a silent `continue` and printed the shrunken number as its verdict at
  // exit 0 — measured on a 7-file fixture with four paths removed from the disk
  // alone: `3 tracked shell file(s) ... census: 2 by .sh extension, 1 by
  // shebang alone`, while `git ls-files` still listed 7.
  //
  // ⚠️ Both directions are pinned and the DARK half is the load-bearing one: a
  // refusal that also fired on a COMPLETE checkout would redden every normal
  // run, and it would pass every lit case below while doing it.
  battery('⭐ an indexed path the DISK cannot supply is a REFUSAL');
  const holed = {
    'scripts/present.sh': '#!/usr/bin/env bash\necho present\n',
    'scripts/absent.sh': '#!/usr/bin/env bash\necho absent\n',
    '.githooks/pre-push': '#!/bin/sh\nnow="${EPOCHSECONDS:-$(date +%s)}"\n',
  };
  const completeRepo = fixtureRepo(holed);
  const partialRepo = fixtureRepo(holed);
  // Removed from the DISK only. The index is never touched, which is the whole
  // shape — and the first case proves the fixture really is that shape, because
  // a fixture whose index also lost the path would make every case below pass
  // by testing nothing.
  rmSync(join(partialRepo, 'scripts/absent.sh'));
  const stillIndexed = spawnSync('git', ['-C', partialRepo, 'ls-files', '--', ...WALK_ROOTS], { encoding: 'utf8', env: gitFreeEnv() });
  t(
    'the fixture really is INDEX-vs-DISK: the index still lists the removed path',
    stillIndexed.stdout.includes('scripts/absent.sh'),
    stillIndexed.stdout.trim(),
  );
  const partial = listPopulation(partialRepo);
  // ⛔ Read through an optional binding, never `partial.unreadable[0].code`
  // directly. An assertion that THROWS instead of returning false takes every
  // later case in this battery with it — including both DARK legs, which are
  // the load-bearing half — and it dies before the battery floor and the
  // verdict handshake can speak. Measured: ablating the reporting half crashed
  // this battery at its third case, so the remaining eight never ran.
  const hole = partial.unreadable[0] ?? null;
  t(
    'an unreadable indexed path is REPORTED, not dropped in silence',
    partial.unreadable.length === 1 && hole?.rel === 'scripts/absent.sh',
    JSON.stringify(partial.unreadable),
  );
  t(
    'and it carries its REASON — a count is the silent skip with a number attached',
    hole?.code === 'ENOENT' && /no such file/i.test(hole?.reason ?? ''),
    JSON.stringify(hole),
  );
  t(
    'the SKIP itself is kept: a deleted-but-indexed path is still not a script to judge',
    partial.population.every((p) => p.rel !== 'scripts/absent.sh') && partial.population.length === 2,
    JSON.stringify(partial.population.map((p) => p.rel)),
  );
  const partialRun = spawnSync(process.execPath, [SELF, '--root', partialRepo], { encoding: 'utf8' });
  const partialOut = `${partialRun.stdout}${partialRun.stderr}`;
  t(
    'end to end, the gate REFUSES rather than printing a shrunken census at exit 0',
    partialRun.status === 1,
    partialOut.slice(0, 400),
  );
  t(
    'and the refusal NAMES the path it could not read',
    partialOut.includes('scripts/absent.sh'),
    partialOut.slice(0, 400),
  );
  t(
    '⛔ and the green census line is never printed — that line IS the shrunken verdict',
    !/tracked shell file\(s\) under/.test(partialRun.stdout),
    JSON.stringify(partialRun.stdout.slice(0, 300)),
  );
  // A tree whose whole population is unreadable found PLENTY and read NONE, so
  // #4690's "the walk found nothing" would be a false sentence about it. The
  // two refusals are different answers with different remedies.
  const allAbsentRepo = fixtureRepo(holed);
  for (const rel of Object.keys(holed)) rmSync(join(allAbsentRepo, rel));
  const allAbsentRun = spawnSync(process.execPath, [SELF, '--root', allAbsentRepo], { encoding: 'utf8' });
  const allAbsentOut = `${allAbsentRun.stdout}${allAbsentRun.stderr}`;
  t(
    'a wholly unreadable population refuses AS UNREADABLE, not as empty',
    allAbsentRun.status === 1
      && /could not be read from disk/.test(allAbsentOut)
      && !/found no shell files/.test(allAbsentOut),
    allAbsentOut.slice(0, 400),
  );
  // ⭐ DARK. Everything above would pass just as well if the refusal fired on
  // every tree; these three are what say it does not.
  const completeRun = spawnSync(process.execPath, [SELF, '--root', completeRepo], { encoding: 'utf8' });
  const completeOut = `${completeRun.stdout}${completeRun.stderr}`;
  t(
    '⭐ DARK: the SAME fixture, complete on disk, stays GREEN',
    completeRun.status === 0,
    completeOut.slice(0, 400),
  );
  t(
    '⭐ DARK: …and reads ZERO unreadable paths, so the new report is not decoration',
    listPopulation(completeRepo).unreadable.length === 0,
    JSON.stringify(listPopulation(completeRepo).unreadable),
  );
  t(
    '⭐ DARK: …and its census is the FULL one the partial run shrank',
    /3 tracked shell file\(s\)/.test(completeRun.stdout) && /census: 2 by \.sh extension, 1 by shebang alone/.test(completeRun.stdout),
    completeRun.stdout,
  );

  // --- ⭐ the capability reading, pinned in BOTH directions (#17458) ---------
  //
  // The disposition every harness takes from `probeBashCapabilities()` branches
  // on a reading that a bash-4+ host can only ever produce ONE value of. Pin the
  // pure reader against transcripts instead, so the 3.2 branch — the branch that
  // only ever executes on the platform this gate defends — is verified on every
  // run, on every host, including the CI runner that can never take it.
  //
  // ⛔ These are fixtures of a REAL transcript shape: the probe's own output,
  // `BASH_VERSINFO` major.minor then one `<name> <type -t>` line per probed
  // builtin, with `type -t` printing nothing for a builtin that is not there.
  battery('⭐ the bash-4 capability reading, pinned in BOTH directions');
  const capsOf = (text, status = 0) => readBashCapabilities(text, status);
  const BASH52 = '5.2\nmapfile builtin\nreadarray builtin\n';
  const BASH32 = '3.2\nmapfile \nreadarray \n';
  const MANUFACTURED = '5.2\nmapfile \nreadarray \n';
  t('a bash 5.2 transcript reads as answered, 5.2, builtins present', (() => {
    const c = capsOf(BASH52);
    return c.answered && c.major === 5 && c.minor === 2 && c.builtins.mapfile === true;
  })());
  t("a bash 3.2 transcript — macOS's `/bin/bash`, unreachable from CI — reads as 3.2 with the builtin ABSENT", (() => {
    const c = capsOf(BASH32);
    return c.answered && c.major === 3 && c.builtins.mapfile === false && c.builtins.readarray === false;
  })());
  t('the two readings are INDEPENDENT: a manufactured floor is 5.2 with the builtin gone', (() => {
    const c = capsOf(MANUFACTURED);
    return c.answered && c.major === 5 && c.builtins.mapfile === false;
  })());
  t('a truncated transcript is a REFUSAL, never a permissive default (#4690)', capsOf('5.2\n').answered === false);
  t('an unreadable version line is a refusal too', capsOf('GNU bash, version 3.2.57\nmapfile \n').answered === false);
  t('a non-zero probe status is a refusal even when the output parses', capsOf(BASH52, 1).answered === false);
  const MAPFILE_BLOCK = "mapfile -t selftests < <(find .claude/hooks -type f -name '*.selftest.sh' | sort)\n";
  const ASSOC_BLOCK = 'declare -A seen\n';
  t(
    'a `mapfile` block is UNRUNNABLE against the 3.2 reading, and the finding names the line',
    (() => {
      const u = unsupportedConstructs('block.sh', MAPFILE_BLOCK, capsOf(BASH32));
      return u.length === 1 && u[0].id === 'mapfile' && u[0].line === 1;
    })(),
  );
  t(
    'the SAME block is runnable against the 5.2 reading — so nothing is skipped on CI',
    unsupportedConstructs('block.sh', MAPFILE_BLOCK, capsOf(BASH52)).length === 0,
  );
  t(
    'and it is unrunnable against the MANUFACTURED reading too, which is how this is provable off 3.2',
    unsupportedConstructs('block.sh', MAPFILE_BLOCK, capsOf(MANUFACTURED)).length === 1,
  );
  t(
    '`declare -A` is decided by the VERSION leg — `type -t declare` answers `builtin` on 3.2, so it cannot be probed',
    unsupportedConstructs('block.sh', ASSOC_BLOCK, capsOf(BASH32)).length === 1 &&
      unsupportedConstructs('block.sh', ASSOC_BLOCK, capsOf(BASH52)).length === 0 &&
      unsupportedConstructs('block.sh', ASSOC_BLOCK, capsOf(MANUFACTURED)).length === 0,
  );
  t(
    'E1 carries through: a full-line comment NAMING the builtin is not a reason to skip anything',
    unsupportedConstructs('block.sh', '# no mapfile in this block\n', capsOf(BASH32)).length === 0,
  );
  t('and an unread capability THROWS rather than guessing a disposition', (() => {
    try {
      unsupportedConstructs('block.sh', MAPFILE_BLOCK, capsOf('', 1));
      return false;
    } catch {
      return true;
    }
  })());

  // --- ⭐ the instrument is real: the flagged construct really does break ---
  //
  // R7a's shape, and for R7a's reason: without this the leg below could pass by
  // proving nothing. `BASH_ENV` is sourced by every non-interactive bash, so the
  // child inherits the disabling — measured BOTH ways on a probe first.
  //
  // ⭐ ON A HOST THAT IS ALREADY THE FLOOR, THE MANUFACTURE IS THE WRONG
  // INSTRUMENT, AND THE READING IS STRONGER WITHOUT IT (#17458).
  //
  // The claim this section owes the leg after it is ONE sentence: *the shell
  // the next leg measures really has no `mapfile`, and really does run shell
  // otherwise*. On bash 4+ the only way to establish that is to manufacture the
  // absence and read it BOTH ways — present before, gone after. On a host where
  // `mapfile` was never there, that before-probe is empty because the host is
  // bash 3.2, and the assertion written for the manufacture reports the floor
  // itself as a broken harness. That is the shape the gate defending the 3.2
  // floor failed on 3.2.
  //
  // ⛔ The repair is NOT to relax the assertion — an `||` admitting an empty
  // before-probe would also admit a harness that never ran, which is the #4690
  // reading this whole file refuses. The repair is that a native absence is a
  // DIFFERENT and better instrument, and is asserted as one: the shell is asked
  // for `mapfile` and refuses it BY NAME at status 127, and a positive control
  // written in 3.2-only shell runs to completion in the same interpreter — so
  // "the builtin is gone" is told apart from "nothing here runs", which is
  // exactly the discrimination the before-probe buys on bash 4+. The floor is
  // then not simulated at all; it is the host, which is the strongest reading
  // of the two and the one no CI runner can produce.
  battery('⭐ the instrument is real: the flagged construct really does break');
  const caps = probeBashCapabilities();
  t(
    'the host\'s bash capabilities were MEASURED, not assumed (a reading that failed is a refusal)',
    caps.answered === true,
    `caps=${JSON.stringify(caps)}`,
  );
  const simDir = mkdtempSync(join(tmpdir(), 'bash32-sim-'));
  const noBash4 = join(simDir, 'no-bash4-builtins.sh');
  writeFileSync(noBash4, 'enable -n mapfile readarray 2> /dev/null\n');
  const probe = join(simDir, 'probe.sh');
  writeFileSync(probe, 'mapfile -t x < /dev/null && echo MAPFILE-WORKS\n');
  // 3.2-only shell, and the control that separates "the builtin is gone" from
  // "this interpreter runs nothing". `while IFS= read -r` is the very
  // replacement the `mapfile` row points at, so a host that cannot run THIS is
  // a host on which the gate's own advice is wrong.
  const control = join(simDir, 'control.sh');
  writeFileSync(control, 'while IFS= read -r l; do :; done < /dev/null\necho CONTROL-SHELL-OK\n');
  const plain = spawnSync('bash', [probe], { encoding: 'utf8' });
  const sim = spawnSync('bash', [probe], { encoding: 'utf8', env: { ...process.env, BASH_ENV: noBash4 } });
  const nativelyAbsent = caps.answered && caps.builtins.mapfile === false;
  console.log(
    `    · instrument: ${nativelyAbsent ? 'NATIVE' : 'MANUFACTURED'} — bash ${caps.version ?? '(unreadable)'}, ` +
      `mapfile ${caps.builtins.mapfile === false ? 'absent' : 'present'} before `
      + `${nativelyAbsent ? 'anything is disabled' : '`enable -n`'}`,
  );
  if (nativelyAbsent) {
    const plainControl = spawnSync('bash', [control], { encoding: 'utf8' });
    t(
      'the host IS the floor: its own bash refuses `mapfile` BY NAME, so nothing has to be simulated',
      plain.status === 127 && /mapfile/.test(plain.stderr) && !plain.stdout.includes('MAPFILE-WORKS'),
      `status=${plain.status} out=${plain.stdout.trim()} err=${plain.stderr.trim()}`,
    );
    t(
      'and the positive control proves that is about the BUILTIN, not about a shell that runs nothing',
      plainControl.status === 0 && plainControl.stdout.includes('CONTROL-SHELL-OK'),
      `status=${plainControl.status} out=${plainControl.stdout.trim()} err=${plainControl.stderr.trim()}`,
    );
    t(
      'and `enable -n` over a builtin that is already gone changes nothing, so the next leg reads the same shell',
      !sim.stdout.includes('MAPFILE-WORKS') && /mapfile/.test(sim.stderr),
      `sim.out=${sim.stdout.trim()} sim.err=${sim.stderr.trim()}`,
    );
  } else {
    t(
      'the simulated-3.2 harness really removes the builtin (else the next leg proves nothing)',
      plain.stdout.includes('MAPFILE-WORKS') && !sim.stdout.includes('MAPFILE-WORKS') && /mapfile/.test(sim.stderr),
      `plain=${plain.stdout.trim()} sim.out=${sim.stdout.trim()} sim.err=${sim.stderr.trim()}`,
    );
  }
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

  for (const d of [badRepo, cleanRepo, emptyRepo, completeRepo, partialRepo, allAbsentRepo, simDir]) {
    rmSync(d, { recursive: true, force: true });
  }

  // --- the real tree -------------------------------------------------------
  battery('the real tree');
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
  console.log(`\n✓ check-bash32-floor self-test: ${cases} cases pass.`);
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

  const { findings, population, byExtension, byShebang, unreadable } = scanTree(root);

  // ⛔ Ordered BEFORE the empty-population refusal, deliberately: when every
  // indexed path is unreadable the population is empty too, and #4690's message
  // — "the walk found nothing" — would then be false. The walk found plenty and
  // read none. Two different answers, two different remedies (#18465).
  if (unreadable.length > 0) {
    reportUnreadable(unreadable, population, findings);
    if (findings.length > 0) report(findings);
    process.exit(1);
  }

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
