import { createHmac } from "node:crypto";

const [sessionId, amountCents] = process.argv.slice(2);
const secret = process.env.PAYMENT_TOKEN_SECRET ?? process.env.SESSION_SECRET;

const token = createHmac("sha256", secret)
  .update(`cobradora:checkout:webhook:${sessionId}`)
  .digest("base64url");

const res = await fetch(`http://localhost:3000/api/webhooks/infinitepay?token=${token}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    order_nsu: sessionId,
    transaction_nsu: `teste-manual-${Date.now()}`,
    amount: Number(amountCents),
    capture_method: "pix",
  }),
});
console.log(res.status, await res.json());
