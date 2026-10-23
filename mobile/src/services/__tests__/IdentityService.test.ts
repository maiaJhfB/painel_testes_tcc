import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { IdentityService } from "../IdentityService";

describe("IdentityService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  });

  it("generates a 32-byte private key and persists it only in secure storage", async () => {
    (Crypto.getRandomBytesAsync as jest.Mock).mockResolvedValue(new Uint8Array(32).fill(1));
    const service = new IdentityService();

    const address = await service.generateNewWallet();

    expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "cooperativa_wallet_pk",
      "0x" + "01".repeat(32)
    );
    expect(service.currentAddress).toBe(address);
  });

  it("returns null when no persisted wallet exists", async () => {
    const service = new IdentityService();

    await expect(service.loadWallet()).resolves.toBeNull();
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith("cooperativa_wallet_pk");
  });

  it("normalizes an invalid imported key into a safe domain error", async () => {
    const service = new IdentityService();

    await expect(service.importWallet("not-a-private-key")).rejects.toThrow(
      "Chave privada inválida"
    );
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it("removes both credential and profile when the wallet is deleted", async () => {
    const service = new IdentityService();

    await service.deleteWallet();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("cooperativa_wallet_pk");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("cooperativa_did");
    expect(service.currentAddress).toBeNull();
  });

  it("does not call the chain when no contract address is configured", async () => {
    const service = new IdentityService();

    await expect(service.isRegisteredOnChain("0x0000000000000000000000000000000000000000")).resolves.toBe(false);
    await expect(service.getProfileFromChain("0x0000000000000000000000000000000000000000")).resolves.toBeNull();
  });
});
