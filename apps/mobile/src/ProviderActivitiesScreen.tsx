import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { apiRequest } from "./api";

type ProviderJob = {
  id: string;
  status: string;
  estimatedHours: string | number | null;
  estimatedTotal: string | number | null;
  request: {
    id: string;
    title: string;
    location: string | null;
  };
};

type Props = {
  onOpenJob: (requestId: string) => void;
};

const ACTIVE_STATUSES = new Set([
  "ASSESSMENT_PENDING",
  "ESTIMATE_SUBMITTED",
  "ESTIMATE_REJECTED",
  "ESTIMATE_APPROVED",
  "IN_PROGRESS",
  "COMPLETION_PENDING",
  "DISPUTED",
]);

const STAGE_LABELS: Record<string, string> = {
  ASSESSMENT_PENDING: "Assessment required",
  ESTIMATE_SUBMITTED: "Estimate awaiting Seeker review",
  ESTIMATE_REJECTED: "Estimate revision required",
  ESTIMATE_APPROVED: "Ready to start work",
  IN_PROGRESS: "Work in progress",
  COMPLETION_PENDING: "Completion awaiting review",
  DISPUTED: "Under dispute review",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const C = {
  ink: "#15251E",
  muted: "#66756D",
  primary: "#176B55",
  border: "#E1E8E3",
  soft: "#EAF4EE",
  background: "#FFFFFF",
  warning: "#FFF6E4",
  warningInk: "#78551A",
  danger: "#A12D2D",
};

export function ProviderActivitiesScreen({ onOpenJob }: Props) {
  const [jobs, setJobs] = useState<ProviderJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadJobs = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const result = await apiRequest<ProviderJob[]>("/marketplace/my-jobs", {}, true);
      setJobs(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your selected services.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const activeCount = jobs.filter((job) => ACTIVE_STATUSES.has(job.status)).length;

  return (
    <View style={{ width: "100%", paddingTop: 12, paddingBottom: 24 }}>
      <Text style={{ color: C.muted, fontSize: 10, fontWeight: "900", letterSpacing: 1.4 }}>PROVIDER ACTIVITIES</Text>
      <Text style={{ color: C.ink, fontSize: 30, lineHeight: 36, fontWeight: "900", marginTop: 8 }}>Your selected services</Text>
      <Text style={{ color: C.muted, fontSize: 13, lineHeight: 20, marginTop: 7 }}>
        Every service selected by a Seeker stays in your activity history until it is completed or cancelled. Closing its workspace does not cancel the service.
      </Text>

      <View style={{ backgroundColor: C.soft, borderRadius: 15, padding: 15, marginTop: 18 }}>
        <Text style={{ color: C.primary, fontSize: 11, fontWeight: "900", letterSpacing: 0.7 }}>ACTIVE SERVICES</Text>
        <Text style={{ color: C.ink, fontSize: 28, fontWeight: "900", marginTop: 4 }}>{activeCount}</Text>
        <Text style={{ color: C.muted, fontSize: 11, lineHeight: 17, marginTop: 2 }}>
          {activeCount === 1 ? "Service needs your attention or is in progress." : "Services need your attention or are in progress."}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => void loadJobs(true)}
        disabled={loading || refreshing}
        style={{ alignSelf: "flex-start", borderWidth: 1, borderColor: C.border, borderRadius: 11, paddingHorizontal: 15, minHeight: 42, justifyContent: "center", marginTop: 16, opacity: loading || refreshing ? 0.6 : 1 }}
      >
        <Text style={{ color: C.primary, fontSize: 12, fontWeight: "800" }}>{refreshing ? "Refreshing..." : "Refresh activities"}</Text>
      </Pressable>

      {loading ? <ActivityIndicator color={C.primary} style={{ marginTop: 22 }} /> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: C.danger, fontSize: 12, lineHeight: 18, marginTop: 16 }}>{error}</Text> : null}

      {!loading && jobs.length === 0 && !error ? (
        <View style={{ borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 17, marginTop: 18, backgroundColor: C.background }}>
          <Text style={{ color: C.ink, fontSize: 15, fontWeight: "800" }}>No selected services yet</Text>
          <Text style={{ color: C.muted, fontSize: 12, lineHeight: 18, marginTop: 6 }}>When a Seeker selects your offer, the assessment and service will appear here automatically.</Text>
        </View>
      ) : null}

      {jobs.map((job) => {
        const active = ACTIVE_STATUSES.has(job.status);
        const stage = STAGE_LABELS[job.status] ?? job.status.replaceAll("_", " ");
        const assessmentStage = ["ASSESSMENT_PENDING", "ESTIMATE_REJECTED"].includes(job.status);
        return (
          <View key={job.id} style={{ backgroundColor: C.background, borderWidth: 1, borderColor: active ? "#B8DCC7" : C.border, borderRadius: 16, padding: 16, marginTop: 13 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <Text style={{ color: C.ink, fontSize: 15, lineHeight: 20, fontWeight: "900", flex: 1 }}>{job.request.title}</Text>
              <View style={{ backgroundColor: active ? C.soft : C.warning, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 6 }}>
                <Text style={{ color: active ? C.primary : C.warningInk, fontSize: 9, fontWeight: "900" }}>{active ? "ACTIVE" : job.status}</Text>
              </View>
            </View>
            <Text style={{ color: active ? C.primary : C.muted, fontSize: 12, fontWeight: "800", marginTop: 8 }}>{stage}</Text>
            {job.request.location ? <Text style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>Location: {job.request.location}</Text> : null}
            {job.estimatedHours != null ? <Text style={{ color: C.muted, fontSize: 11, marginTop: 5 }}>Estimated hours: {Number(job.estimatedHours).toFixed(2)}</Text> : null}
            {job.estimatedTotal != null ? <Text style={{ color: C.muted, fontSize: 11, marginTop: 5 }}>Estimate: R {Number(job.estimatedTotal).toFixed(2)}</Text> : null}
            {active ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => onOpenJob(job.request.id)}
                style={{ backgroundColor: C.primary, borderRadius: 12, minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 14 }}
              >
                <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "900" }}>{assessmentStage ? "Continue assessment" : "Continue service"}</Text>
              </Pressable>
            ) : (
              <Text style={{ color: C.muted, fontSize: 11, marginTop: 12 }}>This service is no longer active.</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}
