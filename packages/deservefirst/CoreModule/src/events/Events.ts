export interface EventCallback {
  (payload: any): Promise<void>;
}

export class Events {
  static dispatch(eventName: string, payload: any) {
    EventProvider.dispatch(eventName, payload);
  }

  static subscribe(eventName: string, callback: EventCallback) {
    EventProvider.subscribe(eventName, callback);
  }
}

export let EventProvider = {
  configure: () => { /* Initialize event system */ },
  dispatch: (eventName: string, payload: any) => { /* Default implementation */ },
  subscribe: (eventName: string, callback: EventCallback) => { /* Default implementation */ },
};
