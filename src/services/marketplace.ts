import { api } from "./api";
export type ProfessionalSearchResult={id:string;display_name:string;avatar_path?:string;bio?:string;years_experience?:number;rating_average?:number;rating_count?:number;distance_m:number;base_price_minor?:number;currency?:string};
export const searchProfessionals=(p:{skillId:string;latitude:number;longitude:number;radiusM:number})=>{
 const q=new URLSearchParams({skillId:p.skillId,lat:String(p.latitude),lng:String(p.longitude),radiusM:String(p.radiusM)});
 return api<{data:ProfessionalSearchResult[]}>(`/professionals/search?${q}`);
};
export const createJobRequest=(input:{id:string;professionalId:string;skillId:string;description:string;budgetMinMinor?:number;budgetMaxMinor?:number;scheduledFor?:string;addressText?:string;latitude?:number;longitude?:number})=>
 api<{data:any}>("/job-requests",{method:"POST",body:JSON.stringify(input)});

export const getMyJobRequests=()=>api<{data:any[]}>("/job-requests/me");
export const sendQuote=(jobRequestId:string,input:{id:string;amountMinor:number;note?:string})=>
 api<{data:any}>(`/job-requests/${jobRequestId}/quotes`,{method:"POST",body:JSON.stringify(input)});
export const declineJobRequest=(jobRequestId:string)=>api<{data:any}>(`/job-requests/${jobRequestId}/decline`,{method:"POST"});
export const acceptQuote=(quoteId:string,bookingId:string)=>api<{data:any}>(`/quotes/${quoteId}/accept`,{method:"POST",body:JSON.stringify({bookingId})});
export const declineQuote=(quoteId:string)=>api<{data:any}>(`/quotes/${quoteId}/decline`,{method:"POST"});

export const getMyBookings=()=>api<{data:any[]}>("/bookings/me");
export const advanceBooking=(bookingId:string)=>api<{data:any}>(`/bookings/${bookingId}/advance`,{method:"POST"});
export const confirmCompletion=(bookingId:string)=>api<{data:any}>(`/bookings/${bookingId}/confirm-completion`,{method:"POST"});
export const reviewBooking=(bookingId:string,input:{id:string;rating:number;comment?:string})=>
 api<{data:any}>(`/bookings/${bookingId}/reviews`,{method:"POST",body:JSON.stringify(input)});

export const createPayment=(bookingId:string,input:{id:string;idempotencyKey:string})=>api<{data:any}>(`/bookings/${bookingId}/payments`,{method:"POST",body:JSON.stringify(input)});
export const getProfessionalEarnings=()=>api<{data:any}>("/professionals/me/earnings");
