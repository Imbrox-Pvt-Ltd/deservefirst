import { EventProvider, EventCallback } from '../Events';

const events: { [key: string]: EventCallback[] } = {};

export const DefaultEventProvider = {
  configure: () => { /* Initialize if needed */ },
  dispatch: (eventName: string, payload: any) => {
    const callbacks = events[eventName] || [];
    for (const callback of callbacks) {
      callback(payload);
    }
  },
  subscribe: (eventName: string, callback: EventCallback) => {
    events[eventName] = events[eventName] || [];
    events[eventName].push(callback);
  },
};

export { DefaultEventProvider as EventProvider };
