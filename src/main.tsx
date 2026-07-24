import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { MemoryProvider } from './lib/memoryV2/MemoryProvider';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MemoryProvider>
      <App />
    </MemoryProvider>
  </StrictMode>,
);
