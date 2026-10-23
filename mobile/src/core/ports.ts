/**
 * Application ports that keep UI and stores independent from concrete
 * blockchain and transport implementations.
 */

export type CooperativeRole = "driver" | "client" | "admin";

export interface IdentityProfile {
  did: string;
  role: CooperativeRole;
  displayName: string;
  onChainRegistered: boolean;
  lastLogin: number;
}

export interface AuthSession {
  profile: IdentityProfile;
  sessionToken: string;
  expiresAt: number;
}

export interface SessionValidationResult {
  valid: boolean;
  address: string | null;
}

export interface IIdentityService {
  generateNewWallet(password?: string): Promise<string>;
  importWallet(privateKey: string, password?: string): Promise<string>;
  loadWallet(password?: string): Promise<string | null>;
  deleteWallet(): Promise<void>;
  createSignedSession(nonce: string): Promise<AuthSession>;
  verifySession(message: string, signature: string): Promise<SessionValidationResult>;
  registerOnChain(role: CooperativeRole, displayName: string): Promise<string>;
  isRegisteredOnChain(address: string): Promise<boolean>;
  getProfileFromChain(address: string): Promise<Omit<IdentityProfile, "lastLogin"> | null>;
  readonly currentAddress: string | null;
}

export interface WalletAccess {
  kind: "missing" | "legacy" | "locked";
  did: string | null;
}

export interface IProtectedIdentityService extends IIdentityService {
  getWalletAccess(): Promise<WalletAccess>;
  migrateWallet(password: string): Promise<string>;
  lockWallet(): void;
  exportPrivateKey(password: string): Promise<string>;
}

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

export interface RideFare {
  quoteId: string;
  expiresAt: number;
  pricingVersion: string;
  currency: "BRL";
  simulated: true;
  origin: string;
  destination: string;
  distanceMeters: number;
  durationSeconds: number;
  routeSource: "osrm" | "approximate";
  baseCents: number;
  perKmCents: number;
  perMinuteCents: number;
  distanceCents: number;
  timeCents: number;
  minimumCents: number;
  minimumAdjustmentCents: number;
  totalCents: number;
}

export type P2PPayload = LocationUpdate | ChatMessage | StatusUpdate;

export interface P2PCallbacks {
  onFare?: (fare: RideFare) => void;
  onConnected: () => void;
  onDisconnected: () => void;
  onData: (payload: P2PPayload) => void;
  onError: (error: Error) => void;
}

export interface IP2PService {
  call(peerDid: string, callbacks: P2PCallbacks, fareQuoteId?: string): Promise<string>;
  answer(
    sessionId: string,
    offerSdp: RTCSessionDescriptionInit,
    callerDid: string,
    callbacks: P2PCallbacks,
    fareQuoteId?: string
  ): Promise<void>;
  send(payload: P2PPayload): void;
  sendLocation(latitude: number, longitude: number, heading?: number, speed?: number): void;
  sendMessage(text: string): void;
  sendStatus(status: StatusUpdate["status"]): void;
  disconnect(): Promise<void>;
  readonly isConnected: boolean;
}

export interface IP2PServiceConstructor {
  new (myDid: string): IP2PService;
}
