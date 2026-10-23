import { SafeAreaView } from "react-native-safe-area-context";
import RideMapScreen from "@/screens/RideMapScreen";

export default function NativeRideMapScreen() {
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#0f172a" }}>
    <RideMapScreen />
  </SafeAreaView>;
}
