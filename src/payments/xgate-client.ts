import "server-only";
import { z } from "zod";

// Contracts checked against api.doc.xgateglobal.com on 2026-09-24.
// The summary tables say currency:string; detailed examples require the full
// currency object. Keep that object, selected separately for deposits/withdrawals.
const idSchema = z.string().trim().min(1).max(200);
const pixTypeSchema = z.enum(["CPF", "CNPJ", "EMAIL", "PHONE", "RANDOM"]);
const pixKeySchema = z.object({ _id: idSchema, key: z.string().min(1).max(320), type: pixTypeSchema }).passthrough();
const currencySchema = z.object({ _id: idSchema, name: z.literal("BRL"), type: z.literal("PIX"), symbol: z.string().min(1) }).passthrough();
const customerSchema = z.object({ _id: idSchema, name: z.string().optional(), document: z.string().optional(), email: z.string().optional() }).passthrough();
const detailsSchema = z.object({
  _id: idSchema,
  customerId: idSchema,
  externalId: z.string().optional(),
  status: z.string().optional(),
  currency: z.object({ name: z.literal("BRL"), type: z.literal("PIX"), amount: z.number().finite().nonnegative(), status: z.string().min(1) }).passthrough(),
  generatedReceiptAt: z.string().optional(),
}).passthrough();

export type XGateCurrency = z.infer<typeof currencySchema>;
export type XGatePixKey = z.infer<typeof pixKeySchema>;
export type XGateTransactionDetails = z.infer<typeof detailsSchema>;
export type XGateOrderInput = { amountCents: number; customerId: string; externalId: string; currency: XGateCurrency };
export type XGateClientConfig = { email: string; password: string; timeoutMs?: number; fetch?: typeof fetch };

/** unknown means the operation may have happened. Never refund/retry with a new ID. */
export class XGateError extends Error {
  constructor(
    message: string,
    public readonly outcome: "rejected" | "unknown",
    public readonly code: "validation" | "configuration" | "transport" | "http" | "response",
    public readonly httpStatus?: number,
  ) { super(message); this.name = "XGateError"; }
}

export function centsToXGateAmount(cents: number): number {
  // Below this bound JSON decimal conversion preserves two decimal places.
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 1_000_000_000_000) {
    throw new XGateError("Valor inválido em centavos.", "rejected", "validation");
  }
  return cents / 100;
}

export function xgateAmountToCents(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000_000) {
    throw new XGateError("Valor XGate inválido.", "unknown", "response");
  }
  const cents = Math.round(amount * 100);
  if (Math.abs(amount - cents / 100) > 0.0000001) {
    throw new XGateError("Valor XGate possui fração de centavo.", "unknown", "response");
  }
  return cents;
}

export class XGateClient {
  private readonly email: string;
  private readonly password: string;
  private readonly timeoutMs: number;
  private readonly transport: typeof fetch;
  private token?: { value: string; expiresAt: number };
  private authentication?: Promise<string>;

  constructor(config?: XGateClientConfig) {
    this.email = config?.email ?? process.env.XGATE_EMAIL ?? "";
    this.password = config?.password ?? process.env.XGATE_PASSWORD ?? "";
    this.timeoutMs = config?.timeoutMs ?? Number(process.env.XGATE_TIMEOUT_MS ?? 10000);
    this.transport = config?.fetch ?? fetch;
    if (!this.email || !this.password || !Number.isInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 60000) {
      throw new XGateError("Configuração XGate ausente ou inválida.", "rejected", "configuration");
    }
  }

  private input<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new XGateError("Dados inválidos para a XGate.", "rejected", "validation");
    return parsed.data;
  }

  private async raw(path: string, method: "GET" | "POST", body?: unknown, token?: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(`https://api.xgateglobal.com${path}`, {
        method, signal: controller.signal, cache: "no-store", redirect: "error",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        // 409 can denote an existing order. 408/429/5xx may follow acceptance.
        const rejected = [400, 401, 403, 404, 405, 422].includes(response.status);
        throw new XGateError(`XGate respondeu HTTP ${response.status}.`, rejected ? "rejected" : "unknown", "http", response.status);
      }
      // Do not expose provider bodies/errors: they may contain credentials or PII.
      return await response.json();
    } catch (error) {
      if (error instanceof XGateError) throw error;
      throw new XGateError("Resposta XGate indisponível ou inconclusiva.", "unknown", "transport");
    } finally { clearTimeout(timer); }
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60000) return this.token.value;
    if (this.authentication) return this.authentication;
    this.authentication = (async () => {
      const value = await this.raw("/auth/token", "POST", { email: this.email, password: this.password });
      const parsed = z.object({ token: z.string().min(1) }).safeParse(value);
      if (!parsed.success) throw new XGateError("Token XGate inválido.", "rejected", "response");
      // JWT decoding is only a cache expiry hint, never identity verification.
      let expiresAt = Date.now() + 14 * 86400000;
      try {
        const claims = JSON.parse(Buffer.from(parsed.data.token.split(".")[1], "base64url").toString("utf8"));
        if (typeof claims.exp === "number" && Number.isFinite(claims.exp)) expiresAt = Math.min(expiresAt, claims.exp * 1000);
      } catch { /* opaque tokens use conservative documented 15-day lifetime */ }
      this.token = { value: parsed.data.token, expiresAt };
      return parsed.data.token;
    })();
    try { return await this.authentication; } finally { this.authentication = undefined; }
  }

  private async request<T>(path: string, method: "GET" | "POST", schema: z.ZodType<T>, body?: unknown): Promise<T> {
    // Authentication failures precede submission of the financial operation.
    let token: string;
    try { token = await this.getToken(); }
    catch { throw new XGateError("Não foi possível autenticar na XGate.", "rejected", "configuration"); }
    let value: unknown;
    try { value = await this.raw(path, method, body, token); }
    catch (error) {
      if (error instanceof XGateError && error.httpStatus === 401) {
        if (this.token?.value === token) this.token = undefined;
        // Only reads are replayed automatically. Writes require caller decision.
        if (method === "GET") value = await this.raw(path, method, body, await this.getToken());
        else throw error;
      } else throw error;
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new XGateError("Contrato de resposta XGate inválido.", "unknown", "response");
    return parsed.data;
  }

  createCustomer(input: { name: string; document: string; email?: string; phone?: string }) {
    const body = this.input(z.object({ name: z.string().trim().min(1).max(200), document: z.string().regex(/^(\d{11}|\d{14})$/), email: z.string().email().optional(), phone: z.string().max(30).optional() }), input);
    // A returned existing customer is NOT proof of matching document or KYC.
    return this.request("/customer", "POST", z.object({ customer: customerSchema }).passthrough(), body);
  }

  getCustomer(id: string) {
    return this.request(`/customer/${encodeURIComponent(this.input(idSchema, id))}`, "GET", customerSchema);
  }

  listPixKeys(customerId: string) {
    return this.request(`/pix/customer/${encodeURIComponent(this.input(idSchema, customerId))}/key`, "GET", z.array(pixKeySchema));
  }

  addPixKey(customerId: string, key: Pick<XGatePixKey, "key" | "type">) {
    return this.request(`/pix/customer/${encodeURIComponent(this.input(idSchema, customerId))}/key`, "POST", z.object({ key: pixKeySchema }).passthrough(), this.input(pixKeySchema.omit({ _id: true }).strip(), key));
  }

  async getBrlCurrency(operation: "deposit" | "withdraw"): Promise<XGateCurrency> {
    this.input(z.enum(["deposit", "withdraw"]), operation);
    const currencies = await this.request(`/${operation}/company/currencies`, "GET", z.array(z.unknown()));
    const matches = currencies.map((item) => currencySchema.safeParse(item)).filter((item) => item.success);
    if (matches.length !== 1) throw new XGateError("Moeda BRL/PIX XGate ausente ou ambígua.", "rejected", "response");
    return matches[0].data!;
  }

  private order(input: XGateOrderInput) {
    return { amount: centsToXGateAmount(input.amountCents), customerId: this.input(idSchema, input.customerId), externalId: this.input(idSchema, input.externalId), currency: this.input(currencySchema, input.currency) };
  }

  createDeposit(input: XGateOrderInput) {
    return this.request("/deposit", "POST", z.object({ data: z.object({ id: idSchema, code: z.string().min(1), status: z.string().min(1), customerId: idSchema }).passthrough() }).passthrough(), this.order(input));
  }

  createWithdrawal(input: XGateOrderInput & { pixKey: XGatePixKey }) {
    return this.request("/withdraw", "POST", z.object({ _id: idSchema, status: z.string().min(1) }).passthrough(), { ...this.order(input), pixKey: this.input(pixKeySchema, input.pixKey) });
  }

  async getDeposit(id: string): Promise<XGateTransactionDetails> {
    const result = await this.request(`/deposit/${encodeURIComponent(this.input(idSchema, id))}/details`, "GET", detailsSchema);
    xgateAmountToCents(result.currency.amount);
    return result;
  }

  async getWithdrawal(id: string): Promise<XGateTransactionDetails> {
    const result = await this.request(`/withdraw/${encodeURIComponent(this.input(idSchema, id))}/details`, "GET", detailsSchema);
    xgateAmountToCents(result.currency.amount);
    return result;
  }
}

let sharedClient: XGateClient | undefined;
export function getXGateClient(): XGateClient {
  return sharedClient ??= new XGateClient();
}
