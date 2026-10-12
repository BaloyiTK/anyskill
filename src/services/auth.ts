import { api,setAccessToken } from "./api";
export type SessionUser={id:string;email:string;displayName:string};
type AuthResponse={data:{user:SessionUser;accessToken:string}};

export async function register(input:{id:string;email:string;phone?:string;displayName:string;password:string}){
  const r=await api<AuthResponse>("/auth/register",{method:"POST",body:JSON.stringify(input)});
  await setAccessToken(r.data.accessToken); return r.data.user;
}
export async function login(email:string,password:string){
  const r=await api<AuthResponse>("/auth/login",{method:"POST",body:JSON.stringify({email,password})});
  await setAccessToken(r.data.accessToken); return r.data.user;
}
export const logout=()=>setAccessToken(null);
export async function me(){return api<{data:any}>("/auth/me");}
