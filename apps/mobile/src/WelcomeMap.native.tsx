import { Platform, StyleSheet, View } from "react-native";
import { AppleMaps, GoogleMaps } from "expo-maps";
import type { WelcomeMapProps } from "./WelcomeMap.types";

export default function WelcomeMap({
  center,
  zoom,
  radiusKm,
  markers,
  onSelectMarker,
}: WelcomeMapProps) {
  const circles = [{
    id: "search-radius",
    center,
    radius: radiusKm * 1000,
    color: "rgba(76,175,80,0.10)",
    lineColor: "#26845F",
    lineWidth: 2,
  }];
  const nativeMarkers = markers.map((marker) => ({
    id: marker.id,
    coordinates: marker.coordinates,
    title: marker.title,
    snippet: marker.snippet,
    showCallout: true,
  }));

  if (Platform.OS === "android") {
    return <GoogleMaps.View
      key={`google-${center.latitude}-${center.longitude}-${radiusKm}`}
      style={StyleSheet.absoluteFill}
      cameraPosition={{ coordinates: center, zoom }}
      circles={circles}
      markers={nativeMarkers}
      onMarkerClick={(marker) => onSelectMarker(marker.id ?? null)}
      properties={{ isBuildingEnabled: true, isIndoorEnabled: true, isMyLocationEnabled: false }}
      uiSettings={{ compassEnabled: true, zoomControlsEnabled: false, myLocationButtonEnabled: false, scrollGesturesEnabled: true, zoomGesturesEnabled: true }}
    />;
  }

  if (Platform.OS === "ios") {
    return <AppleMaps.View
      key={`apple-${center.latitude}-${center.longitude}-${radiusKm}`}
      style={StyleSheet.absoluteFill}
      cameraPosition={{ coordinates: center, zoom }}
      circles={circles}
      annotations={nativeMarkers.map((marker) => ({
        id: marker.id,
        coordinates: marker.coordinates,
        title: marker.title,
      }))}
      onAnnotationClick={(marker) => onSelectMarker(marker.id ?? null)}
    />;
  }

  return <View style={StyleSheet.absoluteFill} />;
}
