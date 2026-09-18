import { useEffect, useState } from 'react';
import type { DpAttachment } from '../../../shared/types';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/**
 * Miniatura da imagem. O processo main baixa o arquivo e devolve em data URL
 * (a interface não fala com a rede).
 */
function Thumbnail({ attachment }: { attachment: DpAttachment }) {
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSource(null);
    void window.dp.getAttachmentImage(attachment.id).then((data) => {
      if (active) setSource(data);
    });
    return () => {
      active = false;
    };
  }, [attachment.id]);

  if (!source) return <span className="attachment__icon" aria-hidden>🖼️</span>;
  return <img className="attachment__thumb" src={source} alt={attachment.name} />;
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

/** Anexos do comunicado: abrir no programa padrão do Windows ou salvar em uma pasta. */
export function MessageAttachments({ messageId, attachments }: MessageAttachmentsProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const primeiro = attachments[0];

  // Abrir o comunicado já abre o anexo: é para o funcionário ver o arquivo sem precisar clicar.
  // Havendo mais de um, só o primeiro abre sozinho; os outros ficam nos botões.
  useEffect(() => {
    if (!primeiro || jaAbertosAutomaticamente.has(messageId)) return;
    jaAbertosAutomaticamente.add(messageId);

    let ativo = true;
    setBusyId(primeiro.id);
    void window.dp.openAttachment(primeiro.id).then((resultado) => {
      if (!ativo) return;
      setBusyId(null);
      // Só avisa quando deu errado (ex.: sem conexão); abrir certo não precisa de aviso
      if (!resultado.ok && resultado.message) setFeedback(resultado);
    });
    return () => {
      ativo = false;
    };
  }, [messageId, primeiro]);

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
      <h3 className="attachments__title">
        📎 {attachments.length} anexo{attachments.length === 1 ? '' : 's'}
        {attachments.length > 1 && <span className="attachments__hint"> — o primeiro abre sozinho</span>}
      </h3>

      <ul className="attachments__list">
        {attachments.map((attachment) => (
          <li key={attachment.id} className="attachment">
            {attachment.kind === 'IMAGE' ? (
              <Thumbnail attachment={attachment} />
            ) : (
              <span className="attachment__icon" aria-hidden>
                📄
              </span>
            )}
            <span className="attachment__info">
              <strong className="attachment__name" title={attachment.name}>
                {attachment.name}
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

      {feedback && (
        <p className={`attachments__feedback ${feedback.ok ? '' : 'attachments__feedback--error'}`}>{feedback.message}</p>
      )}
    </section>
  );
}
