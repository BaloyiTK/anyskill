import { useEffect, useState } from "react";
import * as Location from "expo-location";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { apiRequest } from "./api";

type Section = "Profile" | "Verification" | "Skills" | "Portfolio" | "Submit";
type Payload = {
  profile: Record<string, string>;
  skills: Array<{ category: string; description: string; supportingDocuments: Array<{ name: string; url: string }> }>;
  portfolio: Array<{ title: string; description: string }>;
  percentage: number;
  sections: { profile: boolean; skills: boolean; portfolio: boolean };
};

const tabs: Section[] = ["Profile", "Verification", "Skills", "Portfolio", "Submit"];
const empty: Payload = { profile: {}, skills: [], portfolio: [], percentage: 0, sections: { profile: false, skills: false, portfolio: false } };
const colors = { ink: "#17231F", muted: "#68766F", primary: "#176B5B", border: "#DCE5E0", surface: "#FFFFFF", bg: "#F6F8F7" };

export function OnboardingScreen(p: { identityStatus: string; onBack: () => void; onStartVerification: () => void }) {
  const [active, setActive] = useState<Section>("Profile");
  const [data, setData] = useState<Payload>(empty);
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
      const body = section === "profile" ? { profile: { firstName, lastName, phone, country, province, city, suburb, address } }
        : section === "skills" ? { skills: category.trim() ? [{ category: category.trim(), description, supportingDocuments: documentName.trim() && documentUrl.trim() ? [{ name: documentName.trim(), url: documentUrl.trim() }] : [] }] : [] }
        : { portfolio: portfolioTitle.trim() ? [{ title: portfolioTitle.trim(), description: portfolioDescription }] : [] };
      const result = await apiRequest<Payload>("/profile/onboarding", { method: "PATCH", body: JSON.stringify(body) }, true);
      setData(result);
      if (section === "profile" && homeLatitude.trim() && homeLongitude.trim()) {
        await apiRequest("/profile/location/home", { method: "PATCH", body: JSON.stringify({ label: address.trim() || [suburb, city, province, country].filter(Boolean).join(", "), latitude: Number(homeLatitude), longitude: Number(homeLongitude) }) }, true);
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
    <View style={st.top}><Text style={st.title}>Your profile</Text><Pressable onPress={p.onBack}><Text style={st.back}>Back</Text></Pressable></View>
    <Text style={st.percent}>{data.percentage}% profile information complete</Text>
    <View style={st.track}><View style={[st.fill, { width: `${data.percentage}%` }]} /></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tabs}>
      {tabs.map(tab => <Pressable key={tab} onPress={() => setActive(tab)} style={[st.tab, active === tab && st.activeTab]}><Text style={[st.tabText, active === tab && st.activeTabText]}>{tab}</Text></Pressable>)}
    </ScrollView>
    <ScrollView style={st.body} contentContainerStyle={{ paddingBottom: 36 }} keyboardShouldPersistTaps="handled">
      {busy && <ActivityIndicator color={colors.primary} />}
      {active === "Profile" && <>
        <Text style={st.heading}>Personal details and Home Location</Text>
        <Text style={st.help}>Save what you have now. You can leave fields incomplete and return later.</Text>
        {Field("First name", firstName, setFirstName)}{Field("Last name", lastName, setLastName)}{Field("Contact number", phone, setPhone)}
        {Field("Country", country, setCountry)}{Field("Province", province, setProvince)}{Field("City", city, setCity)}{Field("Suburb", suburb, setSuburb)}{Field("Home address", address, setAddress, true)}
        {Field("Home latitude", homeLatitude, setHomeLatitude)}{Field("Home longitude", homeLongitude, setHomeLongitude)}
        <Action label={homeLocationBusy ? "Getting location..." : "Use current GPS for Home Location"} onPress={() => void useCurrentHomeLocation()} disabled={busy || homeLocationBusy} />
        <Text style={st.help}>Home Location is saved to your profile and used as a default. It is not continuous live tracking.</Text>
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
const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingTop: 8 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 18, paddingBottom: 8 },
  title: { color: colors.ink, fontSize: 25, fontWeight: "800" }, back: { color: colors.primary, fontWeight: "800" },
  percent: { color: colors.muted, paddingHorizontal: 18, fontSize: 12, fontWeight: "700" },
  track: { height: 7, marginHorizontal: 18, marginTop: 8, borderRadius: 8, backgroundColor: colors.border, overflow: "hidden" },
  fill: { height: 7, backgroundColor: colors.primary },
  tabs: { gap: 7, paddingHorizontal: 18, paddingVertical: 14 },
  tab: { paddingVertical: 9, paddingHorizontal: 13, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  activeTab: { backgroundColor: colors.primary, borderColor: colors.primary }, tabText: { color: colors.muted, fontSize: 12, fontWeight: "700" }, activeTabText: { color: "#FFF" },
  body: { flex: 1, paddingHorizontal: 18 }, heading: { color: colors.ink, fontSize: 19, fontWeight: "800", marginBottom: 7 },
  help: { color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  field: { marginBottom: 12 }, label: { color: colors.ink, fontSize: 12, fontWeight: "700", marginBottom: 6 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: colors.surface, paddingHorizontal: 12, color: colors.ink },
  multiline: { minHeight: 88, paddingTop: 12, textAlignVertical: "top" },
  status: { color: colors.muted, fontSize: 12, marginVertical: 6 }, statusValue: { color: colors.ink, fontWeight: "800", marginTop: 6, textTransform: "capitalize" },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 14, marginVertical: 12 },
  action: { backgroundColor: colors.primary, borderRadius: 11, minHeight: 46, alignItems: "center", justifyContent: "center", paddingHorizontal: 15, marginTop: 9 },
  actionText: { color: "#FFF", fontWeight: "800", fontSize: 13 }, nav: { marginTop: 12, marginBottom: 25 },
  success: { color: colors.primary, marginTop: 12, fontSize: 12 }, error: { color: "#A12D2D", marginTop: 12, fontSize: 12 },
});
