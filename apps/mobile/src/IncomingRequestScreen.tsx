import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { apiRequest } from "./api";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type IncomingRequest = {
  id: string; title: string; skillCategory: string; description: string; status: "OPEN" | "CLOSED" | "CANCELLED" | "COMPLETED";
  location: string | null; deliveryMode: "ONSITE" | "REMOTE" | "EITHER";
  preferredStartAt: string | null; createdAt: string;
  seeker: { firstName: string; lastName: string; identityVerified: boolean };
  distanceKm: number | null;
  alreadyResponded: boolean;
  responseDeadlineAt: string | null;
};
type Props = { platformHeader: ReactNode; requestId: string | null; onClose: () => void; onExpired: (requestId: string) => void; onAccepted: (requestId: string) => void };

export function IncomingRequestScreen({ platformHeader, requestId, onClose, onExpired, onAccepted }: Props) {
  const insets = useSafeAreaInsets();
  const [request, setRequest] = useState<IncomingRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState("");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const actionInProgressRef = useRef(false);
  const pollInFlightRef = useRef(false);
  const expiredRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!requestId) { setRequest(null); setError(""); return; }
    let active = true;
    const load = async (showSpinner: boolean) => {
      if (actionInProgressRef.current || pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      if (showSpinner) setLoading(true);
      try {
        const result = await apiRequest<{ items: IncomingRequest[] }>("/marketplace/incoming-requests", {}, true);
        if (!active || actionInProgressRef.current) return;
        const found = result.items.find((item) => item.id === requestId && item.status === "OPEN" && !item.alreadyResponded);
        setRequest(found ?? null);
        setError(found ? "" : "This request is no longer available. AnySkill has refreshed your incoming requests.");
      } catch (e) {
        if (!active || actionInProgressRef.current) return;
        setError(e instanceof Error ? e.message : "Could not refresh this request. Please try again.");
      } finally {
        pollInFlightRef.current = false;
        if (active && showSpinner) setLoading(false);
      }
    };
    setRequest(null);
    setAction(null);
    setError("");
    void load(true);
    const poll = setInterval(() => { void load(false); }, 5000);
    return () => { active = false; clearInterval(poll); };
  }, [requestId, refreshTrigger]);

  useEffect(() => {
    if (!request?.responseDeadlineAt) { setSecondsRemaining(0); return; }
    const update = () => setSecondsRemaining(Math.max(0, Math.ceil((new Date(request.responseDeadlineAt!).getTime() - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [request?.responseDeadlineAt]);

  const expired = Boolean(request?.responseDeadlineAt && new Date(request.responseDeadlineAt).getTime() <= Date.now());

  useEffect(() => {
    if (!requestId || !expired || expiredRequestIdRef.current === requestId) return;
    expiredRequestIdRef.current = requestId;
    onExpired(requestId);
  }, [requestId, expired, onExpired]);

  useEffect(() => {
    if (!requestId) expiredRequestIdRef.current = null;
  }, [requestId]);

  const respond = async (choice: "accept" | "decline") => {
    if (!requestId || action || expired) return;
    actionInProgressRef.current = true;
    setAction(choice); setError("");
    try {
      if (choice === "accept") {
        await apiRequest("/marketplace/requests/" + requestId + "/accept", { method: "POST" }, true);
        onAccepted(requestId);
      } else {
        await apiRequest("/marketplace/requests/" + requestId + "/decline", { method: "POST" }, true);
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your response could not be submitted. Please try again.");
      setRefreshTrigger((value) => value + 1);
    } finally {
      actionInProgressRef.current = false;
      setAction(null);
    }
  };

  return <Modal visible={Boolean(requestId)} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose} statusBarTranslucent>
    <ScrollView contentContainerStyle={[styles.screen, { paddingTop: insets.top + 12 }]}>
      {platformHeader}
      <Text style={styles.eyebrow}>ANYSKILL • INCOMING REQUEST</Text>
      <View style={styles.pulse}><Text style={styles.pulseIcon}>✦</Text></View>
      <Text style={styles.heading}>A service request is waiting</Text>
      <Text style={styles.subheading}>A Skill Seeker needs a Provider with your skills.</Text>
      {loading && <ActivityIndicator size="large" color="#FFFFFF" />}
      {request && <>
        <View style={styles.card}>
          <Text style={styles.category}>{request.skillCategory.toUpperCase()}</Text>
          <Text style={styles.title}>{request.title}</Text>
          <Text style={styles.description}>{request.description}</Text>
          <View style={styles.rule} />
          <Text style={styles.meta}>FROM  {request.seeker.firstName || "Skill Seeker"} {request.seeker.lastName || ""}</Text>
          <Text style={styles.meta}>TYPE  {request.deliveryMode}</Text>
          {request.location ? <Text style={styles.meta}>LOCATION  {request.location}</Text> : null}
          {request.distanceKm != null ? <Text style={styles.meta}>DISTANCE  {request.distanceKm} km</Text> : null}
          {request.preferredStartAt ? <Text style={styles.meta}>PREFERRED TIME  {new Date(request.preferredStartAt).toLocaleString()}</Text> : null}
          {request.responseDeadlineAt ? <Text accessibilityLiveRegion="polite" style={[styles.countdown, expired && styles.expired]}>{expired ? "RESPONSE WINDOW EXPIRED" : `RESPOND WITHIN  ${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")}`}</Text> : null}
        </View>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" disabled={Boolean(action) || expired} onPress={() => void respond("accept")} style={[styles.accept, (Boolean(action) || expired) && styles.disabled]}>
            <Text style={styles.acceptText}>{action === "accept" ? "ACCEPTING…" : "ACCEPT REQUEST"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={Boolean(action) || expired} onPress={() => void respond("decline")} style={[styles.decline, (Boolean(action) || expired) && styles.disabled]}>
            <Text style={styles.declineText}>{action === "decline" ? "DECLINING…" : "DECLINE"}</Text>
          </Pressable>
        </View>
      </>}
      {!loading && !request && <Pressable onPress={onClose} style={styles.decline}><Text style={styles.declineText}>CLOSE</Text></Pressable>}
      {error ? <View style={styles.errorArea}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => setRefreshTrigger((value) => value + 1)} style={styles.retry}><Text style={styles.retryText}>RETRY</Text></Pressable></View> : null}
      <Text style={styles.footnote}>Only accept if you are available and able to provide this service.</Text>
    </ScrollView>
  </Modal>;
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:"#123F32",paddingHorizontal:12,paddingTop:12,paddingBottom:34,justifyContent:"center"},
  eyebrow:{color:"#BFE8D0",fontSize:11,fontWeight:"900",letterSpacing:2,textAlign:"center"},
  pulse:{width:86,height:86,borderRadius:43,backgroundColor:"#FFFFFF1C",alignSelf:"center",alignItems:"center",justifyContent:"center",marginTop:28,marginBottom:24,borderWidth:1,borderColor:"#FFFFFF55"},
  pulseIcon:{color:"#FFFFFF",fontSize:40,fontWeight:"800"},
  heading:{color:"#FFFFFF",fontSize:29,lineHeight:35,fontWeight:"900",textAlign:"center"},
  subheading:{color:"#D6EADF",fontSize:14,lineHeight:21,textAlign:"center",marginTop:10,marginBottom:24},
  card:{backgroundColor:"#FFFFFF",borderRadius:22,padding:20},
  category:{color:"#176B55",fontSize:10,fontWeight:"900",letterSpacing:1.5},
  title:{color:"#15251E",fontSize:23,lineHeight:29,fontWeight:"900",marginTop:8},
  description:{color:"#53645B",fontSize:14,lineHeight:21,marginTop:10},
  rule:{height:1,backgroundColor:"#E1E8E3",marginVertical:16},
  meta:{color:"#526259",fontSize:11,fontWeight:"700",marginTop:7},
  countdown:{color:"#176B55",fontSize:12,fontWeight:"900",letterSpacing:1,marginTop:18},
  expired:{color:"#A12D2D"},
  assessmentChoice:{backgroundColor:"#FFFFFF",borderRadius:18,padding:16,marginTop:14},
  choiceHeading:{color:"#176B55",fontSize:11,fontWeight:"900",letterSpacing:1},
  choiceDescription:{color:"#53645B",fontSize:12,lineHeight:18,marginTop:7},
  choiceOption:{flexDirection:"row",alignItems:"flex-start",gap:10,padding:12,borderWidth:1,borderColor:"#DCE7DF",borderRadius:12,marginTop:10},
  choiceOptionSelected:{borderColor:"#176B55",backgroundColor:"#F0F8F3"},
  radio:{width:18,height:18,borderRadius:9,borderWidth:2,borderColor:"#829087",marginTop:2},
  radioSelected:{borderColor:"#176B55",backgroundColor:"#176B55"},
  choiceCopy:{flex:1},
  choiceTitle:{color:"#15251E",fontSize:13,fontWeight:"900"},
  choiceHint:{color:"#66756D",fontSize:11,lineHeight:16,marginTop:4},
  feeLabel:{color:"#15251E",fontSize:12,fontWeight:"800",marginTop:14},
  feeInput:{borderWidth:1,borderColor:"#DCE7DF",borderRadius:10,minHeight:44,paddingHorizontal:12,color:"#15251E",marginTop:6},
  feeError:{color:"#B42318",fontSize:11,marginTop:5},
  actions:{gap:12,marginTop:20},
  accept:{minHeight:58,borderRadius:16,backgroundColor:"#65D69A",alignItems:"center",justifyContent:"center"},
  acceptText:{color:"#103B2B",fontSize:14,fontWeight:"900",letterSpacing:1},
  decline:{minHeight:54,borderRadius:16,borderWidth:1,borderColor:"#FFFFFF88",alignItems:"center",justifyContent:"center",marginTop:12},
  declineText:{color:"#FFFFFF",fontSize:13,fontWeight:"900",letterSpacing:1},
  disabled:{opacity:.5},
  errorArea:{alignItems:"center",marginTop:14},
  error:{color:"#FFD3D3",fontSize:12,lineHeight:18,textAlign:"center"},
  retry:{paddingHorizontal:24,paddingVertical:10,marginTop:8,borderRadius:12,borderWidth:1,borderColor:"#FFFFFF88"},
  retryText:{color:"#FFFFFF",fontSize:11,fontWeight:"900",letterSpacing:1},
  footnote:{color:"#BFD9CA",fontSize:11,lineHeight:17,textAlign:"center",marginTop:24}
});
