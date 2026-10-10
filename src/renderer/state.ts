import { useEffect, useState } from 'react';
import type { AppState, BrowserAPI } from '../shared/types';

declare global {
  interface Window {
    browser: BrowserAPI;
  }
}

export const api = window.browser;

/** The latest state snapshot from the main process. */
export function useAppState(): AppState {
  const [state, setState] = useState(() => api.getState());
  useEffect(() => api.onState(setState), []);
  return state;
}

export function rectOf(element: Element) {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}
