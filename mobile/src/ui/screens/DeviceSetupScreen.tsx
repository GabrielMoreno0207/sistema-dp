/**
 * "Configurar celular": o que o Android precisa para o app receber avisos com a tela fechada
 * e iniciar sozinho quando o celular liga. Feito uma vez, na instalação.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, PermissionsAndroid, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import DpNative from '../../specs/NativeDpNative';
import { ensureService } from '../../core/connection';
import { useApp } from '../../core/store';
import { Button, Card, Header } from '../components';
import { useTheme } from '../theme';

export interface DeviceChecks {
  notifications: boolean;
  battery: boolean;
  fullScreen: boolean;
  service: boolean;
  allGood: boolean;
}

async function readChecks(): Promise<DeviceChecks> {
  const [notifications, battery, fullScreen, service] = await Promise.all([
    DpNative.areNotificationsEnabled(),
    DpNative.isIgnoringBatteryOptimizations(),
    DpNative.canUseFullScreenIntent(),
    DpNative.isServiceRunning(),
  ]);
  return { notifications, battery, fullScreen, service, allGood: notifications && battery && service };
}

/** Situação dos ajustes do Android (atualiza quando o usuário volta das configurações) */
export function useDeviceChecks(): DeviceChecks | null {
  const [checks, setChecks] = useState<DeviceChecks | null>(null);
  const refresh = useCallback(() => void readChecks().then(setChecks).catch(() => {}), []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (next) => next === 'active' && refresh());
    const timer = setInterval(refresh, 5_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [refresh]);
  return checks;
}

export async function requestNotificationPermission(): Promise<void> {
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) DpNative.openNotificationSettings();
  } else {
    DpNative.openNotificationSettings();
  }
}

function Step({
  done,
  title,
  text,
  action,
  onPress,
  optional,
}: {
  done: boolean | null;
  title: string;
  text: string;
  action: string;
  onPress: () => void;
  optional?: boolean;
}) {
  const t = useTheme();
  const color = done ? t.success : optional ? t.muted : t.warning;
  return (
    <Card style={styles.step}>
      <View style={styles.stepHead}>
        <Text style={[styles.stepIcon, { color }]}>{done === null ? '•' : done ? '✓' : optional ? '○' : '!'}</Text>
        <Text style={[styles.stepTitle, { color: t.text }]}>{title}</Text>
      </View>
      <Text style={[styles.stepText, { color: t.textSoft }]}>{text}</Text>
      {!done ? <Button title={action} variant="secondary" onPress={onPress} style={styles.stepButton} /> : null}
    </Card>
  );
}

export function DeviceSetupScreen({ onBack }: { onBack: () => void }) {
  const t = useTheme();
  const { device } = useApp();
  const checks = useDeviceChecks();
  const [autostartOpened, setAutostartOpened] = useState(false);
  const brand = (device?.manufacturer ?? '').toLowerCase();

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Configurar celular" subtitle={device ? `${device.manufacturer} ${device.model} · Android` : undefined} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.intro, { color: t.textSoft }]}>
          Faça estes ajustes uma vez. Assim o app liga sozinho junto com o celular e os avisos chegam mesmo com ele fechado. Uma
          notificação fixa "Comunicação DP" indica que ele está ativo.
        </Text>

        <Step
          done={checks?.notifications ?? null}
          title="1. Permitir notificações"
          text="Para os comunicados e mensagens aparecerem com som e vibração."
          action="Permitir notificações"
          onPress={() => void requestNotificationPermission()}
        />
        <Step
          done={checks?.battery ?? null}
          title="2. Bateria sem restrição"
          text='Sem isso o Android desliga o app para economizar bateria. Toque e escolha "Permitir" / "Sem restrições".'
          action="Liberar da economia de bateria"
          onPress={() => DpNative.requestIgnoreBatteryOptimizations()}
        />
        <Step
          done={autostartOpened ? true : null}
          title="3. Início automático"
          text={
            brand.includes('xiaomi') || brand.includes('redmi') || brand.includes('poco')
              ? 'Xiaomi: ative "Início automático" para Comunicação DP.'
              : brand.includes('samsung')
                ? 'Samsung: em Bateria, deixe o app "Sem restrições" e fora de "Apps em suspensão".'
                : brand.includes('motorola')
                  ? 'Motorola: em Bateria, escolha "Sem restrições" para o app.'
                  : 'Algumas marcas têm uma opção extra de "Início automático" ou "Apps protegidos". Ative para Comunicação DP.'
          }
          action="Abrir ajuste da marca"
          onPress={() =>
            void DpNative.openAutostartSettings().then(() => {
              setAutostartOpened(true);
            })
          }
        />
        <Step
          done={checks?.fullScreen ?? null}
          optional
          title="4. Urgentes em tela cheia (opcional)"
          text="Comunicados urgentes aparecem na tela inteira, mesmo com o celular bloqueado."
          action="Permitir tela cheia"
          onPress={() => DpNative.openFullScreenIntentSettings()}
        />
        <Step
          done={checks?.service ?? null}
          title="5. Conexão ativa"
          text="O serviço que mantém o app conectado. Ele volta sozinho quando o celular é ligado."
          action="Iniciar agora"
          onPress={() => void ensureService()}
        />

        <Text style={[styles.note, { color: t.muted }]}>
          Se alguém usar "Forçar parada" nas configurações do Android, o app só volta a funcionar depois de ser aberto de novo.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 28 },
  intro: { fontSize: 14.5, lineHeight: 21 },
  step: { gap: 6 },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepIcon: { fontSize: 18, fontWeight: '900', width: 20, textAlign: 'center' },
  stepTitle: { fontSize: 15.5, fontWeight: '700', flex: 1 },
  stepText: { fontSize: 13.5, lineHeight: 19 },
  stepButton: { marginTop: 8, minHeight: 42 },
  note: { fontSize: 12.5, lineHeight: 18, marginTop: 4 },
});
