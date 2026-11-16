import { useState } from "react";
import { AppleMaps, GoogleMaps } from "expo-maps";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";

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
  seekerLocation: Coordinate | null;
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
  seekerLocation,
  markers,
  selectedMarkerId,
  onSelectMarker,
}: Props) {
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const radiusPixels = radiusKm * 1000 / (156543.03392 * Math.max(0.01, Math.cos((center.latitude * Math.PI) / 180)) / (2 ** zoom));
  const circleDiameter = radiusPixels * 2;
  const radiusCircle = mapSize.width > 0 && mapSize.height > 0 ? (
    <View
      pointerEvents="none"
      accessibilityLabel={`Search radius ${radiusKm} kilometres`}
      style={[styles.radiusCircle, {
        width: circleDiameter,
        height: circleDiameter,
        borderRadius: radiusPixels,
        left: (mapSize.width - circleDiameter) / 2,
        top: (mapSize.height - circleDiameter) / 2,
      }]}
    />
  ) : null;
  const cameraPosition = { coordinates: center, zoom };
  const seekerMarker = seekerLocation ? [{
    id: "seeker-location",
    coordinates: seekerLocation,
    title: "Your location",
  }] : [];

  if (Platform.OS === "android") {
    return (
      <View style={StyleSheet.absoluteFill} onLayout={(event) => setMapSize(event.nativeEvent.layout)}>
      <GoogleMaps.View
        style={StyleSheet.absoluteFill}
        cameraPosition={cameraPosition}
        markers={[
          ...markers.map((marker) => ({
            id: marker.id,
            coordinates: marker.coordinates,
            title: marker.title,
            snippet: marker.snippet,
            showCallout: marker.id === selectedMarkerId,
          })),
          ...seekerMarker.map((marker) => ({
            id: marker.id,
            coordinates: marker.coordinates,
            title: marker.title,
          })),
        ]}
        onMarkerClick={(marker) => {
          if (marker.id) onSelectMarker(marker.id);
        }}
      />
      {radiusCircle}
      </View>
    );
  }

  if (Platform.OS === "ios") {
    return (
      <View style={StyleSheet.absoluteFill} onLayout={(event) => setMapSize(event.nativeEvent.layout)}>
      <AppleMaps.View
        style={StyleSheet.absoluteFill}
        cameraPosition={cameraPosition}
        annotations={[
          ...markers.map((marker) => ({
            id: marker.id,
            coordinates: marker.coordinates,
            title: marker.title,
            text: marker.snippet,
          })),
          ...seekerMarker.map((marker) => ({
            id: marker.id,
            coordinates: marker.coordinates,
            title: marker.title,
          })),
        ]}
      />
      {radiusCircle}
      </View>
    );
  }

  // Expo Maps is native-only. On Expo Web, render real OpenStreetMap tiles
  // and provider pins rather than leaving the map area blank.
  const tileZoom = Math.max(3, Math.min(18, Math.round(zoom)));
  const worldSize = 256 * 2 ** tileZoom;
  const toWorld = ({ latitude, longitude }: Coordinate) => {
    const lat = Math.max(-85.05112878, Math.min(85.05112878, latitude));
    const sin = Math.sin((lat * Math.PI) / 180);
    return {
      x: ((longitude + 180) / 360) * worldSize,
      y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldSize,
    };
  };
  const webRadiusPixels = radiusKm * 1000 / (156543.03392 * Math.max(0.01, Math.cos((center.latitude * Math.PI) / 180)) / (2 ** tileZoom));
  const centerWorld = toWorld(center);
  const centerTileX = Math.floor(centerWorld.x / 256);
  const centerTileY = Math.floor(centerWorld.y / 256);
  const tiles = [-1, 0, 1].flatMap((row) => [-1, 0, 1].map((column) => {
    const x = centerTileX + column;
    const y = centerTileY + row;
    const count = 2 ** tileZoom;
    const wrappedX = ((x % count) + count) % count;
    if (y < 0 || y >= count) return null;
    return {
      key: `${tileZoom}-${wrappedX}-${y}`,
      uri: `https://tile.openstreetmap.org/${tileZoom}/${wrappedX}/${y}.png`,
      left: 256 + column * 256 - (centerWorld.x - centerTileX * 256),
      top: 256 + row * 256 - (centerWorld.y - centerTileY * 256),
    };
  })).filter((tile): tile is NonNullable<typeof tile> => tile !== null);

  return (
    <View style={[StyleSheet.absoluteFill, styles.webMap]} accessibilityLabel="Provider locations map" onLayout={(event) => setMapSize(event.nativeEvent.layout)}>
      <View style={styles.webTileCanvas}>
        {tiles.map((tile) => (
          <Image key={tile.key} source={{ uri: tile.uri }} style={[styles.webTile, { left: tile.left, top: tile.top }]} />
        ))}
        <View pointerEvents="none" style={[styles.radiusCircle, { width: webRadiusPixels * 2, height: webRadiusPixels * 2, borderRadius: webRadiusPixels, left: 384 - webRadiusPixels, top: 384 - webRadiusPixels }]} />
        {seekerLocation ? (() => {
          const point = toWorld(seekerLocation);
          const left = 384 + point.x - centerWorld.x;
          const top = 384 + point.y - centerWorld.y;
          if (left < 0 || left > 768 || top < 0 || top > 768) return null;
          return (
            <View
              key="seeker-location"
              accessibilityLabel="Your location"
              style={[styles.seekerMarker, { left: left - 15, top: top - 30 }]}
            >
              <View style={styles.seekerMarkerDot}><Text style={styles.seekerMarkerText}>●</Text></View>
              <Text style={styles.seekerMarkerLabel}>YOU</Text>
            </View>
          );
        })() : null}
        {markers.map((marker) => {
          const point = toWorld(marker.coordinates);
          const left = 384 + point.x - centerWorld.x;
          const top = 384 + point.y - centerWorld.y;
          if (left < 0 || left > 768 || top < 0 || top > 768) return null;
          const selected = marker.id === selectedMarkerId;
          return (
            <Pressable
              key={marker.id}
              accessibilityRole="button"
              accessibilityLabel={marker.title}
              onPress={() => onSelectMarker(marker.id)}
              style={[styles.webMarker, { left: left - 12, top: top - 27 }, selected && styles.webMarkerSelected]}
            >
              <Text style={styles.webMarkerText}>📍</Text>
              <View style={styles.webMarkerCopy}>
                <Text numberOfLines={1} style={[styles.webMarkerSkill, selected && styles.webMarkerSkillSelected]}>{marker.title}</Text>
                <Text style={[styles.webMarkerDistance, selected && styles.webMarkerDistanceSelected]}>{marker.snippet}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.mapAttribution}>© OpenStreetMap contributors</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  radiusCircle: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "rgba(0, 102, 204, 0.85)",
    backgroundColor: "rgba(0, 102, 204, 0.10)",
    zIndex: 1,
  },
  webMap: {
    overflow: "hidden",
    backgroundColor: "#EAF1F8",
  },
  webTileCanvas: {
    position: "absolute",
    width: 768,
    height: 768,
    left: "50%",
    top: "50%",
    marginLeft: -384,
    marginTop: -384,
  },
  webTile: {
    position: "absolute",
    width: 256,
    height: 256,
  },
  webMarker: {
    position: "absolute",
    minHeight: 28,
    maxWidth: 180,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#0066CC",
    paddingHorizontal: 7,
    paddingVertical: 3,
    zIndex: 2,
    elevation: 3,
  },
  webMarkerSelected: {
    backgroundColor: "#0B2545",
    borderColor: "#0B2545",
    transform: [{ scale: 1.08 }],
  },
  webMarkerText: {
    color: "#0066CC",
    fontSize: 13,
    lineHeight: 17,
  },
  webMarkerCopy: { flexShrink: 1, gap: 1, maxWidth: 145 },
  webMarkerSkill: {
    color: "#0B2545",
    fontSize: 10,
    fontWeight: "800",
  },
  webMarkerSkillSelected: { color: "#FFFFFF" },
  webMarkerDistance: {
    color: "#607080",
    fontSize: 9,
    fontWeight: "600",
  },
  webMarkerDistanceSelected: { color: "#DCEBFF" },
  seekerMarker: {
    position: "absolute",
    alignItems: "center",
    gap: 2,
    zIndex: 4,
    elevation: 6,
  },
  seekerMarkerDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#0066CC",
    borderWidth: 3,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  seekerMarkerText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
    lineHeight: 12,
  },
  seekerMarkerLabel: {
    overflow: "hidden",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: "#0066CC",
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  mapAttribution: {
    position: "absolute",
    right: 5,
    bottom: 3,
    paddingHorizontal: 4,
    backgroundColor: "rgba(255,255,255,0.8)",
    color: "#334155",
    fontSize: 8,
  },
});
