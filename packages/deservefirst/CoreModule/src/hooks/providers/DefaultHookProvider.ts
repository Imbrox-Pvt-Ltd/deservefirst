import { HookProvider, HookCallback } from '../Hooks';

const hooks: { [key: string]: HookCallback[] } = {};

export const DefaultHookProvider = {
  configure: () => { /* Initialize if needed */ },
  execute: async (hookName: string, payload: any) => {
    const callbacks = hooks[hookName] || [];
    for (const callback of callbacks) {
      await callback(payload);
    }
  },
  register: (hookName: string, callback: HookCallback) => {
    hooks[hookName] = hooks[hookName] || [];
    hooks[hookName].push(callback);
  },
};

export { DefaultHookProvider as HookProvider };
