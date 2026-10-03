---
'@objectstack/cli': patch
---

fix(cli): `os init` prints its dependency-install and scaffold-validation refusals once (#21523)

Clause-②: no

`os init demo -p npm` with an unreachable package registry printed `✗ Project scaffolded, but dependency installation failed.`, then a second `✗ Dependency installation failed`, then oclif's `Error: Dependency installation failed`, and exited 2. The second `✗` line came from the command's outer `catch`: the `this.error(…)` inside its `try` throws oclif's exit signal, and the `catch` reported it again. A scaffold that failed its own validation got a second `✗ Scaffold validation failed` line under its refusal the same way.

The `catch` now lets the signal through. Each refusal prints its `✗` line once, followed by oclif's `Error:` line as before, and the exit status is still 2.
