---
'@objectstack/cli': patch
---

The published `package.json` no longer declares `oclif.plugins`, and the package no longer lists `@oclif/plugin-help` or `@oclif/plugin-plugins` as devDependencies. The array named both plugins, but they were only devDependencies, and oclif loads an `oclif.plugins` entry only when the same name is in `dependencies`. Neither plugin ever loaded.

Clause-②: no

**What changes for an operator.** Nothing. `os --help`, every command and topic, and the output of `os help` and `os plugins` read byte-identical before and after the change. `os help` and `os plugins …` were never commands, and each still exits 2 with `command … not found`. Use `os --help` or `os <command> --help` for help.

**What the README now says.** It said `os plugins install`, `uninstall` and `update` came from `@oclif/plugin-plugins` and installed CLI extensions. That was never true. This CLI ships no plugin manager. To add commands to it, build an `os` distribution: a package whose own `package.json` lists the extension in both `oclif.plugins` and `dependencies`.
