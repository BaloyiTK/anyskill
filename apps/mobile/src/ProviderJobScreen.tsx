import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import * as Notifications from "expo-notifications";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { MapPinPicker } from "./MapPinPicker";
import { Alert, Linking, Platform } from "react-native";
import {
  ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { apiRequest } from "./api";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getInitialProviderLocation, startProviderLocationUpdates, stopProviderLocationUpdates } from "./provider-location";

type Mode = "seeker" | "provider";
type SavedPaymentMethod = { id: string; provider: string; cardBrand: string | null; lastFour: string | null; status: string; isDefault: boolean; createdAt: string };
const isPaymentConfirmed = (status?: string) => status === "SIMULATED_PAID" || status === "PAYFAST_PAID";
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
  seeker: { firstName: string; lastName: string; profilePhotoUrl: string | null; identityVerified: boolean; rating?: {overall:number;reviewCount:number;isRated:boolean} };
  providerLocation: { latitude: number; longitude: number } | null;
  distanceKm: number | null;
  alreadyResponded: boolean;
  myResponse: { id: string; status: string } | null;
};
type JobAdjustment = { id: string; requestedHours: string | number; requestedAmount: string | number; reason: string; status: string; decisionNote: string | null };
type CompletionSubmission = { id: string; notes: string; evidenceUrls: string[]; evidenceAssets?: Array<{id:string;originalName:string;contentType:string;sizeBytes:number}>; status: string; reviewNote: string | null; submittedAt: string; reviewedAt: string | null };
type DisputeMessage = { id: string; author: { id: string }; body: string; createdAt: string; evidenceAssets?: Array<{id:string;originalName:string;contentType:string;sizeBytes:number}> };
type JobDispute = { id: string; status: string; reason: string; resolutionNote: string | null; resolvedAt: string | null; messages: DisputeMessage[] };
type JobEngagement = { id: string; responseId?: string | null; providerId?: string | null; paymentStatus?: string; paymentSimulatedAt?: string | null; providerPayoutStatus?: string; providerPayoutSimulatedAt?: string | null; assessmentDraftHours?: string | number | null; assessmentDraftNotes?: string | null; assessmentDraftUpdatedAt?: string | null; status: string; finalAmountDue?: string | number | null; finalApprovedAt?: string | null; review?: { id: string; skillRating: number; platformRating: number; comment: string | null } | null; seekerReview?: {id:string;rating:number;comment:string|null}|null; hourlyRate: string | number; assessmentFee: string | number; assessmentRequired?: boolean; seekerArrivalConfirmedAt?: string | null; estimatedHours: string | number | null; estimatedTotal: string | number | null; estimateNotes: string | null; estimateDecisionNote: string | null; providerEnRouteAt?: string | null; providerArrivedAt?: string | null; assessmentStartedAt?: string | null; assessmentCompletedAt?: string | null; workStartedAt?: string | null; workAccumulatedMs?: number; workSegmentStartedAt?: string | null; workPausedAt?: string | null; workEndedAt?: string | null; serverNow?: string; adjustments: JobAdjustment[]; completionSubmissions: CompletionSubmission[]; disputes?: JobDispute[]; agreedWorkTotal?: number; approvedAdditionalAmount?: number; approvedAdditionalHours?: number };
type ProviderJob = JobEngagement & {
  responseId: string;
  request: { id: string; title: string; description: string; location: string | null; latitude: number | null; longitude: number | null; instructions?: string | null; preferredStartAt?: string | null; deliveryMode?: string; };
  seeker?: { firstName: string; lastName: string; profilePhotoUrl: string | null; phone: string | null; identityVerified: boolean };
};
type ServiceChatMessage = { id: string; senderId: string; body: string; createdAt: string; isMine: boolean };
type SeekerRequest = {
  id: string; title: string; skillCategory: string; description: string;
  deliveryMode: "ONSITE" | "REMOTE" | "EITHER"; location: string | null; latitude: number | null; longitude: number | null;
  status: string; createdAt: string; matchingStartedAt: string; preferredStartAt: string | null; matchingWave: number; matchingNextAt: string | null; matchingExhaustedAt: string | null; _count?: { matches: number }; jobEngagement: JobEngagement | null;
  providerResponses: Array<{
    id: string; providerId: string; status: string; message: string | null; createdAt: string;
    hourlyRateAtOffer: string | number | null; assessmentFeeAtOffer: string | number | null; assessmentRequiredAtOffer?: boolean;
    provider: { phone?: string | null; providerProfile: { publicName: string; hourlyRate: string | number | null; assessmentFee: string | number; skillCategories: string[]; serviceAreas: string[]; deliveryModes: string[]; isAvailable?: boolean; phone?: string | null; liveLatitude?: number | null; liveLongitude?: number | null; liveLocationUpdatedAt?: string | null; identityVerified?: boolean; experience?: string | null; distanceKm?: number | null; ratings?: {overall:number;overallReviewCount:number;overallIsRated:boolean;requestedSkill:number;requestedSkillReviewCount:number;requestedSkillIsRated:boolean} } | null };
  }>;
};
type Props = {
  platformHeader: ReactNode;
  mode: Mode;
  verified: boolean;
  pendingRequestId: string | null;
  onModeChange: (mode: Mode) => void;
  onBack: () => void;
  onIdentityRequired: (requestId: string) => void;
  onStartVerification: () => void;
  onProviderJobCompleted?: () => void;
  initialProviderJobId?: string | null;
  onProviderJobOpened?: () => void;
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

export function ProviderJobScreen(p: Props) {
  const insets = useSafeAreaInsets();
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [myRequests, setMyRequests] = useState<SeekerRequest[]>([]);
  const [selectingOfferId, setSelectingOfferId] = useState<string | null>(null);
  const [activeOfferId, setActiveOfferId] = useState<string | null>(null);
  const [dismissedOfferIds, setDismissedOfferIds] = useState<string[]>([]);
  const activeOfferIdRef = useRef<string | null>(null);
  const dismissedOfferIdsRef = useRef<string[]>([]);
  activeOfferIdRef.current = activeOfferId;
  dismissedOfferIdsRef.current = dismissedOfferIds;
  const [autoOpenedOfferIds, setAutoOpenedOfferIds] = useState<string[]>([]);
  const [showProviderProfile, setShowProviderProfile] = useState(false);
  const [journeyScreen, setJourneyScreen] = useState<{requestId:string;responseId:string;title:string;location:string|null;latitude:number|null;longitude:number|null;providerName:string;providerSkills:string[];phone:string|null;liveLatitude:number|null;liveLongitude:number|null;liveLocationUpdatedAt:string|null;providerEnRouteAt:string|null;providerArrivedAt:string|null;seekerArrivalConfirmedAt:string|null;assessmentStartedAt:string|null;assessmentCompletedAt:string|null;engagementStatus:string;estimatedTotal:number|null;estimatedHours:number|null;estimateNotes:string|null;hourlyRate:number|null;assessmentFee:number|null;completionSubmissions:CompletionSubmission[]}|null>(null);
  const [providerOfferReview, setProviderOfferReview] = useState<{requestId:string;title:string;skillCategory:string;seekerName:string;responseId:string;status:string}|null>(null);
  // Keep tracking the exact offer after its review modal is dismissed. Selection can
  // happen later, and the selected job must still take priority over older jobs.
  const [providerSelectionWatch, setProviderSelectionWatch] = useState<{requestId:string;responseId:string}|null>(null);
  const [dismissedProviderOfferIds, setDismissedProviderOfferIds] = useState<string[]>([]);
  const [myJobs, setMyJobs] = useState<ProviderJob[]>([]);
  const [activeProviderJobId, setActiveProviderJobId] = useState<string | null>(null);
  const [dismissedActiveJobIds, setDismissedActiveJobIds] = useState<string[]>([]);
  const [serviceChatMessages, setServiceChatMessages] = useState<ServiceChatMessage[]>([]);
  const [serviceChatDraft, setServiceChatDraft] = useState("");
  const [serviceChatBusy, setServiceChatBusy] = useState(false);
  const [serviceChatLoading, setServiceChatLoading] = useState(false);
  const [contactDrawerOpen, setContactDrawerOpen] = useState(false);
  const [providerRoute, setProviderRoute] = useState<{requestId:string;origin:{latitude:number;longitude:number};coordinates:Array<{latitude:number;longitude:number}>}|null>(null);
  const [providerRouteLoading, setProviderRouteLoading] = useState(false);
  const [navigationOpenedRequestIds, setNavigationOpenedRequestIds] = useState<string[]>([]);
  const activeChatRequestIdRef = useRef<string | null>(null);
  const hasLoadedIncomingRequestsRef = useRef(false);
  const incomingRequestsLoadInFlightRef = useRef(false);
  const serviceChatLoadVersionRef = useRef(0);
  const seekerRequestsLoadVersionRef = useRef(0);
  const [clockNow, setClockNow] = useState(Date.now());
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [estimateHours, setEstimateHours] = useState("2");
  const [estimateNotes, setEstimateNotes] = useState("");
  const [assessmentDraftSaveStatus, setAssessmentDraftSaveStatus] = useState("Not saved yet");
  const [assessmentDraftAutosaveEnabled, setAssessmentDraftAutosaveEnabled] = useState(false);
  const assessmentDraftHydratedRequestIdRef = useRef<string | null>(null);
  const [estimateDecisionNoteDraft, setEstimateDecisionNoteDraft] = useState("");
  const [extraHours, setExtraHours] = useState("1");
  const [extraReason, setExtraReason] = useState("");
  const [completionNotes, setCompletionNotes] = useState("");
  const [completionEvidenceAssets, setCompletionEvidenceAssets] = useState<Array<{id:string;name:string;uri:string;contentType:string;sizeBytes:number}>>([]);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [completionReviewNote, setCompletionReviewNote] = useState("");
  const [disputeReasonDraft, setDisputeReasonDraft] = useState("");
  const [disputeReplyDraft, setDisputeReplyDraft] = useState("");
  const [disputeEvidenceAssets, setDisputeEvidenceAssets] = useState<Array<{id:string;name:string;uri:string;contentType:string;sizeBytes:number}>>([]);
  const [uploadingDisputeEvidence, setUploadingDisputeEvidence] = useState(false);
  const [ratingDraft, setRatingDraft] = useState<{requestId:string;skillRating:number;platformRating:number;comment:string}|null>(null);
  const [seekerRatingDraft, setSeekerRatingDraft] = useState<{requestId:string;rating:number;comment:string}|null>(null);
  const [jobActionBusy, setJobActionBusy] = useState(false);
  const [savedPaymentMethods, setSavedPaymentMethods] = useState<SavedPaymentMethod[]>([]);
  const [saveCardForNextTime, setSaveCardForNextTime] = useState(false);
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
  const [searchRadiusKm, setSearchRadiusKm] = useState(10);
  const [savedHomeLocation, setSavedHomeLocation] = useState<{homeLocationLabel:string|null;homeLatitude:number|null;homeLongitude:number|null} | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState<"ONSITE" | "REMOTE" | "EITHER">("ONSITE");
  const [busy, setBusy] = useState(false);
  const [seekerRequestsLoaded, setSeekerRequestsLoaded] = useState(false);
  const [matchingRequest, setMatchingRequest] = useState<{id:string;title:string;skillCategory:string;location:string|null;createdAt:string;notified:number;wave:number;exhausted:boolean}|null>(null);
  const [scheduleDateTime, setScheduleDateTime] = useState(() => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16));
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [verificationPrompt, setVerificationPrompt] = useState(false);
  const [providerAvailable, setProviderAvailable] = useState(false);

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
    if (incomingRequestsLoadInFlightRef.current) return;
    incomingRequestsLoadInFlightRef.current = true;
    const isInitialLoad = !hasLoadedIncomingRequestsRef.current;
    if (isInitialLoad) { setBusy(true); setError(""); }
    try {
      const result = await apiRequest<{ items: RequestItem[] }>("/marketplace/incoming-requests", {}, true);
      setRequests(result.items);
    } catch (e) {
      if (isInitialLoad) setError(e instanceof Error ? e.message : "Could not load incoming requests.");
    } finally {
      hasLoadedIncomingRequestsRef.current = true;
      incomingRequestsLoadInFlightRef.current = false;
      if (isInitialLoad) setBusy(false);
    }
  }, []);

  const loadMyRequests = useCallback(async () => {
    const loadVersion = ++seekerRequestsLoadVersionRef.current;
    setBusy(true); setError("");
    try {
      const requestStartedAt = Date.now();
      const result = await apiRequest<SeekerRequest[]>("/marketplace/my-requests?_=" + Date.now(), {}, true);
      const receivedAt = Date.now();
      if (loadVersion !== seekerRequestsLoadVersionRef.current) return;
      const serverNow = result.find((item) => item.jobEngagement?.serverNow)?.jobEngagement?.serverNow;
      if (serverNow) setClockOffsetMs(Date.parse(serverNow) - (requestStartedAt + receivedAt) / 2);
      setMyRequests(result);
      setSeekerRequestsLoaded(true);

      // Restore an already-selected service immediately on first load. Do not
      // briefly expose the new-request form while the background poll catches up.
      const activeJourney = result.find((item) =>
        item.jobEngagement
        && ["ASSESSMENT_PENDING", "ESTIMATE_SUBMITTED", "ESTIMATE_REJECTED", "ESTIMATE_APPROVED", "IN_PROGRESS", "COMPLETION_PENDING", "DISPUTED"].includes(item.jobEngagement.status),
      );
      if (activeJourney?.jobEngagement) {
        const engagement = activeJourney.jobEngagement;
        const selectedOffer = activeJourney.providerResponses.find((offer) => offer.id === engagement.responseId)
          ?? activeJourney.providerResponses.find((offer) => offer.status === "SELECTED");
        const profile = selectedOffer?.provider.providerProfile;
        setJourneyScreen((current) => ({ ...(current?.requestId === activeJourney.id ? current : {}),
          requestId: activeJourney.id,
          responseId: selectedOffer?.id ?? engagement.responseId ?? "",
          title: activeJourney.title,
          location: activeJourney.location,
          latitude: activeJourney.latitude,
          longitude: activeJourney.longitude,
          providerName: profile?.publicName ?? "Your selected Provider",
          providerSkills: profile?.skillCategories ?? [],
          phone: selectedOffer?.provider.phone ?? profile?.phone ?? null,
          liveLatitude: profile?.liveLatitude ?? null,
          liveLongitude: profile?.liveLongitude ?? null,
          liveLocationUpdatedAt: profile?.liveLocationUpdatedAt ?? null,
          providerEnRouteAt: engagement.providerEnRouteAt ?? null,
          providerArrivedAt: engagement.providerArrivedAt ?? null,
          seekerArrivalConfirmedAt: engagement.seekerArrivalConfirmedAt ?? null,
          assessmentStartedAt: engagement.assessmentStartedAt ?? null,
          assessmentCompletedAt: engagement.assessmentCompletedAt ?? null,
          completionSubmissions: engagement.completionSubmissions ?? [],
          engagementStatus: engagement.status ?? "ASSESSMENT_PENDING",
          estimatedTotal: engagement.estimatedTotal == null ? null : Number(engagement.estimatedTotal),
          estimatedHours: engagement.estimatedHours == null ? null : Number(engagement.estimatedHours),
          estimateNotes: engagement.estimateNotes ?? null,
          hourlyRate: selectedOffer?.hourlyRateAtOffer == null ? Number(engagement.hourlyRate) : Number(selectedOffer.hourlyRateAtOffer),
          assessmentFee: selectedOffer?.assessmentFeeAtOffer == null ? Number(engagement.assessmentFee) : Number(selectedOffer.assessmentFeeAtOffer),
        }));
      } else {
        setJourneyScreen(null);
      }

      const activeOfferRequest = activeOfferIdRef.current
        ? result.find((item) => item.status === "OPEN" && item.providerResponses.some((offer) => offer.id === activeOfferIdRef.current && offer.status === "OFFERED"))
        : undefined;
      const pendingOfferRequest = result.find((item) => item.status === "OPEN" && item.providerResponses.some((offer) =>
        offer.status === "OFFERED" && !dismissedOfferIdsRef.current.includes(offer.id),
      ));
      const active = activeOfferRequest ?? pendingOfferRequest ?? result.find((item) =>
        item.status === "OPEN" && !item.jobEngagement && !item.providerResponses.some((offer) => offer.status === "SELECTED"),
      );
      setMatchingRequest(active ? {
        id: active.id, title: active.title, skillCategory: active.skillCategory, location: active.location,
        createdAt: active.matchingStartedAt, notified: active._count?.matches ?? 0, wave: active.matchingWave ?? 1, exhausted: !!active.matchingExhaustedAt,
      } : null);
    } catch (e) {
      if (loadVersion === seekerRequestsLoadVersionRef.current) setError(e instanceof Error ? e.message : "Could not load your requests.");
    } finally {
      setBusy(false);
    }
  }, []);

  const loadSavedPaymentMethods = useCallback(async () => {
    try {
      const methods = await apiRequest<SavedPaymentMethod[]>("/marketplace/payment-methods", {}, true);
      setSavedPaymentMethods(methods);
    } catch {
      setSavedPaymentMethods([]);
    }
  }, []);

  useEffect(() => {
    if (p.mode === "seeker") { void loadMyRequests(); void loadHomeLocation(); void searchSkills(""); void loadSavedPaymentMethods(); }
  }, [p.mode, loadMyRequests, loadSavedPaymentMethods, searchSkills]);

  useEffect(() => {
    if (p.mode !== "seeker") return;
    const timer = setTimeout(() => { void searchSkills(skillQuery); }, 220);
    return () => clearTimeout(timer);
  }, [skillQuery, p.mode, searchSkills]);

  // Open each incoming Provider offer automatically, once, as soon as the
  // Seeker's refreshed request data contains it. One-at-a-time matching is
  // enforced by the API; this is the immediate presentation layer.
  useEffect(() => {
    if (p.mode !== "seeker" || activeOfferId) return;

    // Offers can arrive while the Seeker is viewing a different open request
    // or while the matching request summary is being refreshed. Search all
    // currently open requests so a new offer always opens its review drawer.
    const nextRequest = myRequests.find((request) =>
      request.status === "OPEN"
      && request.providerResponses.some((offer) =>
        offer.status === "OFFERED"
        && !dismissedOfferIds.includes(offer.id)
        && !autoOpenedOfferIds.includes(offer.id),
      ),
    );
    if (!nextRequest) return;
    const nextOffer = nextRequest.providerResponses.find((offer) =>
      offer.status === "OFFERED"
      && !dismissedOfferIds.includes(offer.id)
      && !autoOpenedOfferIds.includes(offer.id),
    );
    if (!nextOffer) return;

    setMatchingRequest((current) => current?.id === nextRequest.id ? current : {
      id: nextRequest.id,
      title: nextRequest.title,
      skillCategory: nextRequest.skillCategory,
      location: nextRequest.location,
      createdAt: nextRequest.matchingStartedAt,
      notified: nextRequest._count?.matches ?? 0,
      wave: nextRequest.matchingWave ?? 1,
      exhausted: !!nextRequest.matchingExhaustedAt,
    });
    setAutoOpenedOfferIds((ids) => [...ids, nextOffer.id]);
    setActiveOfferId(nextOffer.id);
    setShowProviderProfile(false);
  }, [p.mode, myRequests, activeOfferId, dismissedOfferIds, autoOpenedOfferIds]);

  useEffect(() => {
    const clock = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refreshJobState = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        if (p.mode === "provider") {
          const requestStartedAt = Date.now();
          const result = await apiRequest<ProviderJob[]>("/marketplace/my-jobs", {}, true);
          const receivedAt = Date.now();
          const serverNow = result.find((item) => item.serverNow)?.serverNow;
          if (active) {
            if (serverNow) setClockOffsetMs(Date.parse(serverNow) - (requestStartedAt + receivedAt) / 2);
            setMyJobs(result);
            // Restore the server-confirmed active stage after reload/remount.
            const activeJob = result.find((job) =>
              ["ASSESSMENT_PENDING", "ESTIMATE_SUBMITTED", "ESTIMATE_REJECTED", "ESTIMATE_APPROVED", "IN_PROGRESS", "COMPLETION_PENDING", "DISPUTED"].includes(job.status),
            );
            if (activeJob) {
              setDismissedActiveJobIds((ids) => ids.filter((id) => id !== activeJob.request.id));
              setActiveProviderJobId(activeJob.request.id);
            }
          }
        } else {
          const loadVersion = ++seekerRequestsLoadVersionRef.current;
          const requestStartedAt = Date.now();
          const result = await apiRequest<SeekerRequest[]>("/marketplace/my-requests?_=" + Date.now(), {}, true);
          const receivedAt = Date.now();
          const serverNow = result.find((item) => item.jobEngagement?.serverNow)?.jobEngagement?.serverNow;
          if (active && loadVersion === seekerRequestsLoadVersionRef.current) {
            if (serverNow) setClockOffsetMs(Date.parse(serverNow) - (requestStartedAt + receivedAt) / 2);
            setMyRequests(result);
            // Rebuild the Seeker's current journey from the persisted engagement.
            const activeJourney = result.find((item) =>
              item.jobEngagement
              && ["ASSESSMENT_PENDING", "ESTIMATE_SUBMITTED", "ESTIMATE_REJECTED", "ESTIMATE_APPROVED", "IN_PROGRESS", "COMPLETION_PENDING", "DISPUTED"].includes(item.jobEngagement.status),
            );
            if (activeJourney?.jobEngagement) {
              const engagement = activeJourney.jobEngagement;
              // The engagement is the authoritative proof of a selected service.
              // Prefer its responseId, then the SELECTED response status. Do not
              // hide the Seeker workspace if response status data is temporarily
              // inconsistent or the response relation is missing from the payload.
              const selectedOffer = activeJourney.providerResponses.find((offer) => offer.id === engagement.responseId)
                ?? activeJourney.providerResponses.find((offer) => offer.status === "SELECTED");
              const profile = selectedOffer?.provider.providerProfile;
              setJourneyScreen((current) => ({ ...(current?.requestId === activeJourney.id ? current : {}),
                requestId: activeJourney.id,
                responseId: selectedOffer?.id ?? engagement.responseId ?? "",
                title: activeJourney.title,
                location: activeJourney.location,
                latitude: activeJourney.latitude,
                longitude: activeJourney.longitude,
                providerName: profile?.publicName ?? "Your selected Provider",
                providerSkills: profile?.skillCategories ?? [],
                phone: selectedOffer?.provider.phone ?? profile?.phone ?? null,
                liveLatitude: profile?.liveLatitude ?? null,
                liveLongitude: profile?.liveLongitude ?? null,
                liveLocationUpdatedAt: profile?.liveLocationUpdatedAt ?? null,
                providerEnRouteAt: engagement.providerEnRouteAt ?? null,
                providerArrivedAt: engagement.providerArrivedAt ?? null,
          seekerArrivalConfirmedAt: engagement.seekerArrivalConfirmedAt ?? null,
                assessmentStartedAt: engagement.assessmentStartedAt ?? null,
                assessmentCompletedAt: engagement.assessmentCompletedAt ?? null,
                completionSubmissions: engagement.completionSubmissions ?? [],
                engagementStatus: engagement.status ?? "ASSESSMENT_PENDING",
                estimatedTotal: engagement.estimatedTotal == null ? null : Number(engagement.estimatedTotal),
                estimatedHours: engagement.estimatedHours == null ? null : Number(engagement.estimatedHours),
                estimateNotes: engagement.estimateNotes ?? null,
                hourlyRate: selectedOffer?.hourlyRateAtOffer == null ? Number(engagement.hourlyRate) : Number(selectedOffer.hourlyRateAtOffer),
                assessmentFee: selectedOffer?.assessmentFeeAtOffer == null ? Number(engagement.assessmentFee) : Number(selectedOffer.assessmentFeeAtOffer),
              }));
            } else {
              setJourneyScreen(null);
            }
            // Keep the offer's own request selected. Otherwise a refresh of a
            // different open request can hide the offer drawer while its ID is active.
            const activeOfferRequest = activeOfferIdRef.current
              ? result.find((item) => item.status === "OPEN" && item.providerResponses.some((offer) => offer.id === activeOfferIdRef.current && offer.status === "OFFERED"))
              : undefined;
            const pendingOfferRequest = result.find((item) => item.status === "OPEN" && item.providerResponses.some((offer) =>
              offer.status === "OFFERED" && !dismissedOfferIdsRef.current.includes(offer.id),
            ));
            const active = activeOfferRequest ?? pendingOfferRequest ?? result.find((item) =>
              item.status === "OPEN" && !item.jobEngagement && !item.providerResponses.some((offer) => offer.status === "SELECTED"),
            );
            setMatchingRequest(active ? {
              id: active.id, title: active.title, skillCategory: active.skillCategory, location: active.location,
              createdAt: active.matchingStartedAt, notified: active._count?.matches ?? 0, wave: active.matchingWave ?? 1, exhausted: !!active.matchingExhaustedAt,
            } : null);
          }
        }
      } catch {
        // Retain the last server-confirmed state during temporary network loss.
      } finally {
        refreshing = false;
      }
    };
    // While an offer is awaiting the Seeker's decision, check the authoritative
    // engagement list promptly so the Provider moves into the correct job.
    if ((p.mode === "provider" && providerSelectionWatch) || (p.mode === "seeker" && journeyScreen)) {
      void refreshJobState();
    }
    // Keep an active Seeker journey responsive while the Provider progresses
    // through arrival, assessment and estimate stages.
    const refreshMs = p.mode === "seeker"
      ? 3000
      : providerSelectionWatch && providerOfferReview?.status === "OFFERED" ? 3000 : 12000;
    const refresh = setInterval(() => { void refreshJobState(); }, refreshMs);
    return () => {
      active = false;
      clearInterval(refresh);
    };
  }, [p.mode, providerOfferReview?.status, providerSelectionWatch?.responseId, journeyScreen?.requestId]);

  useEffect(() => {
    if (p.mode !== "provider") return;
    const responseUpdates = requests.filter((item) => item.myResponse);
    if (!responseUpdates.length) return;
    if (!providerOfferReview) {
      const pending = responseUpdates.find((item) => item.myResponse?.status === "OFFERED"
        && !dismissedProviderOfferIds.includes(item.myResponse.id));
      if (!pending?.myResponse) return;
      setProviderSelectionWatch({ requestId: pending.id, responseId: pending.myResponse.id });
      const seekerName = [pending.seeker?.firstName, pending.seeker?.lastName].filter(Boolean).join(" ") || "Skill Seeker";
      setProviderOfferReview({ requestId: pending.id, title: pending.title, skillCategory: pending.skillCategory, seekerName, responseId: pending.myResponse.id, status: pending.myResponse.status });
      return;
    }
    const updated = responseUpdates.find((item) => item.id === providerOfferReview.requestId);
    if (!updated?.myResponse || updated.myResponse.id !== providerOfferReview.responseId) return;
    if (updated.myResponse.status !== providerOfferReview.status) {
      setProviderOfferReview({ ...providerOfferReview, status: updated.myResponse.status });
    }
  }, [p.mode, requests, dismissedProviderOfferIds, providerOfferReview]);

  useEffect(() => {
    if (p.mode !== "provider" || !providerSelectionWatch) return;
    // The incoming-request endpoint is the authoritative offer-status source.
    // Poll it while this exact offer awaits a decision, including after the
    // Seeker closes the request by selecting this Provider.
    void loadRequests();
    const timer = setInterval(() => { void loadRequests(); }, 3000);
    return () => clearInterval(timer);
  }, [p.mode, providerSelectionWatch?.responseId, loadRequests]);

  useEffect(() => {
    if (p.mode !== "provider" || !providerOfferReview || !["WITHDRAWN", "DECLINED"].includes(providerOfferReview.status)) return;
    const request = requests.find((item) => item.id === providerOfferReview.requestId);
    const wasCancelled = request?.status === "CANCELLED";
    const responseId = providerOfferReview.responseId;
    setDismissedProviderOfferIds((ids) => ids.includes(responseId) ? ids : [...ids, responseId]);
    setProviderSelectionWatch((current) => current?.responseId === responseId ? null : current);
    setProviderOfferReview(null);
    setActiveProviderJobId(null);
    setNotice(wasCancelled
      ? "The Skill Seeker cancelled the entire service request. You are back at Provider Home and ready for the next request."
      : "The Skill Seeker declined your offer. You are back at Provider Home and ready for the next request.");
  }, [p.mode, providerOfferReview, requests]);

  useEffect(() => {
    if (p.mode !== "provider" || !providerSelectionWatch) return;
    // Require two independent server confirmations: the exact offer must now
    // be SELECTED, and the selected-job endpoint must return its matching job.
    // A stale/unrelated job can never advance an offer still under review.
    const confirmedOffer = requests.find((item) => item.id === providerSelectionWatch.requestId)?.myResponse;
    if (confirmedOffer?.id !== providerSelectionWatch.responseId || confirmedOffer.status !== "SELECTED") return;
    const selectedJob = myJobs.find((job) =>
      job.request.id === providerSelectionWatch.requestId
      && job.responseId === providerSelectionWatch.responseId,
    );
    // A selected response is not enough to leave the pending screen. Wait
    // until the matching engagement has reached a renderable service stage.
    // This prevents a blank full-screen modal while the job/assessment payload
    // is still being created or synchronized by the API.
    if (!selectedJob || ![
      "ASSESSMENT_PENDING",
      "ESTIMATE_SUBMITTED",
      "ESTIMATE_REJECTED",
      "ESTIMATE_APPROVED",
      "IN_PROGRESS",
      "COMPLETION_PENDING",
      "DISPUTED",
    ].includes(selectedJob.status)) return;
    setDismissedActiveJobIds((ids) => ids.filter((id) => id !== selectedJob.request.id));
    setActiveProviderJobId(selectedJob.request.id);
    setProviderSelectionWatch(null);
    // Only dismiss Offer Pending Approval after the service workspace has a
    // server-confirmed engagement stage and can render its next screen.
    setProviderOfferReview((current) =>
      current?.requestId === selectedJob.request.id
      && current.responseId === selectedJob.responseId
        ? null
        : current,
    );
  }, [p.mode, requests, myJobs, providerSelectionWatch]);

  const providerCompletionNavigatedRef = useRef<string | null>(null);

  useEffect(() => {
    if (p.mode !== "provider" || !activeProviderJobId) return;
    const completedJob = myJobs.find((job) =>
      job.request.id === activeProviderJobId && job.status === "COMPLETED",
    );
    if (!completedJob || providerCompletionNavigatedRef.current === completedJob.request.id) return;

    // The Seeker's approval is the completion gate. Once the persisted job
    // status reaches COMPLETED, leave the service workspace and return the
    // Provider to Home so they can wait for another request.
    providerCompletionNavigatedRef.current = completedJob.request.id;
    setActiveProviderJobId(null);
    p.onProviderJobCompleted?.();
  }, [p.mode, activeProviderJobId, myJobs, p.onProviderJobCompleted]);

  useEffect(() => {
    if (p.mode !== "provider") return;

    // A newly submitted offer must remain in review until the exact response is
    // represented by a server-created job. Do not let an older job in /my-jobs
    // pull the Provider into an assessment/service workspace prematurely.
    if (providerSelectionWatch || providerOfferReview?.status === "OFFERED") {
      if (activeProviderJobId) setActiveProviderJobId(null);
      return;
    }

    const currentJob = activeProviderJobId
      ? myJobs.find((job) => job.request.id === activeProviderJobId)
      : null;
    if (activeProviderJobId && (!currentJob
      || ["COMPLETED", "CANCELLED"].includes(currentJob.status)
      || dismissedActiveJobIds.includes(activeProviderJobId))) {
      setActiveProviderJobId(null);
    }
    // An active engagement always takes priority over the dashboard/list.
    // Completed and cancelled jobs remain outside the restored workspace.
  }, [p.mode, myJobs, dismissedActiveJobIds, activeProviderJobId, providerSelectionWatch, providerOfferReview?.status]);

  const loadServiceChat = useCallback(async (requestId: string) => {
    const loadVersion = ++serviceChatLoadVersionRef.current;
    setServiceChatLoading(true);
    try {
      const messages = await apiRequest<ServiceChatMessage[]>("/marketplace/requests/" + requestId + "/chat", {}, true);
      // Ignore late responses from a chat that is no longer open.
      if (activeChatRequestIdRef.current === requestId && serviceChatLoadVersionRef.current === loadVersion) {
        setServiceChatMessages(messages);
      }
    } catch (e) {
      if (activeChatRequestIdRef.current === requestId && serviceChatLoadVersionRef.current === loadVersion) {
        setError(e instanceof Error ? e.message : "Could not load service chat.");
      }
    } finally {
      if (serviceChatLoadVersionRef.current === loadVersion) setServiceChatLoading(false);
    }
  }, []);

  const sendServiceChatMessage = async (requestId: string) => {
    const body = serviceChatDraft.trim();
    if (!body || serviceChatBusy || activeChatRequestIdRef.current !== requestId) return;
    setServiceChatBusy(true); setError("");
    try {
      await apiRequest("/marketplace/requests/" + requestId + "/chat", { method: "POST", body: JSON.stringify({ body }) }, true);
      // A send already in flight remains attached to its original request,
      // but must not clear or refresh a different request's chat.
      if (activeChatRequestIdRef.current === requestId) {
        setServiceChatDraft("");
        await loadServiceChat(requestId);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send your message."); }
    finally { setServiceChatBusy(false); }
  };

  const activeChatRequestId = p.mode === "provider" ? activeProviderJobId : p.mode === "seeker" ? journeyScreen?.requestId ?? null : null;
  useEffect(() => {
    activeChatRequestIdRef.current = activeChatRequestId;
    // Never leave another service's messages or unsent draft visible when
    // switching between selected jobs / seeker journeys.
    setServiceChatMessages([]);
    setServiceChatDraft("");
    serviceChatLoadVersionRef.current += 1;
    if (!activeChatRequestId) {
      setServiceChatLoading(false);
      return;
    }
    void loadServiceChat(activeChatRequestId);
    const timer = setInterval(() => { void loadServiceChat(activeChatRequestId); }, 5000);
    return () => {
      clearInterval(timer);
      serviceChatLoadVersionRef.current += 1;
    };
  }, [activeChatRequestId, loadServiceChat]);

  useEffect(() => {
    if (!journeyScreen) return;
    const request = myRequests.find((item) => item.id === journeyScreen.requestId);
    const offer = request?.providerResponses.find((item) => item.id === journeyScreen.responseId);
    const profile = offer?.provider.providerProfile;
    const liveAt = profile?.liveLocationUpdatedAt ?? null;
    const isFresh = !!liveAt && Date.now() - Date.parse(liveAt) <= 60_000;
    setJourneyScreen((current) => {
      if (!current || current.requestId !== journeyScreen.requestId) return current;
      const liveLatitude = isFresh ? profile?.liveLatitude ?? null : null;
      const liveLongitude = isFresh ? profile?.liveLongitude ?? null : null;
      const phone = offer?.provider.phone ?? profile?.phone ?? current.phone;
      const providerEnRouteAt = request?.jobEngagement?.providerEnRouteAt ?? current.providerEnRouteAt;
      const providerArrivedAt = request?.jobEngagement?.providerArrivedAt ?? current.providerArrivedAt;
      const seekerArrivalConfirmedAt = request?.jobEngagement?.seekerArrivalConfirmedAt ?? current.seekerArrivalConfirmedAt;
      const assessmentStartedAt = request?.jobEngagement?.assessmentStartedAt ?? current.assessmentStartedAt;
      const assessmentCompletedAt = request?.jobEngagement?.assessmentCompletedAt ?? current.assessmentCompletedAt;
      const engagementStatus = request?.jobEngagement?.status ?? current.engagementStatus;
      const estimatedTotal = request?.jobEngagement?.estimatedTotal == null ? current.estimatedTotal : Number(request.jobEngagement.estimatedTotal);
      const estimatedHours = request?.jobEngagement?.estimatedHours == null ? current.estimatedHours : Number(request.jobEngagement.estimatedHours);
      const estimateNotes = request?.jobEngagement?.estimateNotes ?? current.estimateNotes;
      if (current.liveLatitude === liveLatitude && current.liveLongitude === liveLongitude
        && current.liveLocationUpdatedAt === (isFresh ? liveAt : null) && current.phone === phone
        && current.providerEnRouteAt === providerEnRouteAt && current.providerArrivedAt === providerArrivedAt && current.seekerArrivalConfirmedAt === seekerArrivalConfirmedAt
        && current.assessmentStartedAt === assessmentStartedAt && current.assessmentCompletedAt === assessmentCompletedAt
        && current.engagementStatus === engagementStatus && current.estimatedTotal === estimatedTotal && current.estimatedHours === estimatedHours && current.estimateNotes === estimateNotes) return current;
      return { ...current, liveLatitude, liveLongitude, liveLocationUpdatedAt: isFresh ? liveAt : null, phone, providerEnRouteAt, providerArrivedAt, seekerArrivalConfirmedAt, assessmentStartedAt, assessmentCompletedAt, engagementStatus, estimatedTotal, estimatedHours, estimateNotes };
    });
  }, [myRequests, journeyScreen?.requestId, journeyScreen?.responseId]);

  const activeProviderJobForRoute = myJobs.find((item) => item.request.id === activeProviderJobId);
  useEffect(() => {
    if (p.mode !== "provider" || !activeProviderJobId || !activeProviderJobForRoute
      || activeProviderJobForRoute.request.latitude == null || activeProviderJobForRoute.request.longitude == null
      || activeProviderJobForRoute.request.deliveryMode === "REMOTE") {
      setProviderRoute(null);
      setProviderRouteLoading(false);
      return;
    }
    let active = true;
    const loadRoute = async () => {
      setProviderRouteLoading(true);
      try {
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        const origin = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        const route = await apiRequest<{coordinates:Array<{latitude:number;longitude:number}>}>(
          `/marketplace/requests/${activeProviderJobId}/provider-route?originLatitude=${origin.latitude}&originLongitude=${origin.longitude}`,
          {}, true,
        );
        if (active) setProviderRoute({ requestId: activeProviderJobId, origin, coordinates: route.coordinates });
      } catch (e) {
        if (active) {
          setProviderRoute(null);
          setError(e instanceof Error ? e.message : "Could not load the full driving route.");
        }
      } finally {
        if (active) setProviderRouteLoading(false);
      }
    };
    void loadRoute();
    return () => { active = false; };
  }, [p.mode, activeProviderJobId, activeProviderJobForRoute?.request.latitude, activeProviderJobForRoute?.request.longitude, activeProviderJobForRoute?.request.deliveryMode]);

  const acceptRequest = async (request: RequestItem) => {
    if (!p.verified) { p.onIdentityRequired(request.id); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiRequest<{id:string;status:string}>(`/marketplace/requests/${request.id}/accept`, {
        method: "POST",
      }, true);
      const seekerName = [request.seeker?.firstName, request.seeker?.lastName].filter(Boolean).join(" ") || "Skill Seeker";
      setProviderSelectionWatch({ requestId: request.id, responseId: response.id });
      setProviderOfferReview({ requestId: request.id, title: request.title, skillCategory: request.skillCategory, seekerName, responseId: response.id, status: response.status });
      setNotice("");
      await loadRequests();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send your offer.");
    } finally { setBusy(false); }
  };
  
  const withdrawProviderOffer = async () => {
    if (!providerOfferReview || providerOfferReview.status !== "OFFERED" || jobActionBusy) return;
    setJobActionBusy(true); setError("");
    try {
      await apiRequest(`/marketplace/requests/${providerOfferReview.requestId}/offers/${providerOfferReview.responseId}/withdraw`, { method: "POST" }, true);
      setProviderSelectionWatch((current) => current?.requestId === providerOfferReview.requestId && current.responseId === providerOfferReview.responseId ? null : current);
      setProviderOfferReview(null);
      setActiveProviderJobId(null);
      setNotice("You withdrew your offer. You are back at Provider Home and can wait for another request.");
      await loadRequests();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not withdraw this offer.");
    } finally {
      setJobActionBusy(false);
    }
  };


  const selectProvider = (requestId: string, responseId: string) => {
    // Treat the API as the source of truth. The offer drawer can outlive a
    // background refresh, so stale local request data must not silently block
    // the explicit Seeker action. The server validates request and offer state.
    void performSelectProvider(requestId, responseId);
  };

  const performSelectProvider = async (requestId: string, responseId: string) => {
    setSelectingOfferId(responseId); setError(""); setNotice("");
    try {
      const result = await apiRequest<{success:boolean;requestId:string;selectedResponseId:string;status:string}>(`/marketplace/requests/${requestId}/select-provider`, {
        method: "POST", body: JSON.stringify({ responseId }),
      }, true);
      // Do not show the Seeker journey unless the server confirms the exact
      // response selected in this confirmation dialog.
      if (!result.success || result.requestId !== requestId || result.selectedResponseId !== responseId || result.status !== "ASSESSMENT_PENDING") {
        throw new Error("The server did not confirm this Provider selection. Refresh your requests before continuing.");
      }
      const selectedRequest = myRequests.find((item) => item.id === requestId);
      const selectedOffer = selectedRequest?.providerResponses.find((offer) => offer.id === responseId);
      setJourneyScreen({
        requestId,
        responseId,
        title: selectedRequest?.title ?? matchingRequest?.title ?? "Your service",
        location: selectedRequest?.location ?? matchingRequest?.location ?? null,
        latitude: selectedRequest?.latitude ?? null,
        longitude: selectedRequest?.longitude ?? null,
        providerName: selectedOffer?.provider.providerProfile?.publicName ?? "Your selected Provider",
        providerSkills: selectedOffer?.provider.providerProfile?.skillCategories ?? [],
        phone: selectedOffer?.provider.phone ?? selectedOffer?.provider.providerProfile?.phone ?? null,
        liveLatitude: selectedOffer?.provider.providerProfile?.liveLatitude ?? null,
        liveLongitude: selectedOffer?.provider.providerProfile?.liveLongitude ?? null,
        liveLocationUpdatedAt: selectedOffer?.provider.providerProfile?.liveLocationUpdatedAt ?? null,
        providerEnRouteAt: null,
        providerArrivedAt: null,
        seekerArrivalConfirmedAt: null,
        assessmentStartedAt: null,
        assessmentCompletedAt: null,
        completionSubmissions: [],
        engagementStatus: result.status,
        estimatedTotal: null,
        estimatedHours: null,
        estimateNotes: null,
        hourlyRate: selectedOffer?.hourlyRateAtOffer == null ? null : Number(selectedOffer.hourlyRateAtOffer),
        assessmentFee: selectedOffer?.assessmentFeeAtOffer == null ? null : Number(selectedOffer.assessmentFeeAtOffer),
      });
      setNotice("Provider selected. Your request is now closed to further offers.");
      setActiveOfferId(null);
      setMatchingRequest(null);
      await loadMyRequests();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not select this Provider.";
      // Refresh first: loadMyRequests clears transient errors while loading.
      await loadMyRequests();
      setError(message);
    } finally { setSelectingOfferId(null); }
  };

  const declineProviderOffer = async (requestId: string, responseId: string) => {
    setJobActionBusy(true); setError(""); setNotice("");
    try {
      await apiRequest(`/marketplace/requests/${requestId}/offers/${responseId}/decline`, { method: "POST" }, true);
      setDismissedOfferIds((ids) => [...ids, responseId]);
      setActiveOfferId(null);
      setShowProviderProfile(false);
      setNotice("Offer declined. Your request remains open while AnySkill continues matching.");
      await loadMyRequests();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not decline this offer.");
      await loadMyRequests();
    } finally { setJobActionBusy(false); }
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
    const note = estimateDecisionNoteDraft.trim();
    if (!approved && note.length < 10) {
      setError("Explain what needs to change (at least 10 characters) before requesting a revised estimate.");
      return;
    }
    setJobActionBusy(true); setError(""); setNotice("");
    try {
      await apiRequest(`/marketplace/requests/${requestId}/estimate-decision`, { method: "POST", body: JSON.stringify({ approved, note: approved ? undefined : note }) }, true);
      setEstimateDecisionNoteDraft("");
      setNotice(approved ? "Estimate approved. The Provider may now start work." : "Revision requested. The Provider can see your feedback and submit an updated estimate.");
      await loadMyRequests();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit your decision."); await loadMyRequests(); }
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


  const pickCompletionEvidence = async (source: "camera" | "library" = "library") => {
    if (completionEvidenceAssets.length >= 8) { setError("You can attach up to 8 photos."); return; }
    if (source === "camera") {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) { setError("Allow camera access to capture completion evidence."); return; }
    } else {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { setError("Allow photo-library access to attach completion evidence."); return; }
    }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 8 - completionEvidenceAssets.length, quality: 0.85 });
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

  const pickDisputeEvidence = async () => {
    if (disputeEvidenceAssets.length >= 8) { setError("You can attach up to 8 dispute evidence photos."); return; }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError("Allow photo-library access to attach dispute evidence."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 8 - disputeEvidenceAssets.length, quality: 0.85 });
    if (result.canceled) return;
    setUploadingDisputeEvidence(true); setError(""); setNotice("");
    try {
      for (const file of result.assets) {
        const mime = file.mimeType ?? "image/jpeg";
        if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("Only JPEG, PNG and WebP photos are supported.");
        const size = file.fileSize ?? 0;
        if (!size || size > 10 * 1024 * 1024) throw new Error("Each photo must be no larger than 10 MB.");
        const reservation = await apiRequest<{assetId:string;cloudName:string;apiKey:string;timestamp:number;signature:string;publicId:string;assetFolder:string}>("/marketplace/media/uploads", {
          method: "POST", body: JSON.stringify({ fileName: file.fileName ?? "dispute-evidence", contentType: mime, sizeBytes: size, purpose: "JOB_DISPUTE_EVIDENCE" }),
        }, true);
        const body = new FormData();
        body.append("file", { uri: file.uri, name: file.fileName ?? "dispute-evidence", type: mime } as unknown as Blob);
        body.append("api_key", reservation.apiKey); body.append("timestamp", String(reservation.timestamp)); body.append("signature", reservation.signature);
        body.append("public_id", reservation.publicId); body.append("asset_folder", reservation.assetFolder);
        body.append("overwrite", "false"); body.append("unique_filename", "false"); body.append("use_filename", "false");
        const uploaded = await fetch("https://api.cloudinary.com/v1_1/" + reservation.cloudName + "/image/authenticated", { method: "POST", body });
        if (!uploaded.ok) { const detail = await uploaded.json().catch(() => ({})); throw new Error(detail.error?.message ?? "Cloudinary upload failed."); }
        await apiRequest("/marketplace/media/uploads/confirm", { method: "POST", body: JSON.stringify({ assetId: reservation.assetId }) }, true);
        setDisputeEvidenceAssets((current) => [...current, { id: reservation.assetId, name: file.fileName ?? "Dispute evidence", uri: file.uri, contentType: mime, sizeBytes: size }]);
      }
      setNotice("Dispute evidence uploaded securely.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not upload dispute evidence."); }
    finally { setUploadingDisputeEvidence(false); }
  };

  const openJobDispute = async (requestId: string) => {
    if (disputeReasonDraft.trim().length < 20) { setError("Explain the dispute in at least 20 characters."); return; }
    setJobActionBusy(true); setError(""); setNotice("");
    try {
      await apiRequest("/marketplace/requests/" + requestId + "/disputes", { method: "POST", body: JSON.stringify({ reason: disputeReasonDraft.trim(), evidenceAssetIds: disputeEvidenceAssets.map((asset) => asset.id) }) }, true);
      setDisputeReasonDraft(""); setDisputeEvidenceAssets([]);
      setNotice("Dispute opened. The job is paused while AnySkill reviews both parties' responses.");
      await (p.mode === "provider" ? loadMyJobs() : loadMyRequests());
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open the dispute."); }
    finally { setJobActionBusy(false); }
  };

  const replyToJobDispute = async (requestId: string, disputeId: string) => {
    if (disputeReplyDraft.trim().length < 10) { setError("Your dispute response must be at least 10 characters."); return; }
    setJobActionBusy(true); setError(""); setNotice("");
    try {
      await apiRequest("/marketplace/requests/" + requestId + "/disputes/" + disputeId + "/messages", { method: "POST", body: JSON.stringify({ body: disputeReplyDraft.trim(), evidenceAssetIds: disputeEvidenceAssets.map((asset) => asset.id) }) }, true);
      setDisputeReplyDraft(""); setDisputeEvidenceAssets([]);
      await (p.mode === "provider" ? loadMyJobs() : loadMyRequests());
      setNotice("Your response and evidence have been added to the dispute.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send your dispute response."); }
    finally { setJobActionBusy(false); }
  };

  const submitCompletion = async (requestId: string) => {
    setJobActionBusy(true); setError(""); setNotice("");
    try {
      await apiRequest("/marketplace/requests/" + requestId + "/completion", {
        method: "POST", body: JSON.stringify({ notes: completionNotes.trim(), evidenceAssetIds: completionEvidenceAssets.map((asset) => asset.id) }),
      }, true);
      setNotice("Completion submitted. The Seeker must review and approve it.");
      setCompletionNotes(""); setCompletionEvidenceAssets([]); await loadMyJobs();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit job completion."); }
    finally { setJobActionBusy(false); }
  };

  const reviewCompletion = async (requestId: string, submissionId: string, approved: boolean) => {
    setJobActionBusy(true); setError(""); setNotice("");
    try {
      const result = await apiRequest<{jobStatus:string;paymentStatus:string;finalAmountDue:string|null;providerPayoutAmount:string|null;platformCommissionAmount:string|null;paymentMode:string|null}>(
        `/marketplace/requests/${requestId}/completion/${submissionId}/decision`,
        { method: "POST", body: JSON.stringify({ approved, note: approved ? undefined : completionReviewNote.trim() }) },
        true,
      );
      setNotice(approved
        ? `Completion approved. Provider earnings of R ${Number(result.providerPayoutAmount ?? 0).toFixed(2)} (90%) and AnySkill commission of R ${Number(result.platformCommissionAmount ?? 0).toFixed(2)} (10%) have been recorded. Seeker debit is pending; Provider payout follows successful debit.`
        : "Corrections requested. The Provider can update the work and resubmit.");
      setCompletionReviewNote(""); await loadMyRequests();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not review job completion."); }
    finally { setJobActionBusy(false); }
  };

  const startPayFastPayment = async (requestId: string) => {
    setJobActionBusy(true); setError(""); setNotice("");
    try {
      const result = await apiRequest<{checkoutUrl:string;amount:string;mode:string}>(
        "/marketplace/requests/" + requestId + "/payment/payfast",
        { method: "POST", body: JSON.stringify({ saveCard: saveCardForNextTime }) },
        true,
      );
      setNotice("Opening PayFast sandbox checkout for R " + Number(result.amount).toFixed(2) + ". No real money will be charged.");
      await Linking.openURL(result.checkoutUrl);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start PayFast sandbox checkout."); }
    finally { setJobActionBusy(false); }
  };

  const payWithSavedCard = async (requestId: string, paymentMethodId: string) => {
    setJobActionBusy(true); setError(""); setNotice("");
    try {
      const result = await apiRequest<{status:string;amount:string}>(
        "/marketplace/requests/" + requestId + "/payment/payfast/saved-card",
        { method: "POST", body: JSON.stringify({ paymentMethodId }) },
        true,
      );
      setNotice("PayFast sandbox charge submitted for R " + Number(result.amount).toFixed(2) + ". Waiting for PayFast's verified confirmation.");
      await loadMyRequests();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not charge the saved card."); }
    finally { setJobActionBusy(false); }
  };

  const removeSavedCard = async (paymentMethodId: string) => {
    setJobActionBusy(true); setError(""); setNotice("");
    try {
      await apiRequest("/marketplace/payment-methods/" + paymentMethodId, { method: "DELETE" }, true);
      await loadSavedPaymentMethods();
      setNotice("Saved card removed from AnySkill and its PayFast token cancellation was requested.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not remove the saved card."); }
    finally { setJobActionBusy(false); }
  };

  const refreshPaymentStatus = async () => {
    await Promise.all([loadMyRequests(), loadSavedPaymentMethods()]);
    setNotice("Payment status refreshed.");
  };

  const submitProviderRating = async (requestId: string) => {
    if (!ratingDraft || ratingDraft.requestId !== requestId) return;
    setJobActionBusy(true); setError(""); setNotice("");
    try {
      await apiRequest("/marketplace/requests/" + requestId + "/rating", {
        method: "POST",
        body: JSON.stringify({
          skillRating: ratingDraft.skillRating,
          platformRating: ratingDraft.platformRating,
          comment: ratingDraft.comment.trim() || undefined,
        }),
      }, true);
      setRatingDraft(null);
      setNotice("Thank you. Your skill and overall AnySkill ratings have been submitted.");
      await loadMyRequests();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit your Provider rating."); }
    finally { setJobActionBusy(false); }
  };

  const submitSeekerRating = async (requestId: string) => {
    if (!seekerRatingDraft || seekerRatingDraft.requestId !== requestId) return;
    setJobActionBusy(true); setError(""); setNotice("");
    try {
      await apiRequest("/marketplace/requests/" + requestId + "/seeker-rating", {
        method: "POST",
        body: JSON.stringify({ rating: seekerRatingDraft.rating, comment: seekerRatingDraft.comment.trim() || undefined }),
      }, true);
      setSeekerRatingDraft(null);
      setNotice("Thank you. Your rating of the Skill Seeker has been submitted.");
      await loadMyJobs();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit your Skill Seeker rating."); }
    finally { setJobActionBusy(false); }
  };

  const submitRequest = async () => {
    setError(""); setNotice(""); setVerificationPrompt(false);
    if (matchingRequest || journeyScreen || hasActiveSeekerRequest) {
      setError("You already have an active service request. Continue with your existing service instead.");
      return;
    }
    if (title.trim().length < 5) { setError("Enter a request title with at least 5 characters."); return; }
    if (category.trim().length < 2) { setError("Choose a skill from the suggestions or use Add skill before publishing."); return; }
    if (deliveryMode !== "REMOTE" && (requestLatitude == null || requestLongitude == null)) { setError("Choose the exact job location on the map, use your saved Home Location, or use current GPS. Select Remote if the work does not need a physical location."); return; }
    setBusy(true);
    try {
      const published = await apiRequest<{
        id: string; title: string; skillCategory: string; location: string | null; createdAt: string; matchingStartedAt: string;
        matching?: { notified?: number; wave?: number; exhausted?: boolean };
      }>("/marketplace/requests", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(), skillCategory: category.trim(), description: description.trim(), ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
          ...(location.trim() ? { location: location.trim() } : {}),
          ...(deliveryMode !== "REMOTE" && requestLatitude != null && requestLongitude != null ? { latitude: requestLatitude, longitude: requestLongitude, searchRadiusKm } : {}), deliveryMode,
        }),
      }, true);
      setMatchingRequest({
        id: published.id, title: published.title, skillCategory: published.skillCategory,
        location: published.location, createdAt: published.matchingStartedAt, notified: published.matching?.notified ?? 0, wave: published.matching?.wave ?? 1, exhausted: published.matching?.exhausted ?? false,
      });
      setTitle(""); setCategory(""); setSkillQuery(""); setDescription(""); setInstructions(""); setLocation(""); setRequestLatitude(null); setRequestLongitude(null); setSearchRadiusKm(10);
      await loadMyRequests();
      setNotice("Your service request has been published.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not submit your request.";
      setError(message);
      if (message.toLowerCase().includes("identity verification")) setVerificationPrompt(true);
    } finally { setBusy(false); }
  };

  const loadProviderProfile = useCallback(async () => {
    try {
      const profile = await apiRequest<{ isAvailable: boolean } | null>("/marketplace/provider-profile", {}, true);
      setProviderAvailable(profile?.isAvailable ?? false);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load Provider availability."); }
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
      const result = await apiRequest<ProviderJob[]>("/marketplace/my-jobs", {}, true);
      const receivedAt = Date.now();
      const serverNow = result.find((item) => item.serverNow)?.serverNow;
      if (serverNow) setClockOffsetMs(Date.parse(serverNow) - (requestStartedAt + receivedAt) / 2);
      setMyJobs(result);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load selected jobs."); }
  }, []);

  const cancelProviderJob = (requestId: string, title: string) => {
    Alert.alert("Cancel selected service?", `Are you sure you want to cancel "${title}"? The Skill Seeker will be notified and can find another Provider.`, [
      { text: "Keep service", style: "cancel" },
      { text: "Cancel service", style: "destructive", onPress: () => {
        void apiRequest("/marketplace/requests/" + requestId + "/provider-cancel", { method: "POST" }, true)
          .then(() => {
            setActiveProviderJobId(null);
            setMyJobs((jobs) => jobs.filter((item) => item.request.id !== requestId));
            setNotice("Service cancelled. You are back on your Provider Home screen.");
            p.onBack();
          })
          .catch((e) => setError(e instanceof Error ? e.message : "Could not cancel this service."));
      } },
    ]);
  };

  const markProviderEnRoute = async (requestId: string): Promise<boolean> => {
    if (jobActionBusy) return false;
    setJobActionBusy(true); setError(""); setNotice("");
    let locationTrackingStarted = false;
    try {
      // Obtain a fresh, accurate GPS fix before confirming departure. This keeps
      // the Seeker's first live-location update tied to the actual trip.
      const position = await getInitialProviderLocation();
      await startProviderLocationUpdates();
      locationTrackingStarted = true;
      await apiRequest("/marketplace/provider-location/live", {
        method: "POST",
        body: JSON.stringify({
          latitude: Number(position.coords.latitude.toFixed(7)),
          longitude: Number(position.coords.longitude.toFixed(7)),
          accuracyM: Number(position.coords.accuracy?.toFixed(1)),
        }),
      }, true);
      const result = await apiRequest<{success:boolean;requestId:string;providerEnRouteAt:string}>(
        "/marketplace/requests/" + requestId + "/provider-en-route",
        { method: "POST" }, true,
      );
      if (!result.success || result.requestId !== requestId || !result.providerEnRouteAt) {
        throw new Error("AnySkill did not confirm your departure status. Refresh the service and try again.");
      }
      setMyJobs((jobs) => jobs.map((job) => job.request.id === requestId
        ? { ...job, providerEnRouteAt: result.providerEnRouteAt }
        : job));
      setNotice("The Seeker has been notified. Live location sharing is now active for this service.");
      return true;
    } catch (e) {
      if (locationTrackingStarted) {
        try { await stopProviderLocationUpdates(); } catch { /* Keep the original departure error. */ }
      }
      setError(e instanceof Error ? e.message : "Could not confirm that you are coming.");
      return false;
    } finally {
      setJobActionBusy(false);
    }
  };

  const markProviderArrived = async (requestId: string) => {
    if (jobActionBusy) return;
    setJobActionBusy(true); setError(""); setNotice("");
    try {
      const result = await apiRequest<{success:boolean;requestId:string;providerArrivedAt:string}>(
        "/marketplace/requests/" + requestId + "/provider-arrived",
        { method: "POST" }, true,
      );
      if (!result.success || result.requestId !== requestId || !result.providerArrivedAt) {
        throw new Error("AnySkill did not confirm your arrival. Refresh the service and try again.");
      }
      setMyJobs((jobs) => jobs.map((job) => job.request.id === requestId
        ? { ...job, providerArrivedAt: result.providerArrivedAt }
        : job));
      setNotice("Your arrival report has been sent to the Seeker. Wait for them to confirm before starting the assessment.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not confirm your arrival.");
    } finally {
      setJobActionBusy(false);
    }
  };

  const confirmProviderArrival = async (requestId: string) => {
    if (jobActionBusy) return;
    setJobActionBusy(true); setError(""); setNotice("");
    try {
      const result = await apiRequest<{success:boolean;requestId:string;seekerArrivalConfirmedAt:string}>(
        "/marketplace/requests/" + requestId + "/confirm-provider-arrival",
        { method: "POST" }, true,
      );
      if (!result.success || result.requestId !== requestId || !result.seekerArrivalConfirmedAt) {
        throw new Error("AnySkill could not record your arrival confirmation. Refresh and try again.");
      }
      setJourneyScreen((current) => current?.requestId === requestId
        ? { ...current, seekerArrivalConfirmedAt: result.seekerArrivalConfirmedAt }
        : current);
      setNotice("Provider arrival confirmed. The assessment can now begin.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not confirm Provider arrival.");
    } finally {
      setJobActionBusy(false);
    }
  };

  const openProviderNavigation = async (requestId: string, latitude: number, longitude: number) => {
    const url = "https://www.google.com/maps/dir/?api=1&destination=" + latitude + "," + longitude + "&travelmode=driving";
    try {
      await Linking.openURL(url);
      setNavigationOpenedRequestIds((ids) => ids.includes(requestId) ? ids : [...ids, requestId]);
    } catch {
      setError("Could not open your navigation application.");
    }
  };

  const persistAssessmentDraft = async (requestId: string) => {
    const hours = Number(estimateHours);
    const estimatedHours = Number.isFinite(hours) && hours >= 0.25 ? hours : null;
    const result = await apiRequest<{success:boolean;requestId:string}>(
      "/marketplace/requests/" + requestId + "/assessment/draft",
      { method: "PATCH", body: JSON.stringify({ estimatedHours, notes: estimateNotes }) },
      true,
    );
    if (!result.success || result.requestId !== requestId) throw new Error("Assessment draft could not be saved. Please try again.");
    setAssessmentDraftSaveStatus("Saved");
  };

  const updateAssessmentStage = async (requestId: string, action: "start" | "complete") => {
    if (jobActionBusy) return;
    setJobActionBusy(true); setError(""); setNotice("");
    try {
      if (action === "complete") await persistAssessmentDraft(requestId);
      const result = await apiRequest<{success:boolean;requestId:string;assessmentStartedAt?:string;assessmentCompletedAt?:string}>(
        "/marketplace/requests/" + requestId + "/assessment/" + action,
        { method: "POST" }, true,
      );
      if (!result.success || result.requestId !== requestId || (action === "start" ? !result.assessmentStartedAt : !result.assessmentCompletedAt)) {
        throw new Error("The assessment stage was not confirmed. Refresh and try again.");
      }
      setMyJobs((jobs) => jobs.map((job) => job.request.id !== requestId ? job : {
        ...job,
        ...(result.assessmentStartedAt ? { assessmentStartedAt: result.assessmentStartedAt } : {}),
        ...(result.assessmentCompletedAt ? { assessmentCompletedAt: result.assessmentCompletedAt } : {}),
      }));
      if (action === "complete") setAssessmentDraftAutosaveEnabled(false);
      setNotice(action === "start" ? "Assessment started. The Seeker has been notified." : "Assessment marked done. The Seeker has been notified. Submit the final estimate for approval.");
      await loadMyJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the assessment.");
    } finally {
      setJobActionBusy(false);
    }
  };

  const cancelSeekerJourney = (requestId: string, title: string) => {
    Alert.alert("Cancel selected Provider?", `Are you sure you want to cancel "${title}"? The Provider will be notified and you can find another Provider.`, [
      { text: "Keep service", style: "cancel" },
      { text: "Cancel service", style: "destructive", onPress: () => {
        void apiRequest("/marketplace/requests/" + requestId + "/cancel", { method: "POST" }, true)
          .then(async () => {
            setJourneyScreen(null);
            await loadMyRequests();
            setNotice("Service cancelled. You can now match with another Provider.");
          })
          .catch((e) => setError(e instanceof Error ? e.message : "Could not cancel this service."));
      } },
    ]);
  };

  useEffect(() => {
    if (p.mode !== "provider") {
      assessmentDraftHydratedRequestIdRef.current = null;
      return;
    }
    const activeJob = myJobs.find((job) => job.request.id === activeProviderJobId);
    if (!activeJob || assessmentDraftHydratedRequestIdRef.current === activeJob.request.id) return;
    assessmentDraftHydratedRequestIdRef.current = activeJob.request.id;
    setEstimateHours(activeJob.assessmentDraftHours == null ? "2" : String(activeJob.assessmentDraftHours));
    setEstimateNotes(activeJob.assessmentDraftNotes ?? "");
    setAssessmentDraftSaveStatus(activeJob.assessmentDraftUpdatedAt ? "Draft restored" : "Not saved yet");
    setAssessmentDraftAutosaveEnabled(activeJob.status === "ASSESSMENT_PENDING" && !!activeJob.assessmentStartedAt && !activeJob.assessmentCompletedAt);
  }, [p.mode, myJobs, activeProviderJobId]);

  useEffect(() => {
    if (p.mode !== "provider" || !activeProviderJobId || !assessmentDraftAutosaveEnabled) return;
    const timer = setTimeout(() => {
      const hours = Number(estimateHours);
      const estimatedHours = Number.isFinite(hours) && hours >= 0.25 ? hours : null;
      setAssessmentDraftSaveStatus("Saving…");
      void apiRequest<{success:boolean;assessmentDraftUpdatedAt:string}>(
        "/marketplace/requests/" + activeProviderJobId + "/assessment/draft",
        { method: "PATCH", body: JSON.stringify({ estimatedHours, notes: estimateNotes }) },
        true,
      ).then((result) => {
        if (result.success) setAssessmentDraftSaveStatus("Saved " + new Date(result.assessmentDraftUpdatedAt).toLocaleTimeString());
      }).catch(() => setAssessmentDraftSaveStatus("Save failed — check your connection"));
    }, 700);
    return () => clearTimeout(timer);
  }, [p.mode, activeProviderJobId, assessmentDraftAutosaveEnabled, estimateHours, estimateNotes]);

  useEffect(() => {
    if (p.mode !== "provider") return;
    hasLoadedIncomingRequestsRef.current = false;
    void loadRequests(); void loadProviderProfile(); void loadMyJobs();
    const refreshIncoming = setInterval(() => { void loadRequests(); }, 8000);
    return () => clearInterval(refreshIncoming);
  }, [p.mode, loadRequests, loadProviderProfile, loadMyJobs]);

  // Activities can reopen any server-confirmed active engagement. This is a
  // navigation action only; dismissing the modal never changes job status.
  useEffect(() => {
    if (p.mode !== "provider" || !p.initialProviderJobId) return;
    const selectedJob = myJobs.find((job) => job.request.id === p.initialProviderJobId);
    if (!selectedJob) return;
    setDismissedActiveJobIds((ids) => ids.filter((id) => id !== selectedJob.request.id));
    setActiveProviderJobId(selectedJob.request.id);
    p.onProviderJobOpened?.();
  }, [p.mode, p.initialProviderJobId, p.onProviderJobOpened, myJobs]);

  const providerHasEnRouteJob = myJobs.some((job) => !!job.providerEnRouteAt
    && ["ASSESSMENT_PENDING", "ESTIMATE_SUBMITTED", "ESTIMATE_REJECTED", "ESTIMATE_APPROVED", "IN_PROGRESS"].includes(job.status));

  useEffect(() => {
    if (p.mode !== "provider" || Platform.OS !== "web" || (!providerAvailable && !providerHasEnRouteJob)) return;

    let active = true;
    let nativeSubscription: Location.LocationSubscription | null = null;
    let browserWatchId: number | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let publishing = false;
    let acquiring = false;

    type LiveCoordinates = {
      latitude: number;
      longitude: number;
      accuracy: number | null;
    };

    const publishLocation = async (coords: LiveCoordinates) => {
      if (!active || publishing) return;
      if (
        !Number.isFinite(coords.latitude) ||
        !Number.isFinite(coords.longitude) ||
        coords.accuracy == null ||
        !Number.isFinite(coords.accuracy) ||
        coords.accuracy > 50
      ) {
        if (active) setError("Waiting for a more accurate GPS reading. Keep location enabled and try again.");
        return;
      }

      publishing = true;
      console.info("[AnySkill location] Posting foreground GPS fix", {
        accuracyMetres: Number(coords.accuracy.toFixed(1)),
      });
      try {
        const result = await apiRequest("/marketplace/provider-location/live", {
          method: "POST",
          body: JSON.stringify({
            latitude: Number(coords.latitude.toFixed(7)),
            longitude: Number(coords.longitude.toFixed(7)),
            accuracyM: Number(coords.accuracy.toFixed(1)),
          }),
        }, true);
        console.info("[AnySkill location] Foreground location API request succeeded", result);
      } catch (e) {
        console.error("[AnySkill location] Foreground location API request failed", e);
        // The next GPS callback or heartbeat retries with a fresh location.
        if (active) setError(e instanceof Error ? e.message : "Live location update failed. Retrying automatically.");
      } finally {
        publishing = false;
      }
    };

    const publishBrowserPosition = (position: GeolocationPosition) => {
      void publishLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      });
    };

    const readBrowserLocation = () => {
      if (!active || acquiring || publishing) return;
      if (!navigator.geolocation) {
        setError("This browser does not support location sharing. Open AnySkill in a browser with geolocation enabled.");
        return;
      }
      acquiring = true;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          acquiring = false;
          if (active) publishBrowserPosition(position);
        },
        (error) => {
          acquiring = false;
          if (!active) return;
          const message = error.code === error.PERMISSION_DENIED
            ? "Allow location access for AnySkill in your browser to share your Provider location."
            : error.code === error.POSITION_UNAVAILABLE
              ? "Your browser cannot determine your location yet. Check device location services and try again."
              : "The browser location request timed out. AnySkill will retry automatically.";
          setError(message);
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
      );
    };

    const startBrowserLocationSharing = () => {
      if (!window.isSecureContext && window.location.hostname !== "localhost") {
        setError("Browser location sharing requires HTTPS. Open AnySkill using its secure HTTPS address.");
        return;
      }
      if (!navigator.geolocation) {
        setError("This browser does not support location sharing. Open AnySkill in a browser with geolocation enabled.");
        return;
      }

      // Install the browser watcher before requesting the first fix. The
      // heartbeat also refreshes stationary Providers and retries failed posts.
      browserWatchId = navigator.geolocation.watchPosition(
        publishBrowserPosition,
        (error) => {
          if (!active) return;
          const message = error.code === error.PERMISSION_DENIED
            ? "Allow location access for AnySkill in your browser to share your Provider location."
            : error.code === error.POSITION_UNAVAILABLE
              ? "Your browser cannot determine your location yet. Check device location services."
              : "The browser location request timed out. Retrying automatically.";
          setError(message);
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
      );

      heartbeat = setInterval(readBrowserLocation, 15000);
      readBrowserLocation();
    };

    const startNativeLocationSharing = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        throw new Error("Location permission is needed to show your live location on the Provider map.");
      }
      if (!active) return;

      // Start movement updates first. A failed initial GPS fix must not prevent
      // the watcher or periodic heartbeat from being installed.
      try {
        nativeSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 15000,
            // A stationary Provider must still receive periodic location fixes.
            distanceInterval: 0,
          },
          (position) => { void publishLocation(position.coords); },
        );
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "GPS movement tracking could not start. Retrying with periodic location checks.");
      }

      if (!active) return;

      // Bound each GPS acquisition so a stalled native location request cannot
      // permanently lock the heartbeat in the acquiring state.
      const acquireAndPublish = async () => {
        if (!active || acquiring || publishing) return;
        acquiring = true;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        try {
          console.info("[AnySkill location] Requesting a fresh foreground GPS fix");
          const position = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(
                () => reject(new Error("GPS did not return a fresh position within 12 seconds. Check device location services and GPS permissions.")),
                12000,
              );
            }),
          ]);
          if (active) {
            console.info("[AnySkill location] Foreground GPS fix received", {
              accuracyMetres: position.coords.accuracy,
            });
            await publishLocation(position.coords);
          }
        } catch (e) {
          console.error("[AnySkill location] Foreground GPS acquisition failed", e);
          if (active) setError(e instanceof Error ? e.message : "Could not obtain a current GPS location. Retrying automatically.");
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
          acquiring = false;
        }
      };

      // Publish once immediately, then retry every 15 seconds even when the
      // Provider is stationary. A timed-out request must not block later tries.
      await acquireAndPublish();
      if (!active) return;
      heartbeat = setInterval(() => { void acquireAndPublish(); }, 15000);
    };

    if (Platform.OS === "web") {
      startBrowserLocationSharing();
    } else {
      void startNativeLocationSharing().catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Could not start live location sharing.");
      });
    }

    return () => {
      active = false;
      if (heartbeat) clearInterval(heartbeat);
      if (browserWatchId != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(browserWatchId);
      }
      nativeSubscription?.remove();
    };
  }, [p.mode, providerAvailable, providerHasEnRouteJob]);

  const cancelLiveRequest = async () => {
    if (!matchingRequest || jobActionBusy) return;
    setJobActionBusy(true); setError("");
    try {
      await apiRequest(`/marketplace/requests/${matchingRequest.id}/cancel`, { method: "POST" }, true);
      setMatchingRequest(null);
      await loadMyRequests();
      setNotice("Your service request has been cancelled.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not cancel this request."); }
    finally { setJobActionBusy(false); }
  };

  const scheduleLiveRequest = async () => {
    if (!matchingRequest || jobActionBusy) return;
    const scheduled = new Date(scheduleDateTime);
    if (!Number.isFinite(scheduled.getTime()) || scheduled.getTime() < Date.now() + 15 * 60 * 1000) {
      setError("Choose a date and time at least 15 minutes from now."); return;
    }
    setJobActionBusy(true); setError("");
    try {
      const result = await apiRequest<{ preferredStartAt: string; matching?: { notified?: number; wave?: number; exhausted?: boolean } }>(`/marketplace/requests/${matchingRequest.id}/schedule`, {
        method: "POST", body: JSON.stringify({ preferredStartAt: scheduled.toISOString() }),
      }, true);
      setMatchingRequest({ ...matchingRequest, createdAt: new Date().toISOString(), notified: result.matching?.notified ?? 0, wave: result.matching?.wave ?? 1, exhausted: result.matching?.exhausted ?? false });
      await loadMyRequests();
      setNotice("Your request has been scheduled and Provider matching has restarted for the scheduled work time.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not schedule this request."); }
    finally { setJobActionBusy(false); }
  };

  const hasActiveSeekerRequest = myRequests.some((request) =>
    request.status === "OPEN"
    || (request.jobEngagement && ["ASSESSMENT_PENDING", "ESTIMATE_SUBMITTED", "ESTIMATE_REJECTED", "ESTIMATE_APPROVED", "IN_PROGRESS", "COMPLETION_PENDING", "DISPUTED"].includes(request.jobEngagement.status)),
  );

  return <View style={s.container}>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {p.mode === "seeker" ? !seekerRequestsLoaded ? <View style={{ alignItems: "center", paddingVertical: 48 }}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={s.helper}>Checking for your active service request...</Text>
        {error ? <Text style={s.error}>{error}</Text> : null}
        <Secondary label="Retry loading request" onPress={() => void loadMyRequests()} />
      </View> : matchingRequest || journeyScreen || hasActiveSeekerRequest ? <View style={{ alignItems: "center", paddingVertical: 36 }}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={s.section}>Restoring your active service</Text>
        <Text style={s.helper}>{matchingRequest ? "Your existing request is being matched. The Matching screen is open." : "Your existing service is being restored. You cannot submit another request while it is active."}</Text>
      </View> : <>
        <Text style={s.section}>Create a service request</Text>
        <Text style={s.helper}>Describe the work you need done. You can prepare your request before verification; publishing requires verified identity.</Text>
        {!p.verified && <View style={s.notice}><Text style={s.noticeTitle}>Verification required to publish</Text><Text style={s.noticeText}>You can complete this request form now. AnySkill will only publish it after your identity is verified.</Text></View>}
        <Text style={s.label}>What do you need done?</Text>
        <TextInput value={title} onChangeText={setTitle} maxLength={120} placeholder="e.g. Repair a leaking kitchen tap" style={s.input} />
        <Text style={s.label}>Choose a skill</Text>
        <TextInput value={skillQuery} onChangeText={(value) => { setSkillQuery(value); setCategory(""); }} maxLength={100} placeholder="Search skills, e.g. Plumbing" style={s.input} />
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
        <TextInput value={description} onChangeText={setDescription} maxLength={5000} placeholder="Explain what needs to be done..." multiline style={[s.input, s.multiline]} />
        <Text style={s.label}>Special notes (optional)</Text>
        <TextInput value={instructions} onChangeText={setInstructions} maxLength={2000} placeholder="Add access details, preferred times, materials, or anything else the Provider should know..." multiline style={[s.input, s.multiline]} />
        <Text style={s.label}>Service area (not your exact street address)</Text>
        <TextInput value={location} onChangeText={setLocation} maxLength={500} placeholder="e.g. Rosebank, Johannesburg" style={s.input} />
        <View style={s.choiceRow}>
          <Secondary label="Use saved Home Location" onPress={useSavedHomeLocation} />
          <Secondary label={locationBusy ? "Getting GPS..." : "Use current GPS"} onPress={() => void useCurrentJobLocation()} />
        </View>
        <Text style={s.helper}>{requestLatitude != null && requestLongitude != null ? `Job coordinates selected: ${requestLatitude.toFixed(5)}, ${requestLongitude.toFixed(5)}` : "For on-site or either-mode requests, choose the job location using Home Location, current GPS, or the map. Only this job location is shared with matched Providers."}</Text>
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
          <Text style={s.label}>Provider search radius</Text>
          <View style={s.choiceRow}>
            {[5, 10, 20, 50].map((radius) => <Pressable key={radius} onPress={() => setSearchRadiusKm(radius)} style={[s.choice, searchRadiusKm === radius && s.choiceActive]}><Text style={[s.choiceText, searchRadiusKm === radius && s.choiceTextActive]}>{radius} km</Text></Pressable>)}
          </View>
          <Text style={s.helper}>AnySkill will only match on-site Providers within {searchRadiusKm} km of this job location, and within the Provider's own travel limit.</Text>
          <MapPinPicker
            latitude={requestLatitude ?? savedHomeLocation?.homeLatitude ?? -26.2041}
            longitude={requestLongitude ?? savedHomeLocation?.homeLongitude ?? 28.0473}
            selectedLatitude={requestLatitude}
            selectedLongitude={requestLongitude}
            onSelect={(lat, lon) => { setRequestLatitude(lat); setRequestLongitude(lon); setLocation("On-site job location"); }}
          />
        </> : <Text style={s.helper}>Remote requests do not need a physical job location or GPS coordinates.</Text>}
        <Primary label={busy ? "Publishing request..." : "Service request"} onPress={submitRequest} disabled={busy} />
        <Text style={s.helper}>You can tap Publish service request at any time. If anything required is missing, AnySkill will explain what to complete. On-site and Either requests need a selected map location; Remote requests do not.</Text>
        {verificationPrompt && <View style={s.notice}><Text style={s.noticeTitle}>Verify before publishing</Text><Text style={s.noticeText}>Your request details are still on this screen. Start identity verification from your account, then return here to publish.</Text><Secondary label="Go to identity verification" onPress={p.onStartVerification} /></View>}
        </> : <>
      </>}
      {notice ? <Text style={s.success}>{notice}</Text> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
    </ScrollView>
    <Modal visible={p.mode === "seeker" && matchingRequest !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => undefined}>
      <View style={{ flex: 1, backgroundColor: "#F6F8FA", paddingHorizontal: 10, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }}>
        {p.platformHeader}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center" }}>
          <Text style={{ color: "#1B5E20", fontSize: 11, fontWeight: "900" }}>REQUEST SUBMITTED</Text>
        </View>
        {matchingRequest ? (() => {
          const elapsedMs = Math.max(0, clockNow - Date.parse(matchingRequest.createdAt));
          const timedOut = elapsedMs >= 30 * 60 * 1000;
          const remainingMs = Math.max(0, 30 * 60 * 1000 - elapsedMs);
          const offers = myRequests.find((item) => item.id === matchingRequest.id)?.providerResponses.filter((offer) => offer.status === "OFFERED" && !dismissedOfferIds.includes(offer.id)) ?? [];
          const activeOffer = offers.find((offer) => offer.id === activeOfferId) ?? null;
          const profile = activeOffer?.provider.providerProfile;
          const rating = profile?.ratings;
          return activeOffer ? (
            <View style={{ flex: 1, justifyContent: "flex-end" }}>
              <Pressable onPress={() => { setActiveOfferId(null); setShowProviderProfile(false); }} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(10, 24, 18, 0.38)", zIndex: 0 }} />
              <View style={{ maxHeight: "90%", backgroundColor: "#F6F8F6", borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingTop: 10, paddingHorizontal: 12, paddingBottom: 18, borderWidth: 1, borderColor: "#DCE8E1", zIndex: 1, elevation: 20 }}>
                <View style={{ width: 42, height: 5, borderRadius: 3, backgroundColor: "#C8D3CC", alignSelf: "center", marginBottom: 8 }} />
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: "#176B55", fontSize: 11, fontWeight: "900", letterSpacing: 1 }}>NEW PROVIDER OFFER</Text>
                  <Pressable onPress={() => { setActiveOfferId(null); setShowProviderProfile(false); }}><Text style={{ color: "#53645A", fontWeight: "900", padding: 8 }}>Close</Text></Pressable>
                </View>
                <ScrollView style={{ marginTop: 4 }} contentContainerStyle={{ paddingBottom: 24 }}>
              <Pressable onPress={() => { setActiveOfferId(null); setShowProviderProfile(false); }} style={{ paddingVertical: 10 }}><Text style={{ color: "#176B55", fontWeight: "800" }}>‹ Back to matching</Text></Pressable>
              {showProviderProfile ? <View style={{ backgroundColor: "#FFFFFF", borderRadius: 22, padding: 20, marginTop: 16 }}>
                <Text style={{ color: "#15251E", fontSize: 25, fontWeight: "900" }}>Provider profile</Text>
                <Text style={{ color: "#15251E", fontSize: 21, fontWeight: "900", marginTop: 14 }}>{profile?.publicName || "Skill Provider"}</Text>
                <Text style={{ color: "#176B55", fontSize: 12, fontWeight: "800", marginTop: 6 }}>✓ Identity verified</Text>
                <Text style={{ color: "#15251E", marginTop: 12 }}>★ {rating?.overallIsRated ? rating.overall.toFixed(1) : "New"} · {rating?.overallReviewCount ?? 0} reviews</Text>
                <Text style={{ color: "#66756D", marginTop: 15 }}>Skills: {profile?.skillCategories?.join(", ") || "Not provided"}</Text>
                <Text style={{ color: "#66756D", marginTop: 8 }}>Service areas: {profile?.serviceAreas?.join(", ") || "Not provided"}</Text>
                <Text style={{ color: "#66756D", marginTop: 8 }}>Delivery: {profile?.deliveryModes?.join(", ") || "Not provided"}</Text>
                <Text style={{ color: "#66756D", fontSize: 12, lineHeight: 18, marginTop: 18 }}>Identity verification confirms identity only. It does not certify qualifications, experience or work quality.</Text>
              </View> : <>
                <Text style={{ color: "#176B55", fontSize: 11, fontWeight: "900", letterSpacing: 1.2, marginTop: 8 }}>NEW PROVIDER OFFER</Text>
                <Text style={{ color: "#15251E", fontSize: 28, fontWeight: "900", marginTop: 8 }}>Review this offer</Text>
                <View style={{ backgroundColor: "#FFFFFF", borderRadius: 22, borderWidth: 1, borderColor: "#DCE8E1", padding: 19, marginTop: 18 }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: "#DDEFE8", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#176B55", fontSize: 21, fontWeight: "900" }}>{(profile?.publicName || "SP").split(/\s+/).map((part) => part[0]).slice(0,2).join("").toUpperCase()}</Text></View>
                    <View style={{ flex: 1, marginLeft: 13 }}><Text style={{ color: "#15251E", fontSize: 19, fontWeight: "900" }}>{profile?.publicName || "Skill Provider"}</Text><Text style={{ color: "#176B55", fontSize: 11, fontWeight: "900", marginTop: 5 }}>✓ Identity verified</Text></View>
                  </View>
                  <Text style={{ color: "#15251E", fontWeight: "800", marginTop: 16 }}>★ {rating?.overallIsRated ? rating.overall.toFixed(1) : "New Provider"} · {rating?.overallReviewCount ?? 0} reviews</Text>
                  <View style={{ backgroundColor: "#F4F7F5", borderRadius: 14, padding: 14, marginTop: 15 }}><Text style={{ color: "#66756D", fontSize: 10, fontWeight: "900" }}>PROVIDER MESSAGE</Text><Text style={{ color: "#24352D", fontSize: 14, lineHeight: 21, marginTop: 8 }}>{activeOffer.message || "I am available to assist with your request."}</Text></View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 12 }}>
                    {[["SKILL", matchingRequest.skillCategory], ["EXPERIENCE", profile?.experience || "Not provided"], ["DISTANCE", profile?.distanceKm == null ? "Not available" : `${profile.distanceKm.toFixed(1)} km away`], ["AVAILABILITY", profile?.isAvailable ? "Available now" : "Currently unavailable"]].map(([label,value]) => <View key={label} style={{ width: "50%", paddingVertical: 10 }}><Text style={{ color: "#829087", fontSize: 9, fontWeight: "900" }}>{label}</Text><Text style={{ color: "#24352D", fontSize: 14, fontWeight: "800", marginTop: 5 }}>{value}</Text></View>)}
                  </View>
                  <View style={{ backgroundColor: "#15251E", borderRadius: 16, padding: 16, marginTop: 8 }}><Text style={{ color: "#C8D9D0", fontSize: 10, fontWeight: "900" }}>PROVIDER'S HOURLY RATE</Text><Text style={{ color: "#FFFFFF", fontSize: 26, fontWeight: "900", marginTop: 5 }}>{activeOffer.hourlyRateAtOffer == null ? "To be confirmed" : `R ${Number(activeOffer.hourlyRateAtOffer).toFixed(2)}`}<Text style={{ color: "#D4E0D9", fontSize: 12 }}> / hr</Text></Text></View>
                  <View style={{ backgroundColor: "#EAF1EC", borderRadius: 14, padding: 14, marginTop: 9 }}>
                    <Text style={{ color: "#53645A", fontSize: 10, fontWeight: "900" }}>ASSESSMENT / CALL-OUT FEE</Text>
                    <Text style={{ color: "#15251E", fontSize: 20, fontWeight: "900", marginTop: 5 }}>{activeOffer.assessmentRequiredAtOffer === false ? "R 0.00 · No assessment" : activeOffer.assessmentFeeAtOffer == null ? "To be confirmed" : Number(activeOffer.assessmentFeeAtOffer) === 0 ? "No assessment fee" : `R ${Number(activeOffer.assessmentFeeAtOffer).toFixed(2)}`}</Text>
                  </View>
                  {activeOffer.assessmentRequiredAtOffer === false ? <Text style={{ color: "#78551A", fontSize: 12, lineHeight: 18, marginTop: 10, backgroundColor: "#FFF6E4", padding: 12, borderRadius: 12 }}>Important: This hourly offer is limited to one billable hour. Even if the work takes longer, the Provider cannot charge for extra time or request additional payment for this job.</Text> : null}
                  <Text style={{ color: "#66756D", fontSize: 11, lineHeight: 17, marginTop: 10 }}>Review the Provider's rate and call-out fee before accepting. Any additional work or charges must be agreed with you before proceeding.</Text>
                  <Pressable onPress={() => setShowProviderProfile(true)} style={{ paddingVertical: 16, alignItems: "center" }}><Text style={{ color: "#176B55", fontWeight: "900" }}>View full Provider profile →</Text></Pressable>
                  <Text style={{ color: "#829087", fontSize: 10, textAlign: "center" }}>Identity verification confirms identity only.</Text>
                </View>
                <Pressable onPress={() => void declineProviderOffer(matchingRequest.id, activeOffer.id)} disabled={!!selectingOfferId || jobActionBusy} style={{ borderWidth: 1, borderColor: "#D7E0DA", borderRadius: 15, padding: 15, alignItems: "center", marginTop: 15, backgroundColor: "#FFFFFF" }}><Text style={{ color: "#53645A", fontWeight: "900" }}>Decline offer</Text></Pressable>
                <Pressable onPress={() => void cancelLiveRequest()} disabled={!!selectingOfferId || jobActionBusy} style={{ borderWidth: 1, borderColor: "#E7B8B4", borderRadius: 15, padding: 14, alignItems: "center", marginTop: 10, backgroundColor: "#FFF8F7" }}>
                  <Text style={{ color: "#B42318", fontWeight: "900" }}>{jobActionBusy ? "Please wait..." : "Cancel entire service request"}</Text>
                  <Text style={{ color: "#8D4B46", fontSize: 11, marginTop: 4 }}>Closes the request and all pending offers</Text>
                </Pressable>
                <Pressable onPress={() => { console.log("[AnySkill] Accept offer tapped", { requestId: matchingRequest.id, responseId: activeOffer.id }); void selectProvider(matchingRequest.id, activeOffer.id); }} hitSlop={8} disabled={!!selectingOfferId || jobActionBusy} style={{ backgroundColor: "#176B55", borderRadius: 15, padding: 16, alignItems: "center", justifyContent: "center", marginTop: 10, minHeight: 54, zIndex: 2, elevation: 5 }}>{selectingOfferId === activeOffer.id ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>Accept offer</Text>}</Pressable>
                {error ? <Text style={{ color: "#B42318", fontSize: 13, lineHeight: 19, fontWeight: "700", marginTop: 12, textAlign: "center" }}>{error}</Text> : null}
                {notice ? <Text style={{ color: "#176B55", fontSize: 13, lineHeight: 19, fontWeight: "700", marginTop: 12, textAlign: "center" }}>{notice}</Text> : null}
              </>}
                </ScrollView>
              </View>
            </View>
          ) : (
          <>            <View style={{ alignItems: "center", marginTop: 35 }}>
              {timedOut ? <Text style={{ color: "#9A5B00", fontSize: 12, fontWeight: "900" }}>LIVE SEARCH TIME LIMIT REACHED</Text> : <ActivityIndicator size="large" color="#0066CC" />}
              <Text style={{ color: "#0B2545", fontSize: 26, lineHeight: 32, fontWeight: "900", textAlign: "center", marginTop: 20 }}>{timedOut ? "Let's schedule your request." : "Finding the best Provider for you."}</Text>
              <Text style={{ color: "#66756D", fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 10 }}>{timedOut ? "The 30-minute live search has ended. Your request details are saved. Choose when you need the work done and AnySkill will restart Provider matching." : "This screen stays open while AnySkill matches your request. You can cancel at any time."}</Text>
              {!timedOut ? <Text style={{ color: "#0066CC", fontSize: 16, fontWeight: "900", marginTop: 12 }}>Time remaining: {Math.floor(remainingMs / 60000)}:{String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, "0")}</Text> : null}
            </View>
            <View style={{ backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: "#E1E8E3", padding: 16, marginTop: 25 }}>
              <Text style={{ color: "#66756D", fontSize: 11, fontWeight: "800" }}>YOUR REQUEST</Text>
              <Text style={{ color: "#0B2545", fontSize: 17, fontWeight: "900", marginTop: 7 }}>{matchingRequest.title}</Text>
              <Text style={{ color: "#0066CC", fontSize: 13, fontWeight: "800", marginTop: 5 }}>{matchingRequest.skillCategory}</Text>
              {matchingRequest.location ? <Text style={{ color: "#66756D", fontSize: 12, marginTop: 7 }}>📍 {matchingRequest.location}</Text> : null}
              <Text style={{ color: "#66756D", fontSize: 12, marginTop: 8 }}>Matching wave {matchingRequest.wave} · {matchingRequest.notified} Provider(s) notified · {offers.length} offer(s) received</Text>
            </View>
            {offers.map((offer) => <Pressable key={offer.id} onPress={() => { setAutoOpenedOfferIds((ids) => ids.includes(offer.id) ? ids : [...ids, offer.id]); setActiveOfferId(offer.id); setShowProviderProfile(false); }} style={{ backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: "#C8DCD1", padding: 15, marginTop: 12 }}>
              <Text style={{ color: "#15251E", fontWeight: "900", fontSize: 15 }}>{offer.provider.providerProfile?.publicName || "Skill Provider"}</Text>
              <Text style={{ color: "#176B55", fontSize: 11, fontWeight: "800", marginTop: 4 }}>✓ Identity verified · ★ {offer.provider.providerProfile?.ratings?.overallIsRated ? offer.provider.providerProfile.ratings.overall.toFixed(1) : "New Provider"}</Text>
              <Text style={{ color: "#66756D", fontSize: 12, marginTop: 7 }} numberOfLines={2}>{offer.message || "This Provider is available for your request."}</Text>
              <Text style={{ color: "#176B55", fontSize: 12, fontWeight: "900", marginTop: 10 }}>Review offer →</Text>
            </Pressable>)}
            {timedOut ? <>
              <Text style={{ color: "#0B2545", fontSize: 13, fontWeight: "900", marginTop: 20 }}>When do you need the work?</Text>
              <TextInput value={scheduleDateTime} onChangeText={setScheduleDateTime} placeholder="YYYY-MM-DDTHH:mm (local time)" style={{ backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D6E0EA", borderRadius: 11, minHeight: 50, paddingHorizontal: 12, marginTop: 8, color: "#0B2545" }} />
              <Text style={{ color: "#66756D", fontSize: 11, marginTop: 6 }}>Enter local date and time, for example 2026-11-18T09:00. Your existing request details will be reused.</Text>
              <Pressable onPress={() => void scheduleLiveRequest()} disabled={jobActionBusy} style={{ backgroundColor: "#0066CC", borderRadius: 13, padding: 15, alignItems: "center", marginTop: 14, opacity: jobActionBusy ? 0.5 : 1 }}>
                <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>{jobActionBusy ? "Scheduling..." : "Schedule and find Providers"}</Text>
              </Pressable>
            </> : null}
            <Pressable onPress={() => void cancelLiveRequest()} disabled={jobActionBusy} style={{ borderWidth: 1, borderColor: "#D14A4A", borderRadius: 13, padding: 14, alignItems: "center", marginTop: 14, opacity: jobActionBusy ? 0.5 : 1 }}>
              <Text style={{ color: "#B42318", fontWeight: "900" }}>{jobActionBusy ? "Please wait..." : "Cancel service request"}</Text>
            </Pressable>
          </>);
        })() : null}
      </View>
    </Modal>
    <Modal visible={p.mode === "provider" && providerOfferReview !== null && (providerOfferReview.status !== "SELECTED" || activeProviderJobId === null)} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => { if (providerOfferReview) setDismissedProviderOfferIds((ids) => [...ids, providerOfferReview.responseId]); setProviderOfferReview(null); }}>
      <View style={{ flex: 1, backgroundColor: "#F5F7F5", paddingHorizontal: 10, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12, justifyContent: "center" }}>
        {p.platformHeader}
        <View style={{ alignItems: "center" }}>
          <View style={{ width: 82, height: 82, borderRadius: 41, backgroundColor: providerOfferReview?.status === "SELECTED" ? "#DDF3E5" : providerOfferReview?.status === "WITHDRAWN" || providerOfferReview?.status === "DECLINED" ? "#FCE8E6" : "#E5F1EC", alignItems: "center", justifyContent: "center" }}>
            {providerOfferReview?.status === "OFFERED" ? <ActivityIndicator size="large" color="#176B55" /> : <Text style={{ color: "#176B55", fontSize: 34, fontWeight: "900" }}>{providerOfferReview?.status === "SELECTED" ? "✓" : "!"}</Text>}
          </View>
          <Text style={{ color: "#176B55", fontSize: 11, fontWeight: "900", letterSpacing: 1.4, marginTop: 26 }}>
            {providerOfferReview?.status === "SELECTED" ? "OFFER ACCEPTED" : providerOfferReview?.status === "WITHDRAWN" || providerOfferReview?.status === "DECLINED" ? "OFFER NO LONGER UNDER REVIEW" : "OFFER SENT"}
          </Text>
          <Text style={{ color: "#15251E", fontSize: 28, lineHeight: 35, fontWeight: "900", textAlign: "center", marginTop: 10 }}>
            {providerOfferReview?.status === "SELECTED" ? "The Seeker selected you!" : providerOfferReview?.status === "WITHDRAWN" || providerOfferReview?.status === "DECLINED" ? "This offer is no longer active" : "Your offer is being reviewed"}
          </Text>
          <Text style={{ color: "#66756D", fontSize: 14, lineHeight: 22, textAlign: "center", marginTop: 12 }}>
            {providerOfferReview?.status === "SELECTED" ? "Your offer has been approved. Review the service details, then confirm when you are ready to travel to the Seeker." : providerOfferReview?.status === "WITHDRAWN" || providerOfferReview?.status === "DECLINED" ? "The Seeker did not proceed with this offer. You can continue exploring other available requests." : "Your offer has been sent to the Skill Seeker and is now being reviewed. They may compare it with other offers before choosing a Provider. You do not need to send it again."}
          </Text>
        </View>
        <View style={{ backgroundColor: "#FFFFFF", borderRadius: 18, borderWidth: 1, borderColor: "#E1E8E3", padding: 18, marginTop: 30 }}>
          <Text style={{ color: "#829087", fontSize: 10, fontWeight: "900" }}>YOUR OFFER</Text>
          <Text style={{ color: "#15251E", fontSize: 18, fontWeight: "900", marginTop: 8 }}>{providerOfferReview?.title}</Text>
          <Text style={{ color: "#176B55", fontSize: 13, fontWeight: "800", marginTop: 5 }}>{providerOfferReview?.skillCategory}</Text>
          <Text style={{ color: "#66756D", fontSize: 12, marginTop: 12 }}>Sent to {providerOfferReview?.seekerName}</Text>
          <View style={{ backgroundColor: "#F1F6F2", borderRadius: 11, padding: 12, marginTop: 15 }}>
            <Text style={{ color: "#176B55", fontSize: 12, fontWeight: "900" }}>{providerOfferReview?.status === "SELECTED" ? "SELECTED BY SEEKER" : providerOfferReview?.status === "WITHDRAWN" || providerOfferReview?.status === "DECLINED" ? "NOT SELECTED" : "AWAITING SEEKER REVIEW"}</Text>
            <Text style={{ color: "#53645A", fontSize: 12, lineHeight: 18, marginTop: 5 }}>{providerOfferReview?.status === "OFFERED" ? "AnySkill will update this screen when the Seeker makes a decision. Keep your app available for updates." : providerOfferReview?.status === "SELECTED" ? "Onsite service: confirm that you are coming to start live location sharing. Remote service: continue directly to your workspace." : "This offer has been closed. You can still respond to other matched requests."}</Text>
          </View>
        </View>
        {providerOfferReview?.status === "SELECTED" ? (() => {
          const selectedJob = myJobs.find((job) => job.request.id === providerOfferReview.requestId && job.responseId === providerOfferReview.responseId);
          const isOnsite = Boolean(selectedJob && selectedJob.request.deliveryMode !== "REMOTE" && selectedJob.request.latitude != null && selectedJob.request.longitude != null);
          return <Pressable
            onPress={() => {
              if (!selectedJob) return;
              if (isOnsite) {
                void (async () => {
                  const started = await markProviderEnRoute(selectedJob.request.id);
                  if (started) setProviderOfferReview(null);
                })();
              } else {
                setProviderOfferReview(null);
              }
            }}
            disabled={jobActionBusy || !selectedJob}
            style={{ backgroundColor: "#176B55", borderRadius: 14, minHeight: 56, alignItems: "center", justifyContent: "center", marginTop: 18, opacity: jobActionBusy || !selectedJob ? 0.55 : 1 }}>
            {jobActionBusy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>{isOnsite ? "I'm coming" : "Continue to service workspace"}</Text>}
          </Pressable>;
        })() : null}
        {providerOfferReview?.status === "OFFERED" ? <Pressable onPress={() => void withdrawProviderOffer()} disabled={jobActionBusy} style={{ borderWidth: 1, borderColor: "#E7B8B4", borderRadius: 14, minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: 18, backgroundColor: "#FFF8F7", opacity: jobActionBusy ? 0.55 : 1 }}>
          {jobActionBusy ? <ActivityIndicator color="#B42318" /> : <Text style={{ color: "#B42318", fontWeight: "900" }}>Withdraw my offer</Text>}
        </Pressable> : null}
        <Pressable onPress={() => { if (providerOfferReview) setDismissedProviderOfferIds((ids) => [...ids, providerOfferReview.responseId]); setProviderOfferReview(null); }} style={{ borderWidth: 1, borderColor: "#D5E1D9", borderRadius: 14, minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: 22, backgroundColor: "#FFFFFF" }}>
          <Text style={{ color: "#176B55", fontWeight: "900" }}>Back to Provider Activities</Text>
        </Pressable>
      </View>
    </Modal>
    <Modal visible={p.mode === "provider" && activeProviderJobId !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => { if (activeProviderJobId) setDismissedActiveJobIds((ids) => [...ids, activeProviderJobId]); setActiveProviderJobId(null); p.onBack(); }}>
      {(() => {
        const job = myJobs.find((item) => item.request.id === activeProviderJobId);
        if (!job) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F5F7F5" }}><ActivityIndicator color="#176B55" /><Text style={{ color: "#66756D", marginTop: 12 }}>Loading your accepted service...</Text></View>;
        const seekerName = [job.seeker?.firstName, job.seeker?.lastName].filter(Boolean).join(" ") || "Skill Seeker";
        const destinationReady = job.request.latitude != null && job.request.longitude != null;
        return <View style={{ flex: 1, backgroundColor: "#F5F7F5" }}>
          {p.platformHeader}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 12, paddingBottom: insets.bottom + 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View><Text style={{ color: "#176B55", fontSize: 11, fontWeight: "900", letterSpacing: 1.1 }}>SERVICE WORKSPACE</Text><Text style={{ color: "#15251E", fontSize: 25, fontWeight: "900", marginTop: 5 }}>{job.status === "ASSESSMENT_PENDING" ? "Assessment required" : job.status === "ESTIMATE_SUBMITTED" ? "Estimate awaiting review" : job.status === "ESTIMATE_REJECTED" ? "Estimate revision required" : job.status === "ESTIMATE_APPROVED" ? "Ready to start work" : job.status === "IN_PROGRESS" ? "Service in progress" : job.status === "COMPLETION_PENDING" ? "Completion awaiting review" : job.status === "COMPLETED" ? "Service completed" : job.status === "CANCELLED" ? "Service cancelled" : "Selected service"}</Text></View>
            <Pressable onPress={() => { setDismissedActiveJobIds((ids) => [...ids, job.request.id]); setActiveProviderJobId(null); }}><Text style={{ color: "#176B55", fontWeight: "800" }}>Back to Activities</Text></Pressable>
          </View>
          <View style={{ backgroundColor: "#FFFFFF", borderRadius: 18, borderWidth: 1, borderColor: "#DCE7DF", padding: 16, marginTop: 18 }}>
            <Text style={{ color: "#829087", fontSize: 10, fontWeight: "900" }}>SERVICE REQUEST</Text>
            <Text style={{ color: "#15251E", fontSize: 19, fontWeight: "900", marginTop: 6 }}>{job.request.title}</Text>
            <Text style={{ color: "#53645A", fontSize: 13, lineHeight: 20, marginTop: 10 }}>{job.request.description}</Text>
            {["ASSESSMENT_PENDING","ESTIMATE_SUBMITTED","ESTIMATE_REJECTED","ESTIMATE_APPROVED"].includes(job.status) ? <View style={{ backgroundColor: "#EAF4EE", borderRadius: 14, padding: 13, marginTop: 13 }}>
              <Text style={{ color: "#176B55", fontSize: 10, fontWeight: "900" }}>ASSESSMENT & APPROVAL</Text>
              <Text style={{ color: "#15251E", fontSize: 14, fontWeight: "900", marginTop: 5 }}>{job.status === "ASSESSMENT_PENDING" ? (job.assessmentCompletedAt ? "Assessment done · submit final estimate" : job.assessmentStartedAt ? "Assessment in progress" : job.providerArrivedAt && !job.seekerArrivalConfirmedAt ? "Waiting for Seeker to confirm arrival" : "Waiting to start assessment") : job.status === "ESTIMATE_SUBMITTED" ? "Estimate sent to the Seeker" : job.status === "ESTIMATE_REJECTED" ? "Revise the estimate" : "Seeker approved the estimate"}</Text>
              <Text style={{ color: "#40584B", fontSize: 11, lineHeight: 17, marginTop: 4 }}>{job.status === "ASSESSMENT_PENDING" ? (job.assessmentCompletedAt ? "Assessment is complete. Submit the final hours and price for the Seeker to approve before work starts." : job.assessmentStartedAt ? "You are assessing the requested work. Mark Assessment Done when finished." : job.providerArrivedAt && !job.seekerArrivalConfirmedAt ? "The Provider has reported arrival. Wait for the Seeker to confirm before starting the assessment." : "The Seeker must confirm your arrival before you can start the assessment.") : job.status === "ESTIMATE_SUBMITTED" ? "Wait for the Seeker's decision. Main work remains locked until approval." : job.status === "ESTIMATE_REJECTED" ? "Review the Seeker's feedback and submit a revised estimate." : "You may start only the work covered by the approved estimate."}</Text>
              {(job.status === "ASSESSMENT_PENDING" && !!job.assessmentStartedAt) || job.status === "ESTIMATE_REJECTED" ? <>
                <Text style={{ color: "#15251E", fontSize: 12, fontWeight: "800", marginTop: 12 }}>Estimated work hours</Text>
                <TextInput value={estimateHours} onChangeText={setEstimateHours} keyboardType="decimal-pad" placeholder="e.g. 2" style={{ backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DCE7DF", borderRadius: 11, minHeight: 48, paddingHorizontal: 12, color: "#15251E", marginTop: 6 }} />
                <Text style={{ color: "#66756D", fontSize: 11, marginTop: 6 }}>Estimated labour total: R {Number(estimateHours) > 0 && Number.isFinite(Number(estimateHours)) ? (Number(estimateHours) * Number(job.hourlyRate)).toFixed(2) : "—"} at R {Number(job.hourlyRate).toFixed(2)} per hour</Text>
                <Text style={{ color: "#15251E", fontSize: 12, fontWeight: "800", marginTop: 12 }}>Assessment findings and work required</Text>
                <TextInput value={estimateNotes} onChangeText={setEstimateNotes} placeholder="Describe what you found, the work required, materials or parts needed, and any assumptions..." multiline style={{ backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DCE7DF", borderRadius: 11, minHeight: 110, padding: 12, color: "#15251E", textAlignVertical: "top", marginTop: 6 }} />
                {job.status === "ASSESSMENT_PENDING" && !!job.assessmentStartedAt && !job.assessmentCompletedAt ? <Text style={{ color: assessmentDraftSaveStatus.startsWith("Save failed") ? "#B42318" : "#66756D", fontSize: 11, marginTop: 7 }}>Assessment draft: {assessmentDraftSaveStatus}. Hours and notes save automatically and are restored when you reopen the app.</Text> : null}
                {job.status === "ASSESSMENT_PENDING" && !job.assessmentCompletedAt ? <Text style={{ color: "#66756D", fontSize: 11, lineHeight: 17, marginTop: 8 }}>Record your findings and estimated hours while assessing. When you are finished, tap Assessment Done below; you can then submit the estimate for the Seeker's approval.</Text> : <Pressable onPress={() => void submitEstimate(job.request.id)} disabled={jobActionBusy || !(Number(estimateHours) > 0) || !Number.isFinite(Number(estimateHours)) || estimateNotes.trim().length < 10} style={{ backgroundColor: "#176B55", opacity: jobActionBusy || !(Number(estimateHours) > 0) || !Number.isFinite(Number(estimateHours)) || estimateNotes.trim().length < 10 ? 0.45 : 1, borderRadius: 12, minHeight: 50, alignItems: "center", justifyContent: "center", marginTop: 10 }}><Text style={{ color: "#FFFFFF", fontWeight: "900" }}>{jobActionBusy ? "Submitting..." : "Submit assessment estimate"}</Text></Pressable>}
              </> : null}
              {job.status === "ESTIMATE_SUBMITTED" ? <Text style={{ color: "#66756D", fontSize: 11, lineHeight: 17, marginTop: 9 }}>Awaiting Seeker approval: labour R {Number(job.estimatedTotal ?? 0).toFixed(2)} ({job.estimatedHours == null ? "—" : Number(job.estimatedHours).toFixed(2)} hours × agreed R {Number(job.hourlyRate).toFixed(2)}/hour) + agreed assessment fee R {Number(job.assessmentFee).toFixed(2)} = final price R {(Number(job.estimatedTotal ?? 0) + Number(job.assessmentFee ?? 0)).toFixed(2)}</Text> : null}
              {job.estimateDecisionNote ? <Text style={{ color: "#66756D", fontSize: 11, lineHeight: 17, marginTop: 8 }}>Seeker feedback: {job.estimateDecisionNote}</Text> : null}
            </View> : null}
            {job.request.instructions ? <Text style={{ color: "#53645A", fontSize: 12, lineHeight: 18, marginTop: 9 }}>Instructions: {job.request.instructions}</Text> : null}
            <Text style={{ color: "#66756D", fontSize: 12, marginTop: 12 }}>Agreed rate: R {Number(job.hourlyRate).toFixed(2)} / hour · Assessment fee: R {Number(job.assessmentFee).toFixed(2)}</Text>
            {job.status === "ESTIMATE_APPROVED" ? <Pressable onPress={() => void startWork(job.request.id)} disabled={jobActionBusy} style={{ backgroundColor: "#176B55", borderRadius: 14, minHeight: 54, alignItems: "center", justifyContent: "center", marginTop: 16, opacity: jobActionBusy ? 0.55 : 1 }}><Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 15 }}>{jobActionBusy ? "Starting work..." : "Start work"}</Text></Pressable> : null}
            {job.status === "IN_PROGRESS" ? <>
              <View style={{ backgroundColor: "#EAF4EE", borderRadius: 14, padding: 13, marginTop: 14 }}>
                <Text style={{ color: "#176B55", fontWeight: "900", letterSpacing: 0.8 }}>SERVICE IN PROGRESS</Text>
                <Text style={{ color: "#40584B", fontSize: 12, lineHeight: 18, marginTop: 5 }}>The service is underway. Your work timer is running and the Seeker can see this live status.</Text>
              </View>
              <Text style={{ color: "#53645A", fontSize: 12, lineHeight: 18, marginTop: 14 }}>When the agreed work is finished, submit completion notes. Photos are optional, but you can capture or upload up to 8 photos if useful. The Seeker must approve before payment can be recorded.</Text>
              <Text style={{ color: "#15251E", fontSize: 12, fontWeight: "800", marginTop: 12 }}>Completion notes</Text>
              <TextInput value={completionNotes} onChangeText={setCompletionNotes} placeholder="Summarise the work completed, tests performed and any handover details..." multiline style={{ backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DCE7DF", borderRadius: 11, minHeight: 100, padding: 12, color: "#15251E", textAlignVertical: "top", marginTop: 6 }} />
              <Text style={{ color: "#15251E", fontSize: 12, fontWeight: "800", marginTop: 12 }}>Photo evidence (optional · up to 8)</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 7 }}>
                <Pressable onPress={() => void pickCompletionEvidence("camera")} disabled={uploadingEvidence || jobActionBusy} style={{ flex: 1, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#176B55", borderRadius: 12, minHeight: 48, alignItems: "center", justifyContent: "center", opacity: uploadingEvidence || jobActionBusy ? 0.55 : 1 }}>
                  <Text style={{ color: "#176B55", fontWeight: "900" }}>Capture photo</Text>
                </Pressable>
                <Pressable onPress={() => void pickCompletionEvidence("library")} disabled={uploadingEvidence || jobActionBusy} style={{ flex: 1, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#176B55", borderRadius: 12, minHeight: 48, alignItems: "center", justifyContent: "center", opacity: uploadingEvidence || jobActionBusy ? 0.55 : 1 }}>
                  <Text style={{ color: "#176B55", fontWeight: "900" }}>{uploadingEvidence ? "Uploading..." : "Upload photos"}</Text>
                </Pressable>
              </View>
              {completionEvidenceAssets.map((asset) => <Text key={asset.id} style={{ color: "#53645A", fontSize: 11, marginTop: 6 }}>✓ {asset.name} · {(asset.sizeBytes / 1024 / 1024).toFixed(1)} MB</Text>)}
              {error ? <Text accessibilityRole="alert" style={{ color: "#B42318", backgroundColor: "#FEF3F2", borderRadius: 10, padding: 11, fontSize: 12, lineHeight: 18, marginTop: 10 }}>{error}</Text> : null}
              {notice ? <Text style={{ color: "#176B55", backgroundColor: "#EAF4EE", borderRadius: 10, padding: 11, fontSize: 12, lineHeight: 18, marginTop: 10 }}>{notice}</Text> : null}
              <Pressable onPress={() => void submitCompletion(job.request.id)} disabled={jobActionBusy || uploadingEvidence || completionNotes.trim().length < 20} style={{ backgroundColor: "#176B55", borderRadius: 14, minHeight: 54, alignItems: "center", justifyContent: "center", marginTop: 13, opacity: jobActionBusy || uploadingEvidence || completionNotes.trim().length < 20 ? 0.45 : 1 }}>
                <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 15 }}>{jobActionBusy ? "Submitting..." : "Work completed · Submit for review"}</Text>
              </Pressable>
            </> : null}
            {job.status === "COMPLETION_PENDING" ? <View style={{ backgroundColor: "#FFF8E8", borderRadius: 14, padding: 13, marginTop: 14 }}><Text style={{ color: "#8A5A12", fontWeight: "900" }}>Completion submitted · Awaiting Seeker approval</Text></View> : null}
          </View>
          <View style={{ backgroundColor: "#FFFFFF", borderRadius: 18, borderWidth: 1, borderColor: "#DCE7DF", padding: 16, marginTop: 14 }}>
            <Text style={{ color: "#829087", fontSize: 10, fontWeight: "900" }}>SKILL SEEKER</Text>
            <Text style={{ color: "#15251E", fontSize: 20, fontWeight: "900", marginTop: 7 }}>{seekerName}</Text>
            <Text style={{ color: job.seeker?.identityVerified ? "#176B55" : "#8A6A27", fontSize: 12, fontWeight: "800", marginTop: 4 }}>{job.seeker?.identityVerified ? "✓ Identity verified" : "Identity not verified"}</Text>

          </View>
          <View style={{ backgroundColor: "#FFFFFF", borderRadius: 18, borderWidth: 1, borderColor: "#DCE7DF", padding: 16, marginTop: 14 }}>
            <Text style={{ color: "#829087", fontSize: 10, fontWeight: "900" }}>ROUTE TO SERVICE LOCATION</Text>
            <Text style={{ color: "#15251E", fontSize: 15, fontWeight: "800", marginTop: 7 }}>{job.request.location || "Pinned service destination"}</Text>
            {destinationReady && (!job.seekerArrivalConfirmedAt || job.status === "COMPLETED") ? <>
              <View style={{ marginTop: 12, borderRadius: 14, overflow: "hidden" }}>
                <MapPinPicker latitude={job.request.latitude!} longitude={job.request.longitude!} selectedLatitude={job.request.latitude} selectedLongitude={job.request.longitude} onSelect={() => undefined} readOnly {...(providerRoute?.requestId === job.request.id ? { routeCoordinates: providerRoute.coordinates } : {})} liveLatitude={providerRoute?.requestId === job.request.id ? providerRoute.origin.latitude : null} liveLongitude={providerRoute?.requestId === job.request.id ? providerRoute.origin.longitude : null} />
              </View>
              <Text style={{ color: "#66756D", fontSize: 11, lineHeight: 17 }}>{providerRouteLoading ? "Calculating the full driving route from your current location..." : providerRoute?.requestId === job.request.id ? "The green line shows the full driving route from your current location to the Seeker's destination." : "The destination is pinned. The full route will appear when directions are available."}</Text>
            </> : job.seekerArrivalConfirmedAt && job.status !== "COMPLETED" ? <Text style={{ color: "#66756D", fontSize: 11, lineHeight: 17, marginTop: 12 }}>Arrival confirmed. The map is hidden during assessment and service work.</Text> : <Text style={{ color: "#66756D", fontSize: 12, lineHeight: 19, marginTop: 10 }}>This is a remote service or has no pinned physical destination. Navigation is not required.</Text>}
            {destinationReady && job.status === "ASSESSMENT_PENDING" && !job.providerEnRouteAt ? <Pressable onPress={() => void markProviderEnRoute(job.request.id)} disabled={jobActionBusy} style={{ backgroundColor: "#176B55", borderRadius: 14, minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: 13, opacity: jobActionBusy ? 0.55 : 1 }}><Text style={{ color: "#FFFFFF", fontWeight: "900" }}>{jobActionBusy ? "Updating..." : "I'm coming"}</Text></Pressable> : null}
            {destinationReady && job.providerEnRouteAt && !job.providerArrivedAt ? <View style={{ flexDirection: "row", gap: 10, marginTop: 13 }}>
              <Pressable onPress={() => void openProviderNavigation(job.request.id, job.request.latitude!, job.request.longitude!)} disabled={jobActionBusy} style={{ flex: 1, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#176B55", borderRadius: 14, minHeight: 52, alignItems: "center", justifyContent: "center", opacity: jobActionBusy ? 0.55 : 1 }}><Text style={{ color: "#176B55", fontWeight: "900" }}>Navigate</Text></Pressable>
              <Pressable onPress={() => void markProviderArrived(job.request.id)} disabled={jobActionBusy} style={{ flex: 1, backgroundColor: "#176B55", borderRadius: 14, minHeight: 52, alignItems: "center", justifyContent: "center", opacity: jobActionBusy ? 0.55 : 1 }}><Text style={{ color: "#FFFFFF", fontWeight: "900" }}>{jobActionBusy ? "Updating..." : "I've Arrived"}</Text></Pressable>
            </View> : null}
            {job.providerArrivedAt && !job.seekerArrivalConfirmedAt ? <View style={{ backgroundColor: "#FFF6E4", borderRadius: 12, padding: 12, marginTop: 13 }}><Text style={{ color: "#78551A", fontSize: 12, fontWeight: "800" }}>Waiting for Seeker to confirm arrival</Text><Text style={{ color: "#78551A", fontSize: 11, lineHeight: 17, marginTop: 4 }}>The Seeker must confirm before you can start the assessment.</Text></View> : null}
            {job.providerArrivedAt && job.seekerArrivalConfirmedAt && !job.assessmentStartedAt ? <Pressable onPress={() => void updateAssessmentStage(job.request.id, "start")} disabled={jobActionBusy} style={{ backgroundColor: "#176B55", borderRadius: 14, minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: 13, opacity: jobActionBusy ? 0.55 : 1 }}><Text style={{ color: "#FFFFFF", fontWeight: "900" }}>{jobActionBusy ? "Updating..." : "Start assessing"}</Text></Pressable> : null}
            {job.assessmentStartedAt && !job.assessmentCompletedAt ? <Pressable onPress={() => void updateAssessmentStage(job.request.id, "complete")} disabled={jobActionBusy} style={{ backgroundColor: "#176B55", borderRadius: 14, minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: 13, opacity: jobActionBusy ? 0.55 : 1 }}><Text style={{ color: "#FFFFFF", fontWeight: "900" }}>{jobActionBusy ? "Updating..." : "Assessment Done"}</Text></Pressable> : null}
            {job.assessmentCompletedAt ? <View style={{ backgroundColor: "#EAF4EE", borderRadius: 14, minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: 13 }}><Text style={{ color: "#176B55", fontWeight: "900" }}>✓ Assessment Done</Text></View> : null}
          </View>
          <Pressable onPress={() => setContactDrawerOpen(true)} style={{ backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DCE7DF", borderRadius: 14, minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: 14 }}>
            <Text style={{ color: "#176B55", fontWeight: "900" }}>Open service chat</Text>
          </Pressable>
          {["ASSESSMENT_PENDING", "ESTIMATE_SUBMITTED", "ESTIMATE_REJECTED", "ESTIMATE_APPROVED", "IN_PROGRESS", "COMPLETION_PENDING", "DISPUTED"].includes(job.status) ? <Pressable onPress={() => cancelProviderJob(job.request.id, job.request.title)} style={{ backgroundColor: "#FFF7F7", borderWidth: 1, borderColor: "#E7B8B8", borderRadius: 14, minHeight: 50, alignItems: "center", justifyContent: "center", marginTop: 16 }}><Text style={{ color: "#B42318", fontWeight: "900" }}>Cancel service</Text></Pressable> : null}
          <Pressable onPress={() => { setDismissedActiveJobIds((ids) => [...ids, job.request.id]); setActiveProviderJobId(null); }} style={{ backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DCE7DF", borderRadius: 14, minHeight: 50, alignItems: "center", justifyContent: "center", marginTop: 16 }}><Text style={{ color: "#176B55", fontWeight: "900" }}>Back to Activities</Text></Pressable>
          </ScrollView>
        </View>;
      })()}
    </Modal>
    <Modal visible={journeyScreen !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setJourneyScreen(null)}>
      <View style={{ flex: 1, backgroundColor: "#F4F7F5", paddingTop: insets.top, paddingBottom: insets.bottom }}>
        {p.platformHeader}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 }}>
          <View>
            <Text style={{ color: "#718078", fontSize: 10, fontWeight: "900", letterSpacing: 1.5 }}>YOUR SERVICE</Text>
            <Text style={{ color: "#172820", fontSize: 14, fontWeight: "800", marginTop: 3 }}>Request tracking</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close service tracking" onPress={() => setJourneyScreen(null)} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: "#E8EEEA", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#34483D", fontSize: 20, fontWeight: "700" }}>×</Text>
          </Pressable>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
          <View style={{ backgroundColor: "#123F32", borderRadius: 24, padding: 21, marginTop: 5, overflow: "hidden" }}>
            <View style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.13)", borderRadius: 30, paddingHorizontal: 11, paddingVertical: 7 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#9DE0B8", marginRight: 8 }} />
              <Text style={{ color: "#D9F2E3", fontSize: 10, fontWeight: "900", letterSpacing: 1.2 }}>{journeyScreen?.engagementStatus === "IN_PROGRESS" ? "SERVICE IN PROGRESS" : journeyScreen?.engagementStatus === "COMPLETION_PENDING" ? "AWAITING YOUR REVIEW" : journeyScreen?.engagementStatus === "ESTIMATE_SUBMITTED" ? "ACTION REQUIRED" : journeyScreen?.engagementStatus === "ESTIMATE_APPROVED" ? "ESTIMATE APPROVED" : journeyScreen?.assessmentCompletedAt ? "ASSESSMENT COMPLETE" : journeyScreen?.assessmentStartedAt ? "ASSESSMENT UNDERWAY" : journeyScreen?.providerArrivedAt ? "PROVIDER ARRIVED" : journeyScreen?.providerEnRouteAt ? "PROVIDER ON THE WAY" : "PROVIDER SELECTED"}</Text>
            </View>
            <Text style={{ color: "#FFFFFF", fontSize: 29, lineHeight: 35, fontWeight: "900", letterSpacing: -0.8, marginTop: 19 }}>
              {journeyScreen?.engagementStatus === "IN_PROGRESS" ? "Your service is underway" : journeyScreen?.engagementStatus === "COMPLETION_PENDING" ? "Review the completed work" : journeyScreen?.engagementStatus === "ESTIMATE_SUBMITTED" ? "Your estimate is ready" : journeyScreen?.engagementStatus === "ESTIMATE_REJECTED" ? "Estimate needs attention" : journeyScreen?.engagementStatus === "ESTIMATE_APPROVED" ? "You're ready to go" : journeyScreen?.assessmentCompletedAt ? "Assessment completed" : journeyScreen?.assessmentStartedAt ? "Your assessment is underway" : journeyScreen?.providerArrivedAt ? "Your Provider has arrived" : journeyScreen?.providerEnRouteAt ? "Your Provider is on the way" : "Waiting for service provider"}
            </Text>
            <Text style={{ color: "#D5E7DC", fontSize: 13, lineHeight: 21, marginTop: 9 }}>
              {journeyScreen?.engagementStatus === "IN_PROGRESS" ? "The Provider has started the work covered by your approved estimate." : journeyScreen?.engagementStatus === "COMPLETION_PENDING" ? "Your Provider has submitted the service for review. Check the notes and evidence below." : journeyScreen?.engagementStatus === "ESTIMATE_SUBMITTED" ? "Review the assessment and final price below. The Provider can only begin the main work after you approve it." : journeyScreen?.engagementStatus === "ESTIMATE_REJECTED" ? "The Provider needs to review your feedback and submit a revised estimate." : journeyScreen?.engagementStatus === "ESTIMATE_APPROVED" ? "The final estimate is approved. The Provider can now begin the agreed work." : journeyScreen?.assessmentCompletedAt ? "Your Provider has finished assessing the work and is preparing the final estimate." : journeyScreen?.assessmentStartedAt ? "Your Provider is assessing the work. The final estimate will appear here when it is submitted." : journeyScreen?.providerArrivedAt ? "Your Provider is at the service location and can begin the assessment." : journeyScreen?.providerEnRouteAt ? "Your Provider is travelling to you. We'll keep this screen updated as the service progresses." : "The assessment has not started yet. We'll let you know when your Provider is on the way."}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 22, paddingTop: 16, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.18)" }}>
              <Text style={{ color: "#BFE3CC", fontSize: 11, fontWeight: "800" }}>ANY SKILL SERVICE</Text>
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: "#82B99A", marginHorizontal: 9 }} />
              <Text style={{ color: "#BFE3CC", fontSize: 11 }}>Updates appear here</Text>
            </View>
          </View>

          {journeyScreen?.engagementStatus === "ESTIMATE_SUBMITTED" ? <View style={{ backgroundColor: "#F1F8F3", borderRadius: 18, borderWidth: 2, borderColor: "#75B88F", padding: 17, marginTop: 14 }}>
            <Text style={{ color: "#176B55", fontSize: 11, fontWeight: "900", letterSpacing: 1 }}>ACTION REQUIRED · APPROVE FINAL PRICE</Text>
            <Text style={{ color: "#172820", fontSize: 27, fontWeight: "900", marginTop: 7 }}>R {(Number(journeyScreen.estimatedTotal ?? 0) + Number(journeyScreen.assessmentFee ?? 0)).toFixed(2)}</Text>
            <Text style={{ color: "#40584B", fontSize: 12, lineHeight: 18, marginTop: 5 }}>Your Provider has submitted the assessed hours and final price. Review the full breakdown below, then approve to allow the main work to begin.</Text>
            <Primary label={jobActionBusy ? "Processing approval..." : "Approve final estimate"} onPress={() => void decideEstimate(journeyScreen.requestId, true)} disabled={jobActionBusy} />
          </View> : null}

          <View style={{ backgroundColor: "#FFFFFF", borderRadius: 20, padding: 17, marginTop: 14, borderWidth: 1, borderColor: "#E2EAE5" }}>
            <Text style={{ color: "#7B8981", fontSize: 10, fontWeight: "900", letterSpacing: 1.2 }}>YOUR SELECTED PROVIDER</Text>
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14 }}>
              <View style={{ width: 54, height: 54, borderRadius: 18, backgroundColor: "#E5F1E9", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#176B55", fontSize: 21, fontWeight: "900" }}>{(journeyScreen?.providerName ?? "P").trim().split(/\s+/).slice(0,2).map((part) => part[0]?.toUpperCase()).join("")}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 13 }}>
                <Text style={{ color: "#172820", fontSize: 18, fontWeight: "900" }}>{journeyScreen?.providerName ?? "Your selected Provider"}</Text>
                <Text style={{ color: "#66756D", fontSize: 12, marginTop: 4 }}>{journeyScreen?.providerSkills?.join(" · ") || "Your selected skill Provider"}</Text>
                <Text style={{ color: "#176B55", fontSize: 10, fontWeight: "900", marginTop: 7 }}>✓ SELECTED BY YOU</Text>
              </View>
            </View>
            <Pressable onPress={() => setContactDrawerOpen(true)} style={{ backgroundColor: "#EDF5F0", borderRadius: 13, minHeight: 47, alignItems: "center", justifyContent: "center", marginTop: 16 }}>
              <Text style={{ color: "#176B55", fontWeight: "900", fontSize: 13 }}>Message your Provider</Text>
            </Pressable>
          </View>

          <View style={{ backgroundColor: "#FFFFFF", borderRadius: 20, padding: 17, marginTop: 14, borderWidth: 1, borderColor: "#E2EAE5" }}>
            <Text style={{ color: "#7B8981", fontSize: 10, fontWeight: "900", letterSpacing: 1.2 }}>SERVICE PROGRESS</Text>
            {(() => {
              const status = journeyScreen?.engagementStatus ?? "";
              const workStarted = ["IN_PROGRESS", "COMPLETION_PENDING", "COMPLETED"].includes(status);
              const workCompleted = status === "COMPLETED";
              const estimateApproved = ["ESTIMATE_APPROVED", "IN_PROGRESS", "COMPLETION_PENDING", "COMPLETED"].includes(status);
              const estimateStage = !!journeyScreen?.assessmentCompletedAt || ["ESTIMATE_SUBMITTED", "ESTIMATE_REJECTED"].includes(status);
              const assessmentStage = !!journeyScreen?.providerArrivedAt || !!journeyScreen?.assessmentStartedAt;
              const activeIndex = workStarted || estimateApproved ? 4 : estimateStage ? 3 : assessmentStage ? 2 : 1;
              const steps = [
                { title: "Provider selected · hourly rate agreed", detail: journeyScreen?.hourlyRate == null ? "You selected the Provider. Their hourly rate is saved for the assessment-based estimate." : `You accepted R ${journeyScreen.hourlyRate.toFixed(2)} per hour. This approves the rate for assessment pricing only, not the total job cost.`, done: true },
                { title: "Provider travelling", detail: journeyScreen?.providerArrivedAt ? "Provider has arrived" : journeyScreen?.providerEnRouteAt ? "Provider is on the way" : "We'll notify you when they're on the way", done: !!journeyScreen?.providerArrivedAt },
                { title: "Assessment", detail: journeyScreen?.assessmentCompletedAt ? "Assessment completed" : journeyScreen?.assessmentStartedAt ? "Assessment in progress" : journeyScreen?.providerArrivedAt ? journeyScreen.seekerArrivalConfirmedAt ? "Arrival confirmed · assessment can begin" : "Waiting for you to confirm Provider arrival" : "Starts after the Provider arrives", done: !!journeyScreen?.assessmentCompletedAt },
                { title: "Assessed hours & final price", detail: status === "ESTIMATE_SUBMITTED" ? "Review the assessed hours and total calculated at your agreed hourly rate. Approve before main work begins." : status === "ESTIMATE_REJECTED" ? "Provider is revising the estimated hours and total for your approval" : estimateApproved ? "You approved the assessed hours and final job price" : "After assessment, the Provider calculates the required hours and submits the total for your approval", done: estimateApproved },
                { title: "Main work", detail: status === "IN_PROGRESS" ? "Work is in progress" : status === "COMPLETION_PENDING" ? "Work submitted for your review" : status === "COMPLETED" ? "Work completed" : "Only begins after you approve the estimate", done: workCompleted },
              ];
              return steps.map((step, index) => {
                const active = index === activeIndex && !step.done;
                return <View key={step.title} style={{ flexDirection: "row", minHeight: index === steps.length - 1 ? 42 : 66, backgroundColor: active ? "#F0F8F3" : "transparent", borderRadius: 12, borderWidth: active ? 1 : 0, borderColor: active ? "#8BC6A1" : "transparent", paddingHorizontal: active ? 8 : 0, paddingTop: active ? 8 : 0, marginBottom: active ? 5 : 0 }}>
                  <View style={{ width: 27, alignItems: "center" }}>
                    <View style={{ width: 25, height: 25, borderRadius: 13, backgroundColor: step.done ? "#176B55" : active ? "#176B55" : "#EEF2EF", borderWidth: active ? 2 : step.done ? 0 : 1, borderColor: active ? "#A9D9B9" : "#D9E2DC", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: step.done || active ? "#FFFFFF" : "#7B8981", fontSize: 11, fontWeight: "900" }}>{step.done ? "✓" : String(index + 1)}</Text>
                    </View>
                    {index < steps.length - 1 ? <View style={{ width: 2, flex: 1, minHeight: 28, backgroundColor: step.done ? "#A7D3B8" : "#E5EBE7" }} /> : null}
                  </View>
                  <View style={{ flex: 1, paddingLeft: 11, paddingBottom: 12 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <Text style={{ color: step.done ? "#176B55" : active ? "#14563F" : "#26372E", fontSize: 13, fontWeight: "900", flexShrink: 1 }}>{step.title}</Text>
                      {step.done ? <Text style={{ color: "#176B55", fontSize: 9, fontWeight: "900", letterSpacing: 0.7 }}>COMPLETED</Text> : active ? <Text style={{ color: "#176B55", backgroundColor: "#D9F0E1", overflow: "hidden", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, fontSize: 9, fontWeight: "900", letterSpacing: 0.6 }}>CURRENT STEP</Text> : <Text style={{ color: "#9AA59E", fontSize: 9, fontWeight: "800", letterSpacing: 0.6 }}>UP NEXT</Text>}
                    </View>
                    <Text style={{ color: active ? "#40584B" : "#748179", fontSize: 11, lineHeight: 16, marginTop: 3 }}>{step.detail}</Text>
                  </View>
                </View>;
              });
            })()}
          </View>

          {journeyScreen?.engagementStatus === "COMPLETED" && journeyScreen.latitude != null && journeyScreen.longitude != null ? <View style={{ backgroundColor: "#FFFFFF", borderRadius: 18, borderWidth: 1, borderColor: "#DCE7DF", padding: 16, marginTop: 14 }}>
            <Text style={{ color: "#176B55", fontSize: 10, fontWeight: "900", letterSpacing: 1.1 }}>COMPLETED SERVICE LOCATION</Text>
            <View style={{ marginTop: 12, borderRadius: 14, overflow: "hidden" }}>
              <MapPinPicker latitude={journeyScreen.latitude} longitude={journeyScreen.longitude} selectedLatitude={journeyScreen.latitude} selectedLongitude={journeyScreen.longitude} onSelect={() => undefined} readOnly showCenterMarker={journeyScreen.liveLatitude != null && journeyScreen.liveLongitude != null} liveLatitude={journeyScreen.liveLatitude} liveLongitude={journeyScreen.liveLongitude} />
            </View>
          </View> : null}

          <View style={{ backgroundColor: "#FFFFFF", borderRadius: 20, padding: 17, marginTop: 14, borderWidth: 1, borderColor: "#E2EAE5" }}>
            <Text style={{ color: "#7B8981", fontSize: 10, fontWeight: "900", letterSpacing: 1.2 }}>ASSESSMENT / CALL-OUT FEE</Text>
            <Text style={{ color: "#172820", fontSize: 24, fontWeight: "900", marginTop: 9 }}>{journeyScreen?.assessmentFee == null ? "Not available" : journeyScreen.assessmentFee === 0 ? "No fee" : "R " + journeyScreen.assessmentFee.toFixed(2)}</Text>
          </View>

          {journeyScreen?.providerArrivedAt && !journeyScreen.seekerArrivalConfirmedAt ? <View style={{ backgroundColor: "#EAF4EE", borderRadius: 16, padding: 15, marginTop: 14 }}>
            <Primary label={jobActionBusy ? "Confirming..." : "Confirm Provider Arrival"} onPress={() => void confirmProviderArrival(journeyScreen.requestId)} disabled={jobActionBusy} />
          </View> : null}

          {journeyScreen?.engagementStatus === "ESTIMATE_SUBMITTED" ? <View style={{ backgroundColor: "#F1F8F3", borderRadius: 20, borderWidth: 1, borderColor: "#B9DCC8", padding: 17, marginTop: 14 }}>
            <Text style={{ color: "#176B55", fontSize: 10, fontWeight: "900", letterSpacing: 1.1 }}>YOUR APPROVAL IS REQUIRED</Text>
            <Text style={{ color: "#172820", fontSize: 24, fontWeight: "900", marginTop: 8 }}>R {(Number(journeyScreen.estimatedTotal ?? 0) + Number(journeyScreen.assessmentFee ?? 0)).toFixed(2)}</Text>
            <Text style={{ color: "#66756D", fontSize: 11, marginTop: 4 }}>Final assessed price</Text>
            <View style={{ height: 1, backgroundColor: "#DCEAE0", marginVertical: 13 }} />
            <Text style={{ color: "#40584B", fontSize: 12, lineHeight: 19 }}>Estimated labour: {journeyScreen.estimatedHours == null ? "—" : journeyScreen.estimatedHours.toFixed(2) + " hours"} × agreed hourly rate R {Number(journeyScreen.hourlyRate ?? 0).toFixed(2)} = R {Number(journeyScreen.estimatedTotal ?? 0).toFixed(2)}</Text>
            <Text style={{ color: "#40584B", fontSize: 12, lineHeight: 19, marginTop: 3 }}>Agreed assessment fee: R {Number(journeyScreen.assessmentFee ?? 0).toFixed(2)}</Text>
            {journeyScreen.estimateNotes ? <Text style={{ color: "#26372E", fontSize: 12, lineHeight: 19, marginTop: 12 }}>{journeyScreen.estimateNotes}</Text> : null}
            <Text style={{ color: "#66756D", fontSize: 11, lineHeight: 17, marginTop: 12 }}>You accepted the Provider's rate when selecting the offer. This is a separate decision: approving confirms the assessed hours, scope and final total. Main work remains locked until you approve.</Text>
            <Primary label={jobActionBusy ? "Processing approval..." : "Approve final price"} onPress={() => void decideEstimate(journeyScreen.requestId, true)} disabled={jobActionBusy} />
          </View> : null}

          {journeyScreen?.engagementStatus === "COMPLETION_PENDING" ? journeyScreen.completionSubmissions.filter((submission) => submission.status === "PENDING").map((submission) => <View key={submission.id} style={{ backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2EAE5", borderRadius: 20, padding: 17, marginTop: 14 }}>
            <Text style={{ color: "#176B55", fontSize: 10, fontWeight: "900", letterSpacing: 1 }}>COMPLETION REVIEW</Text>
            <Text style={{ color: "#172820", fontSize: 19, fontWeight: "900", marginTop: 8 }}>Your Provider says the work is complete</Text>
            <Text style={{ color: "#829087", fontSize: 10, marginTop: 5 }}>Submitted {new Date(submission.submittedAt).toLocaleString()}</Text>
            <Text style={{ color: "#26372E", fontSize: 13, lineHeight: 21, marginTop: 13 }}>{submission.notes}</Text>
            {submission.evidenceAssets?.map((asset, index) => <Pressable key={asset.id} onPress={async () => { try { const result = await apiRequest<{url:string}>("/marketplace/media/" + asset.id + "/url", {}, true); await Linking.openURL(result.url); } catch (e) { setError(e instanceof Error ? e.message : "Could not open evidence photo."); } }} style={{ marginTop: 10 }}><Text style={{ color: "#176B55", fontWeight: "800" }}>View photo evidence {index + 1} · {asset.originalName}</Text></Pressable>)}
            {submission.evidenceUrls.map((url, index) => <Text key={url} style={{ color: "#66756D", fontSize: 11, marginTop: 6 }}>Legacy evidence link {index + 1}: {url}</Text>)}
            <Text style={{ color: "#66756D", fontSize: 12, lineHeight: 19, marginTop: 13 }}>Review the Provider's notes and photos. Payment is handled separately from this completion approval.</Text>
            <Text style={{ color: "#26372E", fontSize: 12, fontWeight: "800", marginTop: 13 }}>Need corrections? Explain what still needs attention.</Text>
            <TextInput value={completionReviewNote} onChangeText={setCompletionReviewNote} placeholder="Describe the work that needs correction (at least 10 characters)..." multiline style={{ borderWidth: 1, borderColor: "#DCE7DF", borderRadius: 13, padding: 13, minHeight: 84, textAlignVertical: "top", marginTop: 8, color: "#172820", backgroundColor: "#FAFCFA" }} />
            <Primary label={jobActionBusy ? "Processing..." : "Approve completed work"} onPress={() => void reviewCompletion(journeyScreen.requestId, submission.id, true)} disabled={jobActionBusy} />
            <Secondary label="Request corrections" onPress={() => { if (!jobActionBusy && completionReviewNote.trim().length >= 10) void reviewCompletion(journeyScreen.requestId, submission.id, false); }} />
          </View>) : null}

          <Pressable onPress={() => setContactDrawerOpen(true)} style={{ backgroundColor: "#176B55", borderRadius: 15, minHeight: 55, alignItems: "center", justifyContent: "center", marginTop: 16 }}>
            <Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "900" }}>Open service chat</Text>
          </Pressable>
          <Pressable onPress={() => journeyScreen && cancelSeekerJourney(journeyScreen.requestId, journeyScreen.title)} style={{ borderWidth: 1, borderColor: "#E7C6C3", borderRadius: 14, minHeight: 50, alignItems: "center", justifyContent: "center", marginTop: 14, backgroundColor: "#FFF9F8" }}>
            <Text style={{ color: "#B42318", fontWeight: "900" }}>Cancel service</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
    <Modal visible={contactDrawerOpen} transparent animationType="slide" onRequestClose={() => setContactDrawerOpen(false)}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(10,25,18,0.42)" }}>
        <Pressable onPress={() => setContactDrawerOpen(false)} style={{ flex: 1 }} accessibilityLabel="Close contact drawer" />
        <View style={{ backgroundColor: "#FFFFFF", borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 12, paddingTop: 12, paddingBottom: insets.bottom + 16, maxHeight: "82%" }}>
          <View style={{ alignSelf: "center", width: 42, height: 5, borderRadius: 3, backgroundColor: "#D6E0D9", marginBottom: 17 }} />
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View><Text style={{ color: "#15251E", fontSize: 20, fontWeight: "900" }}>Contact {p.mode === "provider" ? "Seeker" : "Provider"}</Text><Text style={{ color: "#66756D", fontSize: 12, marginTop: 4 }}>This conversation belongs to the active service.</Text></View>
            <Pressable onPress={() => setContactDrawerOpen(false)}><Text style={{ color: "#176B55", fontWeight: "900" }}>Close</Text></Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
            <Pressable onPress={() => { const phone = p.mode === "provider" ? myJobs.find((item) => item.request.id === activeProviderJobId)?.seeker?.phone : journeyScreen?.phone; if (phone) void Linking.openURL("tel:" + phone).catch(() => setError("Could not open the phone dialler.")); else setError("A phone number is not available for this contact."); }} style={{ flex: 1, backgroundColor: "#EAF4EE", borderRadius: 13, padding: 13, alignItems: "center" }}>
              <Text style={{ color: "#176B55", fontWeight: "900" }}>Call</Text>
            </Pressable>

          </View>
          <Text style={{ color: "#15251E", fontSize: 14, fontWeight: "900", marginTop: 18, marginBottom: 9 }}>Service chat</Text>
          <ScrollView style={{ maxHeight: 230 }} contentContainerStyle={{ paddingBottom: 8 }}>
            {serviceChatLoading && serviceChatMessages.length === 0 ? <ActivityIndicator color="#176B55" /> : serviceChatMessages.length === 0 ? <Text style={{ color: "#66756D", fontSize: 12, paddingVertical: 18 }}>No messages yet. Start the conversation to coordinate arrival and access.</Text> : serviceChatMessages.map((message) => <View key={message.id} style={{ alignSelf: message.isMine ? "flex-end" : "flex-start", maxWidth: "88%", backgroundColor: message.isMine ? "#E5F3EA" : "#F1F4F2", borderRadius: 13, padding: 10, marginBottom: 8 }}><Text style={{ color: "#24352C", fontSize: 12, lineHeight: 18 }}>{message.body}</Text><Text style={{ color: "#718078", fontSize: 9, marginTop: 4 }}>{new Date(message.createdAt).toLocaleString()}</Text></View>)}
          </ScrollView>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
            <TextInput value={serviceChatDraft} onChangeText={setServiceChatDraft} placeholder="Write a message..." multiline style={{ flex: 1, minHeight: 48, maxHeight: 100, borderWidth: 1, borderColor: "#DCE7DF", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: "#15251E" }} />
            <Pressable disabled={serviceChatBusy || !serviceChatDraft.trim() || !activeChatRequestId} onPress={() => activeChatRequestId && void sendServiceChatMessage(activeChatRequestId)} style={{ backgroundColor: "#176B55", opacity: serviceChatBusy || !serviceChatDraft.trim() || !activeChatRequestId ? 0.5 : 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 15 }}><Text style={{ color: "#FFFFFF", fontWeight: "900" }}>{serviceChatBusy ? "..." : "Send"}</Text></Pressable>
          </View>
        </View>
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
  header: { paddingHorizontal: 10, paddingTop: 15, paddingBottom: 18, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  back: { color: C.primary, fontWeight: "800", fontSize: 13, marginBottom: 14 },
  heading: { color: C.ink, fontSize: 29, fontWeight: "900", letterSpacing: -0.8 },
  subheading: { color: C.muted, marginTop: 6, fontSize: 13, lineHeight: 19 },
  modeRow: { flexDirection: "row", gap: 9, paddingHorizontal: 14, paddingVertical: 13, backgroundColor: C.surface },
  modeButton: { flex: 1, borderRadius: 13, borderWidth: 1, borderColor: C.border, paddingVertical: 13, paddingHorizontal: 9, alignItems: "center", backgroundColor: "#FAFCFA" },
  modeActive: { borderColor: C.primary, backgroundColor: "#EAF4ED" },
  modeText: { color: C.muted, fontWeight: "700", fontSize: 12 },
  modeTextActive: { color: C.primary },
  content: { paddingHorizontal: 10, paddingTop: 16, paddingBottom: 36 },
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
