import type { Metadata } from "next";
import { SignIn } from "@/components/auth/sign-in";

export const metadata: Metadata = {
  title: "Loam sign-in",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <SignIn />;
}
