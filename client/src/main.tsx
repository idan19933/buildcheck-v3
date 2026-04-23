import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';

// Self-hosted fonts — avoids the Google Fonts network round-trip and keeps
// every weight we actually use bundled with the app.
import '@fontsource/heebo/400.css';
import '@fontsource/heebo/500.css';
import '@fontsource/heebo/600.css';
import '@fontsource/heebo/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';

import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="top-center"
        dir="rtl"
        richColors
        closeButton
        toastOptions={{
          style: {
            fontFamily: 'Heebo, system-ui, sans-serif',
            borderRadius: 'var(--radius-md)',
          },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>,
);
