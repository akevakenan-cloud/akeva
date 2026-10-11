export type Status = "onboarding" | "pending" | "approved" | "rejected" | "suspended" | "banned";
export type Category = "moto" | "economy" | "comfort" | "prestige" | "gold" | "platinum";
export const CATEGORIES: Category[] = ["moto", "economy", "comfort", "prestige", "gold", "platinum"];
export const COUNTRIES = [
  { code: "CM", fr: "Cameroun", en: "Cameroon" },
  { code: "TD", fr: "Tchad", en: "Chad" },
  { code: "GA", fr: "Gabon", en: "Gabon" },
  { code: "GQ", fr: "Guinée Équatoriale", en: "Equatorial Guinea" },
  { code: "CF", fr: "Centrafrique", en: "Central African Republic" },
  { code: "CG", fr: "Congo", en: "Republic of the Congo" },
] as const;

export type Review = { action: string; reason: string | null; by_name: string | null; at: string } | null;

export type DocMeta = { id: string; doc_type: string; content_type: string; size: number; created_at: string };

export type User = {
  id: string;
  phone: string;
  role: "rider" | "driver" | "admin" | "super_admin";
  status: Status;
  full_name: string | null;
  email: string | null;
  language: string | null;
  country: string | null;
  city: string | null;
  date_of_birth: string | null;
  id_type: string | null;
  id_number: string | null;
  consent: { documents: boolean; selfie: boolean; version: string; accepted_at: string } | null;
  review: Review;
  rating: { avg: number | null; count: number } | null;
  created_at: string;
  submitted_at: string | null;
  license_number?: string | null;
  vehicle?: { type: string; make: string; model: string; year: number; color: string; plate_number: string } | null;
  payout?: { method: string; account_name: string; account_number: string; bank_name?: string | null } | null;
  driver?: {
    category: Category | null;
    suggested_category: Category | null;
    category_source: "auto" | "admin" | null;
    category_reasons?: string[];
    eligible_categories: Category[];
    online: boolean;
  };
};

export type UserDetail = User & {
  documents: DocMeta[];
  allowed_actions: string[];
  history: AuditEntry[];
};

export type AuditEntry = {
  id: string;
  actor_name: string | null;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string | null;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
};

export type Page<T> = { items: T[]; total: number; page?: number; page_size?: number };
