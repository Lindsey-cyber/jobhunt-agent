import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { AnswerBank, Config, Profile } from "./schema.ts";

export interface UserData {
  dir: string;
  profile: Profile;
  bank: AnswerBank;
  config: Config;
}

function readYaml(path: string): unknown {
  return parse(readFileSync(path, "utf8")) ?? {};
}

export function loadUserData(dir = process.env.JH_DATA_DIR ?? "data"): UserData {
  const root = resolve(dir);
  const profilePath = join(root, "profile.yaml");
  if (!existsSync(profilePath)) {
    throw new Error(`No profile at ${profilePath}. Copy examples/profile.example.yaml there and fill it in.`);
  }
  const profile = Profile.parse(readYaml(profilePath));
  profile.documents.resume = resolve(root, profile.documents.resume);
  if (!existsSync(profile.documents.resume)) {
    throw new Error(`Resume not found at ${profile.documents.resume}`);
  }
  const answersPath = join(root, "answers.yaml");
  const configPath = join(root, "config.yaml");
  return {
    dir: root,
    profile,
    bank: AnswerBank.parse(existsSync(answersPath) ? readYaml(answersPath) : {}),
    config: Config.parse(existsSync(configPath) ? readYaml(configPath) : {}),
  };
}
