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
  seekerLocation,
  markers,
  selectedMarkerId,
  onSelectMarker,
}: WelcomeMapProps) {
  const mapElement = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<any>(null);
  const markerOverlays = useRef<any[]>([]);
  const seekerOverlay = useRef<any>(null);
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

    markerOverlays.current.forEach((overlay) => overlay.setMap(null));
    markerOverlays.current = markers.map((marker) => {
      const selected = marker.id === selectedMarkerId;
      const overlay = new google.maps.OverlayView() as any;
      let element: HTMLDivElement | null = null;

      overlay.onAdd = () => {
        element = document.createElement("div");
        element.setAttribute("role", "button");
        element.setAttribute("tabindex", "0");
        element.setAttribute("aria-label", `${marker.title}, ${marker.snippet}`);
        element.title = `${marker.title} — ${marker.snippet}`;
        Object.assign(element.style, {
          position: "absolute",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          whiteSpace: "nowrap",
          cursor: "pointer",
          userSelect: "none",
          zIndex: selected ? "2" : "1",
        });

        const pin = document.createElement("div");
        pin.setAttribute("aria-hidden", "true");
        pin.innerHTML = '<svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg"><path d="M14 1C6.82 1 1 6.82 1 14c0 9.1 13 21 13 21s13-11.9 13-21C27 6.82 21.18 1 14 1Z" fill="#13875E" stroke="#FFFFFF" stroke-width="2"/><circle cx="14" cy="14" r="4.5" fill="#FFFFFF"/></svg>';
        Object.assign(pin.style, {
          width: "28px",
          height: "36px",
          flex: "0 0 28px",
          filter: "drop-shadow(0 1px 2px rgba(20, 45, 32, 0.28))",
        });

        const card = document.createElement("div");
        Object.assign(card.style, {
          display: "flex",
          flexDirection: "column",
          gap: "2px",
          padding: "6px 9px",
          borderRadius: "8px",
          background: "#FFFFFF",
          border: selected ? "1px solid #13875E" : "1px solid #DCE5DF",
          boxShadow: "0 2px 8px rgba(20, 45, 32, 0.16)",
          fontFamily: "Arial, sans-serif",
          lineHeight: "1.25",
        });

        const skill = document.createElement("span");
        skill.textContent = marker.title;
        Object.assign(skill.style, {
          color: "#18352C",
          fontSize: "12px",
          fontWeight: "700",
        });

        const distance = document.createElement("span");
        distance.textContent = marker.snippet;
        Object.assign(distance.style, {
          color: "#687970",
          fontSize: "10px",
          fontWeight: "400",
        });

        card.append(skill, distance);
        element.append(pin, card);

        const select = (event: Event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelectMarker(marker.id);
        };
        element.addEventListener("click", select);
        element.addEventListener("keydown", (event: KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") select(event);
        });

        const panes = overlay.getPanes();
        panes?.overlayMouseTarget?.appendChild(element);
      };

      overlay.draw = () => {
        if (!element) return;
        const projection = overlay.getProjection();
        const pixel = projection?.fromLatLngToDivPixel(
          new google.maps.LatLng(marker.coordinates.latitude, marker.coordinates.longitude),
        );
        if (!pixel) return;
        element.style.left = `${pixel.x}px`;
        element.style.top = `${pixel.y}px`;
        // The pin tip is anchored to the Provider's actual map coordinate.
        element.style.transform = "translate(-14px, -36px)";
      };

      overlay.onRemove = () => {
        element?.remove();
        element = null;
      };

      overlay.setMap(map);
      return overlay;
    });


    if (seekerOverlay.current) {
      seekerOverlay.current.setMap(null);
      seekerOverlay.current = null;
    }
    if (seekerLocation) {
      const overlay = new google.maps.OverlayView() as any;
      let element: HTMLDivElement | null = null;

      overlay.onAdd = () => {
        element = document.createElement("div");
        element.setAttribute("aria-label", "Your location");
        Object.assign(element.style, {
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "3px",
          pointerEvents: "none",
          userSelect: "none",
          zIndex: "1000",
          transform: "translate(-50%, -50%)",
        });

        const dot = document.createElement("div");
        Object.assign(dot.style, {
          width: "20px",
          height: "20px",
          boxSizing: "border-box",
          borderRadius: "50%",
          background: "#0066CC",
          border: "3px solid #FFFFFF",
          boxShadow: "0 1px 5px rgba(0, 35, 80, 0.55)",
        });

        const label = document.createElement("span");
        label.textContent = "YOU";
        Object.assign(label.style, {
          padding: "2px 6px",
          borderRadius: "7px",
          background: "#0066CC",
          color: "#FFFFFF",
          font: "900 9px Arial, sans-serif",
          letterSpacing: "0.4px",
          boxShadow: "0 1px 4px rgba(0, 35, 80, 0.25)",
        });

        element.append(dot, label);
        overlay.getPanes()?.overlayLayer?.appendChild(element);
      };

      overlay.draw = () => {
        if (!element) return;
        const pixel = overlay.getProjection()?.fromLatLngToDivPixel(
          new google.maps.LatLng(seekerLocation.latitude, seekerLocation.longitude),
        );
        if (!pixel) return;
        element.style.left = `${pixel.x}px`;
        element.style.top = `${pixel.y}px`;
      };

      overlay.onRemove = () => {
        element?.remove();
        element = null;
      };

      seekerOverlay.current = overlay;
      overlay.setMap(map);
    }

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
  }, [mapReady, center.latitude, center.longitude, zoom, radiusKm, seekerLocation?.latitude, seekerLocation?.longitude, markers, selectedMarkerId, onSelectMarker]);

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
