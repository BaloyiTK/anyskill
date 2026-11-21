import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";

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

function regionFor(latitude: number, longitude: number, zoom: number) {
  const latitudeDelta = Math.min(150, 360 / 2 ** zoom);
  return {
    latitude,
    longitude,
    latitudeDelta,
    longitudeDelta: Math.min(360, latitudeDelta / Math.max(0.2, Math.cos(latitude * Math.PI / 180))),
  };
}

export function MapPinPicker(p: Props) {
  const mapRef = useRef<MapView | null>(null);
  const [zoom, setZoom] = useState(p.readOnly ? 11 : 14);
  const region = useMemo(() => regionFor(p.latitude, p.longitude, zoom), [p.latitude, p.longitude, zoom]);
  const mapProviderName = Platform.OS === "ios" ? "Apple Maps" : "Google Maps";

  useEffect(() => {
    if (p.routeCoordinates && p.routeCoordinates.length > 1) {
      mapRef.current?.fitToCoordinates(p.routeCoordinates, { edgePadding: { top: 38, right: 38, bottom: 38, left: 38 }, animated: true });
      return;
    }
    if (p.liveLatitude != null && p.liveLongitude != null && p.selectedLatitude != null && p.selectedLongitude != null) {
      mapRef.current?.fitToCoordinates([
        { latitude: p.liveLatitude, longitude: p.liveLongitude },
        { latitude: p.selectedLatitude, longitude: p.selectedLongitude },
      ], { edgePadding: { top: 42, right: 42, bottom: 42, left: 42 }, animated: true });
      return;
    }
    mapRef.current?.animateToRegion(region, 250);
  }, [region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta, p.liveLatitude, p.liveLongitude, p.selectedLatitude, p.selectedLongitude, p.routeCoordinates]);

  const changeZoom = (delta: number) => setZoom((current) => Math.max(3, Math.min(19, current + delta)));

  return <View style={styles.wrap}>
    <View style={styles.map}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        mapType="standard"
        toolbarEnabled={false}
        showsCompass
        showsScale
        zoomEnabled
        scrollEnabled
        onPress={(event) => {
          if (!p.readOnly) {
            const { latitude, longitude } = event.nativeEvent.coordinate;
            p.onSelect(latitude, longitude);
          }
        }}
      >
        {p.selectedLatitude != null && p.selectedLongitude != null ? (
          <Marker
            coordinate={{ latitude: p.selectedLatitude, longitude: p.selectedLongitude }}
            title="Job location"
            description="Selected service location"
            pinColor="#176B55"
          />
        ) : null}
        {p.routeCoordinates && p.routeCoordinates.length > 1 ? (
          <Polyline coordinates={p.routeCoordinates} strokeColor="#176B55" strokeWidth={5} lineCap="round" lineJoin="round" />
        ) : null}
        {p.liveLatitude != null && p.liveLongitude != null ? (
          <Marker coordinate={{ latitude: p.liveLatitude, longitude: p.liveLongitude }} title="Provider live location" description="Live position shared by your selected Provider" anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.currentDot} />
          </Marker>
        ) : null}
        {p.showCenterMarker ? (
          <Marker
            coordinate={{ latitude: p.latitude, longitude: p.longitude }}
            title="Your current location"
            description="Provider live location"
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.currentDot} />
          </Marker>
        ) : null}
      </MapView>
      <View style={styles.zoom}>
        <Pressable accessibilityLabel="Zoom in" onPress={() => changeZoom(1)} style={styles.zoomButton}><Text style={styles.zoomText}>+</Text></Pressable>
        <Pressable accessibilityLabel="Zoom out" onPress={() => changeZoom(-1)} style={styles.zoomButton}><Text style={styles.zoomText}>−</Text></Pressable>
      </View>
    </View>
    <Text style={styles.help}>{p.liveLatitude != null ? `${mapProviderName} · Blue dot: Provider's live location. Pin: service destination.` : p.routeCoordinates?.length ? `${mapProviderName} · Green line: driving route. Pin: service destination.` : p.readOnly ? `${mapProviderName} · Blue dot: your current location. Pin: the job location.` : `${mapProviderName} · Tap the map to place the job-location pin. Use + / − to change zoom.`}</Text>
    {p.selectedLatitude != null && p.selectedLongitude != null
      ? <Text style={styles.coords}>Selected pin: {p.selectedLatitude.toFixed(6)}, {p.selectedLongitude.toFixed(6)}</Text>
      : <Text style={styles.coords}>No pin selected yet.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10, marginBottom: 12 },
  map: { height: 230, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: "#DCE5E0", backgroundColor: "#E8EDE9" },
  currentDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#0066CC", borderWidth: 3, borderColor: "#FFFFFF", elevation: 4 },
  zoom: { position: "absolute", right: 9, top: 9, gap: 5 },
  zoomButton: { width: 34, height: 34, borderRadius: 8, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", elevation: 3 },
  zoomText: { color: "#17231F", fontSize: 22, fontWeight: "700", lineHeight: 25 },
  help: { color: "#68766F", fontSize: 11, lineHeight: 16, marginTop: 6 },
  coords: { color: "#176B5B", fontSize: 11, fontWeight: "700", marginTop: 5 },
});
