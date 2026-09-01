export interface NavItem {
  href: string;
  label: string;
  /** One-line description shown in the mobile navigation sheet. */
  hint: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Navigation follows the five questions the workspace answers (DESIGN.md):
 * what was built, how it evaluates, where it fails, and whether it ships.
 */
export const NAV: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { href: "/", label: "Overview", hint: "Headline result, reliability, and what to read first" },
    ],
  },
  {
    label: "Build",
    items: [
      { href: "/cohort", label: "Cohort", hint: "Who was included, who was excluded, and why" },
      { href: "/target", label: "Target", hint: "Outcome definition, units, and distribution" },
      { href: "/splits", label: "Splits", hint: "Partitions, leakage check, and split hash" },
      { href: "/data", label: "Data", hint: "Dataset provenance, access tier, and licence" },
    ],
  },
  {
    label: "Evaluate",
    items: [
      { href: "/models", label: "Models", hint: "Families, baselines, and modality comparison" },
      { href: "/reliability", label: "Reliability", hint: "Calibration, intervals, OOD, confident-and-wrong" },
      { href: "/fairness", label: "Fairness", hint: "Subgroup error with n, CI, gap, and adequacy" },
      { href: "/mitigation", label: "Mitigation", hint: "None vs reweighting vs group-aware" },
    ],
  },
  {
    label: "Inspect",
    items: [
      { href: "/explanations", label: "Explanations", hint: "Global importances and case attributions" },
      { href: "/cases", label: "Cases", hint: "Per-patient prediction, interval, and OOD score" },
    ],
  },
  {
    label: "Release",
    items: [
      { href: "/release", label: "Audit report", hint: "Limitations, failure modes, readiness" },
      { href: "/glossary", label: "Glossary", hint: "What each term in this workspace means" },
    ],
  },
];

export const ALL_ITEMS: NavItem[] = NAV.flatMap((group) => group.items);
