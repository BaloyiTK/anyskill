import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Image, Pressable, StyleSheet, View } from "react-native";

const welcomeArtwork = require("../assets/design/welcome-screen.jpg");

export default function WelcomeScreen() {
  return (
    <View style={s.page}>
      <StatusBar hidden />
      <View style={s.screen}>
        <Image source={welcomeArtwork} style={s.artwork} resizeMode="cover" />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Get Started"
          onPress={() => router.push("/register")}
          style={s.getStarted}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="I'm a Professional"
          onPress={() => router.push("/professional/setup")}
          style={s.professional}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign In"
          onPress={() => router.push("/login")}
          style={s.signIn}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#003D31",
    alignItems: "center",
    justifyContent: "center",
  },
  screen: {
    flex: 1,
    width: "100%",
    maxWidth: 430,
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#003D31",
  },
  artwork: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  getStarted: {
    position: "absolute",
    left: "5%",
    right: "5%",
    top: "73.7%",
    height: "6.9%",
    borderRadius: 999,
  },
  professional: {
    position: "absolute",
    left: "5%",
    right: "5%",
    top: "81.3%",
    height: "6.2%",
    borderRadius: 999,
  },
  signIn: {
    position: "absolute",
    left: "58%",
    right: "14%",
    top: "89.2%",
    height: "4.2%",
  },
});
