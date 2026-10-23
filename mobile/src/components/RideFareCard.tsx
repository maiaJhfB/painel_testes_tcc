import { StyleSheet, Text, View } from "react-native";
import type { RideFare } from "@/core/ports";
import { money } from "@/dev/demoFare";

export default function RideFareCard({ fare, title = "Estimativa da corrida", compact = false }: {
  fare: RideFare; title?: string; compact?: boolean;
}) {
  return (
    <View style={s.card}>
      <View style={s.header}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.total}>{money(fare.totalCents)}</Text>
      </View>
      {!compact && <>
        <Text style={s.route}>{fare.origin} → {fare.destination}</Text>
        <Text style={s.detail}>{(fare.distanceMeters / 1000).toFixed(1).replace(".", ",")} km · {Math.ceil(fare.durationSeconds / 60)} min estimados</Text>
        <View style={s.breakdown}>
          <Row label="Tarifa base" value={money(fare.baseCents)} />
          <Row label={`Distância (${money(fare.perKmCents)}/km)`} value={money(fare.distanceCents)} />
          <Row label={`Tempo (${money(fare.perMinuteCents)}/min)`} value={money(fare.timeCents)} />
          {fare.minimumAdjustmentCents > 0 && <Row label="Complemento da tarifa mínima" value={money(fare.minimumAdjustmentCents)} />}
        </View>
        {fare.routeSource === "approximate" && <Text style={s.note}>Rota aproximada: serviço de roteamento indisponível.</Text>}
      </>}
      <Text style={s.note}>Valor simulado · sem cobrança real</Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={s.row}><Text style={s.detail}>{label}</Text><Text style={s.value}>{value}</Text></View>;
}

const s = StyleSheet.create({
  card: { width: "100%", backgroundColor: "#0f172a", borderRadius: 12, padding: 14, marginVertical: 12 },
  header: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { color: "#cbd5e1", fontSize: 14, fontWeight: "600", flexShrink: 1 },
  total: { color: "#6ee7b7", fontSize: 24, fontWeight: "800" },
  route: { color: "#f8fafc", fontSize: 13, marginTop: 10, lineHeight: 19 },
  detail: { color: "#94a3b8", fontSize: 12, lineHeight: 19, flexShrink: 1 },
  value: { color: "#e2e8f0", fontSize: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  breakdown: { borderTopWidth: 1, borderColor: "#334155", paddingTop: 8, marginTop: 8, gap: 5 },
  note: { color: "#94a3b8", fontSize: 11, lineHeight: 17, marginTop: 8 },
});
