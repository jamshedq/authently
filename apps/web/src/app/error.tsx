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

// Root error boundary. Catches errors thrown anywhere below the root layout
// (Server or Client Components). For errors in the root layout itself, see
// global-error.tsx — that file owns its own <html>/<body> tags and is a
// separate boundary in Next's App Router model.
//
// Must be a Client Component (Next.js requirement for error.tsx). The
// Sentry capture pattern mirrors global-error.tsx.

"use client";

import * as Sentry from "@sentry/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  const router = useRouter();

  useEffect(() => {
    Sentry.captureException(error, {
      tags: { source: "app.error-boundary" },
    });
  }, [error]);

  return (
    <section className="container mx-auto max-w-2xl px-6 py-24 md:py-32">
      <p className="font-mono text-[12px] font-medium uppercase tracking-[0.6px] text-muted-foreground">
        Unexpected error
      </p>
      <h1 className="mt-4 text-[40px] font-semibold leading-[1.1] tracking-[-0.8px] text-foreground">
        Something went wrong.
      </h1>
      <p className="mt-4 text-[16px] leading-relaxed text-[#666666]">
        We&rsquo;ve been notified — try again or return home.
      </p>

      {error.digest && (
        <p className="mt-3 font-mono text-[12px] text-muted-foreground">
          Error ID: {error.digest}
        </p>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <Button onClick={() => reset()} className="rounded-full">
          Try again
        </Button>
        <Button
          variant="ghost"
          onClick={() => router.push("/")}
          className="rounded-full"
        >
          Return home
        </Button>
      </div>
    </section>
  );
}
