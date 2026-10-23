import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

function webPrefix(): string {
  if (Platform.OS !== "web" || typeof window === "undefined") return "";

  const params = new URLSearchParams(window.location.search);
  const requestedSession = params.get("demoSession");
  const requestedPeer = params.get("demoPeer");
  if (requestedSession && requestedPeer) {
    const namespace = `${requestedSession}:${requestedPeer}`.replace(/[^a-zA-Z0-9:_-]/g, "");
    window.sessionStorage.setItem("cooperativa_demo_namespace", namespace);
  }

  const namespace = window.sessionStorage.getItem("cooperativa_demo_namespace") ?? "browser";
  return `cooperativa:${namespace}:`;
}

export async function getItemAsync(key: string): Promise<string | null> {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const namespacedKey = webPrefix() + key;
    // Somente o cofre cifrado e dados públicos podem sobreviver à guia.
    const persistent = key === "cooperativa_wallet_keystore" || key === "cooperativa_did";
    return (persistent ? window.localStorage?.getItem(namespacedKey) : null)
      ?? window.sessionStorage.getItem(namespacedKey);
  }
  return SecureStore.getItemAsync(key);
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const persistent = key === "cooperativa_wallet_keystore" || key === "cooperativa_did";
    const target = persistent && window.localStorage ? window.localStorage : window.sessionStorage;
    target.setItem(webPrefix() + key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const namespacedKey = webPrefix() + key;
    window.sessionStorage.removeItem(namespacedKey);
    if (key === "cooperativa_wallet_keystore" || key === "cooperativa_did") window.localStorage?.removeItem(namespacedKey);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
