import { Suspense } from "react";
import FileShareDownloadClientPage from "./client-page";

function FileShareFallback() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <p className="text-sm text-muted-foreground">Loading shared file details...</p>
    </main>
  );
}

export default function FileShareDownloadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<FileShareFallback />}>
      <FileShareDownloadClientPage params={params} />
    </Suspense>
  );
}
