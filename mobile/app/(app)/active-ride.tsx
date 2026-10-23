/**
 * Tela de Corrida Ativa
 *
 * Exibe mapa em tempo real com localização do motorista via P2P (sem servidor).
 * Inclui chat P2P e controles de status.
 */
import { useState, useEffect, useRef } from "react";
import {
  View, Text, TouchableOpacity, TextInput,
  FlatList, StyleSheet, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useP2PStore } from "@/store/useP2PStore";
import { useAuthStore } from "@/store/useAuthStore";
import { ChatMessage } from "@/services/P2PService";
import RideFareCard from "@/components/RideFareCard";
import { rideLocationService } from "@/services/rideLocationService";
import { useGpsStore } from "@/store/useGpsStore";

export default function ActiveRideScreen() {
  const [messageText, setMessageText] = useState("");
  const chatRef = useRef<FlatList>(null);
  const navigatedToMap = useRef(false);
  const router = useRouter();
  const gps = useGpsStore();

  const { session } = useAuthStore();
  const {
    status, peerDid, peerLocation, myLocation,
    messages, rideStatus, error, updateMyLocation, updateRideStatus, fare,
    sendMessage, disconnect,
  } = useP2PStore();

  const isDriver = session?.profile.role === "driver";

  // [F-03] Quando o P2P conecta, leva para a tela de mapa.
  // push (não replace) preserva a volta ao chat desta tela;
  // map-ride finaliza com replace→home + disconnect, sem loop.
  useEffect(() => {
    if (status === "active" && !navigatedToMap.current) {
      navigatedToMap.current = true;
      router.push("/(app)/map-ride");
    }
    if (status === "idle") navigatedToMap.current = false;
  }, [status, router]);

  const handleSendMessage = () => {
    if (!messageText.trim()) return;
    sendMessage(messageText.trim());
    setMessageText("");
  };

  const handleStatusUpdate = (newStatus: "arrived" | "in_progress" | "completed") => {
    updateRideStatus(newStatus);
  };

  const handleDisconnect = async () => {
    await disconnect();
    router.replace("/(app)/home");
  };

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>Corrida em Andamento</Text>
          <View style={s.p2pBadge}>
            <Ionicons name="wifi" size={12} color="#10b981" />
            <Text style={s.p2pBadgeText}>P2P Direto — sem servidor</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <TouchableOpacity
            style={s.mapNavBtn}
            onPress={() => router.push("/(app)/map-ride")}
          >
            <Text style={s.mapNavBtnText}>🗺️ Ver Mapa</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDisconnect}>
            <Ionicons name="close-circle" size={28} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>

      {/* [B-05] Feedback de queda/reconexão P2P */}
      {error ? (
        <View style={s.errorBanner}>
          <Text style={s.errorText}>⚠️ {error}</Text>
        </View>
      ) : null}

      <View style={s.locationCard}>
        <Text accessibilityLiveRegion="polite" style={s.waitingText}>{gps.message}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={!gps.canRetry ? "Verificar novamente" : "Tentar localização"}
          disabled={status !== "active" || gps.status === "requesting"}
          onPress={() => rideLocationService.retry()}>
          <Text style={s.coords}>{!gps.canRetry ? "Verificar novamente" : "Tentar localização"}</Text>
        </TouchableOpacity>
      </View>

      {/* Localização P2P */}
      <View style={s.locationCard}>
        <Text style={s.locationTitle}>
          {isDriver ? "Minha Localização (transmitindo)" : "Localização do Motorista"}
        </Text>
        {peerLocation ? (
          <View>
            <Text style={s.coords}>
              📍 {peerLocation.latitude.toFixed(5)}, {peerLocation.longitude.toFixed(5)}
            </Text>
            {typeof peerLocation.speed === "number" && peerLocation.speed > 0 && (
              <Text style={s.speed}>
                🚗 {(peerLocation.speed * 3.6).toFixed(0)} km/h
              </Text>
            )}
            <Text style={s.timestamp}>
              Atualizado há {Math.round((Date.now() - peerLocation.timestamp) / 1000)}s
            </Text>
          </View>
        ) : (
          <Text style={s.waitingText}>Aguardando localização via P2P...</Text>
        )}
      </View>

      {/* Status da corrida */}
      {fare && <RideFareCard fare={fare} title="Preço combinado" compact />}
      <View style={s.statusCard}>
        <Text style={s.statusTitle}>Status</Text>
        <View style={s.statusBadge}>
          <Text style={s.statusText}>{rideStatus ?? "em andamento"}</Text>
        </View>

        {isDriver && (
          <View style={s.statusActions}>
            <StatusButton
              label="Cheguei"
              onPress={() => handleStatusUpdate("arrived")}
              active={rideStatus === "arrived"}
            />
            <StatusButton
              label="Em viagem"
              onPress={() => handleStatusUpdate("in_progress")}
              active={rideStatus === "in_progress"}
            />
            <StatusButton
              label="Concluído"
              onPress={() => handleStatusUpdate("completed")}
              active={rideStatus === "completed"}
              color="#10b981"
            />
          </View>
        )}
      </View>

      {/* Chat P2P */}
      <View style={s.chatContainer}>
        <Text style={s.chatTitle}>Chat P2P</Text>
        <FlatList
          ref={chatRef}
          data={messages}
          keyExtractor={(_, i) => String(i)}
          style={s.messageList}
          onContentSizeChange={() => chatRef.current?.scrollToEnd()}
          renderItem={({ item }: { item: ChatMessage }) => (
            <View
              style={[
                s.messageBubble,
                item.senderId === "me" ? s.myMessage : s.peerMessage,
              ]}
            >
              <Text style={s.messageText}>{item.text}</Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={s.noMessages}>Nenhuma mensagem ainda. Diga olá!</Text>
          }
        />
        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            value={messageText}
            onChangeText={setMessageText}
            placeholder="Mensagem..."
            placeholderTextColor="#64748b"
            returnKeyType="send"
            onSubmitEditing={handleSendMessage}
          />
          <TouchableOpacity style={s.sendButton} onPress={handleSendMessage}>
            <Ionicons name="send" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function StatusButton({
  label, onPress, active, color = "#6366f1",
}: {
  label: string; onPress: () => void; active?: boolean; color?: string;
}) {
  return (
    <TouchableOpacity
      style={[s.statusButton, { borderColor: color }, active && { backgroundColor: color }]}
      onPress={onPress}
    >
      <Text style={[s.statusButtonText, active && { color: "#fff" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: 20, paddingTop: 52 },
  headerTitle: { fontSize: 20, fontWeight: "700", color: "#f8fafc" },
  p2pBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  p2pBadgeText: { color: "#10b981", fontSize: 12 },
  errorBanner: {
    backgroundColor: "rgba(239,68,68,0.15)",
    borderWidth: 1,
    borderColor: "#ef4444",
    marginHorizontal: 16,
    marginTop: 4,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: { color: "#fca5a5", fontSize: 13, fontWeight: "600" },
  locationCard: { backgroundColor: "#1e293b", margin: 16, borderRadius: 16, padding: 16 },
  locationTitle: { color: "#94a3b8", fontSize: 13, marginBottom: 8 },
  coords: { color: "#f8fafc", fontSize: 15, fontFamily: "monospace" },
  speed: { color: "#f8fafc", fontSize: 14, marginTop: 4 },
  timestamp: { color: "#64748b", fontSize: 12, marginTop: 4 },
  waitingText: { color: "#64748b", fontSize: 14 },
  statusCard: { backgroundColor: "#1e293b", marginHorizontal: 16, borderRadius: 16, padding: 16 },
  statusTitle: { color: "#94a3b8", fontSize: 13, marginBottom: 8 },
  statusBadge: { backgroundColor: "#0f172a", borderRadius: 8, paddingHorizontal: 12,
    paddingVertical: 6, alignSelf: "flex-start", marginBottom: 12 },
  statusText: { color: "#f8fafc", fontSize: 14, fontWeight: "600" },
  statusActions: { flexDirection: "row", gap: 8 },
  statusButton: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 8,
    alignItems: "center" },
  statusButtonText: { color: "#94a3b8", fontSize: 13, fontWeight: "500" },
  chatContainer: { flex: 1, margin: 16, marginTop: 8, backgroundColor: "#1e293b",
    borderRadius: 16, padding: 12 },
  chatTitle: { color: "#94a3b8", fontSize: 13, marginBottom: 8 },
  messageList: { flex: 1 },
  messageBubble: { maxWidth: "80%", borderRadius: 12, padding: 10, marginVertical: 3 },
  myMessage: { backgroundColor: "#6366f1", alignSelf: "flex-end" },
  peerMessage: { backgroundColor: "#334155", alignSelf: "flex-start" },
  messageText: { color: "#f8fafc", fontSize: 14 },
  noMessages: { color: "#64748b", textAlign: "center", marginTop: 20 },
  inputRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  input: { flex: 1, backgroundColor: "#0f172a", borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 8, color: "#f8fafc", fontSize: 14 },
  sendButton: { backgroundColor: "#6366f1", borderRadius: 10, padding: 10,
    justifyContent: "center", alignItems: "center" },
  mapNavBtn: { backgroundColor: "#1e293b", borderWidth: 1, borderColor: "rgba(99,102,241,0.5)",
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  mapNavBtnText: { color: "#f8fafc", fontSize: 13, fontWeight: "600" },
});
