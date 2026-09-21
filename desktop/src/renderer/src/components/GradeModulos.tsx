import { useState } from 'react';
import type { Page } from './MenuLateral';

export interface Modulo {
  id: string;
  label: string;
  icone: string;
  cor: string;
  /** Para onde o azulejo leva; sem destino = módulo ainda não disponível */
  destino?: Page;
  badge?: number;
}

/**
 * Azulejos do Departamento Pessoal. Os que já existem no aplicativo levam para a
 * página correspondente; os demais ficam marcados como "em breve" até serem feitos.
 */
export const MODULOS: Modulo[] = [
  { id: 'comunicados', label: 'Comunicados', icone: '◈', cor: '#17b3a3', destino: 'announcements' },
  { id: 'chamados', label: 'Chamados RH', icone: '✉', cor: '#3f8fd0', destino: 'messages' },
  { id: 'perfil', label: 'Meus dados', icone: '☺', cor: '#6c63c7', destino: 'profile' },
  { id: 'holerite', label: 'Holerite', icone: '₿', cor: '#2ea36f' },
  { id: 'ponto', label: 'Ponto Eletrônico', icone: '◷', cor: '#d98324' },
  { id: 'folha', label: 'Folha de Pagamento', icone: '▤', cor: '#c0554d' },
  { id: 'ferias', label: 'Férias', icone: '☀', cor: '#e0a92b' },
  { id: 'beneficios', label: 'Benefícios', icone: '♥', cor: '#d15c8a' },
  { id: 'atestados', label: 'Atestados', icone: '✚', cor: '#4a9ab5' },
  { id: 'banco-horas', label: 'Banco de Horas', icone: '⧗', cor: '#7b8ca8' },
  { id: 'escalas', label: 'Escalas', icone: '▦', cor: '#5f7d95' },
  { id: 'documentos', label: 'Documentos', icone: '▣', cor: '#8a7f6d' },
  { id: 'solicitacoes', label: 'Solicitações', icone: '✎', cor: '#b0603f' },
  { id: 'reembolsos', label: 'Reembolsos', icone: '⤺', cor: '#3f9a8c' },
  { id: 'treinamentos', label: 'Treinamentos', icone: '✧', cor: '#7a5ea8' },
  { id: 'avaliacoes', label: 'Avaliações', icone: '★', cor: '#c78b3c' },
  { id: 'organograma', label: 'Organograma', icone: '⌗', cor: '#4c7aa8' },
  { id: 'admissao', label: 'Admissão', icone: '⊕', cor: '#3d9b63' },
  { id: 'rescisao', label: 'Rescisão', icone: '⊗', cor: '#a8555f' },
  { id: 'esocial', label: 'eSocial', icone: '⛭', cor: '#5a6b8c' },
  { id: 'vagas', label: 'Vagas', icone: '⚑', cor: '#c2663f' },
];

interface GradeModulosProps {
  badges: Partial<Record<string, number>>;
  onAbrir(destino: Page): void;
  onIndisponivel(label: string): void;
}

export function GradeModulos({ badges, onAbrir, onIndisponivel }: GradeModulosProps) {
  const [recolhida, setRecolhida] = useState(false);
  const visiveis = recolhida ? MODULOS.slice(0, 7) : MODULOS;

  return (
    <section className="grade">
      <div className={`grade__azulejos ${recolhida ? 'grade__azulejos--recolhida' : ''}`}>
        {visiveis.map((modulo) => {
          const badge = badges[modulo.id] ?? 0;
          const disponivel = Boolean(modulo.destino);
          return (
            <button
              key={modulo.id}
              className={`azulejo ${disponivel ? '' : 'azulejo--em-breve'}`}
              style={{ backgroundColor: modulo.cor }}
              title={disponivel ? modulo.label : `${modulo.label} — em breve`}
              onClick={() => (modulo.destino ? onAbrir(modulo.destino) : onIndisponivel(modulo.label))}
            >
              <span className="azulejo__icone" aria-hidden>
                {modulo.icone}
              </span>
              <span className="azulejo__label">{modulo.label}</span>
              {badge > 0 && <span className="azulejo__badge">{badge > 99 ? '99+' : badge}</span>}
            </button>
          );
        })}
      </div>

      <button
        className="grade__alternar"
        onClick={() => setRecolhida((estava) => !estava)}
        title={recolhida ? 'Mostrar todos os módulos' : 'Recolher os módulos'}
      >
        {recolhida ? '▾' : '▴'}
      </button>
    </section>
  );
}
