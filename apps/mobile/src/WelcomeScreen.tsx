import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import WelcomeMap from "./WelcomeMap";
import * as Location from "expo-location";
import * as Crypto from "expo-crypto";
import { apiRequest } from "./api";

type LocationSuggestion = { placeId: string; label: string };

type ProviderPin = {
  id: string;
  skill: string;
  distanceKm: number;
  latitude: number;
  longitude: number;
};

type Props = {
  onSignIn: () => void;
  onSignUp: () => void;
  onGoogle: () => void;
  showAuthActions?: boolean;
  onRequestSkill?: () => void;
  canRequestSkill?: boolean;
  profileComplete?: boolean;
  accountPendingReview?: boolean;
  onSelectRole?: (role: "provider" | "seeker") => void;
};

const DEFAULT_CENTER = { latitude: -26.2041, longitude: 28.0473 };

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

export function WelcomeScreen({ onSignIn, onSignUp, showAuthActions = true, onRequestSkill, canRequestSkill = false, profileComplete = false, accountPendingReview = false, onSelectRole }: Props) {
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [areaLabel, setAreaLabel] = useState("Detecting your location…");
  const [manualLocation, setManualLocation] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [placesSessionToken, setPlacesSessionToken] = useState(() => Crypto.randomUUID());
  const [searchingLocation, setSearchingLocation] = useState(false);
  const [providers, setProviders] = useState<ProviderPin[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [radiusKm, setRadiusKm] = useState<number>(10);
  const [locating, setLocating] = useState(false);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [providerError, setProviderError] = useState("");

  const mapCenter = coordinates ?? DEFAULT_CENTER;
  const mapZoom = Math.max(5, Math.min(14, 12 - Math.log2(radiusKm / 10)));

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
      const position = await Location.getCurrentPositionAsync({
        accuracy: Platform.OS === "web" ? Location.Accuracy.High : Location.Accuracy.Balanced,
      });
      const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setCoordinates(next);
      setAreaLabel("Your current area");
      try {
        const query = new URLSearchParams({ latitude: String(next.latitude), longitude: String(next.longitude) });
        const result = await apiRequest<{ label: string | null }>(`/marketplace/places/reverse-geocode?${query.toString()}`);
        if (result.label) setAreaLabel(result.label);
      } catch {
        // GPS coordinates remain usable if Google reverse geocoding is unavailable.
      }
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "Could not determine your location. Please try again.");
    } finally {
      setLocating(false);
    }
  };

  // Search Google Places API (New) through the AnySkill API. The Google key stays server-side.
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
        const params = new URLSearchParams({ input: query, sessionToken: placesSessionToken });
        if (coordinates) {
          params.set("latitude", String(coordinates.latitude));
          params.set("longitude", String(coordinates.longitude));
        }
        const result = await apiRequest<{ suggestions: LocationSuggestion[] }>(
          `/marketplace/places/autocomplete?${params.toString()}`,
        );
        if (active) setLocationSuggestions(result.suggestions ?? []);
      } catch {
        if (active) {
          setLocationSuggestions([]);
          setLocationError("Location search is temporarily unavailable. Please try again.");
        }
      } finally {
        if (active) setSearchingLocation(false);
      }
    }, 350);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [manualLocation, placesSessionToken, coordinates]);

  const selectLocation = async (suggestion: LocationSuggestion) => {
    setSearchingLocation(true);
    setLocationError("");
    try {
      const params = new URLSearchParams({ sessionToken: placesSessionToken });
      const place = await apiRequest<{
        placeId: string;
        label: string;
        latitude: number;
        longitude: number;
      }>(`/marketplace/places/details/${encodeURIComponent(suggestion.placeId)}?${params.toString()}`);
      setCoordinates({ latitude: place.latitude, longitude: place.longitude });
      setAreaLabel(place.label || suggestion.label);
      setManualLocation("");
      setLocationSuggestions([]);
      // A Place Details request ends the current Google autocomplete session.
      setPlacesSessionToken(Crypto.randomUUID());
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "Could not load the selected location.");
    } finally {
      setSearchingLocation(false);
    }
  };

  // Detect the device location automatically when the welcome screen opens.
  useEffect(() => {
    void chooseLocation();
    // Run once on mount; manual search remains available to correct the detected area.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleProviders = providers;
  const selectedProvider = visibleProviders.find((provider) => provider.id === selectedProviderId);
  const mapMarkers = useMemo(() => visibleProviders.map((provider) => ({
    id: provider.id,
    coordinates: { latitude: provider.latitude, longitude: provider.longitude },
    title: provider.skill,
    snippet: `${provider.distanceKm.toFixed(1)} km away`,
  })), [visibleProviders]);

  return <View style={styles.container}>
    <Text style={styles.heading}>Find help nearby.</Text>
    <View style={styles.locationSearchRow}><Text style={styles.locationSearchIcon}>⌕</Text>
      <TextInput
        accessibilityLabel="Search for a location"
        value={manualLocation}
        onChangeText={(value) => {
          if (!value.trim() && manualLocation.trim()) setPlacesSessionToken(Crypto.randomUUID());
          setManualLocation(value);
        }}
        placeholder="Search suburb, city or address"
        placeholderTextColor={THEME.muted}
        style={styles.locationSearchInput}
      />
      {searchingLocation || locating ? <ActivityIndicator color={THEME.blue} size="small" /> : null}
      <Text style={styles.locationSearchPin}>⌖</Text>
    </View>
    {locationSuggestions.length > 0 ? <View style={styles.locationSuggestions}>
      {locationSuggestions.map((suggestion, index) => <Pressable
        key={suggestion.placeId || String(index)}
        accessibilityRole="button"
        onPress={() => selectLocation(suggestion)}
        style={styles.locationSuggestion}
      >
        <View style={styles.suggestionPin}><Text style={styles.suggestionPinText}>⌖</Text></View>
        <Text numberOfLines={2} style={styles.locationSuggestionText}>{suggestion.label}</Text>
      </Pressable>)}
    </View> : manualLocation.trim().length >= 3 && !searchingLocation ? <Text style={styles.locationHint}>No matching places found. Try a different spelling.</Text> : null}
    {locationError ? <Text style={styles.error}>{locationError}</Text> : null}

    <View style={styles.mapFrame}>
      <View style={styles.mapHeader}>
        <Text style={styles.mapTitle}>Online Providers & your location</Text>
        <Text numberOfLines={1} style={styles.mapAreaLabel}>{areaLabel}</Text>
      </View>
      <View style={styles.map}>
        <WelcomeMap
          center={mapCenter}
          zoom={mapZoom}
          radiusKm={radiusKm}
          seekerLocation={coordinates}
          markers={mapMarkers}
          selectedMarkerId={selectedProviderId}
          onSelectMarker={setSelectedProviderId}
        />
        {selectedProvider ? <View pointerEvents="none" style={styles.providerCallout}>
          <Text style={styles.calloutSkill}>{selectedProvider.skill} · {selectedProvider.distanceKm.toFixed(1)} km away</Text>
        </View> : null}
        {!coordinates ? <View style={styles.mapPrompt}>
          <Text style={styles.mapPromptTitle}>Set your location</Text>
          <Text style={styles.mapPromptText}>Choose your location to see online Providers within their own service radius.</Text>
        </View> : null}
        {coordinates && !loadingProviders && visibleProviders.length === 0 ? <View style={styles.mapPrompt}>
          <Text style={styles.mapPromptTitle}>No available Providers yet</Text>
          <Text style={styles.mapPromptText}>Online Providers within their own service radius will appear here.</Text>
        </View> : null}
        {loadingProviders ? <View style={styles.mapLoading}><ActivityIndicator color={THEME.blue} /><Text style={styles.mapLoadingText}>Finding nearby Providers…</Text></View> : null}
      </View>
      {providerError ? <Text style={styles.error}>{providerError}</Text> : <Text style={styles.mapFoot}>{coordinates ? `${visibleProviders.length} online ${visibleProviders.length === 1 ? "Provider" : "Providers"} within ${radiusKm} km and their own travel radius` : "Your location and online Provider locations appear here."}</Text>}
    </View>
    <View style={styles.radiusSection}>
      <Text style={styles.radiusTitle}>Show Providers within</Text>
      <View style={styles.radiusOptions}>
        {[5, 10, 20, 50].map((radius) => (
          <Pressable
            key={radius}
            accessibilityRole="button"
            accessibilityState={{ selected: radiusKm === radius }}
            onPress={() => setRadiusKm(radius)}
            style={[styles.radiusOption, radiusKm === radius && styles.radiusOptionSelected]}
          >
            <Text style={[styles.radiusOptionText, radiusKm === radius && styles.radiusOptionTextSelected]}>{radius} km</Text>
          </Pressable>
        ))}
      </View>
    </View>


    {!showAuthActions ? <>
      {!profileComplete ? <Pressable accessibilityRole="button" onPress={onRequestSkill} style={styles.requestSkillButton}>
        <View style={styles.incompleteProfileDot} />
        <View style={styles.requestSkillCopy}>
          <Text style={styles.requestSkillTitle}>Complete your profile</Text>
          <Text style={styles.requestSkillSubtitle}>Complete your profile to get started on AnySkill.</Text>
        </View>
        <Text style={styles.requestSkillArrow}>›</Text>
      </Pressable> : accountPendingReview ? <View accessibilityRole="text" style={styles.pendingReview}>
        <View style={styles.pendingReviewDot} />
        <Text style={styles.pendingReviewText}>Account Pending Review</Text>
      </View> : canRequestSkill ? <Pressable accessibilityRole="button" onPress={onRequestSkill} style={styles.requestSkillButton}>
        <Text style={styles.requestSkillIcon}>＋</Text>
        <View style={styles.requestSkillCopy}>
          <Text style={styles.requestSkillTitle}>Request a Skill</Text>
          <Text style={styles.requestSkillSubtitle}>Tell us what you need help with</Text>
        </View>
        <Text style={styles.requestSkillArrow}>›</Text>
      </Pressable> : null}
    </> : null}

    {showAuthActions ? <>
      <View style={styles.roleActions}>
        <Pressable accessibilityRole="button" onPress={() => onSelectRole ? onSelectRole("provider") : onSignUp()} style={styles.roleButton}><Text style={styles.roleIcon}>🧰</Text><Text style={styles.roleButtonText}>I'm a Skill Provider</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => onSelectRole ? onSelectRole("seeker") : onSignUp()} style={styles.roleButton}><Text style={styles.roleIcon}>⌕</Text><Text style={styles.roleButtonText}>I'm a Skill Seeker</Text></Pressable>
      </View>
      <Text style={styles.footer}>Connecting people through skills and opportunity.</Text>
      <View style={styles.signInRow}><Text style={styles.signInPrompt}>Already have an account?</Text><Text onPress={onSignIn} style={styles.signInLink}> Sign in</Text></View>
    </> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  compactHeader: { flexDirection: "row", alignItems: "center", gap: 7, paddingTop: 2 },
  brandMark: { width: 29, height: 29, borderRadius: 8, backgroundColor: THEME.forest, alignItems: "center", justifyContent: "center" },
  brandMarkText: { color: THEME.surface, fontSize: 17, fontWeight: "900" },
  brandName: { color: THEME.navy, fontSize: 15, fontWeight: "900" },
  headerSpacer: { flex: 1 },
  requestSkillButton: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 15, paddingVertical: 12, backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.blue, borderRadius: 15 },
  requestSkillIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: THEME.softBlue, color: THEME.blue, textAlign: "center", textAlignVertical: "center", fontSize: 23, fontWeight: "800", overflow: "hidden" },
  incompleteProfileDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#DC2626" },
  requestSkillCopy: { flex: 1, gap: 3 },
  requestSkillTitle: { color: THEME.navy, fontSize: 13, fontWeight: "900" },
  requestSkillSubtitle: { color: THEME.muted, fontSize: 10, lineHeight: 14 },
  requestSkillArrow: { color: THEME.blue, fontSize: 25, fontWeight: "700" },
  pendingReview: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 5 },
  pendingReviewDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#D69E24" },
  pendingReviewText: { color: THEME.muted, fontSize: 11, fontWeight: "800" },

  eyebrow: { color: THEME.blue, fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  heading: { color: THEME.navy, fontSize: 23, lineHeight: 28, fontWeight: "900", letterSpacing: -0.5 },
  locationCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: THEME.surface, borderColor: THEME.border, borderWidth: 1, borderRadius: 16, padding: 11 },
  locationIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: THEME.softBlue, alignItems: "center", justifyContent: "center" },
  locationIconText: { color: THEME.blue, fontSize: 23, fontWeight: "800" },
  locationCopy: { flex: 1 },
  locationLabel: { color: THEME.muted, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  locationValue: { color: THEME.ink, fontSize: 13, fontWeight: "800", marginTop: 3 },
  locationDetected: { color: THEME.green, fontSize: 10, fontWeight: "900" },
  locationSearchRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40, borderWidth: 1, borderColor: THEME.border, borderRadius: 11, backgroundColor: THEME.surface, paddingHorizontal: 10 },
  locationSearchIcon: { color: THEME.navy, fontSize: 20 },
  locationSearchPin: { color: THEME.muted, fontSize: 16 },
  locationSearchInput: { flex: 1, minHeight: 38, paddingHorizontal: 0, color: THEME.navy, fontSize: 12 },
  locationSuggestions: { backgroundColor: THEME.surface, borderColor: THEME.border, borderWidth: 1, borderRadius: 11, overflow: "hidden", marginTop: -5 },
  locationSuggestion: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 11, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: THEME.border },
  suggestionPin: { width: 28, height: 28, borderRadius: 8, backgroundColor: THEME.softBlue, alignItems: "center", justifyContent: "center" },
  suggestionPinText: { color: THEME.blue, fontSize: 18, fontWeight: "800" },
  locationSuggestionText: { flex: 1, color: THEME.navy, fontSize: 11, fontWeight: "700" },
  locationHint: { color: THEME.muted, fontSize: 10, paddingHorizontal: 3 },
  error: { color: THEME.danger, fontSize: 11, lineHeight: 16 },
  mapFrame: { backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.border, borderRadius: 15, padding: 7 },
  mapHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 6, marginBottom: 6 },
  mapTitle: { color: THEME.ink, fontSize: 12, fontWeight: "900" },
  mapAreaLabel: { color: THEME.muted, fontSize: 9, flexShrink: 1 },
  onlineIndicator: { flexDirection: "row", alignItems: "center", gap: 5 },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: THEME.green },
  onlineText: { color: THEME.forest, fontSize: 9, fontWeight: "800" },
  map: { width: "100%", aspectRatio: 1, borderRadius: 11, overflow: "hidden", backgroundColor: "#EDF2F7" },
  providerMarker: { position: "absolute", flexDirection: "row", alignItems: "center", gap: 4, zIndex: 2, elevation: 4 },
  markerLabel: { maxWidth: 150, backgroundColor: THEME.surface, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 5, shadowColor: "#000000", shadowOpacity: 0.16, shadowRadius: 3, elevation: 3 },
  markerLabelText: { color: THEME.ink, fontSize: 9, fontWeight: "900" },
  markerDot: { width: 17, height: 17, borderRadius: 9, backgroundColor: THEME.green, borderWidth: 2, borderColor: THEME.surface },
  markerDotSelected: { backgroundColor: THEME.blue, width: 20, height: 20, borderRadius: 10 },
  providerCallout: { position: "absolute", top: 10, left: 10, right: 10, backgroundColor: THEME.surface, borderRadius: 12, padding: 10, elevation: 5 },
  calloutSkill: { color: THEME.muted, fontSize: 11, marginTop: 3 },
  mapPrompt: { position: "absolute", left: 18, right: 18, top: "37%", backgroundColor: "rgba(255,255,255,0.94)", borderRadius: 14, padding: 15, alignItems: "center" },
  mapPromptTitle: { color: THEME.ink, fontSize: 13, fontWeight: "900" },
  mapPromptText: { color: THEME.muted, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 4 },
  mapLoading: { position: "absolute", left: 10, right: 10, top: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.95)", borderRadius: 10, padding: 9 },
  mapLoadingText: { color: THEME.blue, fontSize: 11, fontWeight: "800" },
  mapFoot: { color: THEME.muted, fontSize: 10, marginTop: 7 },
  radiusSection: { gap: 7, paddingHorizontal: 2 },
  radiusTitle: { color: THEME.muted, fontSize: 10, fontWeight: "800" },
  radiusOptions: { flexDirection: "row", gap: 7 },
  radiusOption: { flex: 1, minHeight: 36, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: THEME.border, borderRadius: 10, backgroundColor: THEME.surface },
  radiusOptionSelected: { borderColor: THEME.blue, backgroundColor: THEME.softBlue },
  radiusOptionText: { color: THEME.muted, fontSize: 11, fontWeight: "800" },
  radiusOptionTextSelected: { color: THEME.blue },
  roleActions: { flexDirection: "row", gap: 8, marginTop: 1 },
  roleButton: { flex: 1, minHeight: 43, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: THEME.border, backgroundColor: THEME.surface, borderRadius: 11, paddingHorizontal: 5 },
  roleIcon: { color: THEME.forest, fontSize: 16 },
  roleButtonText: { color: THEME.navy, fontSize: 10, fontWeight: "800", flexShrink: 1 },
  signInRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: -3 },
  signInPrompt: { color: THEME.muted, fontSize: 10 },
  signInLink: { color: THEME.blue, fontSize: 10, fontWeight: "900" },
  primaryButton: { minHeight: 49, backgroundColor: THEME.blue, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  primaryText: { color: THEME.surface, fontSize: 13, fontWeight: "900" },
  secondaryButton: { minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: "#D8E5F2", backgroundColor: THEME.surface, alignItems: "center", justifyContent: "center", marginTop: 8 },
  secondaryText: { color: THEME.blue, fontSize: 12, fontWeight: "900" },
  googleButton: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 3, borderWidth: 1, borderColor: THEME.border, borderRadius: 12, backgroundColor: THEME.surface },
  googleIcon: { width: 20, height: 20 },
  googleText: { color: THEME.navy, fontSize: 12, fontWeight: "800" },
  footer: { color: THEME.muted, fontSize: 10, textAlign: "center", marginTop: 4, marginBottom: 8 },
});
