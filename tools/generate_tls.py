"""Generate a private local CA and an ESP32 TLS header using OpenSSL."""
import argparse
import os
import secrets
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".local/tls"
HEADER = ROOT / "firmware/wifi_camera/tls_credentials.h"
CA_NAME = "ThermalCam Local CA"


def openssl(*args):
    result = subprocess.run(["openssl", *map(str, args)], capture_output=True, check=True)
    return result.stdout


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        temporary.write(data)
        temporary_path = Path(temporary.name)
    temporary_path.chmod(0o600)
    temporary_path.replace(path)


def check_pair(key, certificate):
    public_key = openssl("pkey", "-in", key, "-pubout")
    certificate_key = openssl("x509", "-in", certificate, "-pubkey", "-noout")
    if public_key != certificate_key:
        raise SystemExit(f"Key/certificate mismatch: {certificate.name}")


def generate(state, header, renew=False):
    state = Path(state)
    header = Path(header)
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    ca_key, ca = state / "ca-key.pem", state / "ca.pem"
    server_key, server = state / "server-key.pem", state / "server.pem"
    if ca_key.exists() != ca.exists():
        raise SystemExit("Incomplete local CA; restore both ca.pem and ca-key.pem before continuing")
    if server_key.exists() != server.exists():
        raise SystemExit("Incomplete server key/certificate; restore both files before continuing")
    if not ca.exists():
        if server.exists():
            raise SystemExit("The issuing CA is missing; restore it before continuing")
        with tempfile.TemporaryDirectory(dir=state) as temporary:
            directory = Path(temporary)
            key, certificate = directory / "key.pem", directory / "ca.pem"
            openssl("genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", key)
            openssl("req", "-new", "-x509", "-key", key, "-sha256", "-days", "3650",
                    "-subj", f"/CN={CA_NAME}", "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0",
                    "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-out", certificate)
            atomic_write(ca_key, key.read_bytes())
            atomic_write(ca, certificate.read_bytes())
    check_pair(ca_key, ca)
    openssl("x509", "-in", ca, "-checkend", "86400", "-noout")
    if not server.exists() or renew:
        with tempfile.TemporaryDirectory(dir=state) as temporary:
            directory = Path(temporary)
            key, request, certificate = directory / "key.pem", directory / "request.pem", directory / "server.pem"
            extensions = directory / "extensions.cnf"
            extensions.write_text("basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n"
                                  "extendedKeyUsage=serverAuth\nsubjectAltName=IP:192.168.4.1\n"
                                  "authorityKeyIdentifier=keyid,issuer\nsubjectKeyIdentifier=hash\n")
            openssl("genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", key)
            openssl("req", "-new", "-key", key, "-subj", "/CN=192.168.4.1", "-out", request)
            openssl("x509", "-req", "-in", request, "-CA", ca, "-CAkey", ca_key,
                    "-set_serial", "0x" + secrets.token_hex(16), "-sha256", "-days", "365",
                    "-extfile", extensions, "-out", certificate)
            atomic_write(server_key, key.read_bytes())
            atomic_write(server, certificate.read_bytes())
    check_pair(server_key, server)
    openssl("verify", "-CAfile", ca, "-purpose", "sslserver", "-verify_ip", "192.168.4.1", server)
    if subprocess.run(["openssl", "x509", "-in", str(server), "-checkend", "86400", "-noout"], capture_output=True).returncode:
        raise SystemExit("Server certificate expires soon; run again with --renew and upload the sketch")
    ca_der = openssl("x509", "-in", ca, "-outform", "DER")
    atomic_write(state / "thermalcam-ca.cer", ca_der)
    fingerprint = openssl("x509", "-in", ca, "-fingerprint", "-sha256", "-noout").decode().strip().split("=", 1)[1]
    certificate = server.read_text()
    key = server_key.read_text()
    # Only the server key is flashed. The CA private key stays on the Mac.
    contents = ('// Generated locally by tools/generate_tls.py; never commit this file.\n'
                '#pragma once\n#include <Arduino.h>\n\n'
                f'static const char TLS_SERVER_CERT[] PROGMEM = R"TLS_PEM({certificate})TLS_PEM";\n'
                f'static const char TLS_SERVER_KEY[] PROGMEM = R"TLS_PEM({key})TLS_PEM";\n'
                f'static const char TLS_CA_FINGERPRINT[] = "{fingerprint}";\n'
                'static const uint8_t TLS_CA_DER[] PROGMEM = {' + ','.join(f'0x{byte:02x}' for byte in ca_der) + '};\n')
    atomic_write(header, contents.encode())
    return fingerprint


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--renew", action="store_true", help="Renew the server certificate while keeping the trusted CA")
    args = parser.parse_args()
    if not shutil.which("openssl"):
        raise SystemExit("OpenSSL is required")
    os.umask(0o077)
    try:
        fingerprint = generate(STATE, HEADER, args.renew)
    except subprocess.CalledProcessError as error:
        raise SystemExit(error.stderr.decode(errors="replace").strip() or "OpenSSL validation failed") from error
    print("TLS header ready. Upload firmware/wifi_camera/wifi_camera.ino")
    print("On iPhone: http://192.168.4.1/setup, then https://192.168.4.1/")
    print("Local CA SHA-256: " + fingerprint)
    print(openssl("x509", "-in", STATE / "server.pem", "-enddate", "-noout").decode().strip())


if __name__ == "__main__":
    main()
