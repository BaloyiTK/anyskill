import { AppleMaps, GoogleMaps } from "expo-maps";
import { Platform, StyleSheet, Text, View } from "react-native";

type Coordinate = { latitude: number; longitude: number };
type ProviderMarker = {
  id: string;
  coordinates: Coordinate;
  title: string;
  snippet: string;
};

type Props = {
  center: Coordinate;
  zoom: number;
  radiusKm: number;
  markers: ProviderMarker[];
  selectedMarkerId: string | null;
  onSelectMarker: (id: string) => void;
};

/**
 * Native map used by the mobile welcome screen.
 * The dedicated AnySkill web application owns its browser map implementation;
 * expo-maps supplies the native Google Maps / Apple Maps views here.
 */
export default function WelcomeMap({
  center,
  zoom,
  radiusKm,
  markers,
  selectedMarkerId,
  onSelectMarker,
}: Props) {
  const cameraPosition = { coordinates: center, zoom };
  const circles = [{
    id: "search-radius",
    center,
    radius: radiusKm * 1000,
    color: "rgba(0, 102, 204, 0.10)",
    lineColor: "rgba(0, 102, 204, 0.65)",
    lineWidth: 2,
  }];

  if (Platform.OS === "android") {
    return (
      <GoogleMaps.View
        style={StyleSheet.absoluteFill}
        cameraPosition={cameraPosition}
        circles={circles}
        markers={markers.map((marker) => ({
          id: marker.id,
          coordinates: marker.coordinates,
          title: marker.title,
          snippet: marker.snippet,
          showCallout: marker.id === selectedMarkerId,
        }))}
        onMarkerClick={(marker) => {
          if (marker.id) onSelectMarker(marker.id);
        }}
      />
    );
  }

  if (Platform.OS === "ios") {
    return (
      <AppleMaps.View
        style={StyleSheet.absoluteFill}
        cameraPosition={cameraPosition}
        circles={circles}
        annotations={markers.map((marker) => ({
          id: marker.id,
          coordinates: marker.coordinates,
          title: marker.title,
          text: marker.snippet,
        }))}
      />
    );
  }

  return (
    <View style={[StyleSheet.absoluteFill, styles.webFallback]}>
      <Text style={styles.webFallbackText}>
        Open AnySkill on Android or iOS to view the interactive provider map.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  webFallback: {
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: "#EAF1F8",
  },
  webFallbackText: {
    color: "#526579",
    fontSize: 12,
    textAlign: "center",
  },
});
