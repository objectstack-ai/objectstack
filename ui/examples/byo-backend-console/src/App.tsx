import { BrowserRouter, Routes, Route, Link, useParams } from 'react-router-dom';
import { AppShell } from '@object-ui/app-shell';
import { ObjectView } from '@object-ui/plugin-view';
import { ObjectForm } from '@object-ui/plugin-form';
import { ThemeProvider, DataSourceProvider } from '@object-ui/providers';
import { mockDataSource } from './mockDataSource';

/**
 * Minimal Console Example
 *
 * Demonstrates third-party ObjectUI integration in ~100 lines of code.
 * No console dependencies, full control over routing and layout.
 */

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="byo-backend-console-theme">
      <DataSourceProvider dataSource={mockDataSource}>
        <BrowserRouter>
          <AppShell sidebar={<Sidebar />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/form/:objectName" element={<ObjectFormPage />} />
              <Route path="/form-modal/:objectName" element={<ObjectFormModalPage />} />
              <Route path="/:objectName" element={<ObjectPage />} />
            </Routes>
          </AppShell>
        </BrowserRouter>
      </DataSourceProvider>
    </ThemeProvider>
  );
}

function Sidebar() {
  return (
    <nav className="flex h-full w-64 flex-col gap-2 p-4">
      <h1 className="mb-4 text-xl font-bold">Minimal Console</h1>

      <div className="space-y-1">
        <Link
          to="/"
          className="block rounded px-3 py-2 text-sm hover:bg-accent"
        >
          Home
        </Link>
        <Link
          to="/contact"
          className="block rounded px-3 py-2 text-sm hover:bg-accent"
        >
          Contacts
        </Link>
        <Link
          to="/account"
          className="block rounded px-3 py-2 text-sm hover:bg-accent"
        >
          Accounts
        </Link>
        <Link
          to="/form/contact"
          className="block rounded px-3 py-2 text-sm hover:bg-accent"
        >
          Contact Form (grouped)
        </Link>
        <Link
          to="/form-modal/contact"
          className="block rounded px-3 py-2 text-sm hover:bg-accent"
        >
          Contact Form (modal, grouped)
        </Link>
      </div>

      <div className="mt-auto border-t pt-4 text-xs text-muted-foreground">
        <p>Built with @object-ui/app-shell</p>
        <p>~100 lines of code</p>
      </div>
    </nav>
  );
}

function Home() {
  return (
    <div className="p-8">
      <h1 className="mb-4 text-3xl font-bold">Welcome to Minimal Console</h1>
      <p className="mb-6 text-muted-foreground">
        This is a demonstration of third-party ObjectUI integration using
        @object-ui/app-shell and @object-ui/providers.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h2 className="mb-2 text-xl font-semibold">Key Features</h2>
          <ul className="list-inside list-disc space-y-1 text-sm">
            <li>No console dependencies</li>
            <li>Custom routing with React Router</li>
            <li>Mock data source (replace with your API)</li>
            <li>~100 lines of integration code</li>
            <li>Full control over layout and navigation</li>
          </ul>
        </div>

        <div className="rounded-lg border p-4">
          <h2 className="mb-2 text-xl font-semibold">Try It Out</h2>
          <ul className="space-y-2 text-sm">
            <li>
              <Link to="/contact" className="text-primary hover:underline">
                View Contacts
              </Link>
            </li>
            <li>
              <Link to="/account" className="text-primary hover:underline">
                View Accounts
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="mt-8 rounded-lg bg-muted p-4">
        <h3 className="mb-2 font-semibold">What This Demonstrates</h3>
        <p className="text-sm">
          This example shows how to build a custom console using ObjectUI
          components without inheriting the full console infrastructure. You can:
        </p>
        <ul className="mt-2 list-inside list-disc text-sm">
          <li>Use your own backend API (not ObjectStack)</li>
          <li>Implement custom authentication</li>
          <li>Define your own routes and navigation</li>
          <li>Customize the layout and styling</li>
          <li>Cherry-pick only the components you need</li>
        </ul>
      </div>
    </div>
  );
}

/**
 * The grid columns of each object's named view. A named view on an
 * `object-view` node is the protocol's `ObjectListViewSchema`, which requires
 * `columns` (objectui#7928), so each object lists the fields it declares in
 * `mockDataSource.ts`.
 */
const LIST_COLUMNS: Record<string, string[]> = {
  contact: ['name', 'email', 'phone', 'notes'],
  account: ['name', 'industry', 'website'],
};

function ObjectPage() {
  const { objectName } = useParams<{ objectName: string }>();

  return (
    <div className="h-full">
      <ObjectView
        schema={{
          type: 'object-view',
          objectName: objectName || '',
          listViews: {
            default: { label: 'All', type: 'grid', columns: LIST_COLUMNS[objectName ?? ''] ?? ['name'] },
          },
        }}
        dataSource={mockDataSource}
      />
    </div>
  );
}

/**
 * Standalone simple ObjectForm. Unlike the grid's modal create/view dialogs,
 * this is the default `formType: 'simple'` form — so when the object declares
 * `fieldGroups` (see mockDataSource), the form renders grouped sections.
 */
function ObjectFormPage() {
  const { objectName } = useParams<{ objectName: string }>();

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-2xl font-bold">
        New {objectName} (simple form)
      </h1>
      <ObjectForm
        schema={{
          type: 'object-form',
          objectName: objectName || '',
          mode: 'create',
        }}
        dataSource={mockDataSource}
      />
    </div>
  );
}

/**
 * Modal ObjectForm with explicit `sections` — exercises the Card-wrapped
 * `FormSectionContainer` path (formType: 'modal'/'split'/'tabbed'/'wizard' all share
 * it), as opposed to `ObjectFormPage` above which renders the flat
 * divider-only path used by the default `formType: 'simple'` + `fieldGroups`.
 */
function ObjectFormModalPage() {
  const { objectName } = useParams<{ objectName: string }>();

  return (
    <ObjectForm
      schema={{
        type: 'object-form',
        objectName: objectName || '',
        mode: 'create',
        formType: 'modal',
        title: `New ${objectName}`,
        description: 'Card-wrapped section layout (formType: modal).',
        open: true,
        sections: [
          { name: 'identity', label: 'Identity', fields: ['name'] },
          { name: 'contact_info', label: 'Contact Info', fields: ['email', 'phone', 'notes'] },
        ],
      }}
      dataSource={mockDataSource}
    />
  );
}

export default App;
