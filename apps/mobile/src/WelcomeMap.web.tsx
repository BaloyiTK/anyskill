import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { WelcomeMapProps } from "./WelcomeMap.types";

declare global {
  interface Window {
    google?: any;
    __anyskillGoogleMapsPromise?: Promise<any>;
  }
}

const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

function loadGoogleMaps(): Promise<any> {
  if (window.google?.maps) return Promise.resolve(window.google);
  if (window.__anyskillGoogleMapsPromise) return window.__anyskillGoogleMapsPromise;

  window.__anyskillGoogleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-anyskill-google-maps]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.google), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google Maps could not be loaded.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.dataset.anyskillGoogleMaps = "true";
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY ?? "")}&v=weekly`;
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error("Google Maps could not be loaded. Check the browser key and Maps JavaScript API settings."));
    document.head.appendChild(script);
  });

  return window.__anyskillGoogleMapsPromise;
}

export default function WelcomeMap({
  center,
  zoom,
  radiusKm,
  markers,
  selectedMarkerId,
  onSelectMarker,
}: WelcomeMapProps) {
  const mapElement = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<any>(null);
  const markerInstances = useRef<any[]>([]);
  const circleInstance = useRef<any>(null);
  const [mapError, setMapError] = useState("");
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    let active = true;
    if (!GOOGLE_MAPS_KEY) {
      setMapError("Web map key is missing. Add EXPO_PUBLIC_GOOGLE_MAPS_API_KEY to apps/mobile/.env and restart Expo.");
      return () => { active = false; };
    }

    loadGoogleMaps()
      .then((google) => {
        if (!active || !mapElement.current || mapInstance.current) return;
        mapInstance.current = new google.maps.Map(mapElement.current, {
          center: { lat: center.latitude, lng: center.longitude },
          zoom,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: "greedy",
        });
        setMapReady(true);
      })
      .catch((error: unknown) => {
        if (active) setMapError(error instanceof Error ? error.message : "Google Maps could not be loaded.");
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    const map = mapInstance.current;
    const google = window.google;
    if (!mapReady || !map || !google?.maps) return;

    map.setCenter({ lat: center.latitude, lng: center.longitude });
    map.setZoom(zoom);

    markerInstances.current.forEach((marker) => marker.setMap(null));
    markerInstances.current = markers.map((marker) => {
      const selected = marker.id === selectedMarkerId;
      const instance = new google.maps.Marker({
        map,
        position: { lat: marker.coordinates.latitude, lng: marker.coordinates.longitude },
        title: `${marker.title} — ${marker.snippet}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: selected ? 9 : 7,
          fillColor: selected ? "#0066CC" : "#4CAF50",
          fillOpacity: 1,
          strokeColor: "#FFFFFF",
          strokeWeight: 2,
        },
      });
      instance.addListener("click", () => onSelectMarker(marker.id));
      return instance;
    });

    if (circleInstance.current) circleInstance.current.setMap(null);
    circleInstance.current = new google.maps.Circle({
      map,
      center: { lat: center.latitude, lng: center.longitude },
      radius: radiusKm * 1000,
      fillColor: "#4CAF50",
      fillOpacity: 0.10,
      strokeColor: "#26845F",
      strokeOpacity: 0.95,
      strokeWeight: 2,
      clickable: false,
    });
  }, [mapReady, center.latitude, center.longitude, zoom, radiusKm, markers, selectedMarkerId, onSelectMarker]);

  return <View style={StyleSheet.absoluteFill}>
    <div
      ref={mapElement}
      role="application"
      aria-label="Map showing available skill providers near the selected location"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
    {mapError ? <View pointerEvents="none" style={styles.errorOverlay}>
      <Text style={styles.errorTitle}>Map unavailable</Text>
      <Text style={styles.errorText}>{mapError}</Text>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  errorOverlay: {
    position: "absolute",
    left: 12,
    right: 12,
    top: "35%",
    padding: 14,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.96)",
    alignItems: "center",
  },
  errorTitle: { color: "#0B2545", fontSize: 13, fontWeight: "900" },
  errorText: { color: "#607080", fontSize: 11, textAlign: "center", marginTop: 5 },
});
