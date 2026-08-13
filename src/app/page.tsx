import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/session";
import GroupayDashboard from "@/components/groupay-dashboard";

export default async function HomePage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) redirect("/login");

  try {
    await verifySession(token);
  } catch {
    redirect("/login");
  }

  return <GroupayDashboard />;
}
