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

// THIS FILE IS GENERATED — DO NOT EDIT BY HAND.
// Source:    packages/db/scripts/generate-types.ts
// Generator: supabase gen types typescript
// Schemas:   public, private
// Regenerate with: pnpm db:gen-types

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  private: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_ownership_transfer_impl: {
        Args: { _transfer_id: string }
        Returns: undefined
      }
      cancel_ownership_transfer_impl: {
        Args: { _transfer_id: string }
        Returns: undefined
      }
      create_workspace_for_user: {
        Args: { _name: string; _user_id: string }
        Returns: string
      }
      delete_workspace_impl: {
        Args: { _workspace_id: string }
        Returns: undefined
      }
      downgrade_workspace_to_free_impl: {
        Args: { _workspace_id: string }
        Returns: undefined
      }
      ensure_workspace_for_user: {
        Args: { _base_name: string; _email: string; _user_id: string }
        Returns: string
      }
      find_workspaces_past_due_grace_expired_impl: {
        Args: never
        Returns: {
          workspace_id: string
        }[]
      }
      generate_workspace_slug: { Args: { _base: string }; Returns: string }
      has_workspace_role: {
        Args: { _roles: string[]; _workspace_id: string }
        Returns: boolean
      }
      initiate_ownership_transfer_impl: {
        Args: { _to_user_id: string; _workspace_id: string }
        Returns: string
      }
      is_workspace_member: { Args: { _workspace_id: string }; Returns: boolean }
      process_stripe_event_impl: {
        Args: {
          _current_period_end: string
          _customer_id: string
          _event_id: string
          _payload: Json
          _price_id: string
          _subscription_id: string
          _type: string
          _workspace_id_hint: string
        }
        Returns: string
      }
      set_workspace_stripe_customer_impl: {
        Args: { _stripe_customer_id: string; _workspace_id: string }
        Returns: undefined
      }
      slugify: { Args: { _input: string }; Returns: string }
      touch_workspace_member_activity_impl: {
        Args: { _workspace_id: string }
        Returns: undefined
      }
      upsert_stripe_price_tier_map_impl: {
        Args: { _entries: Json }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      smoke_test: {
        Row: {
          created_at: string
          id: string
          note: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "smoke_test_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_events: {
        Row: {
          event_id: string
          payload: Json
          processed_outcome: string | null
          received_at: string
          type: string
          workspace_id: string | null
        }
        Insert: {
          event_id: string
          payload: Json
          processed_outcome?: string | null
          received_at?: string
          type: string
          workspace_id?: string | null
        }
        Update: {
          event_id?: string
          payload?: Json
          processed_outcome?: string | null
          received_at?: string
          type?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stripe_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_price_tier_map: {
        Row: {
          created_at: string
          plan_tier: string
          stripe_price_id: string
        }
        Insert: {
          created_at?: string
          plan_tier: string
          stripe_price_id: string
        }
        Update: {
          created_at?: string
          plan_tier?: string
          stripe_price_id?: string
        }
        Relationships: []
      }
      workspace_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: string
          token_hash: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role: string
          token_hash: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: string
          token_hash?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          last_active_at: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          last_active_at?: string
          role: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          last_active_at?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_ownership_transfers: {
        Row: {
          accepted_at: string | null
          cancelled_at: string | null
          created_at: string
          from_user_id: string
          id: string
          to_user_id: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          from_user_id: string
          id?: string
          to_user_id: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          from_user_id?: string
          id?: string
          to_user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_ownership_transfers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          past_due_since: string | null
          plan_tier: string
          slug: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_current_period_end: string | null
          subscription_status: string
          template: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          past_due_since?: string | null
          plan_tier?: string
          slug: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_current_period_end?: string | null
          subscription_status?: string
          template?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          past_due_since?: string | null
          plan_tier?: string
          slug?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_current_period_end?: string | null
          subscription_status?: string
          template?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      api_accept_invitation: {
        Args: { _token: string }
        Returns: {
          workspace_name: string
          workspace_slug: string
        }[]
      }
      api_accept_ownership_transfer: {
        Args: { _transfer_id: string }
        Returns: undefined
      }
      api_cancel_ownership_transfer: {
        Args: { _transfer_id: string }
        Returns: undefined
      }
      api_create_workspace: {
        Args: { _name: string }
        Returns: {
          id: string
          name: string
          plan_tier: string
          slug: string
          template: string
        }[]
      }
      api_delete_workspace: {
        Args: { _workspace_id: string }
        Returns: undefined
      }
      api_ensure_my_workspace: { Args: never; Returns: string }
      api_initiate_ownership_transfer: {
        Args: { _to_user_id: string; _workspace_id: string }
        Returns: string
      }
      api_list_workspace_members: {
        Args: { _workspace_slug: string }
        Returns: {
          email: string
          full_name: string
          joined_at: string
          role: string
          user_id: string
        }[]
      }
      api_lookup_invitation: {
        Args: { _token: string }
        Returns: {
          email_hint: string
          role: string
          status: string
          workspace_name: string
          workspace_slug: string
        }[]
      }
      api_revoke_invitation: {
        Args: { _invitation_id: string }
        Returns: undefined
      }
      api_touch_workspace_member_activity: {
        Args: { _workspace_id: string }
        Returns: undefined
      }
      svc_downgrade_workspace_to_free: {
        Args: { _workspace_id: string }
        Returns: undefined
      }
      svc_find_workspaces_past_due_grace_expired: {
        Args: never
        Returns: {
          workspace_id: string
        }[]
      }
      svc_process_stripe_event: {
        Args: {
          _current_period_end: string
          _customer_id: string
          _event_id: string
          _payload: Json
          _price_id: string
          _subscription_id: string
          _type: string
          _workspace_id_hint: string
        }
        Returns: string
      }
      svc_set_workspace_stripe_customer: {
        Args: { _stripe_customer_id: string; _workspace_id: string }
        Returns: undefined
      }
      svc_upsert_stripe_price_tier_map: {
        Args: { _entries: Json }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  private: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

