import { useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  latitude: number;
  longitude: number;
  selectedLatitude: number | null;
  selectedLongitude: number | null;
  onSelect: (latitude: number, longitude: number) => void;
};

const TILE = 256;
const MAX_LAT = 85.05112878;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
function worldPoint(latitude: number, longitude: number, zoom: number) {
  const scale = TILE * 2 ** zoom;
  const lat = clamp(latitude, -MAX_LAT, MAX_LAT) * Math.PI / 180;
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * scale,
  };
}
function coordinateAt(x: number, y: number, centerX: number, centerY: number, width: number, height: number, zoom: number) {
  const scale = TILE * 2 ** zoom;
  const px = centerX + x - width / 2;
  const py = centerY + y - height / 2;
  const longitude = px / scale * 360 - 180;
  const n = Math.PI - 2 * Math.PI * py / scale;
  const latitude = 180 / Math.PI * Math.atan(Math.sinh(n));
  return { latitude: clamp(latitude, -90, 90), longitude: clamp(longitude, -180, 180) };
}

export function MapPinPicker(p: Props) {
  const [zoom, setZoom] = useState(14);
  const [size, setSize] = useState({ width: 320, height: 230 });
  const center = useMemo(() => worldPoint(p.latitude, p.longitude, zoom), [p.latitude, p.longitude, zoom]);
  const centerTileX = Math.floor(center.x / TILE);
  const centerTileY = Math.floor(center.y / TILE);
  const tileCount = 2 ** zoom;
  const marker = p.selectedLatitude != null && p.selectedLongitude != null
    ? worldPoint(p.selectedLatitude, p.selectedLongitude, zoom) : null;
  const markerX = marker ? marker.x - center.x + size.width / 2 : size.width / 2;
  const markerY = marker ? marker.y - center.y + size.height / 2 : size.height / 2;

  return <View style={styles.wrap}>
    <View style={styles.map} onLayout={(event) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
        {[-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => {
          const rawX = centerTileX + dx;
          const x = (rawX + tileCount) % tileCount;
          const y = centerTileY + dy;
          if (y < 0 || y >= tileCount) return null;
          const left = rawX * TILE - center.x + size.width / 2;
          const top = y * TILE - center.y + size.height / 2;
          return <Image key={zoom + ":" + rawX + ":" + y}
            source={{ uri: "https://tile.openstreetmap.org/" + zoom + "/" + x + "/" + y + ".png" }}
            style={{ position: "absolute", width: TILE, height: TILE, left, top }}
            resizeMode="stretch" />;
        }))}
      </View>
      <Pressable style={StyleSheet.absoluteFill} onPress={(event) => {
        const point = coordinateAt(event.nativeEvent.locationX, event.nativeEvent.locationY, center.x, center.y, size.width, size.height, zoom);
        p.onSelect(point.latitude, point.longitude);
      }}>
        <View pointerEvents="none" style={[styles.pin, { left: markerX - 12, top: markerY - 26 }]}>
          <View style={styles.pinHead} /><View style={styles.pinTail} />
        </View>
      </Pressable>
      <View style={styles.zoom}>
        <Pressable onPress={() => setZoom((value) => Math.min(19, value + 1))} style={styles.zoomButton}><Text style={styles.zoomText}>+</Text></Pressable>
        <Pressable onPress={() => setZoom((value) => Math.max(3, value - 1))} style={styles.zoomButton}><Text style={styles.zoomText}>−</Text></Pressable>
      </View>
      <View pointerEvents="none" style={styles.attribution}><Text style={styles.attributionText}>© OpenStreetMap contributors</Text></View>
    </View>
    <Text style={styles.help}>Tap the map to place the pin. Use + / − to change zoom. Map tiles require an internet connection.</Text>
    {p.selectedLatitude != null && p.selectedLongitude != null
      ? <Text style={styles.coords}>Selected pin: {p.selectedLatitude.toFixed(6)}, {p.selectedLongitude.toFixed(6)}</Text>
      : <Text style={styles.coords}>No pin selected yet.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10, marginBottom: 12 },
  map: { height: 230, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: "#DCE5E0", backgroundColor: "#E8EDE9" },
  pin: { position: "absolute", width: 24, height: 30, alignItems: "center" },
  pinHead: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#176B5B", borderWidth: 3, borderColor: "#FFFFFF" },
  pinTail: { width: 3, height: 10, backgroundColor: "#176B5B", marginTop: -1 },
  zoom: { position: "absolute", right: 9, top: 9, gap: 5 },
  zoomButton: { width: 34, height: 34, borderRadius: 8, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", elevation: 2 },
  zoomText: { color: "#17231F", fontSize: 22, fontWeight: "700", lineHeight: 25 },
  attribution: { position: "absolute", left: 5, bottom: 4, paddingHorizontal: 4, paddingVertical: 2, backgroundColor: "rgba(255,255,255,0.85)", borderRadius: 4 },
  attributionText: { color: "#17231F", fontSize: 9 },
  help: { color: "#68766F", fontSize: 11, lineHeight: 16, marginTop: 6 },
  coords: { color: "#176B5B", fontSize: 11, fontWeight: "700", marginTop: 5 },
});
