import { useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  Pressable,
} from "react-native";

type UserMode = "seeker" | "provider";

const COLORS = {
  background: "#F7F8FA",
  surface: "#FFFFFF",
  ink: "#14202B",
  muted: "#667482",
  primary: "#176B5B",
  primarySoft: "#E5F2EE",
  border: "#E1E6EA",
  warning: "#FFF4DB",
  warningInk: "#76520A",
};

const MODES: {
  id: UserMode;
  eyebrow: string;
  title: string;
  description: string;
  action: string;
}[] = [
  {
    id: "seeker",
    eyebrow: "FIND A SKILL",
    title: "I need a skill",
    description:
      "Describe the work, receive offers from available Skill Providers and choose who you want to work with.",
    action: "Skill Seeker Mode",
  },
  {
    id: "provider",
    eyebrow: "OFFER YOUR SKILLS",
    title: "I offer a skill",
    description:
      "Showcase your skills, set your hourly rate and receive relevant work opportunities.",
    action: "Skill Provider Mode",
  },
];

export default function App() {
  const [selectedMode, setSelectedMode] = useState<UserMode | null>(null);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>A</Text>
          </View>
          <Text style={styles.brandName}>AnySkill</Text>
        </View>

        <View style={styles.hero}>
          <Text style={styles.kicker}>SKILLS, WHEN YOU NEED THEM</Text>
          <Text style={styles.heading}>The right skills.{ "\n" }Right when you need them.</Text>
          <Text style={styles.subtitle}>
            A real-time marketplace connecting people who need work done with
            people who can do it.
          </Text>
        </View>

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>How will you use AnySkill?</Text>
          <Text style={styles.sectionHint}>
            Choose a mode to preview. One account can use both.
          </Text>
        </View>

        <View style={styles.modeList}>
          {MODES.map((mode) => {
            const selected = selectedMode === mode.id;
            return (
              <Pressable
                key={mode.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setSelectedMode(mode.id)}
                style={[styles.modeCard, selected && styles.modeCardSelected]}
              >
                <View style={styles.modeCardTop}>
                  <Text style={styles.modeEyebrow}>{mode.eyebrow}</Text>
                  <View
                    style={[
                      styles.selectionMark,
                      selected && styles.selectionMarkSelected,
                    ]}
                  >
                    {selected ? <Text style={styles.check}>✓</Text> : null}
                  </View>
                </View>
                <Text style={styles.modeTitle}>{mode.title}</Text>
                <Text style={styles.modeDescription}>{mode.description}</Text>
                <Text style={styles.modeAction}>{mode.action} →</Text>
              </Pressable>
            );
          })}
        </View>

        {selectedMode ? (
          <View style={styles.selectionNotice} accessibilityLiveRegion="polite">
            <Text style={styles.selectionNoticeTitle}>
              {selectedMode === "seeker"
                ? "Skill Seeker Mode selected"
                : "Skill Provider Mode selected"}
            </Text>
            <Text style={styles.selectionNoticeText}>
              Both modes will be available under one account. Account setup and
              identity verification are the next onboarding steps.
            </Text>
          </View>
        ) : null}

        <View style={styles.securityNotice}>
          <Text style={styles.securityIcon}>✓</Text>
          <View style={styles.securityCopy}>
            <Text style={styles.securityTitle}>Identity-verified community</Text>
            <Text style={styles.securityText}>
              Every Skill Seeker and Skill Provider must verify their identity
              before accessing the marketplace.
            </Text>
          </View>
        </View>

        <Text style={styles.footer}>
          One account. Two ways to use AnySkill.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 22, paddingBottom: 36 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandMark: { width: 38, height: 38, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center" },
  brandMarkText: { color: "#FFFFFF", fontSize: 23, fontWeight: "800" },
  brandName: { color: COLORS.ink, fontSize: 20, fontWeight: "800", letterSpacing: -0.5 },
  hero: { marginTop: 52, marginBottom: 36 },
  kicker: { color: COLORS.primary, fontSize: 11, fontWeight: "800", letterSpacing: 1.6, marginBottom: 14 },
  heading: { color: COLORS.ink, fontSize: 38, lineHeight: 44, fontWeight: "800", letterSpacing: -1.4 },
  subtitle: { color: COLORS.muted, fontSize: 16, lineHeight: 24, marginTop: 16, maxWidth: 440 },
  sectionHeading: { marginBottom: 16 },
  sectionTitle: { color: COLORS.ink, fontSize: 19, fontWeight: "800" },
  sectionHint: { color: COLORS.muted, fontSize: 13, lineHeight: 19, marginTop: 5 },
  modeList: { gap: 12 },
  modeCard: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: 18, padding: 18 },
  modeCardSelected: { borderColor: COLORS.primary, borderWidth: 2, backgroundColor: "#F5FBF8", padding: 17 },
  modeCardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modeEyebrow: { color: COLORS.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  selectionMark: { width: 22, height: 22, borderRadius: 11, borderColor: COLORS.border, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  selectionMarkSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  check: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  modeTitle: { color: COLORS.ink, fontSize: 21, fontWeight: "800", marginTop: 12 },
  modeDescription: { color: COLORS.muted, fontSize: 13, lineHeight: 20, marginTop: 7 },
  modeAction: { color: COLORS.primary, fontSize: 13, fontWeight: "800", marginTop: 15 },
  selectionNotice: { backgroundColor: COLORS.primarySoft, borderRadius: 14, padding: 15, marginTop: 16 },
  selectionNoticeTitle: { color: COLORS.primary, fontSize: 14, fontWeight: "800" },
  selectionNoticeText: { color: COLORS.ink, fontSize: 12, lineHeight: 18, marginTop: 5 },
  securityNotice: { flexDirection: "row", alignItems: "flex-start", backgroundColor: COLORS.warning, borderRadius: 14, padding: 15, marginTop: 22, gap: 11 },
  securityIcon: { color: COLORS.warningInk, fontSize: 16, fontWeight: "900" },
  securityCopy: { flex: 1 },
  securityTitle: { color: COLORS.warningInk, fontSize: 13, fontWeight: "800" },
  securityText: { color: COLORS.warningInk, fontSize: 12, lineHeight: 18, marginTop: 4 },
  footer: { color: COLORS.muted, fontSize: 12, textAlign: "center", marginTop: 28 },
});
