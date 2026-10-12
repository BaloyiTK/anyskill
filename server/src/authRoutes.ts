import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { db } from "./db";
import { requireAuth, AuthRequest, signAccessToken } from "./auth";

export const authRouter=Router();
const refreshHash=(token:string)=>crypto.createHash("sha256").update(token).digest("hex");
async function issueRefreshToken(userId:string){const id=crypto.randomUUID();const token=crypto.randomBytes(48).toString("base64url");await db.query("insert into refresh_tokens(id,user_id,token_hash,expires_at) values($1,$2,$3,now()+interval '30 days')",[id,userId,refreshHash(token)]);return token;}

const register=z.object({
  id:z.string().uuid(), email:z.string().email().max(320),
  phone:z.string().max(32).optional(), displayName:z.string().min(2).max(120),
  password:z.string().min(10).max(200)
});

authRouter.post("/register",async(req,res,next)=>{
  const client=await db.connect();
  try{
    const p=register.parse(req.body);
    const hash=await bcrypt.hash(p.password,12);
    await client.query("BEGIN");
    await client.query("insert into users(id,email,phone,display_name) values($1,$2,$3,$4)",
      [p.id,p.email.toLowerCase(),p.phone??null,p.displayName]);
    await client.query("insert into user_credentials(user_id,password_hash) values($1,$2)",[p.id,hash]);
    await client.query("COMMIT");
    const refreshToken=await issueRefreshToken(p.id);res.status(201).json({data:{user:{id:p.id,email:p.email.toLowerCase(),displayName:p.displayName},accessToken:signAccessToken(p.id),refreshToken}});
  }catch(e:any){
    await client.query("ROLLBACK");
    if(e?.code==="23505") return res.status(409).json({error:{code:"ACCOUNT_EXISTS"}});
    next(e);
  }finally{client.release();}
});

authRouter.post("/login",async(req,res,next)=>{
  try{
    const p=z.object({email:z.string().email(),password:z.string()}).parse(req.body);
    const r=await db.query(`select u.id,u.email,u.display_name,c.password_hash
      from users u join user_credentials c on c.user_id=u.id
      where lower(u.email)=lower($1) and u.account_status='ACTIVE'`,[p.email]);
    if(!r.rowCount||!(await bcrypt.compare(p.password,r.rows[0].password_hash)))
      return res.status(401).json({error:{code:"INVALID_CREDENTIALS"}});
    const u=r.rows[0];
    const refreshToken=await issueRefreshToken(u.id);res.json({data:{user:{id:u.id,email:u.email,displayName:u.display_name},accessToken:signAccessToken(u.id),refreshToken}});
  }catch(e){next(e);}
});

authRouter.post("/refresh",async(req,res,next)=>{
 const client=await db.connect();try{const p=z.object({refreshToken:z.string().min(32)}).parse(req.body);const hash=refreshHash(p.refreshToken);await client.query("BEGIN");
 const r=await client.query("select id,user_id from refresh_tokens where token_hash=$1 and revoked_at is null and expires_at>now() for update",[hash]);
 if(!r.rowCount){await client.query("ROLLBACK");return res.status(401).json({error:{code:"INVALID_REFRESH_TOKEN"}});}
 await client.query("update refresh_tokens set revoked_at=now() where id=$1",[r.rows[0].id]);
 const id=crypto.randomUUID(),token=crypto.randomBytes(48).toString("base64url");
 await client.query("insert into refresh_tokens(id,user_id,token_hash,expires_at) values($1,$2,$3,now()+interval '30 days')",[id,r.rows[0].user_id,refreshHash(token)]);
 await client.query("COMMIT");res.json({data:{accessToken:signAccessToken(r.rows[0].user_id),refreshToken:token}});
 }catch(e){await client.query("ROLLBACK");next(e);}finally{client.release();}
});
authRouter.post("/logout",async(req,res,next)=>{try{const p=z.object({refreshToken:z.string().min(32)}).parse(req.body);await db.query("update refresh_tokens set revoked_at=coalesce(revoked_at,now()) where token_hash=$1",[refreshHash(p.refreshToken)]);res.status(204).send();}catch(e){next(e);}});

authRouter.get("/me",requireAuth,async(req:AuthRequest,res,next)=>{
  try{
    const r=await db.query(`select u.id,u.email,u.phone,u.display_name,u.avatar_path,
      (pp.user_id is not null) as is_professional,pp.verification_status,pp.is_online,pp.accepting_jobs
      from users u left join professional_profiles pp on pp.user_id=u.id where u.id=$1`,[req.auth!.id]);
    if(!r.rowCount)return res.status(404).json({error:{code:"USER_NOT_FOUND"}});
    res.json({data:r.rows[0]});
  }catch(e){next(e);}
});
