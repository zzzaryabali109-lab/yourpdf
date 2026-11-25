import path from "node:path";
import { pathToFileURL } from "node:url";

/** Give each conversion its own LibreOffice profile so parallel jobs do not contend for one lock. */
export function libreOfficeUserProfileArg(tempDir: string): string {
  const profileUrl = pathToFileURL(path.join(tempDir, "lo-profile")).href;
  return `-env:UserInstallation=${profileUrl}`;
}
