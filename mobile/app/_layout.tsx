/**
 * Layout raiz da aplicação.
 * Verifica estado de autenticação e redireciona para onboarding ou home.
 */
import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { useAuthStore } from "@/store/useAuthStore";
import { useP2PStore } from "@/store/useP2PStore";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { configureBrowserDemoWindow } from "@/dev/browserDemoSession";
import { useLiveGps } from "@/dev/useLiveGps";
import { useRideGpsFallback } from "@/dev/useRideGpsFallback";

export default function RootLayout() {
  useLiveGps();
  useRideGpsFallback();
  const { status, session, initialize } = useAuthStore();
  const { initService } = useP2PStore();
  const router = useRouter();
  const segments = useSegments();

  // Boot: verifica wallet salva
  useEffect(() => {
    configureBrowserDemoWindow();
    initialize();
  }, []);

  // Inicializa P2P quando autenticado
  useEffect(() => {
    if (status === "authenticated" && session) {
      initService(session.profile.did);
    }
  }, [status, session]);

  // Roteamento baseado no estado de auth
  useEffect(() => {
    const inAuthGroup = segments[0] === "(auth)";

    if (status === "checking" || status === "signing") return;

    if (status === "no_wallet" || status === "idle" || status === "locked" || status === "needs_password" || status === "error") {
      if (!inAuthGroup) router.replace("/(auth)/onboarding");
    } else if (status === "authenticated") {
      if (inAuthGroup) router.replace("/(app)/home");
    }
  }, [status, segments]);

  if (status === "checking") {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0f172a" }}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <View style={styles.shell}>
      <View style={[styles.application, Platform.OS === "web" && styles.webApplication]}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
          <Stack.Screen name="scan-demo" />
        </Stack>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: "#020617" },
  application: { flex: 1 },
  webApplication: {
    width: "100%",
    maxWidth: 430,
    alignSelf: "center",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: "#1e293b",
  },
});
