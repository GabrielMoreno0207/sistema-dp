import type { AtualizacaoEmAndamento } from '../../../shared/types';
import { Icone } from '../lib/icones';

/**
 * Aviso de que o aplicativo vai fechar para instalar a versão nova.
 *
 * A atualização obrigatória não espera o computador ficar ocioso: ela instala
 * com a pessoa usando. Sem este aviso a janela simplesmente some, e quem está
 * do outro lado acha que o programa travou ou foi desinstalado.
 *
 * Fica por cima de tudo e não tem como fechar — não há o que decidir aqui, só
 * esperar. O instalador abre o aplicativo de novo sozinho; quando isso falha
 * (antivírus, PC lento), a última linha diz o que fazer.
 */
export function TelaAtualizando({ info }: { info: AtualizacaoEmAndamento }) {
  return (
    <div className="atualizando" role="alertdialog" aria-live="assertive">
      <div className="atualizando__caixa">
        <span className="atualizando__giro" aria-hidden />

        <h1 className="atualizando__titulo">
          <Icone nome="atualizar" tamanho={22} /> Atualizando o Comunicação DP
        </h1>

        <p className="atualizando__texto">
          O aplicativo vai <strong>fechar e abrir de novo sozinho</strong> para instalar a versão {info.versao}. Leva
          menos de um minuto.
        </p>

        <p className="atualizando__texto atualizando__texto--aviso">
          Se ele não abrir sozinho, é só abrir o <strong>Comunicação DP</strong> pelo ícone da área de trabalho.
        </p>

        {info.obrigatoria && (
          <p className="atualizando__nota">Esta atualização é obrigatória e não pode ser adiada.</p>
        )}
      </div>
    </div>
  );
}
