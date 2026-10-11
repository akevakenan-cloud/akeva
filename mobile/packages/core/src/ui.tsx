import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { StyleProp, TextInputProps, TextStyle, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, space, tap, type } from "./theme";

export function Screen({ children, scroll = true, style }: {
  children: React.ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const inner = <View style={[styles.screenInner, style]}>{children}</View>;
  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>{inner}</ScrollView> : inner}
    </SafeAreaView>
  );
}

export function Title({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[type.title, style]} accessibilityRole="header">{children}</Text>;
}

export function Display({ children }: { children: React.ReactNode }) {
  return <Text style={type.display} accessibilityRole="header">{children}</Text>;
}

export function Body({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[type.body, style]}>{children}</Text>;
}

export function Muted({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[type.muted, style]}>{children}</Text>;
}

type Variant = "primary" | "secondary" | "danger" | "ghost" | "amber";

export function Button({ title, onPress, variant = "primary", disabled, loading, style, small }: {
  title: string; onPress: () => void; variant?: Variant; disabled?: boolean; loading?: boolean;
  style?: StyleProp<ViewStyle>; small?: boolean;
}) {
  const v = buttonVariants[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: loading }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.button, small && styles.buttonSmall, { backgroundColor: v.bg, borderColor: v.border },
        pressed && !off && { opacity: 0.85 }, off && { opacity: 0.5 }, style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : (
        <Text style={[styles.buttonText, small && { fontSize: 16 }, { color: v.fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const buttonVariants: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.forest, fg: colors.white, border: colors.forest },
  secondary: { bg: colors.surface, fg: colors.ink, border: colors.lineStrong },
  danger: { bg: colors.surface, fg: colors.danger, border: colors.danger },
  ghost: { bg: "transparent", fg: colors.ink2, border: "transparent" },
  amber: { bg: colors.amber, fg: "#241800", border: colors.amber },
};

export function Field({ label, hint, error, ...input }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={type.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.ink3}
        accessibilityLabel={label}
        {...input}
        style={[styles.input, error ? { borderColor: colors.danger } : null, input.style]}
      />
      {error ? <Text style={[type.muted, { color: colors.danger }]}>{error}</Text>
        : hint ? <Text style={type.muted}>{hint}</Text> : null}
    </View>
  );
}

/** Large tappable options instead of tiny radio buttons or dropdowns. */
export function Choice<T extends string>({ label, options, value, onChange }: {
  label?: string; options: { value: T; label: string; sub?: string }[]; value: T | null; onChange: (v: T) => void;
}) {
  return (
    <View style={{ gap: 8 }} accessibilityRole="radiogroup">
      {label ? <Text style={type.label}>{label}</Text> : null}
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="radio"
                     accessibilityState={{ selected: on }}
                     style={[styles.choice, on && { borderColor: colors.forest, backgroundColor: colors.forestTint }]}>
            <View style={[styles.radio, on && { borderColor: colors.forest }]}>{on ? <View style={styles.radioDot} /> : null}</View>
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { fontWeight: "700" }]}>{o.label}</Text>
              {o.sub ? <Text style={type.muted}>{o.sub}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="checkbox" accessibilityState={{ checked: value }}
               style={styles.check}>
      <View style={[styles.box, value && { backgroundColor: colors.forest, borderColor: colors.forest }]}>
        {value ? <Text style={{ color: colors.white, fontWeight: "900" }}>✓</Text> : null}
      </View>
      <Text style={[type.body, { flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

export function Banner({ kind = "info", children }: { kind?: "info" | "warn" | "error"; children: React.ReactNode }) {
  const c = kind === "error" ? [colors.dangerTint, colors.danger]
    : kind === "warn" ? [colors.amberTint, colors.amberInk] : [colors.forestTint, colors.forestDeep];
  return (
    <View style={[styles.banner, { backgroundColor: c[0] }]} accessibilityRole="alert">
      <Text style={[type.body, { color: c[1], fontWeight: "600" }]}>{children}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap: space.sm }, style]}>{children}</View>;
}

export function Loading() {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl }}>
    <ActivityIndicator size="large" color={colors.forest} />
  </View>;
}

export function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <Row style={{ justifyContent: "center", gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onChange(n)} accessibilityRole="button" accessibilityLabel={`${n}/5`}
                   style={{ padding: 6 }} hitSlop={6}>
          <Text style={{ fontSize: 40, color: n <= value ? colors.amber : colors.line }}>★</Text>
        </Pressable>
      ))}
    </Row>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  screenInner: { flex: 1, padding: space.lg, gap: space.md },
  button: {
    minHeight: tap, borderRadius: radius.md, borderWidth: 2, paddingHorizontal: space.lg,
    alignItems: "center", justifyContent: "center",
  },
  buttonSmall: { minHeight: 44, paddingHorizontal: space.md },
  buttonText: { fontSize: 18, fontWeight: "800" },
  input: {
    minHeight: tap, borderWidth: 2, borderColor: colors.lineStrong, borderRadius: radius.md,
    backgroundColor: colors.surface, paddingHorizontal: space.md, fontSize: 18, color: colors.ink,
  },
  choice: {
    flexDirection: "row", alignItems: "center", gap: space.md, minHeight: tap, padding: space.md,
    borderWidth: 2, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface,
  },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.lineStrong, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.forest },
  check: { flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingVertical: space.sm },
  box: { width: 28, height: 28, borderRadius: 6, borderWidth: 2, borderColor: colors.lineStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  banner: { padding: space.md, borderRadius: radius.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.line, gap: space.sm },
});
