import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export type AuthUser={ id:string };
export interface AuthRequest extends Request { auth?:AuthUser }

const secret=process.env.JWT_SECRET;
if(!secret) throw new Error("JWT_SECRET is required");

export function signAccessToken(userId:string){
  return jwt.sign({sub:userId},secret!,{expiresIn:"15m",issuer:"anyskill-api",audience:"anyskill-mobile"});
}

export function requireAuth(req:AuthRequest,res:Response,next:NextFunction){
  const header=req.header("authorization");
  if(!header?.startsWith("Bearer ")) return res.status(401).json({error:{code:"UNAUTHENTICATED"}});
  try{
    const payload=jwt.verify(header.slice(7),secret!,{issuer:"anyskill-api",audience:"anyskill-mobile"});
    if(typeof payload==="string"||typeof payload.sub!=="string") throw new Error("invalid token");
    req.auth={id:payload.sub}; next();
  }catch{
    return res.status(401).json({error:{code:"INVALID_TOKEN"}});
  }
}
