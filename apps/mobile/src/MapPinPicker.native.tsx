import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";

type Props = {
  latitude: number;
  longitude: number;
  selectedLatitude: number | null;
  selectedLongitude: number | null;
  onSelect: (latitude: number, longitude: number) => void;
  readOnly?: boolean;
  showCenterMarker?: boolean;
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

  useEffect(() => {
    mapRef.current?.animateToRegion(region, 250);
  }, [region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta]);

  const changeZoom = (delta: number) => setZoom((current) => Math.max(3, Math.min(19, current + delta)));

  return <View style={styles.wrap}>
    <View style={styles.map}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
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
    <Text style={styles.help}>{p.readOnly ? "Google Maps · Blue dot: your current location. Pin: the job location." : "Google Maps · Tap the map to place the job-location pin. Use + / − to change zoom."}</Text>
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
