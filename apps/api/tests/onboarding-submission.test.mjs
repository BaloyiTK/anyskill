import test from "node:test";
import assert from "node:assert/strict";
import { OnboardingService } from "../dist/onboarding/onboarding.service.js";

function makeService({ mailFailure = false, alreadySubmittedAt = null } = {}) {
  const events = [];
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
    onboardingDraft: {
      findUnique: async () => draft,
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
        onboardingDraft: { update: async () => { events.push("draft-updated"); } },
        user: {
          findUniqueOrThrow: async () => ({ seekerRoleStatus: "NOT_REQUESTED", providerRoleStatus: "PENDING" }),
          update: async () => { events.push("roles-updated"); },
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
  return { service, events };
}

test("welcome email is sent after successful full Provider profile submission", async () => {
  const { service, events } = makeService();
  const result = await service.submit("user-1");

  assert.equal(result.welcomeEmailSent, true);
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
});

test("repeat submission does not resend the initial welcome email", async () => {
  const { service, events } = makeService({ alreadySubmittedAt: new Date("2026-11-21T10:00:00.000Z") });
  const result = await service.submit("user-1");

  assert.equal(result.welcomeEmailSent, false);
  assert.equal(events.includes("welcome-email"), false);
});
