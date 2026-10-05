export type Worker={id:string;name:string;skill:string;rating:number;jobs:number;distance:number;rate:string;verified:boolean;bio:string;initials:string};
export const workers:Worker[]=[
{id:"thabo",name:"Thabo Mokoena",skill:"Painter",rating:4.9,jobs:128,distance:2.4,rate:"From R350",verified:true,bio:"Interior and exterior painter focused on clean finishes and reliable service.",initials:"TM"},
{id:"lerato",name:"Lerato Nkosi",skill:"Painter",rating:4.8,jobs:94,distance:4.1,rate:"From R300",verified:true,bio:"Residential painting, feature walls and touch-ups. Available for scheduled jobs.",initials:"LN"},
{id:"sipho",name:"Sipho Dlamini",skill:"Plumber",rating:4.9,jobs:176,distance:5.7,rate:"From R450",verified:true,bio:"General plumbing, leaks, installations and emergency call-outs.",initials:"SD"},
{id:"naledi",name:"Naledi Khumalo",skill:"Cleaner",rating:4.7,jobs:81,distance:7.2,rate:"From R250",verified:true,bio:"Home and office cleaning with flexible scheduling.",initials:"NK"},
{id:"ayanda",name:"Ayanda Ncube",skill:"Electrician",rating:4.9,jobs:143,distance:8.8,rate:"From R500",verified:true,bio:"Electrical repairs, installations and fault finding.",initials:"AN"},
{id:"zanele",name:"Zanele Molefe",skill:"Tutor",rating:5, jobs:62,distance:9.6,rate:"From R220/hr",verified:true,bio:"Maths and science tutoring for high-school learners.",initials:"ZM"}];
export const skills=["Painter","Plumber","Electrician","Cleaner","Tutor","Photographer","Gardener","Carpenter"];
