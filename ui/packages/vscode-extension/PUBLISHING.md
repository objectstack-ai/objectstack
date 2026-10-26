# Publishing the Object UI VSCode Extension

This guide covers how to publish the extension to the Visual Studio Code Marketplace.

## Prerequisites

1. **Microsoft Account**: You need a Microsoft account to create a publisher
2. **Azure DevOps Organization**: Required for publishing
3. **Personal Access Token (PAT)**: For authentication

## Setup

### 1. Create a Publisher

1. Go to [Visual Studio Marketplace Publisher Management](https://marketplace.visualstudio.com/manage)
2. Sign in with your Microsoft account
3. Click "Create Publisher"
4. Fill in the details:
   - Publisher ID: `objectui` (must match `publisher` in package.json)
   - Display name: Object UI
   - Description: Official publisher for Object UI

### 2. Get a Personal Access Token

1. Go to [Azure DevOps](https://dev.azure.com/)
2. Click on your profile → Personal Access Tokens
3. Click "New Token"
4. Settings:
   - Name: "VSCode Marketplace - Object UI"
   - Organization: All accessible organizations
   - Expiration: Custom (1 year recommended)
   - Scopes: **Marketplace** → **Manage**
5. Copy the token (you won't see it again!)

### 3. Configure vsce

```bash
# Install vsce globally (if not already installed)
npm install -g @vscode/vsce

# Login with your publisher
vsce login objectui
# Enter your Personal Access Token when prompted
```

## Build and Test

### 1. Build the Extension

```bash
cd packages/vscode-extension

# Install dependencies
pnpm install

# Build
pnpm build
```

### 2. Test Locally

```bash
# Package the extension (creates .vsix file)
pnpm package

# Install in VSCode for testing
code --install-extension object-ui-0.1.0.vsix

# Test the extension
# 1. Open a .objectui.json file
# 2. Try auto-completion
# 3. Open preview
# 4. Test all commands
```

### 3. Validate

```bash
# Verify the package
vsce ls

# Should list all files that will be included
# Make sure no unnecessary files are included
```

## Publishing

### First Release

```bash
# From packages/vscode-extension directory

# Publish to marketplace
pnpm publish

# Or manually with vsce
vsce publish
```

This will:
1. Run `vscode:prepublish` script (builds the extension)
2. Package the extension
3. Upload to the marketplace
4. Make it available within a few minutes

### Subsequent Releases

1. **Update version** in `package.json`:
   ```bash
   # Patch version (0.1.0 → 0.1.1)
   vsce publish patch
   
   # Minor version (0.1.0 → 0.2.0)
   vsce publish minor
   
   # Major version (0.1.0 → 1.0.0)
   vsce publish major
   ```

2. **Update CHANGELOG.md** with changes

3. **Commit changes**:
   ```bash
   git add .
   git commit -m "Release v0.1.1"
   git push
   ```

4. **Create GitHub Release**:
   - Go to GitHub releases
   - Create new release
   - Tag version: `vscode-extension-v0.1.1`
   - Attach the `.vsix` file
   - Document changes

## Pre-release Versions

For beta testing:

```bash
# Publish as pre-release
vsce publish --pre-release
```

Users can opt-in to pre-release versions in VSCode.

## Unpublishing

**Warning**: This removes the extension from the marketplace.

```bash
# Unpublish a specific version
vsce unpublish objectui.object-ui@0.1.0

# Unpublish all versions (careful!)
vsce unpublish objectui.object-ui
```

## Post-Publishing

### 1. Verify on Marketplace

- Visit: https://marketplace.visualstudio.com/items?itemName=objectui.object-ui
- Check that all information displays correctly
- Test installation from marketplace

### 2. Update Repository

Add marketplace badge to README:

```markdown
[![VSCode Marketplace](https://img.shields.io/vscode-marketplace/v/objectui.object-ui.svg)](https://marketplace.visualstudio.com/items?itemName=objectui.object-ui)
```

### 3. Announce

- Update main Object UI README
- Post on GitHub Discussions
- Share on social media
- Update documentation

## Troubleshooting

### Issue: "Publisher not found"

**Solution**: Make sure the `publisher` field in package.json matches your publisher ID.

### Issue: "Missing icon.png"

**Solution**: Either:
1. Convert icon.svg to icon.png (see ICON.md)
2. Remove the `icon` field from package.json (not recommended)

### Issue: "Package size too large"

**Solution**: Check `.vscodeignore` to exclude unnecessary files:
- Source files (src/)
- Test files
- Configuration files (tsconfig.json, etc.)
- node_modules is already excluded by default

### Issue: "Build fails during publish"

**Solution**: Test the build locally first:
```bash
pnpm build
pnpm package
```

## Automated Publishing (CI/CD)

For automated releases via GitHub Actions:

```yaml
# .github/workflows/publish-vscode.yml
name: Publish VSCode Extension

on:
  push:
    tags:
      - 'vscode-extension-v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - uses: pnpm/action-setup@v2
        with:
          version: 9
      
      - uses: actions/setup-node@v3
        with:
          node-version: 18
          cache: 'pnpm'
      
      - run: pnpm install
      
      - name: Publish to Marketplace
        working-directory: packages/vscode-extension
        run: pnpm publish
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}
```

Add `VSCE_PAT` secret to your GitHub repository settings.

## Best Practices

1. **Test thoroughly** before publishing
2. **Update CHANGELOG.md** with every release
3. **Use semantic versioning** (major.minor.patch)
4. **Keep icon simple** and recognizable at small sizes
5. **Write clear descriptions** in package.json
6. **Respond to user feedback** and issues promptly
7. **Maintain backward compatibility** when possible

## Resources

- [VSCode Extension Publishing Guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Extension Manifest Reference](https://code.visualstudio.com/api/references/extension-manifest)
- [Marketplace Publisher Portal](https://marketplace.visualstudio.com/manage)
- [vsce CLI Documentation](https://github.com/microsoft/vscode-vsce)

## Support

For issues related to publishing, contact:
- VSCode Marketplace Support: https://aka.ms/vsmarketplace-help
- Object UI Team: hello@objectui.org
