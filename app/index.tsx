import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Pressable, StyleSheet, Text, View } from "react-native";

export default function WelcomeScreen() {
  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.hero}>
        <View style={styles.logo}><Text style={styles.logoText}>A</Text></View>
        <Text style={styles.brand}>AnySkill</Text>
        <Text style={styles.title}>Find the skill.{"\n"}Get it done.</Text>
        <Text style={styles.subtitle}>Discover trusted people with the skills you need, right around you.</Text>
      </View>
      <View style={styles.actions}>
        <Pressable style={styles.primary} onPress={() => router.push("/home")}><Text style={styles.primaryText}>Get started</Text></Pressable>
        <Text style={styles.note}>Find help. Offer your skills. One community.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles=StyleSheet.create({page:{flex:1,backgroundColor:"#F7F8F5",paddingHorizontal:24},hero:{flex:1,justifyContent:"center"},logo:{width:58,height:58,borderRadius:18,backgroundColor:"#171A17",alignItems:"center",justifyContent:"center",marginBottom:18},logoText:{color:"#fff",fontSize:30,fontWeight:"800"},brand:{fontSize:20,fontWeight:"700",color:"#171A17",marginBottom:28},title:{fontSize:48,lineHeight:52,fontWeight:"800",letterSpacing:-1.8,color:"#171A17"},subtitle:{fontSize:18,lineHeight:27,color:"#60665F",marginTop:20,maxWidth:340},actions:{paddingBottom:24,gap:16},primary:{height:58,borderRadius:18,backgroundColor:"#171A17",alignItems:"center",justifyContent:"center"},primaryText:{color:"#fff",fontSize:17,fontWeight:"700"},note:{textAlign:"center",color:"#777D76",fontSize:13}});
