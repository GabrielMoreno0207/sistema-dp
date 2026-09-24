/**
 * Atualização do app, de dois jeitos:
 *
 * - APK ("mobile" no versionador): quando muda algo nativo. O celular baixa o APK
 *   sozinho, confere o SHA-256 e avisa. A instalação precisa do "Instalar" da
 *   pessoa: o Android não instala em silêncio sem MDM ou app de sistema.
 *
 * - Rápida ("mobile-ota"): troca só o JavaScript, como o Expo Updates. A pessoa
 *   toca em "Buscar atualizações" (ou em "Atualizar" no aviso), o app baixa,
 *   confere, fecha e abre de novo já na versão nova. Sem tela do Android.
 *   Detalhes e proteções: android/.../Ota.kt
 */
import { AppState } from 'react-native';
import DpNative from '../specs/NativeDpNative';
import { getApi } from './connection';
import { getState, setState, type NavRequest } from './store';
import type { OperationResult } from './types';

const NOTIFICACAO_ID = 9_100;
let caminhoBaixado: string | null = null;
let emAndamento = false;

/** "1.10.0" > "1.9.3" */
export function versaoMaior(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

/** Pergunta ao servidor e, havendo versão nova, já baixa. */
export async function verificarAtualizacao(): Promise<void> {
  const api = getApi();
  const instalada = getState().device?.apkVersion;
  if (!api || !instalada || emAndamento) return;
  const etapa = getState().atualizacao.etapa;
  try {
    const versao = await api.verificarAtualizacao(instalada);
    if (!versao || !versaoMaior(versao.versao, instalada)) {
      if (etapa !== 'nenhuma') setState({ atualizacao: { etapa: 'nenhuma', versao: null, progresso: '', erro: null } });
      // Sem APK novo: procura a atualização rápida
      await verificarAtualizacaoRapida();
      return;
    }
    // Mesma versão já baixada: só lembra que está pronta
    if (etapa === 'pronta' && getState().atualizacao.versao?.versao === versao.versao && caminhoBaixado) return;
    setState({ atualizacao: { etapa: 'disponivel', versao, progresso: '', erro: null } });
    await baixar();
  } catch (err) {
    console.warn('[atualização] falha ao verificar', err);
  }
}

async function baixar(): Promise<void> {
  const api = getApi();
  const versao = getState().atualizacao.versao;
  if (!api || !versao || emAndamento) return;
  emAndamento = true;
  setState({ atualizacao: { etapa: 'baixando', versao, progresso: 'Baixando a versão nova...', erro: null } });
  try {
    const caminho = await api.download(versao.url, 'atualizacao', `ComunicacaoDP-${versao.versao}.apk`);
    const hash = await DpNative.sha256File(caminho);
    if (hash.toLowerCase() !== versao.sha256) throw new Error('O arquivo chegou incompleto. Tentando de novo mais tarde.');
    caminhoBaixado = caminho;
    setState({ atualizacao: { etapa: 'pronta', versao, progresso: '', erro: null } });
    if (AppState.currentState !== 'active') {
      void DpNative.showNotification(
        NOTIFICACAO_ID,
        'comunicados',
        `Atualização do Comunica Trinys (${versao.versao})`,
        'A versão nova já foi baixada. Toque para instalar.',
        false,
        JSON.stringify({ kind: 'atualizacao' } satisfies NavRequest),
      );
    }
  } catch (err) {
    caminhoBaixado = null;
    setState({
      atualizacao: {
        etapa: 'erro',
        versao,
        progresso: '',
        erro: err instanceof Error ? err.message : 'Não foi possível baixar a atualização.',
      },
    });
  } finally {
    emAndamento = false;
  }
}

/** Botão "Instalar": abre o instalador do Android (a pessoa confirma lá) */
export async function instalarAtualizacao(): Promise<OperationResult> {
  if (getState().atualizacao.etapa === 'erro') {
    await baixar();
    if (getState().atualizacao.etapa !== 'pronta') return { ok: false, message: getState().atualizacao.erro ?? 'Falha no download.' };
  }
  if (!caminhoBaixado) return { ok: false, message: 'A atualização ainda está sendo baixada.' };
  if (!(await DpNative.canInstallPackages())) {
    DpNative.openInstallPermissionSettings();
    return {
      ok: false,
      message: 'Permita "instalar apps desta fonte" para o Comunica Trinys e toque em Instalar de novo.',
    };
  }
  DpNative.cancelNotification(NOTIFICACAO_ID);
  const abriu = await DpNative.installApk(caminhoBaixado);
  return abriu ? { ok: true, message: '' } : { ok: false, message: 'Não foi possível abrir o instalador.' };
}

// ---------------------------------------------------------------- atualização rápida

/** Versões rápidas que não abriram neste celular (o app voltou sozinho para a do APK) */
let descartadas: string[] = [];

/** Lê a atualização rápida instalada. Devolve a versão em uso, ou "" (JavaScript do APK) */
export async function lerAtualizacaoRapida(): Promise<string> {
  try {
    const info = JSON.parse(await DpNative.otaInfo()) as { ativa?: unknown; ruins?: unknown };
    descartadas = Array.isArray(info.ruins) ? info.ruins.filter((v): v is string => typeof v === 'string') : [];
    return typeof info.ativa === 'string' ? info.ativa : '';
  } catch {
    return '';
  }
}

async function verificarAtualizacaoRapida(): Promise<void> {
  const api = getApi();
  const emUso = getState().device?.appVersion;
  if (!api || !emUso || getState().atualizacaoRapida.etapa === 'aplicando') return;
  const versao = await api.verificarAtualizacao(emUso, 'mobile-ota');
  if (!versao || !versaoMaior(versao.versao, emUso) || descartadas.includes(versao.versao)) {
    if (getState().atualizacaoRapida.etapa !== 'nenhuma') setState({ atualizacaoRapida: { etapa: 'nenhuma', versao: null, erro: null } });
    return;
  }
  setState({ atualizacaoRapida: { etapa: 'disponivel', versao, erro: null } });
}

/** Baixa, confere, instala e reinicia o app. Só volta se der errado */
export async function aplicarAtualizacaoRapida(): Promise<OperationResult> {
  const api = getApi();
  const versao = getState().atualizacaoRapida.versao;
  if (!api || !versao) return { ok: false, message: 'Nenhuma atualização disponível.' };
  if (getState().atualizacaoRapida.etapa === 'aplicando') return { ok: true, message: '' };
  setState({ atualizacaoRapida: { etapa: 'aplicando', versao, erro: null } });
  try {
    const caminho = await api.download(versao.url, 'atualizacao', `ComunicacaoDP-rapida-${versao.versao}.zip`);
    const hash = await DpNative.sha256File(caminho);
    if (hash.toLowerCase() !== versao.sha256) throw new Error('A atualização chegou incompleta. Tente de novo.');
    await DpNative.otaInstall(caminho);
    // Um instante para a tela mostrar "reiniciando"
    await new Promise<void>((r) => setTimeout(r, 700));
    DpNative.otaRestart();
    return { ok: true, message: '' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível atualizar.';
    setState({ atualizacaoRapida: { etapa: 'erro', versao, erro: message } });
    return { ok: false, message };
  }
}

/**
 * Botão "Buscar atualizações": pergunta ao servidor e, havendo atualização
 * rápida, já aplica (o app fecha e abre de novo). APK novo segue o caminho de sempre.
 */
export async function buscarAtualizacoes(): Promise<OperationResult> {
  if (!getApi()) return { ok: false, message: 'Sem conexão com o servidor.' };
  await verificarAtualizacao();
  const apk = getState().atualizacao.etapa;
  if (apk !== 'nenhuma') return { ok: true, message: '' };
  const rapida = getState().atualizacaoRapida;
  if (rapida.etapa === 'disponivel' || rapida.etapa === 'erro') return aplicarAtualizacaoRapida();
  return { ok: true, message: 'Você já está com a versão mais recente.' };
}
