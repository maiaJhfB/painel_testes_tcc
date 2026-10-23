/**
 * Tela de Perfil — Gerenciamento de Identidade
 *
 * Permite ao usuário:
 * - Visualizar seu DID e status on-chain
 * - Registrar ou atualizar identidade na Polygon
 * - Exportar chave privada (com aviso de segurança)
 * - Trocar de papel (motorista / cliente)
 */
import { useCallback, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Alert, TextInput, ActivityIndicator,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@/store/useAuthStore";
import * as Clipboard from "expo-clipboard";

type Role = "driver" | "client";

export default function ProfileScreen() {
  const { session, registerOnChain, logout, forgetIdentity, exportPrivateKey } = useAuthStore();
  const [displayName, setDisplayName] = useState(session?.profile.displayName ?? "");
  const [role, setRole] = useState<Role>((session?.profile.role as Role) ?? "client");
  const [loading, setLoading] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [exportedKey, setExportedKey] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [securityMessage, setSecurityMessage] = useState<string | null>(null);
  const exportRevision = useRef(0);
  const router = useRouter();

  const profile = session?.profile;

  useFocusEffect(useCallback(() => () => {
    exportRevision.current += 1;
    setExportedKey(null);
    setExportPassword("");
    setShowExport(false);
    setExportLoading(false);
  }, []));

  const handleRegister = async () => {
    if (!displayName.trim()) {
      Alert.alert("Nome obrigatório", "Digite um nome de exibição.");
      return;
    }
    setLoading(true);
    try {
      const txHash = await registerOnChain(role, displayName.trim());
      Alert.alert(
        "✅ Registrado na Blockchain!",
        `Transação confirmada na Polygon.\nHash: ${txHash.slice(0, 20)}...`
      );
    } catch (err) {
      Alert.alert("Erro", String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCopyDid = async () => {
    if (!profile?.did) return;
    await Clipboard.setStringAsync(profile.did);
    Alert.alert("Copiado!", "Seu DID foi copiado para a área de transferência.");
  };

  const handleExportKey = async () => {
    if (exportLoading) return;
    const revision = ++exportRevision.current;
    setExportLoading(true);
    setSecurityMessage(null);
    try {
      const privateKey = await exportPrivateKey(exportPassword);
      if (revision === exportRevision.current) setExportedKey(privateKey);
    } catch (error) {
      if (revision === exportRevision.current) setSecurityMessage(error instanceof Error ? error.message : "Não foi possível exportar a chave.");
    } finally {
      if (revision === exportRevision.current) { setExportPassword(""); setExportLoading(false); }
    }
  };

  const closeExport = () => {
    exportRevision.current += 1;
    setShowExport(false);
    setExportedKey(null);
    setExportPassword("");
    setExportLoading(false);
    setSecurityMessage(null);
  };

  const removeIdentity = async () => {
    try { await forgetIdentity(); }
    catch { setSecurityMessage("Não foi possível remover a identidade. Tente novamente."); }
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#f8fafc" />
        </TouchableOpacity>
        <Text style={s.title}>Meu Perfil</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* DID */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Identidade Digital (DID)</Text>
        <View style={s.didRow}>
          <Text style={s.did}>{profile?.did ?? "—"}</Text>
          <TouchableOpacity onPress={handleCopyDid}>
            <Ionicons name="copy-outline" size={18} color="#6366f1" />
          </TouchableOpacity>
        </View>
        <View style={s.row}>
          <View style={[s.badge, profile?.onChainRegistered ? s.green : s.gray]}>
            <Text style={s.badgeText}>
              {profile?.onChainRegistered ? "✓ Registrado on-chain" : "Apenas local"}
            </Text>
          </View>
          <View style={[s.badge, s.purple]}>
            <Text style={s.badgeText}>Polygon</Text>
          </View>
        </View>
      </View>

      {/* Registro / Atualização */}
      <View style={s.card}>
        <Text style={s.cardTitle}>
          {profile?.onChainRegistered ? "Atualizar Perfil" : "Registrar na Blockchain"}
        </Text>

        <Text style={s.label}>Nome de exibição</Text>
        <TextInput
          style={s.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Seu nome na cooperativa"
          placeholderTextColor="#64748b"
        />

        <Text style={s.label}>Papel</Text>
        <View style={s.roleRow}>
          <RoleButton
            label="🚗 Motorista"
            active={role === "driver"}
            onPress={() => setRole("driver")}
          />
          <RoleButton
            label="📦 Cliente"
            active={role === "client"}
            onPress={() => setRole("client")}
          />
        </View>

        <TouchableOpacity
          style={[s.registerButton, loading && s.disabled]}
          onPress={handleRegister}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="link" size={16} color="#fff" />
              <Text style={s.registerButtonText}>
                {profile?.onChainRegistered ? "Atualizar on-chain" : "Registrar na Polygon"}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={s.costNote}>
          Custo estimado: ~0,001 MATIC (~R$0,003 em 2025)
        </Text>
      </View>

      {/* Segurança */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Segurança</Text>
        <TouchableOpacity style={s.securityRow} onPress={() => { setShowExport(true); setSecurityMessage(null); }}>
          <Ionicons name="key-outline" size={20} color="#f59e0b" />
          <Text style={s.securityText}>Exportar Chave Privada</Text>
          <Ionicons name="chevron-forward" size={16} color="#64748b" />
        </TouchableOpacity>
        {showExport && (
          <View style={s.exportCard}>
            <Text style={s.label}>Confirme sua senha para visualizar a chave de recuperação.</Text>
            {exportedKey ? (
              <>
                <Text style={s.label}>Guarde em local seguro. Não compartilhe esta chave.</Text>
                <Text selectable style={s.exportedKey}>{exportedKey}</Text>
                <TouchableOpacity accessibilityRole="button" style={s.registerButton} onPress={async () => {
                  await Clipboard.setStringAsync(exportedKey);
                  closeExport();
                  setSecurityMessage("Chave copiada.");
                }}><Text style={s.registerButtonText}>Copiar chave</Text></TouchableOpacity>
              </>
            ) : (
              <>
                <TextInput accessibilityLabel="Senha para exportar chave" style={s.input} secureTextEntry
                  autoCapitalize="none" autoCorrect={false} autoComplete="current-password"
                  value={exportPassword} onChangeText={setExportPassword} placeholder="Sua senha" placeholderTextColor="#64748b"
                  editable={!exportLoading} onSubmitEditing={() => { void handleExportKey(); }} />
                <TouchableOpacity accessibilityRole="button" disabled={exportLoading} style={s.registerButton} onPress={handleExportKey}>
                  {exportLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.registerButtonText}>Confirmar e visualizar</Text>}
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity accessibilityRole="button" style={s.securityRow} onPress={closeExport}><Text style={s.securityText}>Fechar</Text></TouchableOpacity>
          </View>
        )}
        {securityMessage ? <Text accessibilityRole="alert" style={s.securityMessage}>{securityMessage}</Text> : null}
        <View style={s.divider} />
        <TouchableOpacity style={s.securityRow} onPress={logout}>
          <Ionicons name="log-out-outline" size={20} color="#ef4444" />
          <Text style={[s.securityText, { color: "#ef4444" }]}>Sair e bloquear conta</Text>
          <Ionicons name="chevron-forward" size={16} color="#64748b" />
        </TouchableOpacity>
        <View style={s.divider} />
        <TouchableOpacity style={s.securityRow} onPress={() => setConfirmRemoval(true)}>
          <Ionicons name="trash-outline" size={20} color="#ef4444" />
          <Text style={[s.securityText, { color: "#ef4444" }]}>Remover identidade deste dispositivo</Text>
        </TouchableOpacity>
        {confirmRemoval && (
          <View style={s.exportCard}>
            <Text style={s.label}>Remover esta identidade? Você precisará do backup da chave para recuperá-la.</Text>
            <TouchableOpacity style={s.securityRow} onPress={removeIdentity}><Text style={[s.securityText, { color: "#fca5a5" }]}>Confirmar remoção</Text></TouchableOpacity>
            <TouchableOpacity style={s.securityRow} onPress={() => setConfirmRemoval(false)}><Text style={s.securityText}>Cancelar</Text></TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function RoleButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[s.roleButton, active && s.roleButtonActive]}
      onPress={onPress}
    >
      <Text style={[s.roleButtonText, active && s.roleButtonTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingTop: 32, marginBottom: 20 },
  title: { fontSize: 20, fontWeight: "700", color: "#f8fafc" },
  card: { backgroundColor: "#1e293b", borderRadius: 16, padding: 16, marginBottom: 16 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#f8fafc", marginBottom: 12 },
  didRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  did: { color: "#94a3b8", fontFamily: "monospace", fontSize: 11, flex: 1 },
  row: { flexDirection: "row", gap: 8 },
  badge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  green: { backgroundColor: "#064e3b" },
  gray: { backgroundColor: "#334155" },
  purple: { backgroundColor: "#3730a3" },
  badgeText: { color: "#e2e8f0", fontSize: 12 },
  label: { color: "#94a3b8", fontSize: 13, marginBottom: 6 },
  input: { backgroundColor: "#0f172a", borderRadius: 10, padding: 12, color: "#f8fafc",
    fontSize: 14, marginBottom: 14 },
  roleRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  roleButton: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center",
    borderWidth: 1, borderColor: "#334155" },
  roleButtonActive: { backgroundColor: "#6366f1", borderColor: "#6366f1" },
  roleButtonText: { color: "#94a3b8", fontWeight: "500" },
  roleButtonTextActive: { color: "#fff" },
  registerButton: { flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#6366f1", borderRadius: 10, paddingVertical: 14, marginBottom: 8 },
  registerButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  disabled: { opacity: 0.5 },
  costNote: { color: "#64748b", fontSize: 12, textAlign: "center" },
  securityRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  securityText: { color: "#cbd5e1", fontSize: 14, flex: 1 },
  divider: { height: 1, backgroundColor: "#334155", marginVertical: 2 },
  exportCard: { backgroundColor: "#0f172a", padding: 14, borderRadius: 12, marginVertical: 8 },
  exportedKey: { color: "#f8fafc", fontSize: 12, lineHeight: 20, marginBottom: 14 },
  securityMessage: { color: "#fca5a5", fontSize: 13, lineHeight: 19, marginVertical: 8 },
});
