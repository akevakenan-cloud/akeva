import { RideChat, useEvents, type ChatMessage } from "@akeva/core";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";

export default function Chat() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const [incoming, setIncoming] = useState<ChatMessage | null>(null);
  useEvents((e) => e.event === "ride.message" && e.data.ride_id === rideId && setIncoming(e.data));
  return <RideChat rideId={rideId} incoming={incoming} />;
}
