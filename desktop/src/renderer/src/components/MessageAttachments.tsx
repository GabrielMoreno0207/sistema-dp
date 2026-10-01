import { useEffect, useState } from 'react';
import type { DpAttachment } from '../../../shared/types';
import { nomeDeArquivo } from '../../../shared/arquivo';
import { Icone } from '../lib/icones';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/**
 * Imagem do comunicado, aberta junto com ele.
 *
 * O funcionário não precisa clicar nem baixar nada: a imagem aparece inteira
 * dentro do comunicado. O processo main baixa o arquivo e devolve em data URL
 * (a interface não fala com a rede).
 */
function ImagemAberta({ attachment }: { attachment: DpAttachment }) {
  const [source, setSource] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  const nome = nomeDeArquivo(attachment.name);

  useEffect(() => {
    let active = true;
    setSource(null);
    setFalhou(false);
    void window.dp.getAttachmentImage(attachment.id).then((data) => {
      if (!active) return;
      if (data) setSource(data);
      else setFalhou(true);
    });
    return () => {
      active = false;
    };
  }, [attachment.id]);

  if (falhou) {
    return (
      <p className="anexo-imagem__aviso">
        Não foi possível carregar a imagem agora. Use o botão Salvar quando o status estiver 🟢 Conectado.
      </p>
    );
  }

  if (!source) return <div className="anexo-imagem__carregando" aria-label={`Carregando ${nome}`} />;

  return <img className="anexo-imagem__img" src={source} alt={nome} />;
}

/**
 * Comunicados cujo anexo já foi aberto sozinho nesta execução do app.
 * Sem isso, voltar na mesma mensagem abriria o arquivo de novo a cada clique.
 */
const jaAbertosAutomaticamente = new Set<string>();

interface MessageAttachmentsProps {
  messageId: string;
  attachments: DpAttachment[];
}

/**
 * Anexos do comunicado.
 *
 * Imagem aparece aberta, do tamanho do comunicado — é o conteúdo, não um arquivo
 * para baixar. Documento (PDF, planilha) continua como arquivo, com Abrir e Salvar.
 */
export function MessageAttachments({ messageId, attachments }: MessageAttachmentsProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const imagens = attachments.filter((a) => a.kind === 'IMAGE');
  const arquivos = attachments.filter((a) => a.kind !== 'IMAGE');

  // Abrir o comunicado já abre o primeiro documento no programa do Windows.
  // Imagem não entra aqui: ela já aparece aberta na própria tela.
  const primeiroArquivo = arquivos[0];
  useEffect(() => {
    if (!primeiroArquivo || jaAbertosAutomaticamente.has(messageId)) return;
    jaAbertosAutomaticamente.add(messageId);

    let ativo = true;
    setBusyId(primeiroArquivo.id);
    void window.dp.openAttachment(primeiroArquivo.id).then((resultado) => {
      if (!ativo) return;
      setBusyId(null);
      // Só avisa quando deu errado (ex.: sem conexão); abrir certo não precisa de aviso
      if (!resultado.ok && resultado.message) setFeedback(resultado);
    });
    return () => {
      ativo = false;
    };
  }, [messageId, primeiroArquivo]);

  if (attachments.length === 0) return null;

  async function run(attachmentId: string, action: 'open' | 'save') {
    setBusyId(attachmentId);
    setFeedback(null);
    const result =
      action === 'open' ? await window.dp.openAttachment(attachmentId) : await window.dp.saveAttachment(attachmentId);
    setBusyId(null);
    if (result.message) setFeedback(result);
  }

  return (
    <section className="attachments">
      {imagens.map((attachment) => (
        <figure key={attachment.id} className="anexo-imagem">
          <ImagemAberta attachment={attachment} />
          <figcaption className="anexo-imagem__rodape">
            <button
              className="btn btn--ghost btn--sm"
              disabled={busyId === attachment.id}
              onClick={() => void run(attachment.id, 'save')}
            >
              Salvar imagem
            </button>
          </figcaption>
        </figure>
      ))}

      {arquivos.length > 0 && (
        <>
          <h3 className="attachments__title">
            <Icone nome="anexo" /> {arquivos.length} anexo{arquivos.length === 1 ? '' : 's'}
            {arquivos.length > 1 && <span className="attachments__hint"> — o primeiro abre sozinho</span>}
          </h3>

          <ul className="attachments__list">
            {arquivos.map((attachment) => (
              <li key={attachment.id} className="attachment">
                <span className="attachment__icon" aria-hidden>
                  <Icone nome="arquivo" />
                </span>
                <span className="attachment__info">
                  <strong className="attachment__name" title={nomeDeArquivo(attachment.name)}>
                    {nomeDeArquivo(attachment.name)}
                  </strong>
                  <small className="attachment__size">{formatSize(attachment.size)}</small>
                </span>
                <span className="attachment__actions">
                  <button
                    className="btn btn--ghost btn--sm"
                    disabled={busyId === attachment.id}
                    onClick={() => void run(attachment.id, 'open')}
                  >
                    Abrir
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    disabled={busyId === attachment.id}
                    onClick={() => void run(attachment.id, 'save')}
                  >
                    Salvar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {feedback && (
        <p className={`attachments__feedback ${feedback.ok ? '' : 'attachments__feedback--error'}`}>{feedback.message}</p>
      )}
    </section>
  );
}
