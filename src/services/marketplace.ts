import { api } from "./api";
export type ProfessionalSearchResult={id:string;display_name:string;avatar_path?:string;bio?:string;years_experience?:number;rating_average?:number;rating_count?:number;distance_m:number;base_price_minor?:number;currency?:string};
export const searchProfessionals=(p:{skillId:string;latitude:number;longitude:number;radiusM:number})=>{
 const q=new URLSearchParams({skillId:p.skillId,lat:String(p.latitude),lng:String(p.longitude),radiusM:String(p.radiusM)});
 return api<{data:ProfessionalSearchResult[]}>(`/professionals/search?${q}`);
};
export const createJobRequest=(input:{id:string;professionalId:string;skillId:string;description:string;budgetMinMinor?:number;budgetMaxMinor?:number;scheduledFor?:string;addressText?:string;latitude?:number;longitude?:number})=>
 api<{data:any}>("/job-requests",{method:"POST",body:JSON.stringify(input)});
