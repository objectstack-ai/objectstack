# @objectstack/client-react

React hooks for ObjectStack Client SDK - Type-safe data fetching and mutations for React applications.

## 🤖 AI Development Context

**Role**: React Bindings for Client SDK
**Usage**:
- Use `useQuery`, `useMutation` hooks.
- Similar to TanStack Query but specialized for ObjectStack.

## Installation

```bash
npm install @objectstack/client-react
# or
pnpm add @objectstack/client-react
# or
yarn add @objectstack/client-react
```

## Quick Start

### 1. Setup Provider

Wrap your app with `ObjectStackProvider`:

```tsx
import { ObjectStackClient } from '@objectstack/client';
import { ObjectStackProvider } from '@objectstack/client-react';

const client = new ObjectStackClient({
  baseUrl: 'http://localhost:3000'
});

function App() {
  return (
    <ObjectStackProvider client={client}>
      <YourApp />
    </ObjectStackProvider>
  );
}
```

### 2. Use Data Hooks

#### Query Data

```tsx
import { useQuery } from '@objectstack/client-react';

function TaskList() {
  const { data, isLoading, error, refetch } = useQuery('todo_task', {
    fields: ['id', 'subject', 'priority'],
    orderBy: ['-created_at'],
    limit: 20
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      {data?.records.map(task => (
        <div key={task.id}>{task.subject}</div>
      ))}
      <button onClick={refetch}>Refresh</button>
    </div>
  );
}
```

#### Mutate Data

```tsx
import type { FormEvent } from 'react';
import { useMutation } from '@objectstack/client-react';

function CreateTaskForm() {
  const { mutate, isLoading, error } = useMutation('todo_task', 'create', {
    onSuccess: (data) => {
      console.log('Task created:', data);
    }
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutate({
      subject: 'New Task',
      priority: 3
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* form fields */}
      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Creating...' : 'Create Task'}
      </button>
      {error && <div className="error">{error.message}</div>}
    </form>
  );
}
```

#### Pagination

```tsx
import { usePagination } from '@objectstack/client-react';

function PaginatedTaskList() {
  const {
    data,
    isLoading,
    page,
    totalPages,
    nextPage,
    previousPage,
    hasNextPage,
    hasPreviousPage
  } = usePagination('todo_task', {
    pageSize: 10,
    orderBy: ['-created_at']
  });

  return (
    <div>
      {data?.records.map(task => (
        <div key={task.id}>{task.subject}</div>
      ))}
      <div className="pagination">
        <button onClick={previousPage} disabled={!hasPreviousPage}>
          Previous
        </button>
        <span>Page {page} of {totalPages}</span>
        <button onClick={nextPage} disabled={!hasNextPage}>
          Next
        </button>
      </div>
    </div>
  );
}
```

#### Infinite Scrolling

```tsx
import { useInfiniteQuery } from '@objectstack/client-react';

function InfiniteTaskList() {
  const {
    flatData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = useInfiniteQuery('todo_task', {
    pageSize: 20,
    orderBy: ['-created_at']
  });

  return (
    <div>
      {flatData.map(task => (
        <div key={task.id}>{task.subject}</div>
      ))}
      {hasNextPage && (
        <button onClick={fetchNextPage} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  );
}
```

### 3. Use Metadata Hooks

#### Object Schema

```tsx
import { useObject } from '@objectstack/client-react';

function ObjectSchemaViewer({ objectName }: { objectName: string }) {
  const { data: schema, isLoading } = useObject(objectName);

  if (isLoading) return <div>Loading schema...</div>;

  return (
    <div>
      <h2>{schema.label}</h2>
      <p>Fields: {Object.keys(schema.fields).length}</p>
    </div>
  );
}
```

#### View Configuration

```tsx
import { useView } from '@objectstack/client-react';

function ViewConfiguration({ objectName }: { objectName: string }) {
  const { data: view, isLoading } = useView(objectName, 'list');

  if (isLoading) return <div>Loading view...</div>;

  return (
    <div>
      <h3>List View for {objectName}</h3>
      <p>Columns: {view?.columns?.length}</p>
    </div>
  );
}
```

#### Fields List

```tsx
import { useFields } from '@objectstack/client-react';

function FieldList({ objectName }: { objectName: string }) {
  const { data: fields, isLoading } = useFields(objectName);

  if (isLoading) return <div>Loading fields...</div>;

  return (
    <ul>
      {fields?.map(field => (
        <li key={field.name}>
          {field.label} ({field.type})
        </li>
      ))}
    </ul>
  );
}
```

## API Reference

### Data Hooks

- **`useQuery(object, options)`** - Query data with auto-refetch
- **`useMutation(object, operation, options)`** - Create, update, or delete data
- **`usePagination(object, options)`** - Paginated data queries
- **`useInfiniteQuery(object, options)`** - Infinite scrolling

### Metadata Hooks

- **`useObject(objectName, options)`** - Fetch object schema
- **`useView(objectName, viewType, options)`** - Fetch view configuration
- **`useFields(objectName, options)`** - Get fields list
- **`useMetadata(fetcher, options)`** - Custom metadata queries

### Context

- **`ObjectStackProvider`** - Context provider component
- **`useClient()`** - Access ObjectStackClient instance

## Type Safety

All hooks support TypeScript generics for type-safe data:

```tsx
interface Task {
  id: string;
  subject: string;
  priority: number;
  is_completed: boolean;
}

const { data } = useQuery<Task>('todo_task');
// data.records is typed as Task[]

const { mutate } = useMutation<Task, Partial<Task>>('todo_task', 'create');
// mutate expects Partial<Task>
```

## Common Patterns

### Master-Detail View

```tsx
import { useState } from 'react';
import { useQuery } from '@objectstack/client-react';

function TaskList() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: tasks } = useQuery('todo_task', {
    fields: ['id', 'subject'],
    orderBy: ['-created_at']
  });

  const { data: selectedTask } = useQuery('todo_task', {
    where: { id: selectedId },
    enabled: !!selectedId // Only fetch when ID is selected
  });

  return (
    <div className="flex">
      <TaskListPanel tasks={tasks?.records} onSelect={setSelectedId} />
      <TaskDetail task={selectedTask?.records?.[0]} />
    </div>
  );
}
```

### Optimistic Updates

```tsx
import { useState } from 'react';
import { useMutation } from '@objectstack/client-react';

function TaskToggle({ taskId, completed }: { taskId: string; completed: boolean }) {
  // `useMutation` has no mutation-context hook, so the optimistic value is held
  // locally and rolled back from `onError`.
  const [checked, setChecked] = useState(completed);

  const { mutate } = useMutation('todo_task', 'update', {
    onError: (error: Error) => {
      console.error('Update failed, reverting', error);
      setChecked(completed);
    }
  });

  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => {
        const next = e.target.checked;
        setChecked(next);
        // The `update` operation takes `{ id, data }`.
        mutate({ id: taskId, data: { is_completed: next } });
      }}
    />
  );
}
```

### Dependent Queries

```tsx
import { useQuery } from '@objectstack/client-react';

function ProjectTasks({ projectId }: { projectId: string }) {
  // First, get project details
  const { data: project } = useQuery('project', {
    where: { id: projectId }
  });

  // Then, get tasks for this project
  const { data: tasks } = useQuery('todo_task', {
    where: { project_id: projectId },
    enabled: !!project // Only fetch when project is loaded
  });

  return (
    <div>
      <h2>{project?.records?.[0]?.name}</h2>
      <TaskList tasks={tasks?.records} />
    </div>
  );
}
```

### Search with Debounce

```tsx
import { useDeferredValue, useState } from 'react';
import { useQuery } from '@objectstack/client-react';

function TaskSearch() {
  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearch = useDeferredValue(searchTerm);
  
  const { data, isLoading } = useQuery('todo_task', {
    where: { subject: { $contains: deferredSearch } },
    enabled: deferredSearch.length >= 3 // Only search with 3+ chars
  });
  
  return (
    <div>
      <input 
        type="text"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="Search tasks..."
      />
      {isLoading && <Spinner />}
      <TaskList tasks={data?.records} />
    </div>
  );
}
```

### Form with Validation

```tsx
function TaskForm() {
  const { mutate, isLoading, error } = useMutation('todo_task', 'create', {
    onSuccess: () => {
      router.push('/tasks');
    }
  });
  
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    mutate({
      subject: formData.get('subject'),
      priority: Number(formData.get('priority')),
      due_date: formData.get('due_date')
    });
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <input name="subject" required />
      <input name="priority" type="number" min="1" max="5" />
      <input name="due_date" type="date" />
      
      {error && (
        <div className="error">
          {error.code === 'validation_error' 
            ? 'Please check your input' 
            : error.message}
        </div>
      )}
      
      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Creating...' : 'Create Task'}
      </button>
    </form>
  );
}
```

## License

Apache-2.0. See [LICENSING.md](../../LICENSING.md).
