import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './signature.css';
import '@fontsource/montserrat/latin-400.css';
import '@fontsource/montserrat/latin-500.css';
import '@fontsource/montserrat/latin-600.css';
import '@fontsource/montserrat/latin-700.css';
import App from './App.tsx';
import { Splash } from './ui/Splash';
import { ErrorBoundary, installGlobalHandlers } from './ui/Safety';
import { startHasClasses } from './ui/hasClasses';

const tooOld = (window as unknown as { __hanubixOld?: boolean }).__hanubixOld; // index.html is already moving to old-phone.html
installGlobalHandlers();
if (!tooOld) startHasClasses();
(window as unknown as { __hanubixUp?: boolean }).__hanubixUp = true; // index.html's old-phone check: the app started

if (!tooOld) createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <Splash />
    </ErrorBoundary>
  </StrictMode>,
);

// the Android app carries its own files, so no offline cache there (it would keep old screens after an update)
if ('serviceWorker' in navigator && import.meta.env.PROD && !import.meta.env.VITE_APK) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}); });
}
