import Database from "better-sqlite3";

const ACCESS_HINT =
  "[rackpad] Database access failed. Ensure DATABASE_PATH names a file in an existing directory writable by the service user, including existing database, WAL and SHM files. For Docker bind mounts, match host ownership to the container user; PUID/PGID do not change it. See INSTALL.md#bind-mounts-and-container-users.";

export function openDatabase(filename: string) {
  let connection: Database.Database | undefined;
  try {
    connection = new Database(filename);
    connection.pragma("journal_mode = WAL");
    connection.pragma("foreign_keys = ON");
    return connection;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
    // better-sqlite3 checks missing parent directories before calling SQLite.
    const missingDirectory = error instanceof TypeError &&
      error.message === "Cannot open database because the directory does not exist";
    if (missingDirectory || (typeof code === "string" &&
      /^(?:SQLITE_CANTOPEN(?:_|$)|SQLITE_READONLY(?:_|$)|EACCES$|EPERM$|ENOENT$)/.test(code))) {
      // Deliberately omit the configured path, environment and original message.
      console.error(ACCESS_HINT);
    }
    try { connection?.close(); } catch { /* Preserve the original startup error. */ }
    throw error;
  }
}
