import { describe, it, expect, beforeEach } from "vitest";
import { uintCV, some, none, bufferCV } from "@stacks/transactions";

interface Expenditure {
  amount: bigint;
  recipient: string;
  purpose: string;
  timestamp: bigint;
  txSender: string;
  metadata: { type: number; data: Buffer } | null;
  status: string;
}

interface ExpenditureIndex {
  budgetId: bigint;
  expId: bigint;
}

class ExpenditureTrackerMock {
  state: {
    nextExpId: bigint;
    expenditures: Map<string, Expenditure>;
    txIndex: Map<string, ExpenditureIndex>;
    totalSpent: Map<bigint, bigint>;
    expCount: Map<bigint, bigint>;
  } = {
    nextExpId: 0n,
    expenditures: new Map(),
    txIndex: new Map(),
    totalSpent: new Map(),
    expCount: new Map(),
  };

  blockHeight = 100n;
  caller = "ST1TEST";
  stxTransfers: Array<{ amount: bigint; from: string; to: string }> = [];
  burns: Array<{ amount: bigint; caller: string }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextExpId: 0n,
      expenditures: new Map(),
      txIndex: new Map(),
      totalSpent: new Map(),
      expCount: new Map(),
    };
    this.blockHeight = 100n;
    this.caller = "ST1TEST";
    this.stxTransfers = [];
    this.burns = [];
  }

  private key(budgetId: bigint, expId: bigint): string {
    return `${budgetId.toString()}-${expId.toString()}`;
  }

  private generateTxHash(): string {
    return "0x" + this.blockHeight.toString(16).padStart(64, "0");
  }

  recordExpenditure(
    budgetId: bigint,
    amount: bigint,
    recipient: string,
    purpose: string,
    metadata: { type: number; data: Buffer } | null
  ): { ok: boolean; value: bigint | number } {
    if (budgetId === 0n) return { ok: false, value: 3001 };
    if (amount === 0n) return { ok: false, value: 3003 };
    if (purpose.length === 0 || purpose.length > 128) return { ok: false, value: 3005 };
    if (recipient === this.caller) return { ok: false, value: 3006 };
    if (metadata && metadata.data.length > 256) return { ok: false, value: 3010 };

    const txHash = this.generateTxHash();
    if (this.state.txIndex.has(txHash)) return { ok: false, value: 3011 };

    this.burns.push({ amount, caller: this.caller });
    this.stxTransfers.push({ amount, from: this.caller, to: recipient });

    const expId = this.state.nextExpId;
    const key = this.key(budgetId, expId);

    this.state.expenditures.set(key, {
      amount,
      recipient,
      purpose,
      timestamp: this.blockHeight,
      txSender: this.caller,
      metadata,
      status: "completed",
    });

    this.state.txIndex.set(txHash, { budgetId, expId });

    const currentSpent = this.state.totalSpent.get(budgetId) || 0n;
    this.state.totalSpent.set(budgetId, currentSpent + amount);

    const currentCount = this.state.expCount.get(budgetId) || 0n;
    this.state.expCount.set(budgetId, currentCount + 1n);

    this.state.nextExpId += 1n;

    return { ok: true, value: expId };
  }

  voidExpenditure(budgetId: bigint, expId: bigint, reason: string): { ok: boolean; value: boolean | number } {
    const key = this.key(budgetId, expId);
    const exp = this.state.expenditures.get(key);
    if (!exp) return { ok: false, value: 3002 };
    if (exp.txSender !== this.caller) return { ok: false, value: 3000 };
    if (exp.status !== "completed") return { ok: false, value: 3020 };

    this.state.expenditures.set(key, { ...exp, status: "voided" });

    const currentSpent = this.state.totalSpent.get(budgetId) || 0n;
    this.state.totalSpent.set(budgetId, currentSpent - exp.amount);

    return { ok: true, value: true };
  }

  getExpenditure(budgetId: bigint, expId: bigint): Expenditure | null {
    return this.state.expenditures.get(this.key(budgetId, expId)) || null;
  }

  getTotalSpent(budgetId: bigint): bigint {
    return this.state.totalSpent.get(budgetId) || 0n;
  }

  getExpenditureCount(budgetId: bigint): bigint {
    return this.state.expCount.get(budgetId) || 0n;
  }
}

describe("ExpenditureTracker", () => {
  let tracker: ExpenditureTrackerMock;

  beforeEach(() => {
    tracker = new ExpenditureTrackerMock();
    tracker.reset();
  });

  it("records expenditure successfully with metadata", () => {
    const result = tracker.recordExpenditure(
      1n,
      500n,
      "ST2VENDOR",
      "Office Supplies Q4",
      { type: 6, data: Buffer.from("invoice-123") }
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0n);

    const exp = tracker.getExpenditure(1n, 0n);
    expect(exp?.amount).toBe(500n);
    expect(exp?.recipient).toBe("ST2VENDOR");
    expect(exp?.purpose).toBe("Office Supplies Q4");
    expect(exp?.status).toBe("completed");
    expect(tracker.stxTransfers).toEqual([{ amount: 500n, from: "ST1TEST", to: "ST2VENDOR" }]);
    expect(tracker.burns).toEqual([{ amount: 500n, caller: "ST1TEST" }]);
    expect(tracker.getTotalSpent(1n)).toBe(500n);
    expect(tracker.getExpenditureCount(1n)).toBe(1n);
  });

  it("rejects zero amount", () => {
    const result = tracker.recordExpenditure(1n, 0n, "ST2VENDOR", "Invalid", null);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(3003);
  });

  it("rejects invalid budget id", () => {
    const result = tracker.recordExpenditure(0n, 100n, "ST2VENDOR", "Test", null);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(3001);
  });

  it("rejects empty purpose", () => {
    const result = tracker.recordExpenditure(1n, 100n, "ST2VENDOR", "", null);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(3005);
  });

  it("rejects self as recipient", () => {
    const result = tracker.recordExpenditure(1n, 100n, "ST1TEST", "Self", null);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(3006);
  });

  it("rejects duplicate tx hash", () => {
    tracker.recordExpenditure(1n, 100n, "ST2VENDOR", "First", null);
    tracker.blockHeight += 1n;
    const result = tracker.recordExpenditure(1n, 200n, "ST3VENDOR", "Second", null);
    expect(result.ok).toBe(true);
  });

  it("voids expenditure correctly", () => {
    tracker.recordExpenditure(1n, 300n, "ST2VENDOR", "Voidable", null);
    const result = tracker.voidExpenditure(1n, 0n, "Mistake in amount");
    expect(result.ok).toBe(true);
    const exp = tracker.getExpenditure(1n, 0n);
    expect(exp?.status).toBe("voided");
    expect(tracker.getTotalSpent(1n)).toBe(0n);
  });

  it("rejects void by non-sender", () => {
    tracker.recordExpenditure(1n, 300n, "ST2VENDOR", "Test", null);
    tracker.caller = "ST3HACKER";
    const result = tracker.voidExpenditure(1n, 0n, "Hack");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(3000);
  });

  it("handles large metadata correctly", () => {
    const large = Buffer.alloc(256, "a");
    const result = tracker.recordExpenditure(
      1n,
      100n,
      "ST2VENDOR",
      "Large",
      { type: 6, data: large }
    );
    expect(result.ok).toBe(true);
  });

  it("rejects metadata over 256 bytes", () => {
    const tooLarge = Buffer.alloc(257, "a");
    const result = tracker.recordExpenditure(
      1n,
      100n,
      "ST2VENDOR",
      "Too Large",
      { type: 6, data: tooLarge }
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(3010);
  })
});