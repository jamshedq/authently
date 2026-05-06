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

import { afterEach, describe, expect, test } from "vitest";
import {
  createAnonClient,
  createAuthenticatedClient,
  createServiceRoleClient,
} from "../helpers/supabase-clients.ts";
import { TestUserPool } from "../helpers/test-user.ts";

// =============================================================================
// Sprint 07 C2b.2 — sources-pdf bucket RLS perimeter.
//
// Coverage (4 RLS policies × the operations user-facing flows exercise):
//   1. Anon rejected from upload (INSERT policy perimeter).
//   2. Anon rejected from download (SELECT policy perimeter).
//   3. Cross-tenant write: authenticated non-member rejected from uploading
//      to another workspace's path.
//   4. Cross-tenant read: authenticated non-member rejected from downloading
//      another workspace's path.
//   5. Cross-tenant delete: authenticated non-member rejected from deleting
//      another workspace's path.
//   6. Member happy path: upload + download + delete own workspace's path.
//
// All policies enforce membership via private.is_workspace_member with the
// workspace_id parsed from path segment 2 (after literal 'ws'). Service-role
// bypasses RLS; the test fixtures use service-role only for inspection +
// teardown, never for the perimeter assertions.
// =============================================================================

// %PDF magic header — minimum byte sequence the bucket's
// allowed_mime_types = ['application/pdf'] check will accept paired with
// contentType: 'application/pdf'. Real PDF parsing is not exercised here;
// these tests are RLS-perimeter only.
const FAKE_PDF_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34,
]);

const SOURCES_PDF_BUCKET = "sources-pdf";

function pathFor(workspaceId: string, sourceId: string): string {
  return `ws/${workspaceId}/${sourceId}.pdf`;
}

function makeSourceId(): string {
  return crypto.randomUUID();
}

describe("storage.objects RLS — sources-pdf bucket", () => {
  const pool = new TestUserPool();

  afterEach(async () => {
    // Storage objects seeded by service-role in failure-perimeter tests
    // (anon-rejected, non-member-rejected) become orphans when pool.cleanup()
    // drops the workspaces — Storage doesn't cascade. Each test uses a
    // unique workspaceId (TestUserPool generates fresh UUIDs), so orphan
    // paths don't collide with subsequent tests' assertions. Local dev
    // bucket cruft accumulates across runs without `supabase db reset`,
    // which wipes Storage. No explicit sweep needed for test correctness;
    // this is exactly the orphan class accepted in SPRINT_07_carryovers.md
    // entry #2 [E6d-Storage addendum] (in test scope, not production).
    await pool.cleanup();
  });

  test("perimeter: anon rejected from uploading (INSERT policy)", async () => {
    const owner = await pool.create({ fullName: "Workspace Owner" });
    const sourceId = makeSourceId();
    const path = pathFor(owner.workspaceId, sourceId);

    const anon = createAnonClient();
    const { error } = await anon.storage
      .from(SOURCES_PDF_BUCKET)
      .upload(path, FAKE_PDF_BYTES, {
        contentType: "application/pdf",
        upsert: false,
      });

    expect(error).not.toBeNull();

    // Sanity: confirm no object landed.
    const admin = createServiceRoleClient();
    const { data: list } = await admin.storage
      .from(SOURCES_PDF_BUCKET)
      .list(`ws/${owner.workspaceId}`);
    expect(list ?? []).toEqual([]);
  });

  test("perimeter: anon rejected from downloading (SELECT policy)", async () => {
    const owner = await pool.create({ fullName: "Owner With Object" });
    const sourceId = makeSourceId();
    const path = pathFor(owner.workspaceId, sourceId);

    // Seed the object via service-role (bypasses RLS).
    const admin = createServiceRoleClient();
    const { error: seedError } = await admin.storage
      .from(SOURCES_PDF_BUCKET)
      .upload(path, FAKE_PDF_BYTES, {
        contentType: "application/pdf",
        upsert: false,
      });
    expect(seedError).toBeNull();

    // Anon attempts to download — should be rejected by SELECT policy.
    const anon = createAnonClient();
    const { data, error } = await anon.storage
      .from(SOURCES_PDF_BUCKET)
      .download(path);

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  test("cross-tenant write: non-member cannot upload to another workspace's path", async () => {
    const owner = await pool.create({ fullName: "Workspace Owner" });
    const outsider = await pool.create({ fullName: "Outsider" });
    const sourceId = makeSourceId();
    const ownerPath = pathFor(owner.workspaceId, sourceId);

    const outsiderClient = createAuthenticatedClient(outsider.accessToken);
    const { error } = await outsiderClient.storage
      .from(SOURCES_PDF_BUCKET)
      .upload(ownerPath, FAKE_PDF_BYTES, {
        contentType: "application/pdf",
        upsert: false,
      });

    expect(error).not.toBeNull();

    // Sanity: confirm no object landed in the owner's path.
    const admin = createServiceRoleClient();
    const { data: list } = await admin.storage
      .from(SOURCES_PDF_BUCKET)
      .list(`ws/${owner.workspaceId}`);
    expect(list ?? []).toEqual([]);
  });

  test("cross-tenant read: non-member cannot download another workspace's path", async () => {
    const owner = await pool.create({ fullName: "Workspace Owner" });
    const outsider = await pool.create({ fullName: "Outsider" });
    const sourceId = makeSourceId();
    const ownerPath = pathFor(owner.workspaceId, sourceId);

    // Seed the owner's object via service-role.
    const admin = createServiceRoleClient();
    const { error: seedError } = await admin.storage
      .from(SOURCES_PDF_BUCKET)
      .upload(ownerPath, FAKE_PDF_BYTES, {
        contentType: "application/pdf",
        upsert: false,
      });
    expect(seedError).toBeNull();

    const outsiderClient = createAuthenticatedClient(outsider.accessToken);
    const { data, error } = await outsiderClient.storage
      .from(SOURCES_PDF_BUCKET)
      .download(ownerPath);

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  test("cross-tenant delete: non-member cannot delete another workspace's path", async () => {
    const owner = await pool.create({ fullName: "Workspace Owner" });
    const outsider = await pool.create({ fullName: "Outsider" });
    const sourceId = makeSourceId();
    const ownerPath = pathFor(owner.workspaceId, sourceId);

    // Seed the owner's object via service-role.
    const admin = createServiceRoleClient();
    const { error: seedError } = await admin.storage
      .from(SOURCES_PDF_BUCKET)
      .upload(ownerPath, FAKE_PDF_BYTES, {
        contentType: "application/pdf",
        upsert: false,
      });
    expect(seedError).toBeNull();

    // Outsider attempts delete — should be rejected by DELETE policy.
    const outsiderClient = createAuthenticatedClient(outsider.accessToken);
    const { data: removed, error } = await outsiderClient.storage
      .from(SOURCES_PDF_BUCKET)
      .remove([ownerPath]);

    // Supabase Storage's remove() on RLS-rejected paths returns an empty
    // `data` array (no objects matched the policy) rather than an explicit
    // error. The perimeter check is therefore: the object must STILL exist
    // after the outsider's remove() call.
    expect(error).toBeNull();
    expect(removed ?? []).toEqual([]);

    const { data: listAfter } = await admin.storage
      .from(SOURCES_PDF_BUCKET)
      .list(`ws/${owner.workspaceId}`);
    expect(listAfter).toHaveLength(1);
    expect(listAfter?.[0]?.name).toBe(`${sourceId}.pdf`);
  });

  test("member happy path: upload + download + delete own workspace's path", async () => {
    const owner = await pool.create({ fullName: "Source Owner" });
    const sourceId = makeSourceId();
    const path = pathFor(owner.workspaceId, sourceId);
    const ownerClient = createAuthenticatedClient(owner.accessToken);

    // Upload.
    const { error: uploadError } = await ownerClient.storage
      .from(SOURCES_PDF_BUCKET)
      .upload(path, FAKE_PDF_BYTES, {
        contentType: "application/pdf",
        upsert: false,
      });
    expect(uploadError).toBeNull();

    // Download (verifies SELECT policy).
    const { data: downloaded, error: downloadError } = await ownerClient.storage
      .from(SOURCES_PDF_BUCKET)
      .download(path);
    expect(downloadError).toBeNull();
    expect(downloaded).not.toBeNull();
    const bytes = new Uint8Array(await (downloaded as Blob).arrayBuffer());
    expect(bytes.byteLength).toBe(FAKE_PDF_BYTES.byteLength);
    expect(bytes[0]).toBe(0x25); // '%'
    expect(bytes[1]).toBe(0x50); // 'P'

    // Delete (verifies DELETE policy).
    const { data: removed, error: removeError } = await ownerClient.storage
      .from(SOURCES_PDF_BUCKET)
      .remove([path]);
    expect(removeError).toBeNull();
    expect(removed).toHaveLength(1);

    // Sanity: confirm the object is gone.
    const admin = createServiceRoleClient();
    const { data: listAfter } = await admin.storage
      .from(SOURCES_PDF_BUCKET)
      .list(`ws/${owner.workspaceId}`);
    expect(listAfter ?? []).toEqual([]);
  });
});
