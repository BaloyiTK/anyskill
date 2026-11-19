import test from "node:test";
import assert from "node:assert/strict";
import { MarketplaceService } from "../dist/marketplace/marketplace.service.js";

function serviceWith(transaction) {
  const prisma = {
    $transaction: async (callback) => callback(transaction),
    user: { findUnique: async () => ({ identityVerification: "VERIFIED", providerProfile: { hourlyRate: 250, assessmentFee: 0 } }) },
  };
  return new MarketplaceService(prisma, {});
}

test("decline records a DECLINED provider response and closes only the provider match", async () => {
  const calls = [];
  const tx = {
    requestMatch: { updateMany: async (args) => { calls.push(["match", args]); return { count: 1 }; } },
    providerResponse: { create: async (args) => { calls.push(["response", args]); return { id: "response-1" }; } },
  };
  const result = await serviceWith(tx).declineIncomingRequest("provider-1", "request-1");

  assert.deepEqual(result, { success: true, requestId: "request-1", status: "DECLINED" });
  assert.deepEqual(calls[0], ["match", {
    where: { requestId: "request-1", providerId: "provider-1", status: "NOTIFIED", request: { status: "OPEN" } },
    data: { status: "EXPIRED" },
  }]);
  assert.deepEqual(calls[1], ["response", {
    data: { requestId: "request-1", providerId: "provider-1", status: "DECLINED" },
  }]);
});

test("decline rejects a request that is no longer awaiting this provider", async () => {
  let responseCreated = false;
  const tx = {
    requestMatch: { updateMany: async () => ({ count: 0 }) },
    providerResponse: { create: async () => { responseCreated = true; } },
  };
  await assert.rejects(
    serviceWith(tx).declineIncomingRequest("different-provider", "request-1"),
    (error) => error.getStatus?.() === 409,
  );
  assert.equal(responseCreated, false);
});

test("accept cannot create an offer after the provider match has expired or been declined", async () => {
  let responseCreated = false;
  const tx = {
    serviceRequest: { findUnique: async () => ({ id: "request-1", seekerId: "seeker-1", status: "OPEN" }) },
    requestMatch: { findUnique: async () => ({ id: "match-1", status: "EXPIRED" }) },
    providerResponse: { create: async () => { responseCreated = true; } },
  };
  await assert.rejects(
    serviceWith(tx).respondToRequest("provider-1", "request-1", {}),
    (error) => error.getStatus?.() === 409,
  );
  assert.equal(responseCreated, false);
});
