/** Configuração do servidor (primeira vez, ou pelo Perfil) */
import React, { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { saveServer, testServer } from '../../core/connection';
import { useApp } from '../../core/store';
import type { OperationResult } from '../../core/types';
import { Button, Card, Feedback, Field, Header } from '../components';
import { useTheme } from '../theme';

export function SetupScreen({ onBack }: { onBack?: () => void }) {
  const t = useTheme();
  const app = useApp();
  const [serverUrl, setServerUrl] = useState(app.serverUrl ?? '');
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [result, setResult] = useState<OperationResult | null>(null);

  async function run(kind: 'test' | 'save') {
    setBusy(kind);
    setResult(null);
    const outcome = kind === 'test' ? await testServer(serverUrl) : await saveServer(serverUrl);
    setBusy(null);
    setResult(outcome);
    if (kind === 'save' && outcome.ok) onBack?.();
  }

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Configurar servidor" subtitle="Feito uma vez pelo TI" onBack={onBack} right={onBack ? undefined : <View />} />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.intro, { color: t.textSoft }]}>
            Informe o endereço do servidor da empresa (o mesmo usado nos computadores). O celular precisa estar no Wi-Fi da
            empresa.
          </Text>
          <Card>
            <Field
              label="Endereço do servidor"
              placeholder="http://servidor-dp:3000"
              value={serverUrl}
              onChangeText={setServerUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <View style={styles.row}>
              <Button title="Testar" variant="secondary" onPress={() => void run('test')} loading={busy === 'test'} style={styles.flex} />
              <Button title="Salvar e conectar" onPress={() => void run('save')} loading={busy === 'save'} style={styles.grow} />
            </View>
            <Feedback result={result} />
          </Card>
          {app.deviceId ? (
            <Text style={[styles.device, { color: t.muted }]}>
              Este celular aparece na Central como {app.deviceId}
              {app.device ? ` (${app.device.manufacturer} ${app.device.model})` : ''}.
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1.6 },
  content: { padding: 16, gap: 16 },
  intro: { fontSize: 14.5, lineHeight: 21 },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  device: { fontSize: 12.5, textAlign: 'center' },
});
