import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, Text, TextInput, View } from "react-native";
import { ApiError, get, post } from "./api";
import { usePolling } from "./events";
import { useI18n } from "./i18n";
import { useSession } from "./session";
import { colors, radius, space, type } from "./theme";
import { Banner, Button, Card, Field, Row, Screen, Stars, Title } from "./ui";

export type ChatMessage = { id: string; sender_role: "rider" | "driver"; text: string; created_at: string };

/** In-ride chat. New messages also arrive over the WebSocket; polling covers dropped sockets. */
export function RideChat({ rideId, incoming }: { rideId: string; incoming?: ChatMessage | null }) {
  const { t } = useI18n();
  const { me } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [closed, setClosed] = useState(false);

  const load = useCallback(() => {
    get<ChatMessage[]>(`/rides/${rideId}/messages`).then(setMessages).catch(() => {});
  }, [rideId]);
  useEffect(load, [load]);
  usePolling(load, 10_000);
  useEffect(() => {
    if (incoming && incoming.id && !messages.some((m) => m.id === incoming.id)) setMessages((m) => [...m, incoming]);
  }, [incoming, messages]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText("");
    try {
      const m = await post<ChatMessage>(`/rides/${rideId}/messages`, { text: body });
      setMessages((list) => [...list, m]);
    } catch (e) {
      if (e instanceof ApiError && e.code === "chat_closed") setClosed(true);
      setText(body);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen scroll={false}>
        <Title>{t("chat.title")}</Title>
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ gap: space.sm, paddingVertical: space.sm }}
          renderItem={({ item }) => {
            const mine = item.sender_role === me?.role;
            return (
              <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "80%", padding: space.md,
                             borderRadius: radius.lg, backgroundColor: mine ? colors.forest : colors.surface,
                             borderWidth: mine ? 0 : 1, borderColor: colors.line }}>
                <Text style={[type.body, { color: mine ? colors.white : colors.ink }]}>{item.text}</Text>
              </View>
            );
          }}
        />
        {closed ? <Banner kind="warn">{t("common.error")}</Banner> : null}
        <Row>
          <TextInput value={text} onChangeText={setText} placeholder={t("chat.placeholder")} maxLength={500}
                     placeholderTextColor={colors.ink3} onSubmitEditing={send} returnKeyType="send"
                     style={{ flex: 1, minHeight: 52, borderWidth: 2, borderColor: colors.lineStrong, borderRadius: radius.md,
                              paddingHorizontal: space.md, fontSize: 17, backgroundColor: colors.surface }} />
          <Button small title={t("chat.send")} onPress={send} disabled={!text.trim()} />
        </Row>
      </Screen>
    </KeyboardAvoidingView>
  );
}

export function callNumber(phone: string) {
  Linking.openURL(`tel:${phone}`).catch(() => {});
}

/** Rate the other person once the ride is finished. */
export function RateCard({ rideId, title, onDone }: { rideId: string; title: string; onDone: () => void }) {
  const { t } = useI18n();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      await post(`/rides/${rideId}/rating`, { stars, comment: comment.trim() || null });
    } catch {}
    setBusy(false);
    onDone();
  }
  return (
    <Card>
      <Text style={[type.heading, { textAlign: "center" }]}>{title}</Text>
      <Stars value={stars} onChange={setStars} />
      {stars > 0 ? <Field label={t("rate.comment")} value={comment} onChangeText={setComment} maxLength={500} /> : null}
      <Button title={t("rate.send")} onPress={send} disabled={stars === 0} loading={busy} />
      <Button variant="ghost" title={t("common.done")} onPress={onDone} />
    </Card>
  );
}

/** Language, sign-out and the right-to-be-forgotten request, shared by both apps. */
export function SettingsScreen() {
  const { t, lang, setLang } = useI18n();
  const { me, signOut } = useSession();
  const [sent, setSent] = useState(false);
  function requestDeletion() {
    Alert.alert(t("common.deleteAccount"), t("common.deleteConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.yes"), style: "destructive", onPress: async () => {
        try {
          await post("/me/deletion-request", {});
          setSent(true);
        } catch {}
      } },
    ]);
  }
  return (
    <Screen>
      <Title>{t("common.settings")}</Title>
      <Text style={type.muted}>{me?.full_name}{"\n"}{me?.phone}</Text>
      <Text style={type.label}>{t("common.language")}</Text>
      <Row>
        {(["fr", "en"] as const).map((l) => (
          <Pressable key={l} onPress={() => setLang(l)} accessibilityRole="radio" accessibilityState={{ selected: lang === l }}
                     style={{ flex: 1, minHeight: 52, borderRadius: radius.md, borderWidth: 2, alignItems: "center", justifyContent: "center",
                              borderColor: lang === l ? colors.forest : colors.line, backgroundColor: lang === l ? colors.forestTint : colors.surface }}>
            <Text style={[type.body, { fontWeight: "800" }]}>{l === "fr" ? "Français" : "English"}</Text>
          </Pressable>
        ))}
      </Row>
      <Button variant="secondary" title={t("common.signOut")} onPress={signOut} />
      {sent ? <Banner>{t("common.deleteSent")}</Banner>
        : <Button variant="danger" title={t("common.deleteAccount")} onPress={requestDeletion} />}
    </Screen>
  );
}
