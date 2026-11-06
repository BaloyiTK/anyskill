import { useCallback, useEffect, useState } from "react";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { apiRequest } from "./api";

type Mode = "seeker" | "provider";
type RequestItem = {
  id: string;
  title: string;
  skillCategory: string;
  description: string;
  imageUrls: string[];
  location: string | null;
  deliveryMode: "ONSITE" | "REMOTE" | "EITHER";
  preferredStartAt: string | null;
  instructions: string | null;
  status: string;
  createdAt: string;
  alreadyResponded: boolean;
  myResponse: { id: string; status: string } | null;
};
type SeekerRequest = {
  id: string; title: string; skillCategory: string; description: string;
  deliveryMode: "ONSITE" | "REMOTE" | "EITHER"; location: string | null;
  status: string; createdAt: string;
  providerResponses: Array<{
    id: string; providerId: string; status: string; message: string | null; createdAt: string;
    provider: { providerProfile: { skillCategories: string[]; serviceAreas: string[]; deliveryModes: string[] } | null };
  }>;
};
type Props = {
  mode: Mode;
  verified: boolean;
  pendingRequestId: string | null;
  onModeChange: (mode: Mode) => void;
  onBack: () => void;
  onIdentityRequired: (requestId: string) => void;
  onStartVerification: () => void;
};
const C = { ink: "#17231F", muted: "#68766F", primary: "#176B5B", border: "#DCE5E0", surface: "#FFFFFF", warning: "#FFF3D8", warningInk: "#79540B", bg: "#F6F8F7" };

export function MarketplaceScreen(p: Props) {
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [myRequests, setMyRequests] = useState<SeekerRequest[]>([]);
  const [selectingOfferId, setSelectingOfferId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<"ONSITE" | "REMOTE" | "EITHER">("ONSITE");
  const [responseMessage, setResponseMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [verificationPrompt, setVerificationPrompt] = useState(false);
  const [providerSkills, setProviderSkills] = useState("");
  const [providerAreas, setProviderAreas] = useState("");
  const [providerModes, setProviderModes] = useState("ONSITE");
  const [providerAvailable, setProviderAvailable] = useState(false);
  const [providerProfileLoaded, setProviderProfileLoaded] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [notifications, setNotifications] = useState<Array<{id:string;title:string;body:string;readAt:string|null;createdAt:string}>>([]);

  const loadRequests = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const result = await apiRequest<{ items: RequestItem[] }>("/marketplace/incoming-requests", {}, true);
      setRequests(result.items);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load incoming requests."); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (p.mode === "provider") void loadRequests();
  }, [p.mode, loadRequests]);

  const loadMyRequests = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const result = await apiRequest<SeekerRequest[]>("/marketplace/my-requests", {}, true);
      setMyRequests(result);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load your requests."); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (p.mode === "seeker") void loadMyRequests();
  }, [p.mode, loadMyRequests]);

  const selectProvider = async (requestId: string, responseId: string) => {
    setSelectingOfferId(responseId); setError(""); setNotice("");
    try {
      await apiRequest(`/marketplace/requests/${requestId}/select-provider`, {
        method: "POST", body: JSON.stringify({ responseId }),
      }, true);
      setNotice("Provider selected. The request is now closed to further offers.");
      await loadMyRequests();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not select this Provider.");
      await loadMyRequests();
    } finally { setSelectingOfferId(null); }
  };

  const submitRequest = async () => {
    setBusy(true); setError(""); setNotice(""); setVerificationPrompt(false);
    try {
      await apiRequest("/marketplace/requests", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(), skillCategory: category.trim(), description: description.trim(),
          ...(location.trim() ? { location: location.trim() } : {}), deliveryMode,
        }),
      }, true);
      setTitle(""); setCategory(""); setDescription(""); setLocation("");
      setNotice("Your service request has been published.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not submit your request.";
      setError(message);
      if (message.toLowerCase().includes("identity verification")) setVerificationPrompt(true);
    } finally { setBusy(false); }
  };

  const saveProviderProfile = async () => {
    setSavingProfile(true); setError(""); setNotice("");
    try {
      const profile = await apiRequest<{isAvailable:boolean}>("/marketplace/provider-profile", {
        method: "POST",
        body: JSON.stringify({
          skillCategories: providerSkills.split(",").map((v) => v.trim()).filter(Boolean),
          serviceAreas: providerAreas.split(",").map((v) => v.trim()).filter(Boolean),
          deliveryModes: providerModes.split(",").map((v) => v.trim()).filter(Boolean),
          isAvailable: providerAvailable,
        }),
      }, true);
      setNotice(profile.isAvailable ? "Provider profile saved. You are available for matching." : "Provider profile saved. You are currently unavailable for matching.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save Provider profile."); }
    finally { setSavingProfile(false); }
  };

  const acceptRequest = async (request: RequestItem) => {
    setBusy(true); setError(""); setNotice(""); setVerificationPrompt(false);
    try {
      await apiRequest(`/marketplace/requests/${request.id}/accept`, {
        method: "POST", body: JSON.stringify({ message: responseMessage.trim() || undefined }),
      }, true);
      setNotice("Your response has been sent to the Skill Seeker. The Seeker will choose a Provider.");
      setResponseMessage("");
      await loadRequests();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not accept this request.";
      setError(message);
      if (message.toLowerCase().includes("identity verification")) {
        setVerificationPrompt(true);
        p.onIdentityRequired(request.id);
      }
    } finally { setBusy(false); }
  };

  return <View style={s.container}>
    <View style={s.header}>
      <Pressable onPress={p.onBack}><Text style={s.back}>‹ Back</Text></Pressable>
      <Text style={s.heading}>Marketplace</Text>
      <Text style={s.subheading}>Choose how you want to use AnySkill.</Text>
    </View>
    <View style={s.modeRow}>
      <Pressable onPress={() => p.onModeChange("seeker")} style={[s.modeButton, p.mode === "seeker" && s.modeActive]}><Text style={[s.modeText, p.mode === "seeker" && s.modeTextActive]}>Skill Seeker</Text></Pressable>
      <Pressable onPress={() => p.onModeChange("provider")} style={[s.modeButton, p.mode === "provider" && s.modeActive]}><Text style={[s.modeText, p.mode === "provider" && s.modeTextActive]}>Skill Provider</Text></Pressable>
    </View>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {p.mode === "seeker" ? <>
        <Text style={s.section}>Create a service request</Text>
        <Text style={s.helper}>Describe the work you need done. You can prepare your request before verification; publishing requires verified identity.</Text>
        {!p.verified && <View style={s.notice}><Text style={s.noticeTitle}>Verification required to publish</Text><Text style={s.noticeText}>You can complete this request form now. AnySkill will only publish it after your identity is verified.</Text></View>}
        <Text style={s.label}>What do you need done?</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder="e.g. Repair a leaking kitchen tap" style={s.input} />
        <Text style={s.label}>Skill category</Text>
        <TextInput value={category} onChangeText={setCategory} placeholder="e.g. Plumbing" style={s.input} />
        <Text style={s.label}>Describe the work</Text>
        <TextInput value={description} onChangeText={setDescription} placeholder="Explain what needs to be done..." multiline style={[s.input, s.multiline]} />
        <Text style={s.label}>Service area (not your exact street address)</Text>
        <TextInput value={location} onChangeText={setLocation} placeholder="e.g. Rosebank, Johannesburg" style={s.input} />
        <Text style={s.label}>Where should the work happen?</Text>
        <View style={s.choiceRow}>
          {(["ONSITE", "REMOTE", "EITHER"] as const).map((value) => <Pressable key={value} onPress={() => setDeliveryMode(value)} style={[s.choice, deliveryMode === value && s.choiceActive]}><Text style={[s.choiceText, deliveryMode === value && s.choiceTextActive]}>{value === "ONSITE" ? "On-site" : value === "REMOTE" ? "Remote" : "Either"}</Text></Pressable>)}
        </View>
        <Primary label="Publish service request" onPress={submitRequest} disabled={busy || title.trim().length < 5 || category.trim().length < 2 || description.trim().length < 20} />
        {verificationPrompt && <View style={s.notice}><Text style={s.noticeTitle}>Verify before publishing</Text><Text style={s.noticeText}>Your request details are still on this screen. Start identity verification from your account, then return here to publish.</Text><Secondary label="Go to identity verification" onPress={p.onStartVerification} /></View>}
        <Text style={s.section}>Your service requests and Provider offers</Text>
        <Text style={s.helper}>Compare the offers you receive. Selecting a Provider closes the request to further offers. You can only select one offer.</Text>
        <Secondary label="Refresh my requests" onPress={() => void loadMyRequests()} />
        {busy && <ActivityIndicator style={{ marginTop: 16 }} color={C.primary} />}
        {myRequests.map((request) => {
          const offers = request.providerResponses.filter((offer) => ["OFFERED", "SELECTED"].includes(offer.status));
          const selected = request.providerResponses.find((offer) => offer.status === "SELECTED");
          return <View key={request.id} style={s.card}>
            <Text style={s.cardTitle}>{request.title}</Text>
            <Text style={s.meta}>{request.skillCategory} · {request.status === "OPEN" ? "Open" : request.status}</Text>
            <Text style={s.body}>{request.description}</Text>
            {selected ? <Text style={s.response}>Selected Provider: {selected.providerId.slice(0, 8)} · {new Date(selected.createdAt).toLocaleString()}</Text> : null}
            <Text style={s.sectionSmall}>Offers received ({offers.length})</Text>
            {offers.map((offer, index) => <View key={offer.id} style={s.offerCard}>
              <Text style={s.offerTitle}>Provider offer {index + 1}</Text>
              <Text style={s.meta}>Received {new Date(offer.createdAt).toLocaleString()}</Text>
              <Text style={s.meta}>Provider ID: {offer.providerId.slice(0, 8)}</Text>
              {offer.provider.providerProfile?.skillCategories?.length ? <Text style={s.meta}>Skills: {offer.provider.providerProfile.skillCategories.join(", ")}</Text> : null}
              {offer.provider.providerProfile?.serviceAreas?.length ? <Text style={s.meta}>Service areas: {offer.provider.providerProfile.serviceAreas.join(", ")}</Text> : null}
              {offer.provider.providerProfile?.deliveryModes?.length ? <Text style={s.meta}>Work modes: {offer.provider.providerProfile.deliveryModes.join(", ")}</Text> : null}
              <Text style={s.body}>{offer.message?.trim() || "The Provider did not add a message."}</Text>
              {offer.status === "SELECTED" ? <Text style={s.response}>Selected</Text> : request.status === "OPEN" ?
                <Primary label={selectingOfferId === offer.id ? "Selecting..." : "Select this Provider"} onPress={() => void selectProvider(request.id, offer.id)} disabled={!!selectingOfferId || busy} /> :
                <Text style={s.meta}>This request is closed; this offer cannot be selected.</Text>}
            </View>)}
            {offers.length === 0 ? <Text style={s.helper}>No offers yet. Matched Providers can still respond while this request is open.</Text> : null}
          </View>;
        })}
        {!busy && myRequests.length === 0 ? <Text style={s.helper}>You have not published any service requests yet.</Text> : null}
      </> : <>
        <Text style={s.section}>Your Provider profile</Text>
        <Text style={s.helper}>Tell AnySkill what work you do and where you can do it. Matching uses these details and your availability.</Text>
        <Text style={s.label}>Skill categories (comma-separated)</Text>
        <TextInput value={providerSkills} onChangeText={setProviderSkills} placeholder="e.g. Plumbing, Electrical, Painting" style={s.input} />
        <Text style={s.label}>Service areas (comma-separated)</Text>
        <TextInput value={providerAreas} onChangeText={setProviderAreas} placeholder="e.g. Rosebank, Sandton, Johannesburg" style={s.input} />
        <Text style={s.label}>Delivery modes (ONSITE, REMOTE, EITHER)</Text>
        <TextInput value={providerModes} onChangeText={setProviderModes} placeholder="ONSITE, REMOTE" style={s.input} />
        <Pressable onPress={() => setProviderAvailable((value) => !value)} style={s.availability}>
          <Text style={s.availabilityText}>{providerAvailable ? "● Available for matching" : "○ Not available for matching"}</Text>
        </Pressable>
        <Primary label="Save Provider profile" onPress={saveProviderProfile} disabled={savingProfile || !providerProfileLoaded || !providerSkills.trim()} />
        <Text style={s.section}>Notifications</Text>
        {notifications.slice(0,4).map((item) => <View key={item.id} style={s.notificationCard}>
          <Text style={s.cardTitle}>{item.title}</Text><Text style={s.meta}>{item.body}</Text>
        </View>)}
        <Text style={s.section}>Incoming service requests</Text>
        <Text style={s.helper}>You can view requests before verification. You must be verified before sending an offer.</Text>
        {!p.verified && <View style={s.notice}><Text style={s.noticeTitle}>You can explore available work</Text><Text style={s.noticeText}>When you tap Accept, AnySkill will ask you to verify your identity first. The request can be reopened after approval if it is still available.</Text></View>}
        <Secondary label="Refresh requests" onPress={() => void loadRequests()} />
        {busy && <ActivityIndicator style={{ marginTop: 16 }} color={C.primary} />}
        {requests.map((request) => <View key={request.id} style={[s.card, request.id === p.pendingRequestId && s.highlight]}>
          <Text style={s.cardTitle}>{request.title}</Text>
          <Text style={s.meta}>{request.skillCategory} · {request.deliveryMode === "ONSITE" ? "On-site" : request.deliveryMode === "REMOTE" ? "Remote" : "On-site or remote"}</Text>
          <Text style={s.body}>{request.description}</Text>
          {request.location ? <Text style={s.meta}>Area: {request.location}</Text> : null}
          {request.preferredStartAt ? <Text style={s.meta}>Preferred: {new Date(request.preferredStartAt).toLocaleString()}</Text> : null}
          {request.alreadyResponded ? <Text style={s.response}>You have already responded to this request.</Text> : <Primary label="Accept request" onPress={() => void acceptRequest(request)} disabled={busy} />}
        </View>)}
        {!busy && requests.length === 0 && <Text style={s.helper}>No open requests are available right now. Pull to refresh or check again later.</Text>}
      </>}
      {notice ? <Text style={s.success}>{notice}</Text> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
    </ScrollView>
  </View>;
}

function Primary(p: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable onPress={p.onPress} disabled={p.disabled} style={[s.primary, p.disabled && { opacity: 0.45 }]}><Text style={s.primaryText}>{p.label}</Text></Pressable>;
}
function Secondary(p: { label: string; onPress: () => void }) {
  return <Pressable onPress={p.onPress} style={s.secondary}><Text style={s.secondaryText}>{p.label}</Text></Pressable>;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 14 },
  back: { color: C.primary, fontWeight: "800", fontSize: 14, marginBottom: 16 },
  heading: { color: C.ink, fontSize: 28, fontWeight: "800" },
  subheading: { color: C.muted, marginTop: 5, fontSize: 13 },
  modeRow: { flexDirection: "row", gap: 8, paddingHorizontal: 22, paddingBottom: 12 },
  modeButton: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, alignItems: "center", backgroundColor: C.surface },
  modeActive: { borderColor: C.primary, backgroundColor: "#E7F2EE" },
  modeText: { color: C.muted, fontWeight: "700", fontSize: 12 },
  modeTextActive: { color: C.primary },
  content: { paddingHorizontal: 22, paddingBottom: 36 },
  section: { color: C.ink, fontSize: 19, fontWeight: "800", marginTop: 8 },
  sectionSmall: { color: C.ink, fontSize: 14, fontWeight: "800", marginTop: 15 },
  offerCard: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 11, padding: 12, marginTop: 10 },
  offerTitle: { color: C.ink, fontSize: 13, fontWeight: "800" },
  helper: { color: C.muted, fontSize: 12, lineHeight: 18, marginTop: 8, marginBottom: 14 },
  label: { color: C.ink, fontSize: 12, fontWeight: "800", marginTop: 13, marginBottom: 6 },
  input: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 11, minHeight: 48, paddingHorizontal: 12, color: C.ink },
  multiline: { minHeight: 110, paddingTop: 12, textAlignVertical: "top" },
  choiceRow: { flexDirection: "row", gap: 7, marginTop: 6, marginBottom: 12 },
  choice: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10, alignItems: "center", backgroundColor: C.surface },
  choiceActive: { borderColor: C.primary, backgroundColor: "#E7F2EE" },
  choiceText: { color: C.muted, fontWeight: "700", fontSize: 11 },
  choiceTextActive: { color: C.primary },
  availability: { borderWidth: 1, borderColor: C.border, borderRadius: 11, padding: 13, marginTop: 12, backgroundColor: C.surface },
  availabilityText: { color: C.primary, fontWeight: "800", fontSize: 12 },
  notificationCard: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, marginTop: 8 },
  notice: { backgroundColor: C.warning, borderRadius: 13, padding: 13, marginVertical: 12 },
  noticeTitle: { color: C.warningInk, fontWeight: "800", fontSize: 13, marginBottom: 4 },
  noticeText: { color: C.warningInk, fontSize: 12, lineHeight: 18 },
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 15, marginTop: 13 },
  highlight: { borderColor: C.primary, borderWidth: 2 },
  cardTitle: { color: C.ink, fontSize: 16, fontWeight: "800" },
  meta: { color: C.muted, fontSize: 11, marginTop: 6 },
  body: { color: C.ink, fontSize: 13, lineHeight: 19, marginTop: 10 },
  response: { color: C.primary, fontSize: 12, fontWeight: "700", marginTop: 12 },
  primary: { backgroundColor: C.primary, borderRadius: 11, minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, marginTop: 12 },
  primaryText: { color: "#FFF", fontSize: 13, fontWeight: "800" },
  secondary: { borderColor: C.border, borderWidth: 1, borderRadius: 11, minHeight: 45, alignItems: "center", justifyContent: "center", marginTop: 10, paddingHorizontal: 12, backgroundColor: C.surface },
  secondaryText: { color: C.primary, fontWeight: "800", fontSize: 12 },
  success: { color: C.primary, fontWeight: "700", fontSize: 12, marginTop: 15 },
  error: { color: "#A12D2D", fontWeight: "700", fontSize: 12, marginTop: 15 },
});
