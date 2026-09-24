/**
 * Mensagem de voz: gravação pelo microfone e player das conversas.
 * O trabalho pesado é nativo (DpAudio.kt); aqui ficam a permissão, o envio
 * e o estado do player que as telas acompanham.
 */
import { useEffect, useState } from 'react';
import { PermissionsAndroid } from 'react-native';
import DpNative from '../specs/NativeDpNative';
import { enviarMidia } from './arquivos';
import { getApi } from './connection';
import type { ArquivoLocal, MidiaPublica } from './types';

/** 75000 -> "1:15" */
export function tempoLegivel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- gravação

/** Pede o microfone (o Android pergunta só na primeira vez). '' = liberado */
export async function pedirMicrofone(): Promise<string> {
  const permissao = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  if (await PermissionsAndroid.check(permissao)) return '';
  const resposta = await PermissionsAndroid.request(permissao, {
    title: 'Microfone',
    message: 'O Comunica Trinys usa o microfone para gravar mensagens de voz.',
    buttonPositive: 'Permitir',
    buttonNegative: 'Agora não',
  });
  if (resposta === PermissionsAndroid.RESULTS.GRANTED) return '';
  if (resposta === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
    return 'O microfone está bloqueado para o app. Libere em Configurações > Apps > Comunica Trinys > Permissões.';
  }
  return 'Sem a permissão do microfone não dá para gravar.';
}

/** Começa a gravar. '' = gravando; senão, o motivo */
export async function comecarGravacao(): Promise<string> {
  const bloqueio = await pedirMicrofone();
  if (bloqueio) return bloqueio;
  pararAudio();
  try {
    await DpNative.startRecording();
    return '';
  } catch (err) {
    return err instanceof Error && err.message ? err.message : 'Não foi possível usar o microfone.';
  }
}

export function descartarGravacao(): void {
  DpNative.cancelRecording();
}

/** Para a gravação e sobe o áudio para o servidor (como as outras mídias) */
export async function terminarGravacao(): Promise<{ midia: MidiaPublica | null; message: string }> {
  let gravado: ArquivoLocal & { durationMs: number };
  try {
    gravado = JSON.parse(await DpNative.stopRecording()) as ArquivoLocal & { durationMs: number };
  } catch (err) {
    return { midia: null, message: err instanceof Error && err.message ? err.message : 'A gravação falhou.' };
  }
  // Toque sem querer no botão: nem envia
  if (gravado.durationMs < 500) return { midia: null, message: '' };
  return enviarMidia(gravado, gravado.durationMs);
}

// ---------------------------------------------------------------- player

export type EstadoAudio = 'carregando' | 'tocando' | 'pausado' | 'fim' | 'parado' | 'erro';

export interface StatusAudio {
  id: string;
  estado: EstadoAudio;
  posicaoMs: number;
  duracaoMs: number;
  mensagem: string;
}

let atual: StatusAudio | null = null;
const ouvintes = new Set<() => void>();
let inscrito = false;

function inscrever(): void {
  if (inscrito) return;
  inscrito = true;
  DpNative.onAudioStatus((json) => {
    try {
      atual = JSON.parse(json) as StatusAudio;
    } catch {
      return;
    }
    ouvintes.forEach((ouvir) => ouvir());
  });
}

/** Estado do player para este áudio (null = não é o que está tocando) */
export function useStatusAudio(id: string): StatusAudio | null {
  const [, atualizar] = useState(0);
  useEffect(() => {
    inscrever();
    const ouvir = () => atualizar((n) => n + 1);
    ouvintes.add(ouvir);
    return () => {
      ouvintes.delete(ouvir);
    };
  }, []);
  return atual && atual.id === id ? atual : null;
}

export function tocarAudio(midia: MidiaPublica, inicioMs = 0): void {
  const api = getApi();
  if (!api) return;
  inscrever();
  const token = (api.authHeaders.Authorization ?? '').replace(/^Bearer\s+/, '');
  DpNative.playAudio(api.midiaUrl(midia.id), token, midia.id, Math.max(0, Math.round(inicioMs)));
}

export function pausarAudio(): void {
  DpNative.pauseAudio();
}

export function irPara(posicaoMs: number): void {
  DpNative.seekAudio(Math.max(0, Math.round(posicaoMs)));
}

export function pararAudio(): void {
  DpNative.stopAudio();
}
