// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// ⚠️  AUTO-GENERATION SCRIPT
//
// This script regenerates ALL files under content/docs/references/{category}/.
// It DELETES each category folder before regenerating from JSON Schemas.
//
// DO NOT place hand-written content in content/docs/references/ — it WILL be
// overwritten or deleted on the next build.
//
// Hand-written documentation lives in the module folders under content/docs/
// (data-modeling/, automation/, permissions/, ui/, api/, ai/, plugins/, kernel/, ...).
// See DX_ROADMAP.md and .cursorrules for details.
//
// Usage:
//   tsx scripts/build-docs.ts            # write
//   tsx scripts/build-docs.ts --check    # verify in sync (CI); exit 1 on drift

import fs from 'fs';
import path from 'path';

const SCHEMA_DIR = path.resolve(__dirname, '../json-schema');
const SRC_DIR = path.resolve(__dirname, '../src');
// Output directly to references folder (flattened)
// ⚠️  Everything inside category sub-folders is auto-generated and disposable.
const DOCS_ROOT = path.resolve(__dirname, '../../../content/docs/references');
const REPO_ROOT = path.resolve(__dirname, '../../..');

const CHECK = process.argv.includes('--check');

// ── Output sink ──────────────────────────────────────────────────────────────
// Every generated file goes through emit(), every wholesale-regenerated folder
// through manageDir(). Nothing touches the output tree until flush(), so the
// two modes run byte-for-byte identical generation logic and differ only in the
// final disposition — write to disk, or compare against it. That shared path is
// what makes --check trustworthy: it cannot pass on output a real run wouldn't
// produce, because it *is* the real run minus the writes.

/** Absolute path → intended content. */
const emitted = new Map<string, string>();
/** Absolute dirs regenerated wholesale — anything on disk here that we didn't
 *  emit is stale, and a real run would delete it. */
const managedDirs = new Set<string>();

function emit(filePath: string, content: string): void {
  emitted.set(path.resolve(filePath), content);
}

function manageDir(dir: string): void {
  managedDirs.add(path.resolve(dir));
}

/** Files this run generated, for the read-after-write lookups below. */
function wasEmitted(filePath: string): boolean {
  return emitted.has(path.resolve(filePath));
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

const rel = (p: string) => path.relative(REPO_ROOT, p);

/** Write the emitted tree, or (in --check) report how it differs from disk. */
function flush(): void {
  if (!CHECK) {
    for (const dir of managedDirs) {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
    for (const [file, content] of emitted) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      console.log(`✓ Generated ${rel(file)}`);
    }
    console.log(`\n✅ Generated ${emitted.size} files`);
    return;
  }

  // A run with no schemas to read emits almost nothing, and "nothing differs"
  // would read as success — the gate would pass while checking no pages at all.
  // json-schema/ is gitignored, so this is one forgotten `gen:schema` away on a
  // fresh checkout. Fail loudly instead of greenly.
  if (managedDirs.size === 0) {
    console.error(
      `\n✗ No JSON schemas found under ${rel(SCHEMA_DIR)} — nothing to check against.\n` +
        `  Run \`pnpm --filter @objectstack/spec gen:schema\` first (\`check:docs\` does this for you).\n`,
    );
    process.exit(1);
  }

  const changed: string[] = [];
  const added: string[] = [];
  for (const [file, content] of emitted) {
    if (!fs.existsSync(file)) added.push(rel(file));
    else if (fs.readFileSync(file, 'utf-8') !== content) changed.push(rel(file));
  }
  // A managed folder is regenerated in full, so an on-disk file we didn't emit
  // is one a real run would delete — e.g. the page of a type removed from spec.
  const stale = [...managedDirs]
    .flatMap(walk)
    .filter(f => !wasEmitted(f))
    .map(rel);

  const drift = [
    ...added.map(f => `  + ${f} (missing — spec adds it)`),
    ...changed.map(f => `  ~ ${f} (out of date)`),
    ...stale.map(f => `  - ${f} (stale — spec no longer defines it)`),
  ];

  if (drift.length === 0) {
    console.log(`✅ ${emitted.size} reference files in sync with packages/spec`);
    return;
  }

  console.error(
    `\n✗ content/docs/references/ is out of date with packages/spec:\n\n` +
      drift.join('\n') +
      `\n\nThese files are GENERATED — do not hand-edit them. Regenerate and commit:\n\n` +
      `  pnpm --filter @objectstack/spec gen:schema && pnpm --filter @objectstack/spec gen:docs\n` +
      `  git add content/docs/references\n`,
  );
  process.exit(1);
}

// Dynamically discover categories from src directory
const getCategoryTitle = (dir: string) => {
  const upper = dir.toUpperCase();
  if (['UI', 'AI', 'API'].includes(upper)) return `${upper} Protocol`;
  return `${dir.charAt(0).toUpperCase() + dir.slice(1)} Protocol`;
};

const CATEGORIES = fs.readdirSync(SRC_DIR)
  .filter(file => fs.statSync(path.join(SRC_DIR, file)).isDirectory())
  .reduce((acc, dir) => {
    acc[dir] = getCategoryTitle(dir);
    return acc;
  }, {} as Record<string, string>);

// Map SchemaName -> Category (e.g. 'Object' -> 'data')
const schemaCategoryMap = new Map<string, string>();
// Map SchemaName -> Zod file (e.g. 'Object' -> 'object')
const schemaZodFileMap = new Map<string, string>();
// Track all zod files per category
const categoryZodFiles = new Map<string, Set<string>>();
// Track Zod File collisions
const zodFileCounts = new Map<string, number>();

// Scan source files to build maps
function scanCategories() {
  Object.keys(CATEGORIES).forEach(category => {
    const dir = path.join(SRC_DIR, category);
    if (!fs.existsSync(dir)) return;

    const zodFiles = new Set<string>();
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.zod.ts'));
    
    for (const file of files) {
      const zodFileName = file.replace('.zod.ts', '');
      zodFiles.add(zodFileName);
      
      const count = zodFileCounts.get(zodFileName) || 0;
      zodFileCounts.set(zodFileName, count + 1);
      
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      
      // Match export const Name = ... OR export const Name: Type = ...
      const regex = /export const (\w+)\s*(?:[:=])/g;
      
      let match;
      while ((match = regex.exec(content)) !== null) {
        const rawName = match[1];
        const finalName = rawName.endsWith('Schema') ? rawName.replace('Schema', '') : rawName;
        schemaCategoryMap.set(finalName, category);
        schemaZodFileMap.set(finalName, zodFileName);
      }
    }
    
    categoryZodFiles.set(category, zodFiles);
  });
}

scanCategories();

/**
 * Context a page needs to turn a `$ref` into a link that actually resolves.
 *
 * Pages are named after the *zod file* (`data/object.mdx`) while refs name a
 * *schema* (`Field`), so a ref can only be linked by looking the schema name up
 * in the maps built by scanCategories(). Anonymous refs (`__schemaN`, emitted
 * when Zod hoists a reused inline schema into `$defs`) have no page at all and
 * are rendered structurally instead.
 */
interface TypeContext {
  /** `$defs` of the document being rendered — for resolving local refs. */
  defs: Record<string, any>;
  /** The schema whose section is being rendered — target of a self `$ref` (`"#"`). */
  currentSchema: string;
  /**
   * Anonymous refs already being expanded on this branch. Schemas are cyclic
   * (a node contains nodes), so inlining without this recurses forever.
   */
  expanding?: Set<string>;
}

const refName = (ref: string): string => ref.split('/').pop() || ref;
const isAnonymousRef = (name: string) => /^__schema\d+$/.test(name);

/** A page-local anchor, matching how fumadocs slugs the `## SchemaName` heading. */
const anchorFor = (schemaName: string) => `#${schemaName.toLowerCase()}`;

/**
 * Resolve a schema name to its page. Returns null when the schema isn't one we
 * generate a page for — callers then render the type without a link rather than
 * emitting a 404.
 */
function schemaHref(name: string): string | null {
  const category = schemaCategoryMap.get(name);
  const zodFile = schemaZodFileMap.get(name);
  if (!category || !zodFile) return null;
  return `/docs/references/${category}/${zodFile}${anchorFor(name)}`;
}

// Helpers to format types
function formatType(prop: any, ctx?: TypeContext): string {
  if (!prop) return 'any';

  if (prop.$ref) {
    // Self-reference: link to the current section rather than a bare `#`.
    if (prop.$ref === '#') {
      return ctx ? `[${ctx.currentSchema}](${anchorFor(ctx.currentSchema)})` : 'object';
    }

    const name = refName(prop.$ref);

    // Zod-hoisted inline schema: no page exists. Render its shape instead.
    if (isAnonymousRef(name)) {
      const target = ctx?.defs?.[name];
      if (!target) return 'object';
      // Cycle guard: these schemas are recursive (a node contains nodes).
      if (ctx!.expanding?.has(name)) return 'object';
      const expanding = new Set(ctx!.expanding ?? []);
      expanding.add(name);
      return formatType({ ...target, $ref: undefined }, { ...ctx!, expanding });
    }

    const href = schemaHref(name);
    return href ? `[${name}](${href})` : name;
  }

  if (prop.type === 'array') {
    return `${formatType(prop.items, ctx)}[]`;
  }

  if (prop.enum) {
    return `Enum<${prop.enum.map((e: any) => `'${e}'`).join(' | ')}>`;
  }

  if (prop.const !== undefined) {
    return `'${prop.const}'`;
  }

  if (prop.anyOf || prop.oneOf) {
    const variants = prop.anyOf || prop.oneOf;
    return variants.map((v: any) => formatType(v, ctx)).join(' | ');
  }

  if (prop.type === 'object' && prop.additionalProperties) {
    return `Record<string, ${formatType(prop.additionalProperties, ctx)}>`;
  }

  if (prop.type === 'object' && !prop.properties && !prop.additionalProperties) {
    return 'object';
  }

  // Inline object: show its shape one level deep instead of an opaque `Object`.
  if (prop.type === 'object' && prop.properties) {
    const keys = Object.keys(prop.properties);
    const shown = keys.slice(0, 4).map(k => {
      const child = prop.properties[k];
      const optional = (prop.required || []).includes(k) ? '' : '?';
      // Depth-limited: nested objects stay opaque so a table cell can't explode.
      const childType = child?.type === 'object' && child.properties
        ? 'object'
        : formatType(child, ctx);
      return `${k}${optional}: ${childType}`;
    });
    if (keys.length > shown.length) shown.push('…');
    return `{ ${shown.join('; ')} }`;
  }

  if (Array.isArray(prop.type)) {
    return prop.type.join(' | ');
  }

  return prop.type || 'any';
}

/**
 * Rewrite a source path referenced from JSDoc (`../automation/sync.zod.ts`) to
 * the docs route that renders it. Without this the generated page links to a
 * path that only exists in the repo, i.e. a 404 on the site.
 */
function sourcePathToDocsRoute(target: string): string | null {
  const m = target.match(/(?:^|\/)([\w-]+)\/([\w.-]+)\.zod\.ts$/);
  if (!m) return null;
  const [, category, zodFile] = m;
  if (!CATEGORIES[category]) return null;
  return `/docs/references/${category}/${zodFile}`;
}

// Extract file-level JSDoc description from source
function getFileDescription(content: string): string {
  const match = content.match(/\/\*\*([\s\S]*?)\*\//);
  if (match) {
    return match[1]
      .split('\n')
      .map(line => line.replace(/^\s*\*\s?/, '').trim())
      .filter(line => line)
      // A bare `@see <path>` tag renders as noise — turn it into prose.
      .map(line => line.replace(/^@see\s+/, 'See also: '))
      .join('\n\n')
      .replace(/\{@link\s+([^|]+?)\s*\|\s*([^}]+?)\s*\}/g, (_m, target: string, text: string) =>
        `[${text.trim()}](${sourcePathToDocsRoute(target.trim()) ?? target.trim()})`)
      .replace(/\{@link\s+([^}]+?)\s*\}/g, (_m, target: string) => {
        const route = sourcePathToDocsRoute(target.trim());
        return route ? `[${target.trim()}](${route})` : `\`${target.trim()}\``;
      })
      // Same for a bare source path left in prose by `See also:` above.
      .replace(/(?<!\()\b((?:\.\.\/)?[\w-]+\/[\w.-]+\.zod\.ts)\b(?!\))/g, (m0, p: string) => {
        const route = sourcePathToDocsRoute(p);
        return route ? `[${p}](${route})` : `\`${p}\``;
      })
      .replace(/file:\/\//g, '') // Remove file:// protocol
      .replace(/\{/g, '\\{').replace(/\}/g, '\\}') // Escape { } for MDX
  }
  return '';
}

function generateMarkdown(schemaName: string, schema: any, category: string, zodFile: string) {
  const defs = schema.definitions || schema.$defs || {};
  let mainDef = defs[schemaName];

  // If the schema name isn't in definitions, check if the root schema itself
  // has type/properties/enum (JSON Schema 2020-12 puts content at root level)
  if (!mainDef && (schema.properties || schema.enum || schema.anyOf || schema.oneOf)) {
    mainDef = schema;
  }

  // Last resort: use first definition entry
  if (!mainDef) {
    mainDef = Object.values(defs)[0];
  }

  if (!mainDef) return '';

  let md = '';
  
  // Add schema heading
  md += `## ${schemaName}\n\n`;
  
  // Escape MDX-unsafe characters in description text. MDX parses `{` as a JS
  // expression and `<` as JSX, so any raw `{token}` / `<title>` inside a Zod
  // `.describe()` string breaks the docs build. Wrap such fragments in inline
  // code so they render literally.
  //
  // Single pass with backtick tracking: fragments already inside an inline-code
  // span are left untouched. A naive two-pass replace double-wraps nested cases
  // like `{<id>}` into `` `{`<id>`}` `` — the inner backticks close the span
  // early and leak `<id>` as raw JSX (MDX: "Expected a closing tag for `<id>`").
  //
  // A matched `{…}` / `<…>` pair is wrapped in an inline-code span so it renders
  // literally. A *lone* `<` or `{` with no closing partner (e.g. a SemVer range
  // `">=4.0 <5"`, or prose like `count < 5`) can't be wrapped, so it is replaced
  // with its HTML entity — otherwise MDX reads the `<` as the start of a JSX tag
  // and the build dies ("Unexpected character `5` before name").
  const escapeMdxDescription = (raw: string): string => {
    let out = '';
    let inCode = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '`') {
        inCode = !inCode;
        out += ch;
        continue;
      }
      if (!inCode && (ch === '{' || ch === '<')) {
        const close = ch === '{' ? '}' : '>';
        const end = raw.indexOf(close, i + 1);
        if (end !== -1) {
          out += '`' + raw.slice(i, end + 1) + '`';
          i = end;
          continue;
        }
        // Unmatched: escape so MDX doesn't treat it as a JSX/expression opener.
        out += ch === '<' ? '&lt;' : '&#123;';
        continue;
      }
      out += ch;
    }
    return out;
  };

  // Add description with better formatting
  if (mainDef.description) {
    md += `${escapeMdxDescription(mainDef.description)}\n\n`;
  }

  const typeCtx: TypeContext = { defs, currentSchema: schemaName };

  const renderProperties = (props: any, required: Set<string> = new Set()) => {
      let t = `### Properties\n\n`;
      t += `| Property | Type | Required | Description |\n`;
      t += `| :--- | :--- | :--- | :--- |\n`;
      for (const [key, prop] of Object.entries(props) as [string, any][]) {
          // Backslashes first, then pipes — same order as `desc` below, and for
          // the same reason: escaping pipes first lets a literal backslash in
          // the input pair with the escape and free the pipe again.
          const typeStr = formatType(prop, typeCtx)
            .replace(/\\/g, '\\\\')
            .replace(/\|/g, '\\|');
          const isReq = required.has(key) ? '✅' : 'optional';
          // Escape for the GFM table cell last: backslashes first (so an existing
          // `\|` in a description can't decay into an escaped backslash + live
          // pipe), then pipes — an unescaped `|` (even inside a code span)
          // splits the cell.
          const desc = escapeMdxDescription((prop.description || '').replace(/\n/g, ' '))
            .replace(/\\/g, '\\\\')
            .replace(/\|/g, '\\|');
          t += `| **${key}** | \`${typeStr}\` | ${isReq} | ${desc} |\n`;
      }
      return t + '\n';
  };

  if (mainDef.type === 'object' && mainDef.properties) {
    md += renderProperties(mainDef.properties, new Set(mainDef.required || []));
    
  } else if (mainDef.type === 'string' && mainDef.enum) {
    md += `### Allowed Values\n\n`;
    md += mainDef.enum.map((e: string) => `* \`${e}\``).join('\n');
    md += `\n\n`;

  } else if (mainDef.anyOf || mainDef.oneOf) {
     md += `### Union Options\n\nThis schema accepts one of the following structures:\n\n`;
     const variants = mainDef.anyOf || mainDef.oneOf;
     variants.forEach((variant: any, index: number) => {
         const variantTitle = variant.title || `Option ${index + 1}`;
         md += `#### ${variantTitle}\n\n`;
         if (variant.description) md += `${escapeMdxDescription(variant.description)}\n\n`;
         
         if (variant.type === 'object' && variant.properties) {
              if (variant.properties.type && variant.properties.type.const) {
                  md += `**Type:** \`${variant.properties.type.const}\`\n\n`;
              }
              md += renderProperties(variant.properties, new Set(variant.required || []));
         } else if (variant.enum) {
              md += `Allowed Values: ${variant.enum.map((e:string) => `\`${e}\``).join(', ')}\n\n`;
         } else if (variant.$ref) {
              md += `Reference: ${formatType(variant, typeCtx)}\n\n`;
         } else {
             md += `Type: \`${formatType(variant, typeCtx)}\`\n\n`;
         }
         md += `---\n\n`; 
     });
  }

  return md;
}

function generateZodFileMarkdown(zodFile: string, schemas: Array<{name: string, content: any}>, category: string): string {
  const zodTitle = zodFile.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  
  // Get source description
  const sourcePath = path.join(SRC_DIR, category, `${zodFile}.zod.ts`);
  let fileDesc = '';
  if (fs.existsSync(sourcePath)) {
      fileDesc = getFileDescription(fs.readFileSync(sourcePath, 'utf-8'));
  }

  let md = `---\n`;
  md += `title: ${zodTitle}\n`;
  md += `description: ${zodTitle} protocol schemas\n`;
  md += `---\n\n`;
  md += `{/* ⚠️  AUTO-GENERATED — DO NOT EDIT. Run build-docs.ts to regenerate. Hand-written docs live in the module folders under content/docs/. */}\n\n`;
  
  if (fileDesc) {
      md += `${fileDesc}\n\n`;
  }
  
  md += `<Callout type="info">\n`;
  md += `**Source:** \`packages/spec/src/${category}/${zodFile}.zod.ts\`\n`;
  md += `</Callout>\n\n`;
  
  // Add TypeScript usage example
  const schemaNames = schemas.map(s => s.name).join(', ');
  const typeNames = schemas.map(s => s.name.replace(/Schema$/, '')).join(', ');
  
  md += `## TypeScript Usage\n\n`;
  md += `\`\`\`typescript\n`;
  md += `import { ${schemaNames} } from '@objectstack/spec/${category}';\n`;
  md += `import type { ${typeNames} } from '@objectstack/spec/${category}';\n\n`;
  // Add simple example
  const firstSchema = schemas[0];
  if (firstSchema) {
    md += `// Validate data\n`;
    md += `const result = ${firstSchema.name}.parse(data);\n`;
  }
  md += `\`\`\`\n\n`;
  md += `---\n\n`;

  // Generate markdown for each schema in the file
  schemas.forEach(({name, content}) => {
    md += generateMarkdown(name, content, category, zodFile);
    md += `\n---\n\n`;
  });

  return md;
}

// === EXECUTION ===

console.log('Building documentation...');

// 1. Clean existing category folders from DOCS_ROOT — but only when there are
// JSON schemas to regenerate from. Otherwise we'd silently delete every .mdx
// file when the upstream `gen:schema` step produced nothing (data loss).
Object.keys(CATEGORIES).forEach(category => {
  const dir = path.join(DOCS_ROOT, category);
  const schemaDir = path.join(SCHEMA_DIR, category);
  const hasSchemas = fs.existsSync(schemaDir)
    && fs.readdirSync(schemaDir).some(f => f.endsWith('.json'));
  if (!hasSchemas) {
    if (fs.existsSync(dir)) {
      console.warn(`⚠ Skipping clean of ${category}/ — no JSON schemas found in ${schemaDir}. Run \`pnpm gen:schema\` first.`);
    }
    return;
  }
  manageDir(dir);
});

const generatedFiles: string[] = [];

// 2. Generate Files
// Clear DOCS_ROOT first to remove old flattened files
if (fs.existsSync(DOCS_ROOT)) {
    // We want to preserve 'index.mdx', 'meta.json' (root one we will rewrite), etc?
    // Safer to just overwrite. 
    // fs.rmSync(DOCS_ROOT, { recursive: true, force: true });
    // But verify we don't kill the manual files.
}

Object.keys(CATEGORIES).forEach(category => {
  const categorySchemaDir = path.join(SCHEMA_DIR, category);
  
  if (!fs.existsSync(categorySchemaDir)) {
    console.log(`Warning: Schema directory ${categorySchemaDir} does not exist`);
    return;
  }
  
  const files = fs.readdirSync(categorySchemaDir).filter(f => f.endsWith('.json'));
  const zodFileSchemas = new Map<string, Array<{name: string, content: any}>>();
  
  files.forEach(file => {
    const schemaName = file.replace('.json', '');
    const schemaPath = path.join(categorySchemaDir, file);
    const content = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    const zodFile = schemaZodFileMap.get(schemaName) || 'misc';
    
    if (!zodFileSchemas.has(zodFile)) {
      zodFileSchemas.set(zodFile, []);
    }
    zodFileSchemas.get(zodFile)!.push({ name: schemaName, content });
  });
  
  const categoryDir = path.join(DOCS_ROOT, category);

  // Generate file
  zodFileSchemas.forEach((schemas, zodFile) => {
    const fileName = `${zodFile}.mdx`;
    const mdx = generateZodFileMarkdown(zodFile, schemas, category);
    emit(path.join(categoryDir, fileName), mdx);
  });

  // Generate Category Meta
  const meta = {
    title: CATEGORIES[category],
    pages: Array.from(zodFileSchemas.keys()).sort()
  };
  emit(path.join(categoryDir, 'meta.json'), JSON.stringify(meta, null, 2));
});

// 2.5 Generate Category Overviews (index.mdx in each folder)
Object.entries(CATEGORIES).forEach(([category, title]) => {
  const zodFiles = categoryZodFiles.get(category) || new Set<string>();
  if (zodFiles.size === 0) return;

  let mdx = `---\n`;
  mdx += `title: ${title}\n`;
  mdx += `description: Complete reference for all ${title.toLowerCase()} schemas\n`;
  mdx += `---\n\n`;
  
  mdx += `This section contains all protocol schemas for the ${category} layer of ObjectStack.\n\n`;
  
  mdx += `<Cards>\n`;
  Array.from(zodFiles).sort().forEach(zodFile => {
      // Only card zod files that actually produced a reference page. A
      // `.zod.ts` whose schemas are all unrepresentable in JSON Schema — e.g.
      // they embed a transform (the ADR-0031 control-flow constructs and the
      // Flow edge schema carry CEL-expression transforms) — generates no page,
      // so carding it would be a dangling 404 link. This aligns the index with
      // `meta.json`, which already lists only generated pages.
      //
      // Asks the sink, not the disk: this run's own output is the authority on
      // what pages exist. (Equivalent on disk, since the folder was just wiped
      // and rewritten — but it stays correct under --check, where nothing is
      // written and the stale files are still lying around.)
      if (!wasEmitted(path.join(DOCS_ROOT, category, `${zodFile}.mdx`))) return;
      const fileTitle = zodFile.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      // Link relative to the category folder (where index.mdx lives)
      mdx += `  <Card href="/docs/references/${category}/${zodFile}" title="${fileTitle}" description="Source: packages/spec/src/${category}/${zodFile}.zod.ts" />\n`;
  });
  mdx += `</Cards>\n`;

  // Fumadocs treats folder/index.mdx as the page for the folder, so this is what
  // makes /docs/references/<category> resolve.
  emit(path.join(DOCS_ROOT, category, 'index.mdx'), mdx);
});

// 3. Update root meta.json
// Collect categories that have actual generated content (non-empty zod files)
const categoryDirs = Object.keys(CATEGORIES)
  .filter(cat => {
    const zodFiles = categoryZodFiles.get(cat);
    return zodFiles && zodFiles.size > 0;
  })
  .sort();

// Collect other root files (if any exist, like implementation-status.mdx).
// Root-level .mdx is hand-written and never generated, so this reads the disk in
// both modes — it is an input to the sidebar, not part of the emitted tree.
const rootFiles = fs.readdirSync(DOCS_ROOT)
  .filter(f => f.endsWith('.mdx') && !f.startsWith('index')) // Exclude index.mdx if it exists?
  .map(f => f.replace('.mdx', ''))
  .filter(f => !categoryDirs.includes(f)); // Exclude if it's a category name (unlikely if they are folders)

const pages = [
  ...categoryDirs,
  ...rootFiles.sort()
];

const meta = {
  title: "Reference",
  icon: "FileCode",
  // One collapsible group in the single-tree sidebar (module-based IA); it must
  // NOT be a root tab — the whole docs tree renders as one sidebar.
  pages: pages
};
emit(path.join(DOCS_ROOT, 'meta.json'), JSON.stringify(meta, null, 2));

// 4. Disposition: write the tree, or report drift against it.
flush();
