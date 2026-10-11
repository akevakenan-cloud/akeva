"use client";

import { use } from "react";
import { UserReview } from "@/components/UserReview";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <UserReview id={id} role="driver" />;
}
