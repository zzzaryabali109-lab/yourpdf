import sys
import os
import json


def protect_pdf(
    input_path: str,
    output_path: str,
    user_password: str,
    owner_password: str = None,
    allow_printing: bool = True,
    allow_copying: bool = True,
    allow_modifying: bool = False,
):
    import pypdf
    from pypdf.constants import UserAccessPermissions

    if not os.path.exists(input_path):
        sys.stderr.write(f"File not found: {input_path}\n")
        sys.exit(1)

    if not user_password:
        sys.stderr.write("User password cannot be empty\n")
        sys.exit(1)

    try:
        reader = pypdf.PdfReader(input_path)
    except Exception as e:
        sys.stderr.write(f"Failed to read PDF: {e}\n")
        sys.exit(1)

    # If already encrypted, refuse (user should unlock first)
    if reader.is_encrypted:
        sys.stderr.write("ALREADY_ENCRYPTED\n")
        sys.exit(2)

    try:
        writer = pypdf.PdfWriter()
        writer.append(reader)

        # Build permissions flags
        perms = UserAccessPermissions.all()
        if not allow_printing:
            perms &= ~UserAccessPermissions.PRINT
            perms &= ~UserAccessPermissions.PRINT_TO_REPRESENTATION
        if not allow_copying:
            perms &= ~UserAccessPermissions.EXTRACT
            perms &= ~UserAccessPermissions.EXTRACT_TEXT_AND_GRAPHICS
        if not allow_modifying:
            perms &= ~UserAccessPermissions.MODIFY
            perms &= ~UserAccessPermissions.ADD_OR_MODIFY
            perms &= ~UserAccessPermissions.ASSEMBLE_DOC

        owner_pwd = owner_password if (owner_password and owner_password.strip()) else user_password

        # Encrypt with AES-256
        writer.encrypt(
            user_password=user_password,
            owner_password=owner_pwd,
            permissions_flag=perms,
            algorithm="AES-256",
        )

        with open(output_path, "wb") as f_out:
            writer.write(f_out)

        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            sys.stderr.write("Failed to create protected PDF file.\n")
            sys.exit(1)

        result = {
            "status": "SUCCESS",
            "pageCount": len(writer.pages),
            "algorithm": "AES-256",
            "fileSize": os.path.getsize(output_path),
        }
        print(json.dumps(result))
        sys.exit(0)

    except Exception as e:
        sys.stderr.write(f"Encryption error: {e}\n")
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.stderr.write(
            "Usage: python protect-pdf.py <input.pdf> <output.pdf> <user_password> [owner_password] [permissions_json]\n"
        )
        sys.exit(1)

    in_file = sys.argv[1]
    out_file = sys.argv[2]
    user_pwd = sys.argv[3]
    owner_pwd = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] != "" else None

    allow_print = True
    allow_copy = True
    allow_modify = False

    if len(sys.argv) > 5 and sys.argv[5].strip():
        try:
            p_data = json.loads(sys.argv[5])
            allow_print = bool(p_data.get("allowPrinting", True))
            allow_copy = bool(p_data.get("allowCopying", True))
            allow_modify = bool(p_data.get("allowModifying", False))
        except Exception:
            pass

    protect_pdf(
        input_path=in_file,
        output_path=out_file,
        user_password=user_pwd,
        owner_password=owner_pwd,
        allow_printing=allow_print,
        allow_copying=allow_copy,
        allow_modifying=allow_modify,
    )
