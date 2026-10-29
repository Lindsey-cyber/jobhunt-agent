import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { readAnswerLog } from "../store/answerlog.ts";
import { AnswerBank, Config, Profile, SearchPrefs } from "./schema.ts";

export interface UserData {
  dir: string;
  profile: Profile;
  bank: AnswerBank;
  config: Config;
  search: SearchPrefs;
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
  // Cover letters, one per employer: data/cover-letters/<company slug>.pdf.
  const letters = join(root, "cover-letters");
  if (existsSync(letters)) for (const f of readdirSync(letters).filter((x) => x.endsWith(".pdf"))) profile.documents.coverLetters[f.slice(0, -4)] = join(letters, f);
  const answersPath = join(root, "answers.yaml");
  const configPath = join(root, "config.yaml");
  const searchPath = join(root, "search.yaml");
  return {
    dir: root,
    profile,
    // Hand-kept answers.yaml, then what the agent recorded (jh answer, drafts); the log wins on an id.
    bank: (() => {
      const kept = AnswerBank.parse(existsSync(answersPath) ? readYaml(answersPath) : {});
      const logged = readAnswerLog(root);
      const ids = new Set(logged.map((a) => a.id));
      return { answers: [...kept.answers.filter((a) => !ids.has(a.id)), ...logged] };
    })(),
    config: Config.parse(existsSync(configPath) ? readYaml(configPath) : {}),
    search: SearchPrefs.parse(existsSync(searchPath) ? readYaml(searchPath) : {}),
  };
}
