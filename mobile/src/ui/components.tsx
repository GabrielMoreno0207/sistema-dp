/** Componentes visuais reutilizados pelas telas */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../core/store';
import { TYPE_LABELS, type MessageType } from '../core/types';
import { TONES, useTheme } from './theme';

export function Header({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string | null;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { backgroundColor: t.header, paddingTop: insets.top + 10 }]}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={14} style={styles.back} accessibilityRole="button" accessibilityLabel="Voltar">
          <Text style={[styles.backText, { color: t.onHeader }]}>‹</Text>
        </Pressable>
      ) : (
        <View style={[styles.logo, { backgroundColor: t.primary }]}>
          <Text style={styles.logoText}>DP</Text>
        </View>
      )}
      <View style={styles.headerTexts}>
        <Text style={[styles.headerTitle, { color: t.onHeader }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ?? <ConnectionDot />}
    </View>
  );
}

const STATUS_LABEL: Record<string, string> = {
  connected: 'Conectado',
  connecting: 'Conectando...',
  reconnecting: 'Reconectando...',
  disconnected: 'Sem conexão',
  unauthorized: 'Recusado',
  'not-configured': 'Não configurado',
};

export function ConnectionDot() {
  const t = useTheme();
  const { connection } = useApp();
  const color =
    connection.status === 'connected'
      ? t.success
      : connection.status === 'connecting' || connection.status === 'reconnecting'
        ? t.warning
        : t.danger;
  return (
    <View style={styles.dotWrap} accessibilityLabel={STATUS_LABEL[connection.status]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.dotText}>{STATUS_LABEL[connection.status]}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const palette = {
    primary: { bg: t.primary, fg: t.onPrimary, border: t.primary },
    secondary: { bg: t.surface, fg: t.text, border: t.border },
    danger: { bg: t.surface, fg: t.danger, border: t.danger },
    ghost: { bg: 'transparent', fg: t.primary, border: 'transparent' },
  }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: off ? 0.55 : pressed ? 0.8 : 1 },
        style,
      ]}>
      {loading ? <ActivityIndicator color={palette.fg} /> : <Text style={[styles.buttonText, { color: palette.fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: t.textSoft }]}>{label}</Text>
      <TextInput
        placeholderTextColor={t.muted}
        {...props}
        style={[styles.input, { backgroundColor: t.surface, borderColor: t.border, color: t.text }, props.style]}
      />
      {hint ? <Text style={[styles.hint, { color: t.muted }]}>{hint}</Text> : null}
    </View>
  );
}

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const t = useTheme();
  const base = [styles.card, { backgroundColor: t.surface, borderColor: t.border }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [...base, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  );
}

export function TypeTag({ type }: { type: MessageType }) {
  const dark = useTheme().bg !== '#f4f6f9';
  const tone = TONES[type];
  return (
    <View style={[styles.tag, { backgroundColor: dark ? tone.softDark : tone.soft }]}>
      <Text style={[styles.tagText, { color: tone.color }]}>
        {tone.icon} {TYPE_LABELS[type]}
      </Text>
    </View>
  );
}

export function Badge({ count }: { count: number }) {
  const t = useTheme();
  if (count <= 0) return null;
  return (
    <View style={[styles.badge, { backgroundColor: t.danger }]}>
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

export function Empty({ icon, text }: { icon: string; text: string }) {
  const t = useTheme();
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={[styles.emptyText, { color: t.muted }]}>{text}</Text>
    </View>
  );
}

export function Banner({
  tone,
  text,
  action,
}: {
  tone: 'warning' | 'danger' | 'info' | 'success';
  text: string;
  action?: { title: string; onPress: () => void };
}) {
  const t = useTheme();
  const color = { warning: t.warning, danger: t.danger, info: t.primary, success: t.success }[tone];
  return (
    <View style={[styles.banner, { borderColor: color, backgroundColor: t.surface }]}>
      <View style={[styles.bannerBar, { backgroundColor: color }]} />
      <Text style={[styles.bannerText, { color: t.text }]}>{text}</Text>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={8}>
          <Text style={[styles.bannerAction, { color: t.primary }]}>{action.title}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Feedback({ result }: { result: { ok: boolean; message: string } | null }) {
  const t = useTheme();
  if (!result) return null;
  return <Text style={[styles.feedback, { color: result.ok ? t.success : t.danger }]}>{result.message}</Text>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14 },
  back: { width: 32, height: 36, justifyContent: 'center' },
  backText: { fontSize: 34, lineHeight: 36, fontWeight: '300' },
  logo: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  headerTexts: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerSubtitle: { color: '#93a0b8', fontSize: 12.5, marginTop: 1 },
  dotWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dotText: { color: '#c9d2e3', fontSize: 12 },
  button: { minHeight: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  buttonText: { fontSize: 15.5, fontWeight: '700' },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 13.5, fontWeight: '600', marginBottom: 6 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 16 },
  hint: { fontSize: 12.5, marginTop: 5 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16 },
  tag: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  tagText: { fontSize: 12, fontWeight: '700' },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 11.5, fontWeight: '800' },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 10 },
  emptyIcon: { fontSize: 40 },
  emptyText: { fontSize: 14.5, textAlign: 'center', lineHeight: 21 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, paddingLeft: 0, overflow: 'hidden' },
  bannerBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  bannerText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  bannerAction: { fontSize: 13.5, fontWeight: '700' },
  feedback: { fontSize: 14, marginTop: 10, textAlign: 'center' },
});
