import test from "node:test";
import assert from "node:assert/strict";
import { MarketplaceRolesService } from "../dist/marketplace/marketplace-roles.service.js";

test("activating Seeker preserves Provider mode for an already-active dual-role account", async () => {
  let saved;
  const prisma = {
    user: {
      findUniqueOrThrow: async () => ({
        seekerRoleStatus: "NOT_REQUESTED",
        providerRoleStatus: "ACTIVE",
        activeMarketplaceMode: "PROVIDER",
      }),
      update: async ({ data }) => { saved = data; },
    },
    providerRoleApplication: { findUnique: async () => null },
  };
  const service = new MarketplaceRolesService(prisma, {});
  await service.activateSeeker("user-1");
  assert.equal(saved.seekerRoleStatus, "ACTIVE");
  assert.equal(saved.activeMarketplaceMode, "PROVIDER");
});

test("activating Seeker selects Seeker only when Provider was not the selected active mode", async () => {
  let saved;
  const prisma = {
    user: {
      findUniqueOrThrow: async () => ({
        seekerRoleStatus: "NOT_REQUESTED",
        providerRoleStatus: "ACTIVE",
        activeMarketplaceMode: "SEEKER",
      }),
      update: async ({ data }) => { saved = data; },
    },
    providerRoleApplication: { findUnique: async () => null },
  };
  const service = new MarketplaceRolesService(prisma, {});
  await service.activateSeeker("user-1");
  assert.equal(saved.activeMarketplaceMode, "SEEKER");
});
