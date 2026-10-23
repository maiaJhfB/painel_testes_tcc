/**
 * Componente Icon — substituto de Ionicons sem font loading.
 * Usa emojis/unicode para funcionar 100% no Expo Go sem EAS Build.
 * Em produção (EAS Build), pode ser substituído por Ionicons real.
 */
import { Text, TextStyle } from "react-native";

const ICON_MAP: Record<string, string> = {
  // Onboarding
  "people-circle": "👥",
  "add-circle": "➕",
  "download": "📥",
  // Home
  "person-circle": "👤",
  "key": "🔑",
  "link": "🔗",
  "radio": "📡",
  "car": "🚗",
  // Incoming call
  "call": "📞",
  "close-circle": "❌",
  "checkmark-circle": "✅",
  "alert-circle": "⚠️",
  "time": "⏰",
  // Request ride
  "search": "🔍",
  "navigate": "🧭",
  "location": "📍",
  // Active ride
  "chat": "💬",
  "send": "📤",
  "map": "🗺️",
  "location-outline": "📍",
  "flag": "🏁",
  // Profile
  "shield-checkmark": "🛡️",
  "settings": "⚙️",
  "log-out": "🚪",
  "copy": "📋",
  "trash": "🗑️",
  "information-circle": "ℹ️",
  "checkmark": "✔️",
  "warning": "⚠️",
  "wifi": "📶",
  "globe": "🌐",
  // Generic
  "chevron-forward": "›",
  "chevron-back": "‹",
  "close": "✕",
  "refresh": "🔄",
  "star": "⭐",
};

interface IconProps {
  name: string;
  size?: number;
  color?: string;
  style?: TextStyle;
}

export function Icon({ name, size = 24, color, style }: IconProps) {
  const emoji = ICON_MAP[name] ?? "●";
  return (
    <Text
      style={[
        { fontSize: size * 0.85, color: color ?? "#fff", lineHeight: size * 1.1 },
        style,
      ]}
    >
      {emoji}
    </Text>
  );
}
