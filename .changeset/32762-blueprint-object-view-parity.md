---
'@objectstack/spec': minor
---

fix(spec): the AI blueprint object and view follow the object and view rules: stage-field option kinds are refused at parse, an object carries `icon`, and a view may be named `OBJECT.KEY`

Clause-②: yes (narrowing)
Metadata-protocol: narrowed
<!-- adr-0087: registered blueprint-stage-field-option-kind-required -->
Skills-docs: none — no file under `skills/**` restates a blueprint object or view key (`skills/objectstack-ai/references/_index.md` only points at `solution-blueprint.zod.ts`); the reference page `content/docs/references/ai/solution-blueprint.mdx` is regenerated from the new describes.

Three places where the AI solution blueprint (`SolutionBlueprintSchema`, the shape `apply_blueprint` parses) disagreed with the object and view schemas the applier writes through:

- **Stage-field option kinds are judged by the blueprint (narrowed).** `BlueprintObjectSchema` now runs the same refinement `ObjectSchema` runs on `stageField` (`refuseStageFieldWithoutKinds`, moved unchanged into its own module so both shapes call one function). A blueprint whose `stageField` names a `select` / `radio` with an option missing `kind`, or names a multi-value choice field, is refused at parse, located at the option's `kind` (`objects[i].fields[j].options[k].kind`) or at `objects[i].stageField`. Before, the blueprint parsed, the applier staged the object's views and nav entry, and only the object write refused, so a build answered `drafted` with dependents pointing at an object that was never written. Every blueprint this refuses was already refused by the object write the applier makes from it, and every entry carrying the stage field's name is judged.
- **A blueprint object carries `icon` (added).** `BlueprintObjectSchema.icon` is `ObjectSchema.icon`'s own leaf (an optional string), and the strict structured-output mirror carries it as a required, nullable key. Before, an `icon` on a blueprint object was dropped by the lenient parse and could not be generated at all, so a blueprint-built object got the generic glyph.
- **A view may be named `OBJECT.KEY` (added).** `BlueprintViewSchema.name` admits the bare snake_case key, as before, or that key qualified with the view's own `object` (`ticket.open_list` on a view over `ticket`): the spelling a stored view record carries. A qualifier naming another object is refused at `views[i].name`. The strict mirror keeps the bare key only, because which object the qualifier may name is a cross-key rule it cannot state; every name the mirror can generate is one the applier accepts.

BREAKING for two accept sets: `SolutionBlueprintSchema` / `defineSolutionBlueprint` refuse such a blueprint where they parsed it, and `SolutionBlueprintStrictSchema.objects[]` now requires the `icon` key.

Migration: none for a blueprint that applied before. A blueprint now refused at the stage field fix is one whose object write was already refused: give every option of the stage field its `kind` (`open`, `won` or `lost`), or omit `stageField`. A producer that builds the strict mirror's output by hand adds `icon` (a Lucide icon name, or `null`) to each object.
