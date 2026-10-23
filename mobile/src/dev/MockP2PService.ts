/**
 * @module MockP2PService
 * @description Substitui P2PService em modo __DEV_MOCK__
 *
 * Simula a comunicação P2P via HTTP polling no servidor de dev local.
 * - Sem WebRTC, sem STUN, sem react-native-webrtc
 * - Pareamento aguarda o aceite do destinatário, como no fluxo WebRTC real
 * - Troca de mensagens via polling no dev server (mesmo protocolo do signaling)
 * - Localização real do navegador, publicada pelo hook useLiveGps
 * - Mesma interface pública do P2PService real
 *
 * O painel web do dev server pode injetar dados (localização, mensagens, status)
 * simulando o par remoto.
 */

import { getDevServerUrl } from "@/dev/serverUrl";
import type { IP2PService, RideFare } from "@/core/ports";
import { isRideFare } from "@/dev/demoFare";
import { isPairedBrowserDemo } from "@/dev/browserDemoSession";

const MOCK_POLL_INTERVAL = 1000; // 1s — mais rápido que prod para facilitar testes
const ANSWER_POLL_INTERVAL = 700;
const ANSWER_TIMEOUT = 120_000;

export type P2PRole = "caller" | "callee";

export interface LocationUpdate {
  type: "location";
  latitude: number;
  longitude: number;
  timestamp: number;
  heading?: number;
  speed?: number;
}

export interface ChatMessage {
  type: "message";
  text: string;
  senderId: string;
  timestamp: number;
}

export interface StatusUpdate {
  type: "status";
  status: "accepted" | "arrived" | "in_progress" | "completed" | "cancelled";
  timestamp: number;
}

export type P2PPayload = LocationUpdate | ChatMessage | StatusUpdate;

export interface P2PCallbacks {
  onFare?: (fare: RideFare) => void;
  onConnected: () => void;
  onDisconnected: () => void;
  onData: (payload: P2PPayload) => void;
  onError: (error: Error) => void;
}

// ─── Localização de SP como base para simulação ────────────────────────────────

const SP_BASE = { lat: -23.5505, lng: -46.6333 };

function randomMove(base: number, range = 0.005): number {
  return base + (Math.random() - 0.5) * range;
}

// ─── Mock P2P Service ──────────────────────────────────────────────────────────

export class MockP2PService implements IP2PService {
  private sessionId: string | null = null;
  private callbacks: P2PCallbacks | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private locationInterval: ReturnType<typeof setInterval> | null = null;
  private myDid: string;
  private peerDid: string | null = null;
  private _connected = false;
  private lastSeenTs = 0;

  constructor(myDid: string) {
    this.myDid = myDid;
  }

  // ── call (Caller) ───────────────────────────────────────────────────────────

  async call(peerDid: string, callbacks: P2PCallbacks, fareQuoteId?: string): Promise<string> {
    this.peerDid = peerDid;
    this.callbacks = callbacks;
    this.sessionId = this._generateSessionId(this.myDid, peerDid);
    this.lastSeenTs = 0;

    console.log("[DEV_MOCK_P2P] Iniciando chamada mock para", peerDid);

    // Registra sessão no dev server
    const response = await fetch(`${getDevServerUrl()}/mock/p2p/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: this.sessionId,
        caller: this.myDid,
        callee: peerDid,
        manualPeer: isPairedBrowserDemo(),
        fareQuoteId,
      }),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(failure.error ?? "Não foi possível estabelecer a conexão P2P.");
    }
    const result: { autoAccepted?: boolean; fare?: RideFare } = await response.json();
    if (isRideFare(result.fare)) this.callbacks?.onFare?.(result.fare);

    if (result.autoAccepted) {
      // O segundo participante preparado para a gravação negocia em segundo plano.
      await new Promise((r) => setTimeout(r, 800));
    } else {
      // Demais identidades seguem o fluxo real e só conectam após o aceite.
      await this._waitForAnswer();
    }

    this._connected = true;
    this.callbacks?.onConnected();
    this._startPolling();

    return this.sessionId;
  }

  // ── answer (Callee) ─────────────────────────────────────────────────────────

  async answer(
    sessionId: string,
    _offerSdp: RTCSessionDescriptionInit,
    callerDid: string,
    callbacks: P2PCallbacks,
    fareQuoteId?: string,
  ): Promise<void> {
    this.sessionId = sessionId;
    this.peerDid = callerDid;
    this.callbacks = callbacks;
    this.lastSeenTs = 0;

    console.log("[DEV_MOCK_P2P] Aceitando chamada mock de", callerDid);

    const response = await fetch(`${getDevServerUrl()}/mock/p2p/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, callee: this.myDid, fareQuoteId }),
    });
    if (!response.ok) throw new Error("Não foi possível aceitar a chamada.");
    const result = await response.json();
    if (isRideFare(result.fare)) this.callbacks?.onFare?.(result.fare);

    // Simula latência de negociação (600ms)
    await new Promise((r) => setTimeout(r, 600));

    this._connected = true;
    this.callbacks?.onConnected();
    this._startPolling();
  }

  // ── send ────────────────────────────────────────────────────────────────────

  send(payload: P2PPayload): void {
    if (!this._connected) {
      throw new Error("O canal P2P não está aberto.");
    }

    // Envia para dev server que redistribui para o painel web e para o par
    fetch(`${getDevServerUrl()}/mock/p2p/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: this.sessionId,
        from: this.myDid,
        payload,
      }),
    }).catch(() => {/* silencioso em modo offline */});
  }

  sendLocation(lat: number, lng: number, heading?: number, speed?: number): void {
    this.send({ type: "location", latitude: lat, longitude: lng, heading, speed, timestamp: Date.now() });
  }

  sendMessage(text: string): void {
    this.send({ type: "message", text, senderId: this.myDid, timestamp: Date.now() });
  }

  sendStatus(status: "accepted" | "arrived" | "in_progress" | "completed" | "cancelled"): void {
    this.send({ type: "status", status, timestamp: Date.now() });
  }

  // ── disconnect ──────────────────────────────────────────────────────────────

  async disconnect(): Promise<void> {
    const sessionId = this.sessionId;
    this._stopPolling();
    this._connected = false;
    this.sessionId = null;
    this.peerDid = null;

    try {
      if (sessionId) {
        await fetch(`${getDevServerUrl()}/mock/p2p/disconnect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
      }
    } catch {/* silencioso */}
  }

  get isConnected(): boolean {
    return this._connected;
  }

  // ── Polling de mensagens do servidor dev ─────────────────────────────────────

  private _startPolling(): void {
    this.pollInterval = setInterval(async () => {
      if (!this.sessionId) return;
      try {
        const res = await fetch(
          `${getDevServerUrl()}/mock/p2p/receive?sessionId=${this.sessionId}&to=${this.myDid}&since=${this.lastSeenTs}`
        );
        if (!res.ok) return;

        const data = await res.json();
        if (!data.payloads?.length) return;

        for (const item of data.payloads) {
          this.lastSeenTs = Math.max(this.lastSeenTs, item.ts ?? 0);
          this.callbacks?.onData(item.payload);
        }
      } catch {/* silencioso */}
    }, MOCK_POLL_INTERVAL);
  }

  private _stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.locationInterval) {
      clearInterval(this.locationInterval);
      this.locationInterval = null;
    }
  }

  private async _waitForAnswer(): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < ANSWER_TIMEOUT) {
      if (!this.sessionId) throw new Error("A chamada foi encerrada.");
      const response = await fetch(
        `${getDevServerUrl()}/mock/p2p/session/${encodeURIComponent(this.sessionId)}`
      );
      if (!response.ok) throw new Error("Não foi possível consultar o estado da chamada.");
      const session: { state?: string } = await response.json();
      if (session.state === "active") return;
      if (["cancelled", "completed", "disconnected"].includes(session.state ?? "")) {
        throw new Error("A chamada foi encerrada antes da conexão.");
      }
      await new Promise((resolve) => setTimeout(resolve, ANSWER_POLL_INTERVAL));
    }
    throw new Error("O motorista não atendeu a chamada a tempo.");
  }

  private _generateSessionId(did1: string, did2: string): string {
    const sorted = [did1.toLowerCase(), did2.toLowerCase()].sort().join("-");
    return sorted.replace(/0x/g, "").slice(0, 32);
  }
}
