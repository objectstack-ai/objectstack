const fs = require('fs');
const path = require('path');
// const glob = require('glob');

const targetVersion = process.argv[2];

if (!targetVersion) {
  console.error('Please provide a version number');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
const packages = [
  'packages/*/package.json',
  'apps/*/package.json',
  // 'examples/*/package.json' // Examples might not need sync, but let's leave them for now unless requested
];

// Combine patterns and find files
let files = [];
packages.forEach(pattern => {
    // We need to implement simple globbing or use a library if available. 
    // Since I cannot rely on 'glob' package being installed in the root, I'll implementations simple dir reading.
    // Actually, I can use glob pattern if I knew 'glob' is installed. "glob" is not in root package.json.
    // So I will write manual directory traversal.
    
    const parts = pattern.split('/'); // ['packages', '*', 'package.json']
    const baseDir = path.join(rootDir, parts[0]);
    
    if (fs.existsSync(baseDir)) {
        const dirs = fs.readdirSync(baseDir);
        dirs.forEach(dir => {
            const pkgFile = path.join(baseDir, dir, 'package.json');
            if (fs.existsSync(pkgFile)) {
                files.push(pkgFile);
            }
        });
    }
});

console.log(`Updating ${files.length} packages to version ${targetVersion}...`);

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  const json = JSON.parse(content);
  const oldVersion = json.version;
  json.version = targetVersion;
  
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  console.log(`${json.name}: ${oldVersion} -> ${targetVersion}`);
});

console.log('Done.');
