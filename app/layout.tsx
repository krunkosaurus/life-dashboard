import "./globals.css";
import { DashboardNav } from "@/components/DashboardNav";

export const metadata = { title: "Life Dashboard" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><DashboardNav />{children}</body>
    </html>
  );
}
