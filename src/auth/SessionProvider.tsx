import React,{createContext,useContext,useEffect,useState} from "react";
import {me,logout as clearAuth} from "../services/auth";
type State={loading:boolean;authenticated:boolean;user:any;refresh:()=>Promise<void>;signOut:()=>Promise<void>};
const C=createContext<State|null>(null);
export function SessionProvider({children}:{children:React.ReactNode}){const[loading,setLoading]=useState(true);const[user,setUser]=useState<any>(null);
 const refresh=async()=>{setLoading(true);try{const r=await me();setUser(r.data)}catch{await clearAuth();setUser(null)}finally{setLoading(false)}};
 useEffect(()=>{refresh()},[]);const signOut=async()=>{await clearAuth();setUser(null)};
 return <C.Provider value={{loading,authenticated:!!user,user,refresh,signOut}}>{children}</C.Provider>}
export function useSession(){const v=useContext(C);if(!v)throw new Error("SessionProvider missing");return v}
