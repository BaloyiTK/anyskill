import { useEffect, useRef, useState } from "react";
import { exchangeCodeAsync, ResponseType } from "expo-auth-session";
import { useAuthRequest } from "expo-auth-session/providers/google";
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
  bg: "#F5F7F5", surface: "#FFFFFF", ink: "#15251E", muted: "#66756D",
  primary: "#176B55", border: "#E1E8E3", soft: "#E8F4ED",
  warning: "#FFF6E4", warningInk: "#78551A", danger: "#A12D2D",
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

  const loadAccount = async () => {
    const me = await apiRequest<AccountSummary>("/auth/me", {}, true);
    setAccount(me);
    setIdentity(null);
    setScreen("dashboard");

    // Identity-verification status is supplementary account data. A failure
    // here must not turn a successful authentication into a failed login.
    try {
      const verification = await apiRequest<IdentitySummary>("/identity-verification/status", {}, true);
      setIdentity(verification);
    } catch {
      setMessage("You are signed in, but identity-verification status could not be loaded. You can refresh it from your dashboard.");
    }
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
            method: "POST",
            body: JSON.stringify(authorizationCode),
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
    if (googleAuthInProgress.current) return;
    feedback();
    console.warn("[AnySkill Google OAuth] sign-in request", {
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
        callbackUrl: result.type === "success" ? result.url : null,
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
    console.warn("[AnySkill Google OAuth] link request", {
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
            <Text style={s.brandTag}>SKILLS MADE SIMPLE</Text>
          </View>

          {screen === "welcome" && <>
            <View style={s.hero}>
              <View style={s.heroPill}><View style={s.heroDot} /><Text style={s.heroPillText}>YOUR LOCAL SKILLS MARKETPLACE</Text></View>
              <Text style={s.heading}>Find the right person.{"\n"}Get it done.</Text>
              <Text style={s.heroSubtitle}>Discover skilled people, agree on the work, and get things moving — all in one place.</Text>
              <View style={s.heroFoot}><Text style={s.heroFootText}>FIND</Text><Text style={s.heroFootDivider}>·</Text><Text style={s.heroFootText}>HIRE</Text><Text style={s.heroFootDivider}>·</Text><Text style={s.heroFootText}>GET IT DONE</Text></View>
            </View>
            <View style={s.sectionHeadingRow}><Text style={s.sectionTitle}>How will you use AnySkill?</Text><Text style={s.optional}>YOU CAN SWITCH LATER</Text></View>
            <View style={s.modeList}>
              <ModeCard title="Skill Seeker" description="Find available people with the skills you need." selected={mode === "seeker"} onPress={() => setMode("seeker")} />
              <ModeCard title="Skill Provider" description="Offer your skills, set your rate and receive work requests." selected={mode === "provider"} onPress={() => setMode("provider")} />
            </View>
            <Text style={s.helper}>One account gives you access to both modes.</Text>
            <Primary label="Create your free account" onPress={() => goTo("register")} />
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
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 32 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 20, paddingHorizontal: 2 },
  brandMark: { width: 42, height: 42, borderRadius: 14, backgroundColor: C.primary, alignItems: "center", justifyContent: "center", shadowColor: "#123D2E", shadowOpacity: 0.16, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  brandMarkText: { color: "#FFF", fontSize: 25, fontWeight: "900" }, brandName: { color: C.ink, fontSize: 21, fontWeight: "900", letterSpacing: -0.5 },
  spacer: { flex: 1 }, brandTag: { color: C.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1.15 },
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
  footer: { color: C.muted, fontSize: 11, textAlign: "center", marginTop: 24, letterSpacing: 0.15 },
});
