import { Card, Loading, Muted, Row, Screen, Title, colors, get, type, useI18n, xaf, type Ride } from "@akeva/core";
import { useEffect, useState } from "react";
import { Text } from "react-native";

export default function History() {
  const { t, lang } = useI18n();
  const [rides, setRides] = useState<Ride[] | null>(null);
  useEffect(() => {
    get<{ items: Ride[] }>("/rides").then((r) => setRides(r.items)).catch(() => setRides([]));
  }, []);
  return (
    <Screen>
      <Title>{t("rider.history")}</Title>
      {rides === null ? <Loading /> : rides.length === 0 ? <Muted>{t("rider.noHistory")}</Muted> : rides.map((r) => (
        <Card key={r.id}>
          <Row style={{ justifyContent: "space-between" }}>
            <Text style={type.heading}>{t(`cat.${r.category}`)}</Text>
            <Text style={[type.heading, { color: r.status === "cancelled" ? colors.ink3 : colors.ink }]}>
              {r.status === "completed" && r.fare ? xaf(r.fare.total, lang) : t("rider.cancelledBy")}
            </Text>
          </Row>
          <Muted>{new Date(r.created_at).toLocaleString(lang === "fr" ? "fr-FR" : "en-GB")}</Muted>
          <Text style={type.body}>{r.dropoff.address ?? ""}</Text>
          {r.driver ? <Muted>{r.driver.name} · {r.driver.vehicle.plate_number}</Muted> : null}
        </Card>
      ))}
    </Screen>
  );
}
