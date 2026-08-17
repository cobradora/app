import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/session";
import { getUserById } from "@/services/auth";
import CobraDoraDashboard from "@/components/cobradora-dashboard";
import LandingPage from "@/components/landing-page";

export default async function HomePage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return <LandingPage />;

  let userId: string;
  try {
    ({ userId } = await verifySession(token));
  } catch {
    return <LandingPage />;
  }

  const user = await getUserById(userId);
  if (!user) return <LandingPage />;

  return <CobraDoraDashboard user={{ name: user.name, role: user.role }} />;
}
