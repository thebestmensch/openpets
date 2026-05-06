import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type OpenPetsConfig = {
  petPath?: string;
  position?: { x: number; y: number };
  scale?: number;
  hidden?: boolean;
  clickThrough?: boolean;
};

export const CONFIG_FILE_NAME = "config.json";

export function getOpenPetsConfigDir(env: NodeJS.ProcessEnv = process.env) {
  if (env.OPENPETS_CONFIG_DIR) {
    return resolve(env.OPENPETS_CONFIG_DIR);
  }

  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "OpenPets");
    case "win32":
      return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "OpenPets");
    default:
      return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "openpets");
  }
}

export function getOpenPetsConfigPath(env: NodeJS.ProcessEnv = process.env) {
  return join(getOpenPetsConfigDir(env), CONFIG_FILE_NAME);
}

export function getOpenPetsPetsDir(env: NodeJS.ProcessEnv = process.env) {
  return join(getOpenPetsConfigDir(env), "pets");
}
