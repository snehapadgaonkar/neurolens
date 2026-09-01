"use client";

import { Shell, Loading } from "@/components/shell";
import { useStore } from "@/lib/store";
import type { ReactNode } from "react";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { loading, report, error } = useStore();
  // The error state is rendered by the shell, so only the first load gates here.
  const showSkeleton = loading && !report && !error;
  return <Shell>{showSkeleton ? <Loading /> : children}</Shell>;
}
