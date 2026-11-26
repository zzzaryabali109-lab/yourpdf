export class MultipartTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MultipartTooLargeError";
  }
}

/** Read multipart uploads with a hard byte cap, including requests without Content-Length. */
export async function parseMultipartWithinLimit(request: Request, limit: number, message: string) {
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) {
    throw new Error("The upload request must use multipart form data.");
  }

  const source = request.body;
  if (!source) throw new Error("The upload body is empty.");
  const reader = source.getReader();
  let totalBytes = 0;
  const boundedStream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        totalBytes += value.byteLength;
        if (totalBytes > limit) {
          const error = new MultipartTooLargeError(message);
          controller.error(error);
          await reader.cancel(error).catch(() => undefined);
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });

  const parseRequest = new Request("http://localhost/upload", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: boundedStream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return parseRequest.formData();
}
