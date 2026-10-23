/**
 * @module P2PService
 * @description Módulo de comunicação Peer-to-Peer via WebRTC
 *
 * Implementa comunicação direta (motorista ↔ cliente) sem servidor intermediário:
 * 1. Troca de oferta/resposta SDP via servidor de sinalização (Cloudflare Worker)
 * 2. Negociação de ICE candidates (descoberta de rota P2P)
 * 3. Canal de dados direto para mensagens, localização e status
 *
 * Após a conexão estabelecida, o servidor de sinalização não é mais necessário.
 * O tráfego real (localização, mensagens) é 100% P2P.
 *
 * Referência: RFC 8825 (WebRTC), RFC 8839 (ICE)
 */

import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
} from "react-native-webrtc";
import type RTCDataChannel from "react-native-webrtc/lib/typescript/RTCDataChannel";
import Constants from "expo-constants";
import type {
  ChatMessage,
  IP2PService,
  LocationUpdate,
  P2PCallbacks,
  P2PPayload,
  StatusUpdate,
} from "@/core/ports";

export type {
  ChatMessage,
  IP2PService,
  LocationUpdate,
  P2PCallbacks,
  P2PPayload,
  StatusUpdate,
} from "@/core/ports";

// ─── Constantes ────────────────────────────────────────────────────────────────

const SIGNALING_URL =
  Constants.expoConfig?.extra?.SIGNALING_SERVER_URL ??
  "https://signaling.cooperativa-worker.workers.dev";

const TURN_URL = Constants.expoConfig?.extra?.TURN_URL;
const TURN_USERNAME = Constants.expoConfig?.extra?.TURN_USERNAME;
const TURN_CREDENTIAL = Constants.expoConfig?.extra?.TURN_CREDENTIAL;

/** Servidores STUN gratuitos para descoberta de IP público */
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
  ...(
    typeof TURN_URL === "string" &&
    TURN_URL.length > 0 &&
    typeof TURN_USERNAME === "string" &&
    TURN_USERNAME.length > 0 &&
    typeof TURN_CREDENTIAL === "string" &&
    TURN_CREDENTIAL.length > 0
      ? [{ urls: TURN_URL, username: TURN_USERNAME, credential: TURN_CREDENTIAL }]
      : []
  ),
];

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type P2PRole = "caller" | "callee";

// ─── Serviço P2P ──────────────────────────────────────────────────────────────

export class P2PService implements IP2PService {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private sessionId: string | null = null;
  private signalingPollInterval: ReturnType<typeof setInterval> | null = null;
  private callbacks: P2PCallbacks | null = null;
  private myDid: string;
  private peerDid: string | null = null;

  constructor(myDid: string) {
    this.myDid = myDid;
  }

  // ── Conexão (Caller — quem inicia) ─────────────────────────────────────────

  /**
   * Inicia uma conexão P2P com outro usuário.
   * Cria a oferta SDP e publica no servidor de sinalização.
   *
   * @param peerDid - Endereço Ethereum do par (verificado on-chain antes de chamar)
   * @param callbacks - Handlers de eventos da conexão
   */
  async call(peerDid: string, callbacks: P2PCallbacks): Promise<string> {
    this.peerDid = peerDid;
    this.callbacks = callbacks;
    this.sessionId = this._generateSessionId(this.myDid, peerDid);

    this.pc = this._createPeerConnection();
    this._setupDataChannel(this.pc.createDataChannel("cooperativa-main"));

    // Cria oferta SDP local
    const offer = await this.pc.createOffer({});
    await this.pc.setLocalDescription(offer);

    // Aguarda coleta de ICE candidates
    await this._waitForIceGathering();

    // Publica oferta no servidor de sinalização (Cloudflare Worker)
    await this._signalingPost("offer", {
      sdp: this.pc.localDescription,
      from: this.myDid,
      to: peerDid,
    });

    // Inicia polling por resposta (answer)
    this._startSignalingPoll("answer");

    return this.sessionId;
  }

  // ── Resposta (Callee — quem atende) ────────────────────────────────────────

  /**
   * Aceita uma chamada P2P recebida.
   * Processa a oferta e envia a resposta SDP.
   *
   * @param sessionId - ID da sessão da chamada recebida
   * @param offerSdp - Oferta SDP recebida via notificação push ou polling
   * @param callerDid - DID do chamador (verificado on-chain)
   * @param callbacks - Handlers de eventos
   */
  async answer(
    sessionId: string,
    offerSdp: RTCSessionDescriptionInit,
    callerDid: string,
    callbacks: P2PCallbacks
  ): Promise<void> {
    this.sessionId = sessionId;
    this.peerDid = callerDid;
    this.callbacks = callbacks;

    this.pc = this._createPeerConnection();

    // DataChannel será criado pelo caller — apenas escuta
    this.pc.addEventListener("datachannel", (event: any) => {
      this._setupDataChannel(event.channel);
    });

    await this.pc.setRemoteDescription(new RTCSessionDescription({
      sdp: offerSdp.sdp ?? "",
      type: offerSdp.type ?? null,
    }));

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    await this._waitForIceGathering();

    // Publica resposta
    await this._signalingPost("answer", {
      sdp: this.pc.localDescription,
      from: this.myDid,
      to: callerDid,
    });
  }

  // ── Envio de dados ─────────────────────────────────────────────────────────

  /**
   * Envia um payload P2P diretamente ao par.
   * Após a conexão, nenhum servidor intermediário é envolvido.
   */
  send(payload: P2PPayload): void {
    if (
      !this.dataChannel ||
      this.dataChannel.readyState !== "open"
    ) {
      throw new Error("Canal de dados P2P não está aberto.");
    }
    this.dataChannel.send(JSON.stringify(payload));
  }

  /** Atalho para enviar atualização de localização */
  sendLocation(
    latitude: number,
    longitude: number,
    heading?: number,
    speed?: number
  ): void {
    this.send({
      type: "location",
      latitude,
      longitude,
      heading,
      speed,
      timestamp: Date.now(),
    });
  }

  /** Atalho para enviar mensagem de chat */
  sendMessage(text: string): void {
    this.send({
      type: "message",
      text,
      senderId: this.myDid,
      timestamp: Date.now(),
    });
  }

  /** Atalho para atualizar status da corrida/entrega */
  sendStatus(
    status: "accepted" | "arrived" | "in_progress" | "completed" | "cancelled"
  ): void {
    this.send({ type: "status", status, timestamp: Date.now() });
  }

  // ── Encerramento ───────────────────────────────────────────────────────────

  async disconnect(): Promise<void> {
    this._stopSignalingPoll();
    this.dataChannel?.close();
    this.pc?.close();
    this.pc = null;
    this.dataChannel = null;
    this.sessionId = null;
    this.peerDid = null;
  }

  get isConnected(): boolean {
    return this.dataChannel?.readyState === "open";
  }

  // ── Helpers Privados ───────────────────────────────────────────────────────

  private _createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.addEventListener("icecandidate", async (event: any) => {
      if (event.candidate && this.sessionId) {
        await this._signalingPost("ice", {
          candidate: event.candidate,
          from: this.myDid,
        });
      }
    });

    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "connected") {
        this._stopSignalingPoll();
        this.callbacks?.onConnected();
      } else if (
        pc.connectionState === "disconnected" ||
        pc.connectionState === "failed"
      ) {
        this.callbacks?.onDisconnected();
      }
    });

    return pc;
  }

  private _setupDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;

    channel.addEventListener("open", () => {
      console.log("[P2P] DataChannel aberto — conexão estabelecida");
    });

    channel.addEventListener("message", (event: any) => {
      try {
        const payload: P2PPayload = JSON.parse(event.data);
        this.callbacks?.onData(payload);
      } catch (err) {
        console.warn("[P2P] Erro ao parsear mensagem:", err);
      }
    });

    channel.addEventListener("error", (error: any) => {
      this.callbacks?.onError(new Error(`DataChannel error: ${error}`));
    });
  }

  private _waitForIceGathering(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.pc) return resolve();
      if (this.pc.iceGatheringState === "complete") return resolve();

      const check = () => {
        if (this.pc?.iceGatheringState === "complete") {
          this.pc.removeEventListener("icegatheringstatechange", check);
          resolve();
        }
      };
      this.pc.addEventListener("icegatheringstatechange", check);

      // Timeout de segurança: resolve após 3s mesmo que incompleto
      setTimeout(resolve, 3000);
    });
  }

  private async _signalingPost(
    type: "offer" | "answer" | "ice",
    body: object
  ): Promise<void> {
    const res = await fetch(`${SIGNALING_URL}/signal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, sessionId: this.sessionId, ...body }),
    });
    if (!res.ok) {
      throw new Error(`Signaling error: ${res.status} ${await res.text()}`);
    }
  }

  private _startSignalingPoll(waitFor: "answer" | "ice"): void {
    this.signalingPollInterval = setInterval(async () => {
      try {
        const res = await fetch(
          `${SIGNALING_URL}/signal?sessionId=${this.sessionId}&type=${waitFor}&to=${this.myDid}`
        );
        if (!res.ok) return;

        const data = await res.json();
        if (!data?.payload) return;

        if (waitFor === "answer" && this.pc) {
          await this.pc.setRemoteDescription(
            new RTCSessionDescription({
              sdp: data.payload.sdp?.sdp ?? "",
              type: data.payload.sdp?.type ?? null,
            })
          );
          // Muda para polling de ICE candidates
          this._stopSignalingPoll();
          this._startSignalingPoll("ice");
        } else if (waitFor === "ice" && this.pc && data.payload.candidate) {
          await this.pc.addIceCandidate(
            new RTCIceCandidate(data.payload.candidate)
          );
        }
      } catch (err) {
        console.warn("[P2P] Signaling poll error:", err);
      }
    }, 1500);
  }

  private _stopSignalingPoll(): void {
    if (this.signalingPollInterval) {
      clearInterval(this.signalingPollInterval);
      this.signalingPollInterval = null;
    }
  }

  private _generateSessionId(did1: string, did2: string): string {
    // ID determinístico baseado nos dois DIDs (mesma session para ambos os lados)
    const sorted = [did1.toLowerCase(), did2.toLowerCase()].sort().join("-");
    return sorted.replace(/0x/g, "").slice(0, 32);
  }
}
