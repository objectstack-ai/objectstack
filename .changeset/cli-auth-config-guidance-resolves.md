---
"@objectstack/cli": patch
---

fix(cli): the "no stored credentials" error stops telling a stuck user to run `os auth login` (#11313)

`readAuthConfig()` (`packages/cli/src/utils/auth-config.ts`) throws the one instruction a user
gets at the moment they are **already stuck**: they have no stored credentials, the command
they wanted has just failed, and this string is what tells them how to recover. It said
`os auth login`, which does not resolve — `login.ts` sits at the **root** of
`packages/cli/src/commands/`, so oclif's pattern-strategy loader registers it as `login`, and
no `auth` topic has ever existed. The second failure reads as "the tool is broken", not as
"a typo in a help string", which is why this is graded on its own terms rather than as another
stale-`examples` docs nit (#11221, #10967, #10927 were all `examples` arrays and README prose
— a user reading *ahead*).

Measured against the built CLI (`packages/cli/bin/run.js`, after building the package and its
dependency closure) before the fix: `os auth login --help` → `Error: Command auth:login not
found.` (exit 2), `os login --help` → exit 0. Loading the built oclif `Config` enumerates 61
registered ids, **zero** containing `auth`, and no `auth` topic — with `login`, `logout`,
`register`, `whoami`, `dev` and `serve` all present as the control that the zero is a real
absence rather than a broken probe. The message now says `os login`, the spelling `login.ts`'s
own `examples` already used.

One further invocation in the same file is corrected in the same pass:
`AuthConfig.activeEnvironmentId`'s doc comment said `os projects switch`, and `projects` was
renamed to `environments` in v5.0 with no aliases (ADR-0006) — the same enumeration shows no
`projects` topic and no id containing `project`, while `environments switch` is registered. It
is fixed rather than excluded because the new pin scans the whole file, and an exclusion is how
a line stops being checked without anyone deciding to stop checking it.

The pin (`packages/cli/src/utils/auth-config.test.ts`) asserts the **property**, not the new
spelling: every command invocation this file documents must resolve to an id the CLI actually
registers, with the id set re-derived from `src/commands/**` using oclif's own path→id
algorithm. A pin on the literal text `os login` would still pass on the day someone renames
`login.ts`; this one reds. It has two legs — the real `readAuthConfig()` driven into its real
ENOENT branch against a redirected `$HOME`, so what is checked is the message a user actually
reads, and a source-wide scan so a guidance string added to this file later is held to the same
property without anyone remembering to extend the pin. `environments.test.ts`'s `#10967` pin
reads `static override examples` via AST and structurally cannot see a thrown-error string,
which is why this class needed its own pin rather than an extension of that one.
