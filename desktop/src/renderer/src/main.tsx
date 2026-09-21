import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { aplicarTema, temaGuardado } from './lib/tema';

// Antes de desenhar: sem isso a janela pisca branca ao abrir no tema escuro
aplicarTema(temaGuardado());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
