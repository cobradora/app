import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/session";
import { getUserById } from "@/services/auth";
import CobraDoraDashboard from "@/components/cobradora-dashboard";

export default async function HomePage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) redirect("/login");

  let userId: string;
  try {
    ({ userId } = await verifySession(token));
  } catch {
    redirect("/login");
  }

  const user = await getUserById(userId);
  if (!user) redirect("/login");

  return <CobraDoraDashboard user={{ name: user.name, role: user.role }} />;
}
