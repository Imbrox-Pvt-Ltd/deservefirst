export const MemoryProvider = {
  tables: new Map<string, any[]>(),
  schemas: new Map<string, any>(),
  nextId: 1,

  configure: (config: any) => {
    // Memory database doesn't need configuration
  },

  createSchema: (definition: any, options: any) => {
    return definition;
  },

  model: async (name: string, schema: any) => {
    MemoryProvider.schemas.set(name, schema);
    if (!MemoryProvider.tables.has(name)) {
      MemoryProvider.tables.set(name, []);
    }
    return {
      tableName: name,
      schema: schema
    };
  },

  create: async (model: any, data: any) => {
    const table = MemoryProvider.tables.get(model.tableName) || [];
    const record = { id: MemoryProvider.nextId++, ...data };
    table.push(record);
    MemoryProvider.tables.set(model.tableName, table);
    return record;
  },

  find: async (model: any, query: any) => {
    const table = MemoryProvider.tables.get(model.tableName) || [];
    if (!query || Object.keys(query).length === 0) {
      return table;
    }
    return table.filter(record => {
      return Object.entries(query).every(([key, value]) => record[key] === value);
    });
  },

  findOne: async (model: any, query: any) => {
    const results = await MemoryProvider.find(model, query);
    return results[0] || null;
  },

  update: async (model: any, query: any, data: any, options: any) => {
    const table = MemoryProvider.tables.get(model.tableName) || [];
    let affectedRows = 0;
    
    for (let i = 0; i < table.length; i++) {
      const record = table[i];
      const matches = Object.entries(query).every(([key, value]) => record[key] === value);
      if (matches) {
        Object.assign(record, data);
        affectedRows++;
      }
    }
    
    return { affectedRows };
  },

  delete: async (model: any, query: any) => {
    const table = MemoryProvider.tables.get(model.tableName) || [];
    const initialLength = table.length;
    
    const filteredTable = table.filter(record => {
      return !Object.entries(query).every(([key, value]) => record[key] === value);
    });
    
    MemoryProvider.tables.set(model.tableName, filteredTable);
    return { affectedRows: initialLength - filteredTable.length };
  },
};

export { MemoryProvider as DatabaseProvider };