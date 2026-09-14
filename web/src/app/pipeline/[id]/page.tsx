import { notFound } from "next/navigation";
import { readReport, findApplication, trackerCanDelete } from "@/lib/career-ops";
import { ReportView } from "@/components/report-view";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = findApplication(id);
  
  // The row ID (#) might diverge from the report file number if rows were deleted or added manually.
  // Always trust the explicit report link in the tracker if we have it.
  let reportId = id;
  if (app?.report) {
    const m = app.report.match(/\[(\d+)\]/);
    if (m) reportId = m[1];
  }
  
  const report = readReport(reportId);
  if (!app && !report) notFound();
  return <ReportView id={id} reportId={reportId} app={app} report={report?.content ?? null} file={report?.file ?? null} canDelete={trackerCanDelete()} />;
}
