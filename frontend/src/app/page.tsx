import { DashboardApp } from "@/components/dashboard-app";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default function HomePage() {
  return <DashboardApp />;
}
