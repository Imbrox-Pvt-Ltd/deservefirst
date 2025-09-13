export interface Event {
  name: string;
  callback: (payload: any) => Promise<void>;
}
