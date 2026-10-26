#!/usr/bin/env python3
"""
Regenerate examples/schema-catalog/src/index.ts from the files on disk.

The registry is a PURE FUNCTION of two checked-in inputs:

  1. examples/schema-catalog/src/schemas/<category>/<slug>.json — the entries
  2. examples/schema-catalog/src/catalog-meta.json — hand-curated metadata
     (title / description / tags), keyed by `<category>/<slug>`

Anything not named in (2) gets a slug-derived title and an empty description.
Run from the repo root:

    python3 scripts/regenerate-catalog-index.py            # rewrite index.ts
    python3 scripts/regenerate-catalog-index.py --check     # verify, never write

## Why curated metadata lives in a sidecar (objectui#4633)

This script used to derive `title` from the filename and write
`description: ""` unconditionally, so running it on an untouched tree produced
a 29-line diff that DISCARDED hand-written titles and descriptions for ten
entries — six of them `plugin-dashboard` entries whose strings are user-visible
on /docs/guide/schema-catalog. Anyone adding a catalog entry is expected to run
this script, so every such addition silently reverted someone else's curation,
and the churn-shaped diff made it easy to miss in review. The checked-in
`index.ts` and this script disagreed, and the script won whenever it ran.

The sidecar removes the class rather than the instance: curated strings have a
home this script only ever READS, so regeneration cannot destroy them, and
`index.ts` becomes a genuinely derived artifact that nobody is invited to edit.

Two shapes were rejected on the way here:

  - Preserving metadata by parsing the previously generated `index.ts`. That
    makes the generated artifact its own input — the file can never be rebuilt
    from scratch, and it keeps authors editing a generated file, which is what
    made the loss possible in the first place.
  - Moving metadata into the entry JSON as a `meta` block. `src/types.ts` says
    metadata is "Kept separate from the schema JSON so the raw schemas remain
    copy-pasteable into user projects" — and these JSON files are real ObjectUI
    schemas that the docs site renders, so a non-schema key would ride along
    into every copy-paste.

Two smaller determinism fixes ship with it:

  - Entries sort by (category, slug), not by filename. Sorting by filename
    compares the ".json" suffix, so "filtered-dashboard.json" sorted AFTER
    "filtered-dashboard-dataset-widgets.json" ('-' < '.'), reordering the
    registry on every run.
  - The old best-effort read of /tmp/all-entries.txt is gone. Output must not
    depend on machine-local state outside the repo: with that file present the
    same tree regenerated to different bytes.

`scripts/__tests__/catalog-index-regenerable-4633.test.ts` runs `--check` in CI,
so a hand-edit to index.ts (or a curated string added there instead of to the
sidecar) fails immediately instead of at the next author's regeneration.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'examples/schema-catalog'
SCHEMAS = CATALOG / 'src/schemas'
CURATED_META = CATALOG / 'src/catalog-meta.json'
OUT = CATALOG / 'src/index.ts'

META_KEYS = ('title', 'description', 'tags')


def ident(category: str, slug: str) -> str:
    """JS-identifier-safe variable name."""
    base = f"{category}_{slug}"
    return re.sub(r'[^A-Za-z0-9_$]', '_', base)


def slug_to_title(slug: str) -> str:
    return ' '.join(w.capitalize() for w in slug.split('-'))


def load_curated() -> dict:
    """Read the hand-curated metadata sidecar.

    Validated rather than merged blindly: a key for an entry that no longer
    exists, or a metadata field we do not emit, is a silent no-op otherwise —
    the author sees their curation "land" and never appears in the output.
    """
    if not CURATED_META.exists():
        return {}
    data = json.loads(CURATED_META.read_text())
    if not isinstance(data, dict):
        die(f"{rel(CURATED_META)} must be a JSON object keyed by '<category>/<slug>'.")
    for entry_id, meta in data.items():
        if not isinstance(meta, dict):
            die(f"{rel(CURATED_META)}: '{entry_id}' must map to an object.")
        unknown = sorted(set(meta) - set(META_KEYS))
        if unknown:
            die(
                f"{rel(CURATED_META)}: '{entry_id}' declares unsupported "
                f"key(s) {unknown}. Supported: {list(META_KEYS)}.",
            )
    return data


def collect_examples() -> list[dict]:
    """Every entry on disk, ordered by (category, slug).

    Sorting on the parsed pair rather than on the filename keeps sibling slugs
    that share a prefix in their natural order, and makes the order independent
    of the file extension.
    """
    examples = []
    for category_dir in sorted(SCHEMAS.iterdir(), key=lambda p: p.name):
        if not category_dir.is_dir():
            continue
        category = category_dir.name
        for json_file in category_dir.glob('*.json'):
            slug = json_file.stem
            examples.append(
                {'category': category, 'slug': slug, 'id': f'{category}/{slug}'},
            )
    examples.sort(key=lambda e: (e['category'], e['slug']))
    return examples


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT))


def die(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def render(examples: list[dict], curated: dict) -> str:
    lines = []
    lines.append('/*')
    lines.append(' * GENERATED FILE — DO NOT EDIT BY HAND.')
    lines.append(' *')
    lines.append(' * Rebuild with `pnpm --filter @object-ui/example-schema-catalog regenerate`')
    lines.append(' * (scripts/regenerate-catalog-index.py). Every hand edit to this file is')
    lines.append(' * discarded by the next person who runs it.')
    lines.append(' *')
    lines.append(' * To add an example: drop src/schemas/<category>/<slug>.json, then regenerate.')
    lines.append(' * To give it a real title/description/tags: add an entry to')
    lines.append(' * src/catalog-meta.json — that file is the hand-curated one, and the')
    lines.append(' * generator only ever reads it.')
    lines.append(' */')
    # `ExampleMeta` is NOT imported here: the generated body uses only `Example`
    # (REGISTRY, getExample, allExamples), and the `export type { ... } from`
    # below is an independent re-export that does not consume an import binding.
    # Importing it would be an unused import, which `object-ui/no-unused-imports`
    # gates at error. The package's public type surface is unchanged either way.
    lines.append("import type { Example } from './types.js';")
    lines.append("")

    for e in examples:
        var = ident(e['category'], e['slug'])
        lines.append(
            f"import {var} from './schemas/{e['category']}/{e['slug']}.json' with {{ type: 'json' }};",
        )

    lines.append("")
    lines.append("export type { Example, ExampleMeta } from './types.js';")
    lines.append("")
    lines.append("/**")
    lines.append(" * Registry of all examples shipped by ObjectUI.")
    lines.append(" *")
    lines.append(" * Keys are stable IDs of the shape `<category>/<slug>` and are used by:")
    lines.append(" *   - The docs site's <SchemaExample id=\"...\" /> MDX component")
    lines.append(" *   - The smoke test that mounts every example")
    lines.append(" *   - AI agents performing few-shot retrieval")
    lines.append(" */")
    lines.append("const REGISTRY: Record<string, Example> = {")

    for e in examples:
        var = ident(e['category'], e['slug'])
        meta = curated.get(e['id'], {})
        title = meta.get('title') or slug_to_title(e['slug'])
        desc = meta.get('description', '')
        lines.append(f"  '{e['id']}': {{")
        lines.append(f"    id: '{e['id']}',")
        lines.append("    meta: {")
        lines.append(f"      title: {json.dumps(title, ensure_ascii=False)},")
        lines.append(f"      description: {json.dumps(desc, ensure_ascii=False)},")
        lines.append(f"      category: '{e['category']}',")
        if meta.get('tags'):
            lines.append(f"      tags: {json.dumps(meta['tags'], ensure_ascii=False)},")
        lines.append("    },")
        lines.append(f"    schema: {var},")
        lines.append("  },")

    lines.append("};")
    lines.append("")
    lines.append("/** Look up an example by id. Throws if the id is unknown. */")
    lines.append("export function getExample(id: string): Example {")
    lines.append("  const entry = REGISTRY[id];")
    lines.append("  if (!entry) {")
    lines.append("    throw new Error(")
    lines.append("      `Unknown example id: \"${id}\". Known ids: ${Object.keys(REGISTRY).join(', ')}`,")
    lines.append("    );")
    lines.append("  }")
    lines.append("  return entry;")
    lines.append("}")
    lines.append("")
    lines.append("/** Returns all examples in registry order. */")
    lines.append("export function allExamples(): Example[] {")
    lines.append("  return Object.values(REGISTRY);")
    lines.append("}")
    lines.append("")
    lines.append("/** Returns examples filtered by category. */")
    lines.append("export function examplesByCategory(category: string): Example[] {")
    lines.append("  return allExamples().filter((e) => e.meta.category === category);")
    lines.append("}")
    lines.append("")
    lines.append("/** Convenience: list all known ids (for debugging / tooling). */")
    lines.append("export function allExampleIds(): string[] {")
    lines.append("  return Object.keys(REGISTRY);")
    lines.append("}")

    return "\n".join(lines) + "\n"


def main() -> None:
    args = sys.argv[1:]
    unknown_args = [a for a in args if a != '--check']
    if unknown_args:
        die(f"unknown argument(s) {unknown_args}. Usage: {Path(__file__).name} [--check]")
    check_only = '--check' in args

    curated = load_curated()
    examples = collect_examples()

    known = {e['id'] for e in examples}
    stale = sorted(set(curated) - known)
    if stale:
        die(
            f"{rel(CURATED_META)} curates {len(stale)} id(s) with no entry on disk: "
            + ', '.join(stale)
            + "\n       Either restore src/schemas/<id>.json or drop the curated entry — "
            "a curated id that matches nothing is metadata the registry will never show.",
        )

    content = render(examples, curated)

    if check_only:
        current = OUT.read_text() if OUT.exists() else ''
        if current == content:
            print(f"{rel(OUT)} is up to date ({len(examples)} entries).")
            return
        import difflib
        diff = list(
            difflib.unified_diff(
                current.splitlines(keepends=True),
                content.splitlines(keepends=True),
                fromfile=f"{rel(OUT)} (checked in)",
                tofile=f"{rel(OUT)} (regenerated)",
                n=1,
            ),
        )
        sys.stderr.writelines(diff[:120])
        if len(diff) > 120:
            print(f"... ({len(diff) - 120} more diff lines)", file=sys.stderr)
        die(
            f"{rel(OUT)} does not match its generator.\n"
            "       Run `pnpm --filter @object-ui/example-schema-catalog regenerate` and "
            "commit the result.\n"
            f"       Curated titles/descriptions belong in {rel(CURATED_META)}, not in the "
            "generated file.",
        )

    OUT.write_text(content)
    print(
        f"Wrote {rel(OUT)} with {len(examples)} entries "
        f"({len(curated)} carrying curated metadata from {rel(CURATED_META)}).",
    )


if __name__ == '__main__':
    main()
