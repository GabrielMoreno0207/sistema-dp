/** Componentes visuais reutilizados pelas telas */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageStyle,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getApi } from '../core/connection';
import { useApp } from '../core/store';
import { TYPE_LABELS, type MessageType } from '../core/types';
import { TONES, iniciais, useLayout, useTheme } from './theme';

const LOGO = require('./imagens/icone.png');

// ---------------------------------------------------------------- estrutura da página

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
        // A mesma logo do app do computador
        <Image source={LOGO} style={styles.logo} accessibilityLabel="Comunica Trinys" />
      )}
      <View style={styles.headerTexts}>
        <Text style={[styles.headerTitle, { color: t.onHeader }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.headerSubtitle, { color: t.headerSoft }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ?? <ConnectionDot />}
    </View>
  );
}

/** Botão pequeno do cabeçalho (ícone ou texto curto) */
export function HeaderButton({ label, onPress, accessibilityLabel }: { label: string; onPress: () => void; accessibilityLabel?: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [styles.headerButton, { backgroundColor: pressed ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.08)' }]}>
      <Text style={[styles.headerButtonText, { color: t.onHeader }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Conteúdo rolável da página: centralizado com largura de leitura em telas
 * largas (tablet, celular deitado) e ocupando tudo no celular em pé.
 */
export function Page({
  children,
  refreshControl,
  contentStyle,
  keyboard,
}: {
  children: React.ReactNode;
  refreshControl?: React.ReactElement<any>;
  contentStyle?: StyleProp<ViewStyle>;
  keyboard?: boolean;
}) {
  const t = useTheme();
  const { maxWidth } = useLayout();
  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={[styles.page, { maxWidth }, contentStyle]}
      keyboardShouldPersistTaps={keyboard === false ? 'never' : 'handled'}
      refreshControl={refreshControl}>
      {children}
    </ScrollView>
  );
}

/** Estilo do conteúdo das listas (FlatList) com a mesma largura das páginas */
export function useListStyle(): StyleProp<ViewStyle> {
  const { maxWidth } = useLayout();
  return [styles.list, { maxWidth }];
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.sectionTitle, { color: t.textSoft }]}>{children}</Text>
      {right}
    </View>
  );
}

// ---------------------------------------------------------------- conexão

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
      <Text style={[styles.dotText, { color: t.headerSoft }]}>{STATUS_LABEL[connection.status]}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- botões e campos

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  style,
  small,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const t = useTheme();
  const palette = {
    primary: { bg: t.primary, fg: t.onPrimary, border: t.primary },
    secondary: { bg: t.surface, fg: t.text, border: t.fieldBorder },
    danger: { bg: t.surface, fg: t.dangerText, border: t.danger },
    ghost: { bg: 'transparent', fg: t.link, border: 'transparent' },
  }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      style={({ pressed }) => [
        small ? styles.buttonSmall : styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: off ? 0.55 : pressed ? 0.8 : 1 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <Text style={[small ? styles.buttonTextSmall : styles.buttonText, { color: palette.fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

/** Linha de botões que quebra em telas estreitas */
export function ButtonRow({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.buttonRow, style]}>{children}</View>;
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: t.textSoft }]}>{label}</Text>
      <TextInput
        placeholderTextColor={t.muted}
        {...props}
        style={[
          styles.input,
          props.multiline && styles.inputMultiline,
          { backgroundColor: t.surface, borderColor: t.fieldBorder, color: t.text },
          props.style,
        ]}
      />
      {hint ? <Text style={[styles.hint, { color: t.muted }]}>{hint}</Text> : null}
    </View>
  );
}

/** Campo de busca compacto (listas) */
export function SearchBox({ value, onChangeText, placeholder }: { value: string; onChangeText: (v: string) => void; placeholder: string }) {
  const t = useTheme();
  return (
    <View style={[styles.search, { backgroundColor: t.surface, borderColor: t.fieldBorder }]}>
      <Text style={styles.searchIcon}>🔍</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.muted}
        style={[styles.searchInput, { color: t.text }]}
        autoCorrect={false}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityLabel="Limpar busca">
          <Text style={[styles.searchClear, { color: t.muted }]}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Caixa de marcar com texto e explicação */
export function CheckRow({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => !disabled && onChange(!value)}
      style={[styles.check, { opacity: disabled ? 0.55 : 1 }]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value, disabled }}>
      <View style={[styles.checkBox, { borderColor: value ? t.primary : t.fieldBorder, backgroundColor: value ? t.primary : t.surface }]}>
        {value ? <Text style={[styles.checkMark, { color: t.onPrimary }]}>✓</Text> : null}
      </View>
      <View style={styles.flex}>
        <Text style={[styles.checkLabel, { color: t.text }]}>{label}</Text>
        {hint ? <Text style={[styles.hint, { color: t.muted }]}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

/** Escolha entre poucas opções (vira várias linhas se não couber) */
export function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const ativo = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: ativo }}
            style={[styles.chip, { borderColor: ativo ? t.primary : t.fieldBorder, backgroundColor: ativo ? t.primarySoft : t.surface }]}>
            <Text style={[styles.chipText, { color: ativo ? t.link : t.textSoft, fontWeight: ativo ? '700' : '500' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Lista de escolha num painel que sobe de baixo (substitui o <select>) */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
}: {
  label: string;
  value: T | '';
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  placeholder?: string;
}) {
  const t = useTheme();
  const [aberto, setAberto] = useState(false);
  const atual = options.find((o) => o.value === value);
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: t.textSoft }]}>{label}</Text>
      <Pressable
        onPress={() => setAberto(true)}
        accessibilityRole="button"
        style={[styles.input, styles.selectBox, { backgroundColor: t.surface, borderColor: t.fieldBorder }]}>
        <Text style={[styles.selectText, { color: atual ? t.text : t.muted }]} numberOfLines={1}>
          {atual?.label ?? placeholder ?? 'Escolher'}
        </Text>
        <Text style={{ color: t.muted }}>▾</Text>
      </Pressable>
      <Sheet visible={aberto} onClose={() => setAberto(false)} title={label}>
        {options.map((o) => (
          <SheetItem
            key={o.value}
            label={o.label}
            selected={o.value === value}
            onPress={() => {
              onChange(o.value);
              setAberto(false);
            }}
          />
        ))}
      </Sheet>
    </View>
  );
}

// ---------------------------------------------------------------- painéis

/** Painel que sobe de baixo, com rolagem (ações, escolhas) */
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { maxWidth } = useLayout();
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={[styles.sheetBackdrop, { backgroundColor: t.overlay }]} onPress={onClose}>
        <Pressable
          onPress={() => {}}
          style={[styles.sheet, { backgroundColor: t.surface, paddingBottom: Math.max(insets.bottom, 12), maxWidth }]}>
          <View style={[styles.sheetHandle, { backgroundColor: t.border }]} />
          {title ? <Text style={[styles.sheetTitle, { color: t.text }]}>{title}</Text> : null}
          <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function SheetItem({
  label,
  onPress,
  icon,
  danger,
  selected,
  hint,
}: {
  label: string;
  onPress: () => void;
  icon?: string;
  danger?: boolean;
  selected?: boolean;
  hint?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.sheetItem, { backgroundColor: pressed ? t.surface2 : 'transparent' }]}>
      {icon ? <Text style={styles.sheetIcon}>{icon}</Text> : null}
      <View style={styles.flex}>
        <Text style={[styles.sheetLabel, { color: danger ? t.dangerText : t.text, fontWeight: selected ? '800' : '500' }]}>{label}</Text>
        {hint ? <Text style={[styles.hint, { color: t.muted }]}>{hint}</Text> : null}
      </View>
      {selected ? <Text style={{ color: t.link, fontWeight: '800' }}>✓</Text> : null}
    </Pressable>
  );
}

/** Confirmação antes de uma ação que não dá para desfazer */
export function Confirm({
  visible,
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  loading,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <Pressable style={[styles.center, { backgroundColor: t.overlay }]} onPress={onCancel}>
        <Pressable onPress={() => {}} style={[styles.dialog, { backgroundColor: t.surface }]}>
          <Text style={[styles.dialogTitle, { color: t.text }]}>{title}</Text>
          {message ? <Text style={[styles.dialogText, { color: t.textSoft }]}>{message}</Text> : null}
          <View style={styles.dialogButtons}>
            <Button title="Cancelar" variant="secondary" onPress={onCancel} small style={styles.flex} />
            <Button title={confirmLabel} variant={danger ? 'danger' : 'primary'} onPress={onConfirm} loading={loading} small style={styles.flex} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------- informação

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

/** Linha de menu (tela "Mais", configurações) */
export function MenuRow({
  icon,
  label,
  hint,
  onPress,
  badge,
  danger,
}: {
  icon: string;
  label: string;
  hint?: string;
  onPress: () => void;
  badge?: number;
  danger?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.menuRow, { backgroundColor: pressed ? t.surface2 : t.surface, borderColor: t.border }]}>
      <Text style={styles.menuIcon}>{icon}</Text>
      <View style={styles.flex}>
        <Text style={[styles.menuLabel, { color: danger ? t.dangerText : t.text }]}>{label}</Text>
        {hint ? <Text style={[styles.hint, { color: t.muted }]}>{hint}</Text> : null}
      </View>
      <Badge count={badge ?? 0} />
      <Text style={[styles.menuArrow, { color: t.muted }]}>›</Text>
    </Pressable>
  );
}

export function TypeTag({ type }: { type: MessageType }) {
  const t = useTheme();
  const tone = TONES[type];
  return (
    <View style={[styles.tag, { backgroundColor: t.dark ? tone.softDark : tone.soft }]}>
      <Text style={[styles.tagText, { color: t.dark ? '#f2f5f8' : tone.color }]}>
        {tone.icon} {TYPE_LABELS[type]}
      </Text>
    </View>
  );
}

/** Etiqueta de situação (verde, amarela, vermelha, azul ou neutra) */
export function Tag({ text, tone = 'neutral' }: { text: string; tone?: 'ok' | 'warn' | 'error' | 'info' | 'neutral' }) {
  const t = useTheme();
  const cores = {
    ok: [t.okBg, t.okText],
    warn: [t.warnBg, t.warnText],
    error: [t.errorBg, t.errorText],
    info: [t.infoBg, t.infoText],
    neutral: [t.surface2, t.textSoft],
  }[tone];
  return (
    <View style={[styles.tag, { backgroundColor: cores[0] }]}>
      <Text style={[styles.tagText, { color: cores[1] }]}>{text}</Text>
    </View>
  );
}

export function Badge({ count }: { count: number }) {
  const t = useTheme();
  if (count <= 0) return null;
  return (
    <View style={[styles.badge, { backgroundColor: t.badge }]}>
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

export function Empty({ icon, text, action }: { icon: string; text: string; action?: { title: string; onPress: () => void } }) {
  const t = useTheme();
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={[styles.emptyText, { color: t.muted }]}>{text}</Text>
      {action ? <Button title={action.title} onPress={action.onPress} small variant="secondary" /> : null}
    </View>
  );
}

export function Loading({ text }: { text?: string }) {
  const t = useTheme();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={t.primary} size="large" />
      {text ? <Text style={[styles.hint, { color: t.muted }]}>{text}</Text> : null}
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
          <Text style={[styles.bannerAction, { color: t.link }]}>{action.title}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Feedback({ result }: { result: { ok: boolean; message: string } | null }) {
  const t = useTheme();
  if (!result || !result.message) return null;
  return <Text style={[styles.feedback, { color: result.ok ? t.okText : t.dangerText }]}>{result.message}</Text>;
}

// ---------------------------------------------------------------- imagens do servidor

/**
 * Imagem guardada no servidor (/api/midias/:id). A tag de imagem manda o token
 * do aparelho no cabeçalho, então fotos, mural e chat aparecem sem link público.
 */
export function MidiaImage({
  midiaId,
  style,
  resizeMode = 'cover',
  onError,
}: {
  midiaId: string;
  style: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain';
  onError?: () => void;
}) {
  const { sessao } = useApp();
  const api = getApi();
  if (!api) return <View style={style as StyleProp<ViewStyle>} />;
  return (
    <Image
      key={`${midiaId}-${sessao}`}
      source={{ uri: api.midiaUrl(midiaId), headers: api.authHeaders }}
      style={style}
      resizeMode={resizeMode}
      onError={onError}
    />
  );
}

/** Foto da pessoa, ou as iniciais quando ela não tem foto (ou a foto não carrega) */
export function Avatar({ nome, fotoMidiaId, size = 40, grupo }: { nome: string; fotoMidiaId?: string | null; size?: number; grupo?: boolean }) {
  const t = useTheme();
  const [falhou, setFalhou] = useState(false);
  const circulo = { width: size, height: size, borderRadius: size / 2 };
  if (grupo) {
    return (
      <View style={[styles.avatar, circulo, { backgroundColor: t.primarySoft }]}>
        <Text style={{ fontSize: size * 0.45 }}>👥</Text>
      </View>
    );
  }
  if (fotoMidiaId && !falhou) {
    return <MidiaImage midiaId={fotoMidiaId} style={[circulo, { backgroundColor: t.surface2 }]} onError={() => setFalhou(true)} />;
  }
  return (
    <View style={[styles.avatar, circulo, { backgroundColor: t.primary }]}>
      <Text style={[styles.avatarText, { color: t.onPrimary, fontSize: size * 0.36 }]}>{iniciais(nome)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14 },
  back: { width: 32, height: 36, justifyContent: 'center' },
  backText: { fontSize: 34, lineHeight: 36, fontWeight: '300' },
  logo: { width: 36, height: 36 },
  headerTexts: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerSubtitle: { fontSize: 12.5, marginTop: 1 },
  headerButton: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  headerButtonText: { fontSize: 14, fontWeight: '700' },
  page: { width: '100%', alignSelf: 'center', padding: 16, paddingBottom: 32, gap: 14 },
  list: { width: '100%', alignSelf: 'center', padding: 12, paddingBottom: 32, gap: 10 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  sectionTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  dotWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dotText: { fontSize: 12 },
  button: { minHeight: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  buttonSmall: { minHeight: 40, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  buttonText: { fontSize: 15.5, fontWeight: '700' },
  buttonTextSmall: { fontSize: 14, fontWeight: '700' },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 13.5, fontWeight: '600', marginBottom: 6 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 16 },
  inputMultiline: { minHeight: 110, paddingTop: 12, textAlignVertical: 'top' },
  hint: { fontSize: 12.5, marginTop: 4, lineHeight: 17 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 44 },
  searchIcon: { fontSize: 14 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 8 },
  searchClear: { fontSize: 16, paddingHorizontal: 4 },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 8 },
  checkBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkMark: { fontSize: 15, fontWeight: '900' },
  checkLabel: { fontSize: 15, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 14 },
  selectBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  selectText: { flex: 1, fontSize: 16 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxHeight: '85%', borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8 },
  sheetHandle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, marginBottom: 8 },
  sheetTitle: { fontSize: 16, fontWeight: '800', paddingHorizontal: 20, paddingBottom: 8 },
  sheetScroll: { flexGrow: 0 },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 14 },
  sheetIcon: { fontSize: 20, width: 26, textAlign: 'center' },
  sheetLabel: { fontSize: 16 },
  dialog: { width: '100%', maxWidth: 420, borderRadius: 16, padding: 20, gap: 12 },
  dialogTitle: { fontSize: 17, fontWeight: '800' },
  dialogText: { fontSize: 14.5, lineHeight: 20 },
  dialogButtons: { flexDirection: 'row', gap: 10, marginTop: 6 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14 },
  menuIcon: { fontSize: 22, width: 28, textAlign: 'center' },
  menuLabel: { fontSize: 15.5, fontWeight: '700' },
  menuArrow: { fontSize: 24, fontWeight: '300' },
  tag: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  tagText: { fontSize: 12, fontWeight: '700' },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 11.5, fontWeight: '800' },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 12 },
  emptyIcon: { fontSize: 40 },
  emptyText: { fontSize: 14.5, textAlign: 'center', lineHeight: 21 },
  loading: { paddingVertical: 48, alignItems: 'center', gap: 12 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, paddingLeft: 0, overflow: 'hidden' },
  bannerBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  bannerText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  bannerAction: { fontSize: 13.5, fontWeight: '700' },
  feedback: { fontSize: 14, marginTop: 4, textAlign: 'center' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800' },
});
