import test from "node:test";
import assert from "node:assert/strict";
import { OnboardingService } from "../dist/onboarding/onboarding.service.js";

function makeService({ mailFailure = false, alreadySubmittedAt = null, activeMarketplaceMode = null, seekerRoleStatus = "NOT_REQUESTED", providerRoleStatus = "PENDING", skillExists = true, staffMembers = [{ userId: "reviewer-1" }] } = {}) {
  const events = [];
  let savedRoleUpdate = null;
  const user = {
    email: "member@example.com",
    initialMode: "PROVIDER",
  };
  const draft = {
    profile: {
      accountType: "INDIVIDUAL",
      marketplaceRoles: ["PROVIDER"],
      firstName: "Sam",
      lastName: "Example",
      phoneDialCode: "+27",
      phone: "821234567",
    },
    skills: [{ category: "electrician", hourlyRate: "250", portfolio: [{ title: "Completed installation" }] }],
    portfolio: [],
    submittedAt: alreadySubmittedAt,
  };
  const prisma = {
    welcomeEmailOutbox: {
      updateMany: async ({ where, data }) => { events.push(["outbox-claim", where, data]); return { count: 1 }; },
      findUniqueOrThrow: async () => ({ recipientEmail: user.email, displayName: "Sam Example", providerReviewPending: true }),
      update: async ({ data }) => { events.push(["outbox-update", data]); },
    },
    onboardingDraft: {
      findUnique: async () => draft,
      updateMany: async ({ where }) => {
        if (where.submittedAt === null && draft.submittedAt === null) {
          draft.submittedAt = new Date("2026-11-22T00:00:00.000Z");
          events.push("first-submission-claimed");
          return { count: 1 };
        }
        return { count: 0 };
      },
      update: async () => { events.push("draft-committed"); },
    },
    providerRoleApplication: {
      findUnique: async () => ({ status: "PENDING" }),
    },
    providerSkill: {
      findMany: async () => [],
      findUnique: async () => ({ status: "PENDING", details: draft.skills[0] }),
      update: async () => {},
      create: async () => {},
    },
    user: {
      findUnique: async () => user,
    },
    $transaction: async (callback) => {
      const tx = {
        onboardingDraft: {
          updateMany: async ({ where }) => {
            if (where.submittedAt === null && draft.submittedAt === null) {
              draft.submittedAt = new Date("2026-11-22T00:00:00.000Z");
              events.push("first-submission-claimed");
              return { count: 1 };
            }
            return { count: 0 };
          },
          update: async () => { events.push("draft-updated"); },
        },
        user: {
          findUniqueOrThrow: async () => ({ seekerRoleStatus, providerRoleStatus, activeMarketplaceMode }),
          update: async ({ data }) => { savedRoleUpdate = data; events.push("roles-updated"); },
        },
        providerSkill: {
          findUnique: async () => skillExists ? ({ status: "PENDING", details: draft.skills[0] }) : null,
          update: async () => {},
          create: async () => { events.push("skill-created"); },
          findMany: async () => [],
        },
        staffMembership: {
          findMany: async () => staffMembers,
        },
        providerProfile: {
          updateMany: async () => ({ count: 1 }),
        },
        providerRoleApplication: {
          findUnique: async () => ({ status: "PENDING" }),
          upsert: async () => {},
        },
        appNotification: {
          create: async ({ data }) => { events.push(["provider-skill-notification", data]); },
          createMany: async ({ data }) => { events.push(["staff-skill-notifications", data]); return { count: data.length }; },
        },
        welcomeEmailOutbox: {
          create: async ({ data }) => { events.push(["outbox-created", data]); return { id: "welcome-1" }; },
        },
      };
      const result = await callback(tx);
      events.push("transaction-committed");
      return result;
    },
  };
  const mail = {
    sendWelcomeEmail: async (...args) => {
      events.push("welcome-email");
      if (mailFailure) throw Object.assign(new Error("SMTP unavailable"), { code: "ECONNECTION" });
      events.push(["mail-args", ...args]);
    },
  };
  const service = new OnboardingService(prisma, mail);
  return { service, events, get savedRoleUpdate() { return savedRoleUpdate; } };
}

test("welcome email is sent after successful full Provider profile submission", async () => {
  const { service, events } = makeService();
  const result = await service.submit("user-1");

  assert.equal(result.welcomeEmailSent, true);
  assert.ok(events.includes("first-submission-claimed"));
  assert.ok(events.some((event) => Array.isArray(event) && event[0] === "outbox-created"));
  assert.ok(events.indexOf("transaction-committed") < events.indexOf("welcome-email"));
  const mailCall = events.find((event) => Array.isArray(event) && event[0] === "mail-args");
  assert.deepEqual(mailCall, ["mail-args", "member@example.com", "Sam Example", true]);
});

test("SMTP failure does not undo a successfully submitted profile", async () => {
  const { service, events } = makeService({ mailFailure: true });
  const result = await service.submit("user-1");

  assert.equal(result.welcomeEmailSent, false);
  assert.ok(events.includes("transaction-committed"));
  assert.ok(events.includes("welcome-email"));
  assert.ok(events.some((event) => Array.isArray(event) && event[0] === "outbox-claim" && event[1].id === "welcome-1" && event[2].status === "PENDING"));
});

test("repeat submission does not resend the initial welcome email", async () => {
  const { service, events } = makeService({ alreadySubmittedAt: new Date("2026-11-21T10:00:00.000Z") });
  const result = await service.submit("user-1");

  assert.equal(result.welcomeEmailSent, false);
  assert.equal(events.includes("welcome-email"), false);
});

test("concurrent first submissions send only one welcome email", async () => {
  const { service, events } = makeService();
  const results = await Promise.all([service.submit("user-1"), service.submit("user-1")]);

  assert.equal(results.filter((result) => result.welcomeEmailSent).length, 1);
  assert.equal(events.filter((event) => event === "welcome-email").length, 1);
});


test("onboarding submission preserves the selected Provider mode for a dual-role account", async () => {
  const state = makeService({
    activeMarketplaceMode: "PROVIDER",
    seekerRoleStatus: "ACTIVE",
    providerRoleStatus: "ACTIVE",
  });
  await state.service.submit("user-1");
  assert.equal(state.savedRoleUpdate.activeMarketplaceMode, "PROVIDER");
});


test("profile management restores saved Provider skill details when the onboarding draft is empty", async () => {
  const prisma = {
    onboardingDraft: {
      findUnique: async () => ({ profile: {}, skills: [], portfolio: [], submittedAt: new Date("2026-11-20T00:00:00.000Z") }),
    },
    providerRoleApplication: { findUnique: async () => null },
    providerSkill: {
      findMany: async () => [{
        category: "plumbing",
        hourlyRate: 275,
        details: { category: "Plumbing", description: "Repairs and installations", yearsOfExperience: "8 years", portfolio: [{ title: "Bathroom installation" }] },
        status: "APPROVED",
        decisionReason: null,
        submittedAt: new Date("2026-11-20T00:00:00.000Z"),
        reviewedAt: new Date("2026-11-21T00:00:00.000Z"),
      }],
    },
  };
  const service = new OnboardingService(prisma, {});
  const result = await service.get("user-1");

  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].category, "Plumbing");
  assert.equal(result.skills[0].yearsOfExperience, "8 years");
  assert.equal(result.skills[0].hourlyRate, "275");
  assert.equal(result.skillReviewStatuses[0].status, "APPROVED");
  assert.ok(result.skillReviewStatuses[0].reviewedAt);
});

test("profile management merges legacy submitted skills with draft details without duplicates", async () => {
  const prisma = {
    onboardingDraft: {
      findUnique: async () => ({ profile: {}, skills: [{ category: "Plumbing", description: "Updated draft" }], portfolio: [] }),
    },
    providerRoleApplication: { findUnique: async () => null },
    providerSkill: {
      findMany: async () => [
        { category: "plumbing", hourlyRate: 260, details: { category: "Plumbing", description: "Old submitted detail" }, status: "APPROVED", decisionReason: null, submittedAt: null, reviewedAt: null },
        { category: "electrical", details: { category: "Electrical", description: "Wiring and repairs" }, status: "PENDING", decisionReason: null, submittedAt: null, reviewedAt: null },
      ],
    },
  };
  const service = new OnboardingService(prisma, {});
  const result = await service.get("user-1");

  assert.deepEqual(result.skills.map((skill) => skill.category), ["Plumbing", "Electrical"]);
  assert.equal(result.skills[0].description, "Updated draft");
  assert.equal(result.skills[0].hourlyRate, "260");
  assert.equal(result.skills[1].description, "Wiring and repairs");
});


test("new skill submission notifies active skill reviewers and administrators", async () => {
  const { service, events } = makeService({
    skillExists: false,
    staffMembers: [{ userId: "reviewer-1" }, { userId: "admin-1" }],
  });

  await service.submit("user-1");

  const notificationEvent = events.find((event) => Array.isArray(event) && event[0] === "staff-skill-notifications");
  assert.ok(notificationEvent, "staff notifications should be created in the submission transaction");
  const providerNotification = events.find((event) => Array.isArray(event) && event[0] === "provider-skill-notification" && event[1].title === "Skill submitted for approval");
  assert.ok(providerNotification, "the Provider should receive a submission notification");
  assert.equal(providerNotification[1].userId, "user-1");
  assert.equal(providerNotification[1].data.type, "PROVIDER_SKILL_SUBMITTED");
  assert.deepEqual(providerNotification[1].data.categories, ["electrician"]);
  assert.equal(notificationEvent[1].length, 2);
  assert.deepEqual(notificationEvent[1].map((item) => item.userId), ["reviewer-1", "admin-1"]);
  assert.equal(notificationEvent[1][0].title, "New skill awaiting approval");
  assert.equal(notificationEvent[1][0].data.type, "PROVIDER_SKILL_SUBMITTED");
  assert.deepEqual(notificationEvent[1][0].data.categories, ["electrician"]);
  assert.ok(events.indexOf("transaction-committed") > events.indexOf("skill-created"));
});

test("unchanged pending skills do not generate duplicate staff review notifications", async () => {
  const { service, events } = makeService({ skillExists: true });

  await service.submit("user-1");

  assert.equal(events.some((event) => Array.isArray(event) && event[0] === "staff-skill-notifications"), false);
});
