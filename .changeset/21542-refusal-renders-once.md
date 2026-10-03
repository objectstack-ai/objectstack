---
'@objectstack/cli': patch
---

fix(cli): `os init` and `os compile` render each refusal once, not once on stdout and again as oclif's `Error:` block on stderr (#21542)

Clause-②: no

`os init demo -t bogus` printed `✗ Unknown template: bogus` on stdout, then the same sentence as oclif's `Error:` block on stderr, and exited 2. Ten refusals did it: the five `os init` makes before it writes anything (an unknown template, a project name that is not valid, a target directory that is not empty, a current directory whose name is not a valid project name, an `objectstack.config.ts` that already exists), its scaffold self-test and dependency install, its catch-all, and `os compile`'s runtime-bundle refusal and catch-all (`os build` inherits both). Each printed its own `✗` line and then handed the sentence to `this.error`, which has oclif's entry point render it again.

Each now prints its `✗` line and the hint under it once, and ends in `this.exit(2)`: the status `this.error` raised, with nothing rendered by the entry point. Stdout carries the same lines as before; stderr no longer repeats them. Exit statuses are unchanged: 2 for all ten.

A script that read the sentence from stderr, from the `Error:` block, now finds it on stdout, on the `✗` line, which is where the full wording and the hint always were.
