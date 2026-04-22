import DashboardClient from "@/app/dashboard-client";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const data = await getDashboardData();

  return (
    <DashboardClient initialData={data} />
  );
}
