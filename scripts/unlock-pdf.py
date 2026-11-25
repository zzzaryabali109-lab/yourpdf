import sys
import os


def unlock_pdf(input_path: str, output_path: str, password: str = None):
    import pypdfium2 as pdfium
    import pypdfium2.raw as pdfium_raw
    from pypdfium2._helpers.misc import PdfiumError

    if not os.path.exists(input_path):
        sys.stderr.write("File not found: " + input_path)
        sys.exit(1)

    doc = None
    passwords_to_try = [password] if password else [None, ""]

    loaded = False
    for pwd in passwords_to_try:
        try:
            doc = pdfium.PdfDocument(input_path, password=pwd)
            _ = len(doc)
            loaded = True
            break
        except PdfiumError as e:
            err_msg = str(e).lower()
            if "password" in err_msg or "fpdf_err_password" in err_msg:
                continue
            else:
                sys.stderr.write(f"PDF loading error: {e}\n")
                sys.exit(1)
        except Exception as e:
            sys.stderr.write(f"Unexpected error: {e}\n")
            sys.exit(1)

    if not loaded or doc is None:
        if password:
            sys.stderr.write("INVALID_PASSWORD")
            sys.exit(3)
        else:
            sys.stderr.write("PASSWORD_REQUIRED")
            sys.exit(2)

    try:
        # Use FPDF_REMOVE_SECURITY flag to strip encryption from the output
        raw_doc = doc.raw

        # Build a file-write callback to collect bytes
        data_chunks = []

        @pdfium_raw.CFUNCTYPE(
            pdfium_raw.c_int,
            pdfium_raw.POINTER(pdfium_raw.FPDF_FILEWRITE),
            pdfium_raw.c_void_p,
            pdfium_raw.c_ulong,
        )
        def write_block(pFileWrite, pData, size):
            block = (pdfium_raw.c_ubyte * size).from_address(
                pdfium_raw.cast(pData, pdfium_raw.c_void_p).value
            )
            data_chunks.append(bytes(block))
            return 1

        writer = pdfium_raw.FPDF_FILEWRITE()
        writer.version = 1
        writer.WriteBlock = write_block

        result = pdfium_raw.FPDF_SaveAsCopy(
            raw_doc, writer, pdfium_raw.FPDF_REMOVE_SECURITY
        )

        doc.close()
        doc = None

        if result != 1:
            sys.stderr.write(f"FPDF_SaveAsCopy failed with code {result}.\n")
            sys.exit(1)

        out_data = b"".join(data_chunks)
        if len(out_data) == 0 or not out_data.startswith(b"%PDF-"):
            sys.stderr.write("Output PDF data is empty or malformed.\n")
            sys.exit(1)

        with open(output_path, "wb") as f_out:
            f_out.write(out_data)

        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            print("UNLOCKED")
            sys.exit(0)
        else:
            sys.stderr.write("Failed to save output PDF.")
            sys.exit(1)

    except Exception as e:
        sys.stderr.write(f"Error saving unlocked PDF: {e}\n")
        sys.exit(1)
    finally:
        if doc is not None:
            try:
                doc.close()
            except Exception:
                pass


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.stderr.write(
            "Usage: python unlock-pdf.py <input.pdf> <output.pdf> [password]\n"
        )
        sys.exit(1)

    in_file = sys.argv[1]
    out_file = sys.argv[2]
    pwd = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != "" else None

    unlock_pdf(in_file, out_file, pwd)
