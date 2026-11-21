import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { loadGoogleMaps, type GoogleMapsWindow } from "./google-maps-loader.web";

type Props = {
  latitude: number;
  longitude: number;
  selectedLatitude: number | null;
  selectedLongitude: number | null;
  onSelect: (latitude: number, longitude: number) => void;
  readOnly?: boolean;
  showCenterMarker?: boolean;
  liveLatitude?: number | null;
  liveLongitude?: number | null;
  routeCoordinates?: Array<{ latitude: number; longitude: number }>;
};

export function MapPinPicker(p: Props) {
  const mapElement = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<any>(null);
  const jobMarker = useRef<any>(null);
  const currentMarker = useRef<any>(null);
  const liveMarker = useRef<any>(null);
  const routeLine = useRef<any>(null);
  const clickListener = useRef<any>(null);
  const [mapError, setMapError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const latestProps = useRef(p);
  latestProps.current = p;

  useEffect(() => {
    let active = true;
    loadGoogleMaps().then((google) => {
      if (!active || !mapElement.current || mapInstance.current) return;
      mapInstance.current = new google.maps.Map(mapElement.current, {
        center: { lat: p.latitude, lng: p.longitude },
        zoom: p.readOnly ? 11 : 14,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        gestureHandling: p.readOnly ? "cooperative" : "greedy",
        zoomControl: true,
        scaleControl: true,
      });
      clickListener.current = mapInstance.current.addListener("click", (event: any) => {
        const current = latestProps.current;
        if (!current.readOnly && event.latLng) current.onSelect(event.latLng.lat(), event.latLng.lng());
      });
      setMapReady(true);
    }).catch((error: unknown) => {
      if (active) setMapError(error instanceof Error ? error.message : "Google Maps could not be loaded.");
    });
    return () => {
      active = false;
      clickListener.current?.remove();
      jobMarker.current?.setMap(null);
      currentMarker.current?.setMap(null);
      liveMarker.current?.setMap(null);
      routeLine.current?.setMap(null);
      mapInstance.current = null;
    };
  }, []);

  useEffect(() => {
    const google = (window as GoogleMapsWindow).google;
    const map = mapInstance.current;
    if (!mapReady || !google?.maps || !map) return;
    map.setCenter({ lat: p.latitude, lng: p.longitude });
    if (p.selectedLatitude != null && p.selectedLongitude != null) {
      if (!jobMarker.current) jobMarker.current = new google.maps.Marker({ map, title: "Job location", label: "J" });
      jobMarker.current.setPosition({ lat: p.selectedLatitude, lng: p.selectedLongitude });
      jobMarker.current.setMap(map);
    } else if (jobMarker.current) {
      jobMarker.current.setMap(null);
    }
    if (p.showCenterMarker) {
      if (!currentMarker.current) currentMarker.current = new google.maps.Marker({
        map,
        title: "Your current location",
        clickable: false,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#0066CC", fillOpacity: 1, strokeColor: "#FFFFFF", strokeWeight: 3 },
      });
      currentMarker.current.setPosition({ lat: p.latitude, lng: p.longitude });
      currentMarker.current.setMap(map);
    } else if (currentMarker.current) {
      currentMarker.current.setMap(null);
    }
    if (p.liveLatitude != null && p.liveLongitude != null) {
      if (!liveMarker.current) liveMarker.current = new google.maps.Marker({
        map, title: "Provider live location", clickable: false,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: "#0066CC", fillOpacity: 1, strokeColor: "#FFFFFF", strokeWeight: 3 },
      });
      liveMarker.current.setPosition({ lat: p.liveLatitude, lng: p.liveLongitude });
      liveMarker.current.setMap(map);
    } else if (liveMarker.current) {
      liveMarker.current.setMap(null);
    }
    if (p.routeCoordinates && p.routeCoordinates.length > 1) {
      const path = p.routeCoordinates.map((point) => ({ lat: point.latitude, lng: point.longitude }));
      if (!routeLine.current) routeLine.current = new google.maps.Polyline({ map, strokeColor: "#176B55", strokeOpacity: 0.95, strokeWeight: 6, geodesic: true });
      routeLine.current.setPath(path);
      routeLine.current.setMap(map);
      const bounds = new google.maps.LatLngBounds();
      path.forEach((point) => bounds.extend(point));
      map.fitBounds(bounds, 42);
    } else if (routeLine.current) {
      routeLine.current.setMap(null);
    }
    if ((!p.routeCoordinates || p.routeCoordinates.length < 2) && p.liveLatitude != null && p.liveLongitude != null && p.selectedLatitude != null && p.selectedLongitude != null) {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: p.liveLatitude, lng: p.liveLongitude });
      bounds.extend({ lat: p.selectedLatitude, lng: p.selectedLongitude });
      map.fitBounds(bounds, 42);
    }
  }, [mapReady, p.latitude, p.longitude, p.selectedLatitude, p.selectedLongitude, p.showCenterMarker, p.liveLatitude, p.liveLongitude, p.routeCoordinates]);

  return <View style={styles.wrap}>
    <View style={styles.map}>
      <div ref={mapElement} role="application" aria-label="Google Map for selecting the service location" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      {mapError ? <View pointerEvents="none" style={styles.error}><Text style={styles.errorTitle}>Map unavailable</Text><Text style={styles.errorText}>{mapError}</Text></View> : null}
    </View>
    <Text style={styles.help}>{p.liveLatitude != null ? "Google Maps · Blue dot: Provider's live location. Pin: service destination." : p.routeCoordinates?.length ? "Google Maps · Green line: driving route. Pin: service destination." : p.readOnly ? "Google Maps · Blue dot: your current location. Pin: the job location." : "Google Maps · Click the map to place the job-location pin."}</Text>
    {p.selectedLatitude != null && p.selectedLongitude != null
      ? <Text style={styles.coords}>Selected pin: {p.selectedLatitude.toFixed(6)}, {p.selectedLongitude.toFixed(6)}</Text>
      : <Text style={styles.coords}>No pin selected yet.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10, marginBottom: 12 },
  map: { height: 230, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: "#DCE5E0", backgroundColor: "#E8EDE9", position: "relative" },
  error: { position: "absolute", left: 12, right: 12, top: "35%", padding: 14, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.96)", alignItems: "center" },
  errorTitle: { color: "#0B2545", fontSize: 13, fontWeight: "900" },
  errorText: { color: "#607080", fontSize: 11, textAlign: "center", marginTop: 5 },
  help: { color: "#68766F", fontSize: 11, lineHeight: 16, marginTop: 6 },
  coords: { color: "#176B5B", fontSize: 11, fontWeight: "700", marginTop: 5 },
});
