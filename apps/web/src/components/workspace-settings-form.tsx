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

// Section B2 — workspace rename + template-change form. Client Component
// because it owns the form state. Submission targets PATCH
// /api/ws/[slug], which is gated by `withMembership({ requireRole:
// ['owner','admin'] })` plus the `workspaces_owner_admin_update` RLS
// policy from migration 20260429213717. Editor/viewer never see this
// form because the page guard (requireMembership) redirects them away
// before render.

"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { UpdateWorkspaceSchema } from "@/lib/schemas/workspaces";

type Template = "creator" | "smb" | "community";

type Props = {
  workspaceSlug: string;
  initialName: string;
  initialTemplate: Template;
};

const TEMPLATE_OPTIONS: Array<{
  value: Template;
  label: string;
  description: string;
}> = [
  {
    value: "creator",
    label: "Creator",
    description: "Solo creators who write in their own voice.",
  },
  {
    value: "smb",
    label: "SMB",
    description: "Small businesses with shared review workflows.",
  },
  {
    value: "community",
    label: "Community",
    description: "Faith communities and member-driven groups.",
  },
];

export function WorkspaceSettingsForm({
  workspaceSlug,
  initialName,
  initialTemplate,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [template, setTemplate] = useState<Template>(initialTemplate);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const isDirty = name !== initialName || template !== initialTemplate;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const patch: { name?: string; template?: Template } = {};
    if (name !== initialName) patch.name = name;
    if (template !== initialTemplate) patch.template = template;

    const parsed = UpdateWorkspaceSchema.safeParse(patch);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }

    setIsPending(true);
    try {
      const res = await fetch(`/api/ws/${workspaceSlug}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Couldn't save changes.");
      }
      toast.success("Workspace updated");
      // Refresh the Server Component tree so the Header switcher + name
      // reflect the new state without a full reload.
      router.refresh();
      setIsPending(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save changes.");
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <div className="space-y-2">
        <Label htmlFor="workspace-name">Workspace name</Label>
        <Input
          id="workspace-name"
          name="name"
          type="text"
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
        />
        <p className="text-[12px] text-muted-foreground">
          The URL slug stays the same when you rename.
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <Label>Template</Label>
          <p className="text-[12px] text-muted-foreground">
            Sets defaults for tone, review workflow, and onboarding.
          </p>
        </div>
        <RadioGroup
          value={template}
          onValueChange={(value) => setTemplate(value as Template)}
          className="gap-3"
        >
          {TEMPLATE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              htmlFor={`template-${opt.value}`}
              className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border/60 p-4 transition hover:border-border"
            >
              <RadioGroupItem
                id={`template-${opt.value}`}
                value={opt.value}
                className="mt-0.5"
              />
              <div>
                <p className="text-[14px] font-medium leading-none text-foreground">
                  {opt.label}
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {opt.description}
                </p>
              </div>
            </label>
          ))}
        </RadioGroup>
      </div>

      {error ? (
        <p role="alert" className="text-[14px] text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!isDirty || isPending}>
          {isPending ? "Saving…" : "Save changes"}
        </Button>
        {isDirty && !isPending ? (
          <button
            type="button"
            onClick={() => {
              setName(initialName);
              setTemplate(initialTemplate);
              setError(null);
            }}
            className="text-[14px] text-muted-foreground hover:text-foreground"
          >
            Discard
          </button>
        ) : null}
      </div>
    </form>
  );
}
