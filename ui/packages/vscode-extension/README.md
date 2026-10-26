# Object UI VSCode Extension

The official VSCode extension for [Object UI](https://www.objectui.org) - the universal schema-driven UI engine.

## ✨ Features

### 🎨 **Syntax Highlighting**
Beautiful syntax highlighting for Object UI JSON schemas with intelligent color coding for component types, properties, and values.

### 🧠 **IntelliSense & Auto-completion**
- Smart auto-completion for component types
- Context-aware property suggestions
- Tailwind CSS class hints
- Snippet support for common patterns

### 🔍 **Schema Validation**
- Real-time JSON validation
- Type-specific property validation
- Accessibility warnings
- Best practice recommendations

### 👁️ **Live Preview**
- Instant visual preview of your schemas
- Side-by-side editing and preview
- Auto-refresh on save
- Error highlighting

### 🚀 **Productivity Tools**
- Export schemas to React components
- Format schemas with proper indentation
- Create new schemas from templates
- Code snippets for rapid development

## 📦 Installation

### From VSCode Marketplace

1. Open VSCode
2. Press `Ctrl+P` / `Cmd+P`
3. Type `ext install objectui.object-ui`
4. Press Enter

### From Source

```bash
# Clone the repository
git clone https://github.com/objectstack-ai/objectui.git
cd objectui/packages/vscode-extension

# Install dependencies
pnpm install

# Build the extension
pnpm build

# Package the extension
pnpm package

# Install the .vsix file in VSCode
code --install-extension object-ui-*.vsix
```

## 🚀 Quick Start

1. **Create a new file** with extension `.objectui.json` or `.oui.json`
2. **Start typing** and enjoy IntelliSense suggestions
3. **Preview** by clicking the preview icon in the editor toolbar
4. **Export** to React when ready for production

### Example Schema

Create a file `app.objectui.json`:

```json
{
  "type": "div",
  "className": "p-6",
  "children": {
    "type": "card",
    "title": "Hello Object UI",
    "children": {
      "type": "text",
      "content": "This is a schema-driven UI!"
    }
  }
}
```

Press the preview button to see it live!

## 📝 Snippets

Type these prefixes and press `Tab` to insert code snippets:

| Prefix | Description |
|--------|-------------|
| `oui-empty` | Empty schema template |
| `oui-form` | Complete form with inputs |
| `oui-card` | Card component |
| `oui-input` | Input field |
| `oui-textarea` | Textarea field |
| `oui-button` | Button component |
| `oui-text` | Text component |
| `oui-grid` | Grid layout |
| `oui-flex` | Flex layout |
| `oui-dashboard` | Dashboard template |
| `oui-container` | Container with max-width |
| `oui-separator` | Horizontal separator |

## 🎯 Commands

Access these commands via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- **Object UI: Open Preview** - Open preview in current column
- **Object UI: Open Preview to the Side** - Open preview side-by-side
- **Object UI: Validate Schema** - Validate the current schema
- **Object UI: Format Schema** - Format with proper indentation
- **Object UI: Export to React Component** - Generate React component code
- **Object UI: Create New Schema** - Create from template

## ⚙️ Configuration

Customize the extension behavior in VSCode settings:

```jsonc
{
  // Preview settings
  "objectui.preview.port": 3000,
  "objectui.preview.autoRefresh": true,
  
  // Validation settings
  "objectui.validation.enabled": true,
  
  // Completion settings
  "objectui.completion.enabled": true,
  
  // Formatting settings
  "objectui.format.indentSize": 2
}
```

## 🎨 File Associations

The extension automatically activates for:

- `*.objectui.json` - Dedicated Object UI schemas
- `*.oui.json` - Short form schemas
- `app.json` - Common schema filename

## 🔧 Development

### Setup

```bash
# Install dependencies
pnpm install

# Build the extension
pnpm build

# Watch mode for development
pnpm dev
```

### Testing

```bash
# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch
```

### Packaging

```bash
# Create .vsix package
pnpm package

# Publish to marketplace (requires publisher account)
pnpm publish
```

## 📚 Documentation

- [Object UI Documentation](https://www.objectui.org)
- [Schema Reference](https://www.objectui.org/docs/api/schema-reference)
- [Component Library](https://www.objectui.org/docs/components)
- [Examples](https://github.com/objectstack-ai/objectui/tree/main/examples)

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](../../CONTRIBUTING.md) for details.

### Reporting Issues

Found a bug? Have a feature request? [Open an issue](https://github.com/objectstack-ai/objectui/issues) on GitHub.

## 📄 License

MIT License - see [LICENSE](../../LICENSE) for details.

## 🙏 Acknowledgments

Built with:
- [VSCode Extension API](https://code.visualstudio.com/api)
- [Object UI](https://www.objectui.org)
- [Tailwind CSS](https://tailwindcss.com)

---

<div align="center">

**Made with ❤️ by the [Object UI Team](https://github.com/objectstack-ai)**

[Website](https://www.objectui.org) · [Documentation](https://www.objectui.org/docs) · [GitHub](https://github.com/objectstack-ai/objectui)

</div>

## Links

- 📚 [Documentation](https://www.objectui.org/docs/utilities/vscode-extension)
- 📦 [npm package](https://www.npmjs.com/package/object-ui)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](https://github.com/objectstack-ai/objectui/blob/main/LICENSE).
