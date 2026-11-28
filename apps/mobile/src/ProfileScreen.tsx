import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest } from "./api";

type Mode = "seeker" | "provider";
type ProfileSkill = {
  category: string;
  description?: string;
  yearsOfExperience?: string | number;
  hourlyRate?: string | number | null;
  assessmentRequired?: boolean;
  assessmentFee?: string | number | null;
  licencesQualifications?: Array<{ name: string; attachmentUrl: string; attachmentName?: string }>;
  portfolio?: Array<{ title: string; description: string; links?: string[]; imageUrls?: string[]; linkTitle?: string; linkUrl?: string }>;
  isPaused?: boolean;
};
type SkillReviewStatus = { category: string; status: string; decisionReason?: string | null; submittedAt?: string | null; reviewedAt?: string | null };
type Identity = { status?: string; latestCase?: { status?: string } | null };
type SavedPaymentMethod = { id: string; provider: string; cardBrand?: string | null; lastFour?: string | null; status: string; isDefault: boolean; createdAt: string };
type OnboardingProfile = {
  profile?: { firstName?: string; lastName?: string; phone?: string; suburb?: string; city?: string; province?: string; country?: string; marketplaceRoles?: string[] };
  skills?: ProfileSkill[];
  skillReviewStatuses?: SkillReviewStatus[];
};
type ProviderProfile = {
  publicName?: string;
  hourlyRate?: string | number | null;
  assessmentFee?: string | number | null;
  assessmentRequired?: boolean;
  serviceAreas?: string[];
  isAvailable?: boolean;
  skillCategories?: string[];
  ratings?: {
    overall: number;
    overallReviewCount: number;
    overallIsRated: boolean;
    skills: Array<{ category: string; rating: number | null; reviewCount: number; displayRating: number; isRated: boolean }>;
  };
};

type Props = {
  email: string;
  mode: Mode;
  providerStatus: string;
  seekerStatus: string;
  onModeChange: (mode: Mode) => void;
  onAccountSettings: () => void;
  onStartVerification: () => void;
};

const colors = {
  ink: "#12313A", muted: "#657A80", primary: "#075B78", border: "#E2EAEC",
  surface: "#FFFFFF", bg: "#F4F8F9", green: "#23764D", greenBg: "#EAF6EF",
  amber: "#95651D", amberBg: "#FFF5E4",
};

const statusLabel = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function ProfileScreen({ email, mode, providerStatus, seekerStatus, onAccountSettings, onStartVerification }: Props) {
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [provider, setProvider] = useState<ProviderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingSkills, setEditingSkills] = useState(false);
  const [skillDrawerVisible, setSkillDrawerVisible] = useState(false);
  const [skillDrawerMode, setSkillDrawerMode] = useState<"view" | "edit" | "add">("view");
  const [selectedSkillIndex, setSelectedSkillIndex] = useState<number | null>(null);
  const [removedSkillName, setRemovedSkillName] = useState("");
  const [skillDraft, setSkillDraft] = useState<ProfileSkill[]>([]);
  const [skillSearch, setSkillSearch] = useState("");
  const [savingSkills, setSavingSkills] = useState(false);
  const [skillError, setSkillError] = useState("");
  const [skillMessage, setSkillMessage] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<SavedPaymentMethod[]>([]);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentConsent, setPaymentConsent] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [paymentNotice, setPaymentNotice] = useState("");
  const [paymentFormVisible, setPaymentFormVisible] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [onboarding, verification, providerProfile, savedMethods] = await Promise.all([
        apiRequest<OnboardingProfile>("/profile/onboarding", {}, true),
        apiRequest<Identity>("/identity-verification/status", {}, true),
        apiRequest<ProviderProfile | null>("/marketplace/provider-profile", {}, true).catch(() => null),
        mode === "seeker" ? apiRequest<SavedPaymentMethod[]>("/marketplace/payment-methods", {}, true).catch(() => []) : Promise.resolve([]),
      ]);
      setProfile(onboarding);
      setIdentity(verification);
      setProvider(providerProfile);
      setPaymentMethods(savedMethods);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your profile.");
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => { void refresh(); }, [refresh]);

  const identityValue = identity?.latestCase?.status ?? identity?.status ?? "not_started";
  const identityVerified = ["verified", "approved"].includes(identityValue.toLowerCase());
  const skills = profile?.skills ?? [];
  const skillNames = skills.map((skill) => skill.category?.trim()).filter((value): value is string => Boolean(value));
  const portfolioCount = skills.reduce((total, skill) => total + (skill.portfolio?.length ?? 0), 0);
  const approvedSkillCount = (profile?.skillReviewStatuses ?? []).filter((item) => item.status === "APPROVED").length;
  const pendingSkillCount = (profile?.skillReviewStatuses ?? []).filter((item) => item.status === "PENDING" || item.status === "UNDER_REVIEW").length;
  const rejectedSkillCount = (profile?.skillReviewStatuses ?? []).filter((item) => item.status === "REJECTED").length;
  const skillCatalogue = ["Accounting", "Automotive Repair", "Beauty Therapy", "Carpentry", "Cleaning", "Driving", "Electrical", "Graphic Design", "Hairdressing", "Landscaping", "Painting", "Photography", "Plumbing", "Software Development", "Tutoring", "Web Development"];
  const cloneSkills = () => skills.map((skill) => ({ ...skill, licencesQualifications: (skill.licencesQualifications ?? []).map((item) => ({ ...item })), portfolio: (skill.portfolio ?? []).map((item) => ({ ...item, links: [...(item.links ?? [])], imageUrls: [...(item.imageUrls ?? [])] })) }));
  const openSkillDrawer = (index: number, drawerMode: "view" | "edit") => {
    setSkillDraft(cloneSkills()); setSelectedSkillIndex(index); setRemovedSkillName(""); setSkillDrawerMode(drawerMode);
    setSkillSearch(""); setSkillError(""); setSkillMessage(""); setEditingSkills(drawerMode === "edit"); setSkillDrawerVisible(true);
  };
  const startSkillEditing = () => {
    setSkillDraft(cloneSkills()); setSelectedSkillIndex(null); setRemovedSkillName(""); setSkillDrawerMode("add");
    setSkillSearch(""); setSkillError(""); setSkillMessage(""); setEditingSkills(true); setSkillDrawerVisible(true);
  };
  const closeSkillDrawer = () => { if (savingSkills) return; setSkillDrawerVisible(false); setSkillError(""); setSkillMessage(""); };
  const reviewForSkill = (category: string) => profile?.skillReviewStatuses?.find((item) => item.category.trim().toLowerCase() === category.trim().toLowerCase());
  const updateSkill = (index: number, patch: Partial<ProfileSkill>) => setSkillDraft((current) => current.map((skill, itemIndex) => itemIndex === index ? { ...skill, ...patch } : skill));
  const toggleSkillPaused = async (index: number) => {
    const currentSkill = skills[index];
    if (!currentSkill || reviewForSkill(currentSkill.category)?.status !== "APPROVED") return;
    const isPaused = !currentSkill.isPaused;
    const next = cloneSkills().map((skill, itemIndex) =>
      itemIndex === index ? { ...skill, isPaused } : skill,
    );
    setSkillDraft(next); setSavingSkills(true); setSkillError("");
    try {
      const result = await apiRequest<OnboardingProfile>("/profile/onboarding", { method: "PATCH", body: JSON.stringify({ skills: next }) }, true);
      setProfile(result);
      setSkillMessage(isPaused ? `${currentSkill.category} has been paused.` : `${currentSkill.category} is active again.`);
    } catch (e) { setSkillError(e instanceof Error ? e.message : "Could not update this skill."); setSkillDraft(cloneSkills()); }
    finally { setSavingSkills(false); }
  };
  const updateQualification = (skillIndex: number, qualificationIndex: number, patch: Partial<{ name: string; attachmentUrl: string; attachmentName?: string }>) => setSkillDraft((current) => current.map((skill, index) => index !== skillIndex ? skill : { ...skill, licencesQualifications: (skill.licencesQualifications ?? []).map((item, qIndex) => qIndex === qualificationIndex ? { ...item, ...patch } : item) }));
  const updatePortfolio = (skillIndex: number, portfolioIndex: number, patch: Partial<{ title: string; description: string; links?: string[]; imageUrls?: string[]; linkTitle?: string; linkUrl?: string }>) => setSkillDraft((current) => current.map((skill, index) => index !== skillIndex ? skill : { ...skill, portfolio: (skill.portfolio ?? []).map((item, pIndex) => pIndex === portfolioIndex ? { ...item, ...patch } : item) }));
  const addSkill = (category: string) => {
    const normalized = category.trim();
    if (!normalized || skillDraft.length >= 5 || skillDraft.some((skill) => skill.category?.trim().toLowerCase() === normalized.toLowerCase())) return;
    setSkillDraft((current) => [...current, { category: normalized, description: "", yearsOfExperience: "", hourlyRate: "", assessmentRequired: true, assessmentFee: "0", licencesQualifications: [], portfolio: [] }]);
    setSkillSearch(""); setSkillError("");
  };
  const cleanedSkillDraft = () => skillDraft.map((skill) => ({
    ...skill,
    category: String(skill.category ?? "").trim(),
    description: String(skill.description ?? "").trim(),
    yearsOfExperience: String(skill.yearsOfExperience ?? "").trim(),
    licencesQualifications: (skill.licencesQualifications ?? []).filter((item) => item.name.trim() || item.attachmentUrl.trim()),
    portfolio: (skill.portfolio ?? []).filter((item) => item.title.trim() || item.description.trim() || item.linkUrl?.trim() || item.links?.length || item.imageUrls?.length),
  })).filter((skill) => skill.category);
  const persistSkillDraft = async () => {
    const cleaned = cleanedSkillDraft();
    if (cleaned.length > 5) throw new Error("You can add a maximum of 5 skills.");
    if (new Set(cleaned.map((skill) => skill.category.toLowerCase())).size !== cleaned.length) throw new Error("Each skill can only be added once.");
    const result = await apiRequest<OnboardingProfile>("/profile/onboarding", { method: "PATCH", body: JSON.stringify({ skills: cleaned }) }, true);
    setProfile(result);
    return cleaned;
  };
  const saveSkills = async () => {
    setSavingSkills(true); setSkillError(""); setSkillMessage("");
    try {
      await persistSkillDraft();
      setEditingSkills(false); setSkillDrawerVisible(false); setSkillSearch(""); setSkillMessage("Your skill changes have been saved.");
    } catch (e) { setSkillError(e instanceof Error ? e.message : "Could not save your skills."); }
    finally { setSavingSkills(false); }
  };
  const submitSkillsForReview = async () => {
    setSavingSkills(true); setSkillError(""); setSkillMessage("");
    try {
      await persistSkillDraft();
      await apiRequest("/profile/onboarding/submit", { method: "POST", body: "{}" }, true);
      const refreshed = await apiRequest<OnboardingProfile>("/profile/onboarding", {}, true);
      setProfile(refreshed); setSkillDraft(refreshed.skills ?? []);
      setEditingSkills(false); setSkillDrawerVisible(false); setSkillSearch(""); setSkillMessage("Your skill changes have been submitted for review.");
    } catch (e) { setSkillError(e instanceof Error ? e.message : "Could not submit your skills for review."); }
    finally { setSavingSkills(false); }
  };
  const refreshPaymentMethods = async () => {
    setPaymentLoading(true); setPaymentError("");
    try {
      const methods = await apiRequest<SavedPaymentMethod[]>("/marketplace/payment-methods", {}, true);
      setPaymentMethods(methods);
      setPaymentNotice("Your saved payment methods have been refreshed.");
    } catch (e) { setPaymentError(e instanceof Error ? e.message : "Could not load saved cards."); }
    finally { setPaymentLoading(false); }
  };
  const addPaymentCard = async () => {
    if (!paymentConsent || paymentBusy) return;
    setPaymentBusy(true); setPaymentError(""); setPaymentNotice("");
    try {
      const result = await apiRequest<{ checkoutUrl: string }>("/marketplace/payment-methods/payfast/setup", {
        method: "POST", body: JSON.stringify({ accepted: true }),
      }, true);
      await Linking.openURL(result.checkoutUrl);
      setPaymentFormVisible(false);
      setPaymentNotice("PayFast has opened securely. Your card will appear here after PayFast confirms registration.");
    } catch (e) { setPaymentError(e instanceof Error ? e.message : "Could not start secure card registration."); }
    finally { setPaymentBusy(false); }
  };
  const chooseDefaultCard = async (methodId: string) => {
    setPaymentBusy(true); setPaymentError(""); setPaymentNotice("");
    try {
      const result = await apiRequest<{ paymentMethods: SavedPaymentMethod[] }>(`/marketplace/payment-methods/${methodId}/default`, { method: "POST", body: "{}" }, true);
      setPaymentMethods(result.paymentMethods);
      setPaymentNotice("Your default payment card has been updated.");
    } catch (e) { setPaymentError(e instanceof Error ? e.message : "Could not update your default card."); }
    finally { setPaymentBusy(false); }
  };
  const removePaymentCard = async (methodId: string) => {
    setPaymentBusy(true); setPaymentError(""); setPaymentNotice("");
    try {
      await apiRequest(`/marketplace/payment-methods/${methodId}`, { method: "DELETE" }, true);
      await refreshPaymentMethods();
      setPaymentNotice("The card was removed from your AnySkill profile.");
    } catch (e) { setPaymentError(e instanceof Error ? e.message : "Could not remove this card."); }
    finally { setPaymentBusy(false); }
  };

  const personName = [profile?.profile?.firstName, profile?.profile?.lastName].filter(Boolean).join(" ");
  const location = [profile?.profile?.suburb, profile?.profile?.city, profile?.profile?.province, profile?.profile?.country].filter(Boolean).join(", ");
  const roleStatus = mode === "provider" ? providerStatus : seekerStatus;

  const rows = [
    { id: "personal", title: "Personal information", summary: personName || email, detail: [personName, profile?.profile?.phone, location].filter(Boolean).join("\n") || "Your personal details will appear here once saved." },
    { id: "identity", title: "Identity verification", summary: identityVerified ? "Verified" : statusLabel(identityValue), detail: identityVerified ? "Your identity verification has been approved." : "Complete or check your identity verification to unlock protected marketplace actions." },
    ...(mode === "provider" ? [
      { id: "skills", title: "Skills & Portfolio", summary: `${skillNames.length} skills · ${approvedSkillCount} approved · ${pendingSkillCount} pending · ${rejectedSkillCount} rejected`, detail: skillNames.length ? skills.map((skill) => {
        const review = profile?.skillReviewStatuses?.find((item) => item.category.trim().toLowerCase() === skill.category.trim().toLowerCase());
        const parts = [`${skill.category} — ${statusLabel(review?.status ?? "NOT_SUBMITTED")}`];
        if (skill.hourlyRate != null && String(skill.hourlyRate).trim()) parts.push(`Rate: R${skill.hourlyRate}/hour`);
        parts.push(skill.assessmentRequired === false ? "No assessment" : `Assessment required · R${skill.assessmentFee ?? 0}`);
        if (skill.yearsOfExperience) parts.push(`Experience: ${skill.yearsOfExperience}`);
        if (skill.description) parts.push(skill.description);
        if (review?.decisionReason) parts.push(`Review feedback: ${review.decisionReason}`);
        return parts.join("\n");
      }).join("\n\n") + `\n\n${portfolioCount} portfolio entries` : "No skills have been added yet. Add your skills and supporting details here." },
      { id: "areas", title: "Service areas", summary: provider?.serviceAreas?.length ? provider.serviceAreas.join(", ") : location || "Not configured", detail: provider?.serviceAreas?.length ? provider.serviceAreas.join("\n") : "Your service locations will appear here when configured." },
      { id: "availability", title: "Availability", summary: provider?.isAvailable ? "Online" : "Offline", detail: provider?.isAvailable ? "You are currently available to receive matching service requests." : "You are currently offline and will not receive new matching requests." },
    ] : [
      { id: "payments", title: "Payment methods", summary: paymentMethods.length ? `${paymentMethods.length} saved card${paymentMethods.length === 1 ? "" : "s"}` : "No saved cards", detail: "Manage the card PayFast can use when you approve completed service work." },
      { id: "addresses", title: "Addresses & locations", summary: location || "No saved address", detail: location || "Your saved addresses and preferred service locations will appear here." },
    ]),
  ];

  return (
    <>
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{(personName || email || "U").split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</Text></View>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>YOUR ACCOUNT</Text>
          <Text style={styles.title}>My Profile</Text>
          <Text style={styles.subtitle}>Manage your profile and account information</Text>
        </View>
        <View style={styles.approvedBadge}><Text style={styles.approvedText}>{statusLabel(roleStatus)}</Text></View>
      </View>

      {mode === "provider" && provider ? <View style={styles.ratingsCard}>
        <Text style={styles.ratingsTitle}>Your AnySkill ratings</Text>
        <View style={styles.overallRating}>
          <Text style={styles.overallValue}>{(provider.ratings?.overall ?? 5).toFixed(1)} ★</Text>
          <View style={styles.overallCopy}>
            <Text style={styles.ratingLabel}>Overall platform rating</Text>
            <Text style={styles.ratingHint}>
              {provider.ratings?.overallIsRated
                ? `${provider.ratings.overallReviewCount} customer reviews`
                : "5.0 starting display · Not yet rated"}
            </Text>
          </View>
        </View>
        {(provider.ratings?.skills ?? (provider.skillCategories ?? skillNames).map((category) => ({
          category, rating: null, reviewCount: 0, displayRating: 5, isRated: false,
        }))).map((item) => <View key={item.category} style={styles.ratingSkillRow}>
          <Text style={styles.ratingSkillName}>{item.category}</Text>
          <Text style={styles.ratingSkillValue}>{item.displayRating.toFixed(1)} ★</Text>
          <Text style={styles.ratingHint}>{item.isRated ? `${item.reviewCount} reviews` : "Not yet rated"}</Text>
        </View>)}
      </View> : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Profile information</Text>
        <Text style={styles.sectionHint}>Select a section to view its details</Text>
      </View>

      {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : rows.map((item) => {
        const isExpanded = expanded === item.id;
        const isIdentity = item.id === "identity";
        const isSkills = item.id === "skills";
        const isPayments = item.id === "payments";
        return (
          <View key={item.id} style={styles.rowCard}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: isExpanded }} onPress={() => setExpanded(isExpanded ? null : item.id)} style={styles.rowButton}>
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                <Text style={styles.rowSummary} numberOfLines={1}>{item.summary}</Text>
              </View>
              {isIdentity ? <View style={[styles.statusBadge, identityVerified ? styles.goodBadge : styles.pendingBadge]}><Text style={[styles.statusText, identityVerified ? styles.goodText : styles.pendingText]}>{identityVerified ? "Verified" : "Review"}</Text></View> : null}
              <Text style={styles.chevron}>{isExpanded ? "−" : "+"}</Text>
            </Pressable>
            {isExpanded ? <View style={styles.detail}>
              {!isSkills && !isPayments ? <Text style={styles.detailText}>{item.detail}</Text> : null}
              {isIdentity && !identityVerified ? <Pressable accessibilityRole="button" onPress={onStartVerification} style={styles.detailAction}><Text style={styles.detailActionText}>Open verification</Text></Pressable> : null}
              {isPayments ? <View style={styles.paymentManager}>
                <Text style={styles.detailText}>Cards are registered on PayFast's secure hosted page. AnySkill stores a protected token and masked card details, never your full card number or CVV.</Text>
                {paymentMethods.length ? paymentMethods.map((method) => <View key={method.id} style={styles.paymentCard}>
                  <View style={styles.paymentCardCopy}>
                    <Text style={styles.paymentCardTitle}>{method.cardBrand || "Bank card"}{method.lastFour ? ` ending ••${method.lastFour}` : ""}</Text>
                    <Text style={styles.paymentCardHint}>{method.isDefault ? "Default card · used for approved completed jobs" : "Saved card"}</Text>
                  </View>
                  {method.isDefault ? <View style={styles.statusBadge}><Text style={[styles.statusText, styles.goodText]}>DEFAULT</Text></View> : <Pressable disabled={paymentBusy} onPress={() => void chooseDefaultCard(method.id)} style={styles.paymentAction}><Text style={styles.paymentActionText}>Make default</Text></Pressable>}
                  <Pressable disabled={paymentBusy} onPress={() => void removePaymentCard(method.id)} style={styles.paymentRemove}><Text style={styles.paymentRemoveText}>Remove</Text></Pressable>
                </View>) : <Text style={styles.detailText}>No saved cards yet. Add a card so it is ready when you approve a completed job.</Text>}
                <Pressable accessibilityRole="button" disabled={paymentBusy} onPress={() => { setPaymentError(""); setPaymentNotice(""); setPaymentFormVisible(true); }} style={[styles.detailAction, paymentBusy && styles.skillDisabled]}>
                  <Text style={styles.detailActionText}>＋ Add payment card</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={paymentLoading} onPress={() => void refreshPaymentMethods()} style={styles.paymentRefresh}>
                  <Text style={styles.paymentRefreshText}>{paymentLoading ? "Refreshing…" : "I've completed setup — refresh cards"}</Text>
                </Pressable>
                <Text style={styles.skillLimitHint}>Card registration uses PayFast tokenization with a R0.00 initial amount. Some banks may show a temporary R1–R5 authorisation that is returned by the bank.</Text>
                {!!paymentNotice && <Text style={styles.skillSuccess}>{paymentNotice}</Text>}
                {!!paymentError && <Text style={styles.skillError}>{paymentError}</Text>}
              </View> : null}
              {isSkills ? <View style={styles.skillManager}>
                {skills.length ? skills.map((skill, index) => {
                  const review = reviewForSkill(skill.category);
                  const reviewStatus = review?.status ?? "NOT_SUBMITTED";
                  const statusStyle = reviewStatus === "APPROVED" ? styles.goodBadge : reviewStatus === "REJECTED" ? styles.rejectedBadge : reviewStatus === "PENDING" || reviewStatus === "UNDER_REVIEW" ? styles.pendingBadge : styles.neutralBadge;
                  const statusTextStyle = reviewStatus === "APPROVED" ? styles.goodText : reviewStatus === "REJECTED" ? styles.rejectedText : reviewStatus === "PENDING" || reviewStatus === "UNDER_REVIEW" ? styles.pendingText : styles.neutralText;
                  return <View key={skill.category.toLowerCase()} style={[styles.profileSkillRow, skill.isPaused && styles.profileSkillPaused]}>
                    <View style={styles.profileSkillCopy}>
                      <Text style={styles.profileSkillName}>{skill.category}{skill.isPaused ? " · Paused" : ""}</Text>
                      <View style={[styles.skillStatusBadge, statusStyle]}><Text style={[styles.skillStatusText, statusTextStyle]}>{statusLabel(reviewStatus)}</Text></View>
                    </View>
                    <View style={styles.skillIconActions}>
                      <Pressable accessibilityRole="button" accessibilityLabel={`View ${skill.category}`} onPress={() => openSkillDrawer(index, "view")} style={styles.skillIconButton}><Text style={styles.skillViewIcon}>👁</Text></Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${skill.category}`} onPress={() => openSkillDrawer(index, "edit")} style={styles.skillIconButton}><Text style={styles.skillEditIcon}>✎</Text></Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel={`${skill.isPaused ? "Resume" : "Pause"} ${skill.category}`} accessibilityState={{ disabled: savingSkills || reviewStatus !== "APPROVED" }} disabled={savingSkills || reviewStatus !== "APPROVED"} onPress={() => void toggleSkillPaused(index)} style={[styles.skillIconButton, skill.isPaused && styles.skillPausedButton, reviewStatus !== "APPROVED" && styles.skillDisabled]}><Text style={styles.skillPauseIcon}>{skill.isPaused ? "▶" : "Ⅱ"}</Text></Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${skill.category}`} disabled={savingSkills} onPress={() => { const next = cloneSkills().filter((_, itemIndex) => itemIndex !== index); setSkillDraft(next); setRemovedSkillName(skill.category); setSkillError(""); setSkillMessage(""); setEditingSkills(true); setSkillDrawerMode("edit"); setSelectedSkillIndex(null); setSkillDrawerVisible(true); }} style={styles.skillRemoveButton}><Text style={styles.skillRemoveIcon}>×</Text></Pressable>
                    </View>
                  </View>;
                }) : <Text style={styles.skillLimitHint}>No skills added yet. Add your first skill to your Provider profile.</Text>}
                <Pressable accessibilityRole="button" disabled={skills.length >= 5} onPress={startSkillEditing} style={[styles.detailAction, skills.length >= 5 && styles.skillDisabled]}><Text style={styles.detailActionText}>＋ Add skill</Text></Pressable>
                <Text style={styles.skillLimitHint}>Up to 5 skills · Manage each skill separately</Text>
              </View> : null}

            </View> : null}
          </View>
        );
      })}

      {!loading && !error && mode === "provider" && !provider && <Text style={styles.helper}>Your Provider service profile has not been configured yet.</Text>}
      {!!error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => void refresh()}><Text style={styles.retry}>Try again</Text></Pressable></View>}

      <Pressable accessibilityRole="button" onPress={onAccountSettings} style={styles.settingsButton}>
        <Text style={styles.settingsTitle}>Account settings</Text>
        <Text style={styles.settingsCopy}>Email, marketplace roles, security and account controls</Text>
        <Text style={styles.settingsArrow}>›</Text>
      </Pressable>
    </ScrollView>
    <Modal visible={paymentFormVisible} transparent animationType="slide" onRequestClose={() => { if (!paymentBusy) setPaymentFormVisible(false); }} statusBarTranslucent>
      <View style={styles.paymentModalBackdrop}>
        <View style={styles.paymentModal}>
          <View style={styles.paymentModalHeader}>
            <View style={styles.paymentModalCopy}>
              <Text style={styles.paymentModalEyebrow}>SECURE PAYMENT METHOD</Text>
              <Text style={styles.paymentModalTitle}>Add a payment card</Text>
              <Text style={styles.paymentModalSubtitle}>Register a card securely with PayFast for future approved service payments.</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close add card form" disabled={paymentBusy} onPress={() => setPaymentFormVisible(false)} style={styles.drawerClose}><Text style={styles.drawerCloseText}>×</Text></Pressable>
          </View>
          <View style={styles.paymentFormBody}>
            <View style={styles.paymentAcceptedCards}>
              <Text style={styles.paymentAcceptedTitle}>Accepted card types</Text>
              <View style={styles.paymentBrandRow}>
                <View style={styles.paymentBrand}><Text style={styles.paymentBrandVisa}>VISA</Text></View>
                <View style={styles.paymentBrand}><Text style={styles.paymentBrandMaster}>mastercard</Text></View>
              </View>
            </View>
            <View style={styles.paymentSecureNote}>
              <Text style={styles.paymentSecureTitle}>Your card details stay with PayFast</Text>
              <Text style={styles.paymentSecureText}>When you continue, PayFast securely displays the card-entry form. AnySkill never receives or stores your full card number or CVV. Only a protected payment token and masked card details are saved after PayFast confirms registration.</Text>
            </View>
            <Pressable accessibilityRole="button" disabled={paymentBusy || paymentLoading} onPress={() => setPaymentConsent((value) => !value)} style={styles.paymentConsentRow}>
              <View style={[styles.paymentConsentBox, paymentConsent && styles.paymentConsentChecked]}><Text style={styles.paymentConsentTick}>{paymentConsent ? "✓" : ""}</Text></View>
              <Text style={styles.paymentConsentText}>I authorise AnySkill to securely save my PayFast card token for future service payments. I understand that my card will only be charged after I approve the Provider's completed work.</Text>
            </Pressable>
            {!!paymentError && <Text style={styles.skillError}>{paymentError}</Text>}
            <Pressable accessibilityRole="button" disabled={!paymentConsent || paymentBusy} onPress={() => void addPaymentCard()} style={[styles.paymentContinueButton, (!paymentConsent || paymentBusy) && styles.skillDisabled]}>
              <Text style={styles.paymentContinueText}>{paymentBusy ? "Opening secure form…" : "Continue to secure card form"}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={paymentBusy} onPress={() => setPaymentFormVisible(false)} style={styles.paymentCancelButton}><Text style={styles.paymentCancelText}>Cancel</Text></Pressable>
            <Text style={styles.paymentFormFootnote}>Card registration does not pay for a job. Charges are only initiated after you approve completed work.</Text>
          </View>
        </View>
      </View>
    </Modal>
    <Modal visible={skillDrawerVisible} transparent animationType="slide" onRequestClose={closeSkillDrawer} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.skillDrawerBackdrop} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close skill drawer" style={styles.skillDrawerDismiss} onPress={closeSkillDrawer}/>
        <SafeAreaView edges={["bottom"]} style={styles.skillDrawerSafeArea}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close skill drawer" style={styles.skillDrawerDismiss} onPress={closeSkillDrawer}/>
        <View style={styles.skillDrawer}>
          <View style={styles.drawerHandle}/>
          <View style={styles.drawerHeader}>
            <View style={styles.drawerHeadingCopy}>
              <Text style={styles.skillEditorTitle}>{removedSkillName ? "Remove skill" : skillDrawerMode === "add" ? "Add a skill" : skillDrawerMode === "edit" ? "Edit skill" : "Skill details"}</Text>
              <Text style={styles.skillLimitHint}>{removedSkillName ? `Confirm removal of ${removedSkillName}` : skillDrawerMode === "add" ? `${skills.length} of 5 skills currently added` : skillDraft[selectedSkillIndex ?? -1]?.category ?? "Manage your skill"}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={closeSkillDrawer} style={styles.drawerClose}><Text style={styles.drawerCloseText}>×</Text></Pressable>
          </View>
          <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets={Platform.OS === "ios"} nestedScrollEnabled>
            {removedSkillName ? <View style={styles.drawerFields}><Text style={styles.drawerReadValue}>This will remove {removedSkillName} from your Provider profile when you save the change.</Text></View> : null}
            {skillDrawerMode === "add" && selectedSkillIndex === null ? <>
              <Text style={styles.fieldLabel}>Choose a skill</Text>
              <TextInput value={skillSearch} onChangeText={setSkillSearch} placeholder="Search or type a skill" placeholderTextColor="#82949A" style={styles.skillSearchInput} autoCorrect={false}/>
              {skillSearch.trim() ? <View style={styles.skillSuggestions}>
                {skillCatalogue.filter((name) => name.toLowerCase().includes(skillSearch.trim().toLowerCase()) && !skillDraft.some((item) => item.category?.trim().toLowerCase() === name.toLowerCase())).slice(0, 8).map((name) => <Pressable key={name} onPress={() => { addSkill(name); setSelectedSkillIndex(skillDraft.length); }} style={styles.skillSuggestion}><Text style={styles.skillSuggestionText}>{name}</Text><Text style={styles.skillAddIcon}>＋</Text></Pressable>)}
                {!skillCatalogue.some((name) => name.toLowerCase() === skillSearch.trim().toLowerCase()) && !skillDraft.some((item) => item.category?.trim().toLowerCase() === skillSearch.trim().toLowerCase()) ? <Pressable onPress={() => { addSkill(skillSearch); setSelectedSkillIndex(skillDraft.length); }} style={styles.skillSuggestion}><Text style={styles.skillSuggestionText}>Add “{skillSearch.trim()}”</Text><Text style={styles.skillAddIcon}>＋</Text></Pressable> : null}
              </View> : null}
              {skillDraft.length < 5 ? <Text style={styles.skillLimitHint}>Select a skill to open its details for completion.</Text> : <Text style={styles.skillLimitHint}>You have reached the 5-skill limit.</Text>}
            </> : null}
            {selectedSkillIndex !== null && skillDraft[selectedSkillIndex] ? (() => {
              const skill = skillDraft[selectedSkillIndex];
              const review = reviewForSkill(skill.category);
              const isReadOnly = skillDrawerMode === "view";
              return <View style={styles.drawerFields}>
                <Text style={styles.fieldLabel}>Skill</Text>
                <Text style={styles.drawerSkillCategory}>{skill.category}</Text>
                {review?.status ? <View style={styles.drawerStatus}><Text style={styles.skillStatusText}>{statusLabel(review.status)}</Text></View> : null}
                {review?.decisionReason ? <View style={styles.reviewFeedback}><Text style={styles.reviewFeedbackTitle}>Reviewer feedback</Text><Text style={styles.reviewFeedbackText}>{review.decisionReason}</Text></View> : null}
                <Text style={styles.fieldLabel}>Skill description</Text>
                {isReadOnly ? <Text style={styles.drawerReadValue}>{skill.description || "Not provided"}</Text> : <TextInput value={skill.description ?? ""} onChangeText={(value) => updateSkill(selectedSkillIndex, { description: value })} placeholder="Describe the work you can do" placeholderTextColor="#82949A" style={[styles.skillSearchInput, styles.skillMultiline]} multiline/>}
                <Text style={styles.fieldLabel}>Hourly rate (ZAR)</Text>
                {isReadOnly ? <Text style={styles.drawerReadValue}>{skill.hourlyRate != null && String(skill.hourlyRate).trim() ? `R${skill.hourlyRate} / hour` : "Not configured"}</Text> : <TextInput value={String(skill.hourlyRate ?? "")} onChangeText={(value) => updateSkill(selectedSkillIndex, { hourlyRate: value.replace(/[^0-9.]/g, "") })} placeholder="e.g. 350.00" keyboardType="decimal-pad" style={styles.skillSearchInput}/>}
                <Text style={styles.drawerReadMuted}>This rate applies only to {skill.category} and is used as the default when you send an offer.</Text>
                <Text style={styles.fieldLabel}>Does this skill require an assessment?</Text>
                {isReadOnly ? <Text style={styles.drawerReadValue}>{skill.assessmentRequired === false ? "No assessment" : "Assessment required"}</Text> : <View style={styles.assessmentChoices}>
                  <Pressable accessibilityRole="button" accessibilityState={{ selected: skill.assessmentRequired !== false }} onPress={() => updateSkill(selectedSkillIndex, { assessmentRequired: true })} style={[styles.assessmentChoice, skill.assessmentRequired !== false && styles.assessmentChoiceSelected]}><Text style={[styles.assessmentChoiceText, skill.assessmentRequired !== false && styles.assessmentChoiceTextSelected]}>Assessment required</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityState={{ selected: skill.assessmentRequired === false }} onPress={() => updateSkill(selectedSkillIndex, { assessmentRequired: false })} style={[styles.assessmentChoice, skill.assessmentRequired === false && styles.assessmentChoiceSelected]}><Text style={[styles.assessmentChoiceText, skill.assessmentRequired === false && styles.assessmentChoiceTextSelected]}>No assessment</Text></Pressable>
                </View>}
                <Text style={styles.fieldLabel}>Assessment fee (ZAR)</Text>
                {isReadOnly ? <Text style={styles.drawerReadValue}>R{skill.assessmentFee ?? 0}</Text> : <TextInput value={String(skill.assessmentFee ?? "0")} onChangeText={(value) => updateSkill(selectedSkillIndex, { assessmentFee: value.replace(/[^0-9.]/g, "") })} placeholder="0.00" keyboardType="decimal-pad" style={styles.skillSearchInput}/>}
                <Text style={styles.drawerReadMuted}>R0 means this skill's assessment is free. If assessment is required, it can still be used to determine the scope, estimated hours and final price.</Text>
                <Text style={styles.fieldLabel}>Years of experience</Text>
                {isReadOnly ? <Text style={styles.drawerReadValue}>{String(skill.yearsOfExperience || "Not provided")}</Text> : <TextInput value={String(skill.yearsOfExperience ?? "")} onChangeText={(value) => updateSkill(selectedSkillIndex, { yearsOfExperience: value })} placeholder="e.g. 3 years" placeholderTextColor="#82949A" style={styles.skillSearchInput}/>}
                <View style={styles.subsectionHeader}><Text style={styles.subsectionTitle}>Qualifications & licences</Text>{!isReadOnly ? <Pressable onPress={() => updateSkill(selectedSkillIndex, { licencesQualifications: [...(skill.licencesQualifications ?? []), { name: "", attachmentUrl: "" }] })}><Text style={styles.inlineAdd}>＋ Add</Text></Pressable> : null}</View>
                {(skill.licencesQualifications ?? []).length ? (skill.licencesQualifications ?? []).map((qualification, qIndex) => <View key={qIndex} style={styles.nestedEditor}>
                  {isReadOnly ? <><Text style={styles.drawerReadValue}>{qualification.name || "Qualification"}</Text><Text style={styles.drawerReadMuted}>{qualification.attachmentName || qualification.attachmentUrl || "No document attached"}</Text></> : <>
                    <TextInput value={qualification.name} onChangeText={(value) => updateQualification(selectedSkillIndex, qIndex, { name: value })} placeholder="Qualification or licence name" placeholderTextColor="#82949A" style={styles.skillSearchInput}/>
                    <TextInput value={qualification.attachmentUrl} onChangeText={(value) => updateQualification(selectedSkillIndex, qIndex, { attachmentUrl: value })} placeholder="Document URL / attachment reference" placeholderTextColor="#82949A" style={styles.skillSearchInput}/>
                    <Pressable onPress={() => updateSkill(selectedSkillIndex, { licencesQualifications: (skill.licencesQualifications ?? []).filter((_, itemIndex) => itemIndex !== qIndex) })}><Text style={styles.skillRemove}>Remove qualification</Text></Pressable>
                  </>}
                </View>) : <Text style={styles.drawerReadMuted}>No qualifications or licences added.</Text>}
                <View style={styles.subsectionHeader}><Text style={styles.subsectionTitle}>Work portfolio</Text>{!isReadOnly ? <Pressable onPress={() => updateSkill(selectedSkillIndex, { portfolio: [...(skill.portfolio ?? []), { title: "", description: "", links: [], imageUrls: [] }] })}><Text style={styles.inlineAdd}>＋ Add</Text></Pressable> : null}</View>
                {(skill.portfolio ?? []).length ? (skill.portfolio ?? []).map((work, pIndex) => <View key={pIndex} style={styles.nestedEditor}>
                  {isReadOnly ? <><Text style={styles.drawerReadValue}>{work.title || "Portfolio item"}</Text><Text style={styles.drawerReadMuted}>{work.description || "No description"}</Text>{work.linkUrl || work.links?.[0] ? <Text style={styles.drawerReadMuted}>{work.linkUrl || work.links?.[0]}</Text> : null}</> : <>
                    <TextInput value={work.title} onChangeText={(value) => updatePortfolio(selectedSkillIndex, pIndex, { title: value })} placeholder="Project / work title" placeholderTextColor="#82949A" style={styles.skillSearchInput}/>
                    <TextInput value={work.description} onChangeText={(value) => updatePortfolio(selectedSkillIndex, pIndex, { description: value })} placeholder="What did you do?" placeholderTextColor="#82949A" style={[styles.skillSearchInput, styles.skillMultiline]} multiline/>
                    <TextInput value={work.linkUrl ?? work.links?.[0] ?? ""} onChangeText={(value) => updatePortfolio(selectedSkillIndex, pIndex, { linkUrl: value, links: value ? [value, ...(work.links ?? []).slice(1)] : [] })} placeholder="Portfolio link (optional)" placeholderTextColor="#82949A" style={styles.skillSearchInput}/>
                    <Pressable onPress={() => updateSkill(selectedSkillIndex, { portfolio: (skill.portfolio ?? []).filter((_, itemIndex) => itemIndex !== pIndex) })}><Text style={styles.skillRemove}>Remove portfolio item</Text></Pressable>
                  </>}
                </View>) : <Text style={styles.drawerReadMuted}>No portfolio items added.</Text>}
              </View>;
            })() : null}
            {!!skillError && <Text style={styles.skillError}>{skillError}</Text>}
          </ScrollView>
          {skillDrawerMode !== "view" ? <View style={styles.drawerActions}>
            <Pressable accessibilityRole="button" disabled={savingSkills} onPress={closeSkillDrawer} style={styles.skillCancel}><Text style={styles.skillCancelText}>Cancel</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={savingSkills || (selectedSkillIndex === null && !removedSkillName)} onPress={() => void saveSkills()} style={[styles.detailAction, (savingSkills || selectedSkillIndex === null) && styles.skillDisabled]}><Text style={styles.detailActionText}>{savingSkills ? "Saving…" : "Save draft"}</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={savingSkills || (skillDraft.length === 0 && !removedSkillName) || (selectedSkillIndex === null && !removedSkillName)} onPress={() => void submitSkillsForReview()} style={[styles.submitReviewButton, (savingSkills || skillDraft.length === 0 || selectedSkillIndex === null) && styles.skillDisabled]}><Text style={styles.submitReviewText}>{savingSkills ? "Processing…" : "Submit for review"}</Text></Pressable>
          </View> : <View style={styles.drawerActions}><Pressable accessibilityRole="button" onPress={() => { if (selectedSkillIndex !== null) { setSkillDrawerMode("edit"); setEditingSkills(true); } }} style={styles.detailAction}><Text style={styles.detailActionText}>Edit skill</Text></Pressable></View>}
        </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 10, paddingTop: 12, paddingBottom: 24, gap: 11 },
  hero: { backgroundColor: colors.primary, borderRadius: 22, padding: 18, flexDirection: "row", alignItems: "center", gap: 12, minHeight: 116 },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.primary, fontSize: 17, fontWeight: "900" },
  heroCopy: { flex: 1 },
  eyebrow: { color: "#C7E7F0", fontSize: 9, fontWeight: "900", letterSpacing: 1.1 },
  title: { color: "#FFFFFF", fontSize: 23, fontWeight: "900", marginTop: 3 },
  subtitle: { color: "#E1F1F5", fontSize: 10, lineHeight: 15, marginTop: 3 },
  approvedBadge: { backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 20, paddingHorizontal: 9, paddingVertical: 6, maxWidth: 86 },
  approvedText: { color: "#FFFFFF", fontSize: 9, fontWeight: "800", textAlign: "center" },
  modeSwitch: { flexDirection: "row", backgroundColor: "#E7EFF1", padding: 4, borderRadius: 13, gap: 4 },
  modeButton: { flex: 1, minHeight: 42, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  modeSelected: { backgroundColor: colors.surface, shadowColor: "#12313A", shadowOpacity: 0.08, shadowRadius: 5, elevation: 1 },
  modeText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  modeTextSelected: { color: colors.primary },
  ratingsCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 15, gap: 3 },
  ratingsTitle: { color: colors.ink, fontSize: 14, fontWeight: "900", marginBottom: 5 },
  overallRating: { flexDirection: "row", alignItems: "center", gap: 13, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  overallValue: { color: colors.primary, fontSize: 25, fontWeight: "900" },
  overallCopy: { flex: 1, gap: 3 },
  ratingLabel: { color: colors.ink, fontSize: 11, fontWeight: "800" },
  ratingHint: { color: colors.muted, fontSize: 9, marginTop: 2 },
  ratingSkillRow: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, borderBottomColor: "#EDF1EE" },
  ratingSkillName: { flex: 1, color: colors.ink, fontSize: 10, fontWeight: "600" },
  ratingSkillValue: { color: colors.primary, fontSize: 11, fontWeight: "800" },
  sectionHeader: { marginTop: 9, gap: 3 },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  sectionHint: { color: colors.muted, fontSize: 11 },
  rowCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 15, overflow: "hidden" },
  rowButton: { minHeight: 67, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 11, gap: 10 },
  rowCopy: { flex: 1, gap: 4 },
  rowTitle: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  rowSummary: { color: colors.muted, fontSize: 10 },
  statusBadge: { borderRadius: 15, paddingHorizontal: 8, paddingVertical: 5 },
  goodBadge: { backgroundColor: colors.greenBg },
  pendingBadge: { backgroundColor: colors.amberBg },
  statusText: { fontSize: 9, fontWeight: "900" },
  goodText: { color: colors.green },
  pendingText: { color: colors.amber },
  chevron: { color: colors.primary, fontSize: 20, fontWeight: "700", width: 18, textAlign: "center" },
  detail: { borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 14, paddingVertical: 13, gap: 10 },
  detailText: { color: colors.muted, fontSize: 11, lineHeight: 18 },
  detailAction: { alignSelf: "flex-start", backgroundColor: colors.primary, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9 },
  detailActionText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
  paymentManager: { gap: 10 },
  paymentModalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(5, 23, 31, 0.52)" },
  paymentModal: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden" },
  paymentModalHeader: { backgroundColor: "#FFFFFF", paddingHorizontal: 18, paddingTop: 22, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "flex-start", gap: 12 },
  paymentModalCopy: { flex: 1, gap: 5 },
  paymentModalEyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  paymentModalTitle: { color: colors.ink, fontSize: 21, fontWeight: "900" },
  paymentModalSubtitle: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  paymentFormBody: { padding: 18, gap: 14 },
  paymentAcceptedCards: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 13, gap: 10 },
  paymentAcceptedTitle: { color: colors.ink, fontSize: 11, fontWeight: "800" },
  paymentBrandRow: { flexDirection: "row", gap: 8 },
  paymentBrand: { minWidth: 78, height: 39, borderWidth: 1, borderColor: colors.border, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  paymentBrandVisa: { color: "#1A1F71", fontSize: 17, fontWeight: "900", fontStyle: "italic" },
  paymentBrandMaster: { color: "#252525", fontSize: 11, fontWeight: "900" },
  paymentSecureNote: { backgroundColor: "#EAF3F8", borderRadius: 12, padding: 13, gap: 6 },
  paymentSecureTitle: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  paymentSecureText: { color: colors.ink, fontSize: 10, lineHeight: 16 },
  paymentContinueButton: { backgroundColor: colors.primary, borderRadius: 11, minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  paymentContinueText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  paymentCancelButton: { minHeight: 40, alignItems: "center", justifyContent: "center" },
  paymentCancelText: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  paymentFormFootnote: { color: colors.muted, fontSize: 9, lineHeight: 14, textAlign: "center" },
  paymentCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 11, backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  paymentCardCopy: { flex: 1, minWidth: 115, gap: 4 },
  paymentCardTitle: { color: colors.ink, fontSize: 11, fontWeight: "900" },
  paymentCardHint: { color: colors.muted, fontSize: 9 },
  paymentAction: { backgroundColor: "#EAF3F8", borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7 },
  paymentActionText: { color: colors.primary, fontSize: 9, fontWeight: "800" },
  paymentRemove: { paddingHorizontal: 7, paddingVertical: 7 },
  paymentRemoveText: { color: "#B33B3B", fontSize: 9, fontWeight: "800" },
  paymentConsentRow: { flexDirection: "row", alignItems: "flex-start", gap: 9, paddingVertical: 4 },
  paymentConsentBox: { width: 21, height: 21, borderWidth: 1, borderColor: colors.border, borderRadius: 5, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  paymentConsentChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  paymentConsentTick: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  paymentConsentText: { flex: 1, color: colors.muted, fontSize: 10, lineHeight: 15 },
  paymentRefresh: { alignSelf: "flex-start", paddingVertical: 7 },
  paymentRefreshText: { color: colors.primary, fontSize: 10, fontWeight: "800" },
  skillManager: { gap: 9 },
  assessmentChoices: { flexDirection: "row", gap: 8 },
  assessmentChoice: { flex: 1, minHeight: 42, borderWidth: 1, borderColor: colors.border, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, backgroundColor: "#FFFFFF" },
  assessmentChoiceSelected: { borderColor: colors.primary, backgroundColor: "#EAF3F8" },
  assessmentChoiceText: { color: colors.muted, fontSize: 10, fontWeight: "800", textAlign: "center" },
  assessmentChoiceTextSelected: { color: colors.primary },
  skillLimitHint: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  skillEditorTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  skillCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 11, gap: 8, backgroundColor: "#FBFDFE" },
  skillCardHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  skillCardTitleWrap: { flex: 1, gap: 3 },
  skillDraftName: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  skillMeta: { color: colors.muted, fontSize: 9 },
  skillStatusBadge: { borderRadius: 14, paddingHorizontal: 8, paddingVertical: 5 },
  skillStatusText: { fontSize: 8, fontWeight: "900" },
  rejectedBadge: { backgroundColor: "#FCEBEC" },
  rejectedText: { color: "#B33B3B" },
  neutralBadge: { backgroundColor: "#EDF1F3" },
  neutralText: { color: colors.muted },
  reviewFeedback: { backgroundColor: "#FFF5E4", borderRadius: 9, padding: 9, gap: 3 },
  reviewFeedbackTitle: { color: colors.amber, fontSize: 9, fontWeight: "900" },
  reviewFeedbackText: { color: colors.ink, fontSize: 10, lineHeight: 15 },
  fieldLabel: { color: colors.ink, fontSize: 10, fontWeight: "800", marginTop: 2 },
  subsectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 5 },
  subsectionTitle: { color: colors.ink, fontSize: 10, fontWeight: "900" },
  inlineAdd: { color: colors.primary, fontSize: 10, fontWeight: "900", padding: 5 },
  nestedEditor: { borderLeftWidth: 2, borderLeftColor: "#D7E5EA", paddingLeft: 9, gap: 7 },
  skillMultiline: { minHeight: 70, textAlignVertical: "top", paddingTop: 10 },
  skillSuccess: { color: colors.green, fontSize: 10, fontWeight: "700" },
  submitReviewButton: { alignSelf: "stretch", backgroundColor: "#EAF2FF", borderWidth: 1, borderColor: "#C9DCF9", borderRadius: 10, alignItems: "center", padding: 12 },
  submitReviewText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  profileSkillRow: { minHeight: 48, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: colors.border, borderRadius: 11, paddingHorizontal: 9, paddingVertical: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  profileSkillPaused: { backgroundColor: "#F4F6F8", borderColor: "#CDD5DB" },
  profileSkillCopy: { flex: 1, gap: 5 },
  profileSkillName: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  skillIconActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  skillIconButton: { width: 31, height: 31, borderRadius: 9, backgroundColor: "#EEF5F7", alignItems: "center", justifyContent: "center" },
  skillViewIcon: { color: colors.primary, fontSize: 16, fontWeight: "800" },
  skillPauseIcon: { color: colors.primary, fontSize: 14, fontWeight: "900" },
  skillPausedButton: { backgroundColor: "#FFF2E5" },
  skillEditIcon: { color: colors.primary, fontSize: 18, fontWeight: "800" },
  skillDrawerBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(5, 23, 31, 0.48)" },
  skillDrawerSafeArea: { maxHeight: "94%", justifyContent: "flex-end" },
  skillDrawerDismiss: { flex: 1 },
  skillDrawer: { height: "88%", maxHeight: "100%", minHeight: "42%", backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 9, overflow: "hidden" },
  drawerHandle: { alignSelf: "center", width: 42, height: 4, borderRadius: 3, backgroundColor: "#B8C8CD", marginBottom: 12 },
  drawerHeader: { paddingHorizontal: 18, paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  drawerHeadingCopy: { flex: 1, gap: 4 },
  drawerClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#E7EFF1", alignItems: "center", justifyContent: "center" },
  drawerCloseText: { color: colors.ink, fontSize: 23, lineHeight: 25 },
  drawerScroll: { flex: 1 },
  drawerContent: { padding: 16, gap: 10, paddingBottom: 32 },
  drawerFields: { gap: 10 },
  drawerSkillCategory: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  drawerStatus: { alignSelf: "flex-start", backgroundColor: "#E8F1F4", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  drawerReadValue: { color: colors.ink, fontSize: 12, lineHeight: 18, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 11 },
  drawerReadMuted: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  drawerActions: { paddingHorizontal: 18, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" },
  skillRemove: { color: "#B33B3B", fontSize: 10, fontWeight: "800", padding: 7 },
  skillRemoveButton: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#FDECEC", borderWidth: 1, borderColor: "#F4CACA", alignItems: "center", justifyContent: "center" },
  skillRemoveIcon: { color: "#B33B3B", fontSize: 22, lineHeight: 24, fontWeight: "500" },
  skillSearchInput: { minHeight: 43, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 11, color: colors.ink, fontSize: 12, backgroundColor: "#FFFFFF" },
  skillSuggestions: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: "hidden" },
  skillSuggestion: { minHeight: 39, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  skillSuggestionText: { color: colors.ink, fontSize: 11, fontWeight: "600" },
  skillAddIcon: { color: colors.primary, fontSize: 16, fontWeight: "900" },
  skillError: { color: "#B33B3B", fontSize: 10 },
  skillEditorActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 9 },
  skillCancel: { paddingHorizontal: 12, paddingVertical: 10 },
  skillCancelText: { color: colors.muted, fontSize: 10, fontWeight: "800" },
  skillDisabled: { opacity: 0.55 },
  helper: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  errorBox: { backgroundColor: "#FCEDEE", borderRadius: 12, padding: 13, gap: 7 },
  errorText: { color: "#A12D2D", fontSize: 11 },
  retry: { color: colors.primary, fontWeight: "900", fontSize: 11 },
  settingsButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 15, gap: 4, marginTop: 8 },
  settingsTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  settingsCopy: { color: colors.muted, fontSize: 10 },
  settingsArrow: { position: "absolute", right: 15, top: 15, color: colors.primary, fontSize: 24 },
  loader: { padding: 22 },
});
