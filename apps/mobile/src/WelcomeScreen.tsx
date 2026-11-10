import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { apiRequest } from "./api";

type LocationSuggestion = { label: string; latitude: number; longitude: number };

type ProviderPin = {
  id: string;
  name: string;
  skill: string;
  distanceKm: number;
  latitude: number;
  longitude: number;
};

type Props = {
  onSignIn: () => void;
  onSignUp: () => void;
  onGoogle: () => void;
};

const RADII = [1, 5, 10, 20, 50] as const;
const DEFAULT_CENTER = { latitude: -26.2041, longitude: 28.0473 };
const TILE = 256;
const TILE_URL = process.env.EXPO_PUBLIC_MAP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ZOOM = 12;

// AnySkill brand palette, based on the colours supplied from the approved logo.
const THEME = {
  background: "#F6F8FA",
  surface: "#FFFFFF",
  navy: "#0B2545",
  blue: "#0066CC",
  green: "#4CAF50",
  forest: "#1B5E20",
  softBlue: "#EAF3FF",
  softGreen: "#EAF6EC",
  ink: "#0B2545",
  muted: "#607080",
  border: "#E1E8F0",
  danger: "#A12D2D",
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function worldPoint(latitude: number, longitude: number) {
  const scale = TILE * 2 ** ZOOM;
  const lat = clamp(latitude, -85.05112878, 85.05112878) * Math.PI / 180;
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * scale,
  };
}

export function WelcomeScreen({ onSignIn, onSignUp, onGoogle }: Props) {
  const [radiusKm, setRadiusKm] = useState<number>(5);
  const [radiusOpen, setRadiusOpen] = useState(false);
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [areaLabel, setAreaLabel] = useState("Detecting your location…");
  const [manualLocation, setManualLocation] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [searchingLocation, setSearchingLocation] = useState(false);
  const [providers, setProviders] = useState<ProviderPin[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [mapSize, setMapSize] = useState({ width: 340, height: 330 });
  const [locating, setLocating] = useState(false);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [providerError, setProviderError] = useState("");

  const center = useMemo(
    () => worldPoint(coordinates?.latitude ?? DEFAULT_CENTER.latitude, coordinates?.longitude ?? DEFAULT_CENTER.longitude),
    [coordinates],
  );
  const centerTileX = Math.floor(center.x / TILE);
  const centerTileY = Math.floor(center.y / TILE);
  const tileCount = 2 ** ZOOM;

  useEffect(() => {
    if (!coordinates) return;
    let active = true;
    setLoadingProviders(true);
    setProviders([]);
    setSelectedProviderId(null);
    setProviderError("");
    const query = new URLSearchParams({
      latitude: String(coordinates.latitude),
      longitude: String(coordinates.longitude),
      radiusKm: String(radiusKm),
    });
    apiRequest<ProviderPin[]>(`/marketplace/discover/providers?${query.toString()}`)
      .then((result) => {
        if (!active) return;
        setProviders(result);
        setSelectedProviderId(null);
      })
      .catch((error) => {
        if (active) setProviderError(error instanceof Error ? error.message : "Nearby Providers could not be loaded.");
      })
      .finally(() => { if (active) setLoadingProviders(false); });
    return () => { active = false; };
  }, [coordinates, radiusKm]);

  const chooseLocation = async () => {
    setLocating(true);
    setLocationError("");
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted) permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setLocationError("Location permission is needed to find available Providers near you.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setCoordinates(next);
      setAreaLabel("Your current area");
      try {
        const places = await Location.reverseGeocodeAsync(next);
        const place = places[0];
        if (place) {
          const label = [place.subregion, place.city, place.region].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join(", ");
          if (label) setAreaLabel(label);
        }
      } catch {
        // GPS coordinates remain usable if reverse geocoding is unavailable.
      }
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "Could not determine your location. Please try again.");
    } finally {
      setLocating(false);
    }
  };

  // Look up matching places as the user types, with a short debounce.
  useEffect(() => {
    const query = manualLocation.trim();
    if (query.length < 3) {
      setLocationSuggestions([]);
      setSearchingLocation(false);
      return;
    }
    let active = true;
    const timeout = setTimeout(async () => {
      setSearchingLocation(true);
      try {
        const matches = await Location.geocodeAsync(query);
        const suggestions: LocationSuggestion[] = [];
        for (const match of matches.slice(0, 5)) {
          if (!active) return;
          let label = query;
          try {
            const places = await Location.reverseGeocodeAsync({
              latitude: match.latitude,
              longitude: match.longitude,
            });
            const place = places[0];
            if (place) {
              label = [place.name, place.street, place.subregion, place.city, place.region, place.country]
                .filter(Boolean)
                .filter((value, index, all) => all.indexOf(value) === index)
                .join(", ");
            }
          } catch {
            // Coordinates can still be selected if reverse geocoding is unavailable.
          }
          suggestions.push({ label, latitude: match.latitude, longitude: match.longitude });
        }
        if (active) setLocationSuggestions(suggestions);
      } catch {
        if (active) setLocationSuggestions([]);
      } finally {
        if (active) setSearchingLocation(false);
      }
    }, 500);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [manualLocation]);

  const selectLocation = (suggestion: LocationSuggestion) => {
    setCoordinates({ latitude: suggestion.latitude, longitude: suggestion.longitude });
    setAreaLabel(suggestion.label);
    setManualLocation("");
    setLocationSuggestions([]);
    setLocationError("");
  };

  // Detect the device location automatically when the welcome screen opens.
  useEffect(() => {
    void chooseLocation();
    // Run once on mount; manual search remains available to correct the detected area.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const tileImages = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].flatMap((dy) => {
    const rawX = centerTileX + dx;
    const x = (rawX + tileCount) % tileCount;
    const y = centerTileY + dy;
    if (y < 0 || y >= tileCount) return [];
    return [{
      key: `${rawX}:${y}`,
      uri: TILE_URL.replace("{z}", String(ZOOM)).replace("{x}", String(x)).replace("{y}", String(y)),
      left: rawX * TILE - center.x + mapSize.width / 2,
      top: y * TILE - center.y + mapSize.height / 2,
    }];
  }));

  return <View style={styles.container}>
    <View style={styles.branding}>
      <Image source={require("../assets/branding/anyskill-logo.png")} style={styles.logo} resizeMode="contain" accessibilityLabel="AnySkill logo" />
    </View>
    <View style={styles.intro}>
      <Text style={styles.eyebrow}>LOCAL SKILLS. REAL PEOPLE.</Text>
      <Text style={styles.heading}>Find help nearby.</Text>
      <Text style={styles.subtitle}>We'll connect you with the best match first.</Text>
    </View>

    <View style={styles.locationCard}>
      <View style={styles.locationIcon}><Text style={styles.locationIconText}>⌖</Text></View>
      <View style={styles.locationCopy}>
        <Text style={styles.locationLabel}>YOUR AREA</Text>
        <Text numberOfLines={2} style={styles.locationValue}>{areaLabel}</Text>
      </View>
      {locating ? <ActivityIndicator color={THEME.blue} size="small" /> : coordinates ? <Text style={styles.locationDetected}>Detected</Text> : null}
    </View>
    <View style={styles.locationSearchRow}>
      <TextInput
        accessibilityLabel="Search for a location"
        value={manualLocation}
        onChangeText={setManualLocation}
        placeholder="Search suburb, city or address"
        placeholderTextColor={THEME.muted}
        style={styles.locationSearchInput}
      />
      {searchingLocation ? <ActivityIndicator color={THEME.blue} size="small" /> : null}
    </View>
    {locationSuggestions.length > 0 ? <View style={styles.locationSuggestions}>
      {locationSuggestions.map((suggestion, index) => <Pressable
        key={`${suggestion.latitude}:${suggestion.longitude}:${index}`}
        accessibilityRole="button"
        onPress={() => selectLocation(suggestion)}
        style={styles.locationSuggestion}
      >
        <View style={styles.suggestionPin}><Text style={styles.suggestionPinText}>⌖</Text></View>
        <Text numberOfLines={2} style={styles.locationSuggestionText}>{suggestion.label}</Text>
      </Pressable>)}
    </View> : manualLocation.trim().length >= 3 && !searchingLocation ? <Text style={styles.locationHint}>No matching places found. Try a different spelling.</Text> : null}
    {locationError ? <Text style={styles.error}>{locationError}</Text> : null}

    <View style={styles.radiusHeader}>
      <Text style={styles.radiusLabel}>SEARCH RADIUS</Text>
      <Text style={styles.radiusValue}>{radiusKm} km</Text>
    </View>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: radiusOpen }} onPress={() => setRadiusOpen((open) => !open)} style={styles.radiusDropdown}>
      <Text style={styles.radiusDropdownValue}>{radiusKm} km</Text>
      <Text style={styles.radiusDropdownChevron}>{radiusOpen ? "▲" : "▼"}</Text>
    </Pressable>
    {radiusOpen ? <View style={styles.radiusDropdownOptions}>
      {RADII.map((radius) => <Pressable key={radius} accessibilityRole="button" accessibilityState={{ selected: radiusKm === radius }} onPress={() => { setRadiusKm(radius); setRadiusOpen(false); }} style={[styles.radiusDropdownOption, radiusKm === radius && styles.radiusDropdownOptionSelected]}>
        <Text style={[styles.radiusDropdownOptionText, radiusKm === radius && styles.radiusDropdownOptionTextSelected]}>{radius} km</Text>
      </Pressable>)}
    </View> : null}

    <View style={styles.mapFrame}>
      <View style={styles.mapHeader}>
        <Text style={styles.mapTitle}>Available near you</Text>
        <View style={styles.onlineIndicator}><View style={styles.onlineDot} /><Text style={styles.onlineText}>Available now</Text></View>
      </View>
      <View style={styles.map} onLayout={(event) => setMapSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {tileImages.map((tile) => <Image key={tile.key} source={{ uri: tile.uri }} style={{ position: "absolute", width: TILE, height: TILE, left: tile.left, top: tile.top }} resizeMode="stretch" />)}
        </View>
        {providers.map((provider) => {
          const point = worldPoint(provider.latitude, provider.longitude);
          const left = point.x - center.x + mapSize.width / 2;
          const top = point.y - center.y + mapSize.height / 2;
          if (left < -20 || top < -35 || left > mapSize.width + 20 || top > mapSize.height + 20) return null;
          const selected = selectedProviderId === provider.id;
          return <Pressable key={provider.id} accessibilityRole="button" accessibilityLabel={`${provider.skill}, ${provider.distanceKm} kilometres away`} onPress={() => setSelectedProviderId(selected ? null : provider.id)} style={[styles.providerMarker, { left: left - 10, top: top - 10 }]}>
            <View style={[styles.markerDot, selected && styles.markerDotSelected]} />
            <View style={styles.markerLabel}><Text numberOfLines={1} style={styles.markerLabelText}>{provider.skill} · {provider.distanceKm.toFixed(1)} km</Text></View>
          </Pressable>;
        })}
        {selectedProvider ? <View pointerEvents="none" style={styles.providerCallout}>
          <Text style={styles.calloutName}>{selectedProvider.name}</Text>
          <Text style={styles.calloutSkill}>{selectedProvider.skill} · {selectedProvider.distanceKm.toFixed(1)} km away</Text>
        </View> : null}
        {!coordinates ? <View style={styles.mapPrompt}>
          <Text style={styles.mapPromptTitle}>Set your location</Text>
          <Text style={styles.mapPromptText}>Choose your area to see available Providers on the map.</Text>
        </View> : null}
        {coordinates && !loadingProviders && providers.length === 0 ? <View style={styles.mapPrompt}>
          <Text style={styles.mapPromptTitle}>No available Providers yet</Text>
          <Text style={styles.mapPromptText}>Try a wider radius or check again later.</Text>
        </View> : null}
        {loadingProviders ? <View style={styles.mapLoading}><ActivityIndicator color={THEME.blue} /><Text style={styles.mapLoadingText}>Finding nearby Providers…</Text></View> : null}
        <View pointerEvents="none" style={styles.attribution}><Text style={styles.attributionText}>© OpenStreetMap contributors</Text></View>
      </View>
      {providerError ? <Text style={styles.error}>{providerError}</Text> : <Text style={styles.mapFoot}>{coordinates ? `${providers.length} available ${providers.length === 1 ? "Provider" : "Providers"} within ${radiusKm} km` : "Only online and available Providers will appear here."}</Text>}
    </View>

    <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={onSignUp} style={styles.primaryButton}><Text style={styles.primaryText}>Get started</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={onSignIn} style={styles.secondaryButton}><Text style={styles.secondaryText}>Sign in</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={onGoogle} style={styles.googleButton}><Image source={require("../assets/branding/google-sign-in.png")} style={styles.googleIcon} resizeMode="contain" accessibilityLabel="Google" /><Text style={styles.googleText}>Continue with Google</Text></Pressable>
    </View>
    <Text style={styles.footer}>Connecting people through skills and opportunity.</Text>
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  branding: { alignItems: "flex-start", justifyContent: "center", paddingTop: 2, marginBottom: -4 },
  logo: { width: 164, height: 76 },
  intro: { paddingTop: 4, paddingBottom: 3 },
  eyebrow: { color: THEME.blue, fontSize: 10, fontWeight: "900", letterSpacing: 1.5, marginBottom: 9 },
  heading: { color: THEME.navy, fontSize: 31, lineHeight: 37, fontWeight: "900", letterSpacing: -1 },
  subtitle: { color: THEME.muted, fontSize: 14, lineHeight: 21, marginTop: 6 },
  locationCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: THEME.surface, borderColor: THEME.border, borderWidth: 1, borderRadius: 16, padding: 11 },
  locationIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: THEME.softBlue, alignItems: "center", justifyContent: "center" },
  locationIconText: { color: THEME.blue, fontSize: 23, fontWeight: "800" },
  locationCopy: { flex: 1 },
  locationLabel: { color: THEME.muted, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  locationValue: { color: THEME.ink, fontSize: 13, fontWeight: "800", marginTop: 3 },
  locationDetected: { color: THEME.green, fontSize: 10, fontWeight: "900" },
  locationSearchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  locationSearchInput: { flex: 1, minHeight: 43, borderWidth: 1, borderColor: THEME.border, borderRadius: 11, backgroundColor: THEME.surface, paddingHorizontal: 12, color: THEME.navy, fontSize: 12 },
  locationSuggestions: { backgroundColor: THEME.surface, borderColor: THEME.border, borderWidth: 1, borderRadius: 11, overflow: "hidden", marginTop: -5 },
  locationSuggestion: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 11, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: THEME.border },
  suggestionPin: { width: 28, height: 28, borderRadius: 8, backgroundColor: THEME.softBlue, alignItems: "center", justifyContent: "center" },
  suggestionPinText: { color: THEME.blue, fontSize: 18, fontWeight: "800" },
  locationSuggestionText: { flex: 1, color: THEME.navy, fontSize: 11, fontWeight: "700" },
  locationHint: { color: THEME.muted, fontSize: 10, paddingHorizontal: 3 },
  error: { color: THEME.danger, fontSize: 11, lineHeight: 16 },
  radiusHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 2 },
  radiusLabel: { color: THEME.muted, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  radiusValue: { color: THEME.blue, fontSize: 12, fontWeight: "900" },
  radiusDropdown: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, borderRadius: 11, borderWidth: 1, borderColor: THEME.border, backgroundColor: THEME.surface },
  radiusDropdownValue: { color: THEME.navy, fontSize: 13, fontWeight: "800" },
  radiusDropdownChevron: { color: THEME.blue, fontSize: 11, fontWeight: "900" },
  radiusDropdownOptions: { backgroundColor: THEME.surface, borderColor: THEME.border, borderWidth: 1, borderRadius: 11, overflow: "hidden", marginTop: -5 },
  radiusDropdownOption: { minHeight: 38, justifyContent: "center", paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: THEME.border },
  radiusDropdownOptionSelected: { backgroundColor: THEME.softBlue },
  radiusDropdownOptionText: { color: THEME.navy, fontSize: 12, fontWeight: "700" },
  radiusDropdownOptionTextSelected: { color: THEME.blue, fontWeight: "900" },
  mapFrame: { backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.border, borderRadius: 18, padding: 10 },
  mapHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 9 },
  mapTitle: { color: THEME.ink, fontSize: 14, fontWeight: "900" },
  onlineIndicator: { flexDirection: "row", alignItems: "center", gap: 5 },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: THEME.green },
  onlineText: { color: THEME.forest, fontSize: 9, fontWeight: "800" },
  map: { height: 330, borderRadius: 13, overflow: "hidden", backgroundColor: "#EDF2F7" },
  providerMarker: { position: "absolute", flexDirection: "row", alignItems: "center", gap: 4, zIndex: 2, elevation: 4 },
  markerLabel: { maxWidth: 150, backgroundColor: THEME.surface, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 5, shadowColor: "#000000", shadowOpacity: 0.16, shadowRadius: 3, elevation: 3 },
  markerLabelText: { color: THEME.ink, fontSize: 9, fontWeight: "900" },
  markerDot: { width: 17, height: 17, borderRadius: 9, backgroundColor: THEME.green, borderWidth: 2, borderColor: THEME.surface },
  markerDotSelected: { backgroundColor: THEME.blue, width: 20, height: 20, borderRadius: 10 },
  providerCallout: { position: "absolute", top: 10, left: 10, right: 10, backgroundColor: THEME.surface, borderRadius: 12, padding: 10, elevation: 5 },
  calloutName: { color: THEME.ink, fontSize: 12, fontWeight: "900" },
  calloutSkill: { color: THEME.muted, fontSize: 11, marginTop: 3 },
  mapPrompt: { position: "absolute", left: 18, right: 18, top: "37%", backgroundColor: "rgba(255,255,255,0.94)", borderRadius: 14, padding: 15, alignItems: "center" },
  mapPromptTitle: { color: THEME.ink, fontSize: 13, fontWeight: "900" },
  mapPromptText: { color: THEME.muted, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 4 },
  mapLoading: { position: "absolute", left: 10, right: 10, top: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.95)", borderRadius: 10, padding: 9 },
  mapLoadingText: { color: THEME.blue, fontSize: 11, fontWeight: "800" },
  attribution: { position: "absolute", left: 5, bottom: 4, paddingHorizontal: 4, paddingVertical: 2, backgroundColor: "rgba(255,255,255,0.86)", borderRadius: 4 },
  attributionText: { color: THEME.navy, fontSize: 9 },
  mapFoot: { color: THEME.muted, fontSize: 10, marginTop: 7 },
  actions: { gap: 0, marginTop: 2 },
  primaryButton: { minHeight: 49, backgroundColor: THEME.blue, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  primaryText: { color: THEME.surface, fontSize: 13, fontWeight: "900" },
  secondaryButton: { minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: "#D8E5F2", backgroundColor: THEME.surface, alignItems: "center", justifyContent: "center", marginTop: 8 },
  secondaryText: { color: THEME.blue, fontSize: 12, fontWeight: "900" },
  googleButton: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 3, borderWidth: 1, borderColor: THEME.border, borderRadius: 12, backgroundColor: THEME.surface },
  googleIcon: { width: 20, height: 20 },
  googleText: { color: THEME.navy, fontSize: 12, fontWeight: "800" },
  footer: { color: THEME.muted, fontSize: 10, textAlign: "center", marginTop: 4, marginBottom: 8 },
});
