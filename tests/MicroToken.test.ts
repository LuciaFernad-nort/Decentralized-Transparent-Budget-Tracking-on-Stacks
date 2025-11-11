import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, uintCV, principalCV, someCV, noneCV, bufferCV, optionalCV } from "@stacks/transactions";

const ERR_UNAUTHORIZED = 100;
const ERR_PAUSED = 101;
const ERR_MINT_PAUSED = 102;
const ERR_BURN_PAUSED = 103;
const ERR_SUPPLY_EXCEEDED = 104;
const ERR_INVALID_BUDGET_ID = 105;
const ERR_INSUFFICIENT_APPROVAL = 106;
const ERR_ZERO_AMOUNT = 107;
const ERR_INVALID_MINTER = 108;
const ERR_TRANSFER_FAILED = 109;

interface TokenState {
  admin: string;
  totalSupplyCap: bigint;
  paused: boolean;
  mintPaused: boolean;
  burnPaused: boolean;
  authorizedMinters: Map<bigint, string>;
  budgetSupplies: Map<bigint, bigint>;
  tokenApprovals: Map<string, bigint>;
  transferMemos: Map<string, string | null>;
  balances: Map<string, bigint>;
  totalSupply: bigint;
}

type Result<T> = { ok: true; value: T } | { ok: false; value: number };

class MicroTokenMock {
  state: TokenState;
  caller: string = "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH";
  blockHeight: bigint = BigInt(0);
  blockTime: bigint = BigInt(0);

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      admin: "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH",
      totalSupplyCap: BigInt(1000000000000000),
      paused: false,
      mintPaused: false,
      burnPaused: false,
      authorizedMinters: new Map(),
      budgetSupplies: new Map(),
      tokenApprovals: new Map(),
      transferMemos: new Map(),
      balances: new Map(),
      totalSupply: BigInt(0),
    };
    this.caller = "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH";
    this.blockHeight = BigInt(0);
    this.blockTime = BigInt(0);
  }

  getName(): Result<string> {
    return { ok: true, value: "MicroBudgetToken" };
  }

  getSymbol(): Result<string> {
    return { ok: true, value: "MBT" };
  }

  getDecimals(): Result<number> {
    return { ok: true, value: 6 };
  }

  getBalance(account: string): Result<bigint> {
    return { ok: true, value: this.state.balances.get(account) || BigInt(0) };
  }

  getTotalSupply(): Result<bigint> {
    return { ok: true, value: this.state.totalSupply };
  }

  getAllowance(owner: string, spender: string): Result<bigint> {
    const key = `${owner}-${spender}`;
    return { ok: true, value: this.state.tokenApprovals.get(key) || BigInt(0) };
  }

  getBudgetSupply(budgetId: bigint): Result<bigint> {
    return { ok: true, value: this.state.budgetSupplies.get(budgetId) || BigInt(0) };
  }

  isAuthorizedMinter(budgetId: bigint, minter: string): Result<boolean> {
    const authorized = this.state.authorizedMinters.get(budgetId);
    return { ok: true, value: authorized === minter };
  }

  isPaused(): Result<boolean> {
    return { ok: true, value: this.state.paused };
  }

  isMintPaused(): Result<boolean> {
    return { ok: true, value: this.state.mintPaused };
  }

  isBurnPaused(): Result<boolean> {
    return { ok: true, value: this.state.burnPaused };
  }

  setAdmin(newAdmin: string): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_UNAUTHORIZED };
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }

  setPause(newPaused: boolean): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_UNAUTHORIZED };
    this.state.paused = newPaused;
    return { ok: true, value: true };
  }

  setMintPause(newMintPaused: boolean): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_UNAUTHORIZED };
    this.state.mintPaused = newMintPaused;
    return { ok: true, value: true };
  }

  setBurnPause(newBurnPaused: boolean): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_UNAUTHORIZED };
    this.state.burnPaused = newBurnPaused;
    return { ok: true, value: true };
  }

  setSupplyCap(newCap: bigint): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_UNAUTHORIZED };
    if (newCap < this.state.totalSupply) return { ok: false, value: ERR_SUPPLY_EXCEEDED };
    this.state.totalSupplyCap = newCap;
    return { ok: true, value: true };
  }

  authorizeMinter(budgetId: bigint, minter: string): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_UNAUTHORIZED };
    if (budgetId === BigInt(0)) return { ok: false, value: ERR_INVALID_BUDGET_ID };
    this.state.authorizedMinters.set(budgetId, minter);
    return { ok: true, value: true };
  }

  deauthorizeMinter(budgetId: bigint): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_UNAUTHORIZED };
    this.state.authorizedMinters.delete(budgetId);
    return { ok: true, value: true };
  }

  mint(budgetId: bigint, amount: bigint, recipient: string): Result<boolean> {
    if (this.state.paused) return { ok: false, value: ERR_PAUSED };
    if (this.state.mintPaused) return { ok: false, value: ERR_MINT_PAUSED };
    const authorized = this.state.authorizedMinters.get(budgetId);
    if (!authorized || this.caller !== authorized) return { ok: false, value: ERR_INVALID_MINTER };
    if (amount <= BigInt(0)) return { ok: false, value: ERR_ZERO_AMOUNT };
    const newSupply = this.state.totalSupply + amount;
    if (newSupply > this.state.totalSupplyCap) return { ok: false, value: ERR_SUPPLY_EXCEEDED };
    const currentBudgetSupply = this.state.budgetSupplies.get(budgetId) || BigInt(0);
    const updatedBudgetSupply = currentBudgetSupply + amount;
    this.state.budgetSupplies.set(budgetId, updatedBudgetSupply);
    this.state.balances.set(recipient, (this.state.balances.get(recipient) || BigInt(0)) + amount);
    this.state.totalSupply = newSupply;
    return { ok: true, value: true };
  }

  burn(budgetId: bigint, amount: bigint, from: string): Result<boolean> {
    if (this.state.paused) return { ok: false, value: ERR_PAUSED };
    if (this.state.burnPaused) return { ok: false, value: ERR_BURN_PAUSED };
    if (amount <= BigInt(0)) return { ok: false, value: ERR_ZERO_AMOUNT };
    const balance = this.state.balances.get(from) || BigInt(0);
    if (balance < amount) return { ok: false, value: ERR_TRANSFER_FAILED };
    const currentBudgetSupply = this.state.budgetSupplies.get(budgetId) || BigInt(0);
    if (currentBudgetSupply < amount) return { ok: false, value: ERR_SUPPLY_EXCEEDED };
    const updatedBudgetSupply = currentBudgetSupply - amount;
    this.state.budgetSupplies.set(budgetId, updatedBudgetSupply);
    this.state.balances.set(from, balance - amount);
    this.state.totalSupply -= amount;
    return { ok: true, value: true };
  }

  transfer(to: string, amount: bigint, memo: string | null): Result<boolean> {
    if (this.state.paused) return { ok: false, value: ERR_PAUSED };
    if (amount <= BigInt(0)) return { ok: false, value: ERR_ZERO_AMOUNT };
    if (this.caller === to) return { ok: false, value: ERR_ZERO_AMOUNT };
    const balance = this.state.balances.get(this.caller) || BigInt(0);
    if (balance < amount) return { ok: false, value: ERR_TRANSFER_FAILED };
    const txHash = `mock-hash-${this.blockHeight}`;
    this.state.transferMemos.set(txHash, memo);
    this.state.balances.set(this.caller, balance - amount);
    this.state.balances.set(to, (this.state.balances.get(to) || BigInt(0)) + amount);
    return { ok: true, value: true };
  }

  transferFrom(from: string, to: string, amount: bigint): Result<boolean> {
    if (this.state.paused) return { ok: false, value: ERR_PAUSED };
    if (amount <= BigInt(0)) return { ok: false, value: ERR_ZERO_AMOUNT };
    if (from === to) return { ok: false, value: ERR_ZERO_AMOUNT };
    const balanceFrom = this.state.balances.get(from) || BigInt(0);
    if (balanceFrom < amount) return { ok: false, value: ERR_TRANSFER_FAILED };
    const key = `${from}-${this.caller}`;
    const allowed = this.state.tokenApprovals.get(key) || BigInt(0);
    if (allowed < amount) return { ok: false, value: ERR_INSUFFICIENT_APPROVAL };
    this.state.tokenApprovals.set(key, allowed - amount);
    this.state.balances.set(from, balanceFrom - amount);
    this.state.balances.set(to, (this.state.balances.get(to) || BigInt(0)) + amount);
    return { ok: true, value: true };
  }

  approve(spender: string, amount: bigint): Result<boolean> {
    if (this.state.paused) return { ok: false, value: ERR_PAUSED };
    if (amount <= BigInt(0)) return { ok: false, value: ERR_ZERO_AMOUNT };
    const key = `${this.caller}-${spender}`;
    this.state.tokenApprovals.set(key, amount);
    return { ok: true, value: true };
  }

  increaseAllowance(spender: string, addedValue: bigint): Result<boolean> {
    if (this.state.paused) return { ok: false, value: ERR_PAUSED };
    if (addedValue <= BigInt(0)) return { ok: false, value: ERR_ZERO_AMOUNT };
    const key = `${this.caller}-${spender}`;
    const current = this.state.tokenApprovals.get(key) || BigInt(0);
    this.state.tokenApprovals.set(key, current + addedValue);
    return { ok: true, value: true };
  }

  decreaseAllowance(spender: string, subtractedValue: bigint): Result<boolean> {
    if (this.state.paused) return { ok: false, value: ERR_PAUSED };
    if (subtractedValue <= BigInt(0)) return { ok: false, value: ERR_ZERO_AMOUNT };
    const key = `${this.caller}-${spender}`;
    const current = this.state.tokenApprovals.get(key) || BigInt(0);
    if (current < subtractedValue) return { ok: false, value: ERR_INSUFFICIENT_APPROVAL };
    this.state.tokenApprovals.set(key, current - subtractedValue);
    return { ok: true, value: true };
  }

  getTransferMemo(txHash: string): string | null {
    return this.state.transferMemos.get(txHash) || null;
  }
}

describe("MicroToken", () => {
  let contract: MicroTokenMock;

  beforeEach(() => {
    contract = new MicroTokenMock();
    contract.reset();
  });

  it("mints tokens successfully", () => {
    contract.authorizeMinter(BigInt(1), "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH");
    const result = contract.mint(BigInt(1), BigInt(1000), "ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getBalance("ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2")!.value).toBe(BigInt(1000));
    expect(contract.getTotalSupply()!.value).toBe(BigInt(1000));
    expect(contract.getBudgetSupply(BigInt(1))!.value).toBe(BigInt(1000));
  });

  it("rejects mint without authorization", () => {
    const result = contract.mint(BigInt(1), BigInt(1000), "ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_MINTER);
  });

  it("rejects mint when paused", () => {
    contract.authorizeMinter(BigInt(1), "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH");
    contract.setPause(true);
    const result = contract.mint(BigInt(1), BigInt(1000), "ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PAUSED);
  });

  it("rejects mint exceeding supply cap", () => {
    contract.authorizeMinter(BigInt(1), "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH");
    contract.setSupplyCap(BigInt(500));
    const result = contract.mint(BigInt(1), BigInt(1000), "ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_SUPPLY_EXCEEDED);
  });

  it("burns tokens successfully", () => {
    contract.authorizeMinter(BigInt(1), "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH");
    contract.mint(BigInt(1), BigInt(1000), "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH");
    const result = contract.burn(BigInt(1), BigInt(500), "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getBalance("ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH")!.value).toBe(BigInt(500));
    expect(contract.getTotalSupply()!.value).toBe(BigInt(500));
    expect(contract.getBudgetSupply(BigInt(1))!.value).toBe(BigInt(500));
  });

  it("rejects burn with insufficient balance", () => {
    contract.authorizeMinter(BigInt(1), "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH");
    contract.mint(BigInt(1), BigInt(1000), "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH");
    const result = contract.burn(BigInt(1), BigInt(1500), "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_TRANSFER_FAILED);
  });

  it("transfers tokens successfully", () => {
    contract.authorizeMinter(BigInt(1), "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH");
    contract.mint(BigInt(1), BigInt(1000), "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH");
    const result = contract.transfer("ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2", BigInt(300), null);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getBalance("ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH")!.value).toBe(BigInt(700));
    expect(contract.getBalance("ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2")!.value).toBe(BigInt(300));
  });

  it("records transfer memo", () => {
    contract.authorizeMinter(BigInt(1), "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH");
    contract.mint(BigInt(1), BigInt(1000), "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH");
    const memo = "Test memo";
    contract.transfer("ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2", BigInt(300), memo);
    const txHash = `mock-hash-${contract.blockHeight}`;
    const memoData = contract.getTransferMemo(txHash);
    expect(memoData).toBe(memo);
  });

  it("transfers from with approval", () => {
    contract.authorizeMinter(BigInt(1), "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH");
    contract.mint(BigInt(1), BigInt(1000), "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH");
    contract.approve("ST3JRS1N3N2MFQ8VAR3MQ1NX3NWSVMNXFS6YWFH4K", BigInt(500));
    contract.caller = "ST3JRS1N3N2MFQ8VAR3MQ1NX3NWSVMNXFS6YWFH4K";
    const result = contract.transferFrom("ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH", "ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2", BigInt(400));
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getBalance("ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH")!.value).toBe(BigInt(600));
    expect(contract.getBalance("ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2")!.value).toBe(BigInt(400));
    expect(contract.getAllowance("ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH", "ST3JRS1N3N2MFQ8VAR3MQ1NX3NWSVMNXFS6YWFH4K")!.value).toBe(BigInt(100));
  });

  it("rejects transfer from without approval", () => {
    contract.authorizeMinter(BigInt(1), "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH");
    contract.mint(BigInt(1), BigInt(1000), "ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH");
    contract.caller = "ST3JRS1N3N2MFQ8VAR3MQ1NX3NWSVMNXFS6YWFH4K";
    const result = contract.transferFrom("ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH", "ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2", BigInt(400));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_APPROVAL);
  });

  it("increases allowance", () => {
    contract.approve("ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2", BigInt(100));
    const result = contract.increaseAllowance("ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2", BigInt(200));
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getAllowance("ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH", "ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2")!.value).toBe(BigInt(300));
  });

  it("decreases allowance", () => {
    contract.approve("ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2", BigInt(500));
    const result = contract.decreaseAllowance("ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2", BigInt(200));
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getAllowance("ST1PQHQKV0RJXZHJ1F0ST4Q84590VD8WXGYM52CWH", "ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2")!.value).toBe(BigInt(300));
  });

  it("rejects decrease below zero", () => {
    contract.approve("ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2", BigInt(100));
    const result = contract.decreaseAllowance("ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2", BigInt(200));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_APPROVAL);
  });

  it("sets admin successfully", () => {
    const result = contract.setAdmin("ST3PF13W7Z0RRM5GBG87C4DXFM13VVU486DZ2CDLA");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.admin).toBe("ST3PF13W7Z0RRM5GBG87C4DXFM13VVU486DZ2CDLA");
  });

  it("rejects set admin by non-admin", () => {
    contract.caller = "ST3PF13W7Z0RRM5GBG87C4DXFM13VVU486DZ2CDLA";
    const result = contract.setAdmin("ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });

  it("authorizes minter successfully", () => {
    const result = contract.authorizeMinter(BigInt(2), "ST3PF13W7Z0RRM5GBG87C4DXFM13VVU486DZ2CDLA");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.isAuthorizedMinter(BigInt(2), "ST3PF13W7Z0RRM5GBG87C4DXFM13VVU486DZ2CDLA")!.value).toBe(true);
  });

  it("rejects authorize minter by non-admin", () => {
    contract.caller = "ST3PF13W7Z0RRM5GBG87C4DXFM13VVU486DZ2CDLA";
    const result = contract.authorizeMinter(BigInt(2), "ST2CY5V39NHDPWSXMW9QDW3RYRqdFKC7dqcyTxAf2");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });
});