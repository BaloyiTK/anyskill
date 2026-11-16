const $ = (selector) => document.querySelector(selector);
const state = { api: "http://localhost:3000/api/v1", accessToken: "", refreshToken: "", staff: null, applications: [], staffMembers: [], dashboardMetrics: null, isSuperAdmin: false, selected: null, busy: false };

const show = (element) => element.classList.remove("hidden");
const hide = (element) => element.classList.add("hidden");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const initials = (value) => String(value || "S").trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "S";
const dateLabel = (value) => value ? new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium" }).format(new Date(value)) : "Date unavailable";
const dataOf = (application) => application?.applicationData && typeof application.applicationData === "object" ? application.applicationData : {};
const messageOf = (payload) => typeof payload?.message === "string" ? payload.message : Array.isArray(payload?.message) ? payload.message.join(", ") : "The request could not be completed.";

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
  state.applications = [];
  show($("#login-view"));
  hide($("#app-view"));
  $("#password").value = "";
}

const moduleDefinitions = {
  "user-providers": { group: "MARKETPLACE", title: "Providers", description: "Provider account register with All, Active, Suspended and application-status filters.", items: ["Provider profile and skills", "Identity verification state", "Availability and service areas", "Provider role status and account-level controls"], note: "The provider register UI is scoped here; connect it to a protected, paginated user-management API before showing live accounts or changing access." },
  "user-seekers": { group: "MARKETPLACE", title: "Seekers", description: "Seeker account register with All, Active and Suspended tabs.", items: ["Seeker profile and contact details", "Marketplace roles (including dual-role accounts)", "Account status and registration date", "Role-level suspension kept separate from whole-account suspension"], note: "The seeker register UI is scoped here; connect it to a protected, paginated user-management API before showing live accounts or changing access." },
  jobs: { group: "MARKETPLACE", title: "Jobs & requests", description: "Central register for service requests and job engagements.", items: ["All jobs", "Informal services (service category, not a lifecycle status)", "Pending and matching", "In progress and scheduled", "Cancelled and completed", "Disputes and escalations"], note: "Job records need a unified, paginated API joining requests, provider responses and engagements. The current schema does not yet contain a complete cancellation/dispute case workflow." },
  identity: { group: "TRUST & SAFETY", title: "Identity verification", description: "Review identity cases separately from provider skill and qualification approval.", items: ["Submitted and awaiting review", "Under review", "Approved and rejected", "More information required", "Reviewer notes and decision history"], note: "Identity case records exist in the database; a dedicated reviewer API, evidence access policy and decision workflow still need to be connected." },
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

function setPage(page) {
  const providers = page === "providers";
  const module = Boolean(moduleDefinitions[page]);
  hide($("#overview-page")); hide($("#providers-page")); hide($("#staff-page")); hide($("#module-page"));
  if (providers) show($("#providers-page"));
  else if (page === "staff") show($("#staff-page"));
  else if (module) { show($("#module-page")); renderModulePage(page); }
  else show($("#overview-page"));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  const labels = { overview: "Dashboard", providers: "Provider applications", staff: "Staff & permissions" };
  $("#breadcrumb").textContent = labels[page] || moduleDefinitions[page]?.title || "Overview";
  if (providers) void loadApplications();
  if (page === "staff") void loadStaffMembers();
}

async function login(event) {
  event.preventDefault();
  const errorBox = $("#login-error");
  hide(errorBox);
  state.api = $("#api-url").value.trim().replace(/\/$/, "");
  if (!state.api) return;
  const button = $("#login-form button[type=submit]");
  button.disabled = true; button.textContent = "Signing in…";
  try {
    const result = await request("/auth/login", { method: "POST", body: JSON.stringify({ email: $("#email").value.trim(), password: $("#password").value }) });
    state.accessToken = result.accessToken;
    state.refreshToken = result.refreshToken;
    const me = await request("/auth/me");
    state.staff = me;
    const apps = await request("/admin/provider-applications");
    state.applications = Array.isArray(apps) ? apps : [];
    try { await request("/admin/staff"); state.isSuperAdmin = true; show($("#staff-nav")); } catch { state.isSuperAdmin = false; hide($("#staff-nav")); }
    $("#staff-email").textContent = me.email || "Staff account";
    $("#staff-avatar").textContent = initials(me.email);
    $("#today-date").textContent = new Intl.DateTimeFormat("en-ZA", { dateStyle: "full" }).format(new Date());
    hide($("#login-view")); show($("#app-view"));
    renderMetrics();
    renderApplications();
    await loadDashboardMetrics();
    setPage("overview");
  } catch (error) {
    errorBox.textContent = error.status === 403
      ? "Your account is signed in, but it does not have an active staff permission to access Provider reviews. Ask an administrator to grant the appropriate staff role."
      : error.message || "Sign-in failed.";
    show(errorBox);
    state.accessToken = ""; state.refreshToken = "";
  } finally {
    button.disabled = false; button.innerHTML = 'Sign in securely <span>→</span>';
  }
}

function renderMetrics() {
  const pending = state.applications.filter((item) => item.status === "PENDING").length;
  const review = state.applications.filter((item) => item.status === "UNDER_REVIEW").length;
  $("#metric-pending").textContent = String(state.dashboardMetrics?.pendingApplications ?? pending);
  $("#metric-review").textContent = String(state.dashboardMetrics?.applicationsUnderReview ?? review);
  $("#priority-count").textContent = String(state.applications.length);
  $("#nav-pending").textContent = String(state.applications.length);
  $("#queue-total").textContent = String(state.applications.length);
  const metrics = state.dashboardMetrics || {};
  const values = {
    "#metric-active-providers": metrics.activeProviders,
    "#metric-active-seekers": metrics.activeSeekers,
    "#metric-in-progress": metrics.jobsInProgress,
    "#metric-completed": metrics.completedJobs,
    "#metric-scheduled": metrics.scheduledJobs,
    "#metric-pending-jobs": metrics.pendingJobs,
  };
  Object.entries(values).forEach(([selector, value]) => { $(selector).textContent = Number.isFinite(value) ? value.toLocaleString("en-ZA") : "—"; });
}
async function loadDashboardMetrics() {
  try { state.dashboardMetrics = await request("/admin/dashboard/metrics"); renderMetrics(); }
  catch (error) { state.dashboardMetrics = null; renderMetrics(); toast("Marketplace metrics unavailable: " + (error.message || "check dashboard access")); }
}

function renderStaffMembers() {
  const list = $("#staff-list");
  if (!state.staffMembers.length) { list.innerHTML = '<div class="empty-state">No staff memberships found.</div>'; return; }
  const labels = { PROVIDER_REVIEWER: "Provider Reviewer", IDENTITY_REVIEWER: "Identity Reviewer", SUPPORT_AGENT: "Support Agent", FINANCE_OFFICER: "Finance Officer", FRAUD_OFFICER: "Fraud Officer", ADMIN: "Administrator", SUPER_ADMIN: "Super Administrator" };
  list.innerHTML = state.staffMembers.map((member) => {
    const email = escapeHtml(member.user?.email || "Staff account");
    const id = escapeHtml(member.user?.id || "");
    const locked = member.role === "SUPER_ADMIN";
    return '<article class="application-row"><div class="applicant-main"><div class="applicant-avatar">' + escapeHtml(initials(email)) + '</div><div class="applicant-copy"><strong>' + email + '</strong><span>' + escapeHtml(labels[member.role] || member.role) + '</span></div></div><div class="applicant-actions"><select aria-label="Staff role" data-staff-role="' + id + '" ' + (locked ? "disabled" : "") + '><option value="PROVIDER_REVIEWER" ' + (member.role === "PROVIDER_REVIEWER" ? "selected" : "") + '>Provider Reviewer</option><option value="IDENTITY_REVIEWER" ' + (member.role === "IDENTITY_REVIEWER" ? "selected" : "") + '>Identity Reviewer</option><option value="SUPPORT_AGENT" ' + (member.role === "SUPPORT_AGENT" ? "selected" : "") + '>Support Agent</option><option value="FINANCE_OFFICER" ' + (member.role === "FINANCE_OFFICER" ? "selected" : "") + '>Finance Officer</option><option value="FRAUD_OFFICER" ' + (member.role === "FRAUD_OFFICER" ? "selected" : "") + '>Fraud Officer</option><option value="ADMIN" ' + (member.role === "ADMIN" ? "selected" : "") + '>Administrator</option></select><button class="button button-light" data-staff-toggle="' + id + '" data-active="' + member.isActive + '" ' + (locked ? "disabled" : "") + '>' + (member.isActive ? "Suspend" : "Reactivate") + '</button><span class="status-pill">' + (member.isActive ? "Active" : "Suspended") + '</span></div></article>';
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
function renderApplications() {
  const filter = $("#queue-filter").value;
  const items = state.applications.filter((item) => filter === "ALL" || item.status === filter);
  $("#queue-total").textContent = String(items.length);
  if (!items.length) {
    $("#application-list").innerHTML = '<div class="empty-state">You’re all caught up. There are no applications in this view.</div>';
    return;
  }
  $("#application-list").innerHTML = items.map((application) => {
    const data = dataOf(application);
    const name = data.publicName || "Provider applicant";
    const skills = Array.isArray(data.skills) ? data.skills.slice(0, 3).join(" · ") : "Skills not supplied";
    const status = application.status === "UNDER_REVIEW" ? "Under review" : "Awaiting review";
    const statusClass = application.status === "UNDER_REVIEW" ? "review" : "";
    return `<article class="application-row">
      <div class="applicant-main"><div class="applicant-avatar">${escapeHtml(initials(name))}</div><div class="applicant-copy"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(application.user?.email || "Email unavailable")}</span><div class="applicant-meta">${escapeHtml(skills)} · Submitted ${escapeHtml(dateLabel(application.submittedAt))}</div></div></div>
      <div class="applicant-actions"><span class="status-pill ${statusClass}">${status}</span><button class="button button-light" data-review-id="${escapeHtml(application.id)}">Review application →</button></div>
    </article>`;
  }).join("");
}

async function loadApplications() {
  const list = $("#application-list");
  const errorBox = $("#queue-error");
  hide(errorBox);
  list.innerHTML = '<div class="loading-state">Loading provider applications…</div>';
  try {
    const apps = await request("/admin/provider-applications");
    state.applications = Array.isArray(apps) ? apps : [];
    renderMetrics(); renderApplications();
  } catch (error) {
    list.innerHTML = "";
    errorBox.textContent = error.status === 403
      ? "Your staff permissions do not allow Provider application review."
      : error.message || "Could not load the application queue.";
    show(errorBox);
  }
}

async function openReview(id) {
  const application = state.applications.find((item) => item.id === id);
  if (!application) return;
  state.selected = application;
  const data = dataOf(application);
  $("#review-title").textContent = data.publicName || "Provider applicant";
  $("#review-subtitle").textContent = `${application.user?.email || "Email unavailable"} · Submitted ${dateLabel(application.submittedAt)}`;
  const block = (title, content) => `<section class="detail-block"><h3>${escapeHtml(title)}</h3>${content}</section>`;
  const list = (values) => Array.isArray(values) && values.length ? `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>` : "<p>Not supplied</p>";
  const identity = application.user?.identityVerification || "UNKNOWN";
  const profile = application.user?.onboardingDraft?.profile && typeof application.user.onboardingDraft.profile === "object"
    ? application.user.onboardingDraft.profile : {};
  const skillDetails = Array.isArray(data.skillDetails) ? data.skillDetails : [];
  const docs = application.identityDocuments || {};
  const image = (label, url) => url
    ? `<div class="evidence-item"><span>${escapeHtml(label)}</span><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" loading="lazy" /></a></div>`
    : `<div class="evidence-item evidence-missing"><span>${escapeHtml(label)}</span><small>Not available</small></div>`;
  const profileDetails = [
    ["Name", [profile.firstName, profile.lastName].filter(Boolean).join(" ")],
    ["Account type", profile.accountType],
    ["Phone", profile.phone],
    ["Business", profile.businessName],
    ["Location", [profile.suburb, profile.city, profile.province, profile.country].filter(Boolean).join(", ")],
  ].filter(([, value]) => value);
  const profileContent = profileDetails.length
    ? `<dl class="review-facts">${profileDetails.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`
    : "<p>Profile details were not included in the application snapshot.</p>";
  const skillContent = skillDetails.length
    ? skillDetails.map((skill) => {
        const qualifications = Array.isArray(skill.licencesQualifications) ? skill.licencesQualifications : [];
        const portfolio = Array.isArray(skill.portfolio) ? skill.portfolio : [];
        return `<div class="skill-review"><strong>${escapeHtml(skill.category || "Skill")}</strong><p>${escapeHtml(skill.description || "No overview supplied")}</p><p>Experience: ${escapeHtml(skill.yearsOfExperience ?? "Not supplied")}</p>${list(qualifications.map((item) => item.name || "Qualification"))}${portfolio.length ? list(portfolio.map((item) => item.title || "Work example")) : "<p>No portfolio examples supplied.</p>"}</div>`;
      }).join("")
    : list(data.skills);
  const identityCase = application.user?.identityCase;
  const identityContent = `<p>Identity status: <strong>${escapeHtml(identity)}</strong></p><p>Case status: <strong>${escapeHtml(identityCase?.status || (identity === "VERIFIED" ? "Previously verified" : "No submitted case"))}</strong></p><div class="evidence-grid">${image("ID document — front", docs.ID_DOCUMENT_FRONT)}${image("ID document — back", docs.ID_DOCUMENT_BACK)}${image("Green ID book — page 1", docs.ID_BOOK_PAGE_1)}${image("Green ID book — page 2", docs.ID_BOOK_PAGE_2)}${image("Live selfie", docs.ID_SELFIE)}</div>`;
  $("#review-details").innerHTML =
    block("Applicant profile", profileContent) +
    block("Identity documents and selfie — review as part of this application", identityContent) +
    block("Skills, experience and descriptions", skillContent) +
    block("Qualifications and licences", list(data.qualifications)) +
    block("Portfolio and work examples", list(data.portfolio)) +
    block("Account checks", `<p>Email: ${escapeHtml(application.user?.email || "Not available")}</p><p>Application status: ${escapeHtml(application.status)}</p><p>Submitted: ${escapeHtml(dateLabel(application.submittedAt))}</p>`);
  $("#decision-reason").value = "";
  hide($("#decision-error"));
  $("#decision-form").dataset.id = id;
  $("#decision-form").dataset.status = application.status;
  $("#needs-info").disabled = false;
  $("#reject-application").disabled = false;
  $("#approve-application").disabled = false;
  show($("#review-modal"));
  if (application.status === "PENDING") {
    try {
      await request(`/admin/provider-applications/${encodeURIComponent(id)}/start-review`, { method: "POST" });
      application.status = "UNDER_REVIEW";
      $("#decision-form").dataset.status = "UNDER_REVIEW";
      renderApplications(); renderMetrics();
    } catch (error) {
      $("#decision-error").textContent = error.message;
      show($("#decision-error"));
    }
  }
}

async function decide(decision) {
  const id = $("#decision-form").dataset.id;
  const reason = $("#decision-reason").value.trim();
  const errorBox = $("#decision-error");
  hide(errorBox);
  if (!reason || reason.length < 5) {
    errorBox.textContent = "Please provide a decision reason of at least five characters.";
    show(errorBox); return;
  }
  const buttons = [$("#needs-info"), $("#reject-application"), $("#approve-application")];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    await request(`/admin/provider-applications/${encodeURIComponent(id)}/decision`, {
      method: "POST", body: JSON.stringify({ decision, reason }),
    });
    hide($("#review-modal"));
    toast(decision === "APPROVED" ? "Provider role approved." : decision === "REJECTED" ? "Application rejected." : "More information requested.");
    await loadApplications();
  } catch (error) {
    errorBox.textContent = error.message || "The decision could not be saved.";
    show(errorBox);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

$("#login-form").addEventListener("submit", login);
$("#logout-button").addEventListener("click", () => signOut());
$("#refresh-button").addEventListener("click", async () => { await Promise.all([loadApplications(), loadDashboardMetrics()]); toast("Dashboard data refreshed."); });
$("#queue-refresh").addEventListener("click", loadApplications);
$("#queue-filter").addEventListener("change", renderApplications);
$("#staff-create-form").addEventListener("submit", createStaffMember);
$("#staff-refresh").addEventListener("click", loadStaffMembers);
$("#staff-list").addEventListener("change", (event) => { const el = event.target.closest("[data-staff-role]"); if (el) void updateStaffMember(el.dataset.staffRole, { role: el.value }); });
$("#staff-list").addEventListener("click", (event) => { const el = event.target.closest("[data-staff-toggle]"); if (el) void updateStaffMember(el.dataset.staffToggle, { isActive: el.dataset.active !== "true" }); });
document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => setPage(item.dataset.page)));
document.querySelectorAll("[data-go]").forEach((item) => item.addEventListener("click", () => setPage(item.dataset.go)));
$("#application-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-review-id]");
  if (button) void openReview(button.dataset.reviewId);
});
$("#close-modal").addEventListener("click", () => hide($("#review-modal")));
$("#review-modal").addEventListener("click", (event) => { if (event.target === $("#review-modal")) hide($("#review-modal")); });
$("#decision-form").addEventListener("submit", (event) => { event.preventDefault(); void decide("APPROVED"); });
$("#reject-application").addEventListener("click", () => void decide("REJECTED"));
$("#needs-info").addEventListener("click", () => void decide("NEEDS_INFORMATION"));
document.addEventListener("keydown", (event) => { if (event.key === "Escape") hide($("#review-modal")); });
