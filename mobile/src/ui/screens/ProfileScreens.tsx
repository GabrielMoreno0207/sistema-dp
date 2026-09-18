/** Perfil do funcionário e troca de senha */
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { changePassword, logout } from '../../core/connection';
import { useApp } from '../../core/store';
import type { OperationResult } from '../../core/types';
import { Button, Card, Feedback, Field, Header } from '../components';
import { useTheme } from '../theme';

export function ProfileScreen({
  onPassword,
  onDeviceSetup,
  onServer,
}: {
  onPassword: () => void;
  onDeviceSetup: () => void;
  onServer: () => void;
}) {
  const t = useTheme();
  const { employee, device, deviceId, serverUrl } = useApp();
  const [busy, setBusy] = useState(false);

  function confirmLogout() {
    Alert.alert('Sair', 'Deseja sair da sua conta neste celular?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          await logout();
          setBusy(false);
        },
      },
    ]);
  }

  const rows: [string, string][] = employee
    ? [
        ['Matrícula', employee.registration],
        ['Setor', employee.sector ?? '—'],
        ['Turno', employee.shift ?? '—'],
      ]
    : [];

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Meu perfil" subtitle={employee?.name} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={[styles.name, { color: t.text }]}>{employee?.name}</Text>
          {rows.map(([label, value]) => (
            <View key={label} style={[styles.row, { borderColor: t.border }]}>
              <Text style={[styles.label, { color: t.muted }]}>{label}</Text>
              <Text style={[styles.value, { color: t.text }]}>{value}</Text>
            </View>
          ))}
        </Card>
        <Button title="Trocar minha senha" variant="secondary" onPress={onPassword} />
        <Button title="Configurar celular" variant="secondary" onPress={onDeviceSetup} />
        <Button title="Configurações do servidor" variant="secondary" onPress={onServer} />
        <Button title="Sair" variant="danger" onPress={confirmLogout} loading={busy} />
        <Text style={[styles.footer, { color: t.muted }]}>
          {deviceId} · {device ? `${device.manufacturer} ${device.model}` : ''}
          {'\n'}
          Servidor: {serverUrl} · versão {device?.appVersion}
        </Text>
      </ScrollView>
    </View>
  );
}

export function PasswordScreen({ onBack, forced }: { onBack?: () => void; forced?: boolean }) {
  const t = useTheme();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OperationResult | null>(null);

  async function submit() {
    if (next.length < 8) return setResult({ ok: false, message: 'A nova senha precisa ter pelo menos 8 caracteres.' });
    if (next !== confirm) return setResult({ ok: false, message: 'A confirmação não confere com a nova senha.' });
    setBusy(true);
    const outcome = await changePassword(current, next);
    setBusy(false);
    setResult(outcome);
    if (outcome.ok) {
      setCurrent('');
      setNext('');
      setConfirm('');
      if (onBack) setTimeout(onBack, 700);
    }
  }

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Trocar senha" subtitle={forced ? 'Crie uma senha sua para continuar' : undefined} onBack={onBack} />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Card>
            <Field label="Senha atual" value={current} onChangeText={setCurrent} secureTextEntry />
            <Field label="Nova senha" value={next} onChangeText={setNext} secureTextEntry hint="Mínimo de 8 caracteres." />
            <Field label="Confirmar nova senha" value={confirm} onChangeText={setConfirm} secureTextEntry onSubmitEditing={() => void submit()} />
            <Button title="Salvar nova senha" onPress={() => void submit()} loading={busy} />
            <Feedback result={result} />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 28 },
  name: { fontSize: 20, fontWeight: '800', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 14 },
  value: { fontSize: 14, fontWeight: '600' },
  footer: { fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 8 },
});
