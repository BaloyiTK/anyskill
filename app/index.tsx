import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../src/theme";

export default function WelcomeScreen() {
  return <SafeAreaView style={s.page}>
    <View style={s.top}><Text style={s.wordmark}>Any<Text style={s.gold}>Skill</Text></Text><Text style={s.tag}>SOUTH AFRICA'S SKILLS MARKETPLACE</Text></View>
    <View style={s.hero}>
      <View style={s.badge}><Text style={s.badgeText}>●  Trusted local professionals</Text></View>
      <Text style={s.title}>Find the skill.{"\n"}<Text style={s.gold}>Get it done.</Text></Text>
      <Text style={s.subtitle}>From urgent repairs to everyday help, connect with trusted skilled people near you.</Text>
      <View style={s.trust}><Text style={s.trustText}>✓ Verified profiles</Text><Text style={s.trustText}>★ Rated by customers</Text></View>
    </View>
    <View style={s.actions}>
      <Pressable style={s.primary} onPress={()=>router.push("/register")}><Text style={s.primaryText}>Get started</Text><Text style={s.arrow}>→</Text></Pressable>
      <Pressable style={s.secondary} onPress={()=>router.push("/login")}><Text style={s.secondaryText}>I already have an account</Text></Pressable>
      <Text style={s.footer}>Find help. Offer your skills. One community.</Text>
    </View>
  </SafeAreaView>
}
const s=StyleSheet.create({
 page:{flex:1,backgroundColor:colors.green,paddingHorizontal:24},
 top:{paddingTop:22},wordmark:{fontSize:27,fontWeight:"900",color:colors.white,letterSpacing:-1},gold:{color:colors.gold},tag:{fontSize:9,fontWeight:"800",letterSpacing:1.5,color:"#C8D5CF",marginTop:5},
 hero:{flex:1,justifyContent:"center"},badge:{alignSelf:"flex-start",borderWidth:1,borderColor:"#376456",backgroundColor:"#164B3B",paddingVertical:9,paddingHorizontal:13,borderRadius:99,marginBottom:24},badgeText:{color:"#DDE8E3",fontSize:12,fontWeight:"700"},
 title:{fontSize:50,lineHeight:53,fontWeight:"900",letterSpacing:-2,color:colors.white,maxWidth:390},subtitle:{fontSize:17,lineHeight:26,color:"#D5E0DB",marginTop:20,maxWidth:370},
 trust:{flexDirection:"row",gap:18,marginTop:28,flexWrap:"wrap"},trustText:{color:"#F1E8C9",fontSize:12,fontWeight:"700"},
 actions:{paddingBottom:22,gap:11},primary:{height:60,borderRadius:18,backgroundColor:colors.gold,alignItems:"center",justifyContent:"center",flexDirection:"row"},primaryText:{color:colors.green,fontSize:17,fontWeight:"900"},arrow:{position:"absolute",right:20,color:colors.green,fontSize:22,fontWeight:"900"},
 secondary:{height:56,borderRadius:18,borderWidth:1,borderColor:"#517568",alignItems:"center",justifyContent:"center"},secondaryText:{color:colors.white,fontSize:15,fontWeight:"800"},footer:{textAlign:"center",color:"#AFC3BB",fontSize:11,marginTop:3}
});