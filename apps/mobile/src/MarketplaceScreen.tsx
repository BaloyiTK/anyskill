import { useCallback, useEffect, useState } from "react";
import * as Notifications from "expo-notifications";
import * as ImagePicker from "expo-image-picker";
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
type JobAdjustment = { id: string; requestedHours: string | number; requestedAmount: string | number; reason: string; status: string; decisionNote: string | null };
type CompletionSubmission = { id: string; notes: string; evidenceUrls: string[]; evidenceAssets?: Array<{id:string;originalName:string;contentType:string;sizeBytes:number}>; status: string; reviewNote: string | null; submittedAt: string; reviewedAt: string | null };
type JobEngagement = { id: string; status: string; hourlyRate: string | number; assessmentFee: string | number; estimatedHours: string | number | null; estimatedTotal: string | number | null; estimateNotes: string | null; estimateDecisionNote: string | null; adjustments: JobAdjustment[]; completionSubmissions: CompletionSubmission[] };
type SeekerRequest = {
  id: string; title: string; skillCategory: string; description: string;
  deliveryMode: "ONSITE" | "REMOTE" | "EITHER"; location: string | null;
  status: string; createdAt: string; jobEngagement: JobEngagement | null;
  providerResponses: Array<{
    id: string; providerId: string; status: string; message: string | null; createdAt: string;
    hourlyRateAtOffer: string | number | null; assessmentFeeAtOffer: string | number | null;
    provider: { providerProfile: { publicName: string; hourlyRate: string | number | null; assessmentFee: string | number; skillCategories: string[]; serviceAreas: string[]; deliveryModes: string[] } | null };
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
  const [myJobs, setMyJobs] = useState<Array<JobEngagement & { request: { id: string; title: string; description: string; location: string | null } }>>([]);
  const [estimateHours, setEstimateHours] = useState("2");
  const [estimateNotes, setEstimateNotes] = useState("");
  const [extraHours, setExtraHours] = useState("1");
  const [extraReason, setExtraReason] = useState("");
  const [completionNotes, setCompletionNotes] = useState("");
  const [completionEvidenceAssets, setCompletionEvidenceAssets] = useState<Array<{id:string;name:string;uri:string;contentType:string;sizeBytes:number}>>([]);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [completionReviewNote, setCompletionReviewNote] = useState("");
  const [jobActionBusy, setJobActionBusy] = useState(false);
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
  const [providerPublicName, setProviderPublicName] = useState("");
  const [providerHourlyRate, setProviderHourlyRate] = useState("");
  const [providerAssessmentFee, setProviderAssessmentFee] = useState("0");
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

  const submitEstimate = async (requestId: string) => {
    setJobActionBusy(true); setError(""); setNotice("");
    try {
      await apiRequest(`/marketplace/requests/${requestId}/estimate`, { method: "POST", body: JSON.stringify({ estimatedHours: Number(estimateHours), notes: estimateNotes.trim() }) }, true);
      setNotice("Estimate submitted. Work cannot start until the Seeker approves it.");
      setEstimateNotes(""); await loadMyJobs();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit estimate."); }
    finally { setJobActionBusy(false); }
  };

  const startWork = async (requestId: string) => {
    setJobActionBusy(true); setError("");
    try { await apiRequest(`/marketplace/requests/${requestId}/start-work`, { method: "POST" }, true); setNotice("Work marked as started."); await loadMyJobs(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not start work."); }
    finally { setJobActionBusy(false); }
  };

  const requestExtraHours = async (requestId: string) => {
    setJobActionBusy(true); setError("");
    try {
      await apiRequest(`/marketplace/requests/${requestId}/additional-hours`, { method: "POST", body: JSON.stringify({ additionalHours: Number(extraHours), reason: extraReason.trim() }) }, true);
      setNotice("Additional-hours request sent. Do not perform the extra work until approved.");
      setExtraReason(""); await loadMyJobs();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not request additional hours."); }
    finally { setJobActionBusy(false); }
  };

  const decideEstimate = async (requestId: string, approved: boolean) => {
    setJobActionBusy(true); setError("");
    try {
      await apiRequest(`/marketplace/requests/${requestId}/estimate-decision`, { method: "POST", body: JSON.stringify({ approved, note: approved ? undefined : "The estimate needs revision. Please review the hours and explanation." }) }, true);
      setNotice(approved ? "Estimate approved. The Provider may now start work." : "Estimate rejected. The Provider must submit a revised estimate.");
      await loadMyRequests();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit your decision."); }
    finally { setJobActionBusy(false); }
  };

  const decideExtraHours = async (requestId: string, adjustmentId: string, approved: boolean) => {
    setJobActionBusy(true); setError("");
    try {
      await apiRequest(`/marketplace/requests/${requestId}/additional-hours/${adjustmentId}/decision`, { method: "POST", body: JSON.stringify({ approved, note: approved ? undefined : "Additional hours not approved." }) }, true);
      setNotice(approved ? "Additional hours approved." : "Additional hours rejected.");
      await loadMyRequests();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not decide additional hours."); }
    finally { setJobActionBusy(false); }
  };


  const pickCompletionEvidence = async () => {
    if (completionEvidenceAssets.length >= 8) { setError("You can attach up to 8 photos."); return; }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError("Allow photo-library access to attach completion evidence."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 8 - completionEvidenceAssets.length, quality: 0.85 });
    if (result.canceled) return;
    setUploadingEvidence(true); setError(""); setNotice("");
    try {
      for (const file of result.assets) {
        const mime = file.mimeType ?? "image/jpeg";
        if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("Only JPEG, PNG and WebP photos are supported.");
        const size = file.fileSize ?? 0;
        if (!size || size > 10 * 1024 * 1024) throw new Error("Each photo must be no larger than 10 MB.");
        const reservation = await apiRequest<{assetId:string;cloudName:string;apiKey:string;timestamp:number;signature:string;publicId:string;folder:string}>("/marketplace/media/uploads", {
          method: "POST", body: JSON.stringify({ fileName: file.fileName ?? "completion-photo", contentType: mime, sizeBytes: size }),
        }, true);
        const body = new FormData();
        body.append("file", { uri: file.uri, name: file.fileName ?? "completion-photo", type: mime } as unknown as Blob);
        body.append("api_key", reservation.apiKey); body.append("timestamp", String(reservation.timestamp)); body.append("signature", reservation.signature);
        body.append("public_id", reservation.publicId); body.append("folder", reservation.folder);
        body.append("overwrite", "false"); body.append("unique_filename", "false"); body.append("use_filename", "false");
        const uploaded = await fetch("https://api.cloudinary.com/v1_1/" + reservation.cloudName + "/image/authenticated", { method: "POST", body });
        if (!uploaded.ok) { const detail = await uploaded.json().catch(() => ({})); throw new Error(detail.error?.message ?? "Cloudinary upload failed."); }
        await apiRequest("/marketplace/media/uploads/confirm", { method: "POST", body: JSON.stringify({ assetId: reservation.assetId }) }, true);
        setCompletionEvidenceAssets((current) => [...current, { id: reservation.assetId, name: file.fileName ?? "Completion photo", uri: file.uri, contentType: mime, sizeBytes: size }]);
      }
      setNotice("Photo upload complete. Images are securely stored in Cloudinary.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not upload evidence photos."); }
    finally { setUploadingEvidence(false); }
  };

  const submitCompletion = async (requestId: string) => {
    setJobActionBusy(true); setError(""); setNotice("");
    try {
      await apiRequest("/marketplace/requests/" + requestId + "/completion", {
        method: "POST", body: JSON.stringify({ notes: completionNotes.trim(), evidenceAssetIds: completionEvidenceAssets.map((asset) => asset.id) }),
      }, true);
      setNotice("Completion submitted with uploaded photo evidence. The Seeker must review and approve it.");
      setCompletionNotes(""); setCompletionEvidenceAssets([]); await loadMyJobs();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit job completion."); }
    finally { setJobActionBusy(false); }
  };

  const reviewCompletion = async (requestId: string, submissionId: string, approved: boolean) => {
    setJobActionBusy(true); setError(""); setNotice("");
    try {
      await apiRequest(`/marketplace/requests/${requestId}/completion/${submissionId}/decision`, {
        method: "POST", body: JSON.stringify({ approved, note: approved ? undefined : completionReviewNote.trim() }),
      }, true);
      setNotice(approved ? "Completion approved. The job is marked completed." : "Corrections requested. The Provider can update the work and resubmit.");
      setCompletionReviewNote(""); await loadMyRequests();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not review job completion."); }
    finally { setJobActionBusy(false); }
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

  const loadProviderProfile = useCallback(async () => {
    setProviderProfileLoaded(false);
    try {
      const profile = await apiRequest<{
        publicName: string; hourlyRate: string | number | null; assessmentFee: string | number;
        skillCategories: string[]; serviceAreas: string[]; deliveryModes: string[]; isAvailable: boolean;
      } | null>("/marketplace/provider-profile", {}, true);
      if (profile) {
        setProviderPublicName(profile.publicName || "");
        setProviderHourlyRate(profile.hourlyRate == null ? "" : String(profile.hourlyRate));
        setProviderAssessmentFee(String(profile.assessmentFee ?? 0));
        setProviderSkills(profile.skillCategories.join(", "));
        setProviderAreas(profile.serviceAreas.join(", "));
        setProviderModes(profile.deliveryModes.join(", "));
        setProviderAvailable(profile.isAvailable);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load Provider profile."); }
    finally { setProviderProfileLoaded(true); }
  }, []);

  const loadMyJobs = useCallback(async () => {
    try {
      const result = await apiRequest<Array<JobEngagement & { request: { id: string; title: string; description: string; location: string | null } }>>("/marketplace/my-jobs", {}, true);
      setMyJobs(result);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load selected jobs."); }
  }, []);

  useEffect(() => {
    if (p.mode === "provider") { void loadRequests(); void loadProviderProfile(); void loadMyJobs(); }
  }, [p.mode, loadRequests, loadProviderProfile, loadMyJobs]);

  const saveProviderProfile = async () => {
    setSavingProfile(true); setError(""); setNotice("");
    try {
      const profile = await apiRequest<{isAvailable:boolean}>("/marketplace/provider-profile", {
        method: "POST",
        body: JSON.stringify({
          publicName: providerPublicName.trim(),
          hourlyRate: Number(providerHourlyRate),
          assessmentFee: Number(providerAssessmentFee),
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
            {request.jobEngagement?.status === "COMPLETION_PENDING" ? request.jobEngagement.completionSubmissions.filter((submission) => submission.status === "PENDING").map((submission) => <View key={submission.id} style={s.offerCard}>
              <Text style={s.offerTitle}>Provider completion submitted</Text>
              <Text style={s.meta}>Submitted {new Date(submission.submittedAt).toLocaleString()}</Text>
              <Text style={s.body}>{submission.notes}</Text>
              {submission.evidenceAssets?.map((asset, index) => <Pressable key={asset.id} onPress={async () => { try { const result = await apiRequest<{url:string}>("/marketplace/media/" + asset.id + "/url", {}, true); const { Linking } = await import("react-native"); await Linking.openURL(result.url); } catch (e) { setError(e instanceof Error ? e.message : "Could not open evidence photo."); } }}><Text style={s.response}>View photo evidence {index + 1} · {asset.originalName}</Text></Pressable>)}
              {submission.evidenceUrls.map((url, index) => <Text key={url} style={s.meta}>Legacy evidence link {index + 1}: {url}</Text>)}
              <Text style={s.label}>If rejecting, explain what needs correction</Text>
              <TextInput value={completionReviewNote} onChangeText={setCompletionReviewNote} placeholder="Describe the work that still needs attention..." multiline style={[s.input, s.multiline]} />
              <View style={s.choiceRow}>
                <Primary label="Approve completion" onPress={() => void reviewCompletion(request.id, submission.id, true)} disabled={jobActionBusy} />
                <Secondary label="Request corrections" onPress={() => { if (!jobActionBusy && completionReviewNote.trim().length >= 10) void reviewCompletion(request.id, submission.id, false); }} />
              </View>
            </View>) : null}
            {request.jobEngagement?.status === "COMPLETED" ? <Text style={s.response}>Completion approved by you. Job marked completed.</Text> : null}
            {request.jobEngagement?.completionSubmissions.filter((submission) => submission.status === "REJECTED").map((submission) => <View key={submission.id} style={s.offerCard}>
              <Text style={s.meta}>Previous completion review: corrections requested</Text>
              <Text style={s.body}>{submission.reviewNote}</Text>
            </View>)}            {request.jobEngagement ? <View style={s.offerCard}>
              <Text style={s.offerTitle}>Assessment and job-cost approval</Text>
              <Text style={s.meta}>Status: {request.jobEngagement.status.replaceAll("_", " ")}</Text>
              <Text style={s.meta}>Agreed hourly rate: R {Number(request.jobEngagement.hourlyRate).toFixed(2)}</Text>
              <Text style={s.meta}>Assessment fee: R {Number(request.jobEngagement.assessmentFee).toFixed(2)}</Text>
              {request.jobEngagement.estimatedHours != null ? <Text style={s.meta}>Estimated hours: {Number(request.jobEngagement.estimatedHours).toFixed(2)}</Text> : null}
              {request.jobEngagement.estimatedTotal != null ? <Text style={s.cardTitle}>Estimated job cost: R {Number(request.jobEngagement.estimatedTotal).toFixed(2)}</Text> : null}
              {request.jobEngagement.estimateNotes ? <Text style={s.body}>Provider explanation: {request.jobEngagement.estimateNotes}</Text> : null}
              {request.jobEngagement.status === "ESTIMATE_SUBMITTED" ? <View style={s.choiceRow}>
                <Primary label="Approve estimate" onPress={() => void decideEstimate(request.id, true)} disabled={jobActionBusy} />
                <Secondary label="Reject / request revision" onPress={() => void decideEstimate(request.id, false)} />
              </View> : null}
              {request.jobEngagement.status === "ESTIMATE_REJECTED" ? <Text style={s.meta}>You rejected the estimate. The Provider can submit a revised estimate.</Text> : null}
              {request.jobEngagement.adjustments.map((adjustment) => <View key={adjustment.id} style={s.offerCard}>
                <Text style={s.offerTitle}>Additional hours: {Number(adjustment.requestedHours).toFixed(2)}</Text>
                <Text style={s.meta}>Additional cost: R {Number(adjustment.requestedAmount).toFixed(2)} · {adjustment.status}</Text>
                <Text style={s.body}>{adjustment.reason}</Text>
                {adjustment.status === "PENDING" ? <View style={s.choiceRow}>
                  <Primary label="Approve extra hours" onPress={() => void decideExtraHours(request.id, adjustment.id, true)} disabled={jobActionBusy} />
                  <Secondary label="Reject" onPress={() => void decideExtraHours(request.id, adjustment.id, false)} />
                </View> : null}
              </View>)}
            </View> : null}
            <Text style={s.sectionSmall}>Offers received ({offers.length})</Text>
            {offers.map((offer, index) => <View key={offer.id} style={s.offerCard}>
              <Text style={s.offerTitle}>{offer.provider.providerProfile?.publicName || "Skill Provider"}</Text>
              <Text style={s.meta}>Provider offer {index + 1}</Text>
              <Text style={s.meta}>Received {new Date(offer.createdAt).toLocaleString()}</Text>
              <Text style={s.meta}>Provider ID: {offer.providerId.slice(0, 8)}</Text>
              <Text style={s.meta}>Hourly rate: {offer.hourlyRateAtOffer == null ? "Not supplied" : `R ${Number(offer.hourlyRateAtOffer).toFixed(2)} / hour`}</Text>
              <Text style={s.meta}>Assessment fee: {offer.assessmentFeeAtOffer == null ? "Not supplied" : Number(offer.assessmentFeeAtOffer) === 0 ? "No assessment fee" : `R ${Number(offer.assessmentFeeAtOffer).toFixed(2)}`}</Text>
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
        <Text style={s.label}>Public Provider name</Text>
        <TextInput value={providerPublicName} onChangeText={setProviderPublicName} placeholder="e.g. Tiyani's Plumbing Services" style={s.input} />
        <Text style={s.label}>Hourly rate (ZAR)</Text>
        <TextInput value={providerHourlyRate} onChangeText={setProviderHourlyRate} placeholder="e.g. 350.00" keyboardType="decimal-pad" style={s.input} />
        <Text style={s.label}>Assessment / call-out fee (ZAR)</Text>
        <TextInput value={providerAssessmentFee} onChangeText={setProviderAssessmentFee} placeholder="0.00" keyboardType="decimal-pad" style={s.input} />
        <Text style={s.helper}>The Seeker sees these charges before choosing you. Your hourly rate and assessment fee are saved with each offer, so later profile edits do not change an existing offer.</Text>
        <Text style={s.label}>Skill categories (comma-separated)</Text>
        <TextInput value={providerSkills} onChangeText={setProviderSkills} placeholder="e.g. Plumbing, Electrical, Painting" style={s.input} />
        <Text style={s.label}>Service areas (comma-separated)</Text>
        <TextInput value={providerAreas} onChangeText={setProviderAreas} placeholder="e.g. Rosebank, Sandton, Johannesburg" style={s.input} />
        <Text style={s.label}>Delivery modes (ONSITE, REMOTE, EITHER)</Text>
        <TextInput value={providerModes} onChangeText={setProviderModes} placeholder="ONSITE, REMOTE" style={s.input} />
        <Pressable onPress={() => setProviderAvailable((value) => !value)} style={s.availability}>
          <Text style={s.availabilityText}>{providerAvailable ? "● Available for matching" : "○ Not available for matching"}</Text>
        </Pressable>
        <Primary label="Save Provider profile" onPress={saveProviderProfile} disabled={savingProfile || !providerProfileLoaded || !providerSkills.trim() || providerPublicName.trim().length < 2 || !(Number(providerHourlyRate) > 0) || !Number.isFinite(Number(providerAssessmentFee)) || Number(providerAssessmentFee) < 0} />
        <Text style={s.section}>Selected jobs and assessments</Text>
        <Secondary label="Refresh selected jobs" onPress={() => void loadMyJobs()} />
        {myJobs.map((job) => <View key={job.id} style={s.card}>
          <Text style={s.cardTitle}>{job.request.title}</Text>
          <Text style={s.meta}>Status: {job.status.replaceAll("_", " ")}</Text>
          <Text style={s.meta}>Agreed rate: R {Number(job.hourlyRate).toFixed(2)} / hour · Assessment fee: R {Number(job.assessmentFee).toFixed(2)}</Text>
          {job.status === "ASSESSMENT_PENDING" || job.status === "ESTIMATE_REJECTED" ? <>
            <Text style={s.helper}>Complete the assessment, then submit the estimated hours and a clear explanation. The Seeker must approve before work begins.</Text>
            <TextInput value={estimateHours} onChangeText={setEstimateHours} keyboardType="decimal-pad" placeholder="Estimated hours" style={s.input} />
            <TextInput value={estimateNotes} onChangeText={setEstimateNotes} placeholder="Explain the assessment and work required..." multiline style={[s.input, s.multiline]} />
            <Primary label="Submit job estimate" onPress={() => void submitEstimate(job.request.id)} disabled={jobActionBusy || !(Number(estimateHours) > 0) || estimateNotes.trim().length < 10} />
          </> : null}
          {job.estimatedTotal != null ? <Text style={s.cardTitle}>Estimate: R {Number(job.estimatedTotal).toFixed(2)} for {Number(job.estimatedHours).toFixed(2)} hours</Text> : null}
          {job.status === "ESTIMATE_APPROVED" ? <Primary label="Start approved work" onPress={() => void startWork(job.request.id)} disabled={jobActionBusy} /> : null}
          {job.status === "IN_PROGRESS" ? <>
            <Text style={s.helper}>Need more time? Explain why and request approval before doing the extra work.</Text>
            <TextInput value={extraHours} onChangeText={setExtraHours} keyboardType="decimal-pad" placeholder="Additional hours" style={s.input} />
            <TextInput value={extraReason} onChangeText={setExtraReason} placeholder="Explain why extra hours are required..." multiline style={[s.input, s.multiline]} />
            <Primary label="Request additional hours" onPress={() => void requestExtraHours(job.request.id)} disabled={jobActionBusy || !(Number(extraHours) > 0) || extraReason.trim().length < 10} />
          </> : null}
          {job.adjustments.map((adjustment) => <Text key={adjustment.id} style={s.meta}>Extra hours request: {Number(adjustment.requestedHours).toFixed(2)} · R {Number(adjustment.requestedAmount).toFixed(2)} · {adjustment.status}</Text>)}
{job.status === "IN_PROGRESS" ? <>
            <Text style={s.helper}>When the agreed work is finished, submit completion notes and photo evidence. The Seeker must approve before the job is marked completed.</Text>
            <Text style={s.label}>Completion notes</Text>
            <TextInput value={completionNotes} onChangeText={setCompletionNotes} placeholder="Summarise the work completed, tests performed and any handover details..." multiline style={[s.input, s.multiline]} />
            <Text style={s.label}>Photo evidence (up to 8 photos, 10 MB each)</Text>
            <Secondary label={uploadingEvidence ? "Uploading photos..." : "Choose photos"} onPress={() => void pickCompletionEvidence()} />
            {completionEvidenceAssets.map((asset) => <Text key={asset.id} style={s.meta}>✓ {asset.name} · {(asset.sizeBytes / 1024 / 1024).toFixed(1)} MB</Text>)}
            <Primary label="Submit job completion" onPress={() => void submitCompletion(job.request.id)} disabled={jobActionBusy || uploadingEvidence || completionNotes.trim().length < 20 || completionEvidenceAssets.length < 1} />
          </> : null}
          {job.status === "COMPLETION_PENDING" ? <Text style={s.helper}>Completion submitted. Wait for the Seeker to review it. Do not mark the job complete yourself.</Text> : null}
          {job.status === "COMPLETED" ? <Text style={s.response}>The Seeker approved this job's completion.</Text> : null}
          {job.completionSubmissions.map((submission) => <View key={submission.id} style={s.offerCard}>
            <Text style={s.meta}>Completion submission · {submission.status} · {new Date(submission.submittedAt).toLocaleString()}</Text>
            <Text style={s.body}>{submission.notes}</Text>
            {submission.evidenceAssets?.map((asset, index) => <Pressable key={asset.id} onPress={async () => { try { const result = await apiRequest<{url:string}>("/marketplace/media/" + asset.id + "/url", {}, true); const { Linking } = await import("react-native"); await Linking.openURL(result.url); } catch (e) { setError(e instanceof Error ? e.message : "Could not open evidence photo."); } }}><Text style={s.response}>View submitted photo {index + 1} · {asset.originalName}</Text></Pressable>)}
            {submission.reviewNote ? <Text style={s.meta}>Seeker feedback: {submission.reviewNote}</Text> : null}
          </View>)}
        </View>)}
        {!myJobs.length ? <Text style={s.helper}>No selected jobs yet. When a Seeker selects your offer, the assessment will appear here.</Text> : null}
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
