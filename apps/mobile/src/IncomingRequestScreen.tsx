import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { apiRequest } from "./api";

type IncomingRequest = {
  id: string; title: string; skillCategory: string; description: string; status: "OPEN" | "CLOSED" | "CANCELLED" | "COMPLETED";
  location: string | null; deliveryMode: "ONSITE" | "REMOTE" | "EITHER";
  preferredStartAt: string | null; createdAt: string;
  seeker: { firstName: string; lastName: string; identityVerified: boolean };
  distanceKm: number | null;
  alreadyResponded: boolean;
};
type Props = { requestId: string | null; onClose: () => void; onAccepted: (requestId: string) => void };

export function IncomingRequestScreen({ requestId, onClose, onAccepted }: Props) {
  const [request, setRequest] = useState<IncomingRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!requestId) { setRequest(null); return; }
    let active = true;
    setRequest(null);
    setAction(null);
    setLoading(true); setError("");
    apiRequest<{ items: IncomingRequest[] }>("/marketplace/incoming-requests", {}, true)
      .then((result) => {
        if (!active) return;
        const found = result.items.find((item) => item.id === requestId && item.status === "OPEN" && !item.alreadyResponded);
        setRequest(found ?? null);
        if (!found) setError("This request is no longer available. Your incoming requests have been refreshed.");
      })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "Could not load this request."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [requestId]);

  const respond = async (choice: "accept" | "decline") => {
    if (!requestId || action) return;
    setAction(choice); setError("");
    try {
      if (choice === "accept") {
        await apiRequest("/marketplace/requests/" + requestId + "/accept", { method: "POST", body: JSON.stringify({}) }, true);
        onAccepted(requestId);
      } else {
        await apiRequest("/marketplace/requests/" + requestId + "/decline", { method: "POST" }, true);
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your response could not be submitted. Please try again.");
    } finally { setAction(null); }
  };

  return <Modal visible={Boolean(requestId)} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose} statusBarTranslucent>
    <View style={styles.screen}>
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
        </View>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" disabled={Boolean(action)} onPress={() => void respond("accept")} style={[styles.accept, Boolean(action) && styles.disabled]}>
            <Text style={styles.acceptText}>{action === "accept" ? "ACCEPTING…" : "ACCEPT REQUEST"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={Boolean(action)} onPress={() => void respond("decline")} style={[styles.decline, Boolean(action) && styles.disabled]}>
            <Text style={styles.declineText}>{action === "decline" ? "DECLINING…" : "DECLINE"}</Text>
          </Pressable>
        </View>
      </>}
      {!loading && !request && <Pressable onPress={onClose} style={styles.decline}><Text style={styles.declineText}>CLOSE</Text></Pressable>}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Text style={styles.footnote}>Only accept if you are available and able to provide this service.</Text>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:"#123F32",paddingHorizontal:24,paddingTop:70,paddingBottom:34,justifyContent:"center"},
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
  actions:{gap:12,marginTop:20},
  accept:{minHeight:58,borderRadius:16,backgroundColor:"#65D69A",alignItems:"center",justifyContent:"center"},
  acceptText:{color:"#103B2B",fontSize:14,fontWeight:"900",letterSpacing:1},
  decline:{minHeight:54,borderRadius:16,borderWidth:1,borderColor:"#FFFFFF88",alignItems:"center",justifyContent:"center",marginTop:12},
  declineText:{color:"#FFFFFF",fontSize:13,fontWeight:"900",letterSpacing:1},
  disabled:{opacity:.5},
  error:{color:"#FFD3D3",fontSize:12,lineHeight:18,textAlign:"center",marginTop:14},
  footnote:{color:"#BFD9CA",fontSize:11,lineHeight:17,textAlign:"center",marginTop:24}
});
