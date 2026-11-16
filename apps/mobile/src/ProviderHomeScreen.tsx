import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
  ink: "#0B2545", muted: "#64748B", primary: "#0066CC",
  border: "#E2E8F0", bg: "#F5F7FA", white: "#FFFFFF",
};

export function ProviderHomeScreen({ onManageProfile }: Props) {
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [requestCount, setRequestCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [locationStatus, setLocationStatus] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [providerProfile, onboarding, incoming] = await Promise.all([
        apiRequest<ProviderProfile | null>("/marketplace/provider-profile", {}, true),
        apiRequest<{ skills?: Array<{ category?: string }> }>("/profile/onboarding", {}, true),
        apiRequest<{ items?: unknown[] }>("/marketplace/incoming-requests", {}, true),
      ]);
      setProfile(providerProfile);
      setSkills((onboarding.skills ?? []).map((item) => item.category?.trim() ?? "").filter(Boolean));
      setRequestCount(incoming.items?.length ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your Provider workspace.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Provider Home owns availability, so it must also maintain the fresh GPS
  // heartbeat required by on-site discovery. Previously this only ran inside
  // MarketplaceScreen, meaning an online Provider on Home had no live location.
  useEffect(() => {
    const supportsOnsite = profile?.deliveryModes.some((mode) => mode === "ONSITE" || mode === "EITHER") ?? false;
    if (!profile?.isAvailable || !supportsOnsite) {
      setLocationStatus("");
      return;
    }

    let active = true;
    let subscription: Location.LocationSubscription | null = null;
    const sendLocation = async (coords: Location.LocationObjectCoords) => {
      if (!active) return;
      if (coords.accuracy == null || coords.accuracy > 250) {
        setLocationStatus("Waiting for a more accurate GPS signal for on-site matching.");
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
        if (active) setLocationStatus("Your live location is shared for on-site matching.");
      } catch (e) {
        if (active) setLocationStatus(e instanceof Error ? e.message : "Live location update failed.");
      }
    };

    void (async () => {
      try {
        setLocationStatus("Requesting location permission for on-site matching...");
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          setLocationStatus("Location permission is disabled. Allow location access while using AnySkill to appear in on-site matches.");
          return;
        }
        const initial = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        await sendLocation(initial.coords);
        if (!active) return;
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 15000, distanceInterval: 50 },
          (position) => { void sendLocation(position.coords); },
        );
      } catch (e) {
        if (active) setLocationStatus(e instanceof Error ? e.message : "Could not start live location.");
      }
    })();

    return () => {
      active = false;
      subscription?.remove();
    };
  }, [profile?.isAvailable, profile?.deliveryModes]);

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
      // Keep the API error visible. Calling refresh() here clears the error
      // immediately and makes a failed availability update look like no action.
      setError(e instanceof Error ? e.message : "Could not update your availability.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.welcome}>
        <Text style={styles.eyebrow}>PROVIDER WORKSPACE</Text>
        <Text style={styles.title}>Your skills. Your opportunities.</Text>
        <Text style={styles.subtitle}>Choose when you're ready to receive service requests.</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.sectionLabel}>YOUR AVAILABILITY</Text>
          <View style={[styles.badge, profile?.isAvailable ? styles.onlineBadge : styles.offlineBadge]}>
            <Text style={[styles.badgeText, profile?.isAvailable ? styles.onlineText : styles.offlineText]}>
              {profile?.isAvailable ? "ONLINE" : "OFFLINE"}
            </Text>
          </View>
        </View>
        <View style={[styles.statusPanel, profile?.isAvailable ? styles.onlinePanel : styles.offlinePanel]}>
          <Text style={styles.statusTitle}>{profile?.isAvailable ? "You're online" : "Ready to get work?"}</Text>
          <Text style={styles.statusCopy}>
            {profile?.isAvailable
              ? "Your registered skills are available for matching. You can switch offline whenever you need."
              : "Go online when you're ready. Seekers can then find your eligible skills and send you service requests."}
          </Text>
        </View>
        {loading ? <ActivityIndicator color={C.primary} /> : profile && Number(profile.hourlyRate) >= 1 ? (
          <Pressable accessibilityRole="button" disabled={saving} onPress={() => void setAvailability(!profile.isAvailable)}
            style={[styles.primaryButton, saving && styles.disabled]}>
            <Text style={styles.primaryButtonText}>{saving ? "Updating..." : profile.isAvailable ? "Go Offline" : "Go Online"}</Text>
          </Pressable>
        ) : (
          <>
            <Text style={styles.helper}>
              {!profile
                ? "Set up your Provider service profile before you can receive requests."
                : "Add a valid hourly rate (at least R1.00) before going online."}
            </Text>
            <Pressable accessibilityRole="button" onPress={onManageProfile} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{profile ? "Complete service profile" : "Complete Provider setup"}</Text>
            </Pressable>
          </>
        )}
        {!!locationStatus && <Text accessibilityRole="alert" style={styles.locationStatus}>{locationStatus}</Text>}
        <Text style={styles.footnote}>You control when you are available. Going offline stops new matching; it does not remove your skills.</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.cardTitle}>Your skills</Text>
          <Pressable onPress={onManageProfile}><Text style={styles.link}>Manage skills</Text></Pressable>
        </View>
        {loading ? <ActivityIndicator color={C.primary} /> : skills.length ? skills.map((skill, index) => (
          <View key={skill + index} style={styles.skillRow}>
            <Text style={styles.skillName}>{skill}</Text>
            <Text style={styles.registered}>Registered</Text>
          </View>
        )) : <Text style={styles.helper}>Add skills to your Provider profile to start receiving relevant requests.</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Service requests</Text>
        <Text style={styles.requestCount}>{loading ? "—" : requestCount}</Text>
        <Text style={styles.helper}>Incoming requests matched to your registered skills.</Text>
        <Pressable onPress={onManageProfile} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Open Provider workspace</Text>
        </Pressable>
      </View>

      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Pressable onPress={() => void refresh()} style={styles.refresh}><Text style={styles.link}>Refresh Provider home</Text></Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 32, gap: 14 },
  welcome: { paddingTop: 8, paddingBottom: 4, gap: 7 },
  eyebrow: { color: C.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  title: { color: C.ink, fontSize: 25, lineHeight: 31, fontWeight: "900", letterSpacing: -0.6 },
  subtitle: { color: C.muted, fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 20, padding: 17, gap: 13 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  sectionLabel: { color: C.muted, fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  badge: { borderRadius: 20, paddingHorizontal: 11, paddingVertical: 6 },
  onlineBadge: { backgroundColor: "#E7F6EC" }, offlineBadge: { backgroundColor: "#FFF4E5" },
  badgeText: { fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  onlineText: { color: "#247044" }, offlineText: { color: "#96621C" },
  statusPanel: { borderRadius: 15, padding: 16, gap: 7 },
  onlinePanel: { backgroundColor: "#EAF6EE" }, offlinePanel: { backgroundColor: "#FFF5E8" },
  statusTitle: { color: C.ink, fontSize: 20, fontWeight: "900" },
  statusCopy: { color: "#475569", fontSize: 12, lineHeight: 18 },
  primaryButton: { minHeight: 54, borderRadius: 14, backgroundColor: C.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  disabled: { opacity: 0.55 },
  footnote: { color: C.muted, fontSize: 10, lineHeight: 15, textAlign: "center" },
  locationStatus: { color: C.muted, fontSize: 11, lineHeight: 16, textAlign: "center" },
  cardTitle: { color: C.ink, fontSize: 16, fontWeight: "900" },
  link: { color: C.primary, fontSize: 12, fontWeight: "800" },
  skillRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 11, borderTopWidth: 1, borderTopColor: "#EEF2F6" },
  skillName: { color: C.ink, fontSize: 13, fontWeight: "700" },
  registered: { color: "#247044", fontSize: 10, fontWeight: "800" },
  helper: { color: C.muted, fontSize: 12, lineHeight: 18 },
  requestCount: { color: C.ink, fontSize: 30, fontWeight: "900" },
  secondaryButton: { borderWidth: 1, borderColor: C.border, borderRadius: 12, minHeight: 46, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: C.ink, fontSize: 12, fontWeight: "800" },
  error: { color: "#A12D2D", fontSize: 12, fontWeight: "700" },
  refresh: { alignItems: "center", padding: 10 },
});
