import * as SecureStore from "expo-secure-store";

const API_URL=process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
const TOKEN_KEY="anyskill_access_token";

export async function setAccessToken(token:string|null){
  if(token) await SecureStore.setItemAsync(TOKEN_KEY,token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}
export const getAccessToken=()=>SecureStore.getItemAsync(TOKEN_KEY);

export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
  const token=await getAccessToken();
  const response=await fetch(`${API_URL}${path}`,{
    ...options,
    headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{}),...(options.headers??{})}
  });
  const body=response.status===204?null:await response.json();
  if(response.status===401) await setAccessToken(null);
  if(!response.ok) throw new Error(body?.error?.code ?? `HTTP_${response.status}`);
  return body as T;
}
