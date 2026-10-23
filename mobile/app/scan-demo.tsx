import { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import DemoQrScanner from "@/components/DemoQrScanner";
import {
  clearDemoPairing, demoPeerProfile, getCachedDemoPairing, saveDemoPairing,
  type DemoPairing,
} from "@/dev/demoPairing";
import { useAuthStore } from "@/store/useAuthStore";

export default function ScanDemoScreen() {
  const router = useRouter();
  const [pairing, setPairing] = useState<DemoPairing | null>(getCachedDemoPairing());
  const [paused, setPaused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const auth = useAuthStore();
  const expected = pairing ? demoPeerProfile(pairing.peer) : null;
  const currentDid = auth.session?.profile.did ?? auth.account?.did ?? null;
  const identityMismatch = Boolean(
    expected && currentDid && currentDid.toLowerCase() !== expected.did.toLowerCase()
  );

  const handleScanned = async (raw: string) => {
    setPaused(true);
    setSaving(true);
    setError(null);
    try {
      const saved = await saveDemoPairing(raw);
      setPairing(saved);
      const state = useAuthStore.getState();
      if (state.status !== "authenticated" && state.status !== "signing") {
        await state.initialize();
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "QR code inválido.");
      setTimeout(() => setPaused(false), 1200);
    } finally {
      setSaving(false);
    }
  };

  const continueToApp = () => {
    const state = useAuthStore.getState();
    router.replace(state.status === "authenticated" ? "/(app)/home" : "/(auth)/onboarding");
  };

  const scanAgain = () => {
    setPaused(false);
    setError(null);
  };

  const removePairing = async () => {
    await clearDemoPairing();
    setPairing(null);
    setPaused(false);
    setError(null);
  };

  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <View style={s.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Voltar" onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#f8fafc" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Conectar ao painel</Text>
        <View style={{ width: 24 }} />
      </View>

      <Text style={s.intro}>
        Escaneie o QR code do painel de testes. Ele configura o servidor da demo,
        a sessão e o papel deste aparelho (passageiro ou motorista).
      </Text>

      <View style={s.cameraWrap}>
        <DemoQrScanner onScanned={(raw) => void handleScanned(raw)} paused={paused || saving} />
        {saving ? (
          <View style={s.savingOverlay} pointerEvents="none">
            <Text style={s.savingText}>Validando QR code...</Text>
          </View>
        ) : null}
      </View>

      {error ? (
        <View style={s.errorCard}>
          <Ionicons name="alert-circle" size={20} color="#fca5a5" />
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}

      {pairing && expected ? (
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Ionicons name="checkmark-circle" size={24} color="#10b981" />
            <Text style={s.cardTitle}>Pareamento concluído</Text>
          </View>
          <Text style={s.role}>
            {pairing.peer === "client" ? "👤 Passageiro" : "🚗 Motorista"} · {expected.displayName}
          </Text>
          <Text style={s.mono}>Servidor: {pairing.server}</Text>
          <Text style={s.mono}>Sessão: {pairing.session}</Text>
          <Text style={s.mono}>
            DID: {expected.did.slice(0, 14)}...{expected.did.slice(-6)}
          </Text>

          {identityMismatch ? (
            <Text style={s.warning}>
              Este aparelho está com outra identidade. Para usar a conta do QR, saia e remova a
              identidade atual no Perfil antes de entrar com {expected.displayName}. O QR não
              apaga chaves existentes.
            </Text>
          ) : (
            <Text style={s.hint}>
              Entre com a senha Demo@123 para usar {expected.displayName}. Se este aparelho ainda
              não tinha identidade, a conta de demonstração já foi preparada.
            </Text>
          )}

          <View style={s.actions}>
            <TouchableOpacity style={s.primary} onPress={continueToApp} accessibilityRole="button">
              <Text style={s.primaryText}>Continuar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.secondary} onPress={scanAgain} accessibilityRole="button">
              <Text style={s.secondaryText}>Escanear outro QR</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => void removePairing()} accessibilityRole="button">
              <Text style={s.removeText}>Remover pareamento</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={s.card}>
          <Text style={s.cardTitle}>Como conectar</Text>
          <Text style={s.hint}>
            1. Abra o painel em http://localhost:4747/panel no computador.{"\n"}
            2. No painel, localize “Conectar APK por QR code”.{"\n"}
            3. Escaneie o QR do passageiro ou do motorista.{"\n"}
            4. Entre com a senha Demo@123.
          </Text>
          <Text style={s.hint}>
            O celular e o computador precisam estar na mesma rede Wi-Fi.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 20, paddingBottom: 40, gap: 14 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 24 },
  headerTitle: { color: "#f8fafc", fontSize: 20, fontWeight: "700" },
  intro: { color: "#94a3b8", fontSize: 14, lineHeight: 21 },
  cameraWrap: { height: 360, borderRadius: 16, overflow: "hidden", backgroundColor: "#020617" },
  savingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(2,6,23,0.72)" },
  savingText: { color: "#f8fafc", fontSize: 15, fontWeight: "700" },
  errorCard: { flexDirection: "row", alignItems: "flex-start", gap: 9, backgroundColor: "rgba(239,68,68,0.14)", borderWidth: 1, borderColor: "#ef4444", borderRadius: 12, padding: 12 },
  errorText: { color: "#fca5a5", fontSize: 13, lineHeight: 19, flex: 1 },
  card: { backgroundColor: "#1e293b", borderRadius: 16, padding: 16, gap: 8 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { color: "#f8fafc", fontSize: 16, fontWeight: "700" },
  role: { color: "#c7d2fe", fontSize: 15, fontWeight: "700" },
  mono: { color: "#94a3b8", fontSize: 12, fontFamily: "monospace" },
  hint: { color: "#94a3b8", fontSize: 13, lineHeight: 20 },
  warning: { color: "#fcd34d", fontSize: 13, lineHeight: 20 },
  actions: { gap: 9, marginTop: 6 },
  primary: { backgroundColor: "#6366f1", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  secondary: { borderWidth: 1, borderColor: "#6366f1", borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  secondaryText: { color: "#a5b4fc", fontWeight: "700", fontSize: 14 },
  removeText: { color: "#fca5a5", fontSize: 13, textAlign: "center", paddingVertical: 8 },
});
