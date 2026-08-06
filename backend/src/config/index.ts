import fs from "fs";
import { execSync } from "child_process";

export const ABSOLUTE_GS_PATH = process.env.GHOSTSCRIPT_PATH || "C:\\Program Files\\gs\\gs10.07.1\\bin\\gswin64c.exe";
export const ABSOLUTE_LIBREOFFICE_PATH = process.env.LIBREOFFICE_PATH || "C:\\Program Files\\LibreOffice\\program\\soffice.exe";
export const DEFAULT_PORT = process.env.PORT || 5000;
export const DEFAULT_TARGET_SIZE_MB = 2;

let cachedGsExec: string | null | undefined = undefined;
let cachedLoExec: string | null | undefined = undefined;

export function getGhostscriptExecutable(): string | null {
  if (cachedGsExec !== undefined) return cachedGsExec;

  if (process.env.GHOSTSCRIPT_PATH && fs.existsSync(process.env.GHOSTSCRIPT_PATH)) {
    cachedGsExec = process.env.GHOSTSCRIPT_PATH;
    return cachedGsExec;
  }

  if (fs.existsSync(ABSOLUTE_GS_PATH)) {
    cachedGsExec = ABSOLUTE_GS_PATH;
    return cachedGsExec;
  }

  // Check system PATH (Linux / Docker / Railway)
  try {
    execSync("gs -v", { stdio: "ignore" });
    cachedGsExec = "gs";
    return cachedGsExec;
  } catch {
    cachedGsExec = null;
    return null;
  }
}

export function getLibreOfficeExecutable(): string | null {
  if (cachedLoExec !== undefined) return cachedLoExec;

  if (process.env.LIBREOFFICE_PATH && fs.existsSync(process.env.LIBREOFFICE_PATH)) {
    cachedLoExec = process.env.LIBREOFFICE_PATH;
    return cachedLoExec;
  }

  if (fs.existsSync(ABSOLUTE_LIBREOFFICE_PATH)) {
    cachedLoExec = ABSOLUTE_LIBREOFFICE_PATH;
    return cachedLoExec;
  }

  // Check system PATH (Linux / Docker / Railway)
  try {
    execSync("libreoffice --version", { stdio: "ignore" });
    cachedLoExec = "libreoffice";
    return cachedLoExec;
  } catch {
    try {
      execSync("soffice --version", { stdio: "ignore" });
      cachedLoExec = "soffice";
      return cachedLoExec;
    } catch {
      cachedLoExec = null;
      return null;
    }
  }
}

export function isLibreOfficeAvailable(): boolean {
  return getLibreOfficeExecutable() !== null;
}
