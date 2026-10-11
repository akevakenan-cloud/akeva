import { CameraView, useCameraPermissions } from "expo-camera";
import * as DocumentPicker from "expo-document-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError, uploadDocument } from "./api";
import { useI18n } from "./i18n";
import { colors, radius, space, type } from "./theme";
import { Banner, Button, Card, Muted, Row } from "./ui";

/**
 * One required document: take a photo (or pick a PDF where allowed) and upload it.
 * Selfies use the front camera only, with no gallery option, so they're taken live.
 * Photos are resized and compressed before upload to save mobile data.
 */
export function DocumentSlot({ docType, done, allowPdf, onUploaded }: {
  docType: string; done: boolean; allowPdf?: boolean; onUploaded: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selfie = docType === "selfie";

  async function upload(file: { uri: string; name: string; type: string }) {
    setBusy(true);
    setError(null);
    try {
      await uploadDocument(docType, file);
      onUploaded();
    } catch (e) {
      setError(e instanceof ApiError && e.code === "network" ? t("common.network") : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function onPhoto(uri: string) {
    setOpen(false);
    const small = await manipulateAsync(uri, [{ resize: { width: 1600 } }], { compress: 0.7, format: SaveFormat.JPEG });
    await upload({ uri: small.uri, name: `${docType}.jpg`, type: "image/jpeg" });
  }

  async function pickPdf() {
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await upload({ uri: a.uri, name: a.name ?? `${docType}.pdf`, type: "application/pdf" });
  }

  return (
    <Card style={done ? { borderColor: colors.forest } : undefined}>
      <Row style={{ justifyContent: "space-between" }}>
        <Text style={[type.heading, { flex: 1 }]}>{t(`doc.${docType}`)}</Text>
        {done ? <Text style={{ color: colors.forest, fontWeight: "800" }}>✓ {t("onb.uploaded")}</Text> : null}
      </Row>
      {selfie ? <Muted>{t("doc.selfieHint")}</Muted> : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Button small variant={done ? "secondary" : "primary"} title={busy ? t("onb.uploading") : t(done ? "onb.retake" : "onb.take")}
              loading={busy} onPress={() => setOpen(true)} />
      {allowPdf && !busy ? <Button small variant="ghost" title={t("onb.choosePdf")} onPress={pickPdf} /> : null}
      <CameraModal visible={open} front={selfie} onClose={() => setOpen(false)} onPhoto={onPhoto} />
    </Card>
  );
}

function CameraModal({ visible, front, onClose, onPhoto }: {
  visible: boolean; front: boolean; onClose: () => void; onPhoto: (uri: string) => void;
}) {
  const { t } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [taking, setTaking] = useState(false);

  async function shoot() {
    if (!camera.current || taking) return;
    setTaking(true);
    try {
      const pic = await camera.current.takePictureAsync({ quality: 0.8, skipProcessing: false });
      if (pic?.uri) onPhoto(pic.uri);
    } finally {
      setTaking(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
        {!permission?.granted ? (
          <View style={{ flex: 1, padding: space.lg, justifyContent: "center", gap: space.md, backgroundColor: colors.ground }}>
            <Muted>{t("onb.consentSelfie")}</Muted>
            <Button title={t("common.continue")} onPress={requestPermission} />
            <Button variant="ghost" title={t("common.cancel")} onPress={onClose} />
          </View>
        ) : (
          <>
            <CameraView ref={camera} style={{ flex: 1 }} facing={front ? "front" : "back"} />
            {/* framing guide: oval for faces, card shape for documents */}
            <View pointerEvents="none" style={{ position: "absolute", top: "18%", alignSelf: "center",
              width: front ? 240 : "86%", height: front ? 320 : 220, borderRadius: front ? 160 : radius.md,
              borderWidth: 3, borderColor: "#ffffffcc" }} />
            <Row style={{ padding: space.lg, justifyContent: "space-between", backgroundColor: "#000" }}>
              <Button small variant="ghost" title={t("common.cancel")} onPress={onClose} style={{ borderColor: "transparent" }} />
              <Pressable onPress={shoot} accessibilityRole="button" accessibilityLabel={t("onb.take")}
                         style={{ width: 76, height: 76, borderRadius: 38, borderWidth: 5, borderColor: "#fff",
                                  backgroundColor: taking ? "#999" : "#fff3" }} />
              <View style={{ width: 80 }} />
            </Row>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}
