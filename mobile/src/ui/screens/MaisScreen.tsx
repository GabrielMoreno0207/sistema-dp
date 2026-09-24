/** Aba "Mais": perfil, telas do DP/TI, configurações do celular e atualização do app */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { instalarAtualizacao, verificarAtualizacao } from '../../core/atualizacao';
import { useApp } from '../../core/store';
import { Avatar, Banner, Button, Card, Feedback, Header, MenuRow, Page, SectionTitle } from '../components';
import { useNav } from '../nav';
import { useTheme } from '../theme';

export function MaisScreen() {
  const t = useTheme();
  const nav = useNav();
  const { employee, foto, atualizacao, device } = useApp();
  const acesso = employee?.acessoAdmin ?? 'NENHUM';
  const ehDpOuTi = acesso !== 'NENHUM';

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Mais" subtitle={employee?.name} />
      <Page>
        <Card onPress={() => nav.push({ name: 'perfil' })} style={styles.perfil}>
          <Avatar nome={employee?.name ?? '?'} fotoMidiaId={foto?.id} size={56} />
          <View style={styles.flex}>
            <Text style={[styles.nome, { color: t.text }]} numberOfLines={1}>
              {employee?.name}
            </Text>
            <Text style={[styles.detalhe, { color: t.muted }]} numberOfLines={1}>
              {[employee?.sector, employee?.registration && `usuário ${employee.registration}`].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Text style={[styles.seta, { color: t.muted }]}>›</Text>
        </Card>

        {atualizacao.etapa === 'pronta' ? (
          <Banner
            tone="info"
            text={`Versão ${atualizacao.versao?.versao} do app pronta para instalar.`}
            action={{ title: 'Ver', onPress: () => nav.push({ name: 'sobre' }) }}
          />
        ) : null}

        <SectionTitle>Minha conta</SectionTitle>
        <MenuRow icon="👤" label="Meu perfil" hint="Foto, dados e senha" onPress={() => nav.push({ name: 'perfil' })} />
        <MenuRow icon="🖼️" label="Foto de perfil" onPress={() => nav.push({ name: 'foto' })} />
        <MenuRow icon="🔑" label="Trocar minha senha" onPress={() => nav.push({ name: 'password' })} />
        <MenuRow icon="📌" label="Mural" onPress={() => nav.push({ name: 'mural' })} />
        <MenuEmConstrucao icon="🛟" label="Chamados para o TI" />

        {ehDpOuTi ? (
          <>
            <SectionTitle>{acesso === 'TI' ? 'Departamento Pessoal e TI' : 'Departamento Pessoal'}</SectionTitle>
            <MenuRow icon="📤" label="Comunicados" hint="Enviar e ver quem leu" onPress={() => nav.push({ name: 'adminComunicados' })} />
            <MenuRow icon="📌" label="Publicar no mural" onPress={() => nav.push({ name: 'adminMural' })} />
            <MenuRow icon="👥" label="Cadastros" hint="Funcionários, setores e aparelhos" onPress={() => nav.push({ name: 'adminCadastros' })} />
            <MenuRow icon="🎚️" label="Ajustes" hint="Resposta automática e minhas mensagens" onPress={() => nav.push({ name: 'adminAjustes' })} />
            {acesso === 'TI' ? (
              <>
                <MenuEmConstrucao icon="🛠️" label="Fila do TI" />
                <MenuEmConstrucao icon="🔍" label="Conversas (TI)" />
              </>
            ) : null}
          </>
        ) : null}

        <SectionTitle>Este celular</SectionTitle>
        <MenuRow icon="🔔" label="Configurar celular" hint="Notificações, bateria e início automático" onPress={() => nav.push({ name: 'device' })} />
        <MenuRow icon="🌐" label="Servidor" hint="Endereço e conexão" onPress={() => nav.push({ name: 'server' })} />
        <MenuRow
          icon="⬆️"
          label="Sobre e atualização"
          hint={`Versão ${device?.appVersion ?? ''}`}
          badge={atualizacao.etapa === 'pronta' ? 1 : 0}
          onPress={() => nav.push({ name: 'sobre' })}
        />
      </Page>
    </View>
  );
}

/** Item que existe no computador mas ainda não foi liberado (igual lá: aparece marcado e não abre) */
function MenuEmConstrucao({ icon, label }: { icon: string; label: string }) {
  const t = useTheme();
  return (
    <View style={[styles.construcao, { borderColor: t.border, backgroundColor: t.surface }]} accessibilityState={{ disabled: true }}>
      <Text style={styles.construcaoIcone}>{icon}</Text>
      <View style={styles.flex}>
        <Text style={[styles.construcaoRotulo, { color: t.muted }]}>{label}</Text>
        <Text style={[styles.detalhe, { color: t.muted }]}>em construção</Text>
      </View>
    </View>
  );
}

export function SobreScreen() {
  const t = useTheme();
  const nav = useNav();
  const { device, atualizacao, serverUrl, deviceId } = useApp();
  const [verificando, setVerificando] = useState(false);
  const [instalando, setInstalando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; message: string } | null>(null);

  async function verificar() {
    setVerificando(true);
    setResultado(null);
    await verificarAtualizacao();
    setVerificando(false);
  }

  async function instalar() {
    setInstalando(true);
    const r = await instalarAtualizacao();
    setInstalando(false);
    setResultado(r.ok ? null : r);
  }

  const versao = atualizacao.versao;
  const texto =
    atualizacao.etapa === 'baixando'
      ? `Baixando a versão ${versao?.versao}...`
      : atualizacao.etapa === 'pronta'
        ? `A versão ${versao?.versao} já foi baixada. Toque em Instalar e confirme na tela do Android.`
        : atualizacao.etapa === 'erro'
          ? atualizacao.erro ?? 'Falha ao baixar a atualização.'
          : 'Você está com a versão mais recente.';

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Sobre e atualização" onBack={nav.pop} />
      <Page>
        <Card style={styles.sobre}>
          <Text style={[styles.nome, { color: t.text }]}>Comunica Trinys</Text>
          <Text style={[styles.detalhe, { color: t.muted }]}>Versão instalada: {device?.appVersion}</Text>
          <Text style={[styles.detalhe, { color: t.muted }]}>Aparelho: {deviceId}</Text>
          <Text style={[styles.detalhe, { color: t.muted }]}>Servidor: {serverUrl}</Text>
        </Card>
        <Card style={styles.sobre}>
          <Text style={[styles.subtitulo, { color: t.text }]}>Atualização</Text>
          <Text style={[styles.texto, { color: t.textSoft }]}>{texto}</Text>
          {versao?.notas && atualizacao.etapa !== 'nenhuma' ? (
            <Text style={[styles.texto, { color: t.textSoft }]}>O que mudou: {versao.notas}</Text>
          ) : null}
          {atualizacao.etapa === 'pronta' || atualizacao.etapa === 'erro' ? (
            <Button title={atualizacao.etapa === 'erro' ? 'Tentar de novo' : 'Instalar'} onPress={() => void instalar()} loading={instalando} />
          ) : (
            <Button title="Procurar atualização" variant="secondary" onPress={() => void verificar()} loading={verificando || atualizacao.etapa === 'baixando'} />
          )}
          <Feedback result={resultado} />
          <Text style={[styles.detalhe, { color: t.muted }]}>
            O celular baixa as versões novas sozinho. A instalação precisa do seu “Instalar” (é uma regra do Android).
          </Text>
        </Card>
      </Page>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  perfil: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  nome: { fontSize: 17, fontWeight: '800' },
  detalhe: { fontSize: 13, lineHeight: 18 },
  seta: { fontSize: 26, fontWeight: '300' },
  construcao: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, opacity: 0.7, borderStyle: 'dashed' },
  construcaoIcone: { fontSize: 22, width: 28, textAlign: 'center', opacity: 0.6 },
  construcaoRotulo: { fontSize: 15.5, fontWeight: '700' },
  sobre: { gap: 8 },
  subtitulo: { fontSize: 15.5, fontWeight: '800' },
  texto: { fontSize: 14.5, lineHeight: 21 },
});
