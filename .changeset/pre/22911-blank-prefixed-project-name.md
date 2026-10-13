---
"create-objectstack": patch
---

fix(create-objectstack): a project name that starts with the template's namespace scaffolds instead of being refused

Clause-②: no

A project whose namespace begins with the template's own namespace plus `_` (for example `blank-probe`, namespace `blank_probe`, under the `blank` template) was refused with exit 1: "1 object name(s) still carry the template's 'blank_' prefix … This is a bug in the scaffolder". The rewrite was correct (`blank_note` became `blank_probe_note`), but the check that verifies it tested each name against the template prefix alone, and `blank_probe_note` starts with `blank_`.

- The check now reports a name as stale only when it carries the template's prefix and not the new namespace's prefix, so `blank-probe` scaffolds with objects named `blank_probe_*`.
- A name the rewrite really missed (`blank_note` under namespace `blank_probe`) is still refused, as before.
- The same rule applies to every template namespace; no name is treated specially.
- No migration: a project that scaffolded before this release is unaffected, and a name that was refused before can be scaffolded again.
