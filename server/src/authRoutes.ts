import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { db } from "./db";
import { requireAuth, AuthRequest, signAccessToken } from "./auth";

export const authRouter=Router();

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
    res.status(201).json({data:{user:{id:p.id,email:p.email.toLowerCase(),displayName:p.displayName},accessToken:signAccessToken(p.id)}});
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
    res.json({data:{user:{id:u.id,email:u.email,displayName:u.display_name},accessToken:signAccessToken(u.id)}});
  }catch(e){next(e);}
});

authRouter.get("/me",requireAuth,async(req:AuthRequest,res,next)=>{
  try{
    const r=await db.query(`select u.id,u.email,u.phone,u.display_name,u.avatar_path,
      (pp.user_id is not null) as is_professional,pp.verification_status,pp.is_online,pp.accepting_jobs
      from users u left join professional_profiles pp on pp.user_id=u.id where u.id=$1`,[req.auth!.id]);
    if(!r.rowCount)return res.status(404).json({error:{code:"USER_NOT_FOUND"}});
    res.json({data:r.rows[0]});
  }catch(e){next(e);}
});
