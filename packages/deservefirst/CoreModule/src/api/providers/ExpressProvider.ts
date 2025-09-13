import express from 'express';
import { RouterProvider } from '../Router';

export const ExpressProvider = {
  configure: () => { /* Initialize Express if needed */ },
  createRouter: () => express.Router(),
};

RouterProvider = ExpressProvider;
