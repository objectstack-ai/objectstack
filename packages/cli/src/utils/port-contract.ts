// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE port contract this CLI has: the range a real `listen()` accepts, the
 * reader that turns operator text into a port, and the prose every door refuses
 * in (#12673).
 *
 * ## Why this is a module and not three copies
 *
 * `os dev`, `os start` and `os serve` all take a port, and the first two spawn
 * the third. Before this module only `serve` validated, so a value typed at
 * `dev` or `start` was refused one process later, by the child, under the name
 * of the CHANNEL it arrived on rather than the spelling the operator used:
 * `PORT=abc os dev` was refused as `--port "abc"`, and `os start --port 99999`
 * as `PORT="99999"`. Both are accurate about what the child could see and wrong
 * about what the operator did.
 *
 * The repair the maintainer ruled for (2026-08-28, option 甲) is a single source
 * all three doors import, NOT a second copy of the bound at each entry point —
 * #12620 and #12662 both went out of their way to avoid that copy, and this
 * module is the front of that judgement rather than its reverse. {@link MIN_PORT}
 * and {@link MAX_PORT} are declared here and nowhere else in the repository;
 * `port-contract-single-source.test.ts` fails if a second declaration appears.
 *
 * ## ⛔ What a door may NOT do: narrow the accept set
 *
 * Every function below keeps the reader it had in `serve` — `parseInt`, with all
 * of its tolerance. Moving the refusal earlier must not change WHICH values
 * boot, and the tolerance is wider than any intuition about ports: ` 3000`,
 * `3000 `, `+3000`, `08080`, `3e3`, `0x0BB8`, `3000.0`, `3000abc` and `0b111`
 * all boot a server today (measured through the three real commands, before and
 * after this change). A door that reached for a strict-decimal regex would
 * refuse six of them.
 *
 * ## ⚠️ Why the doors call this module EXPLICITLY, before spawning
 *
 * Not from an oclif flag `parse`, and not from `Flags.integer({ min, max })`.
 * MEASURED against this checkout's `@oclif/core` 4.13.3 — see
 * {@link describePortSource} for the runtime probe and its numbers — a flag's
 * `parse` never runs over that flag's `default`, and `Flags.integer`'s
 * `min`/`max` never runs over one either. `serve` reads `$OS_PORT`/`$PORT`
 * through exactly such a `default`, so a validator hung on the flag layer is
 * inert on two of the three channels this contract has to name. The ruling
 * grants the fallback and this module is it: an explicit pre-spawn call.
 */
import chalk from 'chalk';

/**
 * The port values a real `listen()` accepts — MEASURED here, not copied from
 * the kernel's error text (#12662).
 *
 * Measured in this checkout (Node v22.22.2), `net.createServer().listen(v)`:
 *
 * ```
 *   listen(0)      → OK, bound 43025   ← kernel-assigned: 0 is a REQUEST, not an error
 *   listen(65535)  → OK, bound 65535
 *   listen(65536)  → ERR_SOCKET_BAD_PORT: options.port should be >= 0 and < 65536
 *   listen(-1)     → ERR_SOCKET_BAD_PORT
 *   listen(NaN)    → ERR_SOCKET_BAD_PORT
 *   listen(3000.5) → ERR_SOCKET_BAD_PORT
 * ```
 *
 * ⚠️ Two traps, and both are why these numbers are measured rather than read
 * off the message. **`0` is legal** — a floor of `1` would refuse a value that
 * boots today (`os serve --port 0` binds a kernel-assigned port). And the
 * ceiling is **65535, not 65536**: the kernel's own sentence says `< 65536`,
 * an exclusive bound, one past the largest port that binds.
 *
 * ⛔ Never hand-write either number anywhere else. The refusal in
 * {@link formatInvalidPortNotice} reads both from here — the rule
 * `PORT_SEARCH_SPAN` already carries in `commands/serve.ts` (#12620), for the same
 * reason: a range a diagnostic STATES has to be the range the code ENFORCES,
 * or the diagnostic becomes the next defect.
 */
export const MIN_PORT = 0;
export const MAX_PORT = 65535;

/**
 * Which input actually supplied the port text.
 *
 * ⭐ This type exists because of what the defect WAS. An operator who typed
 * `--port abc` got back `ERR_SOCKET_BAD_PORT … options.port …` — an error
 * naming an internal option, thrown from a code path with no connection to the
 * thing they typed. A refusal that said only "invalid port" would commit the
 * same defect one level up, so the refusal names the source, and this is the
 * vocabulary it names it from.
 */
export type PortInputSource = '--port' | 'OS_PORT' | 'PORT' | 'the built-in default';

/**
 * Name the input that supplied the port text.
 *
 * `setFromDefault` is oclif's own parse metadata: `false` when the value came
 * from argv, `true` when the flag's `default` supplied it. It is the ONLY
 * signal that separates `--port` from the environment here, because
 * `PORT`/`OS_PORT` never reach flag parsing at all — they are read by the
 * `default` expression on the flag. MEASURED against this checkout's
 * `@oclif/core` (4.13.3), both in `lib/parser/parse.js` and at runtime: the
 * default branch's value function is `async () => flag.default`, and unlike
 * the argv and `flag.env` branches it never calls `parseFlagOrThrowError`. A
 * flag's own `parse` therefore cannot see a default, which is exactly why the
 * validation this function feeds lives at the consumer instead of on the flag.
 *
 * ⚠️ RE-MEASURED for #12673 against the same `@oclif/core` 4.13.3, by driving
 * `Parser.parse` directly. Two results, and the second closes off the cheap
 * repair the issue asked about:
 *
 * ```
 *   string  flag, value from argv              → parse RAN
 *   string  flag, value from `default`         → parse did NOT run
 *   string  flag, `default` is a FUNCTION
 *              reading process.env             → parse did NOT run   ← serve's shape
 *   string  flag, value from the `env:` option → parse RAN
 *   integer flag {min:0,max:65535} argv 99999     → REFUSED
 *   integer flag {min:0,max:65535} default 99999  → ACCEPTED, value 99999
 *   integer flag {min:0,max:65535} `env:` 99999   → REFUSED
 * ```
 *
 * So `Flags.integer({ min, max })` is inert over a `default` too, not merely
 * `parse`: a bound declared on the flag would guard `--port` and leave both
 * environment channels exactly as they were. And oclif's own `env:` OPTION is a
 * DIFFERENT channel from a `default` that happens to read `process.env` — the
 * first is validated, the second is not, and no command in this CLI uses the
 * first. That asymmetry is why every door calls this module explicitly, before
 * spawning, rather than hanging a validator on its flag.
 *
 * ⚠️ `dev`'s port flag carries no oclif `default` at all, so `dev` passes
 * `flags.port === undefined` for `setFromDefault` — the same question ("did
 * this value come from argv?") asked of a flag that answers it differently.
 *
 * ⚠️ The env half MIRRORS `readEnvWithDeprecation('OS_PORT', 'PORT')`'s
 * precedence, and a mirror can drift from what it mirrors. It is pinned rather
 * than trusted: `serve-port-validation.test.ts` asserts the two agree for every
 * combination of the two variables — including `OS_PORT=''`, which is DEFINED
 * and therefore wins. That case is why the test below is `!== undefined` and
 * not a truthiness check: an `||` slip here would name `PORT` for a value that
 * came from `OS_PORT`.
 */
export function describePortSource(
  setFromDefault: boolean,
  env: { OS_PORT?: string; PORT?: string } = process.env,
): PortInputSource {
  if (!setFromDefault) return '--port';
  if (env.OS_PORT !== undefined) return 'OS_PORT';
  if (env.PORT !== undefined) return 'PORT';
  return 'the built-in default';
}

/**
 * The port `flags.port` names, or `null` when that text cannot be a port.
 *
 * ## What this refuses, and why it is exactly that set
 *
 * `null` for precisely the values a real `listen()` refuses: `NaN`, anything
 * below {@link MIN_PORT}, anything above {@link MAX_PORT}. Those are the
 * inputs that used to travel all the way to the socket layer and die there on
 * `ERR_SOCKET_BAD_PORT`, naming `options.port` instead of the flag or the
 * environment variable the operator actually set.
 *
 * ## ⛔ `parseInt`'s tolerance is PRESERVED, and that is deliberate
 *
 * The obvious repair is a validating `Flags.integer({ min, max })`, whose
 * parser is `/^-?\d+$/`. It was measured and NOT taken, for two reasons:
 *
 *  1. It cannot see the environment. `PORT`/`OS_PORT` arrive through the
 *     flag's `default`, and oclif never runs a flag's `parse` on a default
 *     (measured above, in {@link describePortSource}) — so an integer flag
 *     fixes `--port abc` and leaves `PORT=abc` and `OS_PORT=abc`, two of the
 *     three reported paths, dying exactly as before.
 *  2. It would NARROW what boots. `/^-?\d+$/` refuses `" 3000"` (production
 *     env vars carry whitespace), `"3000.0"`, `"0x0BB8"`, `"+3000"` and
 *     `"3e3"` — every one of which `parseInt` accepts and every one of which
 *     boots a server today.
 *
 * So this function keeps `parseInt` as the reader and adds only the refusal.
 * The accept set is therefore UNCHANGED: every value that boots today still
 * boots, byte for byte, on the same port. What changes is only that the values
 * which used to reach `listen()` and die raw are now refused here, in the
 * operator's own vocabulary, before any socket exists.
 *
 * ⚠️ `parseInt`'s tolerance also means `--port 3e3` binds port **3**, not
 * 3000, and this function preserves that too — a silent coercion, and a
 * separate defect from the one this card repairs. It is filed rather than
 * fixed here: tightening the accepted spelling would narrow the accept set,
 * which is a contract question and not this card's to answer.
 */
export function parseRequestedPort(raw: string): number | null {
  const parsed = parseInt(raw);
  // `parseInt` yields an integer or `NaN`; `Number.isInteger` refuses the
  // second. This is the `--port abc` / `PORT=abc` / `OS_PORT=abc` path, and
  // also `PORT=''` — an env var that is DEFINED but empty, which
  // `readEnvWithDeprecation` returns as `''` rather than falling back to 3000.
  if (!Number.isInteger(parsed)) return null;
  // And the numerically-fine-but-unbindable path: `--port 99999`, `--port -1`.
  if (parsed < MIN_PORT || parsed > MAX_PORT) return null;
  return parsed;
}

/**
 * Spell a port input the way the operator set it: `--port "3e3"`, `PORT="3e3"`,
 * `OS_PORT="3e3"`, or `the built-in default ("3000")`.
 *
 * ⭐ ONE spelling of one fact. Both notices that name the input read it from
 * here — {@link formatInvalidPortNotice} (#12662) and
 * {@link portTextReadNotice} (#12674) — which is the rule
 * `PORT_SEARCH_SPAN`'s docblock in `commands/serve.ts` established for numbers, applied to
 * prose. Two hand-written copies of "how this input is written back" are two
 * things free to drift, and an operator who cannot recognise what they typed is
 * the defect both notices exist to fix.
 *
 * ⚠️ `JSON.stringify` is not decoration. It makes `" 3000"` distinguishable
 * from `"3000"` on the screen — whitespace is the likeliest thing an operator
 * is staring at without seeing — and it escapes control bytes instead of
 * writing them to a terminal.
 */
function spellPortInput(raw: string, source: PortInputSource): string {
  const shown = JSON.stringify(raw);
  return source === '--port'
    ? `--port ${shown}`
    : source === 'the built-in default'
      ? `the built-in default (${shown})`
      : `${source}=${shown}`;
}

/**
 * The refusal for a port value that cannot be one (#12662).
 *
 * ⭐ Held to the standard the card is about. Two things it must do that the
 * error it replaces did not:
 *
 *  - **Name the source the operator actually used.** `--port`, `PORT` or
 *    `OS_PORT` — decided by {@link describePortSource}, not guessed here.
 *  - **State the range, read from {@link MIN_PORT}/{@link MAX_PORT}.** ⛔ Never
 *    a second, hand-written copy of those numbers: this sentence exists to be
 *    accurate about the bounds the code enforces, so it interpolates them.
 *
 * ⚠️ The source spelling is {@link spellPortInput}'s, shared with #12674's
 * read notice so that one input is named one way — `JSON.stringify` rendering
 * included, which is not decoration: it makes `" 3000"` distinguishable from
 * `"3000"` on the screen and escapes control bytes rather than writing them to
 * a terminal.
 *
 * ⭐ The limit this used to carry is CLOSED, and how it was closed is the whole
 * of #12673. `os dev` forwards its port to the `serve` child as `--port <text>`
 * on argv and `os start` forwards its own as `PORT` in the child's environment,
 * so on a spawn the child can only ever name the CHANNEL — measured before the
 * repair: `PORT=abc os dev` was refused as `--port "abc"`, `OS_PORT=abc os dev`
 * as `--port "abc"`, and `os start --port 99999` as `PORT="99999"`. The repair
 * is not to teach the child about its parents. Each parent now calls this same
 * function at its own door, with its own {@link describePortSource} reading,
 * BEFORE it spawns anything — so an input that would have been renamed on the
 * way down is refused before the rename can happen, and this function keeps
 * naming exactly what the process it runs in can see.
 *
 * CHANNEL — the same `printDiagnostic` (stderr) as its two siblings, for the
 * reason #7915 measured: `stdout` carries JSON-RPC frames whenever the stdio
 * MCP transport is mounted, where one non-frame line reaches a conforming
 * client as a transport error.
 */
export function formatInvalidPortNotice(raw: string, source: PortInputSource): string {
  const spelled = spellPortInput(raw, source);
  const fix = source === '--port' || source === 'the built-in default'
    ? '     Pass a whole number instead, for example --port 3000.'
    : `     Correct ${source} in this process's environment (for example ${source}=3000),\n`
      + '     or override it with --port 3000.';

  return (
    '\n'
    + chalk.red(`  ✗ Invalid port: ${spelled}\n`)
    + chalk.dim(`     A port must be a whole number from ${MIN_PORT} to ${MAX_PORT} — ${MIN_PORT} is legal, and\n`)
    + chalk.dim('     asks the kernel for any free port. Nothing was started, and no socket\n')
    + chalk.dim('     was opened.\n')
    + chalk.dim(fix)
  );
}

/**
 * The port the TEXT says, on a strict reading — or `null` when the text does
 * not say a port at all.
 *
 * ## This boundary IS the card (#12674)
 *
 * {@link parseRequestedPort} keeps `parseInt`, deliberately: #12662's ruling is
 * that no value which boots today may be refused, and a tightening would narrow
 * a published CLI's accepted input. But `parseInt`'s tolerance changes the
 * ANSWER, not merely the spelling — `--port 3e3` binds port **3**, `--port
 * 0x0BB8` binds 3000, `--port 3000abc` binds 3000. The server comes up on a
 * port the operator never named and nothing says so. ⭐ That silence, not the
 * tolerance, is what is repaired here.
 *
 * So the notice fires on a DIFFERENCE, which makes the definition of "the same"
 * the whole precision of this card. MEASURED on this checkout (Node v22.22.2):
 *
 * ```
 *   " 3000" → 3000   "+3000" → 3000   "08080" → 8080   ← says what it selected
 *   "3000 " → 3000   "3000"  → 3000
 *   "3e3"   → 3      "0x0BB8" → 3000  "3000.0" → 3000  ← does NOT
 *   "1e10"  → 1      "0b111"  → 0     "3000abc" → 3000
 * ```
 *
 *  - **Whitespace is not a difference.** `" 3000"` reads as 3000 to a human and
 *    to `parseInt` alike, and production `PORT` values carry whitespace. A
 *    boundary that counted it would drone a notice on every boot of the most
 *    ordinary deployment there is — noise on the one input shape that is both
 *    common and harmless. ⭐ This half of the line is why it is drawn on the
 *    TRIMMED text.
 *  - **A leading `+` is not a difference**, and **leading zeros are not**:
 *    `"+3000"` says 3000, `"08080"` says 8080 (`parseInt` has read no leading
 *    zero as octal since ES5 — measured above, not assumed).
 *  - **Everything else IS**, because it means the port was not read off the
 *    digits: an exponent, a radix prefix, a fraction, a separator, or trailing
 *    text.
 *
 * ⛔ Nothing here refuses anything. The accept set stays EXACTLY
 * {@link parseRequestedPort}'s. Whether the CLI should take only strict decimal
 * text is a contract question, left open on purpose (#12674), and #12673 is
 * blocked on the same one.
 *
 * ⛔ Not `Number()`, which is the near-miss worth naming: it AGREES with
 * `parseInt` on `"0x0BB8"` (both 3000, measured), so a boundary built on it
 * would be blind to a hex literal — one of the two coercions this exists to
 * see. It disagrees on `"3e3"` (3000 vs 3), which is the other one.
 */
export function strictPortReading(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isInteger(value) ? value : null;
}

/**
 * The notice for a port that was read as something other than what it says
 * (#12674) — or `null` when the text and the port agree.
 *
 * ## ⭐ The DECISION lives in here, not at the call site
 *
 * A notice printed unconditionally satisfies every assertion that only checks
 * what a mismatch prints. Returning `null` for the agreeing case puts that arm
 * where a test can drive it directly, at the same seam, with no source at all:
 * `portTextReadNotice(' 3000', 'PORT', 3000)` is `null` or this is broken. The
 * call site is then one `if`, and the three-way split it completes is:
 * mismatch → this notice; agreement → nothing; a value that cannot be a port
 * at all → {@link formatInvalidPortNotice}'s refusal, which exits before this
 * function is ever reached.
 *
 * ## What it states — and the second reading it must NOT invent
 *
 * Two facts, both of which the operator lacks: the text they set, and the port
 * it selected. ⛔ Never a third — the number they MEANT. `3e3` looks like 3000
 * to a reader, but `3000abc` and `0b111` have no such second reading, and a
 * diagnostic that guessed would be wrong the first time it met one. It reports
 * that the text does not say the selected port, and stops there.
 *
 * ⚠️ It says "asked for", not "bound": in development the auto-shift below
 * may still move off this port, and #12543's drift notice — which prints just
 * after this one — owns that fact. Two notices, two facts, neither restating
 * the other.
 *
 * ## ⚠️ The source it names on a spawn — still the CHILD's, deliberately
 *
 * `os dev` reads `flags.port ?? readEnvWithDeprecation('OS_PORT', 'PORT')` and
 * forwards the result to the `serve` child as `--port <text>` on argv
 * (`commands/dev.ts`), so `PORT=3e3 os dev` reaches this function as
 * `--port "3e3"` and this notice names `--port`. That is not the defect #12673
 * repaired, and it is not repaired here either: the REFUSAL was moved to the
 * parents (see {@link formatInvalidPortNotice}) because a refusal must name
 * what the operator can act on, while this notice's two facts — the text and
 * the port it selected — are true of the value in the child's own hands and
 * remain right whichever spelling delivered it. ⛔ Do not "fix" the label by
 * teaching the child about its parents: that is option 乙 from the #12673
 * design, and it was rejected for adding an invisible inter-process protocol
 * that fails silently when a future author forgets to pass it.
 *
 * `os start` normalises before forwarding — its `--port` is a `Flags.integer`
 * (parser `/^-?\d+$/` in `@oclif/core` 4.13.3), so the child receives
 * `PORT=8080` for an `--port 08080`, and a spelling this notice fires on can
 * only reach it through the environment, under its own name.
 *
 * CHANNEL — the same `printDiagnostic` (stderr) as its three siblings, for the
 * reason #7915 measured: `stdout` carries JSON-RPC frames whenever the stdio
 * MCP transport is mounted, where one non-frame line reaches a conforming
 * client as a transport error. `serve-stdio-stdout-purity.e2e.test.ts` pins it.
 */
export function portTextReadNotice(
  raw: string,
  source: PortInputSource,
  port: number,
): string | null {
  if (strictPortReading(raw) === port) return null;

  const spelled = spellPortInput(raw, source);
  const fix = source === '--port' || source === 'the built-in default'
    ? '     If that is not the port you meant, write it as a plain decimal number\n'
      + '     (for example --port 3000).'
    : `     If that is not the port you meant, correct ${source} in this process's\n`
      + `     environment (for example ${source}=3000), or override it with --port 3000.`;

  return (
    '\n'
    + chalk.yellow(`  ⚠ ${spelled} was read as port ${port}.\n`)
    + chalk.dim('     That text is not a plain decimal number, and the reader that accepts it\n')
    + chalk.dim('     is tolerant: it honours a leading 0x as hexadecimal and discards\n')
    + chalk.dim('     everything from the first character that cannot continue the number.\n')
    + chalk.dim(`     Nothing downstream reads it again — ${port} is the port this server asked\n`)
    + chalk.dim('     for, whatever the text looks like.\n')
    + chalk.dim(fix)
  );
}
