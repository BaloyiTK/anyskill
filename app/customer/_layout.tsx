import {Stack} from "expo-router";
import {RequireAuth} from "../../src/auth/RequireAuth";
export default function Layout(){return <RequireAuth><Stack screenOptions={{headerShown:false}}/></RequireAuth>}
