/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as vscode from 'vscode';

/**
 * Provides live preview of Object UI schemas
 */
export class PreviewProvider {
  private panels: Map<string, vscode.WebviewPanel> = new Map();
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * Show preview for a schema file
   */
  async showPreview(uri: vscode.Uri, toSide: boolean) {
    const panelKey = uri.toString();
    let panel = this.panels.get(panelKey);

    if (panel) {
      panel.reveal(
        toSide ? vscode.ViewColumn.Beside : vscode.ViewColumn.One
      );
    } else {
      panel = vscode.window.createWebviewPanel(
        'objectui.preview',
        `Preview: ${vscode.workspace.asRelativePath(uri)}`,
        toSide ? vscode.ViewColumn.Beside : vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );

      this.panels.set(panelKey, panel);

      panel.onDidDispose(() => {
        this.panels.delete(panelKey);
      });

      // Update preview content
      await this.updatePreviewContent(panel, uri);

      // Watch for changes
      const watcher = vscode.workspace.createFileSystemWatcher(uri.fsPath);
      watcher.onDidChange(async () => {
        await this.updatePreviewContent(panel!, uri);
      });

      panel.onDidDispose(() => {
        watcher.dispose();
      });
    }

    return panel;
  }

  /**
   * Update preview for a specific URI
   */
  async updatePreview(uri: vscode.Uri) {
    const panelKey = uri.toString();
    const panel = this.panels.get(panelKey);

    if (panel) {
      await this.updatePreviewContent(panel, uri);
    }
  }

  /**
   * Update webview content
   */
  private async updatePreviewContent(
    panel: vscode.WebviewPanel,
    uri: vscode.Uri
  ) {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const schemaText = document.getText();

      // Validate JSON
      let schema;
      try {
        schema = JSON.parse(schemaText);
      } catch (error) {
        panel.webview.html = this.getErrorHtml(
          `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`
        );
        return;
      }

      panel.webview.html = this.getPreviewHtml(schema, schemaText);
    } catch (error) {
      panel.webview.html = this.getErrorHtml(
        `Failed to load schema: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Generate preview HTML
   */
  private getPreviewHtml(schema: any, schemaText: string): string {
    const schemaJson = JSON.stringify(schema, null, 2);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Object UI Preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .preview-container {
      min-height: 100vh;
      background: #f9fafb;
    }
    .error-message {
      background: #fee2e2;
      color: #991b1b;
      padding: 1rem;
      margin: 1rem;
      border-radius: 0.5rem;
      border: 1px solid #fecaca;
    }
  </style>
</head>
<body>
  <div class="preview-container">
    <div id="root"></div>
  </div>

  <script type="module">
    // Note: In production, this would load the actual @object-ui/react renderer
    // For now, we'll provide a simplified preview
    const schema = ${schemaJson};

    function renderSchema(schema, container) {
      if (!schema || typeof schema !== 'object') {
        container.innerHTML = '<div class="error-message">Invalid schema</div>';
        return;
      }

      const element = createElementFromSchema(schema);
      container.appendChild(element);
    }

    function createElementFromSchema(schema) {
      const type = schema.type || 'div';
      const element = document.createElement(type === 'text' ? 'span' : 'div');

      // Apply className
      if (schema.className) {
        element.className = schema.className;
      }

      // Handle different types
      switch (type) {
        case 'text':
          element.textContent = schema.content || '';
          break;

        case 'input':
          const input = document.createElement('input');
          input.type = schema.inputType || 'text';
          input.placeholder = schema.placeholder || '';
          input.className = 'border rounded px-3 py-2 w-full';
          if (schema.label) {
            const label = document.createElement('label');
            label.className = 'block text-sm font-medium mb-1';
            label.textContent = schema.label;
            element.appendChild(label);
          }
          element.appendChild(input);
          break;

        case 'textarea':
          const textarea = document.createElement('textarea');
          textarea.placeholder = schema.placeholder || '';
          textarea.rows = schema.rows || 3;
          textarea.className = 'border rounded px-3 py-2 w-full';
          if (schema.label) {
            const label = document.createElement('label');
            label.className = 'block text-sm font-medium mb-1';
            label.textContent = schema.label;
            element.appendChild(label);
          }
          element.appendChild(textarea);
          break;

        case 'button':
          const button = document.createElement('button');
          button.textContent = schema.label || 'Button';
          button.className = 'bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700';
          element.appendChild(button);
          break;

        case 'card':
          element.className = \`bg-white rounded-lg shadow p-6 \${schema.className || ''}\`;
          if (schema.title) {
            const title = document.createElement('h3');
            title.className = 'text-xl font-bold mb-2';
            title.textContent = schema.title;
            element.appendChild(title);
          }
          if (schema.description) {
            const desc = document.createElement('p');
            desc.className = 'text-gray-600 mb-4';
            desc.textContent = schema.description;
            element.appendChild(desc);
          }
          // children is the one child-list spelling -- see the container
          // branch below.
          const cardChildren = schema.children;
          if (cardChildren) {
            const body = Array.isArray(cardChildren) ? cardChildren : [cardChildren];
            body.forEach(child => {
              element.appendChild(createElementFromSchema(child));
            });
          }
          break;

        case 'separator':
          element.className = \`border-t \${schema.className || ''}\`;
          break;

        default:
          // Handle generic div/container.
          //
          // children is the one child-list spelling. This guard used to name
          // schema.body alone, so a node spelling its child list children --
          // the spelling the TypeScript declaration, the zod mirror, core's
          // validator and the manifest tier all bless -- rendered as an EMPTY
          // element: no error, no diagnostic, just a blank preview
          // (objectui#7181). objectui#6771 retired body, so the second arm is
          // gone and the preview shows what the runtime will show.
          //
          // NOTE: this comment carries no backticks on purpose. It lives
          // INSIDE the webview's template literal, where an unescaped backtick
          // ends the string and the file stops parsing.
          const containerChildren = schema.children;
          if (containerChildren) {
            const body = Array.isArray(containerChildren) ? containerChildren : [containerChildren];
            body.forEach(child => {
              element.appendChild(createElementFromSchema(child));
            });
          } else if (schema.content) {
            element.textContent = schema.content;
          }
      }

      return element;
    }

    // Render the schema
    const root = document.getElementById('root');
    renderSchema(schema, root);
  </script>
</body>
</html>`;
  }

  /**
   * Generate error HTML
   */
  private getErrorHtml(message: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      padding: 2rem;
      background: #fee2e2;
    }
    .error {
      background: white;
      padding: 1.5rem;
      border-radius: 0.5rem;
      border-left: 4px solid #dc2626;
    }
    .error h2 {
      color: #dc2626;
      margin: 0 0 0.5rem 0;
    }
    .error p {
      color: #4b5563;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="error">
    <h2>Preview Error</h2>
    <p>${message}</p>
  </div>
</body>
</html>`;
  }

  /**
   * Dispose all panels
   */
  dispose() {
    this.panels.forEach((panel) => panel.dispose());
    this.panels.clear();
  }
}
