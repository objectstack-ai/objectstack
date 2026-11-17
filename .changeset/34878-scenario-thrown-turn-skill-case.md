---
'@objectstack/scenarios': patch
---

fix(scenarios): a live turn that throws is recorded and replays as the same failure, and a skill file spelled otherwise than `SKILL.md` is refused by name

Clause-②: no
Metadata-protocol: none

- **A thrown turn is recorded.** When a live question, dataset question, operation, confirmation or authoring turn threw, the recording held nothing for it, so a replay met a missing turn. A dataset question or a confirmation turn reads a missing turn as not measured, so a row that showed 4/5 live could show 4/4 on replay. The recording now holds such a turn as an empty turn with `thrown: { name, message }`, and the live error is still thrown exactly as before. A replay throws an error with the same name and message again, writes no recorded file and re-sends no write, so the runner counts it exactly as it counted the live throw. A recording made before this change has no such turns and replays exactly as it did. A throw that is itself a replay's verdict (a missing or unfaithful recorded turn, when a replay is recorded) is still left unrecorded.
- **`--ask-skills` matches the skill file by its exact spelling.** The runner checked for `SKILL.md` with `existsSync`, which a case-insensitive filesystem answers true for `skill.md`. The run then crashed with `Cannot read properties of undefined (reading 'toString')`, and on a case-sensitive filesystem the skill was skipped without a word. The directory listing now decides. A skill directory whose file is spelled `skill.md`, `Skill.md` or any other case of `SKILL.md` is refused before any turn runs, with a sentence that names the file found and says to rename it to `SKILL.md`. This happens on every filesystem.
