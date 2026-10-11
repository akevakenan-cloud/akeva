import { Gate, I18nProvider, SessionProvider, colors } from "@akeva/core";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <SessionProvider role="rider">
          <StatusBar style="dark" />
          <Gate role="rider">
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }} />
          </Gate>
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
