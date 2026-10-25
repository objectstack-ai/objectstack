/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as vscode from 'vscode';
import { PreviewProvider } from './providers/PreviewProvider';
import { SchemaValidator } from './providers/SchemaValidator';
import { CompletionProvider } from './providers/CompletionProvider';
import { HoverProvider } from './providers/HoverProvider';

let previewProvider: PreviewProvider | undefined;

/**
 * Extension activation entry point
 */
export function activate(context: vscode.ExtensionContext) {
  // Initialize providers
  const schemaValidator = new SchemaValidator();
  const completionProvider = new CompletionProvider();
  const hoverProvider = new HoverProvider();
  previewProvider = new PreviewProvider(context);

  // Register completion provider for JSON files
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      [
        { language: 'json', pattern: '**/*.objectui.json' },
        { language: 'json', pattern: '**/*.oui.json' },
        { language: 'json', pattern: '**/app.json' },
        { language: 'jsonc', pattern: '**/*.objectui.json' },
        { language: 'jsonc', pattern: '**/*.oui.json' },
        { language: 'objectui-json' }
      ],
      completionProvider,
      '"', // Trigger on quote
      ':', // Trigger on colon
      ' '  // Trigger on space
    )
  );

  // Register hover provider
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      [
        { language: 'json', pattern: '**/*.objectui.json' },
        { language: 'json', pattern: '**/*.oui.json' },
        { language: 'jsonc', pattern: '**/*.objectui.json' },
        { language: 'jsonc', pattern: '**/*.oui.json' },
        { language: 'objectui-json' }
      ],
      hoverProvider
    )
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('objectui.preview', async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        await previewProvider?.showPreview(editor.document.uri, false);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('objectui.previewToSide', async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        await previewProvider?.showPreview(editor.document.uri, true);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('objectui.validate', async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        await schemaValidator.validateDocument(editor.document);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('objectui.format', async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        await formatSchema(editor);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('objectui.exportToReact', async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        await exportToReact(editor);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('objectui.newSchema', async () => {
      await createNewSchema();
    })
  );

  // Watch for file changes to update preview
  const config = vscode.workspace.getConfiguration('objectui');
  if (config.get('preview.autoRefresh')) {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (isObjectUISchema(document)) {
          previewProvider?.updatePreview(document.uri);
        }
      })
    );
  }

  // Validate on open and save
  if (config.get('validation.enabled')) {
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (isObjectUISchema(document)) {
          schemaValidator.validateDocument(document);
        }
      })
    );

    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (isObjectUISchema(document)) {
          schemaValidator.validateDocument(document);
        }
      })
    );
  }
}

/**
 * Extension deactivation
 */
export function deactivate() {
  previewProvider?.dispose();
}

/**
 * Check if document is an Object UI schema
 */
function isObjectUISchema(document: vscode.TextDocument): boolean {
  const fileName = document.fileName;
  return (
    fileName.endsWith('.objectui.json') ||
    fileName.endsWith('.oui.json') ||
    fileName.endsWith('app.json') ||
    document.languageId === 'objectui-json'
  );
}

/**
 * Format schema with proper indentation
 */
async function formatSchema(editor: vscode.TextEditor) {
  try {
    const document = editor.document;
    const text = document.getText();
    const config = vscode.workspace.getConfiguration('objectui');
    const indentSize = config.get<number>('format.indentSize', 2);

    const json = JSON.parse(text);
    const formatted = JSON.stringify(json, null, indentSize);

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(text.length)
    );
    edit.replace(document.uri, fullRange, formatted);

    await vscode.workspace.applyEdit(edit);
    await document.save();

    vscode.window.showInformationMessage('Schema formatted successfully');
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to format schema: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Export schema to React component
 */
async function exportToReact(editor: vscode.TextEditor) {
  try {
    const document = editor.document;
    const text = document.getText();
    const schema = JSON.parse(text);

    const componentCode = generateReactComponent(schema);

    const doc = await vscode.workspace.openTextDocument({
      content: componentCode,
      language: 'typescriptreact',
    });

    await vscode.window.showTextDocument(doc);

    vscode.window.showInformationMessage(
      'React component generated! Save it to a .tsx file.'
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to export to React: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate React component from schema
 *
 * The emitted `schema` constant is annotated with `SchemaRendererProps['schema']`
 * (objectui#11515). Unannotated, every `type` in it widens to `string`, which a
 * prop that discriminates on the literal `type` refuses. `SchemaNode` was the
 * first candidate and does not fit: it also admits `number` and `boolean`, which
 * the prop leaves out, and the narrowing at the initializer does not reach the
 * component's body, so the one JSX line was refused for every schema.
 */
function generateReactComponent(schema: any): string {
  const schemaJson = JSON.stringify(schema, null, 2);

  return `// No React import: under the automatic JSX runtime ("jsx": "react-jsx",
// what a new Vite or Next project is configured with) nothing here reads that
// identifier, so it compiles as an unused local. Add the import back only if
// this file is built with the classic "jsx": "react" transform.
import { SchemaRenderer, type SchemaRendererProps } from '@object-ui/react';
// Importing the package registers every default renderer as a side effect —
// there is no separate registration call.
import '@object-ui/components';

// Typed as the schema SchemaRenderer takes, so each "type" below stays a literal
// and the compiler checks the schema against the node types it accepts.
const schema: SchemaRendererProps['schema'] = ${schemaJson};

export default function GeneratedComponent() {
  return <SchemaRenderer schema={schema} />;
}
`;
}

/**
 * Create new schema from template
 */
async function createNewSchema() {
  const templates = [
    { label: 'Empty Schema', value: 'empty' },
    { label: 'Simple Form', value: 'form' },
    { label: 'Dashboard', value: 'dashboard' },
    { label: 'Card Layout', value: 'card' },
    { label: 'Data Table', value: 'table' },
  ];

  const selected = await vscode.window.showQuickPick(templates, {
    placeHolder: 'Select a template',
  });

  if (!selected) {
    return;
  }

  const schemaContent = getTemplateSchema(selected.value);

  const doc = await vscode.workspace.openTextDocument({
    content: schemaContent,
    language: 'json',
  });

  const editor = await vscode.window.showTextDocument(doc);

  // Suggest filename
  const fileName = await vscode.window.showInputBox({
    prompt: 'Enter filename (without extension)',
    value: 'app',
  });

  if (fileName) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      const filePath = vscode.Uri.joinPath(
        workspaceFolder.uri,
        `${fileName}.objectui.json`
      );

      await vscode.workspace.fs.writeFile(
        filePath,
        Buffer.from(schemaContent)
      );

      const savedDoc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(savedDoc);
    }
  }
}

/**
 * Get template schema by type
 */
function getTemplateSchema(type: string): string {
  const templates: Record<string, any> = {
    empty: {
      type: 'div',
      className: 'p-4',
      children: {
        type: 'text',
        content: 'Hello Object UI!',
      },
    },
    form: {
      type: 'div',
      className: 'max-w-2xl mx-auto p-6',
      children: {
        type: 'card',
        title: 'Contact Form',
        children: {
          type: 'div',
          className: 'space-y-4',
          children: [
            {
              type: 'input',
              label: 'Name',
              placeholder: 'Enter your name',
              required: true,
            },
            {
              type: 'input',
              label: 'Email',
              inputType: 'email',
              placeholder: 'your@email.com',
              required: true,
            },
            {
              type: 'textarea',
              label: 'Message',
              placeholder: 'Your message...',
              rows: 4,
            },
            {
              type: 'button',
              label: 'Submit',
              className: 'mt-4',
            },
          ],
        },
      },
    },
    dashboard: {
      type: 'div',
      className: 'min-h-screen p-6',
      children: [
        {
          type: 'div',
          className: 'mb-6',
          children: {
            type: 'text',
            content: 'Dashboard',
            className: 'text-3xl font-bold',
          },
        },
        {
          type: 'div',
          className: 'grid gap-4 md:grid-cols-3',
          children: [
            {
              type: 'card',
              title: 'Total Users',
              children: {
                type: 'text',
                content: '1,234',
                className: 'text-2xl font-bold',
              },
            },
            {
              type: 'card',
              title: 'Revenue',
              children: {
                type: 'text',
                content: '$56,789',
                className: 'text-2xl font-bold',
              },
            },
            {
              type: 'card',
              title: 'Orders',
              children: {
                type: 'text',
                content: '432',
                className: 'text-2xl font-bold',
              },
            },
          ],
        },
      ],
    },
    card: {
      type: 'div',
      className: 'max-w-md mx-auto p-6',
      children: {
        type: 'card',
        title: 'Card Title',
        description: 'This is a card description',
        children: {
          type: 'text',
          content: 'Card content goes here',
        },
      },
    },
    table: {
      type: 'div',
      className: 'p-6',
      children: {
        type: 'card',
        title: 'Data Table',
        children: {
          type: 'text',
          content: 'Table component coming soon...',
        },
      },
    },
  };

  return JSON.stringify(templates[type] || templates.empty, null, 2);
}
