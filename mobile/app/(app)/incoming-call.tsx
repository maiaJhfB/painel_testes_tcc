/**
 * Tela de Chamada Recebida — lado do Motorista
 *
 * Resolve o RF13 (lacuna identificada na análise de requisitos).
 * Faz polling no Worker a cada 2s buscando uma oferta SDP pendente
 * para o DID do motorista logado.
 */
import { useState, useEffect, useRef } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet,
  Vibration, ActivityIndicator, ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useAuthStore } from "@/store/useAuthStore";
import { useP2PStore } from "@/store/useP2PStore";
import { identityService, IS_DEV_MOCK } from "@/dev/index";
import { getDevServerUrl } from "@/dev/serverUrl";
import type { RideFare } from "@/core/ports";
import { isRideFare, money } from "@/dev/demoFare";
import RideFareCard from "@/components/RideFareCard";

const SIGNALING_URL = Constants.expoConfig?.extra?.SIGNALING_SERVER_URL
  ?? "https://signaling.cooperativa-worker.workers.dev";

function signalingUrl(): string {
  // No modo demo, o endereço pode vir do QR do painel e mudar sem novo APK.
  return IS_DEV_MOCK ? getDevServerUrl() : SIGNALING_URL;
}

const POLL_INTERVAL_MS = 2000;

interface IncomingOffer {
  sessionId: string;
  sdp: RTCSessionDescriptionInit;
  callerDid: string;
  callerName: string;
  fare: RideFare | null;
}

export default function IncomingCallScreen() {
  const [offer, setOffer] = useState<IncomingOffer | null>(null);
  const [polling, setPolling] = useState(true);
  const [answering, setAnswering] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();
  const { session } = useAuthStore();
  const { answerCall } = useP2PStore();

  const myDid = session?.profile.did;

  useEffect(() => {
    if (!myDid) return;
    startPolling(myDid);
    return () => stopPolling();
  }, [myDid]);

  function startPolling(did: string) {
    intervalRef.current = setInterval(async () => {
      try {
        // Gera o sessionId determinístico para qualquer chamador possível
        // Na prática o motorista não sabe quem vai chamar, então busca
        // pelo sufixo do próprio DID no KV (pattern: *:offer:did)
        const res = await fetch(
          `${signalingUrl()}/incoming?to=${did}`
        );
        if (!res.ok) return;

        const data = await res.json();
        if (!data?.offer) return;

        // Para o polling — encontrou uma oferta
        stopPolling();
        setPolling(false);

        // Busca nome do chamador on-chain (se possível)
        let callerName = `${data.offer.from.slice(0, 8)}...`;
        try {
          const profile = await identityService.getProfileFromChain(data.offer.from);
          if (profile?.displayName) callerName = profile.displayName;
        } catch {
          // sem contrato configurado — usa endereço mesmo
        }

        // Vibra para alertar o motorista
        Vibration.vibrate([0, 500, 200, 500]);

        setOffer({
          sessionId: data.sessionId,
          sdp: data.offer.sdp,
          callerDid: data.offer.from,
          callerName,
          fare: isRideFare(data.offer.fare) ? data.offer.fare : null,
        });
      } catch {
        // ignora erros de rede silenciosamente
      }
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  async function handleAccept() {
    if (!offer || !offer.fare || answering) return;
    setAnswering(true);
    setAnswerError(null);
    try {
      await answerCall(offer.sessionId, offer.sdp, offer.callerDid, offer.fare);
      router.replace("/(app)/active-ride");
    } catch (err) {
      console.error("[IncomingCall] answerCall falhou:", err);
      setAnswering(false);
      setAnswerError("Não foi possível aceitar a corrida. Aguardando uma nova chamada.");
      // Volta a fazer polling para próxima chamada
      setOffer(null);
      setPolling(true);
      if (myDid) startPolling(myDid);
    }
  }

  function handleReject() {
    setOffer(null);
    setPolling(true);
    if (myDid) startPolling(myDid);
  }

  // ── UI: aguardando chamada ──────────────────────────────────────────────────
  if (!offer) {
    return (
      <View style={s.container}>
        <View style={s.waitingCard}>
          <ActivityIndicator size="large" color="#1D9E75" style={{ marginBottom: 16 }} />
          <Text style={s.waitingTitle}>
            {polling ? "Aguardando chamadas..." : "Processando..."}
          </Text>
          <Text style={s.waitingSubtitle}>
            Verificando novos clientes a cada {POLL_INTERVAL_MS / 1000}s
          </Text>
          <View style={s.didRow}>
            <Ionicons name="key-outline" size={14} color="#64748b" />
            <Text style={s.didText} numberOfLines={1}>
              {myDid?.slice(0, 14)}...{myDid?.slice(-6)}
            </Text>
          </View>
          <Text style={s.shareHint}>
            Compartilhe seu DID completo com o cliente para que ele possa te chamar.
          </Text>
          {answerError && <Text accessibilityRole="alert" style={s.errorText}>{answerError}</Text>}
        </View>
      </View>
    );
  }

  // ── UI: chamada recebida ────────────────────────────────────────────────────
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#0f172a" }} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}>
      <View style={s.callCard}>
        <View style={s.callerIcon}>
          <Ionicons name="person" size={40} color="#1D9E75" />
        </View>
        <Text style={s.callTitle}>Chamada recebida</Text>
        <Text style={s.callerName}>{offer.callerName}</Text>
        <Text style={s.callerDid} numberOfLines={1}>
          {offer.callerDid.slice(0, 14)}...{offer.callerDid.slice(-6)}
        </Text>
        {offer.fare ? <RideFareCard fare={offer.fare} title="Oferta de corrida" />
          : <Text style={s.errorText}>Preço indisponível. Solicite uma nova chamada antes de aceitar.</Text>}

        <View style={s.p2pBadge}>
          <Ionicons name="wifi" size={12} color="#1D9E75" />
          <Text style={s.p2pText}>Conexão P2P direta</Text>
        </View>

        {answering ? (
          <View style={s.answeringRow}>
            <ActivityIndicator size="small" color="#1D9E75" />
            <Text style={s.answeringText}>Estabelecendo conexão P2P...</Text>
          </View>
        ) : (
          <View style={s.buttonRow}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Recusar corrida" style={s.rejectButton} onPress={handleReject}>
              <Ionicons name="close" size={28} color="#ef4444" />
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Aceitar corrida" disabled={!offer.fare} style={[s.acceptButton, !offer.fare && { opacity: .5 }]} onPress={handleAccept}>
              <Ionicons name="checkmark" size={22} color="#fff" />
              <Text style={s.acceptText}>{offer.fare ? `Aceitar por ${money(offer.fare.totalCents)}` : "Aceitar"}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", justifyContent: "center", padding: 24 },
  waitingCard: { backgroundColor: "#1e293b", borderRadius: 20, padding: 28, alignItems: "center" },
  waitingTitle: { color: "#f8fafc", fontSize: 18, fontWeight: "600", marginBottom: 6 },
  waitingSubtitle: { color: "#94a3b8", fontSize: 13, marginBottom: 16 },
  didRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  didText: { color: "#64748b", fontSize: 12, fontFamily: "monospace", flex: 1 },
  shareHint: { color: "#475569", fontSize: 12, textAlign: "center", lineHeight: 18 },
  callCard: { backgroundColor: "#1e293b", borderRadius: 20, padding: 28, alignItems: "center" },
  callerIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: "#0f172a", borderWidth: 2, borderColor: "#1D9E75",
    justifyContent: "center", alignItems: "center", marginBottom: 16,
  },
  callTitle: { color: "#94a3b8", fontSize: 14, marginBottom: 8 },
  callerName: { color: "#f8fafc", fontSize: 24, fontWeight: "700", marginBottom: 4 },
  callerDid: { color: "#64748b", fontSize: 12, fontFamily: "monospace", marginBottom: 16 },
  p2pBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#0f172a", borderRadius: 20, paddingHorizontal: 12,
    paddingVertical: 5, marginBottom: 28,
  },
  p2pText: { color: "#1D9E75", fontSize: 12 },
  buttonRow: { flexDirection: "row", gap: 12, width: "100%", alignItems: "center" },
  errorText: { color: "#fca5a5", fontSize: 13, lineHeight: 20, marginTop: 10 },
  acceptText: { color: "#fff", fontSize: 14, fontWeight: "700", flexShrink: 1 },
  rejectButton: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: "#1e1e2e", borderWidth: 2, borderColor: "#ef4444",
    justifyContent: "center", alignItems: "center",
  },
  acceptButton: {
    flex: 1, minHeight: 64, borderRadius: 16, padding: 12, flexDirection: "row", gap: 8,
    backgroundColor: "#1D9E75",
    justifyContent: "center", alignItems: "center",
  },
  answeringRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  answeringText: { color: "#94a3b8", fontSize: 14 },
});
