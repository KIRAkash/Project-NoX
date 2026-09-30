/** Upload a capture: create it (the API hands back where to PUT), PUT the bytes with progress, then complete. */

import { api, API_URL, ApiError, authHeaders } from "@/lib/app/api";
import type { MediaCapture, MediaKind } from "@/lib/app/types";

export type CaptureMeta = {
  kind: MediaKind;
  durationS?: number | null;
  width?: number | null;
  height?: number | null;
  caption?: string | null;
  clipStartS?: number | null;
  clipEndS?: number | null;
  annotatedOf?: string | null;
  missionKey?: string | null;
  role?: string | null;
};

type Created = { id: string; uploadUrl: string; method: "PUT"; headers: Record<string, string> };

async function put(url: string, blob: Blob, headers: Record<string, string>, onProgress?: (share: number) => void): Promise<void> {
  // Our own API (local development) needs the sign-in; a signed Cloud Storage URL must not get it.
  const ours = url.startsWith("/");
  const auth = ours ? await authHeaders() : new Headers();
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", ours ? `${API_URL}${url}` : url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    auth.forEach((v, k) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, xhr.responseText ? safeDetail(xhr.responseText) : "Upload failed")));
    xhr.onerror = () => reject(new ApiError(0, "The upload was interrupted"));
    xhr.send(blob);
  });
}

function safeDetail(body: string): string {
  try {
    const d = JSON.parse(body).detail;
    return typeof d === "string" ? d : "Upload failed";
  } catch {
    return "Upload failed";
  }
}

export async function uploadCapture(blob: Blob, meta: CaptureMeta, onProgress?: (share: number) => void): Promise<MediaCapture> {
  const mime = blob.type || (meta.kind === "audio" ? "audio/webm" : meta.kind.includes("image") || meta.kind === "screenshot" ? "image/png" : "video/webm");
  const created = await api<Created>("/api/v1/media", {
    method: "POST",
    json: { ...meta, durationS: meta.durationS ? Math.round(meta.durationS * 10) / 10 : null, mime, bytes: blob.size },
  });
  await put(created.uploadUrl, blob, created.headers, onProgress);
  return api<MediaCapture>(`/api/v1/media/${created.id}/complete`, { method: "POST" });
}

/** Read a video or audio file's length in the browser (the server enforces the limits too). */
export function mediaDuration(blob: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement(blob.type.startsWith("audio") ? "audio" : "video");
    const url = URL.createObjectURL(blob);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const d = Number.isFinite(el.duration) ? el.duration : null;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    el.src = url;
  });
}

/** HEIC photos (iPhone) become JPEG where the browser can decode them; otherwise they go as they are. */
export async function normaliseImage(file: File): Promise<Blob> {
  if (!/heic|heif/i.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("convert"))), "image/jpeg", 0.9));
  } catch {
    return file;
  }
}

export function imageSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  return createImageBitmap(blob).then(
    (b) => ({ width: b.width, height: b.height }),
    () => null,
  );
}
