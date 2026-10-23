/**
 * @module useP2PStore
 * @description Estado global da sessão P2P (corrida/entrega ativa)
 *
 * ALTERADO: instancia P2PServiceClass de src/dev/index.ts
 * Em modo DEV_MOCK usa MockP2PService; em prod usa P2PService real.
 * Nenhuma tela precisa ser alterada.
 */

import { create } from "zustand";
import { P2PServiceClass } from "@/dev/index";
import type { LocationUpdate, ChatMessage, StatusUpdate } from "@/services/P2PService";
import type { RideFare } from "@/core/ports";

type RideStatus = "idle" | "searching" | "connecting" | "active" | "completed" | "error";

interface P2PState {
  status: RideStatus;
  peerDid: string | null;
  peerLocation: LocationUpdate | null;
  myLocation: LocationUpdate | null;
  messages: ChatMessage[];
  rideStatus: StatusUpdate["status"] | null;
  fare: RideFare | null;
  error: string | null;
  _service: InstanceType<typeof P2PServiceClass> | null;

  initService: (myDid: string) => void;
  callPeer: (peerDid: string, fare?: RideFare) => Promise<void>;
  answerCall: (sessionId: string, offerSdp: RTCSessionDescriptionInit, callerDid: string, fare?: RideFare) => Promise<void>;
  sendMessage: (text: string) => void;
  updateMyLocation: (lat: number, lng: number, heading?: number, speed?: number) => void;
  updateRideStatus: (status: StatusUpdate["status"]) => void;
  disconnect: () => Promise<void>;
}

export const useP2PStore = create<P2PState>((set, get) => ({
  status: "idle",
  peerDid: null,
  peerLocation: null,
  myLocation: null,
  messages: [],
  rideStatus: null,
  fare: null,
  error: null,
  _service: null,

  initService: (myDid: string) => {
    set({ _service: new P2PServiceClass(myDid), fare: null });
  },

  callPeer: async (peerDid: string, fare?: RideFare) => {
    const service = get()._service;
    if (!service) throw new Error("P2PService não inicializado");
    set({ status: "connecting", peerDid, error: null, fare: fare ?? null, myLocation: null });
    try {
      await service.call(peerDid, {
        onFare: (fare) => set({ fare }),
        onConnected: () => set({ status: "active" }),
        onDisconnected: () => set({ status: "idle", peerDid: null }),
        onError: (err) => set({ status: "error", error: err.message }),
        onData: (payload) => handleIncomingData(payload, set),
      }, fare?.quoteId);
    } catch (error) {
      set({ status: "error", fare: null, error: error instanceof Error ? error.message : "Não foi possível chamar o motorista." });
      throw error;
    }
  },

  answerCall: async (sessionId, offerSdp, callerDid, fare) => {
    const service = get()._service;
    if (!service) throw new Error("P2PService não inicializado");
    set({ status: "connecting", peerDid: callerDid, error: null, fare: null, myLocation: null });
    await service.answer(sessionId, offerSdp, callerDid, {
      onFare: (fare) => set({ fare }),
      onConnected: () => set({ status: "active" }),
      onDisconnected: () => set({ status: "idle", peerDid: null }),
      onError: (err) => set({ status: "error", error: err.message }),
      onData: (payload) => handleIncomingData(payload, set),
    }, fare?.quoteId);
  },

  sendMessage: (text: string) => {
    const service = get()._service;
    if (!service?.isConnected) return;
    service.sendMessage(text);
    set((state) => ({
      messages: [...state.messages, { type: "message", text, senderId: "me", timestamp: Date.now() }],
    }));
  },

  updateMyLocation: (lat, lng, heading, speed) => {
    const service = get()._service;
    const location: LocationUpdate = { type: "location", latitude: lat, longitude: lng, heading, speed, timestamp: Date.now() };
    set({ myLocation: location });
    if (service?.isConnected) service.sendLocation(lat, lng, heading, speed);
  },

  updateRideStatus: (status) => {
    const service = get()._service;
    set({ rideStatus: status });
    if (service?.isConnected) service.sendStatus(status);
  },

  disconnect: async () => {
    const service = get()._service;
    set({ status: "idle", peerDid: null, peerLocation: null, myLocation: null, messages: [], rideStatus: null, fare: null });
    await service?.disconnect();
  },
}));

function handleIncomingData(payload: any, set: any) {
  switch (payload.type) {
    case "location": set({ peerLocation: payload as LocationUpdate }); break;
    case "message": set((state: P2PState) => ({ messages: [...state.messages, payload as ChatMessage] })); break;
    case "status": set({ rideStatus: (payload as StatusUpdate).status }); break;
  }
}
