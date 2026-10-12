import express from "express";
import cors from "cors";
import { z } from "zod";
import { db } from "./db";
import { authRouter } from "./authRoutes";
import { requireAuth, AuthRequest } from "./auth";

const app = express();
app.use(cors());
app.use(express.json());
app.use("/auth", authRouter);

app.get("/health", async (_req, res) => {
  const result = await db.query("select now() as database_time");
  res.json({ ok: true, databaseTime: result.rows[0].database_time });
});

app.get("/skills", async (_req, res, next) => {
  try {
    const r = await db.query(`select s.id,s.name,s.slug,c.name as category
      from skills s join skill_categories c on c.id=s.category_id
      where s.active=true and c.active=true order by c.sort_order,c.name,s.name`);
    res.json({ data: r.rows });
  } catch (e) { next(e); }
});

const locationSchema=z.object({
  latitude:z.number().min(-90).max(90),
  longitude:z.number().min(-180).max(180),
  areaLabel:z.string().max(160).optional()
});

app.put("/professionals/me/location", requireAuth, async (req:AuthRequest,res,next)=>{
  try {
    const p=locationSchema.parse(req.body);
    await db.query(`insert into professional_locations(professional_id,latitude,longitude,area_label)
      values($1,$2,$3,$4)
      on conflict(professional_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,
      area_label=excluded.area_label,updated_at=now()`,[req.auth!.id,p.latitude,p.longitude,p.areaLabel??null]);
    res.status(204).send();
  } catch(e){ next(e); }
});

app.put("/professionals/me/availability", requireAuth, async(req:AuthRequest,res,next)=>{
  try {
    const p=z.object({isOnline:z.boolean(),acceptingJobs:z.boolean()}).parse(req.body);
    if(p.isOnline||p.acceptingJobs){
      const ready=await db.query(`select 1 from professional_profiles pp
        where pp.user_id=$1 and pp.verification_status='VERIFIED'
        and exists(select 1 from professional_skills ps where ps.professional_id=$1 and ps.active=true)
        and exists(select 1 from professional_locations pl where pl.professional_id=$1)`,[req.auth!.id]);
      if(!ready.rowCount)return res.status(409).json({error:{code:"PROFESSIONAL_NOT_READY"}});
    }
    const updated=await db.query("update professional_profiles set is_online=$2,accepting_jobs=$3,updated_at=now() where user_id=$1 returning is_online,accepting_jobs",
      [req.auth!.id,p.isOnline,p.acceptingJobs]);
    if(!updated.rowCount)return res.status(404).json({error:{code:"PROFESSIONAL_PROFILE_NOT_FOUND"}});
    res.json({data:updated.rows[0]});
  } catch(e){next(e);}
});

const professionalProfileSchema=z.object({
  bio:z.string().max(3000).optional(),
  yearsExperience:z.number().int().min(0).max(80).optional(),
  serviceRadiusM:z.number().int().min(500).max(100000).default(10000)
});

app.put("/professionals/me/profile",requireAuth,async(req:AuthRequest,res,next)=>{
  try{
    const p=professionalProfileSchema.parse(req.body);
    const r=await db.query(`insert into professional_profiles(user_id,bio,years_experience,service_radius_m)
      values($1,$2,$3,$4)
      on conflict(user_id) do update set bio=excluded.bio,years_experience=excluded.years_experience,
      service_radius_m=excluded.service_radius_m,updated_at=now()
      returning user_id,bio,years_experience,verification_status,is_online,accepting_jobs,service_radius_m`,
      [req.auth!.id,p.bio??null,p.yearsExperience??null,p.serviceRadiusM]);
    res.json({data:r.rows[0]});
  }catch(e){next(e);}
});

app.get("/professionals/me/profile",requireAuth,async(req:AuthRequest,res,next)=>{
  try{
    const profile=await db.query(`select pp.*,u.display_name,u.email,u.phone
      from professional_profiles pp join users u on u.id=pp.user_id where pp.user_id=$1`,[req.auth!.id]);
    if(!profile.rowCount)return res.status(404).json({error:{code:"PROFESSIONAL_PROFILE_NOT_FOUND"}});
    const skills=await db.query(`select ps.id,ps.skill_id,s.name,s.slug,ps.title,ps.description,
      ps.base_price_minor,ps.currency,ps.active from professional_skills ps
      join skills s on s.id=ps.skill_id where ps.professional_id=$1 order by s.name`,[req.auth!.id]);
    res.json({data:{...profile.rows[0],skills:skills.rows}});
  }catch(e){next(e);}
});

app.put("/professionals/me/skills",requireAuth,async(req:AuthRequest,res,next)=>{
  const client=await db.connect();
  try{
    const p=z.object({skills:z.array(z.object({
      id:z.string().uuid(), skillId:z.string().uuid(), title:z.string().max(140).optional(),
      description:z.string().max(3000).optional(), basePriceMinor:z.number().int().nonnegative().optional(),
      currency:z.string().length(3).default("ZAR")
    })).min(1).max(30)}).parse(req.body);
    await client.query("BEGIN");
    const exists=await client.query("select 1 from professional_profiles where user_id=$1 for update",[req.auth!.id]);
    if(!exists.rowCount){await client.query("ROLLBACK");return res.status(409).json({error:{code:"PROFESSIONAL_PROFILE_REQUIRED"}});}
    await client.query("update professional_skills set active=false,updated_at=now() where professional_id=$1",[req.auth!.id]);
    for(const s of p.skills){
      await client.query(`insert into professional_skills(id,professional_id,skill_id,title,description,base_price_minor,currency,active)
        values($1,$2,$3,$4,$5,$6,$7,true)
        on conflict(professional_id,skill_id) do update set title=excluded.title,description=excluded.description,
        base_price_minor=excluded.base_price_minor,currency=excluded.currency,active=true,updated_at=now()`,
        [s.id,req.auth!.id,s.skillId,s.title??null,s.description??null,s.basePriceMinor??null,s.currency.toUpperCase()]);
    }
    await client.query("COMMIT"); res.status(204).send();
  }catch(e){await client.query("ROLLBACK");next(e);}finally{client.release();}
});

app.post("/professionals/me/submit-verification",requireAuth,async(req:AuthRequest,res,next)=>{
  try{
    const r=await db.query(`update professional_profiles set verification_status='PENDING',is_online=false,
      accepting_jobs=false,updated_at=now() where user_id=$1 and verification_status in ('UNVERIFIED','REJECTED')
      returning verification_status`,[req.auth!.id]);
    if(!r.rowCount)return res.status(409).json({error:{code:"VERIFICATION_NOT_SUBMITTABLE"}});
    res.json({data:r.rows[0]});
  }catch(e){next(e);}
});

// PostgreSQL-10-compatible v0 radius search using great-circle distance.
// Replace with ST_DWithin when PostGIS is confirmed.
app.get("/professionals/search",async(req,res,next)=>{
  try {
    const q=z.object({
      skillId:z.string().uuid(),
      lat:z.coerce.number().min(-90).max(90),
      lng:z.coerce.number().min(-180).max(180),
      radiusM:z.coerce.number().int().min(500).max(100000).default(10000)
    }).parse(req.query);
    const sql=`
      with candidates as (
        select u.id,u.display_name,u.avatar_path,pp.rating,pp.completed_jobs,
          pp.verification_status,ps.base_price_minor,ps.currency,
          6371000 * acos(least(1.0,greatest(-1.0,
            cos(radians($2))*cos(radians(pl.latitude))*
            cos(radians(pl.longitude)-radians($3))+
            sin(radians($2))*sin(radians(pl.latitude))
          ))) as distance_m,
          pp.service_radius_m
        from professional_profiles pp
        join users u on u.id=pp.user_id
        join professional_skills ps on ps.professional_id=pp.user_id
        join professional_locations pl on pl.professional_id=pp.user_id
        where ps.skill_id=$1 and ps.active=true and pp.is_online=true
          and pp.accepting_jobs=true and pp.verification_status='VERIFIED'
      )
      select id,display_name,avatar_path,rating,completed_jobs,verification_status,
        base_price_minor,currency,round(distance_m::numeric) as distance_m
      from candidates
      where distance_m <= least($4,service_radius_m)
      order by distance_m asc limit 100`;
    const r=await db.query(sql,[q.skillId,q.lat,q.lng,q.radiusM]);
    res.json({data:r.rows});
  } catch(e){next(e);}
});

const requestSchema=z.object({
  id:z.string().uuid(), professionalId:z.string().uuid(),
  skillId:z.string().uuid(), description:z.string().min(5).max(4000),
  budgetMinMinor:z.number().int().nonnegative().optional(),
  budgetMaxMinor:z.number().int().nonnegative().optional(),
  scheduledFor:z.string().datetime().optional(), addressText:z.string().max(500).optional(),
  latitude:z.number().min(-90).max(90).optional(), longitude:z.number().min(-180).max(180).optional()
});

app.post("/job-requests",requireAuth,async(req:AuthRequest,res,next)=>{
  const client=await db.connect();
  try {
    const p=requestSchema.parse(req.body);
    if(p.budgetMinMinor!==undefined&&p.budgetMaxMinor!==undefined&&p.budgetMinMinor>p.budgetMaxMinor)
      return res.status(400).json({error:{code:"INVALID_BUDGET",message:"Minimum budget cannot exceed maximum."}});
    await client.query("BEGIN");
    const eligible=await client.query(`select 1 from professional_profiles pp
      join professional_skills ps on ps.professional_id=pp.user_id
      where pp.user_id=$1 and ps.skill_id=$2 and ps.active=true and pp.is_online=true
      and pp.accepting_jobs=true and pp.verification_status='VERIFIED'`,[p.professionalId,p.skillId]);
    if(!eligible.rowCount){await client.query("ROLLBACK");return res.status(409).json({error:{code:"PROFESSIONAL_UNAVAILABLE"}});}
    const r=await client.query(`insert into job_requests
      (id,customer_id,professional_id,skill_id,description,budget_min_minor,budget_max_minor,scheduled_for,address_text,latitude,longitude)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [p.id,req.auth!.id,p.professionalId,p.skillId,p.description,p.budgetMinMinor??null,p.budgetMaxMinor??null,p.scheduledFor??null,p.addressText??null,p.latitude??null,p.longitude??null]);
    await client.query("COMMIT");
    res.status(201).json({data:r.rows[0]});
  } catch(e){await client.query("ROLLBACK");next(e);} finally {client.release();}
});

app.get("/professionals/me/job-requests",requireAuth,async(req:AuthRequest,res,next)=>{
  try{
    const r=await db.query(`select jr.*,u.display_name as customer_name,s.name as skill_name
      from job_requests jr join users u on u.id=jr.customer_id join skills s on s.id=jr.skill_id
      where jr.professional_id=$1 and jr.status in ('REQUESTED','QUOTED')
      order by jr.created_at desc`,[req.params.id]);
    res.json({data:r.rows});
  }catch(e){next(e);}
});

app.post("/job-requests/:id/decline",async(req,res,next)=>{
  try{
    const r=await db.query(`update job_requests set status='DECLINED',updated_at=now()
      where id=$1 and status in ('REQUESTED','QUOTED') returning id,status`,[req.params.id]);
    if(!r.rowCount)return res.status(409).json({error:{code:"INVALID_STATE"}});
    res.json({data:r.rows[0]});
  }catch(e){next(e);}
});

app.post("/job-requests/:id/quotes",async(req,res,next)=>{
  const client=await db.connect();
  try{
    const p=z.object({id:z.string().uuid(),professionalId:z.string().uuid(),amountMinor:z.number().int().nonnegative(),note:z.string().max(2000).optional()}).parse(req.body);
    await client.query("BEGIN");
    const request=await client.query("select professional_id,status from job_requests where id=$1 for update",[req.params.id]);
    if(!request.rowCount||request.rows[0].professional_id!==p.professionalId||!["REQUESTED","QUOTED"].includes(request.rows[0].status)){
      await client.query("ROLLBACK");return res.status(409).json({error:{code:"INVALID_REQUEST_STATE"}});
    }
    await client.query("update quotes set status='SUPERSEDED',updated_at=now() where job_request_id=$1 and status='PENDING'",[req.params.id]);
    const r=await client.query(`insert into quotes(id,job_request_id,professional_id,amount_minor,note)
      values($1,$2,$3,$4,$5) returning *`,[p.id,req.params.id,p.professionalId,p.amountMinor,p.note??null]);
    await client.query("update job_requests set status='QUOTED',updated_at=now() where id=$1",[req.params.id]);
    await client.query("COMMIT"); res.status(201).json({data:r.rows[0]});
  }catch(e){await client.query("ROLLBACK");next(e);}finally{client.release();}
});

app.use((err:any,_req:any,res:any,_next:any)=>{
  if(err instanceof z.ZodError)return res.status(400).json({error:{code:"VALIDATION_ERROR",details:err.flatten()}});
  console.error(err); res.status(500).json({error:{code:"INTERNAL_ERROR"}});
});

const port=Number(process.env.PORT??4000);
app.listen(port,()=>console.log(`AnySkill API listening on :${port}`));
