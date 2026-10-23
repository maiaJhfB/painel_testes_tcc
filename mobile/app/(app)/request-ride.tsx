/**
 * Tela de Solicitação de Corrida
 *
 * O cliente insere o DID do motorista (ou escaneia QR), verifica se está
 * registrado on-chain, e inicia a conexão P2P direta.
 */
import { useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { isAddress } from "ethers";
import { useP2PStore } from "@/store/useP2PStore";
import { identityService, type IdentityProfile } from "@/dev/index";
import { useAuthStore } from "@/store/useAuthStore";
import type { RideFare } from "@/core/ports";
import { loadFareQuote, money } from "@/dev/demoFare";
import RideFareCard from "@/components/RideFareCard";

type Step = "input" | "verifying" | "verified" | "connecting";

export default function RequestRideScreen() {
  const [driverDid, setDriverDid] = useState("");
  const [step, setStep] = useState<Step>("input");
  const [driverProfile, setDriverProfile] = useState<Omit<IdentityProfile, "lastLogin"> | null>(null);
  const [verifiedDid, setVerifiedDid] = useState<string | null>(null);
  const [fare, setFare] = useState<RideFare | null>(null);
  const [fareError, setFareError] = useState<string | null>(null);
  const callerDid = useAuthStore((state) => state.session?.profile.did);
  const currentDid = useRef("");
  const phase = useRef<Step>("input");
  const attempt = useRef(0);
  const { callPeer } = useP2PStore();
  const router = useRouter();

  useEffect(() => () => { attempt.current += 1; }, []);

  const changeStep = (next: Step) => {
    phase.current = next;
    setStep(next);
  };

  const clearVerification = () => {
    setDriverProfile(null);
    setVerifiedDid(null);
    setFare(null);
  };

  const handleDidChange = (value: string) => {
    if (phase.current === "connecting") return;
    attempt.current += 1;
    currentDid.current = value.trim();
    setDriverDid(value);
    setFareError(null);
    clearVerification();
    changeStep("input");
  };

  const handleVerify = async () => {
    if (phase.current !== "input") return;
    const did = currentDid.current;
    setFareError(null);
    clearVerification();
    if (!isAddress(did)) {
      Alert.alert("DID inválido", "O DID deve ser um endereço Ethereum (0x...)");
      return;
    }

    const request = ++attempt.current;
    let confirmed = false;
    changeStep("verifying");
    try {
      const registered = await identityService.isRegisteredOnChain(did);
      if (request !== attempt.current) return;
      if (registered !== true) {
        Alert.alert(
          "Registro não confirmado",
          "Não foi possível confirmar o registro deste endereço na cooperativa. Tente novamente."
        );
        return;
      }

      const profile = await identityService.getProfileFromChain(did);
      if (request !== attempt.current) return;
      if (!profile || profile.role !== "driver") {
        Alert.alert("Motorista não confirmado", "Não foi possível confirmar um perfil de motorista para este DID.");
        return;
      }

      if (!callerDid) throw new Error("Entre na sua conta antes de solicitar uma corrida.");
      const estimate = await loadFareQuote(callerDid, did);
      if (request !== attempt.current) return;
      setFare(estimate);
      setDriverProfile(profile);
      setVerifiedDid(did);
      confirmed = true;
    } catch (err) {
      if (request === attempt.current) {
        setFareError(err instanceof Error ? err.message : "Não foi possível verificar a corrida.");
        Alert.alert("Erro de verificação", String(err));
      }
    } finally {
      if (request === attempt.current) {
        if (!confirmed) clearVerification();
        changeStep(confirmed ? "verified" : "input");
      }
    }
  };

  const handleConnect = async () => {
    if (phase.current !== "verified" || !verifiedDid || !driverProfile || !fare || currentDid.current !== verifiedDid) return;
    if (fare.expiresAt <= Date.now()) {
      clearVerification();
      changeStep("input");
      setFareError("Estimativa expirada. Verifique novamente para atualizar o preço antes de chamar.");
      return;
    }
    const request = attempt.current;
    changeStep("connecting");
    try {
      await callPeer(verifiedDid, fare);
      if (request !== attempt.current) return;
      changeStep("verified");
      router.replace("/(app)/active-ride");
    } catch (err) {
      if (request !== attempt.current) return;
      attempt.current += 1;
      clearVerification();
      changeStep("input");
      setFareError(err instanceof Error ? err.message : "Não foi possível chamar o motorista.");
      Alert.alert("Erro de conexão", String(err));
    }
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity accessibilityLabel="Voltar" disabled={step === "connecting"} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#f8fafc" />
        </TouchableOpacity>
        <Text style={s.title}>Solicitar Corrida</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Explicação do fluxo P2P */}
      <View style={s.infoCard}>
        <Ionicons name="information-circle" size={20} color="#6366f1" />
        <Text style={s.infoText}>
          Insira o DID (endereço Ethereum) do motorista. Após verificação
          on-chain, você poderá iniciar uma conexão P2P direta.
        </Text>
      </View>

      {/* Input do DID */}
      <View style={s.card}>
        <Text style={s.label}>DID do Motorista</Text>
        <TextInput
          style={s.input}
          value={driverDid}
          onChangeText={handleDidChange}
          placeholder="0x..."
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
          editable={step !== "connecting"}
        />

        {step === "input" && (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Verificar na Blockchain" style={s.verifyButton} onPress={handleVerify}>
            <Ionicons name="search" size={16} color="#fff" />
            <Text style={s.verifyButtonText}>Verificar na Blockchain</Text>
          </TouchableOpacity>
        )}

        {step === "verifying" && (
          <View style={s.loadingRow}>
            <ActivityIndicator size="small" color="#6366f1" />
            <Text style={s.loadingText}>Verificando motorista e calculando preço...</Text>
          </View>
        )}
      </View>

      {fareError && <Text accessibilityRole="alert" style={s.fareError}>{fareError}</Text>}

      {/* Perfil verificado */}
      {driverProfile && verifiedDid && (step === "verified" || step === "connecting") && (
        <View style={s.profileCard}>
          <View style={s.profileHeader}>
            <Ionicons name="checkmark-circle" size={24} color="#10b981" />
            <Text style={s.profileVerified}>Identidade verificada on-chain</Text>
          </View>
          <Text style={s.profileName}>{driverProfile.displayName}</Text>
          <Text style={s.profileDid}>
            {verifiedDid.slice(0, 14)}...{verifiedDid.slice(-6)}
          </Text>
          {fare && <RideFareCard fare={fare} />}

          {step === "connecting" ? (
            <View style={s.loadingRow}>
              <ActivityIndicator size="small" color="#6366f1" />
              <Text style={s.loadingText}>Solicitação enviada. Aguardando aceite...</Text>
            </View>
          ) : (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Conectar via P2P" style={s.connectButton} onPress={handleConnect}>
              <Ionicons name="radio" size={18} color="#fff" />
              <Text style={s.connectButtonText}>{fare ? `Chamar por ${money(fare.totalCents)}` : "Conectar via P2P"}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Diagrama do fluxo */}
      <View style={s.flowCard}>
        <Text style={s.flowTitle}>Como funciona</Text>
        <FlowStep n={1} label="Verificação on-chain" desc="Confirma identidade na Polygon (~0ms leitura gratuita)" />
        <FlowStep n={2} label="Sinalização WebRTC" desc="Troca de metadados via Cloudflare Worker (~100ms)" />
        <FlowStep n={3} label="Conexão P2P direta" desc="Comunicação direta via WebRTC — sem servidor" />
        <FlowStep n={4} label="Corrida ativa" desc="Localização e chat trafegam 100% P2P" />
      </View>
    </ScrollView>
  );
}

function FlowStep({ n, label, desc }: { n: number; label: string; desc: string }) {
  return (
    <View style={s.flowStep}>
      <View style={s.flowBullet}>
        <Text style={s.flowBulletText}>{n}</Text>
      </View>
      <View style={s.flowStepText}>
        <Text style={s.flowStepLabel}>{label}</Text>
        <Text style={s.flowStepDesc}>{desc}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingTop: 32, marginBottom: 20 },
  title: { fontSize: 20, fontWeight: "700", color: "#f8fafc" },
  infoCard: { flexDirection: "row", backgroundColor: "#1e293b", borderRadius: 12,
    padding: 14, marginBottom: 16, gap: 10, alignItems: "flex-start" },
  infoText: { color: "#94a3b8", fontSize: 13, lineHeight: 20, flex: 1 },
  card: { backgroundColor: "#1e293b", borderRadius: 16, padding: 16, marginBottom: 16 },
  label: { color: "#94a3b8", fontSize: 13, marginBottom: 8 },
  input: { backgroundColor: "#0f172a", borderRadius: 10, padding: 14, color: "#f8fafc",
    fontSize: 14, fontFamily: "monospace", marginBottom: 12 },
  verifyButton: { flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#6366f1", borderRadius: 10, paddingVertical: 12 },
  verifyButtonText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "center",
    paddingVertical: 8 },
  loadingText: { color: "#94a3b8", fontSize: 14 },
  profileCard: { backgroundColor: "#1e293b", borderRadius: 16, padding: 16,
    marginBottom: 16, borderWidth: 1, borderColor: "#10b981" },
  fareError: { color: "#fca5a5", fontSize: 14, lineHeight: 21, marginBottom: 16 },
  profileHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  profileVerified: { color: "#10b981", fontSize: 14, fontWeight: "600" },
  profileName: { color: "#f8fafc", fontSize: 20, fontWeight: "700" },
  profileDid: { color: "#64748b", fontSize: 12, fontFamily: "monospace", marginTop: 2,
    marginBottom: 14 },
  connectButton: { flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#6366f1", borderRadius: 10, paddingVertical: 14 },
  connectButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  flowCard: { backgroundColor: "#1e293b", borderRadius: 16, padding: 16 },
  flowTitle: { color: "#94a3b8", fontSize: 13, marginBottom: 14 },
  flowStep: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 },
  flowBullet: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#6366f1",
    alignItems: "center", justifyContent: "center" },
  flowBulletText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  flowStepText: { flex: 1 },
  flowStepLabel: { color: "#f8fafc", fontSize: 14, fontWeight: "600" },
  flowStepDesc: { color: "#64748b", fontSize: 12, marginTop: 2 },
});
