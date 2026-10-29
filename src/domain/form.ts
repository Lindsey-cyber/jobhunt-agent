export type AtsName = "greenhouse" | "lever" | "ashby" | "workday";

export type FieldKind = "text" | "textarea" | "select" | "combobox" | "radio" | "checkbox" | "file";

export interface FormField {
  id: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  options: string[];
}

export interface FormSnapshot {
  ats: AtsName;
  url: string;
  company: string;
  jobTitle: string;
  // Where the posting says the job is, as the page shows it.
  jobLocation?: string;
  // Earlier applications to this employer in the ledger (set by apply()).
  priorApplications?: number;
  fields: FormField[];
}

export type ApplicationKey = string & { readonly __brand: "ApplicationKey" };

export function applicationKey(ats: AtsName, url: string): ApplicationKey {
  const u = new URL(url);
  // An employer careers page lists every posting at one path; the Greenhouse job id tells them apart.
  const ghJid = u.searchParams.get("gh_jid");
  return `${ats}:${u.hostname}${u.pathname.replace(/\/+$/, "")}${ghJid ? `/${ghJid}` : ""}` as ApplicationKey;
}
