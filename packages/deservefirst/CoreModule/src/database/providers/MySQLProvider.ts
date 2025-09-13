import mysql from 'mysql2/promise';
import { DatabaseProvider } from '../Database';

let pool: mysql.Pool;

export const MySQLProvider = {
  configure: (config: { url: string }) => {
    pool = mysql.createPool({
      uri: config.url,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  },

  createSchema: (definition: any, options: any) => {
    const fields = Object.entries(definition).map(([key, value]: [string, any]) => {
      let type = 'VARCHAR(255)';
      if (value.type === String) type = 'VARCHAR(255)';
      if (value.type === Number) type = 'INT';
      if (value.type === Boolean) type = 'BOOLEAN';
      if (value.type === Object) type = 'JSON';
      const constraints = value.required ? 'NOT NULL' : '';
      const index = value.index ? `INDEX idx_${key} (${key})` : '';
      const unique = value.unique ? `UNIQUE (${key})` : '';
      return `${key} ${type} ${constraints} ${index} ${unique}`.trim();
    }).join(', ');

    return {
      fields,
      options,
    };
  },

  model: async (name: string, schema: any) => {
    const tableName = name.toLowerCase();
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ${schema.fields},
        tenantId VARCHAR(255) NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_tenantId (tenantId)
      ) PARTITION BY HASH(tenantId) PARTITIONS 16;
    `;
    await pool.execute(createTableSQL);
    return { tableName };
  },

  create: async (model: any, data: any) => {
    const fields = Object.keys(data).join(', ');
    const placeholders = Object.keys(data).map(() => '?').join(', ');
    const values = Object.values(data);
    const sql = `INSERT INTO ${model.tableName} (${fields}) VALUES (${placeholders})`;
    const [result] = await pool.execute(sql, values);
    return { id: result.insertId, ...data };
  },

  find: async (model: any, query: any) => {
    const conditions = Object.entries(query).map(([key, value]) => `${key} = ?`).join(' AND ');
    const values = Object.values(query);
    const sql = `SELECT * FROM ${model.tableName} WHERE ${conditions || '1=1'}`;
    const [rows] = await pool.execute(sql, values);
    return rows;
  },

  findOne: async (model: any, query: any) => {
    const conditions = Object.entries(query).map(([key, value]) => `${key} = ?`).join(' AND ');
    const values = Object.values(query);
    const sql = `SELECT * FROM ${model.tableName} WHERE ${conditions || '1=1'} LIMIT 1`;
    const [rows] = await pool.execute(sql, values);
    return rows[0] || null;
  },

  update: async (model: any, query: any, data: any, options: any) => {
    const conditions = Object.entries(query).map(([key, value]) => `${key} = ?`).join(' AND ');
    const updates = Object.entries(data).map(([key]) => `${key} = ?`).join(', ');
    const values = [...Object.values(data), ...Object.values(query)];
    const sql = `UPDATE ${model.tableName} SET ${updates} WHERE ${conditions}`;
    const [result] = await pool.execute(sql, values);
    return { affectedRows: result.affectedRows };
  },

  delete: async (model: any, query: any) => {
    const conditions = Object.entries(query).map(([key, value]) => `${key} = ?`).join(' AND ');
    const values = Object.values(query);
    const sql = `DELETE FROM ${model.tableName} WHERE ${conditions}`;
    const [result] = await pool.execute(sql, values);
    return { affectedRows: result.affectedRows };
  },
};

DatabaseProvider = MySQLProvider;
