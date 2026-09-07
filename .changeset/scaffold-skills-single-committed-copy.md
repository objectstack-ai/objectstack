---
"create-objectstack": minor
---

Scaffolded projects now install the AI skills bundle for **one** agent runtime
instead of every runtime the skills CLI knows, so the bundle is committed once.

**Route B of the two the card offered was taken**, and the choice was measured
rather than argued. Against `skills@1.5.23` and the 11-skill catalog, the old
`--all` (shorthand for `--skill '*' --agent '*' -y`) wrote the same bundle to
three destinations — `.agents/` (46 real files, 604,102 B), `agent/` (46 real
files, 602,682 B, identical bodies with re-serialised frontmatter) and
`.claude/` (11 symlinks into `.agents/`). The template's `.gitignore` excluded
none of it, so a new project's first `git add -A` staged 22 `SKILL.md` paths
plus 11 symlinks. That reached the initial commit of a real app before anyone
noticed.

The scaffolder now runs
`npx skills add objectstack-ai/objectstack/skills --skill '*' --agent claude-code -y`,
which writes 46 real files to `.claude/skills/` and nothing else: 11 staged
`SKILL.md` paths, no symlinks, and a clone of that commit has readable skill
files on every platform.

Route A (keep `--all`, exclude the duplicates in the template `_gitignore`) was
built and cloned, not reasoned about, and both of its shapes were rejected.
Ignoring `.agents/` and `agent/` while committing `.claude/` gives a fresh
cloner 11 dangling symlinks and zero readable `SKILL.md`. Ignoring only
`agent/` works on POSIX but commits 11 symlinks that a `core.symlinks=false`
clone — git-for-Windows' default — materialises as ordinary files whose whole
content is the link target. `--all --copy`, the other way to make `.claude/`
real, fans out to 56 destination directories totalling 33.8 MB. A denylist is
also the wrong shape regardless of which paths it names: this package does not
choose the destination set, the skills CLI does, and it moves with that
package's releases.

The cost is the multi-runtime default, and it is paid in the open: the closing
summary now always prints an **AI Skills** block naming where the bundle landed
and the one-line command for any other runtime, one agent at a time. The
bundle is identical whichever agent is named.

Existing projects are unaffected. To shrink one that already carries the
triplicate, delete `.agents/` and `agent/` and re-run the single-agent command
above; `skills-lock.json` records source and hash, not paths, so it does not
change.
