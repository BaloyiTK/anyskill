import { useEffect, useState } from "react";
import { useIdTokenAuthRequest } from "expo-auth-session/providers/google";
import {
  ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable,
  SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from "react-native";
import {
  AccountSummary, apiRequest, clearTokens, IdentitySummary, saveTokens, signOut,
} from "./src/api";
import { MarketplaceScreen } from "./src/MarketplaceScreen";
import { OnboardingScreen } from "./src/OnboardingScreen";

type Screen = "welcome" | "register" | "login" | "verify-email" | "verify-otp" | "complete-registration" | "forgot-password" | "reset-password" | "dashboard" | "marketplace" | "onboarding";
type UserMode = "seeker" | "provider";
type Tokens = { accessToken: string; refreshToken: string; tokenType: "Bearer"; expiresIn: number };

const C = {
  bg: "#F6F8F7", surface: "#FFFFFF", ink: "#17231F", muted: "#68766F",
  primary: "#176B5B", border: "#DCE5E0", soft: "#E7F2EE",
  warning: "#FFF3D8", warningInk: "#79540B", danger: "#A12D2D",
};

export default function App() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [mode, setMode] = useState<UserMode>("seeker");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [registrationToken, setRegistrationToken] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [identity, setIdentity] = useState<IdentitySummary | null>(null);
  const [pendingAcceptRequestId, setPendingAcceptRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "not-configured.apps.googleusercontent.com";
  const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "not-configured.apps.googleusercontent.com";
  const googleAndroidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? "not-configured.apps.googleusercontent.com";
  const googleConfigured = Boolean(
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID &&
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID &&
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID
  );
  const [googleRequest, , promptGoogle] = useIdTokenAuthRequest({
    webClientId: googleWebClientId,
    iosClientId: googleIosClientId,
    androidClientId: googleAndroidClientId,
    selectAccount: true,
  });

  const feedback = () => { setMessage(""); setError(""); };
  const goTo = (next: Screen) => { feedback(); setScreen(next); };

  const loadAccount = async () => {
    const me = await apiRequest<AccountSummary>("/auth/me", {}, true);
    const verification = await apiRequest<IdentitySummary>("/identity-verification/status", {}, true);
    setAccount(me);
    setIdentity(verification);
    setScreen("dashboard");
  };

  const verifyEmailFromLink = async (url: string) => {
    const query = new URLSearchParams(url.split("?")[1] ?? "");
    if (url.includes("reset-password")) {
      const token = query.get("token");
      if (token) {
        setResetToken(token);
        setScreen("reset-password");
      }
      return;
    }
    if (!url.includes("verify-email")) return;
    const token = query.get("token");
    if (!token) return;
    setBusy(true);
    try {
      await apiRequest("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) });
      setMessage("Email verified. You can now sign in.");
      setScreen("login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Email verification failed.");
      setScreen("login");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void Linking.getInitialURL().then((url) => { if (url) void verifyEmailFromLink(url); });
    void loadAccount().catch(() => undefined);
    const subscription = Linking.addEventListener("url", ({ url }) => { void verifyEmailFromLink(url); });
    return () => subscription.remove();
  }, []);

  const register = async () => {
    feedback(); setBusy(true);
    try {
      const result = await apiRequest<{ message: string }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), mode: mode === "provider" ? "PROVIDER" : "SEEKER" }),
      });
      setMessage(result.message);
      setOtp("");
      setScreen("verify-otp");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send verification code.");
    } finally { setBusy(false); }
  };

  const verifyRegistrationOtp = async () => {
    feedback(); setBusy(true);
    try {
      const result = await apiRequest<{ registrationToken: string }>("/auth/verify-registration-otp", {
        method: "POST", body: JSON.stringify({ email: email.trim(), otp }),
      });
      setRegistrationToken(result.registrationToken);
      setScreen("complete-registration");
      setMessage("Email verified. Set a password to finish creating your account.");
    } catch (e) { setError(e instanceof Error ? e.message : "Code verification failed."); }
    finally { setBusy(false); }
  };

  const completeRegistration = async () => {
    feedback(); setBusy(true);
    try {
      const tokens = await apiRequest<Tokens>("/auth/complete-registration", {
        method: "POST", body: JSON.stringify({ registrationToken, password }),
      });
      await saveTokens(tokens);
      setPassword("");
      setRegistrationToken("");
      await loadAccount();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not complete registration."); }
    finally { setBusy(false); }
  };

  const login = async () => {
    feedback(); setBusy(true);
    try {
      const tokens = await apiRequest<Tokens>("/auth/login", {
        method: "POST", body: JSON.stringify({ email: email.trim(), password }),
      });
      await saveTokens(tokens);
      await loadAccount();
      setPassword("");
    } catch (e) {
      await clearTokens();
      setError(e instanceof Error ? e.message : "Sign in failed.");
    } finally { setBusy(false); }
  };

  const continueWithGoogle = async () => {
    feedback();
    if (!googleConfigured) {
      setError("Google sign-in is not configured yet. Add the Google OAuth client IDs to the mobile and API environment files.");
      return;
    }
    setBusy(true);
    try {
      const result = await promptGoogle();
      if (result.type !== "success") return;
      const idToken = result.params.id_token;
      if (!idToken) throw new Error("Google did not return an ID token. Please try again.");

      const tokens = await apiRequest<Tokens>("/auth/google", {
        method: "POST",
        body: JSON.stringify({ idToken }),
      });
      await saveTokens(tokens);
      await loadAccount();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const connectGoogle = async () => {
    feedback();
    if (!googleConfigured) {
      setError("Google sign-in is not configured yet. Add the Google OAuth client IDs to the mobile and API environment files.");
      return;
    }
    setBusy(true);
    try {
      const result = await promptGoogle();
      if (result.type !== "success") return;
      const idToken = result.params.id_token;
      if (!idToken) throw new Error("Google did not return an ID token. Please try again.");
      await apiRequest("/auth/google/link", {
        method: "POST",
        body: JSON.stringify({ idToken }),
      }, true);
      const me = await apiRequest<AccountSummary>("/auth/me", {}, true);
      setAccount(me);
      setMessage("Google account connected successfully.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect Google account.");
    } finally {
      setBusy(false);
    }
  };

  const requestPasswordReset = async () => {
    feedback(); setBusy(true);
    try {
      const result = await apiRequest<{ message: string }>("/auth/forgot-password", {
        method: "POST", body: JSON.stringify({ email: email.trim() }),
      });
      setMessage(result.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not request password reset.");
    } finally { setBusy(false); }
  };

  const completePasswordReset = async () => {
    feedback(); setBusy(true);
    try {
      await apiRequest("/auth/reset-password", {
        method: "POST", body: JSON.stringify({ token: resetToken, newPassword }),
      });
      await clearTokens();
      setMessage("Password updated. Sign in with your new password.");
      setPassword("");
      setNewPassword("");
      setScreen("login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset password.");
    } finally { setBusy(false); }
  };

  const resendVerification = async () => {
    feedback(); setBusy(true);
    try {
      const result = await apiRequest<{ message: string }>("/auth/resend-verification", {
        method: "POST", body: JSON.stringify({ email: email.trim() }),
      });
      setMessage(result.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resend verification email.");
    } finally { setBusy(false); }
  };

  const startIdentityVerification = async () => {
    feedback(); setBusy(true);
    try {
      const result = await apiRequest<{ status: string; message?: string }>(
        "/identity-verification/submit", { method: "POST", body: JSON.stringify({}) }, true,
      );
      const status = await apiRequest<IdentitySummary>("/identity-verification/status", {}, true);
      setIdentity(status);
      setMessage(result.message ?? "Your verification request has been recorded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit verification request.");
    } finally { setBusy(false); }
  };

  const refreshIdentityStatus = async () => {
    feedback(); setBusy(true);
    try {
      const status = await apiRequest<IdentitySummary>("/identity-verification/status", {}, true);
      setIdentity(status);
      setMessage(status.status === "verified" ? "Identity verification is approved." : `Verification status: ${formatStatus(status.status)}.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not refresh verification status."); }
    finally { setBusy(false); }
  };

  const logout = async () => {
    setBusy(true);
    try { await signOut(); }
    finally {
      setAccount(null); setIdentity(null); setPassword(""); setScreen("welcome"); setBusy(false);
    }
  };

  const identityStatus = identity?.status ?? "not_started";
  const verified = identityStatus === "verified";

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={s.brandRow}>
            <View style={s.brandMark}><Text style={s.brandMarkText}>A</Text></View>
            <Text style={s.brandName}>AnySkill</Text>
            <View style={s.spacer} />
            <Text style={s.early}>EARLY BUILD</Text>
          </View>

          {screen === "welcome" && <>
            <View style={s.hero}>
              <Text style={s.kicker}>SKILLS, WHEN YOU NEED THEM</Text>
              <Text style={s.heading}>The right skills.{"\n"}Right when you need them.</Text>
              <Text style={s.subtitle}>A real-time marketplace connecting people who need work done with people who can do it.</Text>
            </View>
            <Text style={s.sectionTitle}>One account. Two modes.</Text>
            <View style={s.modeList}>
              <ModeCard title="Skill Seeker" description="Find available people with the skills you need." selected={mode === "seeker"} onPress={() => setMode("seeker")} />
              <ModeCard title="Skill Provider" description="Offer your skills, set your rate and receive work requests." selected={mode === "provider"} onPress={() => setMode("provider")} />
            </View>
            <Text style={s.helper}>You can use both modes with the same account.</Text>
            <Primary label="Create an account" onPress={() => goTo("register")} />
            <Secondary label="I already have an account" onPress={() => goTo("login")} />
          </>}

          {(screen === "register" || screen === "login") && <View style={s.form}>
            <Text style={s.kicker}>{screen === "register" ? "GET STARTED" : "WELCOME BACK"}</Text>
            <Text style={s.formTitle}>{screen === "register" ? "Create your account" : "Sign in to AnySkill"}</Text>
            <Text style={s.subtitle}>{screen === "register" ? "One account gives you access to both operating modes." : "Sign in to continue to your account."}</Text>
            <Field label="Email address" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
            {screen === "login" && <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 12 characters" secureTextEntry />}
            {screen === "register" && <Text style={s.helper}>First, enter only your email address. We will send a six-digit code before asking for any other details.</Text>}
            <Primary label={screen === "register" ? "Send verification code" : "Sign in"} onPress={screen === "register" ? register : login} disabled={busy || !email.trim() || (screen === "login" && password.length < 12)} />
            <Text style={s.helper}>OR</Text>
            <Secondary label="Continue with Google" onPress={continueWithGoogle} />
            <Secondary label={screen === "register" ? "I already have an account" : "Create a new account"} onPress={() => goTo(screen === "register" ? "login" : "register")} />
            {screen === "login" && <TextButton label="Forgot password?" onPress={() => goTo("forgot-password")} />}
            <TextButton label="Back" onPress={() => goTo("welcome")} />
          </View>}

          {screen === "verify-otp" && <View style={s.form}>
            <Text style={s.kicker}>CHECK YOUR INBOX</Text>
            <Text style={s.formTitle}>Enter your code</Text>
            <Text style={s.subtitle}>We sent a six-digit code to {email}. It expires in 10 minutes.</Text>
            <Field label="Six-digit verification code" value={otp} onChangeText={setOtp} placeholder="000000" keyboardType="phone-pad" />
            <Primary label="Verify email" onPress={verifyRegistrationOtp} disabled={busy || !/^\d{6}$/.test(otp)} />
            <TextButton label="Back" onPress={() => goTo("register")} />
          </View>}

          {screen === "complete-registration" && <View style={s.form}>
            <Text style={s.kicker}>EMAIL VERIFIED</Text>
            <Text style={s.formTitle}>Finish your account</Text>
            <Text style={s.subtitle}>Your email is verified. Set a password to finish registration. Your profile can be completed later in steps.</Text>
            <Field label="Create password" value={password} onChangeText={setPassword} placeholder="At least 12 characters" secureTextEntry />
            <Primary label="Complete registration" onPress={completeRegistration} disabled={busy || password.length < 12 || !registrationToken} />
          </View>}

          {screen === "verify-email" && <View style={s.form}>
            <Text style={s.kicker}>CHECK YOUR INBOX</Text>
            <Text style={s.formTitle}>Verify your email</Text>
            <Text style={s.subtitle}>We sent a verification link to {email || "your email address"}. Open it on this device, then sign in.</Text>
            <View style={s.notice}>
              <Text style={s.noticeTitle}>Email verification is not identity verification.</Text>
              <Text style={s.noticeText}>You must also complete identity verification before using the marketplace.</Text>
            </View>
            <Primary label="Go to sign in" onPress={() => goTo("login")} />
            <Secondary label="Resend verification email" onPress={resendVerification} />
            <TextButton label="Back to start" onPress={() => goTo("welcome")} />
          </View>}

          {screen === "forgot-password" && <View style={s.form}>
            <Text style={s.kicker}>ACCOUNT RECOVERY</Text>
            <Text style={s.formTitle}>Reset your password</Text>
            <Text style={s.subtitle}>Enter your account email. If an account exists, we will send a secure reset link.</Text>
            <Field label="Email address" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
            <Primary label="Send reset link" onPress={requestPasswordReset} disabled={busy || !email.trim()} />
            <TextButton label="Back to sign in" onPress={() => goTo("login")} />
          </View>}

          {screen === "reset-password" && <View style={s.form}>
            <Text style={s.kicker}>ACCOUNT RECOVERY</Text>
            <Text style={s.formTitle}>Choose a new password</Text>
            <Text style={s.subtitle}>Use at least 12 characters. This will sign out your other active sessions.</Text>
            <Field label="New password" value={newPassword} onChangeText={setNewPassword} placeholder="At least 12 characters" secureTextEntry />
            <Primary label="Update password" onPress={completePasswordReset} disabled={busy || newPassword.length < 12 || !resetToken} />
          </View>}

          {screen === "onboarding" && account && <OnboardingScreen
            identityStatus={identityStatus}
            onBack={() => goTo("dashboard")}
            onStartVerification={() => { void startIdentityVerification(); }}
          />}

          {screen === "marketplace" && account && <MarketplaceScreen
        mode={mode}
        verified={verified}
        pendingRequestId={pendingAcceptRequestId}
        onModeChange={setMode}
        onBack={() => setScreen("dashboard")}
        onIdentityRequired={(requestId) => {
          setPendingAcceptRequestId(requestId);
          setMessage("Identity verification is required before you can accept this request. Your request has been saved so you can return to it after approval.");
          setScreen("dashboard");
        }}
        onStartVerification={() => { void startIdentityVerification(); }}
      />}

      {screen === "dashboard" && account && <View style={s.form}>
            <Text style={s.kicker}>YOUR ACCOUNT</Text>
            <Text style={s.formTitle}>You're signed in</Text>
            <Text style={s.subtitle}>{account.email}</Text>
            <View style={s.statusCard}>
              <Text style={s.statusLabel}>EMAIL</Text>
              <Text style={s.statusValue}>{account.emailVerified ? "Verified" : "Not verified"}</Text>
              <View style={s.divider} />
              <Text style={s.statusLabel}>IDENTITY VERIFICATION</Text>
              <Text style={s.statusValue}>{formatStatus(identityStatus)}</Text>
              {identity?.latestCase && <Text style={s.helper}>Request submitted {new Date(identity.latestCase.submittedAt).toLocaleString()}.</Text>}
            </View>
            {verified ? <View style={s.successNotice}>
              <Text style={s.successTitle}>Identity verified</Text>
              <Text style={s.successText}>You are verified and can complete actions that require identity verification as those marketplace features become available.</Text>
            </View> : <View style={s.notice}>
              <Text style={s.noticeTitle}>Identity verification required for key actions</Text>
              <Text style={s.noticeText}>You can explore AnySkill before verifying. Skill Seekers must verify before submitting a request. Skill Providers can still receive and view incoming requests, but must verify before accepting one. Identity checks are not yet connected to a verification provider in this build.</Text>
              {["not_started", "failed", "requires_information"].includes(identityStatus) && <Primary label="Start identity verification request" onPress={startIdentityVerification} disabled={busy} />}
            </View>}
            {!account.googleLinked && <Secondary label="Connect Google account" onPress={connectGoogle} />}
            <Secondary label="Complete or update profile" onPress={() => goTo("onboarding")} />
            <Secondary label="Open marketplace" onPress={() => goTo("marketplace")} />
            <Secondary label="Refresh identity-verification status" onPress={refreshIdentityStatus} />
            {pendingAcceptRequestId && verified && <Primary label="Return to incoming request" onPress={() => { setMode("provider"); goTo("marketplace"); }} />}
            <Text style={s.sectionTitle}>Current mode</Text>
            <View style={s.modeList}>
              <ModeCard title="Skill Seeker" description="Request skills and compare provider offers." selected={mode === "seeker"} onPress={() => setMode("seeker")} />
              <ModeCard title="Skill Provider" description="Offer skills and respond to suitable requests." selected={mode === "provider"} onPress={() => setMode("provider")} />
            </View>
            <Text style={s.helper}>One account supports both modes.</Text>
            <Secondary label="Sign out" onPress={logout} />
          </View>}

          {message ? <View style={s.successNotice}><Text style={s.successText}>{message}</Text></View> : null}
          {error ? <View style={s.errorNotice}><Text style={s.errorText}>{error}</Text></View> : null}
          {busy ? <ActivityIndicator color={C.primary} style={s.loader} /> : null}
          <Text style={s.footer}>One account. Two ways to use AnySkill.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ModeCard(p: { title: string; description: string; selected: boolean; onPress: () => void }) {
  return <Pressable onPress={p.onPress} style={[s.modeCard, p.selected && s.modeCardSelected]}>
    <View style={s.modeCardTop}><Text style={s.modeTitle}>{p.title}</Text><View style={[s.radio, p.selected && s.radioSelected]} /></View>
    <Text style={s.modeDescription}>{p.description}</Text>
  </Pressable>;
}

function Field(p: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder: string;
  secureTextEntry?: boolean; keyboardType?: "default" | "email-address" | "phone-pad";
}) {
  return <View style={s.field}>
    <Text style={s.fieldLabel}>{p.label}</Text>
    <TextInput value={p.value} onChangeText={p.onChangeText} placeholder={p.placeholder}
      placeholderTextColor="#93A099" secureTextEntry={p.secureTextEntry}
      keyboardType={p.keyboardType ?? "default"} autoCapitalize="none" autoCorrect={false} style={s.input} />
  </View>;
}

function Primary(p: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable onPress={p.onPress} disabled={p.disabled} style={[s.primary, p.disabled && s.disabled]}>
    <Text style={s.primaryText}>{p.label}</Text>
  </Pressable>;
}
function Secondary(p: { label: string; onPress: () => void }) {
  return <Pressable onPress={p.onPress} style={s.secondary}><Text style={s.secondaryText}>{p.label}</Text></Pressable>;
}
function TextButton(p: { label: string; onPress: () => void }) {
  return <Pressable onPress={p.onPress} style={s.textButton}><Text style={s.textButtonText}>{p.label}</Text></Pressable>;
}

const s = StyleSheet.create({
  flex: { flex: 1 }, safe: { flex: 1, backgroundColor: C.bg },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 36 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 30 },
  brandMark: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  brandMarkText: { color: "#FFF", fontSize: 23, fontWeight: "800" }, brandName: { color: C.ink, fontSize: 20, fontWeight: "800" },
  spacer: { flex: 1 }, early: { color: C.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  hero: { marginTop: 25, marginBottom: 36 }, kicker: { color: C.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.5, marginBottom: 12 },
  heading: { color: C.ink, fontSize: 37, lineHeight: 43, fontWeight: "800", letterSpacing: -1.3 },
  formTitle: { color: C.ink, fontSize: 29, lineHeight: 35, fontWeight: "800", letterSpacing: -0.8 },
  subtitle: { color: C.muted, fontSize: 15, lineHeight: 23, marginTop: 12, marginBottom: 22 },
  sectionTitle: { color: C.ink, fontSize: 18, fontWeight: "800", marginBottom: 13, marginTop: 18 },
  modeList: { gap: 11, marginBottom: 18 }, modeCard: { backgroundColor: C.surface, borderColor: C.border, borderWidth: 1, borderRadius: 16, padding: 16 },
  modeCardSelected: { borderColor: C.primary, borderWidth: 2, padding: 15, backgroundColor: "#F5FBF8" },
  modeCardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modeTitle: { color: C.ink, fontSize: 16, fontWeight: "800" }, modeDescription: { color: C.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  radio: { width: 19, height: 19, borderRadius: 10, borderWidth: 1.5, borderColor: C.border }, radioSelected: { borderWidth: 6, borderColor: C.primary },
  form: { marginTop: 12 }, field: { marginBottom: 16 }, fieldLabel: { color: C.ink, fontSize: 12, fontWeight: "700", marginBottom: 7 },
  input: { minHeight: 52, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, color: C.ink, backgroundColor: C.surface, fontSize: 15 },
  helper: { color: C.muted, fontSize: 12, lineHeight: 18, marginTop: 7, marginBottom: 14 },
  primary: { minHeight: 52, borderRadius: 13, backgroundColor: C.primary, alignItems: "center", justifyContent: "center", marginTop: 8, paddingHorizontal: 18 },
  primaryText: { color: "#FFF", fontSize: 14, fontWeight: "800" }, disabled: { opacity: 0.45 },
  secondary: { minHeight: 50, borderRadius: 13, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center", marginTop: 10, backgroundColor: C.surface },
  secondaryText: { color: C.primary, fontSize: 13, fontWeight: "800" }, textButton: { alignItems: "center", paddingVertical: 16 },
  textButtonText: { color: C.muted, fontSize: 13, fontWeight: "700" },
  notice: { backgroundColor: C.warning, borderRadius: 14, padding: 15, marginVertical: 14 },
  noticeTitle: { color: C.warningInk, fontSize: 13, fontWeight: "800", marginBottom: 5 }, noticeText: { color: C.warningInk, fontSize: 12, lineHeight: 18 },
  successNotice: { backgroundColor: C.soft, borderRadius: 14, padding: 15, marginVertical: 12 },
  successTitle: { color: C.primary, fontSize: 13, fontWeight: "800", marginBottom: 5 }, successText: { color: C.ink, fontSize: 12, lineHeight: 18 },
  errorNotice: { backgroundColor: "#FCE9E9", borderRadius: 12, padding: 13, marginTop: 14 }, errorText: { color: C.danger, fontSize: 12, lineHeight: 18 },
  statusCard: { backgroundColor: C.surface, borderColor: C.border, borderWidth: 1, borderRadius: 16, padding: 17, marginBottom: 10 },
  statusLabel: { color: C.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.1 },
  statusValue: { color: C.ink, fontSize: 16, fontWeight: "800", marginTop: 5, marginBottom: 14 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 8 }, loader: { marginTop: 15 },
  footer: { color: C.muted, fontSize: 11, textAlign: "center", marginTop: 30 },
});
