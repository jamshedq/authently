/*
 * Authently — Open-source AI content engine
 * Copyright (C) 2026 The Authently Contributors
 *
 * This file is part of Authently.
 *
 * Authently is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AxiomWebVitals } from "next-axiom";
import { Header } from "@/components/header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Authently",
  description:
    "Open-source, multi-tenant AI content engine. Your voice, your platforms, your keys.",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {/* AxiomWebVitals is a no-op without AXIOM_TOKEN / AXIOM_DATASET. */}
        <AxiomWebVitals />
        <Header />
        <main className="container py-8">{children}</main>
      </body>
    </html>
  );
}
