import { api } from "./api";
export const getSkills=()=>api<{data:any[]}>("/skills");
export const getProfessionalProfile=()=>api<{data:any}>("/professionals/me/profile");
export const saveProfessionalProfile=(input:{bio?:string;yearsExperience?:number;serviceRadiusM:number})=>
 api<{data:any}>("/professionals/me/profile",{method:"PUT",body:JSON.stringify(input)});
export const saveProfessionalSkills=(skills:Array<{id:string;skillId:string;title?:string;description?:string;basePriceMinor?:number;currency?:string}>)=>
 api<void>("/professionals/me/skills",{method:"PUT",body:JSON.stringify({skills})});
export const saveProfessionalLocation=(input:{latitude:number;longitude:number;areaLabel?:string})=>
 api<void>("/professionals/me/location",{method:"PUT",body:JSON.stringify(input)});
export const submitVerification=()=>api<{data:any}>("/professionals/me/submit-verification",{method:"POST"});
export const setAvailability=(isOnline:boolean,acceptingJobs:boolean)=>
 api<{data:{is_online:boolean;accepting_jobs:boolean}}>("/professionals/me/availability",{method:"PUT",body:JSON.stringify({isOnline,acceptingJobs})});
export const getIncomingRequests=()=>api<{data:any[]}>("/professionals/me/job-requests");
