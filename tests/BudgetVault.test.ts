import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV, principalCV, createAddress, ClarityType } from "@stacks/transactions";
const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_BUDGET_ID = 101;
const ERR_INSUFFICIENT_FUNDS = 102;
const ERR_INVALID_AMOUNT = 103;
const ERR_BUDGET_ALREADY_EXISTS = 104;
const ERR_BUDGET_NOT_FOUND = 105;
const ERR_INVALID_CURRENCY = 111;
const ERR_INVALID_LOCATION = 112;
const ERR_INVALID_BUDGET_TYPE = 113;
const ERR_MAX_BUDGETS_EXCEEDED = 114;
const ERR_PAUSED = 116;
const ERR_AUTHORITY_NOT_VERIFIED = 107;
interface Budget {
  name: string;
  totalLocked: number;
  currency: string;
  location: string;
  budgetType: string;
  status: boolean;
  timestamp: number;
  creator: string;
  admin: string;
}
interface BudgetUpdate {
  updateName: string;
  updateAdmin: string;
  updateTimestamp: number;
  updater: string;
}
interface BudgetAudit {
  amount: number;
  action: string;
  recipient: string;
  timestamp: number;
}
interface Result<T> {
  ok: boolean;
  value: T;
}
class BudgetVaultMock {
  state: {
    nextBudgetId: number;
    maxBudgets: number;
    creationFee: number;
    authorityContract: string | null;
    budgets: Map<number, Budget>;
    budgetBalances: Map<string, number>;
    budgetUpdates: Map<number, BudgetUpdate>;
    budgetAudits: Map<string, BudgetAudit>;
    budgetsByName: Map<string, number>;
  } = {
    nextBudgetId: 0,
    maxBudgets: 500,
    creationFee: 500,
    authorityContract: null,
    budgets: new Map(),
    budgetBalances: new Map(),
    budgetUpdates: new Map(),
    budgetAudits: new Map(),
    budgetsByName: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  stxBalance: Map<string, number> = new Map([["ST1TEST", 10000]]);
  authorities: Set<string> = new Set(["ST1TEST"]);
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];
  constructor() {
    this.reset();
  }
  reset() {
    this.state = {
      nextBudgetId: 0,
      maxBudgets: 500,
      creationFee: 500,
      authorityContract: null,
      budgets: new Map(),
      budgetBalances: new Map(),
      budgetUpdates: new Map(),
      budgetAudits: new Map(),
      budgetsByName: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.stxBalance.set("ST1TEST", 10000);
    this.authorities = new Set(["ST1TEST"]);
    this.stxTransfers = [];
  }
  isVerifiedAuthority(principal: string): Result<boolean> {
    return { ok: true, value: this.authorities.has(principal) };
  }
  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: false };
    }
    if (this.state.authorityContract !== null) {
      return { ok: false, value: false };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }
  setCreationFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.creationFee = newFee;
    return { ok: true, value: true };
  }
  createBudget(
    name: string,
    currency: string,
    location: string,
    budgetType: string,
    admin: string
  ): Result<number> {
    if (this.state.nextBudgetId >= this.state.maxBudgets) return { ok: false, value: ERR_MAX_BUDGETS_EXCEEDED };
    if (!name || name.length > 100) return { ok: false, value: ERR_INVALID_BUDGET_ID };
    if (!["STX", "USD", "BTC"].includes(currency)) return { ok: false, value: ERR_INVALID_CURRENCY };
    if (!location || location.length > 100) return { ok: false, value: ERR_INVALID_LOCATION };
    if (!["government", "ngo", "corporate"].includes(budgetType)) return { ok: false, value: ERR_INVALID_BUDGET_TYPE };
    if (this.state.budgetsByName.has(name)) return { ok: false, value: ERR_BUDGET_ALREADY_EXISTS };
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };
    this.stxTransfers.push({ amount: this.state.creationFee, from: this.caller, to: this.state.authorityContract });
    const id = this.state.nextBudgetId;
    const budget: Budget = {
      name,
      totalLocked: 0,
      currency,
      location,
      budgetType,
      status: true,
      timestamp: this.blockHeight,
      creator: this.caller,
      admin,
    };
    this.state.budgets.set(id, budget);
    this.state.budgetBalances.set(`budget-${id}`, 0);
    this.state.budgetsByName.set(name, id);
    this.state.nextBudgetId++;
    return { ok: true, value: id };
  }
  getBudget(id: number): Budget | null {
    return this.state.budgets.get(id) || null;
  }
  lockFunds(budgetId: number, amount: number): Result<number> {
    const budgetKey = `budget-${budgetId}`;
    const budget = this.state.budgets.get(budgetId);
    if (!budget) return { ok: false, value: ERR_BUDGET_NOT_FOUND };
    if (!budget.status) return { ok: false, value: ERR_PAUSED };
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    const currentStx = this.stxBalance.get(this.caller) || 0;
    if (currentStx < amount) return { ok: false, value: ERR_INSUFFICIENT_FUNDS };
    this.stxBalance.set(this.caller, currentStx - amount);
    const currentBalance = this.state.budgetBalances.get(budgetKey) || 0;
    const newBalance = currentBalance + amount;
    this.state.budgetBalances.set(budgetKey, newBalance);
    const updatedBudget: Budget = {
      ...budget,
      totalLocked: newBalance,
    };
    this.state.budgets.set(budgetId, updatedBudget);
    const txId = `tx-${this.blockHeight}`;
    this.state.budgetAudits.set(`${budgetId}-${txId}`, {
      amount,
      action: "lock",
      recipient: this.caller,
      timestamp: this.blockHeight,
    });
    this.blockHeight++;
    return { ok: true, value: newBalance };
  }
  withdrawFunds(budgetId: number, amount: number, recipient: string): Result<number> {
    const budgetKey = `budget-${budgetId}`;
    const budget = this.state.budgets.get(budgetId);
    if (!budget) return { ok: false, value: ERR_BUDGET_NOT_FOUND };
    if (budget.admin !== this.caller) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (!budget.status) return { ok: false, value: ERR_PAUSED };
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    const currentBalance = this.state.budgetBalances.get(budgetKey) || 0;
    if (currentBalance < amount) return { ok: false, value: ERR_INSUFFICIENT_FUNDS };
    const newBalance = currentBalance - amount;
    this.state.budgetBalances.set(budgetKey, newBalance);
    const updatedBudget: Budget = {
      ...budget,
      totalLocked: newBalance,
    };
    this.state.budgets.set(budgetId, updatedBudget);
    const txId = `tx-${this.blockHeight}`;
    this.state.budgetAudits.set(`${budgetId}-${txId}`, {
      amount,
      action: "withdraw",
      recipient,
      timestamp: this.blockHeight,
    });
    this.blockHeight++;
    return { ok: true, value: newBalance };
  }
  updateBudgetAdmin(budgetId: number, newAdmin: string): Result<boolean> {
    const budget = this.state.budgets.get(budgetId);
    if (!budget) return { ok: false, value: false };
    if (budget.creator !== this.caller) return { ok: false, value: false };
    const updatedBudget: Budget = {
      ...budget,
      admin: newAdmin,
    };
    this.state.budgets.set(budgetId, updatedBudget);
    this.state.budgetUpdates.set(budgetId, {
      updateName: budget.name,
      updateAdmin: newAdmin,
      updateTimestamp: this.blockHeight,
      updater: this.caller,
    });
    this.blockHeight++;
    return { ok: true, value: true };
  }
  pauseBudget(budgetId: number): Result<boolean> {
    const budget = this.state.budgets.get(budgetId);
    if (!budget) return { ok: false, value: false };
    if (budget.admin !== this.caller) return { ok: false, value: false };
    const updatedBudget: Budget = {
      ...budget,
      status: false,
    };
    this.state.budgets.set(budgetId, updatedBudget);
    return { ok: true, value: true };
  }
  resumeBudget(budgetId: number): Result<boolean> {
    const budget = this.state.budgets.get(budgetId);
    if (!budget) return { ok: false, value: false };
    if (budget.admin !== this.caller) return { ok: false, value: false };
    const updatedBudget: Budget = {
      ...budget,
      status: true,
    };
    this.state.budgets.set(budgetId, updatedBudget);
    return { ok: true, value: true };
  }
  getBudgetCount(): number {
    return this.state.nextBudgetId;
  }
  checkBudgetExistence(name: string): boolean {
    return this.state.budgetsByName.has(name);
  }
}
describe("BudgetVault", () => {
  let contract: BudgetVaultMock;
  beforeEach(() => {
    contract = new BudgetVaultMock();
    contract.reset();
  });
  it("creates a budget successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createBudget(
      "PublicFund",
      "STX",
      "Lagos",
      "government",
      "ST3ADMIN"
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const budget = contract.getBudget(0);
    expect(budget?.name).toBe("PublicFund");
    expect(budget?.currency).toBe("STX");
    expect(budget?.location).toBe("Lagos");
    expect(budget?.budgetType).toBe("government");
    expect(budget?.admin).toBe("ST3ADMIN");
    expect(contract.stxTransfers).toEqual([{ amount: 500, from: "ST1TEST", to: "ST2TEST" }]);
  });
  it("rejects duplicate budget", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createBudget(
      "PublicFund",
      "STX",
      "Lagos",
      "government",
      "ST3ADMIN"
    );
    const result = contract.createBudget(
      "PublicFund",
      "USD",
      "Abuja",
      "ngo",
      "ST4ADMIN"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_BUDGET_ALREADY_EXISTS);
  });
  it("locks funds successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createBudget(
      "TestBudget",
      "STX",
      "TestLoc",
      "corporate",
      "ST1TEST"
    );
    const result = contract.lockFunds(0, 1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1000);
    const balance = contract.state.budgetBalances.get("budget-0");
    expect(balance).toBe(1000);
    const budget = contract.getBudget(0);
    expect(budget?.totalLocked).toBe(1000);
    const auditKey = "0-tx-0";
    const audit = contract.state.budgetAudits.get(auditKey);
    expect(audit?.action).toBe("lock");
    expect(audit?.amount).toBe(1000);
  });
  it("rejects lock on paused budget", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createBudget(
      "PausedBudget",
      "STX",
      "TestLoc",
      "corporate",
      "ST1TEST"
    );
    contract.pauseBudget(0);
    const result = contract.lockFunds(0, 1000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PAUSED);
  });
  it("withdraws funds successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createBudget(
      "WithdrawBudget",
      "STX",
      "TestLoc",
      "corporate",
      "ST1TEST"
    );
    contract.lockFunds(0, 2000);
    const result = contract.withdrawFunds(0, 500, "ST2RECIP");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1500);
    const balance = contract.state.budgetBalances.get("budget-0");
    expect(balance).toBe(1500);
    const auditKey = "0-tx-1";
    const audit = contract.state.budgetAudits.get(auditKey);
    expect(audit?.action).toBe("withdraw");
    expect(audit?.amount).toBe(500);
  });
  it("rejects withdrawal by non-admin", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createBudget(
      "NonAdminBudget",
      "STX",
      "TestLoc",
      "corporate",
      "ST3ADMIN"
    );
    contract.lockFunds(0, 1000);
    contract.caller = "ST2FAKE";
    const result = contract.withdrawFunds(0, 500, "ST2RECIP");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });
  it("updates budget admin successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createBudget(
      "UpdateAdminBudget",
      "STX",
      "TestLoc",
      "corporate",
      "ST1OLD"
    );
    const result = contract.updateBudgetAdmin(0, "ST2NEW");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const budget = contract.getBudget(0);
    expect(budget?.admin).toBe("ST2NEW");
    const update = contract.state.budgetUpdates.get(0);
    expect(update?.updateAdmin).toBe("ST2NEW");
  });
  it("pauses budget successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createBudget(
      "PauseBudget",
      "STX",
      "TestLoc",
      "corporate",
      "ST1TEST"
    );
    const result = contract.pauseBudget(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const budget = contract.getBudget(0);
    expect(budget?.status).toBe(false);
  });
  it("resumes budget successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createBudget(
      "ResumeBudget",
      "STX",
      "TestLoc",
      "corporate",
      "ST1TEST"
    );
    contract.pauseBudget(0);
    const result = contract.resumeBudget(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const budget = contract.getBudget(0);
    expect(budget?.status).toBe(true);
  });
  it("returns correct budget count", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createBudget(
      "Count1",
      "STX",
      "Loc1",
      "government",
      "ST1ADMIN"
    );
    contract.createBudget(
      "Count2",
      "USD",
      "Loc2",
      "ngo",
      "ST2ADMIN"
    );
    expect(contract.getBudgetCount()).toBe(2);
  });
  it("checks budget existence correctly", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createBudget(
      "ExistBudget",
      "STX",
      "Loc",
      "corporate",
      "ST1ADMIN"
    );
    expect(contract.checkBudgetExistence("ExistBudget")).toBe(true);
    expect(contract.checkBudgetExistence("NonExist")).toBe(false);
  });
  it("rejects creation without authority", () => {
    const result = contract.createBudget(
      "NoAuth",
      "STX",
      "Loc",
      "corporate",
      "ST1ADMIN"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_VERIFIED);
  });
  it("rejects invalid currency", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createBudget(
      "InvalidCur",
      "INVALID",
      "Loc",
      "corporate",
      "ST1ADMIN"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CURRENCY);
  });
  it("rejects max budgets exceeded", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.state.maxBudgets = 1;
    contract.createBudget(
      "First",
      "STX",
      "Loc",
      "corporate",
      "ST1ADMIN"
    );
    const result = contract.createBudget(
      "Second",
      "USD",
      "Loc2",
      "ngo",
      "ST2ADMIN"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_BUDGETS_EXCEEDED);
  });
  it("sets authority contract successfully", () => {
    const result = contract.setAuthorityContract("ST2TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.authorityContract).toBe("ST2TEST");
  });
  it("rejects invalid authority", () => {
    const result = contract.setAuthorityContract("SP000000000000000000002Q6VF78");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });
});