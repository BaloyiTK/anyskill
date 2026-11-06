import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { CreateServiceRequestDto, ProviderResponseDto } from "./dto/service-request.dto";

@Injectable()
export class MarketplaceService {
  constructor(private readonly prisma: PrismaService) {}

  async createRequest(seekerId: string, input: CreateServiceRequestDto) {
    // Re-read trusted verification state at the action boundary; never trust client claims.
    const seeker = await this.prisma.user.findUnique({
      where: { id: seekerId },
      select: { identityVerification: true },
    });
    if (!seeker || seeker.identityVerification !== "VERIFIED") {
      throw new ForbiddenException({
        code: "IDENTITY_VERIFICATION_REQUIRED",
        action: "SEEKER_SUBMIT_REQUEST",
        message: "Complete identity verification before submitting your service request.",
      });
    }

    return this.prisma.serviceRequest.create({
      data: {
        seekerId,
        title: input.title.trim(),
        skillCategory: input.skillCategory.trim(),
        description: input.description.trim(),
        imageUrls: input.imageUrls ?? [],
        location: input.location?.trim() || null,
        deliveryMode: input.deliveryMode,
        preferredStartAt: input.preferredStartAt ? new Date(input.preferredStartAt) : null,
        instructions: input.instructions?.trim() || null,
      },
      select: {
        id: true, title: true, skillCategory: true, description: true,
        imageUrls: true, location: true, deliveryMode: true,
        preferredStartAt: true, instructions: true, status: true, createdAt: true,
      },
    });
  }

  async listIncomingRequests(providerId: string, cursor?: string) {
    const requests = await this.prisma.serviceRequest.findMany({
      where: { status: "OPEN", seekerId: { not: providerId } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true, title: true, skillCategory: true, description: true,
        imageUrls: true, location: true, deliveryMode: true,
        preferredStartAt: true, instructions: true, status: true, createdAt: true,
        seeker: { select: { id: true } },
        providerResponses: {
          where: { providerId },
          select: { id: true, status: true, createdAt: true },
        },
      },
    });
    const hasMore = requests.length > 20;
    const items = requests.slice(0, 20).map(({ seeker, providerResponses, ...request }) => ({
      ...request,
      alreadyResponded: providerResponses.length > 0,
      myResponse: providerResponses[0] ?? null,
    }));
    return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
  }

  async listMyRequests(seekerId: string) {
    return this.prisma.serviceRequest.findMany({
      where: { seekerId },
      orderBy: { createdAt: "desc" },
      include: {
        providerResponses: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true, providerId: true, status: true, message: true, createdAt: true,
          },
        },
      },
    });
  }

  async respondToRequest(providerId: string, requestId: string, input: ProviderResponseDto) {
    const provider = await this.prisma.user.findUnique({
      where: { id: providerId },
      select: { identityVerification: true },
    });
    if (!provider || provider.identityVerification !== "VERIFIED") {
      throw new ForbiddenException({
        code: "IDENTITY_VERIFICATION_REQUIRED",
        action: "PROVIDER_ACCEPT_REQUEST",
        message: "You can view this request, but you must complete identity verification before accepting it. Your request will remain available if it has not been taken or closed.",
      });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const request = await tx.serviceRequest.findUnique({
          where: { id: requestId },
          select: { id: true, seekerId: true, status: true },
        });
        if (!request) throw new NotFoundException("This service request could not be found.");
        if (request.seekerId === providerId) {
          throw new ForbiddenException("You cannot respond to your own service request.");
        }
        if (request.status !== "OPEN") {
          throw new ConflictException("This service request is no longer available.");
        }
        return tx.providerResponse.create({
          data: {
            requestId,
            providerId,
            message: input.message?.trim() || null,
            status: "OFFERED",
          },
          select: { id: true, requestId: true, status: true, message: true, createdAt: true },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("You have already responded to this request.");
      }
      throw error;
    }
  }
}
