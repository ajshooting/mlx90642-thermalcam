"""Validate the actual OpenSSL certificate chain without installing any trust."""
import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "tools/generate_tls.py"
spec = importlib.util.spec_from_file_location("generate_tls", SOURCE)
tls = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tls)


class CertificateTests(unittest.TestCase):
    def test_chain_key_protection_and_server_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            state, header = directory / "tls", directory / "tls_credentials.h"
            tls.generate(state, header)
            certificate = tls.openssl("x509", "-in", state / "server.pem", "-text", "-noout").decode()
            self.assertIn("IP Address:192.168.4.1", certificate)
            self.assertIn("TLS Web Server Authentication", certificate)
            self.assertIn("CA:FALSE", certificate)
            self.assertIn("ecdsa-with-SHA256", certificate)
            result = subprocess.run(["openssl", "verify", "-CAfile", str(state / "ca.pem"),
                                     "-verify_ip", "192.168.4.2", str(state / "server.pem")], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn((state / "ca-key.pem").read_text(), header.read_text())
            self.assertIn((state / "server-key.pem").read_text(), header.read_text())
            self.assertEqual(header.stat().st_mode & 0o777, 0o600)
            self.assertEqual((state / "ca-key.pem").stat().st_mode & 0o777, 0o600)

    def test_rerun_reuses_ca_and_renew_only_changes_server_certificate(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            state, header = directory / "tls", directory / "tls_credentials.h"
            fingerprint = tls.generate(state, header)
            original = (state / "server.pem").read_bytes()
            self.assertEqual(tls.generate(state, header), fingerprint)
            self.assertEqual((state / "server.pem").read_bytes(), original)
            self.assertEqual(tls.generate(state, header, renew=True), fingerprint)
            self.assertNotEqual((state / "server.pem").read_bytes(), original)

    def test_incomplete_ca_is_preserved_and_reported(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "ca.pem").write_text("incomplete")
            with self.assertRaisesRegex(SystemExit, "Incomplete local CA"):
                tls.generate(directory, directory / "tls_credentials.h")
            self.assertEqual((directory / "ca.pem").read_text(), "incomplete")


if __name__ == "__main__":
    unittest.main()
