---
"@objectstack/cli": minor
---

feat(cli): `os g skill NAME` scaffolds an AI skill, and writes it as `NAME.skill.ts` so the loader can find it (#11025)

Completes the second half of the ADR-0063 Option A ruling whose first half
retired `os g agent` (#10359). That retirement left authors told to write
`src/skills/NAME.skill.ts` by hand because no scaffolder existed; this adds it,
and `os g agent`'s refusal, the CLI README and the CLI docs now name the
command instead of apologising for its absence.

The filename is the point, not a detail. `DEFAULT_METADATA_TYPE_REGISTRY`
declares `skill`'s file convention as `*.skill.ts` / `*.skill.yml`, while this
harness has always written `NAME.ts`. `skill` is `allowRuntimeCreate: true` —
a type the platform expects to discover — so a scaffold matching no pattern
would type-check, validate and publish with nothing anywhere reporting that it
had been skipped: the silent-strip shape the `agent` retirement closed,
re-entering through the scaffolder that replaced it. `skill` therefore
overrides the harness filename through a new per-generator hook, and the
barrel re-export is derived from the file that was actually written rather
than rebuilt from the metadata name.

**The other six generators are unchanged** and still write `NAME.ts` with a
`'./NAME'` barrel line, pinned by a control assertion in the new test.
Converging the whole scaffolder on the registry's `NAME.TYPE.ts` convention —
the shape the example apps already author in — moves every generator's output
plus the docs and examples that show it, and is deliberately left as its own
decision.

Three authoring choices the template makes, each written into the generated
file so the next author inherits the reasoning and not just the value:
`tools: []`, because under ADR-0064 an agent's tool set is the union of its
skills' tools with no global fall-through, so an empty list grants nothing
while a placeholder name would resolve to nothing and be reported by
`os validate` as `ai-skill-tool-unresolved`; `surface: 'ask'` written out
rather than left to the schema default, because the affinity it declares is
enforced at load and a default taken in silence is invisible to whoever edits
the file next; and `defineSkill` rather than a bare typed literal, so the
object is parsed at module load. The template is **not** copied from
`SkillSchema`'s or `defineSkill`'s `@example` blocks — both pass
`triggerPhrases`, a retired-key tombstone that rejects on parse (#11026).
