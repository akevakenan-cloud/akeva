import type { Category } from "./config";

export type RideStatus = "requested" | "accepted" | "arrived" | "in_progress" | "completed" | "cancelled";

export type Place = { lat: number; lng: number; address: string | null };

export type FareBreakdown = { total: number; subtotal: number; commission: number; driver_earnings: number };

export type Ride = {
  id: string;
  status: RideStatus;
  category: Category;
  country: string;
  pickup: Place;
  dropoff: Place;
  estimate: { distance_km: number; duration_min: number; fare: FareBreakdown };
  fare: FareBreakdown | null;
  payment: { method: string; status: "pending" | "paid" | "failed" | null };
  rider?: { name: string | null; phone?: string; rating: number | null };
  driver?: {
    name: string | null; phone?: string; rating: number | null; category: Category | null;
    vehicle: { type: string; make: string; model: string; color: string; plate_number: string };
  } | null;
  driver_location?: { lat: number; lng: number; heading: number | null };
  ratings: { by_rider: { stars: number } | null; by_driver: { stars: number } | null };
  created_at: string;
  cancelled_by: string | null;
  cancel_reason: string | null;
};

export type Offer = {
  ride_id: string;
  category: Category;
  pickup: Place;
  dropoff: Place;
  distance_km: number;
  duration_min: number;
  fare: number;
  driver_earnings: number;
  payment_method: string;
  rider_first_name: string | null;
  rider_rating: number | null;
  pickup_distance_km: number | null;
  pickup_eta_min: number | null;
  expires_at: string;
};

export type Estimate = {
  distance_km: number;
  duration_min: number;
  options: { category: Category; fare: number; pickup_eta_min: number | null; available: boolean }[];
};
