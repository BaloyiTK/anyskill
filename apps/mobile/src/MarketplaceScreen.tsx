import { useCallback, useEffect, useState } from "react";
import * as Notifications from "expo-notifications";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { MapPinPicker } from "./MapPinPicker";
import { Platform } from "react-native";
import {
  ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
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
  latitude: number | null;
  longitude: number | null;
  deliveryMode: "ONSITE" | "REMOTE" | "EITHER";
  preferredStartAt: string | null;
  instructions: string | null;
  status: string;
  createdAt: string;
  seeker: { firstName: string; lastName: string; profilePhotoUrl: string | null; identityVerified: boolean };
  providerLocation: { latitude: number; longitude: number } | null;
  distanceKm: number | null;
  alreadyResponded: boolean;
  myResponse: { id: string; status: string } | null;
};
type JobAdjustment = { id: string; requestedHours: string | number; requestedAmount: string | number; reason: string; status: string; decisionNote: string | null };
type CompletionSubmission = { id: string; notes: string; evidenceUrls: string[]; evidenceAssets?: Array<{id:string;originalName:string;contentType:string;sizeBytes:number}>; status: string; reviewNote: string | null; submittedAt: string; reviewedAt: string | null };
type JobEngagement = { id: string; status: string; hourlyRate: string | number; assessmentFee: string | number; estimatedHours: string | number | null; estimatedTotal: string | number | null; estimateNotes: string | null; estimateDecisionNote: string | null; workStartedAt?: string | null; workAccumulatedMs?: number; workSegmentStartedAt?: string | null; workPausedAt?: string | null; workEndedAt?: string | null; serverNow?: string; adjustments: JobAdjustment[]; completionSubmissions: CompletionSubmission[] };
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
const C = { ink: "#15251E", muted: "#66756D", primary: "#176B55", border: "#E1E8E3", surface: "#FFFFFF", warning: "#FFF6E4", warningInk: "#78551A", bg: "#F5F7F5" };

function getWorkElapsedMs(job: JobEngagement, now: number) {
  const accumulated = Math.max(0, Number(job.workAccumulatedMs ?? 0));
  if (!job.workSegmentStartedAt || job.workPausedAt || job.status !== "IN_PROGRESS") return accumulated;
  const startedAt = Date.parse(job.workSegmentStartedAt);
  return accumulated + (Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : 0);
}

function formatWorkDuration(milliseconds: number) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function MarketplaceScreen(p: Props) {
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [myRequests, setMyRequests] = useState<SeekerRequest[]>([]);
  const [selectingOfferId, setSelectingOfferId] = useState<string | null>(null);
  const [myJobs, setMyJobs] = useState<Array<JobEngagement & { request: { id: string; title: string; description: string; location: string | null; latitude: number | null; longitude: number | null } }>>([]);
  const [clockNow, setClockNow] = useState(Date.now());
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
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
  const [skillSuggestions, setSkillSuggestions] = useState<Array<{name:string;providerCount:number}>>([]);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillBusy, setSkillBusy] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [requestLatitude, setRequestLatitude] = useState<number | null>(null);
  const [requestLongitude, setRequestLongitude] = useState<number | null>(null);
  const [savedHomeLocation, setSavedHomeLocation] = useState<{homeLocationLabel:string|null;homeLatitude:number|null;homeLongitude:number|null} | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState<"ONSITE" | "REMOTE" | "EITHER">("ONSITE");
  const [responseMessage, setResponseMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [matchingRequest, setMatchingRequest] = useState<{id:string;title:string;skillCategory:string;location:string|null;notified:number;wave:number}|null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [verificationPrompt, setVerificationPrompt] = useState(false);
  const [providerPublicName, setProviderPublicName] = useState("");
  const [providerHourlyRate, setProviderHourlyRate] = useState("");
  const [providerAssessmentFee, setProviderAssessmentFee] = useState("0");
  const [providerTravelRadius, setProviderTravelRadius] = useState("25");
  const [providerSkills, setProviderSkills] = useState("");
  const [providerAreas, setProviderAreas] = useState("");
  const [providerModes, setProviderModes] = useState("ONSITE");
  const [providerAvailable, setProviderAvailable] = useState(false);
  const [providerLiveTrackingEnabled, setProviderLiveTrackingEnabled] = useState(false);
  const [providerProfileLoaded, setProviderProfileLoaded] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [notifications, setNotifications] = useState<Array<{id:string;title:string;body:string;readAt:string|null;createdAt:string}>>([]);

  const searchSkills = useCallback(async (query: string) => {
    try {
      const result = await apiRequest<{items:Array<{name:string;providerCount:number}>}>("/marketplace/skills" + (query.trim() ? "?q=" + encodeURIComponent(query.trim()) : ""), {}, true);
      setSkillSuggestions(result.items);
    } catch { setSkillSuggestions([]); }
  }, []);

  const addSkill = async () => {
    const value = skillQuery.trim();
    if (value.length < 2) { setError("Enter at least 2 characters for the skill."); return; }
    setSkillBusy(true); setError(""); setNotice("");
    try {
      const result = await apiRequest<{items:Array<{name:string;providerCount:number}>}>("/marketplace/skills?q=" + encodeURIComponent(value), {}, true);
      const match = result.items.find((item) => item.name.trim().toLocaleLowerCase("en-ZA") === value.toLocaleLowerCase("en-ZA"))
        ?? result.items.find((item) => item.name.toLocaleLowerCase("en-ZA").includes(value.toLocaleLowerCase("en-ZA")) || value.toLocaleLowerCase("en-ZA").includes(item.name.toLocaleLowerCase("en-ZA")));
      if (match) {
        setCategory(match.name); setSkillQuery(match.name);
        setNotice("This skill already exists in AnySkill. We selected the existing skill instead of creating a duplicate.");
      } else {
        setCategory(value); setSkillQuery(value);
        setNotice("Skill added to this request. AnySkill will use the entered skill category for matching.");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not check the skill catalogue."); }
    finally { setSkillBusy(false); }
  };

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
      const requestStartedAt = Date.now();
      const result = await apiRequest<SeekerRequest[]>("/marketplace/my-requests", {}, true);
      const receivedAt = Date.now();
      const serverNow = result.find((item) => item.jobEngagement?.serverNow)?.jobEngagement?.serverNow;
      if (serverNow) setClockOffsetMs(Date.parse(serverNow) - (requestStartedAt + receivedAt) / 2);
      setMyRequests(result);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load your requests."); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (p.mode === "seeker") { void loadMyRequests(); void loadHomeLocation(); void searchSkills(""); }
  }, [p.mode, loadMyRequests, searchSkills]);

  useEffect(() => {
    if (p.mode !== "seeker") return;
    const timer = setTimeout(() => { void searchSkills(skillQuery); }, 220);
    return () => clearTimeout(timer);
  }, [skillQuery, p.mode, searchSkills]);

  useEffect(() => {
    const clock = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    const refreshJobState = async () => {
      try {
        if (p.mode === "provider") {
          const requestStartedAt = Date.now();
          const result = await apiRequest<Array<JobEngagement & { request: { id: string; title: string; description: string; location: string | null; latitude: number | null; longitude: number | null } }>>("/marketplace/my-jobs", {}, true);
          const receivedAt = Date.now();
          const serverNow = result.find((item) => item.serverNow)?.serverNow;
          if (serverNow) setClockOffsetMs(Date.parse(serverNow) - (requestStartedAt + receivedAt) / 2);
          setMyJobs(result);
        } else {
          const requestStartedAt = Date.now();
          const result = await apiRequest<SeekerRequest[]>("/marketplace/my-requests", {}, true);
          const receivedAt = Date.now();
          const serverNow = result.find((item) => item.jobEngagement?.serverNow)?.jobEngagement?.serverNow;
          if (serverNow) setClockOffsetMs(Date.parse(serverNow) - (requestStartedAt + receivedAt) / 2);
          setMyRequests(result);
        }
      } catch {
        // Retain the last server-confirmed state during temporary network loss.
      }
    };
    const refresh = setInterval(() => { void refreshJobState(); }, 12000);
    return () => clearInterval(refresh);
  }, [p.mode]);

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

  const changeWorkBreak = async (requestId: string, paused: boolean) => {
    setJobActionBusy(true); setError(""); setNotice("");
    try {
      await apiRequest(`/marketplace/requests/${requestId}/${paused ? "work-break" : "resume-work"}`, { method: "POST" }, true);
      setNotice(paused ? "Work timer paused. Break time will not be counted." : "Work timer resumed.");
      await loadMyJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the work timer.");
      await loadMyJobs();
    } finally { setJobActionBusy(false); }
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
        const reservation = await apiRequest<{assetId:string;cloudName:string;apiKey:string;timestamp:number;signature:string;publicId:string;assetFolder:string}>("/marketplace/media/uploads", {
          method: "POST", body: JSON.stringify({ fileName: file.fileName ?? "completion-photo", contentType: mime, sizeBytes: size }),
        }, true);
        const body = new FormData();
        body.append("file", { uri: file.uri, name: file.fileName ?? "completion-photo", type: mime } as unknown as Blob);
        body.append("api_key", reservation.apiKey); body.append("timestamp", String(reservation.timestamp)); body.append("signature", reservation.signature);
        body.append("public_id", reservation.publicId); body.append("asset_folder", reservation.assetFolder);
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
    if (deliveryMode === "ONSITE" && (requestLatitude == null || requestLongitude == null)) { setError("Choose the on-site job location on the map or use GPS before publishing."); return; }
    setBusy(true); setError(""); setNotice(""); setVerificationPrompt(false);
    try {
      const published = await apiRequest<{
        id: string; title: string; skillCategory: string; location: string | null;
        matching?: { notified?: number; wave?: number };
      }>("/marketplace/requests", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(), skillCategory: category.trim(), description: description.trim(), ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
          ...(location.trim() ? { location: location.trim() } : {}),
          ...(deliveryMode !== "REMOTE" && requestLatitude != null && requestLongitude != null ? { latitude: requestLatitude, longitude: requestLongitude } : {}), deliveryMode,
        }),
      }, true);
      setMatchingRequest({
        id: published.id, title: published.title, skillCategory: published.skillCategory,
        location: published.location, notified: published.matching?.notified ?? 0, wave: published.matching?.wave ?? 1,
      });
      setTitle(""); setCategory(""); setSkillQuery(""); setDescription(""); setInstructions(""); setLocation(""); setRequestLatitude(null); setRequestLongitude(null);
      await loadMyRequests();
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
        skillCategories: string[]; serviceAreas: string[]; deliveryModes: string[]; isAvailable: boolean; maxTravelDistanceKm: number;
      } | null>("/marketplace/provider-profile", {}, true);
      if (profile) {
        setProviderPublicName(profile.publicName || "");
        setProviderHourlyRate(profile.hourlyRate == null ? "" : String(profile.hourlyRate));
        setProviderAssessmentFee(String(profile.assessmentFee ?? 0));
        setProviderTravelRadius(String(profile.maxTravelDistanceKm ?? 25));
        setProviderSkills(profile.skillCategories.join(", "));
        setProviderAreas(profile.serviceAreas.join(", "));
        setProviderModes(profile.deliveryModes.join(", "));
        setProviderAvailable(profile.isAvailable);
        setProviderLiveTrackingEnabled(profile.isAvailable);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load Provider profile."); }
    finally { setProviderProfileLoaded(true); }
  }, []);

  async function loadHomeLocation() {
    try {
      const home = await apiRequest<{homeLocationLabel:string|null;homeLatitude:number|null;homeLongitude:number|null}>("/profile/location/home", {}, true);
      setSavedHomeLocation(home);
    } catch { setSavedHomeLocation(null); }
  }

  const useCurrentJobLocation = async () => {
    setLocationBusy(true); setError(""); setNotice("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error("Allow location access or choose your saved Home Location to set the job location.");
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setRequestLatitude(current.coords.latitude); setRequestLongitude(current.coords.longitude);
      setNotice("Current GPS location selected for this job only.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read current location."); }
    finally { setLocationBusy(false); }
  };

  const useSavedHomeLocation = () => {
    if (savedHomeLocation?.homeLatitude == null || savedHomeLocation?.homeLongitude == null) {
      setError("Save a Home Location with GPS coordinates in your Profile first."); return;
    }
    setRequestLatitude(savedHomeLocation.homeLatitude); setRequestLongitude(savedHomeLocation.homeLongitude);
    setLocation("On-site job location");
    setNotice("Saved Home Location selected as this job's location.");
  };

  const loadMyJobs = useCallback(async () => {
    try {
      const requestStartedAt = Date.now();
      const result = await apiRequest<Array<JobEngagement & { request: { id: string; title: string; description: string; location: string | null; latitude: number | null; longitude: number | null } }>>("/marketplace/my-jobs", {}, true);
      const receivedAt = Date.now();
      const serverNow = result.find((item) => item.serverNow)?.serverNow;
      if (serverNow) setClockOffsetMs(Date.parse(serverNow) - (requestStartedAt + receivedAt) / 2);
      setMyJobs(result);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load selected jobs."); }
  }, []);

  useEffect(() => {
    if (p.mode === "provider") { void loadRequests(); void loadProviderProfile(); void loadMyJobs(); }
  }, [p.mode, loadRequests, loadProviderProfile, loadMyJobs]);

  useEffect(() => {
    if (p.mode !== "provider" || !providerAvailable || !providerLiveTrackingEnabled ||
        (!providerModes.split(",").map((v) => v.trim()).includes("ONSITE") && !providerModes.split(",").map((v) => v.trim()).includes("EITHER"))) return;
    let active = true;
    let subscription: Location.LocationSubscription | null = null;
    const sendLocation = async (coords: Location.LocationObjectCoords) => {
      if (!active || coords.accuracy == null || coords.accuracy > 250) return;
      try {
        await apiRequest("/marketplace/provider-location/live", {
          method: "POST",
          body: JSON.stringify({ latitude: coords.latitude, longitude: coords.longitude, accuracyM: coords.accuracy }),
        }, true);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Live location update failed.");
      }
    };
    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) throw new Error("Location permission is needed for on-site matching. You remain unavailable for geographic matching until you allow it.");
        const initial = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        await sendLocation(initial.coords);
        if (!active) return;
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 15000, distanceInterval: 50 },
          (position) => { void sendLocation(position.coords); },
        );
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Could not start live location."); }
    })();
    return () => { active = false; subscription?.remove(); };
  }, [p.mode, providerAvailable, providerLiveTrackingEnabled, providerModes]);

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
          maxTravelDistanceKm: Number(providerTravelRadius),
        }),
      }, true);
      setProviderLiveTrackingEnabled(profile.isAvailable);
      setNotice(profile.isAvailable ? "Provider profile saved. Live location will be shared while the app is in use if on-site matching is enabled." : "Provider profile saved. You are currently unavailable; live location sharing has stopped.");
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
        <Text style={s.label}>Choose a skill</Text>
        <TextInput value={skillQuery} onChangeText={(value) => { setSkillQuery(value); setCategory(""); }} placeholder="Search skills, e.g. Plumbing" style={s.input} />
        <Text style={s.helper}>Popular skills are based on skills listed by AnySkill Providers.</Text>
        <View style={s.skillChipRow}>
          {skillSuggestions.slice(0, 8).map((skill) => <Pressable key={skill.name} onPress={() => { setCategory(skill.name); setSkillQuery(skill.name); }} style={[s.skillChip, category.toLowerCase() === skill.name.toLowerCase() && s.skillChipActive]}>
            <Text style={[s.skillChipText, category.toLowerCase() === skill.name.toLowerCase() && s.skillChipTextActive]}>{skill.name}</Text>
          </Pressable>)}
        </View>
        {skillQuery.trim().length >= 2 && !skillSuggestions.some((skill) => skill.name.toLowerCase() === skillQuery.trim().toLowerCase()) ?
          <Pressable onPress={() => void addSkill()} disabled={skillBusy} style={s.addSkillButton}><Text style={s.addSkillText}>{skillBusy ? "Adding..." : "Add skill"}</Text></Pressable> : null}
        {category ? <Text style={s.selectedSkill}>Selected skill: {category}</Text> : <Text style={s.helper}>Choose an existing skill or add a new one. AnySkill checks the catalogue automatically to avoid duplicates.</Text>}
        <Text style={s.label}>Describe the work</Text>
        <TextInput value={description} onChangeText={setDescription} placeholder="Explain what needs to be done..." multiline style={[s.input, s.multiline]} />
        <Text style={s.label}>Special notes (optional)</Text>
        <TextInput value={instructions} onChangeText={setInstructions} placeholder="Add access details, preferred times, materials, or anything else the Provider should know..." multiline style={[s.input, s.multiline]} />
        <Text style={s.label}>Service area (not your exact street address)</Text>
        <TextInput value={location} onChangeText={setLocation} placeholder="e.g. Rosebank, Johannesburg" style={s.input} />
        <View style={s.choiceRow}>
          <Secondary label="Use saved Home Location" onPress={useSavedHomeLocation} />
          <Secondary label={locationBusy ? "Getting GPS..." : "Use current GPS"} onPress={() => void useCurrentJobLocation()} />
        </View>
        <Text style={s.helper}>{requestLatitude != null && requestLongitude != null ? `Job coordinates selected: ${requestLatitude.toFixed(5)}, ${requestLongitude.toFixed(5)}` : "For on-site requests, choose a job location using Home Location or current GPS. Only this job location is shared with matched Providers."}</Text>
        <Text style={s.label}>Where should the work happen?</Text>
        <View style={s.choiceRow}>
          {(["ONSITE", "REMOTE", "EITHER"] as const).map((value) => <Pressable key={value} onPress={() => setDeliveryMode(value)} style={[s.choice, deliveryMode === value && s.choiceActive]}><Text style={[s.choiceText, deliveryMode === value && s.choiceTextActive]}>{value === "ONSITE" ? "On-site" : value === "REMOTE" ? "Remote" : "Either"}</Text></Pressable>)}
        </View>
        {deliveryMode !== "REMOTE" ? <>
          <Text style={s.label}>Choose the exact job location</Text>
          <View style={s.choiceRow}>
            <Secondary label="Use saved Home Location" onPress={useSavedHomeLocation} />
            <Secondary label={locationBusy ? "Getting GPS..." : "Use current GPS"} onPress={() => void useCurrentJobLocation()} />
          </View>
          <MapPinPicker
            latitude={requestLatitude ?? savedHomeLocation?.homeLatitude ?? -26.2041}
            longitude={requestLongitude ?? savedHomeLocation?.homeLongitude ?? 28.0473}
            selectedLatitude={requestLatitude}
            selectedLongitude={requestLongitude}
            onSelect={(lat, lon) => { setRequestLatitude(lat); setRequestLongitude(lon); setLocation("On-site job location"); }}
          />
        </> : <Text style={s.helper}>Remote requests do not need a physical job location or GPS coordinates.</Text>}
        <Primary label="Publish service request" onPress={submitRequest} disabled={busy || title.trim().length < 5 || category.trim().length < 2 || description.trim().length < 20 || (deliveryMode === "ONSITE" && (requestLatitude == null || requestLongitude == null))} />
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
              {["IN_PROGRESS", "COMPLETION_PENDING", "COMPLETED"].includes(request.jobEngagement.status) ? <>
                <Text style={s.cardTitle}>Working time: {formatWorkDuration(getWorkElapsedMs(request.jobEngagement, clockNow + clockOffsetMs))}</Text>
                <Text style={s.meta}>{request.jobEngagement.workPausedAt ? "Provider is on a break" : request.jobEngagement.status === "COMPLETION_PENDING" ? "Timer stopped · awaiting your review" : request.jobEngagement.status === "COMPLETED" ? "Final recorded working time" : "Work timer running"}</Text>
              </> : null}
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
        <Text style={s.helper}>Tell AnySkill what work you do and where you can do it. Matching uses these details and your availability. Live GPS is used only while Available for on-site matching.</Text>
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
        <Text style={s.label}>Maximum on-site travel distance (km)</Text>
        <TextInput value={providerTravelRadius} onChangeText={setProviderTravelRadius} placeholder="25" keyboardType="number-pad" style={s.input} />
        <Text style={s.helper}>Choose a radius from 1 to 200 km. This applies to on-site matches; remote requests do not use GPS distance.</Text>
        <Text style={s.label}>Delivery modes (ONSITE, REMOTE, EITHER)</Text>
        <TextInput value={providerModes} onChangeText={setProviderModes} placeholder="ONSITE, REMOTE" style={s.input} />
        <Text style={s.helper}>{providerLiveTrackingEnabled && providerAvailable ? "AnySkill requests foreground GPS permission when you are Available; accurate fixes are shared for on-site matching while the app is open." : "Live location is not currently being shared."}</Text>
        <Pressable onPress={() => setProviderAvailable((value) => !value)} style={s.availability}>
          <Text style={s.availabilityText}>{providerAvailable ? "● Available for matching" : "○ Not available for matching"}</Text>
        </Pressable>
        <Primary label="Save Provider profile" onPress={saveProviderProfile} disabled={savingProfile || !providerProfileLoaded || !providerSkills.trim() || providerPublicName.trim().length < 2 || !(Number(providerHourlyRate) > 0) || !Number.isFinite(Number(providerAssessmentFee)) || Number(providerAssessmentFee) < 0 || !(Number(providerTravelRadius) >= 1 && Number(providerTravelRadius) <= 200)} />
        <Text style={s.section}>Selected jobs and assessments</Text>
        <Secondary label="Refresh selected jobs" onPress={() => void loadMyJobs()} />
        {myJobs.map((job) => <View key={job.id} style={s.card}>
          <Text style={s.cardTitle}>{job.request.title}</Text>
          <Text style={s.meta}>Status: {job.status.replaceAll("_", " ")}</Text>
          {job.request.location ? <Text style={s.meta}>Job location: {job.request.location}</Text> : null}
          {job.request.latitude != null && job.request.longitude != null ? <Text style={s.meta}>Job pin: {job.request.latitude.toFixed(5)}, {job.request.longitude.toFixed(5)}</Text> : null}
          <Text style={s.meta}>Agreed rate: R {Number(job.hourlyRate).toFixed(2)} / hour · Assessment fee: R {Number(job.assessmentFee).toFixed(2)}</Text>
          {job.status === "ASSESSMENT_PENDING" || job.status === "ESTIMATE_REJECTED" ? <>
            <Text style={s.helper}>Complete the assessment, then submit the estimated hours and a clear explanation. The Seeker must approve before work begins.</Text>
            <TextInput value={estimateHours} onChangeText={setEstimateHours} keyboardType="decimal-pad" placeholder="Estimated hours" style={s.input} />
            <TextInput value={estimateNotes} onChangeText={setEstimateNotes} placeholder="Explain the assessment and work required..." multiline style={[s.input, s.multiline]} />
            <Primary label="Submit job estimate" onPress={() => void submitEstimate(job.request.id)} disabled={jobActionBusy || !(Number(estimateHours) > 0) || estimateNotes.trim().length < 10} />
          </> : null}
          {job.estimatedTotal != null ? <Text style={s.cardTitle}>Estimate: R {Number(job.estimatedTotal).toFixed(2)} for {Number(job.estimatedHours).toFixed(2)} hours</Text> : null}
          {job.status === "ESTIMATE_APPROVED" ? <Primary label="Start approved work" onPress={() => void startWork(job.request.id)} disabled={jobActionBusy} /> : null}
          {["IN_PROGRESS", "COMPLETION_PENDING", "COMPLETED"].includes(job.status) ? <>
            <Text style={s.cardTitle}>Working time: {formatWorkDuration(getWorkElapsedMs(job, clockNow + clockOffsetMs))}</Text>
            <Text style={s.meta}>{job.workPausedAt ? "ON BREAK · timer paused" : job.status === "COMPLETION_PENDING" ? "Timer stopped · awaiting Seeker review" : job.status === "COMPLETED" ? "Final recorded working time" : "Work timer running"}</Text>
          </> : null}
          {job.status === "IN_PROGRESS" ? <Secondary label={job.workPausedAt ? "Resume work" : "Take a break"} onPress={() => void changeWorkBreak(job.request.id, !job.workPausedAt)} disabled={jobActionBusy} /> : null}
          {job.status === "IN_PROGRESS" && !!job.workSegmentStartedAt && !job.workPausedAt ? <>
            <Text style={s.helper}>Need more time? Explain why and request approval before doing the extra work.</Text>
            <TextInput value={extraHours} onChangeText={setExtraHours} keyboardType="decimal-pad" placeholder="Additional hours" style={s.input} />
            <TextInput value={extraReason} onChangeText={setExtraReason} placeholder="Explain why extra hours are required..." multiline style={[s.input, s.multiline]} />
            <Primary label="Request additional hours" onPress={() => void requestExtraHours(job.request.id)} disabled={jobActionBusy || !(Number(extraHours) > 0) || extraReason.trim().length < 10} />
          </> : null}
          {job.adjustments.map((adjustment) => <Text key={adjustment.id} style={s.meta}>Extra hours request: {Number(adjustment.requestedHours).toFixed(2)} · R {Number(adjustment.requestedAmount).toFixed(2)} · {adjustment.status}</Text>)}
{job.status === "IN_PROGRESS" && !!job.workSegmentStartedAt && !job.workPausedAt ? <>
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
        {requests.map((request) => {
          const seekerName = [request.seeker?.firstName, request.seeker?.lastName].filter(Boolean).join(" ") || "Skill Seeker";
          const initials = seekerName.split(/\\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "S";
          const mapLatitude = request.providerLocation?.latitude ?? request.latitude;
          const mapLongitude = request.providerLocation?.longitude ?? request.longitude;
          const hasJobPin = request.latitude != null && request.longitude != null;
          const hasMapCenter = mapLatitude != null && mapLongitude != null;
          return <View key={request.id} style={[s.card, request.id === p.pendingRequestId && s.highlight]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 13 }}>
              {request.seeker?.profilePhotoUrl
                ? <Image source={{ uri: request.seeker.profilePhotoUrl }} style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: "#EAF3FF" }} />
                : <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: "#DCEBFA", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#0B2545", fontSize: 19, fontWeight: "900" }}>{initials}</Text></View>}
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.ink, fontSize: 15, fontWeight: "900" }}>{seekerName}</Text>
                <Text style={s.meta}>Skill Seeker · Requesting your help</Text>
                <Text style={{ color: request.seeker?.identityVerified ? "#1B5E20" : C.warningInk, fontSize: 11, fontWeight: "800", marginTop: 4 }}>
                  {request.seeker?.identityVerified ? "✓ Identity verified" : "Identity not verified"}
                </Text>
              </View>
            </View>
            <Text style={s.cardTitle}>{request.title}</Text>
            <Text style={s.meta}>{request.skillCategory} · {request.deliveryMode === "ONSITE" ? "On-site" : request.deliveryMode === "REMOTE" ? "Remote" : "On-site or remote"}</Text>
            <Text style={s.body}>{request.description}</Text>
            {request.instructions ? <View style={s.offerCard}><Text style={s.offerTitle}>Special notes</Text><Text style={s.body}>{request.instructions}</Text></View> : null}
            {request.imageUrls?.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              {request.imageUrls.slice(0, 4).map((uri, index) => <Image key={uri + index} source={{ uri }} style={{ width: 76, height: 76, borderRadius: 9, backgroundColor: "#E8EDF2" }} />)}
            </View> : null}
            {request.location ? <Text style={s.meta}>Job area: {request.location}</Text> : null}
            {request.preferredStartAt ? <Text style={s.meta}>Preferred: {new Date(request.preferredStartAt).toLocaleString()}</Text> : null}
            {request.deliveryMode !== "REMOTE" && hasJobPin && hasMapCenter ? <>
              <Text style={s.sectionSmall}>Your location and job location</Text>
              <MapPinPicker latitude={mapLatitude!} longitude={mapLongitude!} selectedLatitude={request.latitude} selectedLongitude={request.longitude} onSelect={() => undefined} readOnly showCenterMarker={!!request.providerLocation} />
              <Text style={s.meta}>{request.providerLocation ? "Blue dot: your current location · Pin: Seeker's job location" : "Your live location is unavailable. Showing the job pin only."}</Text>
              <Text style={{ color: C.primary, fontWeight: "900", fontSize: 14, marginTop: 5 }}>
                {request.distanceKm != null ? `${request.distanceKm.toFixed(1)} km straight-line distance to the job` : "Distance unavailable — enable fresh location sharing while Available"}
              </Text>
            </> : request.deliveryMode !== "REMOTE" ? <Text style={s.meta}>Job map and distance will appear when location coordinates are available.</Text> : <Text style={s.meta}>Remote request · no travel required.</Text>}
            {request.alreadyResponded ? <Text style={s.response}>You have already responded to this request.</Text> : <Primary label="Accept request" onPress={() => void acceptRequest(request)} disabled={busy} />}
          </View>;
        })}
        {!busy && requests.length === 0 && <Text style={s.helper}>No open requests are available right now. Pull to refresh or check again later.</Text>}
      </>}
      {notice ? <Text style={s.success}>{notice}</Text> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
    </ScrollView>
    <Modal visible={p.mode === "seeker" && matchingRequest !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setMatchingRequest(null)}>
      <View style={{ flex: 1, backgroundColor: "#F6F8FA", paddingHorizontal: 22, paddingTop: 54, paddingBottom: 28 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: "#0B2545", fontSize: 22, fontWeight: "900" }}>AnySkill</Text>
          <Text style={{ color: "#1B5E20", fontSize: 11, fontWeight: "900" }}>REQUEST SUBMITTED</Text>
        </View>
        <View style={{ alignItems: "center", marginTop: 48 }}>
          <ActivityIndicator size="large" color="#0066CC" />
          <Text style={{ color: "#0B2545", fontSize: 27, lineHeight: 33, fontWeight: "900", textAlign: "center", marginTop: 24 }}>Finding the best Provider for you.</Text>
          <Text style={{ color: "#66756D", fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 10 }}>AnySkill is matching your request with available Providers who have the right skills and service coverage.</Text>
        </View>
        {matchingRequest ? <View style={{ backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: "#E1E8E3", padding: 16, marginTop: 30 }}>
          <Text style={{ color: "#66756D", fontSize: 11, fontWeight: "800" }}>YOUR REQUEST</Text>
          <Text style={{ color: "#0B2545", fontSize: 17, fontWeight: "900", marginTop: 7 }}>{matchingRequest.title}</Text>
          <Text style={{ color: "#0066CC", fontSize: 13, fontWeight: "800", marginTop: 5 }}>{matchingRequest.skillCategory}</Text>
          {matchingRequest.location ? <Text style={{ color: "#66756D", fontSize: 12, marginTop: 7 }}>📍 {matchingRequest.location}</Text> : null}
        </View> : null}
        <View style={{ marginTop: 28, gap: 19 }}>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}><Text style={{ color: "#0066CC", fontWeight: "900" }}>01</Text><View><Text style={{ color: "#0B2545", fontWeight: "800" }}>Matching skills and experience</Text><Text style={{ color: "#66756D", fontSize: 12 }}>Finding Providers suited to your job</Text></View></View>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}><Text style={{ color: "#0066CC", fontWeight: "900" }}>02</Text><View><Text style={{ color: "#0B2545", fontWeight: "800" }}>Checking availability and distance</Text><Text style={{ color: "#66756D", fontSize: 12 }}>Prioritising suitable nearby Providers</Text></View></View>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}><Text style={{ color: "#0066CC", fontWeight: "900" }}>03</Text><View><Text style={{ color: "#0B2545", fontWeight: "800" }}>Sending your request</Text><Text style={{ color: "#66756D", fontSize: 12 }}>{matchingRequest?.notified ? `Notified ${matchingRequest.notified} matched Provider(s) in wave ${matchingRequest.wave}` : "Waiting for matching Providers"}</Text></View></View>
        </View>
        <View style={{ marginTop: "auto", backgroundColor: "#EAF3FF", borderRadius: 14, padding: 14 }}>
          <Text style={{ color: "#17446D", fontSize: 13, lineHeight: 19 }}>You can leave this screen. AnySkill will keep your request active and notify you when Providers respond.</Text>
        </View>
        <Pressable onPress={() => setMatchingRequest(null)} style={{ backgroundColor: "#0066CC", borderRadius: 13, padding: 15, alignItems: "center", marginTop: 14 }}>
          <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>View my requests</Text>
        </Pressable>
      </View>
    </Modal>
  </View>;
}

function Primary(p: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable onPress={p.onPress} disabled={p.disabled} style={[s.primary, p.disabled && { opacity: 0.45 }]}><Text style={s.primaryText}>{p.label}</Text></Pressable>;
}
function Secondary(p: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable onPress={p.onPress} disabled={p.disabled} style={[s.secondary, p.disabled && { opacity: 0.45 }]}><Text style={s.secondaryText}>{p.label}</Text></Pressable>;
}

const s = StyleSheet.create({
  skillChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, marginBottom: 8 },
  skillChip: { borderWidth: 1, borderColor: "#D7E2EA", backgroundColor: "#FFFFFF", borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  skillChipActive: { borderColor: "#0066CC", backgroundColor: "#EAF3FF" },
  skillChipText: { color: "#27445D", fontSize: 12, fontWeight: "600" },
  skillChipTextActive: { color: "#0066CC" },
  addSkillButton: { alignSelf: "flex-start", backgroundColor: "#0B2545", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 9, marginTop: 4 },
  addSkillText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
  selectedSkill: { color: "#1B5E20", fontSize: 12, fontWeight: "700", marginTop: 6 },
  container: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 20, paddingTop: 15, paddingBottom: 18, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  back: { color: C.primary, fontWeight: "800", fontSize: 13, marginBottom: 14 },
  heading: { color: C.ink, fontSize: 29, fontWeight: "900", letterSpacing: -0.8 },
  subheading: { color: C.muted, marginTop: 6, fontSize: 13, lineHeight: 19 },
  modeRow: { flexDirection: "row", gap: 9, paddingHorizontal: 20, paddingVertical: 13, backgroundColor: C.surface },
  modeButton: { flex: 1, borderRadius: 13, borderWidth: 1, borderColor: C.border, paddingVertical: 13, paddingHorizontal: 9, alignItems: "center", backgroundColor: "#FAFCFA" },
  modeActive: { borderColor: C.primary, backgroundColor: "#EAF4ED" },
  modeText: { color: C.muted, fontWeight: "700", fontSize: 12 },
  modeTextActive: { color: C.primary },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36 },
  section: { color: C.ink, fontSize: 19, fontWeight: "900", letterSpacing: -0.35, marginTop: 12 },
  sectionSmall: { color: C.ink, fontSize: 14, fontWeight: "800", marginTop: 15 },
  offerCard: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 11, padding: 12, marginTop: 10 },
  offerTitle: { color: C.ink, fontSize: 13, fontWeight: "800" },
  helper: { color: C.muted, fontSize: 12, lineHeight: 18, marginTop: 8, marginBottom: 14 },
  label: { color: C.ink, fontSize: 12, fontWeight: "800", marginTop: 13, marginBottom: 6 },
  input: { backgroundColor: "#FBFCFB", borderWidth: 1, borderColor: C.border, borderRadius: 13, minHeight: 52, paddingHorizontal: 14, color: C.ink, fontSize: 14 },
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
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 18, padding: 17, marginTop: 13, shadowColor: "#173B2C", shadowOpacity: 0.035, shadowRadius: 9, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  highlight: { borderColor: C.primary, borderWidth: 2 },
  cardTitle: { color: C.ink, fontSize: 16, fontWeight: "800" },
  meta: { color: C.muted, fontSize: 11, marginTop: 6 },
  body: { color: C.ink, fontSize: 13, lineHeight: 19, marginTop: 10 },
  response: { color: C.primary, fontSize: 12, fontWeight: "700", marginTop: 12 },
  primary: { backgroundColor: C.primary, borderRadius: 14, minHeight: 53, alignItems: "center", justifyContent: "center", paddingHorizontal: 15, marginTop: 12, shadowColor: "#124331", shadowOpacity: 0.12, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  primaryText: { color: "#FFF", fontSize: 13, fontWeight: "800" },
  secondary: { borderColor: C.border, borderWidth: 1, borderRadius: 13, minHeight: 49, alignItems: "center", justifyContent: "center", marginTop: 10, paddingHorizontal: 13, backgroundColor: C.surface },
  secondaryText: { color: C.primary, fontWeight: "800", fontSize: 12 },
  success: { color: C.primary, fontWeight: "700", fontSize: 12, marginTop: 15 },
  error: { color: "#A12D2D", fontWeight: "700", fontSize: 12, marginTop: 15 },
});
