import { JSONSchemaType } from 'ajv';

export interface ConfigField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'textarea';
  default: any;
  permission: string;
  validators?: {
    min?: number;
    max?: number;
    regex?: string;
  };
  options?: { value: string; label: string }[];
  required: boolean;
}

export const SettingsSchema: JSONSchemaType<ConfigField[]> = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      type: { type: 'string', enum: ['text', 'number', 'select', 'boolean', 'textarea'] },
      default: {},
      permission: { type: 'string' },
      validators: {
        type: 'object',
        properties: {
          min: { type: 'number', nullable: true },
          max: { type: 'number', nullable: true },
          regex: { type: 'string', nullable: true },
        },
        nullable: true,
      },
      options: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            value: { type: 'string' },
            label: { type: 'string' },
          },
          required: ['value', 'label'],
        },
        nullable: true,
      },
      required: { type: 'boolean' },
    },
    required: ['id', 'label', 'type', 'default', 'permission', 'required'],
  },
};
