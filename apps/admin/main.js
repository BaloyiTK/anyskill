const $ = (selector) => document.querySelector(selector);
const state = { api: "http://localhost:3000/api/v1", accessToken: "", refreshToken: "", staff: null, staffMembers: [], dashboardMetrics: null };

const show = (element) => element.classList.remove("hidden");
const hide = (element) => element.classList.add("hidden");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const initials = (value) => String(value || "S").trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "S";
const dateLabel = (value) => value ? new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium" }).format(new Date(value)) : "Date unavailable";
const messageOf = (payload) => typeof payload?.message === "string" ? payload.message : Array.isArray(payload?.message) ? payload.message.join(", ") : "The request could not be completed.";

async function requestBlob(path) {
  const headers = new Headers();
  if (state.accessToken) headers.set("Authorization", `Bearer ${state.accessToken}`);
  let response = await fetch(`${state.api}${path}`, { headers, cache: "no-store" });
  if (response.status === 401 && state.refreshToken) {
    const refreshed = await fetch(`${state.api}/auth/refresh`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: state.refreshToken }),
    });
    if (refreshed.ok) {
      const tokens = await refreshed.json();
      state.accessToken = tokens.accessToken;
      state.refreshToken = tokens.refreshToken;
      headers.set("Authorization", `Bearer ${state.accessToken}`);
      response = await fetch(`${state.api}${path}`, { headers, cache: "no-store" });
    } else {
      signOut(false);
      throw new Error("Your session expired. Please sign in again.");
    }
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(messageOf(payload));
  }
  return URL.createObjectURL(await response.blob());
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (state.accessToken) headers.set("Authorization", `Bearer ${state.accessToken}`);
  let response = await fetch(`${state.api}${path}`, { ...options, headers });
  if (response.status === 401 && state.refreshToken && path !== "/auth/refresh") {
    const refreshed = await fetch(`${state.api}/auth/refresh`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: state.refreshToken }),
    });
    if (refreshed.ok) {
      const tokens = await refreshed.json();
      state.accessToken = tokens.accessToken;
      state.refreshToken = tokens.refreshToken;
      headers.set("Authorization", `Bearer ${state.accessToken}`);
      response = await fetch(`${state.api}${path}`, { ...options, headers });
    } else {
      signOut(false);
      throw new Error("Your session expired. Please sign in again.");
    }
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(messageOf(payload));
    error.status = response.status;
    throw error;
  }
  return payload;
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  show(node);
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => hide(node), 3200);
}

function signOut(callApi = true) {
  if (callApi && state.refreshToken) {
    fetch(`${state.api}/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: state.refreshToken }) }).catch(() => {});
  }
  state.accessToken = "";
  state.refreshToken = "";
  state.staff = null;
  show($("#login-view"));
  hide($("#app-view"));
  $("#password").value = "";
}

const moduleDefinitions = {
  "user-providers": { group: "MARKETPLACE", title: "Providers", description: "Provider account register with All, Active, Suspended and application-status filters.", items: ["Provider profile and skills", "Identity verification state", "Availability and service areas", "Provider role status and account-level controls"], note: "The provider register UI is scoped here; connect it to a protected, paginated user-management API before showing live accounts or changing access." },
  "user-seekers": { group: "MARKETPLACE", title: "Seekers", description: "Seeker account register with All, Active and Suspended tabs.", items: ["Seeker profile and contact details", "Marketplace roles (including dual-role accounts)", "Account status and registration date", "Role-level suspension kept separate from whole-account suspension"], note: "The seeker register UI is scoped here; connect it to a protected, paginated user-management API before showing live accounts or changing access." },
  jobs: { group: "MARKETPLACE", title: "Jobs & requests", description: "Central register for service requests and job engagements.", items: ["All jobs", "Informal services (service category, not a lifecycle status)", "Pending and matching", "In progress and scheduled", "Cancelled and completed", "Disputes and escalations"], note: "Job records need a unified, paginated API joining requests, provider responses and engagements. The current schema does not yet contain a complete cancellation/dispute case workflow." },
  identity: { group: "TRUST & SAFETY", title: "Identity verification", description: "Review identity documents and the live selfie independently of skill decisions.", items: ["Identity documents and live selfie", "Separate identity decision and rejection reason", "Identity verification is required before skill approval"], note: "Identity verification is its own review queue. It does not approve or reject the user’s skills." },
  disputes: { group: "TRUST & SAFETY", title: "Disputes", description: "Investigate disagreements between seekers and providers.", items: ["New and open disputes", "Awaiting seeker or provider response", "Under investigation", "Escalated and resolved", "Evidence and resolution history"], note: "The engagement status supports DISPUTED, but a full dispute case, evidence and resolution workflow still needs to be designed and implemented." },
  fraud: { group: "TRUST & SAFETY", title: "Fraud & risk", description: "Review suspicious activity and reported accounts.", items: ["Reported users and jobs", "Suspicious account patterns", "Transaction risk flags", "Investigation notes and outcomes"], note: "Risk signals and investigation records are not yet implemented. Do not present automated fraud prevention as an existing capability." },
  reviews: { group: "TRUST & SAFETY", title: "Ratings & reviews", description: "Moderate feedback and reported content.", items: ["Provider ratings and seeker feedback", "Reported reviews", "Content moderation queue", "Moderation audit history"], note: "A review and moderation data model plus permission-checked endpoints are required before this module can display records." },
  transactions: { group: "FINANCIALS", title: "Transactions", description: "Monitor payment attempts and completed marketplace payments.", items: ["Successful, pending and failed payments", "Transaction references and linked jobs", "Refund and chargeback references", "Reconciliation status"], note: "Payment gateway transaction records and webhook reconciliation are not yet connected. No payment totals are fabricated in this portal." },
  commissions: { group: "FINANCIALS", title: "Commissions", description: "Track the proposed marketplace commission model.", items: ["Seeker fee and provider commission", "Commission per completed transaction", "VAT and payment-fee treatment", "Commission adjustments and reporting"], note: "The proposed 5% seeker + 5% provider model must be configurable and reconciled against actual payment records before financial reporting is enabled." },
  payouts: { group: "FINANCIALS", title: "Payouts & refunds", description: "Manage provider settlement and customer refunds.", items: ["Payout eligibility and status", "Payout history", "Refund requests and outcomes", "Chargeback tracking"], note: "Payout and refund operations require payment-provider integration, approval controls and immutable financial audit records." },
  support: { group: "CUSTOMER OPERATIONS", title: "Support tickets", description: "Manage seeker and provider support requests.", items: ["New, open and awaiting response", "Assigned support agent", "Priority and SLA tracking", "Escalation and resolution notes"], note: "A support-ticket model and API are not yet implemented." },
  notifications: { group: "CUSTOMER OPERATIONS", title: "Notifications", description: "Monitor operational and customer notifications.", items: ["Delivery status and failures", "In-app and push notifications", "Retry history", "Operational announcements"], note: "The platform has notification records; staff-facing search, retry and announcement controls still need dedicated APIs and permissions." },
  reports: { group: "ADMINISTRATION", title: "Reports & analytics", description: "Measure marketplace performance using verified operational data.", items: ["Provider and seeker growth", "Request-to-match conversion", "Job completion and cancellation rates", "Disputes, payments and commission reporting"], note: "Reports should be generated from validated source records and clearly show date ranges, definitions and data freshness." },
  audit: { group: "ADMINISTRATION", title: "Audit logs", description: "Review sensitive administrative actions and changes.", items: ["Actor, target and action", "Timestamp and recorded reason", "Before-and-after values where appropriate", "Search and export with restricted access"], note: "Staff audit records already exist for selected workflows; a read-only audit API and portal view still need to be added." },
  settings: { group: "ADMINISTRATION", title: "System settings", description: "Manage controlled marketplace configuration.", items: ["Marketplace configuration", "Service categories", "Commission settings", "Operational feature flags"], note: "Settings must be versioned, permission-controlled and audited. Avoid editing production configuration directly from an unprotected browser form." }
};

function renderModulePage(page) {
  const module = moduleDefinitions[page];
  $("#module-eyebrow").textContent = module.group;
  $("#module-title").textContent = module.title + ".";
  $("#module-description").textContent = module.description;
  $("#module-status").textContent = "API integration required";
  $("#module-content").innerHTML = '<section class="panel module-detail-panel"><div class="module-detail-heading"><strong>Planned administration capabilities</strong><span class="module-state">Not connected to live records</span></div><ul>' +
    module.items.map((item) => '<li>' + escapeHtml(item) + '</li>').join("") +
    '</ul><div class="module-integration-note"><strong>Implementation note</strong><p>' + escapeHtml(module.note) + '</p></div></section>';
}

function renderMetrics() {
  $("#metric-pending").textContent = String(state.identityCases?.length ?? 0);
  $("#metric-review").textContent = String(state.skillReviews?.length ?? 0);
  const metrics = state.dashboardMetrics || {};
  const values = {
    "#metric-active-providers": metrics.activeProviders,
    "#metric-active-seekers": metrics.activeSeekers,
    "#metric-in-progress": metrics.jobsInProgress,
    "#metric-completed": metrics.completedJobs,
    "#metric-scheduled": metrics.scheduledJobs,
    "#metric-pending-jobs": metrics.pendingJobs,
  };
  Object.entries(values).forEach(([selector, value]) => {
    const node = $(selector);
    if (node) node.textContent = Number.isFinite(value) ? value.toLocaleString("en-ZA") : "—";
  });
}
function renderStaffMembers() {
  const list = $("#staff-list");
  if (!state.staffMembers.length) { list.innerHTML = '<div class="empty-state">No staff memberships found.</div>'; return; }
  const labels = { PROVIDER_REVIEWER: "Skills Reviewer", IDENTITY_REVIEWER: "Identity Reviewer", SUPPORT_AGENT: "Support Agent", FINANCE_OFFICER: "Finance Officer", FRAUD_OFFICER: "Fraud Officer", ADMIN: "Administrator", SUPER_ADMIN: "Super Administrator" };
  list.innerHTML = state.staffMembers.map((member) => {
    const email = escapeHtml(member.user?.email || "Staff account");
    const id = escapeHtml(member.user?.id || "");
    const locked = member.role === "SUPER_ADMIN";
    return '<article class="application-row"><div class="applicant-main"><div class="applicant-avatar">' + escapeHtml(initials(email)) + '</div><div class="applicant-copy"><strong>' + email + '</strong><span>' + escapeHtml(labels[member.role] || member.role) + '</span></div></div><div class="applicant-actions"><select aria-label="Staff role" data-staff-role="' + id + '" ' + (locked ? "disabled" : "") + '><option value="PROVIDER_REVIEWER" ' + (member.role === "PROVIDER_REVIEWER" ? "selected" : "") + '>Skills Reviewer</option><option value="IDENTITY_REVIEWER" ' + (member.role === "IDENTITY_REVIEWER" ? "selected" : "") + '>Identity Reviewer</option><option value="SUPPORT_AGENT" ' + (member.role === "SUPPORT_AGENT" ? "selected" : "") + '>Support Agent</option><option value="FINANCE_OFFICER" ' + (member.role === "FINANCE_OFFICER" ? "selected" : "") + '>Finance Officer</option><option value="FRAUD_OFFICER" ' + (member.role === "FRAUD_OFFICER" ? "selected" : "") + '>Fraud Officer</option><option value="ADMIN" ' + (member.role === "ADMIN" ? "selected" : "") + '>Administrator</option></select><button class="button button-light" data-staff-toggle="' + id + '" data-active="' + member.isActive + '" ' + (locked ? "disabled" : "") + '>' + (member.isActive ? "Suspend" : "Reactivate") + '</button><span class="status-pill">' + (member.isActive ? "Active" : "Suspended") + '</span></div></article>';
  }).join("");
}
async function loadStaffMembers() {
  const error = $("#staff-error"); hide(error);
  try { const result = await request("/admin/staff"); state.staffMembers = Array.isArray(result) ? result : []; renderStaffMembers(); }
  catch (e) { error.textContent = e.message; show(error); }
}
async function createStaffMember(event) {
  event.preventDefault(); const button = $("#staff-create-form button[type=submit]"); button.disabled = true;
  try { await request("/admin/staff", { method: "POST", body: JSON.stringify({ email: $("#staff-new-email").value.trim(), role: $("#staff-new-role").value }) }); $("#staff-create-form").reset(); toast("Staff member added."); await loadStaffMembers(); }
  catch (e) { const error = $("#staff-error"); error.textContent = e.message; show(error); }
  finally { button.disabled = false; }
}
async function updateStaffMember(userId, patch) {
  try { await request("/admin/staff/" + encodeURIComponent(userId), { method: "PATCH", body: JSON.stringify(patch) }); toast("Staff permissions updated."); await loadStaffMembers(); }
  catch (e) { const error = $("#staff-error"); error.textContent = e.message; show(error); await loadStaffMembers(); }
}
async function probeAdminPermission(path){try{await request(path);return true;}catch(e){if(e.status===403||e.status===404)return false;throw e;}}
async function loadAdminPermissions(){
 const checks=await Promise.all([
  probeAdminPermission("/admin/identity-reviews"),
  probeAdminPermission("/admin/skill-reviews"),
  probeAdminPermission("/admin/accounts"),
  probeAdminPermission("/admin/staff"),
  probeAdminPermission("/admin/dashboard/metrics")
 ]);
 ["identity","skills","accounts","staff"].forEach((page,i)=>{const nav=document.querySelector('.nav-item[data-page="'+page+'"]');if(nav)checks[i]?show(nav):hide(nav);});
 state.adminPermissions={identity:checks[0],skills:checks[1],accounts:checks[2],staff:checks[3],dashboard:checks[4]};
}
function renderIdentityQueue(){
 const list=$("#identity-list");if(!state.identityCases.length){list.innerHTML='<div class="empty-state">No identity verification cases are awaiting review.</div>';return;}
 list.innerHTML=state.identityCases.map(item=>'<article class="application-row"><div class="applicant-main"><div class="applicant-avatar">'+escapeHtml(initials(item.user?.email))+'</div><div class="applicant-copy"><strong>'+escapeHtml(item.user?.email||"Account")+'</strong><span>Identity: '+escapeHtml(item.user?.identityVerification||item.status)+'</span><div class="applicant-meta">Submitted '+escapeHtml(dateLabel(item.submittedAt))+'</div></div></div><div class="applicant-actions"><span class="status-pill">'+escapeHtml(item.status.replaceAll("_"," "))+'</span><button class="button button-light" data-review-type="identity" data-review-id="'+escapeHtml(item.id)+'">Review identity →</button></div></article>').join("");
}
function renderSkillQueue(){
 const list=$("#skills-list");if(!state.skillReviews.length){list.innerHTML='<div class="empty-state">No individual skills are awaiting review.</div>';return;}
 list.innerHTML=state.skillReviews.map(item=>'<article class="application-row"><div class="applicant-main"><div class="applicant-avatar">'+escapeHtml(initials(item.category))+'</div><div class="applicant-copy"><strong>'+escapeHtml(item.category)+'</strong><span>'+escapeHtml(item.user?.email||"Account")+'</span><div class="applicant-meta">Identity: '+escapeHtml(item.user?.identityVerification||"UNKNOWN")+' · Submitted '+escapeHtml(dateLabel(item.submittedAt))+'</div></div></div><div class="applicant-actions"><span class="status-pill">'+escapeHtml(item.status)+'</span><button class="button button-light" data-review-type="skill" data-review-id="'+escapeHtml(item.id)+'">Review skill →</button></div></article>').join("");
}
async function loadIdentityQueue(){
 hide($("#identity-error"));$("#identity-list").innerHTML='<div class="loading-state">Loading identity reviews…</div>';
 try{const rows=await request("/admin/identity-reviews");state.identityCases=Array.isArray(rows)?rows:[];renderIdentityQueue();$("#nav-identity-count").textContent=String(state.identityCases.length);$("#metric-pending").textContent=String(state.identityCases.length);}
 catch(e){$("#identity-list").innerHTML="";$("#identity-error").textContent=e.message;show($("#identity-error"));}
}
async function loadSkillQueue(){
 hide($("#skills-error"));$("#skills-list").innerHTML='<div class="loading-state">Loading skills…</div>';
 try{const rows=await request("/admin/skill-reviews");state.skillReviews=Array.isArray(rows)?rows:[];renderSkillQueue();$("#nav-skills-count").textContent=String(state.skillReviews.length);$("#metric-review").textContent=String(state.skillReviews.length);}
 catch(e){$("#skills-list").innerHTML="";$("#skills-error").textContent=e.message;show($("#skills-error"));}
}
function renderAdminAccounts(){
 const list=$("#accounts-list");if(!state.accounts.length){list.innerHTML='<div class="empty-state">No accounts found.</div>';return;}
 list.innerHTML=state.accounts.map(a=>{
  const modes=(Array.isArray(a.mode)?a.mode:[]).map(mode=>'<span class="status-pill">'+escapeHtml(mode)+'</span>').join(" ")||"—";
  const skills=(a.skills||[]).map(s=>'<div class="account-skill"><span>'+escapeHtml(s.name)+'</span><span class="status-pill">'+escapeHtml(s.status)+'</span>'+(s.reason?'<small>'+escapeHtml(s.reason)+'</small>':"")+'</div>').join("")||'<span class="applicant-meta">No provider skills recorded</span>';
  const ready=a.identity?.status==="VERIFIED"&&(a.skills||[]).some(s=>s.status==="APPROVED");
  return '<article class="application-row account-row"><div class="applicant-main"><div class="applicant-avatar">'+escapeHtml(initials(a.email))+'</div><div class="applicant-copy"><strong>'+escapeHtml(a.email)+'</strong><span>Mode: '+escapeHtml(modes)+'</span><div class="applicant-meta">Identity: '+escapeHtml(a.identity?.status||"NOT_STARTED")+(a.identity?.reason?" · "+escapeHtml(a.identity.reason):"")+'</div><div class="account-skills"><strong>Skills</strong>'+skills+'</div><div class="applicant-meta">Provider access: '+(ready?"Available":"Not yet available")+' — verified identity and at least one approved skill</div></div></div></article>';
 }).join("");
}
async function loadAdminAccounts(){
 hide($("#accounts-error"));$("#accounts-list").innerHTML='<div class="loading-state">Loading accounts…</div>';
 try{const rows=await request("/admin/accounts");state.accounts=Array.isArray(rows)?rows:[];renderAdminAccounts();}
 catch(e){$("#accounts-list").innerHTML="";$("#accounts-error").textContent=e.message;show($("#accounts-error"));}
}
async function openSeparateReview(type,id){
 const item=(type==="identity"?state.identityCases:state.skillReviews).find(x=>x.id===id);if(!item)return;
 $("#decision-form").dataset.type=type;$("#decision-form").dataset.id=id;$("#decision-reason").value="";hide($("#decision-error"));
 if(type==="identity"){
  $("#review-title").textContent="Review identity documents";$("#review-subtitle").textContent=(item.user?.email||"Account")+" · Submitted "+dateLabel(item.submittedAt);
  const labels={ID_DOCUMENT_FRONT:"Smart ID — front",ID_DOCUMENT_BACK:"Smart ID — back",ID_BOOK_PAGE_1:"Green ID book — details page",ID_BOOK_PAGE_2:"Green ID book — second page",ID_SELFIE:"Live selfie"};
  $("#review-details").innerHTML='<div class="evidence-grid">'+Object.entries(labels).map(([key,label])=>item.documents?.[key]?'<div class="evidence-item"><span>'+escapeHtml(label)+'</span><div data-identity-image="'+escapeHtml(key)+'">Loading securely…</div></div>':'<div class="evidence-item evidence-missing"><span>'+escapeHtml(label)+'</span><small>Not available</small></div>').join("")+'</div>';
  for (const [key,label] of Object.entries(labels)) {
   if (!item.documents?.[key]) continue;
   const slot=$("#review-details [data-identity-image='"+key+"']");
   try {
    const url=await requestBlob("/admin/identity-reviews/"+encodeURIComponent(id)+"/documents/"+encodeURIComponent(key));
    state.identityObjectUrls ||= [];
    state.identityObjectUrls.push(url);
    if(slot) slot.innerHTML='<a href="'+url+'" target="_blank" rel="noopener noreferrer"><img src="'+url+'" alt="'+escapeHtml(label)+'" loading="lazy" referrerpolicy="no-referrer"></a>';
   } catch(error) { if(slot) slot.textContent="Document unavailable: "+error.message; }
  }
  $("#approve-application").textContent="Verify identity";$("#reject-application").textContent="Reject identity";$("#approve-application").disabled=false;
 }else{
  const d=item.details&&typeof item.details==="object"?item.details:{},q=Array.isArray(d.licencesQualifications)?d.licencesQualifications:[],p=Array.isArray(d.portfolio)?d.portfolio:[];
  $("#review-title").textContent=item.category;$("#review-subtitle").textContent=(item.user?.email||"Account")+" · Identity status: "+(item.user?.identityVerification||"UNKNOWN");
  const evidence=(assetId,label)=>{const url=item.providerEvidence?.[assetId];return url?'<a class="evidence-link" href="'+escapeHtml(url)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(label)+' — view attachment</a>':'<span class="evidence-unavailable">'+escapeHtml(label)+' — attachment unavailable</span>';};
  $("#review-details").innerHTML='<section class="detail-block"><h3>Skill overview</h3><p>'+escapeHtml(d.description||"No description supplied")+'</p><p>Experience: '+escapeHtml(d.yearsOfExperience??"Not supplied")+'</p></section><section class="detail-block"><h3>Qualifications and licences</h3>'+(q.length?'<ul>'+q.map(x=>'<li>'+escapeHtml(x.name||"Qualification")+'<br>'+(x.attachmentUrl?evidence(x.attachmentUrl,"Supporting document"):"No attachment supplied")+'</li>').join("")+'</ul>':"<p>None supplied.</p>")+'</section><section class="detail-block"><h3>Portfolio and work examples</h3>'+(p.length?p.map(x=>'<div class="portfolio-review"><strong>'+escapeHtml(x.title||"Work example")+'</strong><p>'+escapeHtml(x.description||"")+'</p>'+(Array.isArray(x.imageUrls)&&x.imageUrls.length?'<div class="evidence-grid">'+x.imageUrls.map((assetId,index)=>{const url=item.providerEvidence?.[assetId];return url?'<div class="evidence-item"><span>Work image '+(index+1)+'</span><a href="'+escapeHtml(url)+'" target="_blank" rel="noopener noreferrer"><img src="'+escapeHtml(url)+'" alt="Portfolio work image '+(index+1)+'" loading="lazy"></a></div>':'<span class="evidence-unavailable">Work image unavailable</span>';}).join("")+'</div>':"")+(x.linkUrl?'<p><a href="'+escapeHtml(x.linkUrl)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(x.linkTitle||x.linkUrl)+'</a></p>':"")+'</div>').join(""):"<p>None supplied.</p>")+'</section>';
  $("#approve-application").textContent="Approve skill";$("#reject-application").textContent="Reject skill";$("#approve-application").disabled=item.user?.identityVerification!=="VERIFIED";
  if(item.user?.identityVerification!=="VERIFIED") $("#review-details").insertAdjacentHTML("beforeend",'<p class="detail-block" role="status">Identity must be verified before this skill can be approved.</p>');
 }
 show($("#review-modal"));
}
async function decideSeparateReview(decision){
 const type=$("#decision-form").dataset.type,id=$("#decision-form").dataset.id,reason=$("#decision-reason").value.trim(),error=$("#decision-error");hide(error);
 if(decision==="REJECTED"&&reason.length<5){error.textContent="A rejection reason of at least five characters is required.";show(error);return;}
 const buttons=[$("#approve-application"),$("#reject-application")];buttons.forEach(b=>b.disabled=true);
 try{
  const path=type==="identity"?"/admin/identity-reviews/"+encodeURIComponent(id)+"/decision":"/admin/skill-reviews/"+encodeURIComponent(id)+"/decision";
  await request(path,{method:"POST",body:JSON.stringify({decision,reason})});hide($("#review-modal"));toast(type==="identity"?(decision==="APPROVED"?"Identity verified.":"Identity rejected."):(decision==="APPROVED"?"Skill approved.":"Skill rejected."));
  const refreshes=[];if(state.adminPermissions?.identity)refreshes.push(loadIdentityQueue());if(state.adminPermissions?.skills)refreshes.push(loadSkillQueue());if(state.adminPermissions?.accounts)refreshes.push(loadAdminAccounts());await Promise.all(refreshes);
 }catch(e){error.textContent=e.message;show(error);}finally{buttons.forEach(b=>b.disabled=false);}
}
function setPage(page){
 ["overview-page","staff-page","module-page","identity-page","skills-page","accounts-page"].forEach(id=>hide($("#"+id)));
 if(page==="overview")show($("#overview-page"));else if(page==="identity"){show($("#identity-page"));void loadIdentityQueue();}
 else if(page==="skills"){show($("#skills-page"));void loadSkillQueue();}else if(page==="accounts"){show($("#accounts-page"));void loadAdminAccounts();}
 else if(page==="staff"){show($("#staff-page"));void loadStaffMembers();}else if(moduleDefinitions[page]){show($("#module-page"));renderModulePage(page);}
 document.querySelectorAll(".nav-item").forEach(item=>item.classList.toggle("active",item.dataset.page===page));
 $("#breadcrumb").textContent=({overview:"Dashboard",identity:"Identity verification",skills:"Skills review",accounts:"Accounts",staff:"Staff & permissions"})[page]||moduleDefinitions[page]?.title||"Overview";
}
async function login(event){
 event.preventDefault();const box=$("#login-error");hide(box);state.api=$("#api-url").value.trim().replace(/\/$/,"");
 const button=$("#login-form button[type=submit]");button.disabled=true;button.textContent="Signing in…";
 try{
  const result=await request("/auth/login",{method:"POST",body:JSON.stringify({email:$("#email").value.trim(),password:$("#password").value})});
  state.accessToken=result.accessToken;state.refreshToken=result.refreshToken;state.staff=await request("/auth/me");
  $("#staff-email").textContent=state.staff.email||"Staff account";$("#staff-avatar").textContent=initials(state.staff.email);
  $("#today-date").textContent=new Intl.DateTimeFormat("en-ZA",{dateStyle:"full"}).format(new Date());hide($("#login-view"));show($("#app-view"));
  await loadAdminPermissions();setPage("overview");await loadDashboardMetrics();
  if(state.adminPermissions.identity)void loadIdentityQueue();if(state.adminPermissions.skills)void loadSkillQueue();
 }catch(e){box.textContent=e.message||"Sign-in failed. Check API URL and CORS configuration.";show(box);state.accessToken="";state.refreshToken="";}
 finally{button.disabled=false;button.innerHTML='Sign in securely <span>→</span>';}
}

async function loadDashboardMetrics(){
 if(!state.adminPermissions?.dashboard){state.dashboardMetrics=null;renderMetrics();return;}
 try{state.dashboardMetrics=await request("/admin/dashboard/metrics");renderMetrics();}
 catch(error){state.dashboardMetrics=null;renderMetrics();toast("Marketplace metrics unavailable: "+(error.message||"check dashboard access"));}
}
$("#login-form").addEventListener("submit",login);
$("#logout-button").addEventListener("click",()=>signOut());
$("#refresh-button").addEventListener("click",async()=>{await loadDashboardMetrics();if(state.adminPermissions?.identity)await loadIdentityQueue();if(state.adminPermissions?.skills)await loadSkillQueue();toast("Dashboard data refreshed.");});
document.querySelectorAll(".nav-item").forEach(item=>item.addEventListener("click",()=>setPage(item.dataset.page)));
document.querySelectorAll("[data-go]").forEach(item=>item.addEventListener("click",()=>setPage(item.dataset.go)));
$("#identity-refresh").addEventListener("click",loadIdentityQueue);
$("#skills-refresh").addEventListener("click",loadSkillQueue);
$("#accounts-refresh").addEventListener("click",loadAdminAccounts);
$("#identity-list").addEventListener("click",event=>{const b=event.target.closest("[data-review-type]");if(b)openSeparateReview("identity",b.dataset.reviewId);});
$("#skills-list").addEventListener("click",event=>{const b=event.target.closest("[data-review-type]");if(b)openSeparateReview("skill",b.dataset.reviewId);});
$("#staff-create-form").addEventListener("submit",createStaffMember);
$("#staff-refresh").addEventListener("click",loadStaffMembers);
$("#staff-list").addEventListener("change",event=>{const el=event.target.closest("[data-staff-role]");if(el)void updateStaffMember(el.dataset.staffRole,{role:el.value});});
$("#staff-list").addEventListener("click",event=>{const el=event.target.closest("[data-staff-toggle]");if(el)void updateStaffMember(el.dataset.staffToggle,{isActive:el.dataset.active!=="true"});});
$("#decision-form").addEventListener("submit",event=>{event.preventDefault();void decideSeparateReview("APPROVED");});
$("#reject-application").addEventListener("click",()=>void decideSeparateReview("REJECTED"));
$("#close-modal").addEventListener("click",()=>{hide($("#review-modal"));for(const url of state.identityObjectUrls||[])URL.revokeObjectURL(url);state.identityObjectUrls=[];});
$("#review-modal").addEventListener("click",event=>{if(event.target===$("#review-modal")){hide($("#review-modal"));for(const url of state.identityObjectUrls||[])URL.revokeObjectURL(url);state.identityObjectUrls=[];}});
document.addEventListener("keydown",event=>{if(event.key==="Escape")hide($("#review-modal"));});
