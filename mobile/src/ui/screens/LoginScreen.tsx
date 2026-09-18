/** Login do funcionário (matrícula e senha, as mesmas do computador) */
import React, { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { login, reconnectNow } from '../../core/connection';
import { useApp } from '../../core/store';
import type { OperationResult } from '../../core/types';
import { Banner, Button, Card, Feedback, Field, Header } from '../components';
import { useTheme } from '../theme';

export function LoginScreen({ onServer }: { onServer: () => void }) {
  const t = useTheme();
  const { connection } = useApp();
  const [registration, setRegistration] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OperationResult | null>(null);
  const connected = connection.status === 'connected';

  async function submit() {
    if (!registration.trim() || !password) {
      setResult({ ok: false, message: 'Informe a matrícula e a senha.' });
      return;
    }
    setBusy(true);
    setResult(null);
    const outcome = await login(registration, password);
    setBusy(false);
    if (!outcome.ok) setResult(outcome);
  }

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Comunicação DP" subtitle="Departamento Pessoal" />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!connected ? (
            <Banner
              tone={connection.status === 'unauthorized' ? 'danger' : 'warning'}
              text={
                connection.status === 'unauthorized'
                  ? `O servidor recusou este celular: ${connection.lastError ?? ''}`
                  : 'Sem conexão com o servidor. Confira se o celular está no Wi-Fi da empresa.'
              }
              action={{ title: 'Tentar', onPress: reconnectNow }}
            />
          ) : null}
          <Card>
            <Text style={[styles.title, { color: t.text }]}>Entrar</Text>
            <Text style={[styles.subtitle, { color: t.muted }]}>Use a sua matrícula e a senha cadastrada pelo DP.</Text>
            <Field
              label="Matrícula"
              value={registration}
              onChangeText={setRegistration}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="default"
              returnKeyType="next"
            />
            <Field
              label="Senha"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />
            <Button title="Entrar" onPress={() => void submit()} loading={busy} disabled={!connected} />
            <Feedback result={result} />
          </Card>
          <Button title="Configurações do servidor" variant="ghost" onPress={onServer} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 16 },
  title: { fontSize: 20, fontWeight: '800' },
  subtitle: { fontSize: 14, marginTop: 4, marginBottom: 18 },
});
