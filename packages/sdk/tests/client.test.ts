import { describe, it, expect, vi, beforeEach } from "vitest";
import { TalosClient, TalosAPIError } from "../src/client.js";

describe("TalosClient - Request/Response Behavior", () => {
  const client = new TalosClient({ baseUrl: "http://localhost:3000", apiKey: "test-key" });

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("Success Cases", () => {
    it("should list taloses with pagination", async () => {
      const mockData = { data: [{ id: "1", name: "Talos 1" }], nextCursor: "cursor-123" };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      } as Response);

      const result = await client.listTaloses({ limit: 10, cursor: "cursor-123" });

      expect(fetch).toHaveBeenCalledWith("http://localhost:3000/api/talos?limit=10&cursor=cursor-123", expect.any(Object));
      expect(result).toEqual(mockData);
    });

    it("should get talos detail", async () => {
      const mockData = { id: "1", name: "Talos 1" };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      } as Response);

      const result = await client.getTalos("1");

      expect(fetch).toHaveBeenCalledWith("http://localhost:3000/api/talos/1", expect.any(Object));
      expect(result).toEqual(mockData);
    });

    it("should create talos", async () => {
      const params = { name: "New Talos", category: "Test", description: "Desc" };
      const mockData = { id: "2", ...params, apiKeyOnce: "new-key" };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => mockData,
      } as Response);

      const result = await client.createTalos(params);

      expect(fetch).toHaveBeenCalledWith("http://localhost:3000/api/talos", expect.objectContaining({
        method: "POST",
        body: JSON.stringify(params),
      }));
      expect(result).toEqual(mockData);
    });
  });

  describe("Headers", () => {
    it("should include Content-Type header by default", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ id: "1" }),
      } as Response);

      await client.getTalos("1");

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[1]?.headers).toHaveProperty("Content-Type", "application/json");
    });

    it("should include Authorization header when apiKey is provided", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ id: "1" }),
      } as Response);

      await client.getTalos("1");

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[1]?.headers).toHaveProperty("Authorization", "Bearer test-key");
    });

    it("should merge custom headers with default headers", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ paymentHeader: "test" }),
      } as Response);

      await client.purchaseService("talos-1", {
        paymentHeader: "custom-header",
        payload: { test: "data" },
      });

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[1]?.headers).toHaveProperty("Content-Type", "application/json");
      expect(fetchCall[1]?.headers).toHaveProperty("Authorization", "Bearer test-key");
      expect(fetchCall[1]?.headers).toHaveProperty("X-PAYMENT", "custom-header");
    });

    it("should not include Authorization header when apiKey is not provided", async () => {
      const clientNoAuth = new TalosClient({ baseUrl: "http://localhost:3000" });
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ id: "1" }),
      } as Response);

      await clientNoAuth.getTalos("1");

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[1]?.headers).not.toHaveProperty("Authorization");
    });
  });

  describe("URL Encoding", () => {
    it("should properly encode query parameters", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ data: [], nextCursor: null }),
      } as Response);

      await client.listTaloses({ cursor: "cursor with spaces&special=chars" });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("cursor=cursor+with+spaces%26special%3Dchars"),
        expect.any(Object)
      );
    });

    it("should handle boolean parameters in query string", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ data: [], nextCursor: null }),
      } as Response);

      await client.listActivities({ statsOnly: true });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("statsOnly=true"),
        expect.any(Object)
      );
    });

    it("should filter undefined parameters from query string", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ data: [], nextCursor: null }),
      } as Response);

      await client.listTaloses({ limit: 10, cursor: undefined });

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/talos?limit=10",
        expect.any(Object)
      );
    });

    it("should encode special characters in path parameters", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ id: "test-id" }),
      } as Response);

      await client.getTalos("id-with/slash");

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/talos/id-with/slash",
        expect.any(Object)
      );
    });
  });

  describe("Standardized API Errors", () => {
    it("should throw TalosAPIError on 400 Bad Request", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => "Bad Request",
      } as Response);

      await expect(client.getTalos("1")).rejects.toThrow(TalosAPIError);
      await expect(client.getTalos("1")).rejects.toThrow("Talos API error 400 on /api/talos/1: Bad Request");
    });

    it("should throw TalosAPIError on 401 Unauthorized", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      } as Response);

      await expect(client.getTalos("1")).rejects.toThrow(TalosAPIError);
      await expect(client.getTalos("1")).rejects.toThrow("Talos API error 401 on /api/talos/1: Unauthorized");
    });

    it("should throw TalosAPIError on 403 Forbidden", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      } as Response);

      await expect(client.getTalos("1")).rejects.toThrow(TalosAPIError);
    });

    it("should throw TalosAPIError on 404 Not Found", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "Not Found",
      } as Response);

      await expect(client.getTalos("1")).rejects.toThrow(TalosAPIError);
    });

    it("should throw TalosAPIError on 500 Internal Server Error", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: async () => "Internal Server Error",
      } as Response);

      await expect(client.getTalos("1")).rejects.toThrow(TalosAPIError);
    });

    it("should include status, body, and path in TalosAPIError", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => "Validation Error",
      } as Response);

      try {
        await client.getTalos("1");
        expect.fail("Should have thrown TalosAPIError");
      } catch (error) {
        expect(error).toBeInstanceOf(TalosAPIError);
        const apiError = error as TalosAPIError;
        expect(apiError.status).toBe(422);
        expect(apiError.body).toBe("Validation Error");
        expect(apiError.path).toBe("/api/talos/1");
      }
    });
  });

it("should fetch one activity page with typed cursor response", async () => {
    const mockPage = {
      stats: {
        totalTransactions: 1,
        totalVolume: 100,
        activeAgents: 2,
        totalAgents: 5,
        registeredServices: 3,
        playbooksTraded: 0,
      },
      transactions: [
        {
          id: "txn-1",
          type: "service",
          sellerName: "Seller",
          sellerAgent: "seller-agent",
          buyerName: "Buyer",
          buyerAgent: "buyer-agent",
          itemName: "Service Pack",
          amount: 100,
          currency: "USDC",
          status: "completed",
          timestamp: "2026-07-24T12:00:00.000Z",
          txHash: "ABC123",
        },
      ],
      nextCursor: "2026-07-24T11:00:00.000Z",
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockPage,
    } as Response);

    const result = await client.listActivities({ limit: 5, cursor: "2026-07-24T13:00:00.000Z" });

    const [[url]] = vi.mocked(fetch).mock.calls;
    expect(url).toContain("http://localhost:3000/api/activity");
    expect(url).toContain("cursor=2026-07-24T13%3A00%3A00.000Z");
    expect(url).toContain("limit=5");
    expect(result).toEqual(mockPage);
  });

  it("should pass abort signal through activity page requests", async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Request aborted"));

    await expect(client.listActivities({ signal: controller.signal })).rejects.toThrow("Request aborted");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/activity",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("should request activity pages with statsOnly and pagination params", async () => {
    const mockPage = {
      stats: {
        totalTransactions: 0,
        totalVolume: 0,
        activeAgents: 0,
        totalAgents: 0,
        registeredServices: 0,
        playbooksTraded: 0,
      },
      transactions: [],
      nextCursor: null,
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockPage,
    } as Response);

    const result = await client.listActivities({ limit: 5, cursor: "2026-07-24T13:00:00.000Z", statsOnly: true });

    const [[url]] = vi.mocked(fetch).mock.calls;
    expect(url).toContain("http://localhost:3000/api/activity");
    expect(url).toContain("cursor=2026-07-24T13%3A00%3A00.000Z");
    expect(url).toContain("limit=5");
    expect(url).toContain("statsOnly=true");
    expect(result).toEqual(mockPage);
  });

  describe("Malformed JSON Response", () => {
    it("should handle invalid JSON in response", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      } as unknown as Response);
      
      await expect(client.getTalos("1")).rejects.toThrow(SyntaxError);
    });

    it("should handle non-JSON response when JSON expected", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      } as unknown as Response);

      await expect(client.getTalos("1")).rejects.toThrow();
    });
  });

  describe("Timeout", () => {
    it("should handle request timeout", async () => {
      vi.mocked(fetch).mockImplementation(() =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Request timeout")), 100)
        )
      );

      await expect(client.getTalos("1")).rejects.toThrow("Request timeout");
    });
  });

  describe("Abort", () => {
    it("should handle aborted request", async () => {
      const abortController = new AbortController();
      vi.mocked(fetch).mockImplementation(() =>
        new Promise((_, reject) => {
          abortController.abort();
          reject(new DOMException("Aborted", "AbortError"));
        })
      );

      await expect(client.getTalos("1")).rejects.toThrow("Aborted");
    });
  });

  describe("Network Failure", () => {
    it("should handle network error", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

      await expect(client.getTalos("1")).rejects.toThrow("Network error");
    });

    it("should handle DNS resolution failure", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(client.getTalos("1")).rejects.toThrow("ECONNREFUSED");
    });

    it("should handle connection reset", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("ECONNRESET"));

      await expect(client.getTalos("1")).rejects.toThrow("ECONNRESET");
    });
  });

  describe("x402 Payment Flow", () => {
    it("should handle x402 flow in purchaseServiceWithPayment", async () => {
      // 1st call: 402 challenge
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 402,
        ok: false,
        headers: new Headers({
          "WWW-Authenticate": 'x402 price="0.50", payee="GABC", token="USDC", network="stellar:testnet"',
        }),
      } as Response);

      // 2nd call: signPayment (internal called by purchaseServiceWithPayment)
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ paymentHeader: "signed-header" }),
      } as Response);

      // 3rd call: actual purchase with header
      const mockJob = { id: "job-1", status: "pending" };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockJob,
      } as Response);

      const result = await client.purchaseServiceWithPayment("provider-id", "buyer-id", { foo: "bar" });

      expect(result).toEqual(mockJob);
      expect(fetch).toHaveBeenCalledTimes(3);

      // Check sign call
      expect(fetch).toHaveBeenNthCalledWith(2, "http://localhost:3000/api/talos/buyer-id/sign", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ payee: "GABC", amount: 0.5, assetCode: "USDC" }),
      }));

      // Check final purchase call
      expect(fetch).toHaveBeenNthCalledWith(3, "http://localhost:3000/api/talos/provider-id/service", expect.objectContaining({
        headers: expect.objectContaining({ "X-PAYMENT": "signed-header" }),
      }));
    });

    it("should throw error on invalid x402 challenge format", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 402,
        ok: false,
        headers: new Headers({
          "WWW-Authenticate": "Invalid challenge format",
        }),
      } as Response);

      await expect(client.purchaseServiceWithPayment("provider-id", "buyer-id")).rejects.toThrow("Invalid x402 challenge");
    });

    it("should throw error on missing WWW-Authenticate header", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 402,
        ok: false,
        headers: new Headers(),
      } as Response);

      await expect(client.purchaseServiceWithPayment("provider-id", "buyer-id")).rejects.toThrow("Invalid x402 challenge");
    });
  });

  describe("Request and Retry Policy", () => {
    it("should fetch one activity page with typed cursor response", async () => {
      const mockPage = {
        stats: {
          totalTransactions: 1,
          totalVolume: 100,
          activeAgents: 2,
          totalAgents: 5,
          registeredServices: 3,
          playbooksTraded: 0,
        },
        transactions: [
          {
            id: "txn-1",
            type: "service",
            sellerName: "Seller",
            sellerAgent: "seller-agent",
            buyerName: "Buyer",
            buyerAgent: "buyer-agent",
            itemName: "Service Pack",
            amount: 100,
            currency: "USDC",
            status: "completed",
            timestamp: "2026-07-24T12:00:00.000Z",
            txHash: "ABC123",
          },
        ],
        nextCursor: "2026-07-24T11:00:00.000Z",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPage,
      } as Response);

      const result = await client.listActivities({ limit: 5, cursor: "2026-07-24T13:00:00.000Z" });

      const [[url]] = vi.mocked(fetch).mock.calls;
      expect(url).toContain("http://localhost:3000/api/activity");
      expect(url).toContain("cursor=2026-07-24T13%3A00%3A00.000Z");
      expect(url).toContain("limit=5");
      expect(result).toEqual(mockPage);
    });

    it("should pass abort signal through activity page requests", async () => {
      const controller = new AbortController();
      vi.mocked(fetch).mockRejectedValueOnce(new Error("Request aborted"));

      await expect(client.listActivities({ signal: controller.signal })).rejects.toThrow("Request aborted");
      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/activity",
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it("should request activity pages with statsOnly and pagination params", async () => {
      const mockPage = {
        stats: {
          totalTransactions: 0,
          totalVolume: 0,
          activeAgents: 0,
          totalAgents: 0,
          registeredServices: 0,
          playbooksTraded: 0,
        },
        transactions: [],
        nextCursor: null,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPage,
      } as Response);

      const result = await client.listActivities({ limit: 5, cursor: "2026-07-24T13:00:00.000Z", statsOnly: true });

      const [[url]] = vi.mocked(fetch).mock.calls;
      expect(url).toContain("http://localhost:3000/api/activity");
      expect(url).toContain("cursor=2026-07-24T13%3A00%3A00.000Z");
      expect(url).toContain("limit=5");
      expect(url).toContain("statsOnly=true");
      expect(result).toEqual(mockPage);
    });

    it("should retry 429 responses using Retry-After and succeed", async () => {
      const timedClient = new TalosClient({
        baseUrl: "http://localhost:3000",
        apiKey: "test-key",
        retryPolicy: {
          maxAttempts: 3,
          baseDelayMs: 50,
          maxDelayMs: 1000,
          jitter: false,
        },
      });

      const mockData = { id: "1", name: "Talos 1" };
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({
            "Retry-After": "0.1",
          }),
          text: async () => "Too Many Requests",
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockData,
        } as Response);

      vi.useFakeTimers();
      const resultPromise = timedClient.getTalos("1");
      await vi.advanceTimersByTimeAsync(100);
      const result = await resultPromise;
      vi.useRealTimers();

      expect(result).toEqual(mockData);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("should not retry unsafe POST requests by default", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Error",
      } as Response);

      await expect(client.createTalos({ name: "New Talos", category: "Test", description: "Desc" })).rejects.toThrow(
        "Talos API error 500 on /api/talos: Internal Error",
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("should abort during retry wait when signal is aborted", async () => {
      const controller = new AbortController();
      const abortableClient = new TalosClient({
        baseUrl: "http://localhost:3000",
        apiKey: "test-key",
        retryPolicy: {
          maxAttempts: 2,
          baseDelayMs: 100,
          maxDelayMs: 1000,
          jitter: false,
        },
      });

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: async () => "Server Error",
      } as Response);

      vi.useFakeTimers();
      const promise = abortableClient.listActivities({ signal: controller.signal });
      controller.abort();
      vi.advanceTimersByTime(100);
      await expect(promise).rejects.toThrow("Request aborted");
      vi.useRealTimers();
    });
  });

  describe("Base URL Configuration", () => {
    it("should use default base URL when not provided", async () => {
      const defaultClient = new TalosClient();
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ id: "1" }),
      } as Response);

      await defaultClient.getTalos("1");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("https://talos-stellar.vercel.app"),
        expect.any(Object)
      );
    });

    it("should trim trailing slash from base URL", async () => {
      const clientWithSlash = new TalosClient({ baseUrl: "http://localhost:3000/" });
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ id: "1" }),
      } as Response);

      await clientWithSlash.getTalos("1");

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/talos/1",
        expect.any(Object)
      );
    });
  });
});

describe("Financial Insight Methods", () => {
  const client = new TalosClient({ baseUrl: "http://localhost:3000", apiKey: "test-key" });

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  // ── getCreditScore ─────────────────────────────────────────────

  describe("getCreditScore", () => {
    const mockCreditScore = {
      talosId: "talos-1",
      talosName: "Vega",
      generatedAt: "2026-10-21T05:00:00.000Z",
      creditScore: 78.5,
      creditGrade: "B",
      creditSummary: "B rating — Excellent borrowing capacity",
      income: {
        weeklyRevenue: 250,
        monthlyRevenue: 1000,
        quarterlyRevenue: 3000,
        netWeeklyIncome: 200,
        annualizedWeeklyIncome: 10400,
        revenueTransactionCount: { weekly: 5, monthly: 20, quarterly: 60 },
      },
      debt: {
        weeklyApprovedSpending: 50,
        monthlyApprovedSpending: 200,
        quarterlyApprovedSpending: 600,
        avgMonthlySpending: 200,
        spendingTransactionCount: { weekly: 1, monthly: 4, quarterly: 12 },
      },
      ratios: { debtToRevenue7d: 20, debtToRevenue30d: 20, debtToRevenue90d: 20 },
      borrowingCapacity: {
        sustainableBorrowingLimit: 600,
        currentMonthlySpending: 200,
        borrowingUtilization: 33.33,
        borrowingStatusMessage: "✓ Healthy borrowing level",
      },
      patronEngagement: { activePatrons: 5, totalPatronHoldings: 50000 },
      riskFactors: [],
      recommendations: [],
    };

    it("should return credit score on success", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockCreditScore,
      } as Response);

      const result = await client.getCreditScore("talos-1");

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/talos/talos-1/credit-score",
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-key" }) }),
      );
      expect(result).toEqual(mockCreditScore);
    });

    it("should throw TalosAPIError on 401", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      } as Response);

      await expect(client.getCreditScore("talos-1")).rejects.toThrow(TalosAPIError);
      await expect(client.getCreditScore("talos-1")).rejects.toMatchObject({ status: 401 });
    });

    it("should throw TalosAPIError on 404 for unknown talos", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => '{"error":"TALOS not found"}',
      } as Response);

      await expect(client.getCreditScore("unknown-id")).rejects.toThrow(TalosAPIError);
      await expect(client.getCreditScore("unknown-id")).rejects.toMatchObject({ status: 404 });
    });

    it("should forward abort signal", async () => {
      const controller = new AbortController();
      vi.mocked(fetch).mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

      await expect(client.getCreditScore("talos-1", { signal: controller.signal })).rejects.toThrow("Aborted");
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: controller.signal }),
      );
    });
  });

  // ── getFinancialSummary ────────────────────────────────────────

  describe("getFinancialSummary", () => {
    const mockSummary = {
      talosId: "talos-1",
      talosName: "Vega",
      category: "Analytics",
      status: "Active",
      generatedAt: "2026-10-21T05:00:00.000Z",
      cashFlow: {
        totalRevenue: 5000,
        totalSpending: 1200,
        netProfit: 3800,
        profitMargin: 76,
        revenueTransactionCount: 50,
        spendingTransactionCount: 12,
        revenueBySource: [{ source: "commerce", total: 5000, count: 50 }],
        spendingByType: [{ type: "transaction", total: 1200, count: 12 }],
      },
      trends: {
        revenueLast30Days: 1000,
        revenuePrevious30Days: 800,
        revenueGrowthRate: 25,
        spendingLast30Days: 300,
        netProfitLast30Days: 700,
        annualizedRunRate: 12000,
        monthlyRevenue: [{ month: "2026-10", revenue: 1000, transactionCount: 10 }],
      },
      budget: {
        gtmBudget: 5000,
        totalApprovedSpending: 1200,
        budgetUtilization: 24,
        budgetRemaining: 3800,
      },
      spendingHistory: [],
      playbookSales: { totalPlaybooks: 2, totalSales: 5, totalRevenue: 50, playbooks: [] },
    };

    it("should return financial summary on success", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSummary,
      } as Response);

      const result = await client.getFinancialSummary("talos-1");

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/talos/talos-1/financial-summary",
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-key" }) }),
      );
      expect(result).toEqual(mockSummary);
    });

    it("should throw TalosAPIError on 401", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      } as Response);

      await expect(client.getFinancialSummary("talos-1")).rejects.toThrow(TalosAPIError);
      await expect(client.getFinancialSummary("talos-1")).rejects.toMatchObject({ status: 401 });
    });

    it("should throw TalosAPIError on 404 for unknown talos", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => '{"error":"TALOS not found"}',
      } as Response);

      await expect(client.getFinancialSummary("unknown-id")).rejects.toThrow(TalosAPIError);
      await expect(client.getFinancialSummary("unknown-id")).rejects.toMatchObject({ status: 404 });
    });

    it("should forward abort signal", async () => {
      const controller = new AbortController();
      vi.mocked(fetch).mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

      await expect(client.getFinancialSummary("talos-1", { signal: controller.signal })).rejects.toThrow("Aborted");
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: controller.signal }),
      );
    });
  });

  // ── getFinancialProjection ─────────────────────────────────────

  describe("getFinancialProjection", () => {
    const mockProjection = {
      projection: {
        expectedRevenue: {
          monthly: [1100, 1200, 1300, 1400, 1500, 1600],
          quarterly: [3600, 4200, 4500],
          yearly: 15600,
        },
        budgetSuggestions: [
          { category: "Marketing", amount: 400, rationale: "Expand reach" },
        ],
        roiEstimations: {
          shortTerm: 10,
          mediumTerm: 25,
          longTerm: 50,
          confidence: "medium" as const,
        },
        insights: ["Strong revenue growth trajectory"],
      },
      metadata: {
        talosId: "talos-1",
        generatedAt: "2026-10-21T05:00:00.000Z",
        dataPoints: { revenues: 50, activities: 30, patrons: 5 },
      },
    };

    it("should return financial projection on success", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockProjection,
      } as Response);

      const result = await client.getFinancialProjection("talos-1");

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/talos/talos-1/financial-projection",
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-key" }) }),
      );
      expect(result).toEqual(mockProjection);
      expect(result.projection.roiEstimations.confidence).toBe("medium");
    });

    it("should throw TalosAPIError on 401", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      } as Response);

      await expect(client.getFinancialProjection("talos-1")).rejects.toThrow(TalosAPIError);
      await expect(client.getFinancialProjection("talos-1")).rejects.toMatchObject({ status: 401 });
    });

    it("should throw TalosAPIError on 404 for unknown talos", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => '{"error":"TALOS not found"}',
      } as Response);

      await expect(client.getFinancialProjection("unknown-id")).rejects.toThrow(TalosAPIError);
      await expect(client.getFinancialProjection("unknown-id")).rejects.toMatchObject({ status: 404 });
    });

    it("should forward abort signal", async () => {
      const controller = new AbortController();
      vi.mocked(fetch).mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

      await expect(
        client.getFinancialProjection("talos-1", { signal: controller.signal }),
      ).rejects.toThrow("Aborted");
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: controller.signal }),
      );
    });
  });
});