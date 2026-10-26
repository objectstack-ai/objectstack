/**
 * Mock Data Source
 *
 * A simple in-memory data source that demonstrates the DataSource interface.
 * In a real application, replace this with calls to your REST API, GraphQL, etc.
 *
 * The runtime (list / form / detail) drives every schema-aware component off
 * `getObjectSchema(objectName)`, which must return the object's `fields` as a
 * **map** (`{ [fieldName]: fieldDef }`) plus optional top-level `fieldGroups`.
 * The `contact` object below declares `fieldGroups` so the runtime ObjectForm
 * renders grouped sections — matching the designer.
 */

interface DataSource {
  find(objectName: string, params?: any): Promise<any>;
  findOne(objectName: string, id: string): Promise<any>;
  create(objectName: string, data: any): Promise<any>;
  update(objectName: string, id: string, data: any): Promise<any>;
  delete(objectName: string, id: string): Promise<boolean>;
  getObjectSchema(objectName: string): Promise<any>;
  getMetadata(): Promise<any>;
}

// Mock data storage
const mockData: Record<string, any[]> = {
  contact: [
    { id: '1', name: 'John Doe', email: 'john@example.com', phone: '555-1234', notes: 'VIP customer' },
    { id: '2', name: 'Jane Smith', email: 'jane@example.com', phone: '555-5678', notes: '' },
  ],
  account: [
    { id: '1', name: 'Acme Corp', industry: 'Technology', website: 'acme.com' },
    { id: '2', name: 'Global Inc', industry: 'Manufacturing', website: 'global.com' },
  ],
};

/**
 * Per-object schemas keyed by object name. `fields` is a map (not an array) and
 * `contact` carries `fieldGroups` + per-field `group` to exercise grouped form
 * sections at runtime.
 */
const objectSchemas: Record<string, any> = {
  contact: {
    name: 'contact',
    label: 'Contacts',
    fieldGroups: [
      // `collapsible` renders a chevron toggle on the section header; `collapsed`
      // would start the group closed. Each group spans the full form width.
      { key: 'identity', label: 'Identity', collapsible: true },
      { key: 'contact_info', label: 'Contact Info', collapsible: true },
    ],
    fields: {
      name: { name: 'name', label: 'Name', type: 'text', required: true, group: 'identity' },
      email: { name: 'email', label: 'Email', type: 'email', group: 'contact_info' },
      phone: { name: 'phone', label: 'Phone', type: 'text', group: 'contact_info' },
      // No `group` → renders in the trailing ungrouped section.
      notes: { name: 'notes', label: 'Notes', type: 'textarea' },
    },
    views: [{ id: 'grid', name: 'All Contacts', type: 'grid' }],
  },
  account: {
    name: 'account',
    label: 'Accounts',
    fields: {
      name: { name: 'name', label: 'Name', type: 'text', required: true },
      industry: { name: 'industry', label: 'Industry', type: 'text' },
      website: { name: 'website', label: 'Website', type: 'url' },
    },
    views: [{ id: 'grid', name: 'All Accounts', type: 'grid' }],
  },
};

export const mockDataSource: DataSource = {
  async find(objectName: string, _params?: any) {
    await delay(300); // Simulate network delay
    const data = mockData[objectName] || [];
    return {
      data,
      total: data.length,
    };
  },

  async findOne(objectName: string, id: string) {
    await delay(200);
    const data = mockData[objectName] || [];
    const record = data.find((r) => r.id === id);
    if (!record) {
      throw new Error(`Record not found: ${objectName}/${id}`);
    }
    return record;
  },

  async create(objectName: string, data: any) {
    await delay(300);
    const newId = String(mockData[objectName]?.length ?? 0) + '-' + (data.name || 'rec');
    const newRecord = { ...data, id: newId };

    if (!mockData[objectName]) {
      mockData[objectName] = [];
    }
    mockData[objectName].push(newRecord);

    return newRecord;
  },

  async update(objectName: string, id: string, data: any) {
    await delay(300);
    const records = mockData[objectName] || [];
    const index = records.findIndex((r) => r.id === id);

    if (index === -1) {
      throw new Error(`Record not found: ${objectName}/${id}`);
    }

    const updatedRecord = { ...records[index], ...data };
    mockData[objectName][index] = updatedRecord;

    return updatedRecord;
  },

  async delete(objectName: string, id: string) {
    await delay(300);
    const records = mockData[objectName] || [];
    const index = records.findIndex((r) => r.id === id);

    if (index === -1) {
      throw new Error(`Record not found: ${objectName}/${id}`);
    }

    mockData[objectName].splice(index, 1);
    return true;
  },

  async getObjectSchema(objectName: string) {
    await delay(150);
    const schema = objectSchemas[objectName];
    if (!schema) {
      throw new Error(`Unknown object: ${objectName}`);
    }
    return schema;
  },

  async getMetadata() {
    await delay(200);
    return { objects: Object.values(objectSchemas) };
  },
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
