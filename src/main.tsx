import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Suppress benign WebSocket errors from Vite HMR in the preview environment
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.message?.includes('WebSocket') || event.reason?.includes?.('WebSocket')) {
    event.preventDefault();
  }
});

const originalError = console.error;
console.error = (...args) => {
  if (args[0]?.includes?.('failed to connect to websocket')) return;
  originalError.apply(console, args);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
