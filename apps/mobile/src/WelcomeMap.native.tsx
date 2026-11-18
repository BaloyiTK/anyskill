import { Platform, StyleSheet, View } from "react-native";
import { AppleMaps, GoogleMaps } from "expo-maps";
import type { WelcomeMapProps } from "./WelcomeMap.types";

export default function WelcomeMap({
  center,
  zoom,
  radiusKm,
  seekerLocation,
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

  // Keep the seeker's location as a normal map annotation. This avoids
  // depending on the device's native "my location" layer/permission state.
  const nativeMarkers = [
    ...markers.map((marker) => ({
      id: marker.id,
      coordinates: marker.coordinates,
      title: marker.title,
      snippet: marker.snippet,
      showCallout: true,
    })),
    ...(seekerLocation ? [{
      id: "seeker-location",
      coordinates: seekerLocation,
      title: "Your location",
      snippet: "Your current position",
      showCallout: false,
    }] : []),
  ];

  const handleMarkerClick = (marker: { id?: string | null }) => {
    if (!marker.id || marker.id === "seeker-location") {
      onSelectMarker(null);
      return;
    }
    onSelectMarker(marker.id);
  };

  if (Platform.OS === "android") {
    return <GoogleMaps.View
      // Do not key the native map by coordinates: changing a GPS fix or
      // search centre must update the existing map, not destroy/recreate it.
      style={StyleSheet.absoluteFill}
      cameraPosition={{ coordinates: center, zoom }}
      circles={circles}
      markers={nativeMarkers}
      onMarkerClick={handleMarkerClick}
      properties={{ isBuildingEnabled: true, isIndoorEnabled: true, isMyLocationEnabled: false }}
      uiSettings={{ compassEnabled: true, zoomControlsEnabled: false, myLocationButtonEnabled: false, scrollGesturesEnabled: true, zoomGesturesEnabled: true }}
    />;
  }

  if (Platform.OS === "ios") {
    return <AppleMaps.View
      style={StyleSheet.absoluteFill}
      cameraPosition={{ coordinates: center, zoom }}
      circles={circles}
      annotations={nativeMarkers.map((marker) => ({
        id: marker.id,
        coordinates: marker.coordinates,
        title: marker.title,
        text: marker.snippet,
      }))}
      onAnnotationClick={handleMarkerClick}
    />;
  }

  return <View style={StyleSheet.absoluteFill} />;
}
