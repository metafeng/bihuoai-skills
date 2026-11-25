"""Regression tests for package rejection and OAuth metadata validation."""
import copy
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import release
import probe_oauth


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'plugin'
        shutil.copytree(release.ROOT / 'plugin', self.root)

    def tearDown(self):
        self.temp.cleanup()

    def failed(self):
        return {c['id'] for c in release.validate_package(self.root) if c['status'] == 'FAIL'}

    def test_complete_source_passes(self):
        self.assertEqual(self.failed(), set())

    def test_missing_policy_is_rejected(self):
        path = self.root / 'plugin.json'
        data = json.loads(path.read_text())
        data['extensions']['com.doubao'].pop('privacyPolicyUrl')
        path.write_text(json.dumps(data))
        self.assertIn('PRIVACY_POLICY_URL', self.failed())

    def test_unsafe_reference_is_rejected(self):
        path = self.root / 'skills/bihuoai-video-studio/SKILL.md'
        path.write_text(path.read_text() + '\n[escape](../../../plugin.json)\n')
        self.assertIn('SKILL_REFERENCE', self.failed())

    def test_duplicate_yaml_is_rejected(self):
        with self.assertRaises(ValueError):
            release.frontmatter('---\nname: one\nname: two\n---\nBody')

    def test_static_auth_and_runtime_script_are_rejected(self):
        (self.root / 'com.doubao/auth').mkdir()
        (self.root / 'skills/bihuoai-video-studio/run.sh').write_text('echo test')
        self.assertTrue({'STATIC_AUTH', 'NO_RUNTIME_SCRIPTS'} <= self.failed())

    def test_zip_traversal_and_case_collision_are_rejected(self):
        path = Path(self.temp.name) / 'bad.zip'
        with zipfile.ZipFile(path, 'w') as z:
            for name in ('../escape', 'plugin.json', 'mcp.json', 'skills/a', 'skills/A', 'com.doubao/icon.png'):
                z.writestr(name, 'x')
        issues = release.validate_archive(path)
        self.assertTrue(any(i.startswith('ZIP_PATH:') for i in issues))
        self.assertTrue(any(i.startswith('ZIP_COLLISION:') for i in issues))

    def test_mcp_query_is_rejected(self):
        path = self.root / 'mcp.json'
        data = json.loads(path.read_text())
        server = next(iter(data['mcpServers'].values()))
        server['url'] += '?key=test'
        path.write_text(json.dumps(data))
        self.assertIn('MCP_URL', self.failed())


class OAuthTests(unittest.TestCase):
    def setUp(self):
        self.url = 'https://agent.bihuoai.com/v1/mcp'
        self.prm = {'resource': self.url, 'authorization_servers': ['https://agent.bihuoai.com']}
        self.asm = {
            'issuer': 'https://agent.bihuoai.com',
            'registration_endpoint': 'https://agent.bihuoai.com/oauth/register',
            'authorization_endpoint': 'https://agent.bihuoai.com/oauth/authorize',
            'token_endpoint': 'https://agent.bihuoai.com/oauth/token',
            'response_types_supported': ['code'],
            'grant_types_supported': ['authorization_code'],
            'code_challenge_methods_supported': ['S256'],
            'token_endpoint_auth_methods_supported': ['none'],
        }

    def failures(self, asm=None, prm=None):
        with patch.object(probe_oauth, 'validate_https', return_value=None):
            checks = probe_oauth.analyze_metadata(self.url, prm or self.prm, asm or self.asm)
        return {c['id'] for c in checks if c['status'] == 'FAIL'}

    def test_complete_metadata_passes(self):
        self.assertEqual(self.failures(), set())

    def test_exact_resource_and_issuer(self):
        prm = copy.deepcopy(self.prm)
        prm['resource'] += '/'
        asm = copy.deepcopy(self.asm)
        asm['issuer'] += '/'
        self.assertTrue({'OAUTH_RESOURCE', 'OAUTH_ISSUER_MATCH'} <= self.failures(asm, prm))

    def test_none_must_be_unique_and_in_array(self):
        for auth, issue in [('none', 'OAUTH_NONE'), (['none', 'none'], 'OAUTH_TOKEN_AUTH_UNIQUE')]:
            asm = copy.deepcopy(self.asm)
            asm['token_endpoint_auth_methods_supported'] = auth
            self.assertIn(issue, self.failures(asm))

    def test_capabilities_must_be_arrays(self):
        asm = copy.deepcopy(self.asm)
        asm['code_challenge_methods_supported'] = 'S256'
        self.assertIn('OAUTH_PKCE', self.failures(asm))

    def test_missing_endpoint_is_rejected(self):
        asm = copy.deepcopy(self.asm)
        asm.pop('token_endpoint')
        with patch.object(probe_oauth, 'validate_https', side_effect=lambda u: (_ for _ in ()).throw(ValueError('missing')) if not u else None):
            checks = probe_oauth.analyze_metadata(self.url, self.prm, asm)
        self.assertTrue(any(c['id'] == 'OAUTH_ENDPOINT_SAFETY' and c['status'] == 'FAIL' for c in checks))

    def test_private_dns_is_rejected(self):
        with patch.object(probe_oauth.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('127.0.0.1', 443))]):
            with self.assertRaises(ValueError):
                probe_oauth.validate_https('https://example.com')


if __name__ == '__main__':
    unittest.main()
