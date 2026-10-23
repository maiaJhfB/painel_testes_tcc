import { useEffect, useRef } from "react";
import { WebView } from "react-native-webview";
import { getDevServerUrl } from "@/dev/serverUrl";
import type { DemoRoute, MapPoint } from "@/dev/demoRoutes";

interface Props {
  route: DemoRoute | null;
  car: MapPoint | null;
  passenger: MapPoint;
  destination: MapPoint;
  stage: string;
  fitRevision: number;
  onMapError: (failed: boolean) => void;
}

/** Renders the same Leaflet document served to the web demo. GPS stays native. */
export default function RideMap(props: Props) {
  const frame = useRef<WebView>(null);
  const ready = useRef(false);
  const current = useRef(props);
  current.current = props;
  const uri = `${getDevServerUrl()}/mock/map/view`;
  const send = () => {
    if (!ready.current) return;
    const { onMapError: _callback, ...state } = current.current;
    frame.current?.injectJavaScript(`window.receiveNativeRideState && window.receiveNativeRideState(${JSON.stringify({ type: "ride-map-state", ...state })}); true;`);
  };
  useEffect(send, [props.route, props.car, props.passenger, props.destination, props.stage, props.fitRevision]);
  return <WebView ref={frame} source={{ uri }} style={{ flex: 1, backgroundColor: "#e8edf0" }}
    originWhitelist={[new URL(uri).origin]}
    onShouldStartLoadWithRequest={request => request.url === uri}
    javaScriptEnabled geolocationEnabled={false}
    onLoadStart={() => { ready.current = false; }}
    onError={() => props.onMapError(true)}
    onHttpError={() => props.onMapError(true)}
    onMessage={event => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === "ride-map-ready") { ready.current = true; send(); }
        if (data.type === "ride-map-loaded") current.current.onMapError(false);
        if (data.type === "ride-map-error") current.current.onMapError(true);
      } catch { current.current.onMapError(true); }
    }} />;
}
