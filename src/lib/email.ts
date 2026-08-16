import { Resend } from "resend";

const FROM_ADDRESS = "CobraDora <naoresponda@cobradora.com.br>";

function getClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY ausente");
  return new Resend(apiKey);
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const resend = getClient();
  await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: "Redefinir sua senha — CobraDora",
    html: `<p>Recebemos um pedido para redefinir sua senha na CobraDora.</p><p><a href="${resetUrl}">Clique aqui para criar uma nova senha</a>. O link expira em 30 minutos.</p><p>Se você não pediu isso, pode ignorar este e-mail.</p>`,
  });
}
