export interface Hook {
  name: string;
  callback: (payload: any) => Promise<void>;
}
