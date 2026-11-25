import crypto from "node:crypto";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// Minimal valid DOCX binary (PK zip header)
const SAMPLE_DOCX_BYTES = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00]),
  crypto.randomBytes(512),
]);

async function runLoadBenchmark() {
  console.log("=== Running Load & Throughput Benchmark on Gotenberg Word-to-PDF Endpoint ===");

  const iterations = 8;
  const latencies = [];
  let failures = 0;

  const tStart = Date.now();

  // Run a series of parallel requests through the worker coordinator
  const tasks = Array.from({ length: iterations }, async (_, idx) => {
    const t0 = Date.now();
    try {
      const formData = new FormData();
      formData.append(
        "file",
        new Blob([SAMPLE_DOCX_BYTES], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
        `bench-${idx}.docx`,
      );

      const res = await fetch(`${BASE_URL}/api/documents/word-to-pdf`, {
        method: "POST",
        headers: { host: "localhost:3000", origin: "http://localhost:3000" },
        body: formData,
      });

      const data = await res.json();
      const elapsed = Date.now() - t0;
      if (!res.ok) {
        failures++;
      } else {
        latencies.push(elapsed);
      }
      return data;
    } catch {
      failures++;
    }
  });

  await Promise.all(tasks);
  const totalElapsed = Date.now() - tStart;

  const avgLatency = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1);
  const throughput = (latencies.length / (totalElapsed / 1000)).toFixed(2);
  const minLatency = latencies.length ? Math.min(...latencies) : 0;
  const maxLatency = latencies.length ? Math.max(...latencies) : 0;

  console.log(`\nBenchmark Results (${iterations} concurrent jobs):`);
  console.log(`- Completed conversions: ${latencies.length}/${iterations}`);
  console.log(`- Failure rate: ${((failures / iterations) * 100).toFixed(1)}%`);
  console.log(`- Total batch duration: ${totalElapsed} ms`);
  console.log(`- Throughput: ${throughput} conversions/sec`);
  console.log(`- Avg Latency: ${avgLatency.toFixed(1)} ms`);
  console.log(`- Min Latency: ${minLatency} ms`);
  console.log(`- Max Latency: ${maxLatency} ms`);
}

runLoadBenchmark().catch(console.error);
