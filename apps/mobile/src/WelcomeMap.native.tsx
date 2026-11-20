import { useEffect, useMemo, useRef } from "react";
import { StyleSheet } from "react-native";
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from "react-native-maps";
import type { WelcomeMapProps } from "./WelcomeMap.types";

function regionFor(center: WelcomeMapProps["center"], zoom: number) {
  const latitudeDelta = Math.min(150, 360 / 2 ** zoom);
  return {
    ...center,
    latitudeDelta,
    longitudeDelta: Math.min(360, latitudeDelta / Math.max(0.2, Math.cos(center.latitude * Math.PI / 180))),
  };
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
  const mapRef = useRef<MapView | null>(null);
  const region = useMemo(() => regionFor(center, zoom), [center.latitude, center.longitude, zoom]);

  useEffect(() => {
    mapRef.current?.animateToRegion(region, 250);
  }, [region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta]);

  return <MapView
    ref={mapRef}
    style={StyleSheet.absoluteFill}
    provider={PROVIDER_GOOGLE}
    initialRegion={region}
    mapType="standard"
    showsCompass
    showsScale
    toolbarEnabled={false}
    onPress={() => onSelectMarker(null)}
  >
    <Circle
      center={center}
      radius={radiusKm * 1000}
      fillColor="rgba(76,175,80,0.10)"
      strokeColor="#26845F"
      strokeWidth={2}
    />
    {seekerLocation ? (
      <Marker coordinate={seekerLocation} title="Your location" description="Your current position" anchor={{ x: 0.5, y: 0.5 }}>
        <></>
      </Marker>
    ) : null}
    {markers.map((marker) => (
      <Marker
        key={marker.id}
        identifier={marker.id}
        coordinate={marker.coordinates}
        title={marker.title}
        description={marker.snippet}
        pinColor={marker.id === selectedMarkerId ? "#176B55" : "#13875E"}
        onPress={() => onSelectMarker(marker.id)}
      />
    ))}
  </MapView>;
}
