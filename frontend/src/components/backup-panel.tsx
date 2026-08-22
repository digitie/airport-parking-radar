"use client";

import { useCallback, useEffect, useState } from "react";

import type { BackupFile } from "@/lib/types";

type BackupPanelProps = {
  listBackups: () => Promise<{ items: BackupFile[] }>;
  createBackup: () => Promise<BackupFile>;
  downloadBackup: (filename: string) => Promise<Blob>;
  restoreBackup: (file: File) => Promise<{ status: "restored"; backup: BackupFile }>;
};

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatBackupTimestamp(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

export function BackupPanel({ listBackups, createBackup, downloadBackup, restoreBackup }: BackupPanelProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BackupFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await listBackups();
      setItems(response.items);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "백업 목록을 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, [listBackups]);

  useEffect(() => {
    if (open) {
      void refresh();
    }
  }, [open, refresh]);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const created = await createBackup();
      setMessage(`백업을 만들었습니다: ${created.filename}`);
      await refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "백업을 만들지 못했습니다.");
      setBusy(false);
    }
  }

  async function handleDownload(filename: string) {
    setBusy(true);
    setError(null);
    try {
      const blob = await downloadBackup(filename);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setMessage(`다운로드를 시작했습니다: ${filename}`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "백업을 다운로드하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore(file: File | undefined, input: HTMLInputElement) {
    if (!file) {
      return;
    }
    if (!window.confirm("현재 PostgreSQL 데이터를 덮어씁니다. 복원 전에 자동 백업을 만든 뒤 계속할까요?")) {
      input.value = "";
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const restored = await restoreBackup(file);
      setMessage(`복원했습니다: ${restored.backup.filename}. 화면을 새로고침하면 최신 상태를 확인할 수 있습니다.`);
      await refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "백업을 복원하지 못했습니다.");
      setBusy(false);
    } finally {
      input.value = "";
    }
  }

  return (
    <section className="backup-panel" data-testid="backup-panel">
      <button
        type="button"
        className="backup-panel-trigger"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          <strong>백업 / 복원</strong>
          <small>PostgreSQL 스냅샷 관리 · 내부 운영용</small>
        </span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>

      <p className="backup-panel-warning" role="note">
        별도 인증 없이 제공되는 운영 도구이며 데이터 덮어쓰기가 가능합니다. 외부 공개 금지 · 신뢰된 네트워크에서만 사용하세요.
      </p>

      {open ? (
        <div className="backup-panel-body">
          <p className="backup-panel-note">
            복원은 현재 PostgreSQL 데이터를 덮어쓰며, 서버가 자동 백업을 먼저 만든 뒤 진행합니다.
          </p>
          <div className="backup-panel-actions">
            <button type="button" className="button" onClick={() => void handleCreate()} disabled={busy}>
              {busy ? "처리 중…" : "새 백업 만들기"}
            </button>
            <label className="button secondary backup-upload-label">
              .dump 복원
              <input
                type="file"
                accept=".dump,application/octet-stream"
                onChange={(event) => void handleRestore(event.currentTarget.files?.[0], event.currentTarget)}
                disabled={busy}
              />
            </label>
            <button type="button" className="button secondary" onClick={() => void refresh()} disabled={busy}>
              목록 새로고침
            </button>
          </div>
          {message ? <p className="backup-panel-message" aria-live="polite">{message}</p> : null}
          {error ? <p className="backup-panel-error" role="alert">{error}</p> : null}
          {items.length > 0 ? (
            <ul className="backup-list">
              {items.map((item) => (
                <li key={item.filename}>
                  <span>
                    <strong>{item.filename}</strong>
                    <small>
                      {formatBytes(item.size_bytes)} · {formatBackupTimestamp(item.created_at)} KST
                    </small>
                  </span>
                  <button type="button" className="text-button" onClick={() => void handleDownload(item.filename)} disabled={busy}>
                    다운로드
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="backup-panel-empty">저장된 백업이 없습니다.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
