"use client";

import { useEffect, useState } from "react";
import { ApiError, apiRaw } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Category, Status } from "@/lib/types";

export function StatusBadge({ status }: { status: Status }) {
  const { t } = useI18n();
  return <span className={`badge badge-${status}`}>{t(`status.${status}`)}</span>;
}

export function CategoryTag({ category }: { category: Category | null | undefined }) {
  const { t } = useI18n();
  if (!category) return <span className="muted">—</span>;
  return <span className={`cat cat-${category}`}>{t(`cat.${category}`)}</span>;
}

export function Pager({ page, pageSize, total, onPage }: {
  page: number; pageSize: number; total: number; onPage: (p: number) => void;
}) {
  const { t } = useI18n();
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pager">
      <span className="muted num">{t("page.of", { from, to, total })}</span>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t("page.prev")}
        </button>
        <button className="btn btn-secondary btn-sm" disabled={to >= total} onClick={() => onPage(page + 1)}>
          {t("page.next")}
        </button>
      </div>
    </div>
  );
}

export function ErrorNote({ error }: { error: ApiError | null }) {
  const { t } = useI18n();
  if (!error) return null;
  return <p className="alert" role="alert">{t(errorKey(error))}</p>;
}

export function errorKey(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "network") return "error.network";
    if (e.status === 401) return "error.session";
  }
  return "error.generic";
}

export function Loading() {
  const { t } = useI18n();
  return <p className="muted" aria-busy="true">{t("loading")}</p>;
}

/**
 * Identity documents are only served to authenticated staff, so they can't be
 * plain <img src>. Fetch with the bearer token and show via an object URL.
 */
export function useSecureFile(fileId: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!fileId) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    apiRaw(`/admin/files/${fileId}`)
      .then((r) => r.blob())
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setType(blob.type);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);
  return { url, type, failed };
}
