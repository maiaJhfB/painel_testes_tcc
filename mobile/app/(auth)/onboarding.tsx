import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/store/useAuthStore";

type Step = "welcome" | "choose" | "create" | "import" | "unlock" | "migrate";

export default function OnboardingScreen() {
  const { status, account, error, initialize, createNewWallet, importWallet, migrateWallet, login } = useAuthStore();
  const [step, setStep] = useState<Step>(status === "locked" ? "unlock" : status === "needs_password" ? "migrate" : "welcome");
  const [privateKey, setPrivateKey] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const operationPending = useRef(false);
  const router = useRouter();

  useEffect(() => {
    if (operationPending.current) return;
    if (status === "locked") setStep("unlock");
    if (status === "needs_password") setStep("migrate");
    if (status === "no_wallet") setStep("welcome");
  }, [status]);

  const changeStep = (next: Step) => {
    setAccessError(null);
    setPassword("");
    setConfirmation("");
    setPrivateKey("");
    setShowPassword(false);
    setStep(next);
  };

  const submit = async () => {
    if (operationPending.current) return;
    const setup = step !== "unlock";
    if (step === "import" && !privateKey.trim()) {
      setAccessError("Insira sua chave privada para importar a identidade.");
      return;
    }
    if (!password) { setAccessError("Digite sua senha."); return; }
    if (setup && password.length < 8) { setAccessError("Crie uma senha com pelo menos 8 caracteres."); return; }
    if (setup && password !== confirmation) { setAccessError("As senhas não coincidem. Confira a confirmação."); return; }

    operationPending.current = true;
    setLoading(true);
    setAccessError(null);
    let saved = step === "unlock";
    try {
      if (step === "create") await createNewWallet(password);
      if (step === "import") await importWallet(privateKey.trim(), password);
      if (step === "migrate") await migrateWallet(password);
      saved = true;
      setPrivateKey("");
      await login(password);
      router.replace("/(app)/home");
    } catch (failure) {
      if (saved) setStep("unlock");
      setAccessError(failure instanceof Error ? failure.message : "Não foi possível entrar. Tente novamente.");
    } finally {
      setPassword("");
      setConfirmation("");
      setShowPassword(false);
      operationPending.current = false;
      setLoading(false);
    }
  };

  const message = accessError ?? (step === "unlock" || step === "welcome" ? error : null);
  const isSetup = step === "create" || step === "import" || step === "migrate";
  const submitLabel = loading ? (isSetup ? "Protegendo sua identidade..." : "Desbloqueando conta...")
    : step === "import" ? "Importar e entrar" : isSetup ? "Criar senha e entrar" : "Entrar";

  return (
    <KeyboardAvoidingView style={s.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
        <View style={s.brand}>
          <Ionicons name="people-circle" size={64} color="#818cf8" />
          <Text style={s.appName}>Cooperativa</Text>
          <Text style={s.tagline}>Sua identidade. Seu controle.</Text>
        </View>

        {step === "welcome" && (
          <>
            <Text style={s.title}>Bem-vindo</Text>
            <Text style={s.subtitle}>Crie sua conta e use uma senha para entrar com facilidade.</Text>
            <View style={s.infoCard}>
              <InfoItem icon="lock-closed" text="Sua senha protege a identidade neste dispositivo" />
              <InfoItem icon="key" text="A chave privada permanece sob seu controle" />
              <InfoItem icon="wifi" text="Conecte-se diretamente com outros cooperados" />
            </View>
            <TouchableOpacity accessibilityRole="button" style={s.primaryButton} onPress={() => changeStep("choose")}>
              <Text style={s.primaryButtonText}>Criar minha conta</Text>
            </TouchableOpacity>
            {Platform.OS !== "web" ? (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Ler QR do painel" style={s.qrButton}
                onPress={() => router.push("/scan-demo")}>
                <Ionicons name="qr-code-outline" size={20} color="#a5b4fc" />
                <Text style={s.qrButtonText}>Ler QR do painel</Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}

        {step === "choose" && (
          <>
            <Text style={s.title}>Como quer começar?</Text>
            <TouchableOpacity accessibilityRole="button" style={s.optionCard} onPress={() => changeStep("create")}>
              <Ionicons name="add-circle" size={30} color="#818cf8" />
              <View style={{ flex: 1 }}><Text style={s.optionTitle}>Nova identidade</Text><Text style={s.optionDescription}>Crie uma conta protegida por senha</Text></View>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={s.optionCard} onPress={() => changeStep("import")}>
              <Ionicons name="download" size={30} color="#10b981" />
              <View style={{ flex: 1 }}><Text style={s.optionTitle}>Importar identidade</Text><Text style={s.optionDescription}>Recupere uma conta com sua chave privada</Text></View>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={s.backButton} onPress={() => changeStep(account ? "unlock" : "welcome")}><Text style={s.backText}>Voltar</Text></TouchableOpacity>
          </>
        )}

        {(step === "unlock" || isSetup) && (
          <>
            <Text style={s.title}>{step === "unlock" ? "Entrar na Cooperativa" : step === "import" ? "Importar identidade" : step === "migrate" ? "Proteja sua identidade" : "Crie sua senha"}</Text>
            {step === "unlock" && account ? (
              <View style={s.accountCard}>
                <Ionicons name={account.role === "driver" ? "car" : "person"} size={26} color="#a5b4fc" />
                <View style={{ flex: 1 }}><Text style={s.accountName}>{account.displayName}</Text><Text style={s.accountRole}>{account.role === "driver" ? "Motorista" : "Cliente"}</Text></View>
                <Ionicons name="lock-closed" size={18} color="#94a3b8" />
              </View>
            ) : null}
            <Text style={s.subtitle}>{step === "unlock"
              ? "Digite sua senha para desbloquear sua identidade e entrar."
              : step === "migrate" ? "Defina uma senha para proteger a identidade que já está neste dispositivo."
                : "Esta senha protege sua identidade. Nos próximos acessos, você só precisará dela."}</Text>

            {isSetup && step !== "migrate" && account ? (
              <Text style={s.hint}>Esta ação substitui a identidade salva neste dispositivo. Guarde o backup da chave anterior antes de continuar.</Text>
            ) : null}

            {step === "import" && (
              <>
                <Text style={s.label}>Chave privada</Text>
                <TextInput accessibilityLabel="Chave privada" style={s.input} value={privateKey}
                  onChangeText={(value) => { setPrivateKey(value); setAccessError(null); }} placeholder="0x..."
                  placeholderTextColor="#64748b" secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!loading} />
                <Text style={s.hint}>Use a chave completa com 64 caracteres após 0x. O DID é seu endereço público.</Text>
              </>
            )}
            <Text style={s.label}>{isSetup ? "Crie uma senha" : "Senha"}</Text>
            <View style={s.passwordRow}>
              <TextInput accessibilityLabel="Senha" style={s.passwordInput} value={password}
                onChangeText={(value) => { setPassword(value); setAccessError(null); }}
                placeholder={isSetup ? "Pelo menos 8 caracteres" : "Sua senha"} placeholderTextColor="#64748b"
                secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} editable={!loading}
                autoComplete={isSetup ? "new-password" : "current-password"}
                returnKeyType={isSetup ? "next" : "go"} onSubmitEditing={() => { if (!isSetup) void submit(); }} />
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={showPassword ? "Ocultar senha" : "Mostrar senha"}
                style={s.eyeButton} disabled={loading} onPress={() => setShowPassword((value) => !value)}>
                <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} color="#94a3b8" size={22} />
              </TouchableOpacity>
            </View>
            {isSetup && (
              <>
                <Text style={s.label}>Confirme sua senha</Text>
                <TextInput accessibilityLabel="Confirmar senha" style={s.input} value={confirmation}
                  onChangeText={(value) => { setConfirmation(value); setAccessError(null); }}
                  placeholder="Digite a senha novamente" placeholderTextColor="#64748b" secureTextEntry={!showPassword}
                  autoCapitalize="none" autoCorrect={false} autoComplete="new-password" editable={!loading}
                  returnKeyType="go" onSubmitEditing={() => { void submit(); }} />
              </>
            )}
            {message ? <Text accessibilityRole="alert" style={s.errorText}>{message}</Text> : null}
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={submitLabel}
              style={[s.primaryButton, loading && s.disabled]} disabled={loading} onPress={submit}>
              {loading ? <ActivityIndicator color="#fff" /> : null}
              <Text style={s.primaryButtonText}>{submitLabel}</Text>
            </TouchableOpacity>
            {step === "unlock" ? (
              <>
                <Text style={s.hint}>Sua senha é usada apenas neste dispositivo. Para recuperar o acesso se esquecê-la, use o backup da sua chave privada.</Text>
                <TouchableOpacity accessibilityRole="button" style={s.backButton} disabled={loading} onPress={() => changeStep("choose")}>
                  <Text style={s.backText}>Usar outra identidade</Text>
                </TouchableOpacity>
                {Platform.OS !== "web" ? (
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Ler QR do painel" style={s.backButton}
                    disabled={loading} onPress={() => router.push("/scan-demo")}>
                    <Text style={s.backText}>Ler QR do painel</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            ) : step !== "migrate" ? (
              <TouchableOpacity accessibilityRole="button" style={s.backButton} disabled={loading} onPress={() => changeStep("choose")}><Text style={s.backText}>Voltar</Text></TouchableOpacity>
            ) : null}
          </>
        )}

        {status === "error" && step === "welcome" && (
          <View style={{ marginTop: 16 }}>
            <Text accessibilityRole="alert" style={s.errorText}>{message}</Text>
            <TouchableOpacity onPress={() => { void initialize(); }} accessibilityRole="button"><Text style={s.backText}>Tentar novamente</Text></TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function InfoItem({ icon, text }: { icon: any; text: string }) {
  return <View style={s.infoItem}><Ionicons name={icon} size={19} color="#818cf8" /><Text style={s.infoText}>{text}</Text></View>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#0f172a" },
  container: { flexGrow: 1, padding: 24, paddingVertical: 32, justifyContent: "center" },
  brand: { alignItems: "center", marginBottom: 28 },
  appName: { color: "#f8fafc", fontSize: 30, fontWeight: "800", marginTop: 4 },
  tagline: { color: "#94a3b8", fontSize: 14, marginTop: 5 },
  title: { color: "#f8fafc", fontSize: 25, fontWeight: "700", marginBottom: 10 },
  subtitle: { color: "#94a3b8", fontSize: 14, lineHeight: 22, marginBottom: 20 },
  label: { color: "#cbd5e1", fontSize: 14, fontWeight: "600", marginBottom: 8 },
  input: { backgroundColor: "#1e293b", borderWidth: 1, borderColor: "#334155", borderRadius: 12, padding: 14, color: "#f8fafc", fontSize: 15, marginBottom: 16 },
  passwordRow: { flexDirection: "row", backgroundColor: "#1e293b", borderWidth: 1, borderColor: "#334155", borderRadius: 12, marginBottom: 16 },
  passwordInput: { flex: 1, minWidth: 0, padding: 14, color: "#f8fafc", fontSize: 15 },
  eyeButton: { paddingHorizontal: 14, justifyContent: "center" },
  primaryButton: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10, backgroundColor: "#6366f1", borderRadius: 13, paddingVertical: 16 },
  primaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  qrButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: "#4f46e5", borderRadius: 13, paddingVertical: 13, marginTop: 12 },
  qrButtonText: { color: "#a5b4fc", fontSize: 14, fontWeight: "700" },
  disabled: { opacity: .6 },
  infoCard: { padding: 18, backgroundColor: "#1e293b", borderRadius: 14, gap: 16, marginBottom: 24 },
  infoItem: { flexDirection: "row", alignItems: "center", gap: 10 },
  infoText: { flex: 1, color: "#cbd5e1", fontSize: 13, lineHeight: 19 },
  optionCard: { padding: 18, backgroundColor: "#1e293b", borderRadius: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  optionTitle: { color: "#f8fafc", fontSize: 16, fontWeight: "600" },
  optionDescription: { color: "#94a3b8", fontSize: 12, marginTop: 5 },
  accountCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#1e293b", padding: 16, borderRadius: 14, marginBottom: 18 },
  accountName: { color: "#f8fafc", fontSize: 17, fontWeight: "700" },
  accountRole: { color: "#94a3b8", fontSize: 12, marginTop: 4 },
  hint: { color: "#94a3b8", fontSize: 12, lineHeight: 18, marginTop: 12, marginBottom: 12 },
  errorText: { color: "#fca5a5", fontSize: 14, lineHeight: 21, marginBottom: 14 },
  backButton: { alignItems: "center", paddingVertical: 14, marginTop: 4 },
  backText: { color: "#a5b4fc", fontSize: 14, textAlign: "center" },
});
