import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ImageBackground, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { welcomeBackground } from "../src/assets/welcomeBackground";

const trustItems = [
  { icon: "✓", line1: "Verified", line2: "Professionals" },
  { icon: "●", line1: "Local", line2: "Experts" },
  { icon: "★", line1: "Rated", line2: "& Reviewed" },
  { icon: "🔒", line1: "Secure", line2: "Payments" },
];

export default function WelcomeScreen() {
  return (
    <View style={s.page}>
      <StatusBar style="light" />
      <View style={s.phone}>
        <ImageBackground
          source={{ uri: welcomeBackground }}
          style={s.background}
          imageStyle={s.backgroundImage}
          resizeMode="cover"
        >
          <View style={s.tint} />

          <SafeAreaView style={s.safe}>
            <View style={s.topRow}>
              <View>
                <Text style={s.logo}>
                  <Text style={s.logoAny}>Any</Text>
                  <Text style={s.logoSkill}>Skill</Text>
                  <Text style={s.tm}>™</Text>
                </Text>
                <Text style={s.tagline}>REAL SKILLS. REAL PEOPLE.</Text>
              </View>

              <View style={s.locationPill}>
                <Text style={s.locationIcon}>●</Text>
                <Text style={s.locationText}>Cape Town</Text>
                <Text style={s.chevron}>⌄</Text>
              </View>
            </View>

            <View style={s.heroCopy}>
              <Text style={s.headline}>
                Find trusted{"\n"}local professionals{"\n"}
                <Text style={s.gold}>for any job.</Text>
              </Text>
              <Text style={s.subtext}>
                From home repairs to beauty,{"\n"}
                tutoring to tech — get it done{"\n"}
                with people you can trust.
              </Text>
            </View>

            <View style={s.bottom}>
              <View style={s.trustRow}>
                {trustItems.map((item) => (
                  <View key={item.line1} style={s.trustCard}>
                    <Text style={s.trustIcon}>{item.icon}</Text>
                    <Text style={s.trustText}>{item.line1}</Text>
                    <Text style={s.trustText}>{item.line2}</Text>
                  </View>
                ))}
              </View>

              <Pressable style={s.primary} onPress={() => router.push("/register")}>
                <Text style={s.primaryText}>Get Started</Text>
                <Text style={s.primaryArrow}>→</Text>
              </Pressable>

              <Pressable style={s.secondary} onPress={() => router.push("/professional/setup")}>
                <Text style={s.secondaryText}>I’m a Professional</Text>
                <Text style={s.secondaryArrow}>→</Text>
              </Pressable>

              <View style={s.signInRow}>
                <Text style={s.signInPrompt}>Already have an account?</Text>
                <Pressable onPress={() => router.push("/login")}>
                  <Text style={s.signIn}>Sign In</Text>
                </Pressable>
              </View>

              <View style={s.dots}>
                <View style={[s.dot, s.dotActive]} />
                <View style={s.dot} />
                <View style={s.dot} />
              </View>
            </View>
          </SafeAreaView>
        </ImageBackground>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#EDE8DE",
    alignItems: "center",
    justifyContent: "center",
  },
  phone: {
    flex: 1,
    width: "100%",
    maxWidth: 430,
    backgroundColor: "#003D31",
    overflow: "hidden",
  },
  background: {
    flex: 1,
  },
  backgroundImage: {
    width: "100%",
    height: "100%",
  },
  tint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 55, 45, 0.42)",
  },
  safe: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 18,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  logo: {
    fontSize: 38,
    lineHeight: 42,
    fontWeight: "900",
    letterSpacing: -1.8,
  },
  logoAny: {
    color: "#FFFFFF",
  },
  logoSkill: {
    color: "#F4B932",
  },
  tm: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "800",
  },
  tagline: {
    color: "#FFFFFF",
    fontSize: 8.5,
    letterSpacing: 2.4,
    fontWeight: "800",
    marginTop: 2,
  },
  locationPill: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 13,
    height: 42,
    borderRadius: 24,
    backgroundColor: "rgba(0, 58, 47, 0.90)",
  },
  locationIcon: {
    color: "#F4B932",
    fontSize: 15,
  },
  locationText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  chevron: {
    color: "#FFFFFF",
    fontSize: 17,
    marginTop: -4,
  },
  heroCopy: {
    marginTop: 88,
    maxWidth: 330,
  },
  headline: {
    color: "#FFFFFF",
    fontSize: 42,
    lineHeight: 44,
    fontWeight: "900",
    letterSpacing: -1.4,
  },
  gold: {
    color: "#F4B932",
  },
  subtext: {
    marginTop: 20,
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 25,
    fontWeight: "500",
  },
  bottom: {
    marginTop: "auto",
  },
  trustRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 18,
  },
  trustCard: {
    flex: 1,
    minHeight: 104,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(26, 135, 111, 0.72)",
    backgroundColor: "rgba(0, 57, 46, 0.76)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  trustIcon: {
    color: "#F4B932",
    fontSize: 26,
    fontWeight: "900",
    marginBottom: 7,
  },
  trustText: {
    color: "#FFFFFF",
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  primary: {
    height: 62,
    borderRadius: 32,
    backgroundColor: "#F4B932",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  primaryText: {
    color: "#052E26",
    fontSize: 18,
    fontWeight: "900",
  },
  primaryArrow: {
    position: "absolute",
    right: 22,
    color: "#052E26",
    fontSize: 27,
    fontWeight: "700",
  },
  secondary: {
    height: 58,
    borderRadius: 30,
    marginTop: 12,
    borderWidth: 2,
    borderColor: "#F4B932",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    backgroundColor: "rgba(0, 48, 39, 0.50)",
  },
  secondaryText: {
    color: "#F4B932",
    fontSize: 17,
    fontWeight: "900",
  },
  secondaryArrow: {
    position: "absolute",
    right: 22,
    color: "#F4B932",
    fontSize: 26,
  },
  signInRow: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "center",
    gap: 9,
    alignItems: "center",
  },
  signInPrompt: {
    color: "#FFFFFF",
    fontSize: 13,
  },
  signIn: {
    color: "#F4B932",
    fontSize: 13,
    fontWeight: "900",
  },
  dots: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "center",
    gap: 9,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "rgba(19, 122, 101, 0.7)",
  },
  dotActive: {
    backgroundColor: "#F4B932",
  },
});
