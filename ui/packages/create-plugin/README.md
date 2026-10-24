# @object-ui/create-plugin

CLI tool to quickly scaffold new ObjectUI plugins with best practices.

## Usage

```bash
# Using pnpm
pnpm create @object-ui/plugin my-plugin

# Using npm
npm create @object-ui/plugin my-plugin

# Using npx
npx @object-ui/create-plugin my-plugin
```

## What Gets Generated

The tool creates a complete plugin package structure:

```
packages/plugin-my-plugin/
├── src/
│   ├── index.tsx           # Plugin export & registration
│   ├── MyPluginImpl.tsx    # Component implementation
│   ├── MyPluginImpl.test.tsx # Tests
│   └── types.ts            # Schema definitions
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.setup.ts         # Registers the jest-dom matchers
├── LICENSE                 # Full text of the licence you chose
└── README.md
```

## Features

- ✅ TypeScript support out of the box
- ✅ Vite build configuration
- ✅ Component registration with ComponentRegistry
- ✅ Runnable Vitest setup — jsdom environment, Testing Library and the jest-dom
  matchers are all declared, so `pnpm test` is green on the first run
- ✅ Proper package.json with workspace dependencies
- ✅ A LICENSE carrying the full text of the licence the manifest declares —
  never a `license` field with nothing behind it
- ✅ README template
- ✅ Type definitions

## Interactive Mode

Run without arguments for interactive prompts:

```bash
pnpm create @object-ui/plugin
```

You'll be prompted for:
- Plugin name
- Description
- Author name
- License — `MIT` (default), `Apache-2.0`, `BSD-3-Clause` or `ISC`

The licence you pick is written to `package.json` and its **full text** is written
to `LICENSE`, so a published tarball never claims a licence it does not carry. A
non-interactive run (no TTY, or a cancelled prompt) takes MIT and still writes the
text.

## Non-interactive Runs and Cancelling

One rule covers every answer you do not give: **it takes the default the prompt
offered, and the complete file set is still written.** There are two ways an
answer goes missing, and they behave the same way:

- **No TTY** — a pipe, a CI step, `create-plugin my-plugin < /dev/null`. Nothing
  is asked; every prompt takes its default and the plugin is scaffolded.
- **Cancelling** — Ctrl-C at a prompt. The questions stop there; the cancelled
  question and the ones after it take their defaults.

The **plugin name** is the one exception, because it is the one answer with no
default — a scaffolder cannot invent the package it is scaffolding. A run that
reaches the name prompt with no TTY, or cancels it, prints `Plugin name is
required` and exits `1` **without creating anything**. Pass the name as an
argument to scaffold non-interactively:

```bash
create-plugin my-plugin --author "Your Name" < /dev/null
```

`--description` and `--author` set the defaults their prompts start from, so they
are also what a non-interactive run writes.

## Options

```bash
pnpm create @object-ui/plugin my-plugin --description "My awesome plugin" --author "Your Name"
```

## After Creation

1. Navigate to the plugin directory:
   ```bash
   cd packages/plugin-my-plugin
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build the plugin:
   ```bash
   pnpm build
   ```

4. Run tests:
   ```bash
   pnpm test
   ```

## Links

- 📚 [Documentation](https://www.objectui.org/docs/guide/plugin-development)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/create-plugin)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
