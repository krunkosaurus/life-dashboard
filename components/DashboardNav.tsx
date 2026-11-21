"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function DashboardNav() {
  const pathname = usePathname();
  return (
    <nav className="dashboard-nav" aria-label="Dashboard pages">
      {[{ href: "/", label: "Overview" }, { href: "/gpus", label: "GPUs" }, { href: "/workers", label: "Workers" }, { href: "/locations", label: "Locations" }].map(tab => (
        <Link key={tab.href} href={tab.href} prefetch={false} className="dashboard-tab" aria-current={pathname === tab.href ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
