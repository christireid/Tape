import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import 'uplot/dist/uPlot.min.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/aggrid.css';
import { App } from './App.tsx';
import { store } from './store/marketStore.ts';

// Exposed for the measurement harness and conformance checks only — read-only
// access to live telemetry and the row snapshot from Playwright.
declare global {
  interface Window {
    __tape?: typeof store;
    __gridReadyCount?: number;
  }
}
window.__tape = store;

const el = document.getElementById('root');
if (!el) throw new Error('root element missing');
createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
