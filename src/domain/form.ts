export type AtsName = "greenhouse";

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
  fields: FormField[];
}

export type ApplicationKey = string & { readonly __brand: "ApplicationKey" };

export function applicationKey(ats: AtsName, url: string): ApplicationKey {
  const u = new URL(url);
  return `${ats}:${u.hostname}${u.pathname.replace(/\/+$/, "")}` as ApplicationKey;
}
