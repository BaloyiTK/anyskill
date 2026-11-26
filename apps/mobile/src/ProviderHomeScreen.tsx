import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { apiRequest } from "./api";
import { getInitialProviderLocation, startProviderLocationUpdates, stopProviderLocationUpdates } from "./provider-location";

type ProviderProfile = {
  publicName: string;
  hourlyRate: string | number | null;
  assessmentFee: string | number;
  skillCategories: string[];
  serviceAreas: string[];
  deliveryModes: string[];
  isAvailable: boolean;
  maxTravelDistanceKm: number;
  ratings?: {
    overall: number;
    overallReviewCount: number;
    overallIsRated: boolean;
    skills: Array<{category:string;rating:number|null;reviewCount:number;displayRating:number;isRated:boolean}>;
  };
};

type DailyEarnings = {
  date: string;
  currency: "ZAR";
  amount: number;
  completedJobs: number;
  earningsBasis: "COMPLETED_JOBS" | string;
};

type Props = { onManageProfile: () => void };

function getSkillIcon(category: string): string {
  const value = category.toLowerCase();
  const icons: Array<[string[], string]> = [
    [["plumb", "pipe"], "🔧"],
    [["electric", "wiring"], "⚡"],
    [["clean", "housekeep"], "🧹"],
    [["garden", "landscap", "lawn"], "🌿"],
    [["paint", "decorat"], "🖌️"],
    [["carpenter", "wood", "cabinet"], "🪚"],
    [["build", "mason", "brick", "construction"], "🧱"],
    [["hair", "barber", "beaut"], "✂️"],
    [["makeup", "make-up"], "💄"],
    [["photo", "video"], "📷"],
    [["cook", "cater", "chef", "baking"], "🍳"],
    [["tutor", "teach", "lesson"], "📚"],
    [["computer", "it support", "software", "web", "tech"], "💻"],
    [["mechanic", "auto", "vehicle"], "🚗"],
    [["搬", "moving", "搬运"], "📦"],
    [["security", "guard"], "🛡️"],
    [["plaster", "til"], "🧰"],
    [["delivery", "courier"], "🚚"],
    [["massage", "wellness"], "💆"],
    [["sew", "tailor", "fashion"], "🧵"],
  ];
  return icons.find(([keywords]) => keywords.some((keyword) => value.includes(keyword)))?.[1] ?? "✦";
}

const C = {
  // AnySkill brand palette sampled from the supplied logo.
  navy: "#012353",
  ink: "#012353",
  muted: "#64748B",
  primary: "#0164CE",
  blue: "#0164CE",
  green: "#03762C",
  lime: "#7EDD1E",
  border: "#E2EAF3",
  background: "#FFFFFF",
  soft: "#EEF5FF",
  online: "#03762C",
  onlineSoft: "#EAF7EE",
  offline: "#64748B",
  offlineSoft: "#F1F4F8",
  danger: "#B42318",
};

export function ProviderHomeScreen({ onManageProfile }: Props) {
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [dailyEarnings, setDailyEarnings] = useState<DailyEarnings | null>(null);
  const [loading, setLoading] = useState(true);
  const [earningsLoading, setEarningsLoading] = useState(true);
  const [earningsUnavailable, setEarningsUnavailable] = useState(false);
  const [showAllSkills, setShowAllSkills] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const providerProfile = await apiRequest<ProviderProfile | null>("/marketplace/provider-profile", {}, true);
      setProfile(providerProfile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your Provider profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const refreshEarnings = useCallback(async () => {
    try {
      const earnings = await apiRequest<DailyEarnings>("/marketplace/provider-earnings/today", {}, true);
      setDailyEarnings(earnings);
      setEarningsUnavailable(false);
    } catch {
      // Keep the last successful total visible if a temporary network error occurs.
      setEarningsUnavailable(true);
    } finally {
      setEarningsLoading(false);
    }
  }, []);

  // Keep earnings current as completed jobs are recorded while Provider Home is open.
  useEffect(() => {
    void refreshEarnings();
    const interval = setInterval(() => { void refreshEarnings(); }, 30_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshEarnings();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [refreshEarnings]);

  // Resume OS-managed location updates for Providers who are already online.
  useEffect(() => {
    if (!profile?.isAvailable) return;
    void startProviderLocationUpdates().catch(() => undefined);
  }, [profile?.isAvailable]);

  const setAvailability = async (next: boolean) => {
    if (!profile || saving) return;
    setSaving(true);
    setError("");
    try {
      // Capture a fresh, accurate fix before the API makes this Provider visible.
      const firstFix = next ? await getInitialProviderLocation() : null;
      const profilePayload = {
        publicName: profile.publicName,
        hourlyRate: Number(profile.hourlyRate),
        assessmentFee: Number(profile.assessmentFee),
        skillCategories: profile.skillCategories,
        serviceAreas: profile.serviceAreas,
        deliveryModes: profile.deliveryModes,
        isAvailable: next,
        maxTravelDistanceKm: profile.maxTravelDistanceKm,
        ...(firstFix ? {
          latitude: Number(firstFix.coords.latitude.toFixed(7)),
          longitude: Number(firstFix.coords.longitude.toFixed(7)),
          accuracyM: Number(firstFix.coords.accuracy!.toFixed(1)),
        } : {}),
      };
      const updated = await apiRequest<ProviderProfile>("/marketplace/provider-profile", {
        method: "POST",
        body: JSON.stringify(profilePayload),
      }, true);

      if (next) {
        try {
          await startProviderLocationUpdates();
        } catch (startError) {
          // Never leave the Provider marked online if the OS tracking task
          // could not be started after the initial GPS fix was accepted.
          await apiRequest("/marketplace/provider-profile", {
            method: "POST",
            body: JSON.stringify({
              ...profilePayload,
              isAvailable: false,
              latitude: undefined,
              longitude: undefined,
              accuracyM: undefined,
            }),
          }, true);
          setProfile({ ...updated, isAvailable: false });
          throw startError;
        }
        setProfile(updated);
      } else {
        setProfile(updated);
        await stopProviderLocationUpdates();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update your availability.");
    } finally {
      setSaving(false);
    }
  };

  // The API returns only approved, unpaused skills. Never fall back to draft skills here.
  const activeSkills = profile?.skillCategories ?? [];
  const canToggle = Boolean(profile && Number(profile.hourlyRate) >= 1);
  const isOnline = Boolean(profile?.isAvailable);

  return (
    <View style={styles.root}>
      <View style={styles.intro}>
        <Text style={styles.title}>
          {loading ? "Loading your Provider Home…" : isOnline ? "You're online" : "You're offline"}
        </Text>
        <Text style={styles.subtitle}>
          {loading
            ? "Checking your service profile and availability."
            : isOnline
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
              {loading ? "CHECKING" : isOnline ? "ONLINE" : "OFFLINE"}
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

      <View style={styles.earningsCard}>
        <View style={styles.earningsTop}>
          <View>
            <Text style={styles.earningsLabel}>Today's earnings</Text>
            <Text style={styles.earningsAmount}>
              {dailyEarnings
                ? new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(dailyEarnings.amount)
                : earningsLoading ? "Loading…" : "—"}
            </Text>
          </View>
        </View>
        <View style={styles.earningsFooter}>
          <Text style={styles.earningsJobs}>
            {dailyEarnings
              ? `${dailyEarnings.completedJobs} completed ${dailyEarnings.completedJobs === 1 ? "job" : "jobs"} today`
              : earningsLoading ? "Loading today's earnings…"
                : earningsUnavailable ? "Earnings unavailable. Please try again shortly."
                  : "No completed jobs today"}
          </Text>
        </View>
      </View>

      <View style={styles.skillsSection}>
        <View style={styles.skillsHeader}>
          <View style={styles.skillsHeadingCopy}>
            <Text style={styles.sectionTitle}>Active Skills</Text>
            <Text style={styles.skillsSubtitle}>Services on your Provider profile</Text>
          </View>
          {!loading && activeSkills.length > 0 ? (
            <View style={styles.skillsCount}>
              <Text style={styles.skillsCountText}>{activeSkills.length}</Text>
            </View>
          ) : null}
        </View>

        {loading ? (
          <ActivityIndicator color={C.primary} style={styles.skillsLoader} />
        ) : activeSkills.length ? (
          <>
            <View style={styles.skillList}>
              {activeSkills.slice(0, showAllSkills ? activeSkills.length : 6).map((skill, index) => {
                const skillRating = profile?.ratings?.skills?.find(
                  (item) => item.category.trim().toLowerCase() === skill.trim().toLowerCase(),
                );
                return (
                  <View key={skill + index} style={styles.skillRow}>
                    <View style={styles.skillIdentity}>
                      <View style={styles.skillIcon}>
                        <Text style={styles.skillIconText}>{getSkillIcon(skill)}</Text>
                      </View>
                      <Text numberOfLines={2} style={styles.skillName}>{skill}</Text>
                    </View>
                    <View style={styles.skillRatingInfo}>
                      {skillRating?.isRated ? (
                        <>
                          <Text style={styles.skillRatingValue}>★ {skillRating.displayRating.toFixed(1)}</Text>
                          <Text style={styles.skillRatingCount}>
                            {skillRating.reviewCount} {skillRating.reviewCount === 1 ? "review" : "reviews"}
                          </Text>
                        </>
                      ) : (
                        <Text style={styles.skillNotRated}>Not yet rated</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
            {activeSkills.length > 6 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showAllSkills ? "Show fewer active skills" : `View all ${activeSkills.length} active skills`}
                onPress={() => setShowAllSkills((current) => !current)}
                style={styles.skillsExpand}
              >
                <Text style={styles.skillsExpandText}>
                  {showAllSkills ? "Show fewer skills" : `View all ${activeSkills.length} skills`}
                </Text>
                <Text style={styles.skillsExpandArrow}>{showAllSkills ? "↑" : "↓"}</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <View style={styles.emptySkillsCard}>
            <Text style={styles.emptySkillsTitle}>No active skills yet</Text>
            <Text style={styles.emptySkills}>
              Add skills to your Provider profile to start receiving relevant requests.
            </Text>
            <Pressable accessibilityRole="button" onPress={onManageProfile} style={styles.skillsManageLink}>
              <Text style={styles.skillsManageLinkText}>Manage skills</Text>
              <Text style={styles.skillsExpandArrow}>›</Text>
            </Pressable>
          </View>
        )}
      </View>

      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
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
  title: {
    color: C.ink,
    fontSize: 35,
    lineHeight: 42,
    fontWeight: "800",
    letterSpacing: -1.5,
    marginTop: 9,
  },
  subtitle: {
    color: C.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    maxWidth: 330,
  },
  availability: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 2,
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
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 20,
  },
  onlinePill: { backgroundColor: C.onlineSoft, borderWidth: 1, borderColor: "#CDEBD5" },
  offlinePill: { backgroundColor: C.offlineSoft, borderWidth: 1, borderColor: "#E2E8F0" },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  onlineDot: { backgroundColor: C.online },
  offlineDot: { backgroundColor: C.offline },
  statusText: { fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
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
  switchTitle: { color: C.ink, fontSize: 16, fontWeight: "800", letterSpacing: -0.2 },
  switchHint: { color: C.muted, fontSize: 13, lineHeight: 19 },
  toggleTrack: {
    width: 66,
    height: 38,
    borderRadius: 22,
    backgroundColor: "#D5DDE8",
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
  setupText: { color: C.muted, fontSize: 14, lineHeight: 21 },
  setupLink: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  setupLinkText: { color: C.primary, fontSize: 14, fontWeight: "800" },
  setupArrow: { color: C.primary, fontSize: 23 },
  earningsCard: {
    marginTop: 22,
    paddingHorizontal: 2,
    paddingVertical: 17,
    backgroundColor: "transparent",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.border,
    gap: 12,
  },
  earningsTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  earningsLabel: { color: C.muted, fontSize: 13, fontWeight: "800", letterSpacing: 0.2 },
  earningsAmount: { color: C.navy, fontSize: 30, fontWeight: "900", marginTop: 6, letterSpacing: -0.9 },
  earningsFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  earningsJobs: { color: C.muted, fontSize: 12, fontWeight: "700" },
    skillsSection: { marginTop: 31 },
  sectionTitle: { color: C.navy, fontSize: 20, fontWeight: "800", letterSpacing: -0.5 },
  skillsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  skillsHeadingCopy: { gap: 3 },
  skillsSubtitle: { color: C.muted, fontSize: 13, lineHeight: 19 },
  skillsCount: { minWidth: 28, height: 28, paddingHorizontal: 8, borderRadius: 14, backgroundColor: C.soft, borderWidth: 1, borderColor: "#D8E8FF", alignItems: "center", justifyContent: "center" },
  skillsCountText: { color: C.primary, fontSize: 12, fontWeight: "800" },
  skillsLoader: { marginTop: 12 },
  skillList: {
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  skillRow: {
    minHeight: 66,
    paddingVertical: 13,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  skillIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  skillIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: C.soft,
    borderWidth: 1,
    borderColor: "#D8E8FF",
    alignItems: "center",
    justifyContent: "center",
  },
  skillIconText: {
    fontSize: 21,
    lineHeight: 26,
  },
  skillName: {
    flex: 1,
    color: C.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  skillRatingInfo: {
    minWidth: 100,
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 3,
  },
  skillRatingValue: { color: C.green, fontSize: 14, fontWeight: "800" },
  skillRatingCount: { color: C.muted, fontSize: 12, lineHeight: 17 },
  skillNotRated: { color: C.muted, fontSize: 12, fontWeight: "600" },
  skillsExpand: { minHeight: 42, marginTop: 4, paddingHorizontal: 2, flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 8 },
  skillsExpandText: { color: C.primary, fontSize: 13, fontWeight: "800" },
  skillsExpandArrow: { color: C.primary, fontSize: 15, fontWeight: "800" },
  emptySkillsCard: { paddingVertical: 16, paddingHorizontal: 2, backgroundColor: "transparent" },
  emptySkillsTitle: { color: C.ink, fontSize: 15, fontWeight: "800" },
  emptySkills: { color: C.muted, fontSize: 13, lineHeight: 19, marginTop: 7 },
  skillsManageLink: { marginTop: 10, minHeight: 32, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  skillsManageLinkText: { color: C.primary, fontSize: 13, fontWeight: "800" },
  error: { color: C.danger, fontSize: 13, lineHeight: 20, marginTop: 15, fontWeight: "600" },
});
