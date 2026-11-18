import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";
import { apiRequest } from "./api";

type ProviderProfile = {
  publicName: string;
  hourlyRate: string | number | null;
  assessmentFee: string | number;
  skillCategories: string[];
  serviceAreas: string[];
  deliveryModes: string[];
  isAvailable: boolean;
  maxTravelDistanceKm: number;
};

type Props = { onManageProfile: () => void };

const C = {
  ink: "#15251E",
  muted: "#718078",
  primary: "#176B55",
  border: "#E5EBE7",
  background: "#FFFFFF",
  soft: "#F1F7F3",
  online: "#16845F",
  onlineSoft: "#E8F5EE",
  offline: "#78847D",
  offlineSoft: "#EFF2F0",
  danger: "#A12D2D",
};

export function ProviderHomeScreen({ onManageProfile }: Props) {
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [onboardingSkills, setOnboardingSkills] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [locationStatus, setLocationStatus] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [providerProfile, onboarding] = await Promise.all([
        apiRequest<ProviderProfile | null>("/marketplace/provider-profile", {}, true),
        apiRequest<{ skills?: Array<{ category?: string }> }>("/profile/onboarding", {}, true),
      ]);
      setProfile(providerProfile);
      setOnboardingSkills((onboarding.skills ?? [])
        .map((item) => item.category?.trim() ?? "")
        .filter(Boolean));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your Provider profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Keep the live map location updated while the Provider is online.
  useEffect(() => {
    if (!profile?.isAvailable) {
      setLocationStatus("");
      return;
    }

    let active = true;
    let subscription: Location.LocationSubscription | null = null;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let latestCoords: Location.LocationObjectCoords | null = null;

    const sendLocation = async (coords: Location.LocationObjectCoords) => {
      latestCoords = coords;
      if (!active) return;
      if (coords.accuracy == null || coords.accuracy > 250) {
        setLocationStatus("Waiting for a more accurate GPS signal.");
        return;
      }
      try {
        await apiRequest("/marketplace/provider-location/live", {
          method: "POST",
          body: JSON.stringify({
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracyM: coords.accuracy,
          }),
        }, true);
        if (active) setLocationStatus("Your location is shared while you are online.");
      } catch (e) {
        if (active) setLocationStatus(e instanceof Error ? e.message : "Live location update failed.");
      }
    };

    void (async () => {
      try {
        setLocationStatus("Requesting location permission...");
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          setLocationStatus("Allow location access while using AnySkill to appear on the Provider map.");
          return;
        }
        const initial = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        await sendLocation(initial.coords);
        if (!active) return;
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
          (position) => { void sendLocation(position.coords); },
        );
        // Keep a heartbeat flowing even when the provider is stationary.
        heartbeat = setInterval(() => {
          if (active && latestCoords) void sendLocation(latestCoords);
        }, 10_000);
      } catch (e) {
        if (active) setLocationStatus(e instanceof Error ? e.message : "Could not start live location.");
      }
    })();

    return () => {
      active = false;
      if (heartbeat) clearInterval(heartbeat);
      subscription?.remove();
    };
  }, [profile?.isAvailable]);

  const setAvailability = async (next: boolean) => {
    if (!profile || saving) return;
    setSaving(true);
    setError("");
    try {
      const updated = await apiRequest<ProviderProfile>("/marketplace/provider-profile", {
        method: "POST",
        body: JSON.stringify({
          publicName: profile.publicName,
          hourlyRate: Number(profile.hourlyRate),
          assessmentFee: Number(profile.assessmentFee),
          skillCategories: profile.skillCategories,
          serviceAreas: profile.serviceAreas,
          deliveryModes: profile.deliveryModes,
          isAvailable: next,
          maxTravelDistanceKm: profile.maxTravelDistanceKm,
        }),
      }, true);
      setProfile(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update your availability.");
    } finally {
      setSaving(false);
    }
  };

  const activeSkills = profile?.skillCategories?.length
    ? profile.skillCategories
    : onboardingSkills;
  const canToggle = Boolean(profile && Number(profile.hourlyRate) >= 1);
  const isOnline = Boolean(profile?.isAvailable);

  return (
    <View style={styles.root}>
      <View style={styles.intro}>
        <Text style={styles.eyebrow}>PROVIDER HOME</Text>
        <Text style={styles.title}>{isOnline ? "You're online" : "You're offline"}</Text>
        <Text style={styles.subtitle}>
          {isOnline
            ? "You’re visible to nearby customers and ready to receive service requests."
            : "Go online when you're ready to receive service requests from nearby customers."}
        </Text>
      </View>

      <View style={styles.availability}>
        <View style={styles.availabilityHeader}>
          <Text style={styles.availabilityTitle}>Your availability</Text>
          <View style={[styles.statusPill, isOnline ? styles.onlinePill : styles.offlinePill]}>
            <View style={[styles.statusDot, isOnline ? styles.onlineDot : styles.offlineDot]} />
            <Text style={[styles.statusText, isOnline ? styles.onlineText : styles.offlineText]}>
              {isOnline ? "ONLINE" : "OFFLINE"}
            </Text>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator color={C.primary} style={styles.loader} />
        ) : canToggle ? (
          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text style={styles.switchTitle}>
                {saving ? "Updating availability..." : isOnline ? "Go offline" : "Go online"}
              </Text>
              <Text style={styles.switchHint}>
                {isOnline ? "You can stop receiving new requests" : "Start receiving service requests"}
              </Text>
            </View>
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel="Provider availability"
              accessibilityState={{ checked: isOnline, disabled: saving }}
              disabled={saving}
              onPress={() => { void setAvailability(!isOnline); }}
              style={[styles.toggleTrack, isOnline && styles.toggleTrackOn, saving && styles.toggleDisabled]}
            >
              <View style={[styles.toggleThumb, isOnline && styles.toggleThumbOn]}>
                {saving ? <ActivityIndicator size="small" color={C.primary} /> : null}
              </View>
            </Pressable>
          </View>
        ) : (
          <View style={styles.setup}>
            <Text style={styles.setupText}>
              {!profile
                ? "Complete your Provider service profile before going online."
                : "Add a valid hourly rate (at least R1.00) before going online."}
            </Text>
            <Pressable accessibilityRole="button" onPress={onManageProfile} style={styles.setupLink}>
              <Text style={styles.setupLinkText}>Complete service profile</Text>
              <Text style={styles.setupArrow}>›</Text>
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.skillsSection}>
        <View>
          <Text style={styles.sectionTitle}>Your skills</Text>
          <Text style={styles.sectionSubtitle}>Skills currently active on your profile</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={C.primary} style={styles.skillsLoader} />
        ) : activeSkills.length ? (
          <View style={styles.skillList}>
            {activeSkills.map((skill, index) => (
              <View key={skill + index} style={styles.skillRow}>
                <View style={styles.skillIcon}>
                  <Text style={styles.skillInitial}>{skill.trim().charAt(0).toUpperCase()}</Text>
                </View>
                <Text style={styles.skillName}>{skill}</Text>
                <Text style={styles.activeLabel}>ACTIVE</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.emptySkills}>
            Add skills to your Provider profile to start receiving relevant requests.
          </Text>
        )}
        {activeSkills.length > 4 ? (
          <Text style={styles.swipeHint}>Scroll to see more skills ↓</Text>
        ) : null}
      </View>

      <View style={styles.serviceArea}>
        <View style={styles.locationIcon}>
          <Text style={styles.locationGlyph}>⌖</Text>
        </View>
        <View style={styles.locationCopy}>
          <Text style={styles.locationTitle}>Your service area</Text>
          <Text style={styles.locationSubtitle}>
            {isOnline
              ? locationStatus || "Updating your location while you're online"
              : "Location sharing is paused while offline"}
          </Text>
        </View>
      </View>

      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Pressable accessibilityRole="button" onPress={() => { void refresh(); }} style={styles.refresh}>
        <Text style={styles.refreshText}>Refresh</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: "100%",
    backgroundColor: C.background,
    paddingTop: 16,
    paddingBottom: 24,
  },
  intro: {
    paddingHorizontal: 3,
    paddingTop: 4,
    paddingBottom: 22,
  },
  eyebrow: {
    color: C.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  title: {
    color: C.ink,
    fontSize: 36,
    lineHeight: 42,
    fontWeight: "800",
    letterSpacing: -1.5,
    marginTop: 9,
  },
  subtitle: {
    color: C.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 7,
    maxWidth: 330,
  },
  availability: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    backgroundColor: "#FBFCFB",
    paddingHorizontal: 17,
    paddingVertical: 17,
  },
  availabilityHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  availabilityTitle: {
    color: C.ink,
    fontSize: 14,
    fontWeight: "700",
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 20,
  },
  onlinePill: { backgroundColor: C.onlineSoft },
  offlinePill: { backgroundColor: C.offlineSoft },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  onlineDot: { backgroundColor: C.online },
  offlineDot: { backgroundColor: C.offline },
  statusText: { fontSize: 9, fontWeight: "900", letterSpacing: 0.7 },
  onlineText: { color: C.online },
  offlineText: { color: C.offline },
  switchRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
  },
  switchCopy: { flex: 1, gap: 4 },
  switchTitle: { color: C.ink, fontSize: 15, fontWeight: "700" },
  switchHint: { color: C.muted, fontSize: 11, lineHeight: 16 },
  toggleTrack: {
    width: 66,
    height: 38,
    borderRadius: 22,
    backgroundColor: "#C8D0CB",
    padding: 4,
    justifyContent: "center",
  },
  toggleTrackOn: { backgroundColor: C.online },
  toggleDisabled: { opacity: 0.65 },
  toggleThumb: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  toggleThumbOn: { alignSelf: "flex-end" },
  loader: { paddingVertical: 14 },
  setup: { gap: 12 },
  setupText: { color: C.muted, fontSize: 12, lineHeight: 18 },
  setupLink: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  setupLinkText: { color: C.primary, fontSize: 12, fontWeight: "800" },
  setupArrow: { color: C.primary, fontSize: 23 },
  skillsSection: { marginTop: 31 },
  sectionTitle: { color: C.ink, fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },
  sectionSubtitle: { color: C.muted, fontSize: 11, marginTop: 4 },
  skillsLoader: { marginTop: 18 },
  skillList: { marginTop: 10 },
  skillRow: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#EDF1EE",
  },
  skillIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: C.soft,
    alignItems: "center",
    justifyContent: "center",
  },
  skillInitial: { color: C.primary, fontSize: 15, fontWeight: "800" },
  skillName: { flex: 1, color: C.ink, fontSize: 13, fontWeight: "600" },
  activeLabel: { color: C.online, fontSize: 9, fontWeight: "900", letterSpacing: 0.7 },
  emptySkills: { color: C.muted, fontSize: 12, lineHeight: 18, marginTop: 14 },
  swipeHint: { color: C.muted, fontSize: 10, marginTop: 11, textAlign: "center" },
  serviceArea: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
    marginTop: 25,
    paddingTop: 18,
  },
  locationIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.soft,
    alignItems: "center",
    justifyContent: "center",
  },
  locationGlyph: { color: C.primary, fontSize: 21 },
  locationCopy: { flex: 1, gap: 4 },
  locationTitle: { color: C.ink, fontSize: 12, fontWeight: "700" },
  locationSubtitle: { color: C.muted, fontSize: 10, lineHeight: 15 },
  error: { color: C.danger, fontSize: 12, lineHeight: 18, marginTop: 15 },
  refresh: { alignSelf: "center", paddingVertical: 15, paddingHorizontal: 18 },
  refreshText: { color: C.primary, fontSize: 11, fontWeight: "700" },
});
