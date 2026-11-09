import { useEffect, useState } from "react";
import * as Location from "expo-location";
import { MapPinPicker } from "./MapPinPicker";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { apiRequest } from "./api";

type Section = "Profile" | "Verification" | "Skills" | "Portfolio" | "Submit";
type AccountType = "INDIVIDUAL" | "BUSINESS";
type MarketplaceRole = "SEEKER" | "PROVIDER";
type Payload = {
  profile: Record<string, string>;
  skills: Array<{ category: string; description: string; supportingDocuments: Array<{ name: string; url: string }> }>;
  portfolio: Array<{ title: string; description: string }>;
  percentage: number;
  sections: { profile: boolean; skills: boolean; portfolio: boolean };
};

const tabs: Section[] = ["Profile", "Verification", "Skills", "Portfolio", "Submit"];
const empty: Payload = { profile: {}, skills: [], portfolio: [], percentage: 0, sections: { profile: false, skills: false, portfolio: false } };
const colors = { ink: "#182238", muted: "#778198", primary: "#294FC5", border: "#E2E7F0", surface: "#FFFFFF", bg: "#F7F8FC", hero: "#111D36", soft: "#F0F4FF" };

export function OnboardingScreen(p: { identityStatus: string; onBack: () => void; onStartVerification: () => void }) {
  const [active, setActive] = useState<Section>("Profile");
  const [data, setData] = useState<Payload>(empty);
  const [accountType, setAccountType] = useState<AccountType | "">("");
  const [marketplaceRole, setMarketplaceRole] = useState<MarketplaceRole | "">("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("South Africa");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [suburb, setSuburb] = useState("");
  const [address, setAddress] = useState("");
  const [homeLatitude, setHomeLatitude] = useState("");
  const [homeLongitude, setHomeLongitude] = useState("");
  const [homeLocationBusy, setHomeLocationBusy] = useState(false);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [documentName, setDocumentName] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [portfolioTitle, setPortfolioTitle] = useState("");
  const [portfolioDescription, setPortfolioDescription] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setBusy(true); setError("");
    try {
      const result = await apiRequest<Payload>("/profile/onboarding", {}, true);
      const home = await apiRequest<{homeLocationLabel:string|null;homeLatitude:number|null;homeLongitude:number|null}>("/profile/location/home", {}, true).catch(() => null);
      setData(result);
      const profile = result.profile ?? {};
      setAccountType(profile.accountType === "INDIVIDUAL" || profile.accountType === "BUSINESS" ? profile.accountType : "");
      setMarketplaceRole(profile.marketplaceRole === "SEEKER" || profile.marketplaceRole === "PROVIDER" ? profile.marketplaceRole : "");
      setFirstName(profile.firstName ?? ""); setLastName(profile.lastName ?? ""); setPhone(profile.phone ?? "");
      setCountry(profile.country ?? "South Africa"); setProvince(profile.province ?? ""); setCity(profile.city ?? "");
      setSuburb(profile.suburb ?? ""); setAddress(profile.address ?? "");
      setHomeLatitude(home?.homeLatitude == null ? "" : String(home.homeLatitude));
      setHomeLongitude(home?.homeLongitude == null ? "" : String(home.homeLongitude));
      const skill = result.skills?.[0]; setCategory(skill?.category ?? ""); setDescription(skill?.description ?? "");
      const document = skill?.supportingDocuments?.[0]; setDocumentName(document?.name ?? ""); setDocumentUrl(document?.url ?? "");
      const item = result.portfolio?.[0]; setPortfolioTitle(item?.title ?? ""); setPortfolioDescription(item?.description ?? "");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load your saved profile."); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);

  const save = async (section: "profile" | "skills" | "portfolio") => {
    setBusy(true); setError(""); setMessage("");
    try {
      const body = section === "profile" ? { profile: { accountType, marketplaceRole, firstName, lastName, phone, country, province, city, suburb, address } }
        : section === "skills" ? { skills: category.trim() ? [{ category: category.trim(), description, supportingDocuments: documentName.trim() && documentUrl.trim() ? [{ name: documentName.trim(), url: documentUrl.trim() }] : [] }] : [] }
        : { portfolio: portfolioTitle.trim() ? [{ title: portfolioTitle.trim(), description: portfolioDescription }] : [] };
      const result = await apiRequest<Payload>("/profile/onboarding", { method: "PATCH", body: JSON.stringify(body) }, true);
      setData(result);
      if (section === "profile" && (homeLatitude.trim() || homeLongitude.trim())) {
        if (!homeLatitude.trim() || !homeLongitude.trim()) throw new Error("Choose both latitude and longitude for your Home Location.");
        if (!Number.isFinite(Number(homeLatitude)) || !Number.isFinite(Number(homeLongitude)) || Number(homeLatitude) < -90 || Number(homeLatitude) > 90 || Number(homeLongitude) < -180 || Number(homeLongitude) > 180) throw new Error("Enter valid Home Location coordinates.");
        await apiRequest("/profile/location/home", { method: "PATCH", body: JSON.stringify({ label: [suburb, city, province, country].filter(Boolean).join(", ") || "Saved Home Location", latitude: Number(homeLatitude), longitude: Number(homeLongitude) }) }, true);
      }
      setMessage("Your changes have been saved as a draft.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save this section."); }
    finally { setBusy(false); }
  };

  const useCurrentHomeLocation = async () => {
    setHomeLocationBusy(true); setError(""); setMessage("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error("Location permission was not granted. You can enter coordinates manually instead.");
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setHomeLatitude(String(current.coords.latitude));
      setHomeLongitude(String(current.coords.longitude));
      setMessage("Current coordinates added. Save Profile Draft to store this as your Home Location.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read your current location."); }
    finally { setHomeLocationBusy(false); }
  };

  const submit = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await apiRequest<{ message: string }>("/profile/onboarding/submit", { method: "POST", body: "{}" }, true);
      setMessage(result.message);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit your available information."); }
    finally { setBusy(false); }
  };

  const status = (key: "profile" | "skills" | "portfolio") => data.sections?.[key] ? "Complete" : "Draft / not complete";
  const next = () => setActive(tabs[Math.min(tabs.indexOf(active) + 1, tabs.length - 1)] ?? "Submit");
  const Field = (label: string, value: string, change: (v: string) => void, multiline = false) => (
    <View style={st.field} key={label}><Text style={st.label}>{label}</Text><TextInput value={value} onChangeText={change} multiline={multiline} placeholder={label} placeholderTextColor="#93A099" style={[st.input, multiline && st.multiline]} /></View>
  );

  return <View style={st.container}>
    <View style={st.hero}>
      <View style={st.heroTop}>
        <Text style={st.brand}>anyskill<Text style={st.brandAccent}>.</Text></Text>
        <Pressable onPress={p.onBack} accessibilityRole="button" style={st.backButton}><Text style={st.back}>Back</Text></Pressable>
      </View>
      <Text style={st.heroTitle}>Let's build your profile.</Text>
      <Text style={st.heroSubtitle}>Tell us a little about yourself so we can create the right AnySkill experience.</Text>
    </View>
    <View style={st.progressWrap}>
      <View style={st.progressMeta}>
        <View><Text style={st.stepCount}>Step {tabs.indexOf(active) + 1} of 5</Text><Text style={st.percent}>{active} information</Text></View>
        <Text style={st.percentStrong}>{data.percentage}% complete</Text>
      </View>
      <View style={st.track}><View style={[st.fill, { width: `${data.percentage}%` }]} /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tabs}>
        {tabs.map((tab, index) => <Pressable key={tab} onPress={() => setActive(tab)} style={[st.tab, active === tab && st.activeTab, tabs.indexOf(active) > index && st.doneTab]}><View style={[st.stepDot, active === tab && st.activeDot, tabs.indexOf(active) > index && st.doneDot]}><Text style={[st.stepDotText, (active === tab || tabs.indexOf(active) > index) && st.activeDotText]}>{tabs.indexOf(active) > index ? "✓" : index + 1}</Text></View><Text style={[st.tabText, active === tab && st.activeTabText]}>{tab}</Text></Pressable>)}
      </ScrollView>
    </View>
    <ScrollView style={st.body} contentContainerStyle={{ paddingBottom: 36 }} keyboardShouldPersistTaps="handled">
      {busy && <ActivityIndicator color={colors.primary} />}
      {active === "Profile" && <>
        <Text style={st.heading}>Set up your profile</Text>
        <Text style={st.help}>First choose whether this profile represents you as an individual or a business, then choose how you want to participate in AnySkill. You can save a draft and finish later.</Text>
        <Text style={st.label}>Account type</Text>
        <View style={st.choiceRow}>
          <Choice label="Individual" description="A personal profile" selected={accountType === "INDIVIDUAL"} onPress={() => setAccountType("INDIVIDUAL")} />
          <Choice label="Business" description="A company or organisation" selected={accountType === "BUSINESS"} onPress={() => setAccountType("BUSINESS")} />
        </View>
        <Text style={st.label}>Marketplace role</Text>
        <View style={st.choiceRow}>
          <Choice label="Skill Seeker" description="Find people, skills or services" selected={marketplaceRole === "SEEKER"} onPress={() => setMarketplaceRole("SEEKER")} />
          <Choice label="Skill Provider" description="Offer skills, services or capabilities" selected={marketplaceRole === "PROVIDER"} onPress={() => setMarketplaceRole("PROVIDER")} />
        </View>
        <Text style={st.help}>You can use AnySkill to seek and provide through one account. This selection sets your current profile role; it does not prevent you from using the other mode later.</Text>
        {Field("First name", firstName, setFirstName)}{Field("Last name", lastName, setLastName)}{Field("Contact number", phone, setPhone)}
        {Field("Country", country, setCountry)}{Field("Province", province, setProvince)}{Field("City", city, setCity)}{Field("Suburb", suburb, setSuburb)}{Field("Home address", address, setAddress, true)}
        <Action label={homeLocationBusy ? "Getting location..." : "Use current GPS for Home Location"} onPress={() => void useCurrentHomeLocation()} disabled={busy || homeLocationBusy} />
        <Text style={st.label}>Choose Home Location on the map</Text>
        <MapPinPicker latitude={homeLatitude.trim() && Number.isFinite(Number(homeLatitude)) ? Number(homeLatitude) : -26.2041} longitude={homeLongitude.trim() && Number.isFinite(Number(homeLongitude)) ? Number(homeLongitude) : 28.0473} selectedLatitude={homeLatitude.trim() ? Number(homeLatitude) : null} selectedLongitude={homeLongitude.trim() ? Number(homeLongitude) : null} onSelect={(lat, lon) => { setHomeLatitude(String(lat)); setHomeLongitude(String(lon)); }} />
        {Field("Home latitude", homeLatitude, setHomeLatitude)}{Field("Home longitude", homeLongitude, setHomeLongitude)}
        <Text style={st.help}>Home Location is saved to your profile and used as a default. It is not continuous live tracking. You can also type coordinates if map tiles are unavailable.</Text>
        <Text style={st.status}>Section: {status("profile")}</Text>
        <Action label="Save Profile Draft" onPress={() => void save("profile")} disabled={busy} />
      </>}
      {active === "Verification" && <>
        <Text style={st.heading}>Identity verification</Text>
        <Text style={st.help}>Identity verification is separate from profile completion. You may continue building your profile, but verification is required before restricted marketplace actions.</Text>
        <View style={st.card}><Text style={st.label}>Current identity status</Text><Text style={st.statusValue}>{p.identityStatus.replace(/_/g, " ")}</Text></View>
        <Action label="Continue identity verification" onPress={p.onStartVerification} disabled={busy} />
      </>}
      {active === "Skills" && <>
        <Text style={st.heading}>Skills and experience</Text><Text style={st.help}>Add each skill and attach its supporting documents to that skill. You can skip this section and complete it later.</Text>
        {Field("Skill category", category, setCategory)}{Field("Experience and service description", description, setDescription, true)}
        {Field("Supporting document name", documentName, setDocumentName)}{Field("Supporting document URL (temporary)", documentUrl, setDocumentUrl)}
        <Text style={st.help}>Document upload to AnySkill-managed cloud storage will be connected separately; this field currently records a document reference only.</Text>
        <Text style={st.status}>Section: {status("skills")}</Text><Action label="Save Skills Draft" onPress={() => void save("skills")} disabled={busy} />
      </>}
      {active === "Portfolio" && <>
        <Text style={st.heading}>Portfolio</Text><Text style={st.help}>Add examples of previous work. This section is optional and can be completed later.</Text>
        {Field("Project or work title", portfolioTitle, setPortfolioTitle)}{Field("Description", portfolioDescription, setPortfolioDescription, true)}
        <Text style={st.status}>Section: {status("portfolio")}</Text><Action label="Save Portfolio Draft" onPress={() => void save("portfolio")} disabled={busy} />
      </>}
      {active === "Submit" && <>
        <Text style={st.heading}>Review and submit</Text><Text style={st.help}>Submitting saves the information currently available. It does not make your profile mandatory or grant identity-verified permissions. You can edit drafts later.</Text>
        <View style={st.card}><Text style={st.status}>Profile: {status("profile")}</Text><Text style={st.status}>Skills: {status("skills")}</Text><Text style={st.status}>Portfolio: {status("portfolio")}</Text><Text style={st.status}>Identity: {p.identityStatus.replace(/_/g, " ")}</Text></View>
        <Action label="Submit available information" onPress={() => void submit()} disabled={busy} />
      </>}
      {!!message && <Text style={st.success}>{message}</Text>}
      {!!error && <Text style={st.error}>{error}</Text>}
      <View style={st.nav}><Action label="Skip / Continue" onPress={next} disabled={busy || active === "Submit"} /></View>
    </ScrollView>
  </View>;
}

function Action(p: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable onPress={p.onPress} disabled={p.disabled} style={[st.action, p.disabled && { opacity: 0.45 }]}><Text style={st.actionText}>{p.label}</Text></Pressable>;
}
function Choice(p: { label: string; description: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected: p.selected }} onPress={p.onPress} style={[st.choice, p.selected && st.choiceSelected]}>
    <View style={st.choiceTop}>
      <Text style={st.choiceTitle}>{p.label}</Text>
      <View style={[st.choiceRadio, p.selected && st.choiceRadioSelected]} />
    </View>
    <Text style={st.choiceDescription}>{p.description}</Text>
  </Pressable>;
}
const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  hero: { backgroundColor: colors.hero, paddingHorizontal: 22, paddingTop: 18, paddingBottom: 25, borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 25 },
  brand: { color: "#FFFFFF", fontSize: 19, fontWeight: "900", letterSpacing: 0.2 }, brandAccent: { color: "#83A4FF" },
  backButton: { borderRadius: 20, paddingHorizontal: 13, paddingVertical: 7, backgroundColor: "#263655" }, back: { color: "#E3EAFF", fontSize: 12, fontWeight: "800" },
  heroTitle: { color: "#FFFFFF", fontSize: 26, lineHeight: 32, fontWeight: "900", letterSpacing: -0.6 },
  heroSubtitle: { color: "#C3CDE0", fontSize: 13, lineHeight: 19, marginTop: 8, maxWidth: 340 },
  progressWrap: { paddingTop: 18 }, progressMeta: { paddingHorizontal: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stepCount: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  percent: { color: colors.muted, fontSize: 11, marginTop: 3 }, percentStrong: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  track: { height: 6, marginHorizontal: 20, marginTop: 10, borderRadius: 8, backgroundColor: colors.border, overflow: "hidden" },
  fill: { height: 6, backgroundColor: colors.primary, borderRadius: 8 },
  tabs: { gap: 8, paddingHorizontal: 20, paddingVertical: 14 },
  tab: { minWidth: 76, flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  activeTab: { backgroundColor: colors.soft, borderColor: colors.primary }, doneTab: { borderColor: "#C9D8FF" },
  stepDot: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#E8EBF2" },
  activeDot: { backgroundColor: colors.primary }, doneDot: { backgroundColor: "#DCE7FF" },
  stepDotText: { color: colors.muted, fontSize: 10, fontWeight: "900" }, activeDotText: { color: colors.primary },
  tabText: { color: colors.muted, fontSize: 10, fontWeight: "800" }, activeTabText: { color: colors.primary },
  body: { flex: 1, paddingHorizontal: 20 }, heading: { color: colors.ink, fontSize: 21, fontWeight: "900", letterSpacing: -0.45, marginBottom: 8 },
  help: { color: colors.muted, fontSize: 13, lineHeight: 20, marginBottom: 14 },
  choiceRow: { flexDirection: "row", gap: 10, marginBottom: 15 },
  choice: { flex: 1, minHeight: 104, borderWidth: 1.5, borderColor: colors.border, borderRadius: 15, backgroundColor: colors.surface, padding: 13 },
  choiceSelected: { borderColor: colors.primary, borderWidth: 1.8, backgroundColor: colors.soft, padding: 12.7 },
  choiceTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  choiceTitle: { color: colors.ink, fontSize: 13, fontWeight: "800", flexShrink: 1 },
  choiceDescription: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  choiceRadio: { width: 17, height: 17, borderRadius: 9, borderWidth: 1.5, borderColor: colors.border },
  choiceRadioSelected: { borderWidth: 5, borderColor: colors.primary },
  field: { marginBottom: 14 }, label: { color: colors.ink, fontSize: 12, fontWeight: "800", marginBottom: 7 },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: "#FFFFFF", paddingHorizontal: 14, color: colors.ink, fontSize: 14 },
  multiline: { minHeight: 88, paddingTop: 12, textAlignVertical: "top" },
  status: { color: colors.muted, fontSize: 12, marginVertical: 6 }, statusValue: { color: colors.ink, fontWeight: "800", marginTop: 6, textTransform: "capitalize" },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 17, padding: 17, marginVertical: 13, shadowColor: "#173B2C", shadowOpacity: 0.035, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  action: { backgroundColor: colors.primary, borderRadius: 11, minHeight: 52, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, marginTop: 10 },
  actionText: { color: "#FFF", fontWeight: "800", fontSize: 13 }, nav: { marginTop: 12, marginBottom: 25 },
  success: { color: colors.primary, marginTop: 12, fontSize: 12 }, error: { color: "#A12D2D", marginTop: 12, fontSize: 12 },
});
