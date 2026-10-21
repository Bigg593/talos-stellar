import { db } from "@/db";
import { tlsTalos, tlsActivities, tlsCommerceServices } from "@/db/schema";
import { eq, gte, sql } from "drizzle-orm";

// GET /api/talos/:id/availability — Agent online status and service availability
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const talos = await db
      .select({
        id: tlsTalos.id,
        name: tlsTalos.name,
        status: tlsTalos.status,
        agentOnline: tlsTalos.agentOnline,
        agentLastSeen: tlsTalos.agentLastSeen,
      })
      .from(tlsTalos)
      .where(eq(tlsTalos.id, id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!talos) {
      return Response.json({ error: "TALOS not found" }, { status: 404 });
    }

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // ── Recent activity heartbeat ──────────────────────────────────
    const [recentActivity] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tlsActivities)
      .where(
        sql`${tlsActivities.talosId} = ${id} AND ${tlsActivities.createdAt} >= ${oneHourAgo}`,
      );

    const [dailyActivity] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tlsActivities)
      .where(
        sql`${tlsActivities.talosId} = ${id} AND ${tlsActivities.createdAt} >= ${twentyFourHoursAgo}`,
      );

    // ── Service listing ────────────────────────────────────────────
    const service = await db
      .select({
        id: tlsCommerceServices.id,
        serviceName: tlsCommerceServices.serviceName,
        description: tlsCommerceServices.description,
        price: tlsCommerceServices.price,
        currency: tlsCommerceServices.currency,
        fulfillmentMode: tlsCommerceServices.fulfillmentMode,
        updatedAt: tlsCommerceServices.updatedAt,
      })
      .from(tlsCommerceServices)
      .where(eq(tlsCommerceServices.talosId, id))
      .limit(1)
      .then((r) => r[0] ?? null);

    // ── Compute availability status ────────────────────────────────

    // "online" if self-reported OR active in last hour
    const isOnline =
      talos.agentOnline ||
      recentActivity.count > 0;

    // Freshness: how long since last seen
    const lastSeenMs = talos.agentLastSeen
      ? now.getTime() - talos.agentLastSeen.getTime()
      : null;
    const lastSeenMinutes =
      lastSeenMs !== null ? Math.floor(lastSeenMs / 60000) : null;

    // Availability tier
    let availabilityStatus: "online" | "idle" | "offline";
    if (isOnline) {
      availabilityStatus = "online";
    } else if (dailyActivity.count > 0) {
      availabilityStatus = "idle";
    } else {
      availabilityStatus = "offline";
    }

    return Response.json({
      talosId: talos.id,
      talosName: talos.name,
      status: talos.status,
      checkedAt: now.toISOString(),

      availability: {
        status: availabilityStatus,
        agentOnline: talos.agentOnline,
        agentLastSeen: talos.agentLastSeen?.toISOString() ?? null,
        lastSeenMinutesAgo: lastSeenMinutes,
        recentActivityCount1h: recentActivity.count,
        recentActivityCount24h: dailyActivity.count,
        acceptingJobs: availabilityStatus !== "offline" && service !== null,
      },

      service: service
        ? {
            id: service.id,
            serviceName: service.serviceName,
            description: service.description ?? null,
            price: Number(service.price),
            currency: service.currency,
            fulfillmentMode: service.fulfillmentMode,
            listedAt: service.updatedAt.toISOString(),
          }
        : null,
    });
  } catch (err) {
    console.error("[availability GET]", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
