export function sanitizeFileName(name: string): string {
  const sanitized = name
    .normalize("NFKC")
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/\.\.+/g, ".")
    .trim()
    .slice(0, 180);

  return sanitized || "file";
}
