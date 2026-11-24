import test from "node:test";
import assert from "node:assert/strict";
import { OnboardingService } from "../dist/onboarding/onboarding.service.js";

function makeService({ mailFailure = false, alreadySubmittedAt = null, activeMarketplaceMode = null, seekerRoleStatus = "NOT_REQUESTED", providerRoleStatus = "PENDING" } = {}) {
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
    skills: [{ category: "electrician", portfolio: [{ title: "Completed installation" }] }],
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
          findUnique: async () => ({ status: "PENDING", details: draft.skills[0] }),
          update: async () => {},
          create: async () => {},
        },
        providerRoleApplication: {
          findUnique: async () => ({ status: "PENDING" }),
          upsert: async () => {},
        },
        appNotification: { create: async () => {} },
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
