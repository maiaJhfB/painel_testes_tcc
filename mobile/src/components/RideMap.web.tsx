import { createElement, useEffect, useRef, useState } from "react";
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

export default function RideMap(props: Props) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const current = useRef(props);
  const [ready, setReady] = useState(false);
  current.current = props;
  const serverUrl = getDevServerUrl();
  const origin = new URL(serverUrl).origin;
  const send = () => {
    const { onMapError: _callback, ...state } = current.current;
    frame.current?.contentWindow?.postMessage({ type: "ride-map-state", ...state }, origin);
  };

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "ride-map-ready") { setReady(true); send(); }
      if (event.data?.type === "ride-map-error") current.current.onMapError(true);
      if (event.data?.type === "ride-map-loaded") current.current.onMapError(false);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [origin]);

  useEffect(() => { if (ready) send(); }, [ready, props.route, props.car, props.passenger, props.destination, props.stage, props.fitRevision]);

  return createElement("iframe", {
    ref: frame,
    src: `${serverUrl}/mock/map/view`,
    title: "Mapa da corrida com ruas, rota e GPS dos participantes",
    onLoad: () => { setReady(true); send(); },
    onError: () => current.current.onMapError(true),
    style: { position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, background: "#e8edf0" },
  });
}
