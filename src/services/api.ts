import * as SecureStore from "expo-secure-store";
const API_URL=process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
const TOKEN_KEY="anyskill_access_token",REFRESH_KEY="anyskill_refresh_token";
export async function setAccessToken(token:string|null){if(token)await SecureStore.setItemAsync(TOKEN_KEY,token);else await SecureStore.deleteItemAsync(TOKEN_KEY)}
export const getAccessToken=()=>SecureStore.getItemAsync(TOKEN_KEY);
export async function setRefreshToken(token:string|null){if(token)await SecureStore.setItemAsync(REFRESH_KEY,token);else await SecureStore.deleteItemAsync(REFRESH_KEY)}
export const getRefreshToken=()=>SecureStore.getItemAsync(REFRESH_KEY);
export async function clearSession(){await Promise.all([setAccessToken(null),setRefreshToken(null)])}
let refreshPromise:Promise<boolean>|null=null;
async function refreshSession(){if(refreshPromise)return refreshPromise;refreshPromise=(async()=>{const token=await getRefreshToken();if(!token)return false;try{const r=await fetch(API_URL+"/auth/refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({refreshToken:token})});if(!r.ok)return false;const b=await r.json();await Promise.all([setAccessToken(b.data.accessToken),setRefreshToken(b.data.refreshToken)]);return true}catch{return false}})();try{return await refreshPromise}finally{refreshPromise=null}}
export async function api<T>(path:string,options:RequestInit={},retry=true):Promise<T>{const token=await getAccessToken();const response=await fetch(API_URL+path,{...options,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{}),...(options.headers??{})}});if(response.status===401&&retry&&path!=="/auth/refresh"){if(await refreshSession())return api<T>(path,options,false);await clearSession()}const body=response.status===204?null:await response.json();if(!response.ok)throw new Error(body?.error?.code??("HTTP_"+response.status));return body as T}
