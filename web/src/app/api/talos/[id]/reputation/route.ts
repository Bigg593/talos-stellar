import { db } from "@/db";
import {
  tlsTalos,
  tlsRevenues,
  tlsActivities,
  tlsApprovals,
  tlsPatrons,
  tlsCommerceJobs,
} from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";

// GET /api/talos/:id/reputation — Reputation score derived from on-chain activity
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
        category: tlsTalos.category,
        status: tlsTalos.status,
        createdAt: tlsTalos.createdAt,
      })
      .from(tlsTalos)
      .where(eq(tlsTalos.id, id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!talos) {
      return Response.json({ error: "TALOS not found" }, { status: 404 });
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    // ── Revenue (public signal of economic health) ─────────────────
    const [revenueLast30] = await db
      .select({
        total: sql<string>`coalesce(sum(${tlsRevenues.amount}), '0')`,
        count: sql<number>`count(*)::int`,
      })
      .from(tlsRevenues)
      .where(
        and(eq(tlsRevenues.talosId, id), gte(tlsRevenues.createdAt, thirtyDaysAgo)),
      );

    const [revenueLast90] = await db
      .select({
        total: sql<string>`coalesce(sum(${tlsRevenues.amount}), '0')`,
        count: sql<number>`count(*)::int`,
      })
      .from(tlsRevenues)
      .where(
        and(eq(tlsRevenues.talosId, id), gte(tlsRevenues.createdAt, ninetyDaysAgo)),
      );

    // ── Activity volume ────────────────────────────────────────────
    const [activityLast30] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tlsActivities)
      .where(
        and(
          eq(tlsActivities.talosId, id),
          gte(tlsActivities.createdAt, thirtyDaysAgo),
        ),
      );

    // ── Job fulfilment rate (completed vs total) ───────────────────
    const [jobStats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${tlsCommerceJobs.status} = 'completed')::int`,
        failed: sql<number>`count(*) filter (where ${tlsCommerceJobs.status} = 'failed')::int`,
      })
      .from(tlsCommerceJobs)
      .where(eq(tlsCommerceJobs.talosId, id));

    // ── Approval track-record (decided approvals) ──────────────────
    const [approvalStats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        approved: sql<number>`count(*) filter (where ${tlsApprovals.status} = 'approved')::int`,
      })
      .from(tlsApprovals)
      .where(eq(tlsApprovals.talosId, id));

    // ── Patron engagement ──────────────────────────────────────────
    const [patronStats] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tlsPatrons)
      .where(and(eq(tlsPatrons.talosId, id), eq(tlsPatrons.status, "active")));

    // ── Compute reputation score (0-100) ───────────────────────────

    // Age factor: older agents earn trust (+10 max over 90 days)
    const ageMs = now.getTime() - talos.createdAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const ageFactor = Math.min(10, (ageDays / 90) * 10);

    // Revenue consistency factor (+25 max)
    const revenueFactor =
      revenueLast30.count > 0
        ? Math.min(25, (revenueLast30.count / 20) * 25) // 20 tx in 30 days = full score
        : 0;

    // Job fulfilment factor (+30 max)
    const fulfilmentRate =
      jobStats.total > 0 ? jobStats.completed / jobStats.total : 0;
    const jobFactor = fulfilmentRate * 30;

    // Patron trust factor (+20 max)
    const patronFactor = Math.min(20, patronStats.count * 2);

    // Activity engagement factor (+15 max)
    const activityFactor =
      activityLast30.count > 0
        ? Math.min(15, (activityLast30.count / 30) * 15)
        : 0;

    const rawScore =
      ageFactor + revenueFactor + jobFactor + patronFactor + activityFactor;
    const reputationScore = Math.round(Math.max(0, Math.min(100, rawScore)) * 100) / 100;

    // Grade
    const gradeMap: Array<[number, string]> = [
      [90, "AAA"],
      [80, "AA"],
      [70, "A"],
      [60, "BBB"],
      [50, "BB"],
      [40, "B"],
      [30, "CCC"],
    ];
    const reputationGrade =
      gradeMap.find(([threshold]) => reputationScore >= threshold)?.[1] ?? "D";

    return Response.json({
      talosId: talos.id,
      talosName: talos.name,
      category: talos.category,
      status: talos.status,
      generatedAt: now.toISOString(),

      reputationScore,
      reputationGrade,
      reputationSummary:
        reputationScore >= 80
          ? "Highly trusted — strong track record and patron support"
          : reputationScore >= 60
            ? "Good standing — reliable history with room to grow"
            : reputationScore >= 40
              ? "Moderate reputation — limited history or mixed fulfilment"
              : "Low reputation — build activity and complete more jobs",

      signals: {
        agedays: Math.round(ageDays),
        revenueTransactions30d: revenueLast30.count,
        revenueTransactions90d: revenueLast90.count,
        totalRevenue30d: Number(revenueLast30.total),
        activityCount30d: activityLast30.count,
        jobsTotal: jobStats.total,
        jobsCompleted: jobStats.completed,
        jobsFailed: jobStats.failed,
        jobFulfilmentRate: jobStats.total > 0
          ? Math.round((jobStats.completed / jobStats.total) * 10000) / 100
          : null,
        activePatrons: patronStats.count,
        approvalRate: approvalStats.total > 0
          ? Math.round((approvalStats.approved / approvalStats.total) * 10000) / 100
          : null,
      },

      factors: {
        age: Math.round(ageFactor * 100) / 100,
        revenueConsistency: Math.round(revenueFactor * 100) / 100,
        jobFulfilment: Math.round(jobFactor * 100) / 100,
        patronTrust: Math.round(patronFactor * 100) / 100,
        activityEngagement: Math.round(activityFactor * 100) / 100,
      },
    });
  } catch (err) {
    console.error("[reputation GET]", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
