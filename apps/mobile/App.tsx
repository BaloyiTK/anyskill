import { useEffect, useRef, useState } from "react";
import type { ComponentRef } from "react";
import { exchangeCodeAsync, ResponseType } from "expo-auth-session";
import { useAuthRequest } from "expo-auth-session/providers/google";
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, Pressable,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  AccountSummary, apiRequest, clearTokens, IdentitySummary, saveTokens, signOut,
} from "./src/api";
import { MarketplaceScreen } from "./src/MarketplaceScreen";
import { OnboardingScreen } from "./src/OnboardingScreen";
import { WelcomeScreen } from "./src/WelcomeScreen";


type Screen = "welcome" | "register" | "login" | "verify-email" | "verify-otp" | "complete-registration" | "forgot-password" | "reset-password" | "dashboard" | "marketplace" | "onboarding";
type UserMode = "seeker" | "provider";
type AppTab = "home" | "activities" | "notifications" | "account";
type Tokens = { accessToken: string; refreshToken: string; tokenType: "Bearer"; expiresIn: number };

const GOOGLE_DISCOVERY = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
};
const GOOGLE_WEB_AUTH_KEYS = {
  state: "anyskill.google.oauth.state",
  verifier: "anyskill.google.oauth.verifier",
  redirectUri: "anyskill.google.oauth.redirect-uri",
  flow: "anyskill.google.oauth.flow",
};

const C = {
  bg: "#F6F8FA", surface: "#FFFFFF", ink: "#15251E", muted: "#66756D",
  primary: "#176B55", border: "#E1E8E3", soft: "#E8F4ED",
  warning: "#FFF6E4", warningInk: "#78551A", danger: "#A12D2D",
};

export default function App() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [mode, setMode] = useState<UserMode>("seeker");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const otpInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [otpResendSeconds, setOtpResendSeconds] = useState(0);
  const [registrationToken, setRegistrationToken] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [identity, setIdentity] = useState<IdentitySummary | null>(null);
  const [profileComplete, setProfileComplete] = useState(false);
  const [pendingAcceptRequestId, setPendingAcceptRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // AuthSession is global: prevent sign-in and account-link flows from overlapping.
  const googleAuthInProgress = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "not-configured.apps.googleusercontent.com";
  const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "not-configured.apps.googleusercontent.com";
  const googleAndroidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? "not-configured.apps.googleusercontent.com";
  const googleConfigured = Platform.OS === "android"
    ? Boolean(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID)
    : Platform.OS === "ios"
      ? Boolean(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID)
      : Boolean(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID);
  const [googleRequest, , promptGoogle] = useAuthRequest(
    {
      webClientId: googleWebClientId,
      iosClientId: googleIosClientId,
      androidClientId: googleAndroidClientId,
      responseType: ResponseType.Code,
      usePKCE: true,
      // Both web and native redeem the authorization code explicitly:
      // web on the callback, native with PKCE immediately after the browser returns.
      shouldAutoExchangeCode: false,
      selectAccount: true,
    },
    {
      // Google Android OAuth uses this exact single-slash custom-scheme callback.
      // The native option is ignored on web, where AuthSession uses window.location.
      native: "com.anyskill.mobile:/oauthredirect",
    },
  );

  const feedback = () => { setMessage(""); setError(""); };
  const goTo = (next: Screen) => { feedback(); setScreen(next); };

  const refreshHomeEligibility = async () => {
    // Fail closed: Home only enables skill requests when both checks are confirmed.
    const [profileResult, identityResult] = await Promise.allSettled([
      apiRequest<{ sections?: { profile?: boolean } }>("/profile/onboarding", {}, true),
      apiRequest<IdentitySummary>("/identity-verification/status", {}, true),
    ]);
    setProfileComplete(profileResult.status === "fulfilled" && profileResult.value.sections?.profile === true);
    setIdentity(identityResult.status === "fulfilled" ? identityResult.value : null);
    return profileResult.status === "fulfilled"
      && profileResult.value.sections?.profile === true
      && identityResult.status === "fulfilled"
      && identityResult.value.status === "verified";
  };

  const loadAccount = async () => {
    const me = await apiRequest<AccountSummary>("/auth/me", {}, true);
    setAccount(me);
    setIdentity(null);
    setProfileComplete(false);

    // Profile Setup is the first authenticated destination. Keep the app
    // tabs available so users can move to Home or other sections at any time.
    setActiveTab("home");
    setScreen("onboarding");

    // Eligibility data is supplementary; a failure must not turn successful
    // authentication into a failed login. Home will remain safely unverified.
    await refreshHomeEligibility();
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
    if (otpResendSeconds <= 0) return;
    const timer = setTimeout(() => {
      setOtpResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [otpResendSeconds]);

  useEffect(() => {
    void Linking.getInitialURL().then((url) => { if (url) void verifyEmailFromLink(url); });
    void loadAccount().catch(() => undefined);
    const subscription = Linking.addEventListener("url", ({ url }) => { void verifyEmailFromLink(url); });
    return () => subscription.remove();
  }, []);

  // A full-page redirect avoids popup/opener issues. The callback sends the
  // one-time code and PKCE verifier to the API for a server-side token exchange.
  useEffect(() => {
    if (Platform.OS !== "web") return;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const returnedState = params.get("state");
    const providerError = params.get("error");
    if (!code && !providerError) return;

    const expectedState = window.sessionStorage.getItem(GOOGLE_WEB_AUTH_KEYS.state);
    const codeVerifier = window.sessionStorage.getItem(GOOGLE_WEB_AUTH_KEYS.verifier);
    const redirectUri = window.sessionStorage.getItem(GOOGLE_WEB_AUTH_KEYS.redirectUri);
    const flow = window.sessionStorage.getItem(GOOGLE_WEB_AUTH_KEYS.flow);

    // Remove the authorization response from the address bar before making
    // any API calls, and consume the one-time browser state.
    window.history.replaceState(
      {},
      document.title,
      window.location.pathname + window.location.hash,
    );
    Object.values(GOOGLE_WEB_AUTH_KEYS).forEach((key) => window.sessionStorage.removeItem(key));

    if (providerError) {
      setError(providerError === "access_denied"
        ? "Google sign-in was cancelled."
        : `Google sign-in failed: ${providerError}`);
      return;
    }
    if (!code || !returnedState || !expectedState || returnedState !== expectedState || !codeVerifier || !redirectUri) {
      setError("Google sign-in could not be verified. Please try again.");
      return;
    }

    const completeWebGoogleSignIn = async () => {
      setBusy(true);
      try {
        const authorizationCode = {
          code,
          codeVerifier,
          redirectUri,
        };

        if (flow === "link") {
          await apiRequest("/auth/google/link/exchange", {
            method: "POST",            body: JSON.stringify(authorizationCode),
          }, true);
          const me = await apiRequest<AccountSummary>("/auth/me", {}, true);
          setAccount(me);
          setMessage("Google account connected successfully.");
        } else {
          const tokens = await apiRequest<Tokens>("/auth/google/exchange", {
            method: "POST",
            body: JSON.stringify(authorizationCode),
          });
          await saveTokens(tokens);
          await loadAccount();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Google sign-in failed.");
      } finally {
        setBusy(false);
      }
    };

    void completeWebGoogleSignIn();
  }, []);

  const startWebGoogleRedirect = async (flow: "signin" | "link") => {
    if (Platform.OS !== "web" || !googleRequest) return;
    if (!googleRequest.codeVerifier || !googleRequest.state || !googleRequest.redirectUri) {
      setError("Google sign-in is still preparing its secure request. Please try again.");
      return;
    }

    googleAuthInProgress.current = true;
    setBusy(true);
    try {
      const authorizationUrl = await googleRequest.makeAuthUrlAsync(GOOGLE_DISCOVERY);
      window.sessionStorage.setItem(GOOGLE_WEB_AUTH_KEYS.state, googleRequest.state);
      window.sessionStorage.setItem(GOOGLE_WEB_AUTH_KEYS.verifier, googleRequest.codeVerifier);
      window.sessionStorage.setItem(GOOGLE_WEB_AUTH_KEYS.redirectUri, googleRequest.redirectUri);
      window.sessionStorage.setItem(GOOGLE_WEB_AUTH_KEYS.flow, flow);
      window.location.assign(authorizationUrl);
    } catch (e) {
      googleAuthInProgress.current = false;
      setBusy(false);
      setError(e instanceof Error ? e.message : "Could not start Google sign-in.");
    }
  };

  const register = async () => {
    feedback(); setBusy(true);
    try {
      const result = await apiRequest<{ message: string; resendAfterSeconds?: number }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      setMessage(result.message);
      setOtp("");
      setOtpResendSeconds(result.resendAfterSeconds ?? 60);
      setScreen("verify-otp");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send verification code.");
    } finally { setBusy(false); }
  };

  const resendRegistrationOtp = async () => {
    if (busy || otpResendSeconds > 0) return;
    feedback();
    setBusy(true);
    try {
      const result = await apiRequest<{ message: string; resendAfterSeconds?: number }>("/auth/resend-registration-otp", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      setOtp("");
      setOtpResendSeconds(result.resendAfterSeconds ?? 60);
      otpInputRef.current?.focus();
      setMessage(result.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resend verification code.");
    } finally {
      setBusy(false);
    }
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
    if (googleAuthInProgress.current) return;
    feedback();
    console.info("[AnySkill Google OAuth] sign-in request", {
      platform: Platform.OS,
      requestReady: Boolean(googleRequest),
      clientId: googleRequest?.clientId ?? null,
      redirectUri: googleRequest?.redirectUri ?? null,
      responseType: googleRequest?.responseType ?? null,
    });
    if (!googleConfigured) {
      setError("Google sign-in is not configured for this platform. Check its OAuth client ID in the mobile environment.");
      return;
    }
    if (!googleRequest) {
      setError("Google sign-in is still initializing. Please try again in a moment.");
      return;
    }
    if (Platform.OS === "web") {
      await startWebGoogleRedirect("signin");
      return;
    }
    googleAuthInProgress.current = true;
    setBusy(true);
    try {
      const result = await promptGoogle();
      console.info("[AnySkill Google OAuth] sign-in response", {
        platform: Platform.OS,
        type: result.type,
        error: result.type === "error" ? result.error?.message ?? null : null,
        returnedIdToken: result.type === "success" ? Boolean(result.params.id_token) : false,
        returnedAuthorizationCode: result.type === "success" ? Boolean(result.params.code) : false,
      });
      if (result.type !== "success") {
        if (result.type === "error") throw new Error(result.error?.message ?? "Google sign-in failed.");
        setError(`Google sign-in was ${result.type}. Please try again.`);
        return;
      }
      const code = result.params.code;
      const codeVerifier = googleRequest.codeVerifier;
      const redirectUri = googleRequest.redirectUri;
      if (!code || !codeVerifier || !redirectUri) {
        throw new Error("Google sign-in did not return the required secure authorization details. Please try again.");
      }
      const googleTokens = await exchangeCodeAsync({
        clientId: googleRequest.clientId,
        code,
        redirectUri,
        extraParams: { code_verifier: codeVerifier },
      }, GOOGLE_DISCOVERY);
      const idToken = googleTokens.idToken;
      if (!idToken) throw new Error("Google's token exchange did not return an ID token. Please try again.");

      const tokens = await apiRequest<Tokens>("/auth/google", {
        method: "POST",
        body: JSON.stringify({ idToken }),
      });
      await saveTokens(tokens);
      await loadAccount();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google sign-in failed.");
    } finally {
      googleAuthInProgress.current = false;
      setBusy(false);
    }
  };

  const connectGoogle = async () => {
    if (googleAuthInProgress.current) return;
    feedback();
    console.info("[AnySkill Google OAuth] link request", {
      platform: Platform.OS,
      requestReady: Boolean(googleRequest),
      clientId: googleRequest?.clientId ?? null,
      redirectUri: googleRequest?.redirectUri ?? null,
      responseType: googleRequest?.responseType ?? null,
    });    if (!googleConfigured) {
      setError("Google sign-in is not configured for this platform. Check its OAuth client ID in the mobile environment.");
      return;
    }
    if (!googleRequest) {
      setError("Google sign-in is still initializing. Please try again in a moment.");
      return;
    }
    if (Platform.OS === "web") {
      await startWebGoogleRedirect("link");
      return;
    }
    googleAuthInProgress.current = true;
    setBusy(true);
    try {
      const result = await promptGoogle();
      console.info("[AnySkill Google OAuth] link response", {
        platform: Platform.OS,
        type: result.type,
        error: result.type === "error" ? result.error?.message ?? null : null,
        returnedIdToken: result.type === "success" ? Boolean(result.params.id_token) : false,
        callbackUrl: result.type === "success" ? result.url : null,
      });
      if (result.type !== "success") {
        if (result.type === "error") throw new Error(result.error?.message ?? "Google account linking failed.");
        setError(`Google account linking was ${result.type}. Please try again.`);
        return;
      }
      const code = result.params.code;
      const codeVerifier = googleRequest.codeVerifier;
      const redirectUri = googleRequest.redirectUri;
      if (!code || !codeVerifier || !redirectUri) {
        throw new Error("Google account linking did not return the required secure authorization details. Please try again.");
      }
      const googleTokens = await exchangeCodeAsync({
        clientId: googleRequest.clientId,
        code,
        redirectUri,
        extraParams: { code_verifier: codeVerifier },
      }, GOOGLE_DISCOVERY);
      const idToken = googleTokens.idToken;
      if (!idToken) throw new Error("Google's token exchange did not return an ID token. Please try again.");
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
      googleAuthInProgress.current = false;
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
      await refreshHomeEligibility();
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
  const canRequestSkill = profileComplete && verified;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.safe}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={s.brandRow}>
            <Image source={require("./assets/branding/anyskill-logo.png")} style={s.brandLogo} resizeMode="contain" accessibilityLabel="AnySkill logo" />
            {account ? <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open account"
              onPress={() => { setActiveTab("account"); setScreen("dashboard"); feedback(); }}
              style={s.headerAvatar}
            >
              {identity?.previews?.ID_SELFIE
                ? <Image source={{ uri: identity.previews.ID_SELFIE }} style={s.headerAvatarImage} resizeMode="cover" accessibilityLabel="Your profile photo" />
                : <Text style={s.headerAvatarText}>{(account.email?.trim()?.[0] ?? "U").toUpperCase()}</Text>}
            </Pressable> : null}
          </View>

          {screen === "welcome" && <WelcomeScreen
            onSignIn={() => goTo("login")}
            onSignUp={() => goTo("register")}
            onGoogle={() => { void continueWithGoogle(); }}
          />}

          {(screen === "register" || screen === "login") && <View style={s.form}>
            <Text style={s.kicker}>{screen === "register" ? "GET STARTED" : "WELCOME BACK"}</Text>
            <Text style={s.formTitle}>{screen === "register" ? "Create your account" : "Sign in to AnySkill"}</Text>
            <Text style={s.subtitle}>{screen === "register" ? "One account gives you access to both operating modes." : "Sign in to continue to your account."}</Text>
            <Field label="Email address" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
            {screen === "login" && <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 12 characters" secureTextEntry />}
            {screen === "register" && <Text style={s.helper}>First, enter only your email address. We will send a six-digit code before asking for any other details.</Text>}
            <Primary label={screen === "register" ? "Send verification code" : "Sign in"} onPress={screen === "register" ? register : login} disabled={busy || !email.trim() || (screen === "login" && password.length < 12)} />
            <View style={s.googleDivider}>
              <View style={s.googleDividerLine} />
              <Text style={s.googleDividerText}>OR</Text>
              <View style={s.googleDividerLine} />
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Continue with Google" onPress={() => { void continueWithGoogle(); }} disabled={busy} style={[s.googleAuthButton, busy && s.disabled]}>
              <Image source={require("./assets/branding/google-sign-in.png")} style={s.googleAuthIcon} resizeMode="contain" accessibilityLabel="Google" />
              <Text style={s.googleAuthText}>Continue with Google</Text>
            </Pressable>
            <Secondary label={screen === "register" ? "I already have an account" : "Create a new account"} onPress={() => goTo(screen === "register" ? "login" : "register")} />
            {screen === "login" && <TextButton label="Forgot password?" onPress={() => goTo("forgot-password")} />}
            <TextButton label="Back" onPress={() => goTo("welcome")} />
          </View>}

          {screen === "verify-otp" && <View style={s.form}>
            <Text style={s.kicker}>CHECK YOUR INBOX</Text>
            <Text style={s.formTitle}>Enter your code</Text>
            <Text style={s.subtitle}>We sent a six-digit code to {email}. It expires in 10 minutes.</Text>
            <View style={s.otpField}>
              <Text style={s.fieldLabel}>Six-digit verification code</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Verification code, ${otp.length} of 6 digits entered. Tap to enter code.`}
                onPress={() => otpInputRef.current?.focus()}
                style={s.otpBoxes}
              >
                {Array.from({ length: 6 }, (_, index) => (
                  <View key={index} style={[
                    s.otpBox,
                    index === otp.length && otp.length < 6 && s.otpBoxActive,
                    otp.length === 6 && s.otpBoxFilled,
                  ]}>
                    <Text style={s.otpDigit}>{otp[index] ?? ""}</Text>
                  </View>
                ))}
                <TextInput
                  ref={otpInputRef}
                  value={otp}
                  onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, 6))}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="sms-otp"
                  maxLength={6}
                  accessibilityLabel="Six-digit verification code"
                  caretHidden
                  style={s.otpInputOverlay}
                />
              </Pressable>
            </View>
            <Primary label="Verify email" onPress={verifyRegistrationOtp} disabled={busy || !/^\d{6}$/.test(otp)} />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || otpResendSeconds > 0 }}
              disabled={busy || otpResendSeconds > 0}
              onPress={resendRegistrationOtp}
              style={s.resendCodeButton}
            >
              <Text style={[s.resendCodeText, (busy || otpResendSeconds > 0) && s.resendCodeDisabled]}>
                {otpResendSeconds > 0
                  ? `Resend code in 00:${String(otpResendSeconds).padStart(2, "0")}`
                  : "Resend code"}
              </Text>
            </Pressable>
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
            onBack={() => { void (async () => { await refreshHomeEligibility(); goTo("dashboard"); })(); }}
            onStartVerification={() => { void startIdentityVerification(); }}
            onIdentityUpdated={refreshHomeEligibility}
            onComplete={async () => { await refreshHomeEligibility(); setActiveTab("home"); setScreen("dashboard"); feedback(); }}
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

      {screen === "dashboard" && account && activeTab === "home" && <>
      {!verified && <View style={s.notice}>
        <Text style={s.noticeTitle}>Account pending verification</Text>
        <Text style={s.noticeText}>Your account is not verified yet. Submit your identity documents for review. You can explore AnySkill, but restricted marketplace actions remain locked until approval.</Text>
      </View>}
      <WelcomeScreen
        showAuthActions={false}
        canRequestSkill={canRequestSkill}
        onRequestSkill={() => {
          feedback();
          if (canRequestSkill) {
            setMode("seeker");
            setScreen("marketplace");
          } else {
            setScreen("onboarding");
          }
        }}
        onSignIn={() => {}}
        onSignUp={() => {}}
        onGoogle={() => {}}
      />
      </>}

          {screen === "dashboard" && account && activeTab === "activities" && <View style={s.form}>
            <Text style={s.kicker}>YOUR WORK</Text>
            <Text style={s.formTitle}>Activities</Text>
            <Text style={s.subtitle}>Your service requests, accepted jobs and completed activity will appear here.</Text>
            <View style={s.emptyState}>
              <Text style={s.emptyStateIcon}>▤</Text>
              <Text style={s.emptyStateTitle}>No activities yet</Text>
              <Text style={s.emptyStateText}>{mode === "seeker" ? "When you request a service, you will be able to follow its progress here." : "When you receive or accept a service request, it will appear here."}</Text>
            </View>
            <Primary label={mode === "seeker" ? "Explore services" : "View available requests"} onPress={() => goTo("marketplace")} />
          </View>}

          {screen === "dashboard" && account && activeTab === "notifications" && <View style={s.form}>
            <Text style={s.kicker}>UPDATES</Text>
            <Text style={s.formTitle}>Notifications</Text>
            <Text style={s.subtitle}>Important request updates, account alerts and messages will appear here.</Text>
            {identity?.latestCase && ["submitted", "pending", "pending_review", "in_review", "under_review"].includes(identity.latestCase.status.toLowerCase()) ? (
              <View style={s.statusCard}>
                <Text style={s.statusLabel}>PROFILE VERIFICATION</Text>
                <Text style={s.statusValue}>Profile submitted for verification</Text>
                <Text style={s.helper}>Your profile and identity documents have been submitted and are awaiting review. We'll update you when the verification process is complete.</Text>
                <Text style={s.helper}>Submitted {new Date(identity.latestCase.submittedAt).toLocaleString()}.</Text>
              </View>
            ) : (
              <View style={s.emptyState}>
                <Text style={s.emptyStateIcon}>♧</Text>
                <Text style={s.emptyStateTitle}>You're all caught up</Text>
                <Text style={s.emptyStateText}>There are no notifications to show right now.</Text>
              </View>
            )}
          </View>}

          {screen === "dashboard" && account && activeTab === "account" && <View style={s.form}>
            <Text style={s.kicker}>ACCOUNT SETTINGS</Text>
            <Text style={s.formTitle}>Your account</Text>
            <Text style={s.subtitle}>{account.email}</Text>
            <View style={s.statusCard}>
              <Text style={s.statusLabel}>EMAIL</Text>
              <Text style={s.statusValue}>{account.emailVerified ? "Verified" : "Not verified"}</Text>
              <View style={s.divider} />
              <Text style={s.statusLabel}>IDENTITY VERIFICATION</Text>
              <Text style={s.statusValue}>{formatStatus(identityStatus)}</Text>
              {identity?.latestCase && <Text style={s.helper}>Request submitted {new Date(identity.latestCase.submittedAt).toLocaleString()}.</Text>}
            </View>
            {verified && <View style={s.successNotice}>
              <Text style={s.successTitle}>Identity verified</Text>
              <Text style={s.successText}>Your identity check is approved.</Text>
            </View>}
            {!verified && <View style={s.notice}>
              <Text style={s.noticeTitle}>Identity verification required for key actions</Text>
              <Text style={s.noticeText}>You can explore AnySkill before verifying. Skill Seekers must verify before submitting a request. Skill Providers must verify before accepting one.</Text>
              {["not_started", "failed", "requires_information"].includes(identityStatus) && <Primary label="Start identity verification request" onPress={startIdentityVerification} disabled={busy} />}
            </View>}
            <Secondary label="Complete or update profile" onPress={() => goTo("onboarding")} />
            <Secondary label="Refresh identity-verification status" onPress={refreshIdentityStatus} />
            {!account.googleLinked && <Secondary label="Connect Google account" onPress={connectGoogle} />}
            <Text style={s.sectionTitle}>Marketplace mode</Text>
            <View style={s.modeList}>
              <ModeCard title="Skill Seeker" description="Request skills and compare provider offers." selected={mode === "seeker"} onPress={() => setMode("seeker")} />
              <ModeCard title="Skill Provider" description="Offer skills and respond to suitable requests." selected={mode === "provider"} onPress={() => setMode("provider")} />
            </View>
            <Secondary label="Sign out" onPress={logout} />
          </View>}

          {message ? <View style={s.successNotice}><Text style={s.successText}>{message}</Text></View> : null}
          {error ? <View style={s.errorNotice}><Text style={s.errorText}>{error}</Text></View> : null}
          {busy ? <ActivityIndicator color={C.primary} style={s.loader} /> : null}
          <Text style={s.footer}>Connecting individuals and businesses through skills.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
      {account && (screen === "dashboard" || screen === "marketplace" || screen === "onboarding") && <View style={s.bottomTabBar}>
        <BottomTab label="Home" icon="⌂" selected={activeTab === "home"} onPress={() => { void (async () => { await refreshHomeEligibility(); setActiveTab("home"); setScreen("dashboard"); feedback(); })(); }} />
        <BottomTab label="Activities" icon="▤" selected={activeTab === "activities"} onPress={() => { setActiveTab("activities"); setScreen("dashboard"); feedback(); }} />
        <BottomTab label="Notifications" icon="♧" selected={activeTab === "notifications"} onPress={() => { setActiveTab("notifications"); setScreen("dashboard"); feedback(); }} />
        <BottomTab label="Account" icon="●" selected={activeTab === "account"} onPress={() => { setActiveTab("account"); setScreen("dashboard"); feedback(); }} />
      </View>}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function BottomTab(p: { label: string; icon: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: p.selected }} onPress={p.onPress} style={s.bottomTab}>
    <Text style={[s.bottomTabIcon, p.selected && s.bottomTabIconSelected]}>{p.icon}</Text>
    <Text style={[s.bottomTabLabel, p.selected && s.bottomTabLabelSelected]}>{p.label}</Text>
  </Pressable>;
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
function ModeCard(p: { title: string; description: string; selected: boolean; onPress: () => void }) {
  return <Pressable onPress={p.onPress} style={[s.modeCard, p.selected && s.modeCardSelected]}>
    <View style={s.modeCardTop}>
      <Text style={s.modeTitle}>{p.title}</Text>
      <View style={[s.radio, p.selected && s.radioSelected]} />
    </View>
    <Text style={s.modeDescription}>{p.description}</Text>
  </Pressable>;
}

const s = StyleSheet.create({
  flex: { flex: 1 }, safe: { flex: 1, backgroundColor: C.bg },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 32 },
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20, paddingHorizontal: 2 },
  brandLogo: { width: 150, height: 52 },
  headerAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#EAF3FF", borderWidth: 2, borderColor: "#0066CC", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  headerAvatarImage: { width: "100%", height: "100%", borderRadius: 21 },
  headerAvatarText: { color: "#0B2545", fontSize: 16, fontWeight: "900" },
  googleDivider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 18 },
  googleDividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  googleDividerText: { color: C.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  googleAuthButton: { minHeight: 53, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderWidth: 1, borderColor: C.border, borderRadius: 15, backgroundColor: C.surface, paddingHorizontal: 14, marginTop: 2 },
  googleAuthIcon: { width: 20, height: 20 },
  googleAuthText: { color: C.ink, fontSize: 13, fontWeight: "800" },
  hero: { marginTop: 4, marginBottom: 28, backgroundColor: "#123F32", borderRadius: 26, paddingHorizontal: 23, paddingTop: 23, paddingBottom: 20, overflow: "hidden" },
  heroPill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.12)", marginBottom: 21 },
  heroDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#9EE2BD" },
  heroPillText: { color: "#CDEBDD", fontSize: 9, fontWeight: "800", letterSpacing: 1.05 },
  kicker: { color: C.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.5, marginBottom: 12 },
  heading: { color: "#FFFFFF", fontSize: 34, lineHeight: 40, fontWeight: "900", letterSpacing: -1.15 },
  heroSubtitle: { color: "#D8E8DF", fontSize: 14, lineHeight: 22, marginTop: 13, maxWidth: 300 },
  heroFoot: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 22, paddingTop: 15, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.18)" },
  heroFootText: { color: "#D3E9DD", fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  heroFootDivider: { color: "#85B69D", fontSize: 14 },
  sectionHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 3 },
  optional: { color: C.muted, fontSize: 8, fontWeight: "800", letterSpacing: 0.8 },
  formTitle: { color: C.ink, fontSize: 28, lineHeight: 34, fontWeight: "900", letterSpacing: -0.8 },
  subtitle: { color: C.muted, fontSize: 15, lineHeight: 23, marginTop: 12, marginBottom: 22 },
  sectionTitle: { color: C.ink, fontSize: 18, fontWeight: "800", marginBottom: 13, marginTop: 18 },
  modeList: { gap: 10, marginBottom: 14 }, modeCard: { backgroundColor: C.surface, borderColor: C.border, borderWidth: 1, borderRadius: 18, padding: 17, shadowColor: "#1D3528", shadowOpacity: 0.035, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  modeCardSelected: { borderColor: C.primary, borderWidth: 1.7, padding: 16.3, backgroundColor: "#EFF7F1" },
  modeCardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modeTitle: { color: C.ink, fontSize: 16, fontWeight: "800", letterSpacing: -0.2 }, modeDescription: { color: C.muted, fontSize: 13, lineHeight: 19, marginTop: 7 },
  radio: { width: 19, height: 19, borderRadius: 10, borderWidth: 1.5, borderColor: C.border }, radioSelected: { borderWidth: 6, borderColor: C.primary },
  form: { marginTop: 5, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 24, padding: 20, paddingTop: 23, shadowColor: "#173B2C", shadowOpacity: 0.045, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  field: { marginBottom: 17 }, fieldLabel: { color: C.ink, fontSize: 12, fontWeight: "800", marginBottom: 8, letterSpacing: 0.1 },
  otpField: { marginBottom: 17 },
  resendCodeButton: { alignItems: "center", justifyContent: "center", paddingVertical: 13, marginTop: 2 },
  resendCodeText: { color: C.primary, fontSize: 13, fontWeight: "800" },
  resendCodeDisabled: { color: C.muted, opacity: 0.65 },
  otpBoxes: { position: "relative", flexDirection: "row", justifyContent: "space-between", gap: 8, minHeight: 62 },
  otpBox: { flex: 1, height: 62, alignItems: "center", justifyContent: "center", borderWidth: 1.4, borderColor: C.border, borderRadius: 14, backgroundColor: "#FBFCFB" },
  otpBoxActive: { borderColor: C.primary, borderWidth: 2, backgroundColor: "#EFF7F1" },
  otpBoxFilled: { borderColor: C.primary, backgroundColor: "#F1F8F3" },
  otpDigit: { color: C.ink, fontSize: 25, fontWeight: "800", fontVariant: ["tabular-nums"] },
  otpInputOverlay: { ...StyleSheet.absoluteFill, width: "100%", height: "100%", opacity: 0, color: "transparent", backgroundColor: "transparent" },
  input: { minHeight: 54, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 15, color: C.ink, backgroundColor: "#FBFCFB", fontSize: 15 },
  helper: { color: C.muted, fontSize: 12, lineHeight: 18, marginTop: 7, marginBottom: 14 },
  primary: { minHeight: 55, borderRadius: 15, backgroundColor: C.primary, alignItems: "center", justifyContent: "center", marginTop: 9, paddingHorizontal: 18, shadowColor: "#124331", shadowOpacity: 0.16, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  primaryText: { color: "#FFF", fontSize: 14, fontWeight: "900", letterSpacing: 0.1 }, disabled: { opacity: 0.45, shadowOpacity: 0 },
  secondary: { minHeight: 53, borderRadius: 15, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center", marginTop: 10, backgroundColor: C.surface, paddingHorizontal: 12 },
  secondaryText: { color: C.primary, fontSize: 13, fontWeight: "800" }, textButton: { alignItems: "center", paddingVertical: 15 },
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
  emptyState: { alignItems: "center", justifyContent: "center", backgroundColor: "#F8FAF8", borderWidth: 1, borderColor: C.border, borderRadius: 18, paddingHorizontal: 22, paddingVertical: 34, marginTop: 8, marginBottom: 12 },
  emptyStateIcon: { color: C.primary, fontSize: 32, marginBottom: 12 }, emptyStateTitle: { color: C.ink, fontSize: 16, fontWeight: "900", marginBottom: 7 },
  emptyStateText: { color: C.muted, fontSize: 12, lineHeight: 19, textAlign: "center" },
  bottomTabBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 9, paddingBottom: Platform.OS === "ios" ? 20 : 10, paddingHorizontal: 5 },
  bottomTab: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", gap: 3 },
  bottomTabIcon: { color: C.muted, fontSize: 21, lineHeight: 24, fontWeight: "700" }, bottomTabIconSelected: { color: C.primary },
  bottomTabLabel: { color: C.muted, fontSize: 10, fontWeight: "700" }, bottomTabLabelSelected: { color: C.primary, fontWeight: "900" },
  footer: { color: C.muted, fontSize: 11, textAlign: "center", marginTop: 24, letterSpacing: 0.15 },
});