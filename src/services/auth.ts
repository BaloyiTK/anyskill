import {api,setAccessToken,setRefreshToken,getRefreshToken,clearSession} from "./api";
export type SessionUser={id:string;email:string;displayName:string};
type AuthResponse={data:{user:SessionUser;accessToken:string;refreshToken:string}};
async function save(r:AuthResponse){await Promise.all([setAccessToken(r.data.accessToken),setRefreshToken(r.data.refreshToken)]);return r.data.user}
export async function register(input:{id:string;email:string;phone?:string;displayName:string;password:string}){return save(await api<AuthResponse>("/auth/register",{method:"POST",body:JSON.stringify(input)}))}
export async function login(email:string,password:string){return save(await api<AuthResponse>("/auth/login",{method:"POST",body:JSON.stringify({email,password})}))}
export async function logout(){const refreshToken=await getRefreshToken();try{if(refreshToken)await api("/auth/logout",{method:"POST",body:JSON.stringify({refreshToken})},false)}finally{await clearSession()}}
export async function me(){return api<{data:any}>("/auth/me")}
