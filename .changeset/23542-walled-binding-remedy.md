---
'@objectstack/cli': patch
---

fix(cli): under a wall, `os migrate organization-ownership --apply` names the act that clears a position binding the rewrite gate refuses, instead of pointing at a step that reports done (#23542)

Clause-②: no

**What changed.** Under the `group` or `isolated` posture, no ceremony step carries `sys_position_permission_set` rows into a position definition. `authored-conversion` reports and finishes before it reads a binding (ADR-0131 D3). The rewrite gate still refused those rows, rightly, but its remedy sent the operator to `authored-conversion`, which had already reported `done` with no blocker. The gate still refuses, and nothing is deleted or guessed. Only the remedy changes, and it now depends on where the position's definition lives.

The blocker's first sentence is unchanged: "Binding rows give position NAME sets its catalog definition does not name (SETS); deleting them would lose a grant." The sentence after it changes, under a wall only:

- **A position no catalog declares.**
  - FROM: "The authored-conversion step carries them; resolve its blocker, then re-run."
  - TO: "Under the POSTURE posture no ceremony step carries binding rows (ADR-0131 D3). Declare the position NAME with permissionSets naming SETS, through one door only: the deployment's code (compiled into the artifact this ceremony boots), or the metadata door as the platform administrator (PUT /api/v1/meta/position/NAME). A cold boot refuses a position name a package declares and the environment catalog also holds. Then re-run."
- **A declared position the metadata door reports editable, whose definition lacks some of the bound sets.**
  - FROM: the same pointer.
  - TO: "Under the POSTURE posture no ceremony step carries binding rows (ADR-0131 D3). Add MISSING to the permissionSets of the position NAME through the metadata door as the platform administrator (PUT /api/v1/meta/position/NAME), then re-run."
- **A declared position the metadata door reports not editable.** A definition a package ships is sealed (ADR-0131 D6), so no door on the database adds the sets. The text states the fact and names no act.
  - FROM: the same pointer.
  - TO, when the definition's provenance names the package: "Under the POSTURE posture no ceremony step carries binding rows (ADR-0131 D3). Package PACKAGE ships the definition of NAME, which is sealed (ADR-0131 D6: the metadata door reports it not editable, lock LOCK), so no door on this database adds those sets."
  - TO, otherwise: "Under the POSTURE posture no ceremony step carries binding rows (ADR-0131 D3). The metadata door reports the definition of NAME not editable (lock LOCK), so no door on this database adds those sets."
  - When the door's verdict cannot be read, the text says so and names no act.

Whether a definition is editable is the metadata door's own answer, the `editable` flag of its item read, the same verdict the ceremony already asks before its one in-place write.

**Unchanged.**

- Under `single`, the pointer at `authored-conversion` stays, because that step carries the bindings there.
- A built-in position that does not resolve because the boot did not compose the security plugin keeps that composition's remedy, under every posture.
- The `conflicting` blocker, for a name that organizations bind differently, keeps its text. It states the fact and names no act, because no door makes the rows agree.
- `authored-conversion`'s walled note is unchanged. The rewrite gate's blocker is where the operator reads about binding rows.
