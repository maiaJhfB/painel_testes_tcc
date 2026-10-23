import { useEffect, useRef } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";

interface Props {
  onScanned: (raw: string) => void;
  paused: boolean;
}

/**
 * Leitor de QR do painel para o APK Android.
 *
 * A câmera só é aberta depois da permissão do sistema. Cada leitura é
 * entregue uma vez; o pai pausa o leitor enquanto valida e salva o pareamento.
 */
export default function DemoQrScanner({ onScanned, paused }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);
  const asked = useRef(false);

  useEffect(() => {
    if (!paused) handled.current = false;
  }, [paused]);

  useEffect(() => {
    if (
      permission && !permission.granted && permission.canAskAgain &&
      !asked.current && Platform.OS !== "web"
    ) {
      asked.current = true;
      void requestPermission();
    }
  }, [permission, requestPermission]);

  if (Platform.OS === "web") {
    return (
      <View style={s.centered}>
        <Ionicons name="qr-code-outline" size={48} color="#818cf8" />
        <Text style={s.title}>Leitura de QR no APK</Text>
        <Text style={s.message}>
          A câmera do painel é usada pelo aplicativo Android. Na versão web, abra as duas
          janelas pelo próprio painel.
        </Text>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={s.centered}>
        <ActivityIndicator color="#818cf8" />
        <Text style={s.message}>Consultando permissão da câmera...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={s.centered}>
        <Ionicons name="camera-outline" size={48} color="#fbbf24" />
        <Text style={s.title}>Permissão da câmera</Text>
        <Text style={s.message}>
          A Cooperativa precisa da câmera apenas para ler o QR code do painel de demonstração.
          Nenhuma foto é gravada.
        </Text>
        {permission.canAskAgain ? (
          <TouchableOpacity style={s.button} onPress={() => void requestPermission()} accessibilityRole="button">
            <Text style={s.buttonText}>Permitir câmera</Text>
          </TouchableOpacity>
        ) : (
          <Text style={s.message}>
            A permissão foi bloqueada. Abra as configurações do aplicativo e autorize a câmera.
          </Text>
        )}
      </View>
    );
  }

  const scan = (result: BarcodeScanningResult) => {
    if (handled.current) return;
    handled.current = true;
    onScanned(result.data);
  };

  return (
    <View style={s.cameraFrame}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={paused ? undefined : scan}
      />
      <View pointerEvents="none" style={s.overlay}>
        <View style={s.target} />
        <Text style={s.hint}>Aponte para o QR do painel</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12, backgroundColor: "#0f172a" },
  title: { color: "#f8fafc", fontSize: 18, fontWeight: "700", textAlign: "center" },
  message: { color: "#94a3b8", fontSize: 14, lineHeight: 21, textAlign: "center" },
  button: { backgroundColor: "#6366f1", borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, marginTop: 8 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  cameraFrame: { flex: 1, minHeight: 320, backgroundColor: "#020617", overflow: "hidden" },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 18 },
  target: { width: 230, height: 230, borderWidth: 3, borderColor: "#a5b4fc", borderRadius: 22, backgroundColor: "rgba(99,102,241,0.08)" },
  hint: { color: "#e0e7ff", fontSize: 14, fontWeight: "700", backgroundColor: "rgba(15,23,42,0.85)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 },
});
