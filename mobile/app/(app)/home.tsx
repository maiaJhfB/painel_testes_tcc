/**
 * Tela Principal — Dashboard da Cooperativa
 *
 * Exibe o estado da identidade do usuário e permite:
 * - Motoristas: ficar disponível / aceitar corridas
 * - Clientes: solicitar corridas/entregas
 * - Todos: registrar identidade on-chain (opcional)
 */
import { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@/store/useAuthStore";
import { useP2PStore } from "@/store/useP2PStore";
import { demoPeerProfile, getCachedDemoPairing, type DemoPairing } from "@/dev/demoPairing";

export default function HomeScreen() {
  const { session, logout } = useAuthStore();
  const { status: p2pStatus } = useP2PStore();
  const [pairing, setPairing] = useState<DemoPairing | null>(getCachedDemoPairing());
  const router = useRouter();

  useFocusEffect(useCallback(() => {
    setPairing(getCachedDemoPairing());
  }, []));

  const profile = session?.profile;
  const isDriver = profile?.role === "driver";

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.greeting}>Olá, {profile?.displayName ?? "Usuário"}</Text>
          <Text style={s.role}>{isDriver ? "🚗 Motorista" : "📦 Cliente"}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push("/(app)/profile")}>
          <Ionicons name="person-circle" size={40} color="#6366f1" />
        </TouchableOpacity>
      </View>

      {/* Identidade */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Minha Identidade Digital</Text>
        <View style={s.didRow}>
          <Ionicons name="key" size={16} color="#6366f1" />
          <Text style={s.didText} numberOfLines={1}>
            {profile?.did.slice(0, 14)}...{profile?.did.slice(-6)}
          </Text>
        </View>

        <View style={s.statusRow}>
          <View style={[s.badge, profile?.onChainRegistered ? s.badgeGreen : s.badgeGray]}>
            <Text style={s.badgeText}>
              {profile?.onChainRegistered ? "✓ On-chain" : "Apenas local"}
            </Text>
          </View>
          <View style={[s.badge, s.badgeBlue]}>
            <Text style={s.badgeText}>Polygon</Text>
          </View>
        </View>

        {!profile?.onChainRegistered && (
          <TouchableOpacity style={s.registerButton} onPress={() => router.push("/(app)/profile")}>
            <Ionicons name="link" size={16} color="#6366f1" />
            <Text style={s.registerButtonText}>Registrar na Blockchain</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Ações principais */}
      {isDriver ? (
        <DriverActions p2pStatus={p2pStatus} router={router} />
      ) : (
        <ClientActions router={router} />
      )}

      {Platform.OS !== "web" ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>Conexão da demonstração</Text>
          {pairing ? (
            <>
              <Text style={s.connectionRole}>
                {pairing.peer === "client" ? "👤 Passageiro" : "🚗 Motorista"} ·{" "}
                {demoPeerProfile(pairing.peer).displayName}
              </Text>
              <Text style={s.connectionText}>Servidor: {pairing.server}</Text>
              <Text style={s.connectionText}>Sessão: {pairing.session}</Text>
            </>
          ) : (
            <Text style={s.connectionText}>Nenhum QR do painel foi lido neste aparelho.</Text>
          )}
          <TouchableOpacity style={s.connectionButton} accessibilityRole="button"
            onPress={() => router.push("/scan-demo")}>
            <Ionicons name="qr-code-outline" size={18} color="#a5b4fc" />
            <Text style={s.connectionButtonText}>
              {pairing ? "Escanear outro QR" : "Ler QR do painel"}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Métricas de infraestrutura */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Infraestrutura</Text>
        <MetricRow label="Servidor central" value="Nenhum" icon="server-outline" positive />
        <MetricRow label="Autenticação" value="Senha + assinatura" icon="lock-closed" positive />
        <MetricRow label="Comunicação" value="P2P direto" icon="wifi" positive />
        <MetricRow label="Blockchain" value="Polygon (~R$0,003/tx)" icon="cube" positive />
        <MetricRow label="Sinalização" value="Cloudflare (gratuito)" icon="cloud" positive />
      </View>

      {/* Logout */}
      <TouchableOpacity style={s.logoutButton} onPress={logout}>
        <Text style={s.logoutText}>Sair e bloquear conta</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function DriverActions({ p2pStatus, router }: { p2pStatus: string; router: any }) {
  const isActive = p2pStatus === "active";
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>Painel do Motorista</Text>
      {isActive ? (
        <View style={[s.statusIndicator, s.statusActive]}>
          <Ionicons name="radio" size={20} color="#10b981" />
          <Text style={[s.statusText, { color: "#10b981" }]}>Conectado a um cliente</Text>
        </View>
      ) : (
        <TouchableOpacity
          style={[s.actionButton, { backgroundColor: "#1D9E75" }]}
          onPress={() => router.push("/(app)/incoming-call")}
        >
          <Ionicons name="radio" size={22} color="#fff" />
          <Text style={s.actionButtonText}>Aguardar Chamadas</Text>
        </TouchableOpacity>
      )}
      <Text style={s.hint}>Compartilhe seu DID com o cliente para ser encontrado</Text>
    </View>
  );
}

function ClientActions({ router }: { router: any }) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>Solicitar Serviço</Text>
      <TouchableOpacity style={s.actionButton} onPress={() => router.push("/(app)/request-ride")}>
        <Ionicons name="car" size={24} color="#fff" />
        <Text style={s.actionButtonText}>Solicitar Corrida</Text>
      </TouchableOpacity>
    </View>
  );
}

function MetricRow({
  label, value, icon, positive,
}: {
  label: string; value: string; icon: any; positive?: boolean;
}) {
  return (
    <View style={s.metricRow}>
      <Ionicons name={icon} size={16} color={positive ? "#10b981" : "#ef4444"} />
      <Text style={s.metricLabel}>{label}</Text>
      <Text style={s.metricValue}>{value}</Text>
    </View>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  greeting: { fontSize: 22, fontWeight: "700", color: "#f8fafc" },
  role: { fontSize: 14, color: "#94a3b8", marginTop: 2 },
  card: { backgroundColor: "#1e293b", borderRadius: 16, padding: 16, marginBottom: 16 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#f8fafc", marginBottom: 12 },
  didRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  didText: { color: "#94a3b8", fontFamily: "monospace", fontSize: 13, flex: 1 },
  statusRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  badge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  badgeGreen: { backgroundColor: "#064e3b" },
  badgeGray: { backgroundColor: "#334155" },
  badgeBlue: { backgroundColor: "#1e3a5f" },
  badgeText: { color: "#e2e8f0", fontSize: 12, fontWeight: "500" },
  registerButton: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10,
    borderWidth: 1, borderColor: "#6366f1", borderRadius: 10, justifyContent: "center" },
  registerButtonText: { color: "#6366f1", fontWeight: "600" },
  actionButton: { backgroundColor: "#6366f1", borderRadius: 12, padding: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  actionButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  statusIndicator: { flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, borderRadius: 10, backgroundColor: "#0f172a" },
  statusActive: { borderWidth: 1, borderColor: "#10b981" },
  statusIdle: { borderWidth: 1, borderColor: "#334155" },
  statusText: { color: "#94a3b8", fontSize: 14 },
  metricRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  metricLabel: { color: "#94a3b8", fontSize: 13, flex: 1 },
  metricValue: { color: "#f8fafc", fontSize: 13, fontWeight: "500" },
  logoutButton: { alignItems: "center", paddingVertical: 12 },
  logoutText: { color: "#64748b", fontSize: 14 },
  hint: { color: "#64748b", fontSize: 12, textAlign: "center", marginTop: 10 },
  connectionRole: { color: "#c7d2fe", fontSize: 14, fontWeight: "700", marginBottom: 5 },
  connectionText: { color: "#94a3b8", fontSize: 12, fontFamily: "monospace", marginTop: 2 },
  connectionButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: "#4f46e5", borderRadius: 10, paddingVertical: 11, marginTop: 12 },
  connectionButtonText: { color: "#a5b4fc", fontSize: 13, fontWeight: "700" },
});
