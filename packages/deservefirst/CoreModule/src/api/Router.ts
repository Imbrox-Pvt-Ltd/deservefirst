export const Router = () => RouterProvider.createRouter();

export let RouterProvider = {
  configure: () => { throw new Error('RouterProvider not configured'); },
  createRouter: () => { throw new Error('RouterProvider not configured'); },
};
