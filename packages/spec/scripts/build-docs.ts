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

import fs from 'fs';
import path from 'path';

const SCHEMA_DIR = path.resolve(__dirname, '../json-schema');
const SRC_DIR = path.resolve(__dirname, '../src');
// Output directly to references folder (flattened)
// ⚠️  Everything inside category sub-folders is auto-generated and disposable.
const DOCS_ROOT = path.resolve(__dirname, '../../../content/docs/references');

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

// Helpers to format types
function formatType(prop: any): string {
  if (!prop) return 'any';
  
  if (prop.$ref) {
    const ref = prop.$ref.split('/').pop();
    return `[${ref}](./${ref})`;
  }
  
  if (prop.type === 'array') {
    return `${formatType(prop.items)}[]`;
  }
  
  if (prop.enum) {
    return `Enum<${prop.enum.map((e: any) => `'${e}'`).join(' | ')}>`;
  }
  
  if (prop.anyOf || prop.oneOf) {
    const variants = prop.anyOf || prop.oneOf;
    return variants.map(formatType).join(' | ');
  }

  if (prop.type === 'object' && prop.additionalProperties) {
    return `Record<string, ${formatType(prop.additionalProperties)}>`;
  }

  if (prop.type === 'object' && !prop.properties && !prop.additionalProperties) {
    return 'object';
  }

  // Handle inline objects slightly better by just calling them 'Object'
  if (prop.type === 'object') return 'Object';

  if (Array.isArray(prop.type)) {
    return prop.type.join(' | ');
  }

  return prop.type || 'any';
}

// Extract file-level JSDoc description from source
function getFileDescription(content: string): string {
  const match = content.match(/\/\*\*([\s\S]*?)\*\//);
  if (match) {
    return match[1]
      .split('\n')
      .map(line => line.replace(/^\s*\*\s?/, '').trim())
      .filter(line => line)
      .join('\n\n')
      .replace(/\{@link\s+([^|]+?)\s*\|\s*([^}]+?)\s*\}/g, '[$2]($1)') // {@link url | text} -> [text](url)
      .replace(/\{@link\s+([^}]+?)\s*\}/g, '[$1]($1)') // {@link url} -> [url](url)
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

  const renderProperties = (props: any, required: Set<string> = new Set()) => {
      let t = `### Properties\n\n`;
      t += `| Property | Type | Required | Description |\n`;
      t += `| :--- | :--- | :--- | :--- |\n`;
      for (const [key, prop] of Object.entries(props) as [string, any][]) {
          const typeStr = formatType(prop).replace(/\|/g, '\\|');
          const isReq = required.has(key) ? '✅' : 'optional';
          let desc = escapeMdxDescription((prop.description || '').replace(/\n/g, ' '));
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
              const refName = variant.$ref.split('/').pop();
              md += `Reference: [${refName}](./${refName})\n\n`;
         } else {
             md += `Type: \`${formatType(variant)}\`\n\n`;
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
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  
  // Create Category Directory
  const categoryDir = path.join(DOCS_ROOT, category);
  if (!fs.existsSync(categoryDir)) fs.mkdirSync(categoryDir, { recursive: true });

  // Generate file
  zodFileSchemas.forEach((schemas, zodFile) => {
    const fileName = `${zodFile}.mdx`;
    const mdx = generateZodFileMarkdown(zodFile, schemas, category);
    fs.writeFileSync(path.join(categoryDir, fileName), mdx);
    console.log(`✓ Generated ${category}/${fileName}`);
  });
  
  // Generate Category Meta
  const meta = {
    title: CATEGORIES[category],
    pages: Array.from(zodFileSchemas.keys()).sort()
  };
  fs.writeFileSync(path.join(categoryDir, 'meta.json'), JSON.stringify(meta, null, 2));
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
      if (!fs.existsSync(path.join(DOCS_ROOT, category, `${zodFile}.mdx`))) return;
      const fileTitle = zodFile.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      // Link relative to the category folder (where index.mdx lives)
      mdx += `  <Card href="/docs/references/${category}/${zodFile}" title="${fileTitle}" description="Source: packages/spec/src/${category}/${zodFile}.zod.ts" />\n`;
  });
  mdx += `</Cards>\n`;

  // Write as index.mdx inside the category folder? 
  // If we do that, accessing /docs/references/ai works.
  // BUT 'index' must be in 'meta.json' pages? No, index is implicit usually.
  
  // However, Fumadocs often treats folder/index.mdx as the page for the folder.
  // Ensure directory exists before writing
  const categoryDir = path.join(DOCS_ROOT, category);
  if (!fs.existsSync(categoryDir)) fs.mkdirSync(categoryDir, { recursive: true });
  
  fs.writeFileSync(path.join(categoryDir, 'index.mdx'), mdx);
  console.log(`✓ Generated ${category}/index.mdx`);
});

// 3. Update root meta.json
// Collect categories that have actual generated content (non-empty zod files)
const categoryDirs = Object.keys(CATEGORIES)
  .filter(cat => {
    const zodFiles = categoryZodFiles.get(cat);
    return zodFiles && zodFiles.size > 0;
  })
  .sort();

// Collect other root files (if any exist, like implementation-status.mdx)
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
fs.writeFileSync(path.join(DOCS_ROOT, 'meta.json'), JSON.stringify(meta, null, 2));
console.log(`✓ Updated root meta.json`);

console.log('Done!');
