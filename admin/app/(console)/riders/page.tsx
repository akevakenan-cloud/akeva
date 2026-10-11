"use client";

import { Suspense } from "react";
import { PeopleQueue } from "@/components/PeopleQueue";

export default function Page() {
  return (
    <Suspense>
      <PeopleQueue role="rider" />
    </Suspense>
  );
}
