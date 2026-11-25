async function testJpgToPdf() {
  console.log("=== Testing JPG to PDF Conversion Endpoint ===");

  // We can test the API by generating a sample JPEG
  const jpgBase64 =
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
  const sampleJpgBytes = Buffer.from(jpgBase64, "base64");

  const formData = new FormData();
  const blob = new Blob([sampleJpgBytes], { type: "image/jpeg" });
  formData.append("files", blob, "test-image.jpg");

  const res = await fetch("http://localhost:3000/api/documents/jpg-to-pdf", {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
    },
    body: formData,
  });

  const data = await res.json();
  console.log("Status:", res.status);
  console.log("Response:", data);

  if (res.ok && data.id && data.pageCount === 1) {
    console.log("✅ JPG to PDF API test PASSED successfully!");
  } else {
    console.error("❌ JPG to PDF API test FAILED:", data);
    process.exit(1);
  }
}

testJpgToPdf().catch((err) => {
  console.error(err);
  process.exit(1);
});
