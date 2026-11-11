import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './signature.css';
import App from './App.tsx';
import { ErrorBoundary, installGlobalHandlers } from './ui/Safety';

installGlobalHandlers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// the Android app carries its own files, so no offline cache there (it would keep old screens after an update)
if ('serviceWorker' in navigator && import.meta.env.PROD && !import.meta.env.VITE_APK) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}); });
}
