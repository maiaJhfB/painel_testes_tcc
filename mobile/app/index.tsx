import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuthStore } from "@/store/useAuthStore";

export default function Index() {
  const status = useAuthStore((state) => state.status);

  if (status === "checking" || status === "signing") {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#0f172a",
        }}
      >
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <Redirect
      href={status === "authenticated" ? "/(app)/home" : "/(auth)/onboarding"}
    />
  );
}
