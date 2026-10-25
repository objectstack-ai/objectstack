#!/usr/bin/env node

/**
 * Offline Component Analysis Script
 * 
 * Analyzes ObjectUI components to identify customizations vs base Shadcn structure
 * Works without network access by examining local files
 * 
 * Usage: node scripts/component-analysis.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.join(__dirname, '..');
const COMPONENTS_DIR = path.join(REPO_ROOT, 'packages/components/src/ui');
const MANIFEST_PATH = path.join(REPO_ROOT, 'packages/components/shadcn-components.json');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

function log(message, color = 'white') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(70));
  log(title, 'bright');
  console.log('='.repeat(70) + '\n');
}

async function loadManifest() {
  const content = await fs.readFile(MANIFEST_PATH, 'utf-8');
  return JSON.parse(content);
}

async function analyzeComponent(name, filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  
  const analysis = {
    name,
    lines: lines.length,
    hasObjectUIHeader: content.includes('ObjectUI') && content.includes('ObjectStack Inc'),
    hasDataSlots: content.includes('data-slot'),
    hasCustomVariants: false,
    imports: {
      radix: [],
      local: [],
      external: [],
    },
    exports: [],
    customizations: [],
  };
  
  // Analyze imports
  for (const line of lines) {
    if (line.includes('from "@radix-ui/')) {
      const match = line.match(/@radix-ui\/([^"']+)/);
      if (match) analysis.imports.radix.push(match[1]);
    } else if (line.includes('from "../')) {
      const match = line.match(/from ["']\.\.\/([^"']+)/);
      if (match) analysis.imports.local.push(match[1]);
    } else if (line.includes('from "') && !line.includes('react')) {
      const match = line.match(/from ["']([^"']+)/);
      if (match && !match[1].startsWith('.')) {
        analysis.imports.external.push(match[1]);
      }
    }
  }
  
  // Check for exports
  const exportMatches = content.matchAll(/export (?:const|function|interface|type) (\w+)/g);
  for (const match of exportMatches) {
    analysis.exports.push(match[1]);
  }
  
  // Detect customizations
  if (content.includes('icon-sm') || content.includes('icon-lg')) {
    analysis.customizations.push('Extra size variants (icon-sm, icon-lg)');
    analysis.hasCustomVariants = true;
  }
  
  if (content.includes('backdrop-blur')) {
    analysis.customizations.push('Glassmorphism effects');
  }
  
  if (content.includes('dark:bg-') && content.match(/dark:bg-[^\s"']+/g)?.length > 5) {
    analysis.customizations.push('Enhanced dark mode styling');
  }
  
  if (content.includes('data-slot')) {
    analysis.customizations.push(`Data-slot attributes (${content.match(/data-slot/g).length} instances)`);
  }
  
  if (content.includes('@hookform/resolvers') || content.includes('useFormContext')) {
    analysis.customizations.push('React Hook Form integration');
  }
  
  if (content.includes('ObjectUI') && lines[0].includes('/**')) {
    analysis.customizations.push('ObjectUI copyright header');
  }
  
  // Check if significantly different from typical Shadcn component
  const typicalShadcnLines = {
    'button': 70,
    'input': 30,
    'label': 25,
    'card': 80,
    'dialog': 200,
    'select': 250,
    'form': 180,
  };
  
  if (typicalShadcnLines[name]) {
    const expectedLines = typicalShadcnLines[name];
    const diff = Math.abs(analysis.lines - expectedLines);
    if (diff > expectedLines * 0.3) { // More than 30% difference
      analysis.customizations.push(`Significantly different size (${analysis.lines} vs ~${expectedLines} lines)`);
    }
  }
  
  return analysis;
}

async function main() {
  logSection('ObjectUI Components Analysis (Offline Mode)');
  
  const manifest = await loadManifest();
  const files = await fs.readdir(COMPONENTS_DIR);
  const componentFiles = files.filter(f => f.endsWith('.tsx'));
  
  log(`Analyzing ${componentFiles.length} components...`, 'cyan');
  log(`Manifest tracks ${Object.keys(manifest.components).length} Shadcn components`, 'dim');
  log(`Manifest tracks ${Object.keys(manifest.customComponents).length} custom components\n`, 'dim');
  
  const analyses = [];
  
  for (const file of componentFiles.sort()) {
    const name = file.replace('.tsx', '');
    const filePath = path.join(COMPONENTS_DIR, file);
    const analysis = await analyzeComponent(name, filePath);
    analyses.push(analysis);
  }
  
  // Categorize components
  const shadcnComponents = analyses.filter(a => manifest.components[a.name]);
  const customComponents = analyses.filter(a => manifest.customComponents[a.name]);
  const unknownComponents = analyses.filter(a => 
    !manifest.components[a.name] && !manifest.customComponents[a.name]
  );
  
  // Report Shadcn components with customizations
  logSection('Shadcn Components - Customization Analysis');
  
  const heavilyCustomized = [];
  const lightlyCustomized = [];
  const unmodified = [];
  
  for (const analysis of shadcnComponents) {
    if (analysis.customizations.length === 0 || 
        (analysis.customizations.length === 1 && analysis.hasObjectUIHeader)) {
      unmodified.push(analysis);
    } else if (analysis.customizations.length >= 3) {
      heavilyCustomized.push(analysis);
    } else {
      lightlyCustomized.push(analysis);
    }
  }
  
  log(`📊 Customization Levels:`, 'cyan');
  log(`   ✓ Unmodified:          ${unmodified.length} components`, 'green');
  log(`   ⚡ Light customization: ${lightlyCustomized.length} components`, 'yellow');
  log(`   🔧 Heavy customization: ${heavilyCustomized.length} components\n`, 'blue');
  
  if (heavilyCustomized.length > 0) {
    log('🔧 Heavily Customized Components:', 'blue');
    for (const a of heavilyCustomized) {
      log(`\n  ${a.name} (${a.lines} lines)`, 'bright');
      for (const custom of a.customizations) {
        log(`    • ${custom}`, 'dim');
      }
    }
  }
  
  if (lightlyCustomized.length > 0) {
    log('\n⚡ Lightly Customized Components:', 'yellow');
    for (const a of lightlyCustomized) {
      const customs = a.customizations.filter(c => !c.includes('copyright'));
      if (customs.length > 0) {
        log(`  • ${a.name.padEnd(25)} ${customs.join(', ')}`, 'dim');
      }
    }
  }
  
  // Report custom components
  logSection('Custom ObjectUI Components');
  
  log(`Found ${customComponents.length} custom components:\n`, 'cyan');
  for (const a of customComponents) {
    const desc = manifest.customComponents[a.name]?.description || 'No description';
    log(`  • ${a.name.padEnd(20)} (${String(a.lines).padStart(3)} lines)  ${colors.dim}${desc}${colors.reset}`);
  }
  
  // Report dependencies
  logSection('Dependency Summary');
  
  const allRadixDeps = new Set();
  const allExternalDeps = new Set();
  
  for (const a of analyses) {
    a.imports.radix.forEach(dep => allRadixDeps.add(dep));
    a.imports.external.forEach(dep => allExternalDeps.add(dep));
  }
  
  log('Radix UI Dependencies:', 'cyan');
  Array.from(allRadixDeps).sort().forEach(dep => {
    const count = analyses.filter(a => a.imports.radix.includes(dep)).length;
    log(`  • @radix-ui/${dep.padEnd(30)} (used by ${count} components)`, 'dim');
  });
  
  log('\nExternal Dependencies:', 'cyan');
  Array.from(allExternalDeps).sort().forEach(dep => {
    const count = analyses.filter(a => a.imports.external.includes(dep)).length;
    log(`  • ${dep.padEnd(35)} (used by ${count} components)`, 'dim');
  });
  
  // Recommendations
  logSection('Update Recommendations');
  
  log('✅ Safe to update (minimal customizations):', 'green');
  for (const a of unmodified.slice(0, 10)) {
    log(`   • ${a.name}`, 'dim');
  }
  if (unmodified.length > 10) {
    log(`   ... and ${unmodified.length - 10} more`, 'dim');
  }
  
  log('\n⚠️  Review carefully before updating (moderate customizations):', 'yellow');
  for (const a of lightlyCustomized) {
    log(`   • ${a.name}`, 'dim');
  }
  
  log('\n🔧 Manual merge required (heavy customizations):', 'blue');
  for (const a of heavilyCustomized) {
    log(`   • ${a.name}`, 'dim');
  }
  
  log('\n● Do NOT update (custom ObjectUI components):', 'red');
  for (const a of customComponents) {
    log(`   • ${a.name}`, 'dim');
  }
  
  // Summary stats
  logSection('Summary');
  
  log(`Total components:        ${analyses.length}`, 'bright');
  log(`Shadcn-based:           ${shadcnComponents.length}`, 'cyan');
  log(`Custom ObjectUI:        ${customComponents.length}`, 'blue');
  if (unknownComponents.length > 0) {
    log(`Unknown/Untracked:      ${unknownComponents.length}`, 'red');
  }
  log(`\nRadix UI dependencies:  ${allRadixDeps.size}`, 'dim');
  log(`External dependencies:  ${allExternalDeps.size}`, 'dim');
  
  console.log('');
}

main().catch(error => {
  log(`Fatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
