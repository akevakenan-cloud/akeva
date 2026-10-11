// Same identity as the admin console: forest green, ink, savanna amber.
// High contrast and large targets: phones are often used outdoors in bright sun.
export const colors = {
  forest: "#0F6B4A",
  forestDeep: "#0A4D35",
  forestTint: "#E3F1EA",
  ink: "#13241C",
  ink2: "#3D5248",
  ink3: "#66786F",
  ground: "#EEF2EF",
  surface: "#FFFFFF",
  line: "#CFD9D3",
  lineStrong: "#9FB1A7",
  amber: "#C98A0B",
  amberInk: "#6B4700",
  amberTint: "#FDF1D6",
  danger: "#B42318",
  dangerTint: "#FDE8E6",
  white: "#FFFFFF",
};

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 };
export const tap = 56; // minimum height for primary actions

export const type = {
  display: { fontSize: 30, fontWeight: "800" as const, color: colors.ink, letterSpacing: -0.4 },
  title: { fontSize: 22, fontWeight: "700" as const, color: colors.ink },
  heading: { fontSize: 18, fontWeight: "700" as const, color: colors.ink },
  body: { fontSize: 17, lineHeight: 24, color: colors.ink },
  label: { fontSize: 15, fontWeight: "700" as const, color: colors.ink2 },
  muted: { fontSize: 15, lineHeight: 21, color: colors.ink3 },
  money: { fontSize: 28, fontWeight: "800" as const, color: colors.ink, fontVariant: ["tabular-nums" as const] },
};

export const categoryColor: Record<string, string> = {
  moto: "#475467",
  economy: colors.forest,
  comfort: "#1D4ED8",
  prestige: "#7A2E8E",
  gold: "#C98A0B",
  platinum: "#283541",
};
