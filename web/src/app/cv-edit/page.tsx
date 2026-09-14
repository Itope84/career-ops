import { CvHtmlEditor } from "@/components/cv-html-editor";

export const dynamic = "force-dynamic";

import { Suspense } from "react";

export default function CvEditPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted">Loading editor...</div>}>
      <CvHtmlEditor />
    </Suspense>
  );
}
